const db = require("../../db");

const CATEGORY = "Utility";

const readAll = async (chat) => (await db.raw().get(db.FILTERS, chat, null)) || {};
const writeAll = (chat, value) => db.raw().set(db.FILTERS, chat, value);

module.exports = [
  {
    name: "filter",
    aliases: ["addfilter"],
    category: CATEGORY,
    desc: "Auto-reply whenever someone says a keyword",
    usage: ".filter hello : Hi there!",
    permission: "admin",
    execute: async (ctx) => {
      const raw = ctx.text;
      // "keyword : response" — colon rather than a space so multi-word
      // keywords work ("good morning : Morning!").
      const split = raw.indexOf(":");
      if (split < 1) {
        return ctx.reply(
          `*Usage:* ${ctx.prefix}filter <keyword> : <reply>\n\n` +
            `*Example*\n${ctx.prefix}filter good morning : Morning everyone ☀️\n\n` +
            `_Add_ \`!\` _before the keyword for an exact match:_\n` +
            `${ctx.prefix}filter !ping : pong\n\n` +
            `See them all: ${ctx.prefix}filters`
        );
      }

      let keyword = raw.slice(0, split).trim().toLowerCase();
      const response = raw.slice(split + 1).trim();
      const exact = keyword.startsWith("!");
      if (exact) keyword = keyword.slice(1).trim();

      if (!keyword) return ctx.reply("❌ The keyword can't be empty.");
      if (!response) return ctx.reply("❌ The reply can't be empty.");
      if (keyword.length > 80) return ctx.reply("❌ Keep keywords under 80 characters.");

      const all = await readAll(ctx.chat);
      const existed = !!all[keyword];
      all[keyword] = { response, exact, on: true, by: ctx.sender, at: Date.now() };
      await writeAll(ctx.chat, all);

      return ctx.reply(
        `${existed ? "♻️ Updated" : "✅ Added"} filter\n\n` +
          `Trigger : *${keyword}* ${exact ? "_(exact match)_" : "_(anywhere in a message)_"}\n` +
          `Reply   : ${response}`
      );
    },
  },

  {
    name: "filters",
    aliases: ["listfilters"],
    category: CATEGORY,
    desc: "Every auto-reply in this chat",
    usage: ".filters",
    permission: "group",
    execute: async (ctx) => {
      const all = await readAll(ctx.chat);
      const entries = Object.entries(all);

      if (!entries.length) {
        return ctx.reply(`No filters here yet.\n\nAdd one:\n${ctx.prefix}filter hello : Hi there!`);
      }

      const lines = entries.map(([keyword, f], i) => {
        const state = f.on === false ? "⏸️" : "▶️";
        const mode = f.exact ? " _(exact)_" : "";
        return `┃◬│ ${i + 1}. ${state} *${keyword}*${mode}\n┃◬│    ↳ ${String(f.response).slice(0, 60)}`;
      });

      return ctx.reply(
        `╭═══〘 *Filters* (${entries.length}) 〙═══⊷❍\n${lines.join("\n┃◬│\n")}\n╰═════════════════⊷`
      );
    },
  },

  {
    name: "delfilter",
    aliases: ["rmfilter"],
    category: CATEGORY,
    desc: "Delete an auto-reply",
    usage: ".delfilter hello  |  .delfilter all",
    permission: "admin",
    execute: async (ctx) => {
      const keyword = ctx.text.trim().toLowerCase();
      if (!keyword) return ctx.reply(`*Usage:* ${ctx.prefix}delfilter <keyword>`);

      if (keyword === "all") {
        const all = await readAll(ctx.chat);
        const count = Object.keys(all).length;
        await writeAll(ctx.chat, {});
        return ctx.reply(`🧹 Deleted all ${count} filter(s) in this chat.`);
      }

      const all = await readAll(ctx.chat);
      if (!all[keyword]) {
        return ctx.reply(`❌ No filter for *${keyword}*.\n\nSee them: ${ctx.prefix}filters`);
      }

      delete all[keyword];
      await writeAll(ctx.chat, all);
      return ctx.reply(`🗑️ Deleted the *${keyword}* filter.`);
    },
  },

  {
    name: "togglefilter",
    category: CATEGORY,
    desc: "Pause or resume one filter without deleting it",
    usage: ".togglefilter hello",
    permission: "admin",
    execute: async (ctx) => {
      const keyword = ctx.text.trim().toLowerCase();
      if (!keyword) return ctx.reply(`*Usage:* ${ctx.prefix}togglefilter <keyword>`);

      const all = await readAll(ctx.chat);
      if (!all[keyword]) return ctx.reply(`❌ No filter for *${keyword}*.`);

      all[keyword].on = all[keyword].on === false;
      await writeAll(ctx.chat, all);

      return ctx.reply(
        `${all[keyword].on ? "▶️ Resumed" : "⏸️ Paused"} the *${keyword}* filter.`
      );
    },
  },

  {
    name: "testfilter",
    category: CATEGORY,
    desc: "See which filter a message would trigger",
    usage: ".testfilter good morning everyone",
    permission: "admin",
    execute: async (ctx) => {
      const sample = ctx.text || ctx.quoted?.text;
      if (!sample) return ctx.reply(`*Usage:* ${ctx.prefix}testfilter <some message>`);

      const all = await readAll(ctx.chat);
      const lower = sample.toLowerCase();

      const hit = Object.entries(all).find(([keyword, f]) => {
        if (f.on === false) return false;
        return f.exact ? lower === keyword : lower.includes(keyword);
      });

      if (!hit) return ctx.reply(`❌ *"${sample}"* wouldn't trigger any filter.`);

      return ctx.reply(
        `✅ It would trigger *${hit[0]}*${hit[1].exact ? " _(exact)_" : ""}\n\n` +
          `The bot would reply:\n${hit[1].response}`
      );
    },
  },

  {
    name: "filterhelp",
    category: CATEGORY,
    desc: "How auto-replies work",
    usage: ".filterhelp",
    permission: "public",
    execute: async (ctx) =>
      ctx.reply(
        `╭═══〘 *Filters* 〙═══⊷❍\n` +
          `┃◬│ A filter makes me reply automatically\n` +
          `┃◬│ whenever someone says a keyword.\n` +
          `┃◬│\n` +
          `┃◬│ *Add one*\n` +
          `┃◬│ ${ctx.prefix}filter hello : Hi there!\n` +
          `┃◬│\n` +
          `┃◬│ *Exact match only*\n` +
          `┃◬│ ${ctx.prefix}filter !ping : pong\n` +
          `┃◬│ _Without_ \`!\`_, the keyword can appear_\n` +
          `┃◬│ _anywhere in a message._\n` +
          `┃◬│\n` +
          `┃◬│ *Manage*\n` +
          `┃◬│ ${ctx.prefix}filters — list them\n` +
          `┃◬│ ${ctx.prefix}testfilter <text> — try it out\n` +
          `┃◬│ ${ctx.prefix}togglefilter <word> — pause it\n` +
          `┃◬│ ${ctx.prefix}delfilter <word> — delete it\n` +
          `┃◬│\n` +
          `┃◬│ Filters are per-chat and admin-only.\n` +
          `╰═════════════════⊷`
      ),
  },
];
