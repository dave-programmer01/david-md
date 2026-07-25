const db = require("../../db");

const CATEGORY = "Group";

/** Per-group on/off switch with an optional action mode (warn | kick | delete). */
function groupToggle({ name, key, label, desc, actionKey, extra }) {
  return {
    name,
    category: CATEGORY,
    desc,
    usage: actionKey ? `.${name} on | off | kick | warn | delete` : `.${name} on | off`,
    permission: "admin",
    execute: async (ctx) => {
      const arg = ctx.args[0]?.toLowerCase();
      const g = await ctx.groupSettings();

      if (!arg) {
        return ctx.reply(
          `*${label}* is ${g[key] ? "on ✅" : "off ❌"}` +
            (actionKey && g[key] ? `\nAction: *${g[actionKey] || "warn"}*` : "") +
            `\n\n${ctx.prefix}${name} on   |   ${ctx.prefix}${name} off` +
            (actionKey ? `\n${ctx.prefix}${name} kick   |   ${ctx.prefix}${name} delete` : "") +
            (extra ? `\n\n${extra(ctx)}` : "")
        );
      }

      if (arg === "off") {
        await ctx.setGroupSetting(key, false);
        return ctx.reply(`❌ ${label} off for this group.`);
      }

      if (arg === "on") {
        await ctx.setGroupSetting(key, true);
        if (!ctx.isBotAdmin) {
          return ctx.reply(`✅ ${label} on — but *make me an admin* or I won't be able to act on it.`);
        }
        return ctx.reply(`✅ ${label} on.`);
      }

      if (actionKey && ["warn", "kick", "delete"].includes(arg)) {
        await ctx.setGroupSetting(key, true);
        await ctx.setGroupSetting(actionKey, arg);
        return ctx.reply(
          `✅ ${label} on — offenders will be *${arg === "delete" ? "have the message deleted" : arg + "ed"}*.`
        );
      }

      return ctx.reply(`Use: ${ctx.prefix}${name} on | off${actionKey ? " | warn | kick | delete" : ""}`);
    },
  };
}

