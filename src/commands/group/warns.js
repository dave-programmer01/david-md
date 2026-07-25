const db = require("../../db");
const { numberOf } = require("../../lib/ctx");

const CATEGORY = "Group";

const keyFor = (chat, jid) => `${chat}:${jid}`;
const readWarn = async (chat, jid) =>
  (await db.raw().get(db.WARNS, keyFor(chat, jid), null)) || { count: 0, reasons: [] };

module.exports = [
  {
    name: "warn",
    category: CATEGORY,
    desc: "Warn a member — enough warnings and they're removed",
    usage: ".warn @user spamming",
    permission: "admin",
    execute: async (ctx) => {
      const targets = ctx.targets().filter((j) => j !== ctx.botJid);
      if (!targets.length) return ctx.reply(`Reply to someone or mention them:\n${ctx.prefix}warn @user <reason>`);

      const reason = ctx.args.filter((a) => !a.startsWith("@")).join(" ").trim() || "no reason given";
      const limit = Number(await db.get("warnLimit")) || 3;
      const replies = [];

      for (const jid of targets) {
        const entry = await readWarn(ctx.chat, jid);
        entry.count += 1;
        entry.reasons.push({ reason, by: ctx.sender, at: Date.now() });

        if (entry.count >= limit) {
          await db.raw().del(db.WARNS, keyFor(ctx.chat, jid));
          if (ctx.isBotAdmin) {
            await ctx.sock.groupParticipantsUpdate(ctx.chat, [jid], "remove").catch(() => {});
            replies.push(`🚫 @${numberOf(jid)} hit ${limit}/${limit} and was removed.`);
          } else {
            replies.push(
              `⚠️ @${numberOf(jid)} hit ${limit}/${limit} — but I'm not an admin, so I couldn't remove them.`
            );
          }
        } else {
          await db.raw().set(db.WARNS, keyFor(ctx.chat, jid), entry);
          replies.push(`⚠️ @${numberOf(jid)} warned — *${entry.count}/${limit}*\n_Reason: ${reason}_`);
        }
      }

      return ctx.reply(replies.join("\n\n"), { mentions: targets });
    },
  },

  {
    name: "warnings",
    aliases: ["warns"],
    category: CATEGORY,
    desc: "See someone's warnings",
    usage: ".warnings @user",
    permission: "group",
    execute: async (ctx) => {
      const target = ctx.targets()[0] || ctx.sender;
      const entry = await readWarn(ctx.chat, target);
      const limit = Number(await db.get("warnLimit")) || 3;

      if (!entry.count) return ctx.reply(`✅ @${numberOf(target)} has no warnings.`, { mentions: [target] });

      const lines = entry.reasons.map((r, i) => {
        const when = r.at ? new Date(r.at).toLocaleDateString() : "";
        return `┃◬│ ${i + 1}. ${r.reason || r}${when ? `  _(${when})_` : ""}`;
      });

      return ctx.reply(
        `╭═〘 Warnings: @${numberOf(target)} 〙═⊷❍\n` +
          `┃◬│ *${entry.count} of ${limit}*\n┃◬│\n` +
          lines.join("\n") +
          `\n╰═════════════════⊷`,
        { mentions: [target] }
      );
    },
  },

  {
    name: "rmwarn",
    aliases: ["unwarn"],
    category: CATEGORY,
    desc: "Take one warning back",
    usage: ".rmwarn @user",
    permission: "admin",
    execute: async (ctx) => {
      const targets = ctx.targets();
      if (!targets.length) return ctx.reply(`Reply to someone or mention them:\n${ctx.prefix}rmwarn @user`);

      const limit = Number(await db.get("warnLimit")) || 3;
      const replies = [];

      for (const jid of targets) {
        const entry = await readWarn(ctx.chat, jid);
        if (!entry.count) {
          replies.push(`@${numberOf(jid)} had no warnings.`);
          continue;
        }
        entry.count -= 1;
        entry.reasons.pop();

        if (entry.count <= 0) await db.raw().del(db.WARNS, keyFor(ctx.chat, jid));
        else await db.raw().set(db.WARNS, keyFor(ctx.chat, jid), entry);

        replies.push(`✅ @${numberOf(jid)} is now on *${entry.count}/${limit}*.`);
      }

      return ctx.reply(replies.join("\n"), { mentions: targets });
    },
  },

  {
    name: "resetwarn",
    aliases: ["clearwarn"],
    category: CATEGORY,
    desc: "Wipe someone's warnings, or everyone's",
    usage: ".resetwarn @user  |  .resetwarn all",
    permission: "admin",
    execute: async (ctx) => {
      if (ctx.args[0]?.toLowerCase() === "all") {
        const all = await db.raw().all(db.WARNS);
        const mine = Object.keys(all).filter((k) => k.startsWith(`${ctx.chat}:`));
        for (const key of mine) await db.raw().del(db.WARNS, key);
        return ctx.reply(`🧹 Cleared warnings for ${mine.length} member(s) in this group.`);
      }

      const targets = ctx.targets();
      if (!targets.length) {
        return ctx.reply(`${ctx.prefix}resetwarn @user\n${ctx.prefix}resetwarn all`);
      }
      for (const jid of targets) await db.raw().del(db.WARNS, keyFor(ctx.chat, jid));
      return ctx.reply(`✅ Cleared warnings for ${targets.map((j) => `@${numberOf(j)}`).join(", ")}`, {
        mentions: targets,
      });
    },
  },

  {
    name: "warnlist",
    category: CATEGORY,
    desc: "Everyone with warnings in this group",
    usage: ".warnlist",
    permission: "admin",
    execute: async (ctx) => {
      const all = await db.raw().all(db.WARNS);
      const limit = Number(await db.get("warnLimit")) || 3;

      const rows = Object.entries(all)
        .filter(([key]) => key.startsWith(`${ctx.chat}:`))
        .map(([key, entry]) => [key.slice(ctx.chat.length + 1), entry])
        .sort((a, b) => b[1].count - a[1].count);

      if (!rows.length) return ctx.reply("✅ Nobody in this group has warnings.");

      const lines = rows.map(([jid, entry], i) => `┃◬│ ${i + 1}. @${numberOf(jid)} — *${entry.count}/${limit}*`);

      return ctx.reply(
        `╭═══〘 *Warnings* 〙═══⊷❍\n${lines.join("\n")}\n╰═════════════════⊷`,
        { mentions: rows.map(([jid]) => jid) }
      );
    },
  },

  {
    name: "setwarnlimit",
    category: CATEGORY,
    desc: "How many warnings before someone is removed",
    usage: ".setwarnlimit 3",
    permission: "admin",
    execute: async (ctx) => {
      const value = Number(ctx.args[0]);
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        const current = await db.get("warnLimit");
        return ctx.reply(
          `Members are removed at *${current}* warnings.\n\n` +
            `${ctx.prefix}setwarnlimit 5   _(anything from 1 to 20)_`
        );
      }
      await db.set("warnLimit", value);
      return ctx.reply(`✅ Members will now be removed at *${value}* warnings.`);
    },
  },

  {
    name: "warnstats",
    category: CATEGORY,
    desc: "Warning totals across every group",
    usage: ".warnstats",
    permission: "admin",
    execute: async (ctx) => {
      const all = await db.raw().all(db.WARNS);
      const entries = Object.entries(all);
      const limit = Number(await db.get("warnLimit")) || 3;

      if (!entries.length) return ctx.reply("No warnings recorded anywhere yet.");

      const groups = new Set(entries.map(([key]) => key.split(":")[0]));
      const total = entries.reduce((sum, [, e]) => sum + (e.count || 0), 0);
      const here = entries.filter(([key]) => key.startsWith(`${ctx.chat}:`));
      const closest = entries.sort((a, b) => b[1].count - a[1].count)[0];

      return ctx.reply(
        `╭═══〘 *Warning stats* 〙═══⊷❍\n` +
          `┃◬│ Warnings given  : ${total}\n` +
          `┃◬│ People warned   : ${entries.length}\n` +
          `┃◬│ Groups involved : ${groups.size}\n` +
          `┃◬│ In this group   : ${here.length}\n` +
          `┃◬│ Limit           : ${limit}\n` +
          `┃◬│ Closest to out  : @${numberOf(closest[0].split(":")[1])} (${closest[1].count}/${limit})\n` +
          `╰═════════════════⊷`,
        { mentions: [closest[0].split(":")[1]] }
      );
    },
  },
];
