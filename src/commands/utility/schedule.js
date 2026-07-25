const scheduler = require("../../utils/schedule");
const menu = require("../../lib/menu");

const CATEGORY = "Utility";

module.exports = [
  {
    name: "schedule",
    aliases: ["remind"],
    category: CATEGORY,
    desc: "Send a message later",
    usage: ".schedule 30m Stand-up starts now",
    permission: "admin",
    execute: async (ctx) => {
      const when = ctx.args[0];
      const text = ctx.args.slice(1).join(" ").trim();

      if (!when || !text) {
        return ctx.reply(
          `*Usage:* ${ctx.prefix}schedule <when> <message>\n\n` +
            `*Examples*\n` +
            `${ctx.prefix}schedule 30m Stand-up starts now\n` +
            `${ctx.prefix}schedule 2h Reminder: submit reports\n` +
            `${ctx.prefix}schedule 1d Happy birthday!\n` +
            `${ctx.prefix}schedule 2026-08-01T09:00 Launch day\n\n` +
            `_Units: s, m, h, d, w. Times use the server's clock._`
        );
      }

      const at = scheduler.parseWhen(when);
      if (!at) {
        return ctx.reply(`❌ I couldn't read *${when}* as a time.\n\nTry \`30m\`, \`2h\`, \`1d\` or a full date.`);
      }
      if (at <= Date.now()) return ctx.reply("❌ That's in the past.");
      if (at - Date.now() > 365 * 86_400_000) return ctx.reply("❌ A year ahead is the limit.");

      const job = await scheduler.schedule(ctx.sock, {
        chat: ctx.chat,
        text,
        mentions: ctx.mentions,
        by: ctx.sender,
        at,
      });

      return ctx.reply(
        `⏰ *Scheduled*\n\n` +
          `Message : ${text}\n` +
          `Sends in: ${menu.formatUptime(at - Date.now())}\n` +
          `At      : ${new Date(at).toLocaleString()}\n` +
          `ID      : \`${job.id}\`\n\n` +
          `_Cancel with_ ${ctx.prefix}cancel ${job.id}`
      );
    },
  },

  {
    name: "scheduled",
    aliases: ["reminders"],
    category: CATEGORY,
    desc: "See what's queued to send",
    usage: ".scheduled  |  .scheduled all",
    permission: "admin",
    execute: async (ctx) => {
      const everywhere = ctx.args[0]?.toLowerCase() === "all";
      const jobs = await scheduler.list(everywhere ? null : ctx.chat);

      if (!jobs.length) {
        return ctx.reply(
          everywhere
            ? "Nothing scheduled anywhere."
            : `Nothing scheduled in this chat.\n\n_See every chat with_ ${ctx.prefix}scheduled all`
        );
      }

      const lines = jobs.slice(0, 20).map((job, i) => {
        const left = menu.formatUptime(Math.max(0, job.at - Date.now()));
        return (
          `┃◬│ ${i + 1}. \`${job.id}\` — in ${left}\n` +
          `┃◬│    ${String(job.text).slice(0, 50)}${job.text.length > 50 ? "…" : ""}`
        );
      });

      return ctx.reply(
        `╭═══〘 *Scheduled* (${jobs.length}) 〙═══⊷❍\n${lines.join("\n")}\n╰═════════════════⊷\n\n` +
          `_Cancel one with_ ${ctx.prefix}cancel <id>`
      );
    },
  },

  {
    name: "cancel",
    category: CATEGORY,
    desc: "Cancel a scheduled message",
    usage: ".cancel a1b2c3d4  |  .cancel all",
    permission: "admin",
    execute: async (ctx) => {
      const id = ctx.args[0];
      if (!id) {
        return ctx.reply(`*Usage:* ${ctx.prefix}cancel <id>\n\nSee the ids with ${ctx.prefix}scheduled`);
      }

      if (id.toLowerCase() === "all") {
        const jobs = await scheduler.list(ctx.chat);
        for (const job of jobs) await scheduler.cancel(job.id);
        return ctx.reply(`🗑️ Cancelled ${jobs.length} scheduled message(s) in this chat.`);
      }

      const job = await scheduler.cancel(id);
      if (!job) return ctx.reply(`❌ No scheduled message with id *${id}*.`);

      return ctx.reply(`🗑️ Cancelled: _${String(job.text).slice(0, 80)}_`);
    },
  },
];
