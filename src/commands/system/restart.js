const os = require("os");
const store = require("../../store");
const menu = require("../../lib/menu");
const registry = require("../../lib/registry");
const S = require("../../settings");

module.exports = {
  name: "restart",
  category: "System",
  desc: "Restart the bot",
  usage: ".restart",
  permission: "owner",
  execute: async (ctx) => {
    const uptime = menu.formatUptime(Date.now() - (store.botStartTimestamp || Date.now()));

    await ctx.reply(
      `🔄 *Restarting*\n\n` +
        `Was up for : ${uptime}\n` +
        `Commands   : ${registry.size}\n` +
        `Version    : ${S.VERSION}\n\n` +
        `_Back in a few seconds — as long as something is set to restart me._`
    );

    // Exit cleanly and let the supervisor bring the process back: Docker's
    // `restart: unless-stopped`, pm2, or Heroku's dyno manager. Without one of
    // those the bot stays down, which is why the message says so.
    setTimeout(() => process.exit(0), 1500);
  },
};
