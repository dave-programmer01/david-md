const db = require("../../db");
const { numberOf } = require("../../lib/ctx");

const CATEGORY = "Owner";

/**
 * A bot-level ignore list. A banned user's commands are dropped before they
 * run — silently, which is the point: arguing with the bot is not a feature.
 * Group moderation is separate; see .kick and the warn commands.
 */
module.exports = [
  {
    name: "ban",
    category: CATEGORY,
    desc: "Stop someone from using the bot at all",
    usage: ".ban @user [reason]",
    permission: "owner",
    execute: async (ctx) => {
      const targets = ctx.targets();
      if (!targets.length) {
        return ctx.reply(
          `Reply to someone, mention them, or give a number:\n` +
            `${ctx.prefix}ban @user spamming\n` +
            `${ctx.prefix}ban 2348012345678\n\n` +
            `_They keep working normally in groups — the bot just stops answering them._`
        );
      }

      const reason = ctx.args.filter((a) => !a.startsWith("@") && !/^\d{7,}$/.test(a)).join(" ").trim();
      const ownerNumber = String(await db.get("ownerNumber")).replace(/[^0-9]/g, "");

      const banned = [];
      const refused = [];

      for (const jid of targets) {
        const number = numberOf(jid);

        // Banning yourself or the bot locks you out of your own bot, and
        // nothing short of a redeploy would undo it.
        if (jid === ctx.botJid || number === ownerNumber || ctx.senderIds.includes(jid)) {
          refused.push(number);
          continue;
        }

        await db.raw().set(db.BANNED, jid, {
          at: Date.now(),
          by: ctx.senderNumber,
          reason: reason || "",
        });
        banned.push(number);
      }

      const lines = [];
      if (banned.length) {
        lines.push(
          `🚫 Banned ${banned.map((n) => `@${n}`).join(", ")}` +
            (reason ? `\n_Reason: ${reason}_` : "") +
            `\n\n_The bot will now ignore them. Undo with_ ${ctx.prefix}unban`
        );
      }
      if (refused.length) {
        lines.push(`⚠️ Skipped ${refused.map((n) => `@${n}`).join(", ")} — you can't ban yourself or the bot.`);
      }

      return ctx.reply(lines.join("\n\n"), { mentions: targets });
    },
  },

  {
    name: "unban",
    category: CATEGORY,
    desc: "Let a banned user back in",
    usage: ".unban @user  |  .unban all",
    permission: "owner",
    execute: async (ctx) => {
      if (ctx.args[0]?.toLowerCase() === "all") {
        const all = await db.raw().all(db.BANNED);
        const count = Object.keys(all).length;
        if (!count) return ctx.reply("Nobody is banned.");
        for (const jid of Object.keys(all)) await db.raw().del(db.BANNED, jid);
        return ctx.reply(`✅ Unbanned everyone — ${count} user(s).`);
      }

      const targets = ctx.targets();
      if (!targets.length) {
        return ctx.reply(
          `Reply to someone, mention them, or give a number:\n` +
            `${ctx.prefix}unban @user\n${ctx.prefix}unban all\n\n` +
            `See who's banned: ${ctx.prefix}banlist`
        );
      }

      const lifted = [];
      const notBanned = [];

      for (const jid of targets) {
        if (await db.raw().get(db.BANNED, jid, null)) {
          await db.raw().del(db.BANNED, jid);
          lifted.push(numberOf(jid));
        } else {
          notBanned.push(numberOf(jid));
        }
      }

      const lines = [];
      if (lifted.length) lines.push(`✅ Unbanned ${lifted.map((n) => `@${n}`).join(", ")}`);
      if (notBanned.length) lines.push(`_${notBanned.map((n) => `@${n}`).join(", ")} wasn't banned._`);

      return ctx.reply(lines.join("\n"), { mentions: targets });
    },
  },

  {
    name: "banlist",
    aliases: ["banned"],
    category: CATEGORY,
    desc: "See who the bot is ignoring",
    usage: ".banlist",
    permission: "owner",
    execute: async (ctx) => {
      const all = await db.raw().all(db.BANNED);
      const entries = Object.entries(all);

      if (!entries.length) {
        return ctx.reply(`Nobody is banned.\n\n_Ban someone with_ ${ctx.prefix}ban @user`);
      }

      const lines = entries
        .sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0))
        .map(([jid, entry], i) => {
          const when = entry?.at ? new Date(entry.at).toLocaleDateString() : "";
          const why = entry?.reason ? `\n┃◬│    _${String(entry.reason).slice(0, 50)}_` : "";
          return `┃◬│ ${i + 1}. @${numberOf(jid)}${when ? `  _(${when})_` : ""}${why}`;
        });

      return ctx.reply(
        `╭═══〘 *Banned* (${entries.length}) 〙═══⊷❍\n${lines.join("\n")}\n╰═════════════════⊷\n\n` +
          `_Lift one with_ ${ctx.prefix}unban @user`,
        { mentions: entries.map(([jid]) => jid) }
      );
    },
  },
];
