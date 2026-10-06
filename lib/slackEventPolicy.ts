const configModule = require("./config");
const { config } = configModule;

function stagingBlocked(channel: string): boolean {
  const allow = config.slack.stagingOnlyChannels;
  if (!allow || allow.length === 0) return false;
  return !allow.includes(channel);
}

export = { stagingBlocked };
