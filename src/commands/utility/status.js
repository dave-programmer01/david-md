const store = require("../../store");
const menu = require("../../lib/menu");
const registry = require("../../lib/registry");
const { buildAlive } = require("../general/alive");

const CATEGORY = "Utility";

module.exports = [
  {
    name: "ping",
    aliases: ["speed"],
    category: CATEGORY,
    desc: "Check the bot is responding and how fast",
    usage: ".ping",
    permission: "public",
    react: false,
    execute: async (ctx) => {
      // Time an actual round-trip to WhatsApp rather than local work — that's
      // the number that tells you whether the bot feels slow.
      const start = Date.now();
      const sent = await ctx.reply("🏓 Pinging…");
      const latency = Date.now() - start;

      const uptime = menu.formatUptime(Date.now() - (store.botStartTimestamp || Date.now()));
      const quality = latency < 400 ? "excellent" : latency < 1200 ? "good" : latency < 3000 ? "sluggish" : "poor";

      await ctx.sock.sendMessage(ctx.chat, {
        edit: sent.key,
        text:
          `🏓 *Pong!*\n\n` +
          `Response : *${latency} ms* _(${quality})_\n` +
          `Uptime   : ${uptime}\n` +
          `Commands : ${registry.size}`,
      });
    },
  },

  {
    name: "uptime",
    aliases: ["runtime"],
    category: CATEGORY,
    desc: "How long the bot has been running",
    usage: ".uptime",
    permission: "public",
    execute: async (ctx) => {
      const since = store.botStartTimestamp || Date.now();
      return ctx.reply(
        `⏱️ *Up for ${menu.formatUptime(Date.now() - since)}*\n\n` +
          `_Started ${new Date(since).toLocaleString()}_`
      );
    },
  },

  {
    name: "menu",
    aliases: ["help", "commands"],
    category: CATEGORY,
    desc: "Every command the bot has",
    usage: ".menu  |  .menu group",
    permission: "public",
    execute: async (ctx) => {
      const wanted = ctx.args[0];

      if (wanted) {
        const match = registry.CATEGORY_ORDER.find((c) => c.toLowerCase() === wanted.toLowerCase());
        if (!match) {
          return ctx.reply(
            `❌ No category called *${wanted}*.\n\n` +
              `Try one of: ${registry.CATEGORY_ORDER.join(", ")}`
          );
        }
        return ctx.reply(await menu.renderMenu(ctx, { only: match }));
      }

      return ctx.reply(await menu.renderMenu(ctx));
    },
  },

  {
    name: "testalive",
    category: CATEGORY,
    desc: "Preview your alive message exactly as others see it",
    usage: ".testalive",
    permission: "owner",
    execute: async (ctx) => {
      await ctx.reply(await buildAlive(ctx));
      return ctx.reply(`☝️ That's what *${ctx.prefix}alive* shows.\n\n_Change it with_ ${ctx.prefix}setalive`);
    },
  },
];
