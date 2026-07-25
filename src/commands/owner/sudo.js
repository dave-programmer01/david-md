const db = require("../../db");
const { numberOf } = require("../../lib/ctx");

const CATEGORY = "Owner";

module.exports = [
  {
    name: "setsudo",
    aliases: ["addsudo"],
    category: CATEGORY,
    desc: "Let someone else use owner commands",
    usage: ".setsudo @user",
    permission: "owner",
    execute: async (ctx) => {
      const targets = ctx.targets();
      if (!targets.length) {
        return ctx.reply(
          `Reply to someone, mention them, or give a number:\n` +
            `${ctx.prefix}setsudo @user\n${ctx.prefix}setsudo 2348012345678\n\n` +
            `_Sudo users can run every command except the owner-only ones that change config.js._`
        );
      }
      const added = [];
      for (const jid of targets) {
        await db.raw().set(db.SUDO, jid, { since: Date.now(), by: ctx.sender });
        added.push(numberOf(jid));
      }
      return ctx.reply(`✅ Sudo granted to: ${added.map((n) => `@${n}`).join(", ")}`, { mentions: targets });
    },
  },

  {
    name: "getsudo",
    aliases: ["listsudo", "sudolist"],
    category: CATEGORY,
    desc: "List everyone with sudo access",
    usage: ".getsudo",
    permission: "owner",
    execute: async (ctx) => {
      const all = await db.raw().all(db.SUDO);
      const jids = Object.keys(all);
      const owner = await db.get("ownerNumber");

      if (!jids.length) {
        return ctx.reply(
          `No sudo users.\n\nOwner: ${owner ? `@${owner}` : "not set"}\n\n` +
            `_Add one with_ ${ctx.prefix}setsudo @user`,
          { mentions: owner ? [`${owner}@s.whatsapp.net`] : [] }
        );
      }

      const lines = jids.map((jid, i) => {
        const when = all[jid]?.since ? new Date(all[jid].since).toLocaleDateString() : "";
        return `┃◬│ ${i + 1}. @${numberOf(jid)}${when ? `  _(${when})_` : ""}`;
      });

      return ctx.reply(
        `╭═══〘 *Sudo users* 〙═══⊷❍\n` +
          `┃◬│ Owner: @${owner || "not set"}\n┃◬│\n` +
          lines.join("\n") +
          `\n╰═════════════════⊷`,
        { mentions: [...jids, ...(owner ? [`${owner}@s.whatsapp.net`] : [])] }
      );
    },
  },

  {
    name: "callreject",
    aliases: ["anticall"],
    category: CATEGORY,
    desc: "Automatically decline incoming calls",
    usage: ".callreject on | off",
    permission: "owner",
    execute: async (ctx) => {
      const wanted = ctx.args[0]?.toLowerCase();
      if (!["on", "off"].includes(wanted)) {
        const current = await db.get("rejectCalls");
        return ctx.reply(
          `Call rejection is ${current ? "on ✅" : "off ❌"}\n\n` +
            `${ctx.prefix}callreject on   |   ${ctx.prefix}callreject off`
        );
      }
      await db.set("rejectCalls", wanted === "on");
      return ctx.reply(
        wanted === "on"
          ? "📵 I'll decline calls and tell the caller to message instead."
          : "📞 Calls will ring through normally."
      );
    },
  },
];
