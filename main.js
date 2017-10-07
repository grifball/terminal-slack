const fs = require('fs');
const request = require('request');
const notifier = require('node-notifier');
const path = require('path');

const TOKEN = process.env.SLACK_TOKEN;

const ui = require('./userInterface.js');
const slack = require('./slackClient.js');

const components = ui.init(); // ui components
let users;
let currentUser;
let channels;
let currentChannel;
let currentChannelOldest;

const UNKNOWN_USER_NAME = 'Unknown User';
// This is a hack to make the message list scroll to the bottom whenever a message is sent.
// Multiline messages would otherwise only scroll one line per message leaving part of the message
// cut off. This assumes that messages will be less than 50 lines high in the chat window.
const SCROLL_PER_MESSAGE = 50;

// generates ids for messages
const getNextId = (() => {
  let id = 0;
  return () => {
    id += 1;
    return id;
  };
})();

// we'll be able to lock the scroller to new messages with this boolean
var lockToBottom=true

// handles the reply to say that a message was successfully sent
function handleSentConfirmation(message) {
  // for some reason getLines gives an object with int keys
  const lines = components.chatWindow.getLines();
  const keys = Object.keys(lines);
  let line;
  let i;
  for (i = keys.length - 1; i >= 0; i -= 1) {
    line = lines[keys[i]].split('(pending - ');
    if (parseInt(line.pop()[0], 10) === message.reply_to) {
      components.chatWindow.deleteLine(parseInt(keys[i], 10));

      if (message.ok) {
        components.chatWindow.insertLine(i, line.join(''));
      } else {
        components.chatWindow.insertLine(i, `${line.join('')} (FAILED)`);
      }
      break;
    }
  }
	if (lockToBottom)
		components.scrollBottom();
  components.screen.render();
}

// formats channel and user mentions readably
function formatMessageMentions(text) {
  if (text === null || typeof text === 'undefined') {
    return '';
  }

  let formattedText = text;
  // find user mentions
  const userMentions = text.match(/<@U[a-zA-Z0-9]+>/g);
  if (userMentions !== null) {
    userMentions
      .map(match => match.substr(2, match.length - 3))
      .forEach((userId) => {
        let username;
        let modifier;
        if (userId === currentUser.id) {
          username = currentUser.name;
          modifier = 'yellow-fg';
        } else {
          const user = users.find(potentialUser => potentialUser.id === userId);
          username = typeof user === 'undefined' ? UNKNOWN_USER_NAME : user.name;
          modifier = 'underline';
        }

        formattedText = text.replace(
          new RegExp(`<@${userId}>`, 'g'),
          `{${modifier}}@${username}{/${modifier}}`);
      });
  }

  // find special words
  return formattedText.replace(
    /<!channel>/g,
    '{yellow-fg}@channel{/yellow-fg}');
}

function handleNewMessage(message) {
  let username;
  if (message.user === currentUser.id) {
    username = currentUser.name;
  } else {
    const author = users.find(user => message.user === user.id);
    username = (author && author.name) || UNKNOWN_USER_NAME;

    notifier.notify({
      icon: path.join(__dirname, 'Slack_Mark_Black_Web.png'),
      message: `${username}: ${message.text}`,
      sound: true,
      title: 'Terminal Slack',
    });
  }

  if (message.channel !== currentChannel.id ||
      typeof message.text === 'undefined') {
    return;
  }

  components.chatWindow.insertBottom(
    `{bold}${username}{/bold}: ${formatMessageMentions(message.text)}`
  );
	if (lockToBottom)
		components.scrollBottom()
  components.screen.render();
}

