const fs = require('fs');
const request = require('request');
const WebSocket = require('ws');

const TOKEN = process.env.SLACK_TOKEN;

if (TOKEN === undefined) {
  console.log( // eslint-disable-line no-console
    'Error: SLACK_TOKEN undefined. Please add SLACK_TOKEN to the environment variables.'
  );
  process.exit(1);
}

// makes a request to slack. Adds token to query
function slackRequest(endpoint, query, callback) {
  const qs = query;
  qs.token = TOKEN;
  request.get({
    url: `https://slack.com/api/${endpoint}`,
    qs,
  }, (error, response, data) => {
    if (error) {
      fs.writeFileSync('error_log.txt', error);
      process.exit(1);
    }

    if (response.statusCode !== 200) {
      fs.writeFileSync('error_log.txt', `Response Error: ${response.statusCode}`);
      process.exit(1);
    }

    const parsedData = JSON.parse(data);
    if (!parsedData.ok) {
      // can't see console.logs with blessed
      fs.writeFileSync('error_log.txt', `Error: ${parsedData.error}`);
      process.exit(1);
    }

    if (callback) {
      callback(error, response, data);
    }
  });
}

module.exports = {
  init(callback) {
    slackRequest('rtm.start', {}, (error, response, data) => {
      const parsedData = JSON.parse(data);
      const ws = new WebSocket(parsedData.url);
      callback(parsedData, ws);
    });
  },
  getChannels(callback) {
    slackRequest('channels.list', {}, (error, response, data) => {
      if (callback) {
        callback(error, response, data);
      }
    });
  },
  joinChannel(name, callback) {
    slackRequest('channels.join', {
      name,
    }, (error, response, data) => {
      if (callback) {
        callback(error, response, data);
      }
    });
  },
  getChannelHistory(channel, qs, callback) {
    if (channel.id.startsWith('G')) {
      // ID is for a group and not a channel
      slackRequest('groups.history', 
				qs
			, (error, response, data) => {
        if (callback) {
          callback(error, response, data);
        }
      });
    } else {
      // ID is hopefully for a channel
      slackRequest('channels.history', 
				qs
			, (error, response, data) => {
        if (callback) {
          callback(error, response, data);
        }
      });
    }
  },
  markChannel(channel, timestamp, callback) {
    if (channel.id.startsWith('G')) {
      // ID is for a group and not a channel
      slackRequest('groups.mark', {
        channel: channel.id,
        ts: timestamp,
      }, (error, response, data) => {
        if (callback) {
          callback(error, response, data);
        }
      });
    } else {
      slackRequest('channels.mark', {
        channel: channel.id,
        ts: timestamp,
      }, (error, response, data) => {
        if (callback) {
          callback(error, response, data);
        }
      });
    }
  },
  getGroups(callback) {
    slackRequest('groups.list', {}, (error, response, data) => {
      if (callback) {
        callback(error, response, data);
      }
    });
  },
  // Modified channel.join: request group list and loop to find id for name
  joinGroup(name, callback) {
    slackRequest('groups.list', {}, (error, response, data) => {
      if (callback) {
        if (data) {
          groupList = JSON.parse(data);
          groupList.groups.forEach((group) => {
            if (group.name === name) {
              groupList.group = group;
              callback(error, response, JSON.stringify(groupList));
            }
          });
        } else {
          callback(error, response, data);
        }
      }
    });
  },
  getUsers(callback) {
    slackRequest('users.list', {}, (error, response, data) => {
      if (callback) {
        callback(error, response, data);
      }
    });
  },
  openIm(channel, callback) {
    slackRequest('im.open', {
      user: channel.id,
    }, (error, response, data) => {
      if (callback) {
        callback(error, response, data);
      }
    });
  },
  getImHistory(channel, callback) {
    slackRequest('im.history', {
      channel: channel.id,
    }, (error, response, data) => {
      if (callback) {
        callback(error, response, data);
      }
    });
  },
  markIm(channel, timestamp, callback) {
    slackRequest('im.mark', {
      channel: channel.id,
      ts: timestamp,
    }, (error, response, data) => {
      if (callback) {
        callback(error, response, data);
      }
    });
  },
};