module.exports = [
  groupToggle({
    name: "antilink",
    key: "antilink",
    actionKey: "antilinkAction",
    label: "Anti-link",
    desc: "Act on WhatsApp group invite links",
  }),

  groupToggle({
    name: "antibot",
    key: "antibot",
    label: "Anti-bot",
    desc: "Remove other bots from the group",
  }),

  groupToggle({
    name: "antispam",
    key: "antispam",
    actionKey: "antispamAction",
    label: "Anti-spam",
    desc: "Act on people sending messages too fast",
  }),

  groupToggle({
    name: "antipromote",
    key: "antipromote",
    label: "Anti-promote",
    desc: "Undo promotions I didn't make",
  }),

  groupToggle({
    name: "antidemote",
    key: "antidemote",
    label: "Anti-demote",
    desc: "Undo demotions I didn't make",
  }),

  groupToggle({
    name: "pdm",
    key: "pdm",
    label: "Promote/demote alerts",
    desc: "Announce when someone is promoted or demoted",
  }),

  {
    name: "antiword",
    category: CATEGORY,
    desc: "Block specific words in this group",
    usage: ".antiword add <word> | .antiword del <word> | .antiword list | .antiword off",
    permission: "admin",
    execute: async (ctx) => {
      const action = ctx.args[0]?.toLowerCase();
      const word = ctx.args.slice(1).join(" ").trim().toLowerCase();
      const g = await ctx.groupSettings();
      const words = g.antiwords || [];

      if (action === "add") {
        if (!word) return ctx.reply(`*Usage:* ${ctx.prefix}antiword add <word>`);
        if (words.includes(word)) return ctx.reply(`*${word}* is already blocked.`);
        await ctx.setGroupSetting("antiwords", [...words, word]);
        await ctx.setGroupSetting("antiword", true);
        return ctx.reply(`✅ *${word}* is now blocked. ${words.length + 1} word(s) on the list.`);
      }

      if (["del", "delete", "remove"].includes(action)) {
        if (!words.includes(word)) return ctx.reply(`*${word}* isn't on the list.`);
        await ctx.setGroupSetting("antiwords", words.filter((w) => w !== word));
        return ctx.reply(`✅ *${word}* removed.`);
      }

      if (action === "list") {
        if (!words.length) return ctx.reply("No blocked words yet.");
        return ctx.reply(
          `*Blocked words* (${words.length})\n\n${words.map((w, i) => `${i + 1}. ${w}`).join("\n")}`
        );
      }

      if (action === "off") {
        await ctx.setGroupSetting("antiword", false);
        return ctx.reply("❌ Anti-word off. Your word list is kept.");
      }

      if (action === "on") {
        if (!words.length) return ctx.reply(`Add a word first:\n${ctx.prefix}antiword add <word>`);
        await ctx.setGroupSetting("antiword", true);
        return ctx.reply(`✅ Anti-word on — ${words.length} word(s) blocked.`);
      }

      return ctx.reply(
        `*Anti-word* is ${g.antiword ? "on ✅" : "off ❌"} (${words.length} word(s))\n\n` +
          `${ctx.prefix}antiword add <word>\n` +
          `${ctx.prefix}antiword del <word>\n` +
          `${ctx.prefix}antiword list\n` +
          `${ctx.prefix}antiword on | off`
      );
    },
  },

  {
    name: "antifake",
    category: CATEGORY,
    desc: "Only allow numbers with certain country codes",
    usage: ".antifake add 234 | .antifake list | .antifake off",
    permission: "admin",
    execute: async (ctx) => {
      const action = ctx.args[0]?.toLowerCase();
      const code = (ctx.args[1] || "").replace(/[^0-9]/g, "");
      const g = await ctx.groupSettings();
      const allowed = g.antifakePrefixes || [];

      if (action === "add") {
        if (!code) return ctx.reply(`*Usage:* ${ctx.prefix}antifake add 234\n\n_234 is Nigeria, 1 is US/Canada…_`);
        if (allowed.includes(code)) return ctx.reply(`+${code} is already allowed.`);
        await ctx.setGroupSetting("antifakePrefixes", [...allowed, code]);
        await ctx.setGroupSetting("antifake", true);
        return ctx.reply(`✅ +${code} allowed. Anyone joining with another country code gets removed.`);
      }

      if (["del", "remove"].includes(action)) {
        await ctx.setGroupSetting("antifakePrefixes", allowed.filter((c) => c !== code));
        return ctx.reply(`✅ +${code} removed from the allow-list.`);
      }

      if (action === "off") {
        await ctx.setGroupSetting("antifake", false);
        return ctx.reply("❌ Anti-fake off.");
      }

      if (action === "list" || !action) {
        return ctx.reply(
          `*Anti-fake* is ${g.antifake ? "on ✅" : "off ❌"}\n\n` +
            `Allowed country codes: ${allowed.length ? allowed.map((c) => `+${c}`).join(", ") : "_none set_"}\n\n` +
            `${ctx.prefix}antifake add 234\n${ctx.prefix}antifake del 234\n${ctx.prefix}antifake off`
        );
      }

      return ctx.reply(`Use: ${ctx.prefix}antifake add | del | list | off`);
    },
  },

  {
    name: "toggle",
    category: CATEGORY,
    desc: "See and flip every protection in this group at once",
    usage: ".toggle | .toggle antilink",
    permission: "admin",
    execute: async (ctx) => {
      const FLAGS = [
        ["antilink", "Anti-link"], ["antiword", "Anti-word"], ["antispam", "Anti-spam"],
        ["antibot", "Anti-bot"], ["antifake", "Anti-fake"], ["antipromote", "Anti-promote"],
        ["antidemote", "Anti-demote"], ["pdm", "Promote alerts"], ["welcome", "Welcome"],
        ["goodbye", "Goodbye"], ["events", "Group events"],
      ];

      const wanted = ctx.args[0]?.toLowerCase();
      const g = await ctx.groupSettings();

      if (wanted) {
        const entry = FLAGS.find(([key]) => key === wanted);
        if (!entry) {
          return ctx.reply(`❌ Unknown setting. Try one of:\n${FLAGS.map(([k]) => k).join(", ")}`);
        }
        const next = !g[entry[0]];
        await ctx.setGroupSetting(entry[0], next);
        return ctx.reply(`${next ? "✅" : "❌"} ${entry[1]} is now *${next ? "on" : "off"}*.`);
      }

      const lines = FLAGS.map(([key, label]) => `┃◬│ ${g[key] ? "✅" : "❌"} ${label}`);
      return ctx.reply(
        `╭═══〘 *Group settings* 〙═══⊷❍\n${lines.join("\n")}\n╰═════════════════⊷\n\n` +
          `_Flip one:_ ${ctx.prefix}toggle antilink` +
          (ctx.isBotAdmin ? "" : "\n\n⚠️ I'm not an admin here, so I can't enforce most of these.")
      );
    },
  },
];