slack.init((data, ws) => {
  currentUser = data.self;

  // don't update focus until ws is connected
  // focus on the channel list
  components.channelList.select(0);
  components.channelList.focus();
  // re render screen
  components.screen.render();

  ws.on('message', (message /* , flags */) => {
    const parsedMessage = JSON.parse(message);

    if ('reply_to' in parsedMessage) {
      handleSentConfirmation(parsedMessage);
    } else if (parsedMessage.type === 'message') {
      handleNewMessage(parsedMessage);
    }
  });

  // initialize these event handlers here as they allow functionality
  // that relies on websockets

  // event handler when message is submitted
  components.messageInput.on('submit', (text) => {
    const id = getNextId();
    components.messageInput.clearValue();
    components.messageInput.focus();
    components.scrollBottom();
    components.chatWindow.insertBottom(
      `{bold}${currentUser.name}{/bold}: ${text} (pending - ${id})`
    );
    components.chatWindow.scroll(SCROLL_PER_MESSAGE);

    components.screen.render();
    ws.send(JSON.stringify({
      id,
      type: 'message',
      channel: currentChannel.id,
      text,
    }));
  });

  // set the user list to the users returned from slack
  // called here to check against currentUser
  slack.getUsers((error, response, userData) => {
    if (error || response.statusCode !== 200) {
      console.log( // eslint-disable-line no-console
        'Error: ', error, response || response.statusCode
      );
      return;
    }

    const parsedUserData = JSON.parse(userData);
    users = parsedUserData.members.filter(user => !user.deleted && user.id !== currentUser.id);

    components.userList.setItems(users.map(slackUser => slackUser.name));
    components.screen.render();
  });
});

// set the channel list
components.channelList.setItems(['Connecting to Slack...']);
components.screen.render();

// set the channel list to the channels returned from slack
slack.getChannels((error, response, data) => {
  if (error || response.statusCode !== 200) {
    console.log( // eslint-disable-line no-console
      'Error: ', error, response && response.statusCode
    );
    return;
  }

  const channelData = JSON.parse(data);
  channels = channelData.channels.filter(channel => !channel.is_archived);

  components.channelList.setItems(
    channels.map(slackChannel => slackChannel.name)
  );
  components.screen.render();
});

// set the group list to the groups returned from slack
slack.getGroups((error, response, data) => {
  if (error || response.statusCode !== 200) {
    console.log( // eslint-disable-line no-console
      'Error: ', error, response && response.statusCode
    );
    return;
  }

  const groupData = JSON.parse(data);
  groups = groupData.groups.filter(group => !group.is_archived);

  components.groupList.setItems(
    groups.map(slackGroup => slackGroup.name)
  );
  components.screen.render();
});

// event handler when user selects a channel
function updateMessages(data, markFn) {
  components.chatWindow.deleteTop(); // remove loading message

  // filter and map the messages before displaying them
  data.messages
    .filter(item => !item.hidden)
    .filter(item => item.type === 'message')
    // Some messages related to message threading don't have text. This feature
    // isn't supported by terminal-slack right now so we filter them out
    .filter(item => typeof item.text !== 'undefined')
    .map((message) => {
      const len = users.length;
      let username;
      let i;

      // get the author
      if (message.user === currentUser.id) {
        username = currentUser.name;
      } else {
        for (i = 0; i < len; i += 1) {
          if (message.user === users[i].id) {
            username = users[i].name;
            break;
          }
        }
      }
      return { ts:message.ts, text: message.text, username: username || UNKNOWN_USER_NAME };
    })
    .forEach((message) => {
      // add messages to window
			fs.appendFileSync('error_log.txt', message.ts+"\n");
      components.chatWindow.unshiftLine(
        `{bold}${message.username}[${new Date(message.ts*1000).toISOString().slice(0, 16)}]{/bold}: ${formatMessageMentions(message.text)}`
      );
    });

  // mark the most recently read message
  if (data.messages.length) {
    markFn(currentChannel, data.messages[0].ts);
  }

  // reset messageInput and give focus
  components.messageInput.clearValue();
  //components.chatWindow.scrollTo(components.chatWindow.getLines().length * SCROLL_PER_MESSAGE);
  //components.messageInput.focus();
  components.screen.render();
}

components.userList.on('select', (data) => {
  const username = data.content;

  // a channel was selected
  components.mainWindowTitle.setContent(`{bold}${username}{/bold}`);
  components.chatWindow.setContent('Getting messages...');
  components.screen.render();

  // get user's id
  const userId = users.find(potentialUser => potentialUser.name === username).id;

  slack.openIm(userId, (error, response, imData) => {
    const parsedImData = JSON.parse(imData);
    currentChannel = parsedImData.channel;

    // load im history
    slack.getImHistory(currentChannel, (histError, histResponse, imHistoryData) => {
      updateMessages(JSON.parse(imHistoryData), slack.markIm);
    });
  });
});

components.channelList.on('select', (data) => {
  const channelName = data.content;

  // a channel was selected
  components.mainWindowTitle.setContent(`{bold}${channelName}{/bold}`);
  components.chatWindow.setContent('Getting messages...');
  components.screen.render();

  // join the selected channel
  slack.joinChannel(channelName, (error, response, channelData) => {
    const parsedChannelData = JSON.parse(channelData);
    currentChannel = parsedChannelData.channel;

    // get the previous messages of the channel and display them
		slack.getChannelHistory(currentChannel, {channel:currentChannel.id},(error, response, data) => {
			var dataObj=JSON.parse(data)
			currentChannelOldest = dataObj.messages[dataObj.messages.length-1].ts
      updateMessages(JSON.parse(data), slack.markChannel);
		})
		/*
    slack.getChannelHistory(currentChannelId, (histError, histResponse, channelHistoryData) => {
      updateMessages(JSON.parse(channelHistoryData), slack.markChannel);
    });*/
  });
});

components.groupList.on('select', (data) => {
  const groupName = data.content;

  // a channel was selected
  components.mainWindowTitle.setContent(`{bold}${groupName}{/bold}`);
  components.chatWindow.setContent('Getting messages...');
  components.screen.render();

  // join the selected channel
  slack.joinGroup(groupName, (error, response, groupData) => {
    const parsedGroupData = JSON.parse(groupData);
    currentChannel = parsedGroupData.group;

    // get the previous messages of the channel and display them
    slack.getChannelHistory(currentChannel, {channel:currentChannel.id}, (histError, histResponse, groupHistoryData) => {
      updateMessages(JSON.parse(groupHistoryData), slack.markChannel);
    });
  });
});
// scrolling in chat window
components.chatWindow.on('keypress', (ch, key) => {
	if (key.name === 'end') {
		components.chatWindow.scroll(components.chatWindow.getScrollHeight());
	}
	if (key.name === 'home') {
		components.chatWindow.scroll(-components.chatWindow.getScrollHeight());
	}
	if (key.name === 'pageup') {
		components.chatWindow.scroll(-Math.round(components.mainWindowTitle.height/2));
	}
	if (key.name === 'pagedown') {
		components.chatWindow.scroll(Math.round(components.mainWindowTitle.height/2));
	}
	if (key.name === 'up') {
		components.chatWindow.scroll(-1);
	}
	if (key.name === 'down') {
		components.chatWindow.scroll(1);
	}
	fs.appendFileSync('error_log.txt', JSON.stringify({now:components.chatWindow.getScroll(),he:components.chatWindow.getScrollHeight()-1})+"\n");
	if (components.chatWindow.getScroll()==components.chatWindow.getScrollHeight()-1){
		components.mainWindowTitle.setContent("locked");
		lockToBottom=true
	}else{
		components.mainWindowTitle.setContent("unlocked");
		lockToBottom=false
		if (components.chatWindow.getScroll()==0){
			slack.getChannelHistory(currentChannel, {
					channel:currentChannel.id,
					latest:currentChannelOldest
				},(error, response, data) => {
				var dataObj=JSON.parse(data)
				if (dataObj.messages.length>0){
					currentChannelOldest = dataObj.messages[dataObj.messages.length-1].ts
					updateMessages(JSON.parse(data), slack.markChannel);
				}
			})
		}
	}
	components.screen.render();
});
