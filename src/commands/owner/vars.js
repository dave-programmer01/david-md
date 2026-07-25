const S = require("../../settings");
const db = require("../../db");
const registry = require("../../lib/registry");

const CATEGORY = "Owner";
const { mask, EDITABLE } = require("../general/vars").helpers;

module.exports = [
  {
    name: "allvar",
    category: CATEGORY,
    desc: "Show every setting from config.js",
    usage: ".allvar",
    permission: "owner",
    execute: async (ctx) => {
      const keys = [
        "SESSION_ID", "OWNER_NUMBER", "OWNER_NAME", "BOT_NAME", "PREFIX", "MODE",
        "REJECT_CALLS", "ALWAYS_ONLINE", "AUTO_REACT",
        "STICKER_PACK", "STICKER_AUTHOR", "ANTHROPIC_API_KEY", "DATABASE_URL",
      ];

      const lines = keys.map((key) => {
        const editable = EDITABLE.has(key) ? "" : "  🔒";
        return `┃◬│ *${key}*${editable}\n┃◬│   ${mask(key, S[key])}`;
      });

      return ctx.reply(
        `╭═══〘 *config.js* 〙═══⊷❍\n` +
          lines.join("\n┃◬│\n") +
          `\n╰═════════════════⊷\n\n` +
          `🔒 = can only be changed by editing the file\n` +
          `_Change one with_ ${ctx.prefix}setvar KEY=value`
      );
    },
  },

  {
    name: "settings",
    category: CATEGORY,
    desc: "Show every runtime setting and toggle",
    usage: ".settings",
    permission: "owner",
    execute: async (ctx) => {
      const all = await db.all();
      const flag = (v) => (v ? "on ✅" : "off ❌");

      const lines = [
        `┃◬│ Prefix          : ${all.prefix}`,
        `┃◬│ Mode            : ${all.mode}`,
        `┃◬│ Bot name        : ${all.botName}`,
        `┃◬│ Owner           : ${all.ownerName} (${all.ownerNumber || "not set"})`,
        `┃◬│ Language        : ${all.language}`,
        `┃◬│`,
        `┃◬│ Auto react      : ${flag(all.autoReact)}`,
        `┃◬│ Always online   : ${flag(all.alwaysOnline)}`,
        `┃◬│ Reject calls    : ${flag(all.rejectCalls)}`,
        `┃◬│ Anti-delete     : ${all.antidelete || "off ❌"}`,
        `┃◬│ Auto-download   : ${flag(all.autodl)}`,
        `┃◬│ Chatbot         : ${flag(all.chatbot)}`,
        `┃◬│`,
        `┃◬│ Sticker pack    : ${all.stickerPack}`,
        `┃◬│ Sticker author  : ${all.stickerAuthor}`,
        `┃◬│ Warn limit      : ${all.warnLimit}`,
        `┃◬│ Alive message   : ${all.aliveText ? "custom" : "default"}`,
        `┃◬│ Alive media     : ${all.aliveMedia ? "set" : "none"}`,
        `┃◬│`,
        `┃◬│ Commands loaded : ${registry.size}`,
        `┃◬│ Storage         : ${S.DATABASE_URL ? "Postgres" : "Files (data/)"}`,
      ];

      if (ctx.isGroup) {
        const g = await ctx.groupSettings();
        lines.push(
          `┃◬│`,
          `┃◬│ *This group*`,
          `┃◬│ Welcome         : ${flag(g.welcome)}`,
          `┃◬│ Goodbye         : ${flag(g.goodbye)}`,
          `┃◬│ Anti-link       : ${flag(g.antilink)}`,
          `┃◬│ Anti-word       : ${flag(g.antiword)}`,
          `┃◬│ Anti-spam       : ${flag(g.antispam)}`,
          `┃◬│ Anti-bot        : ${flag(g.antibot)}`
        );
      }

      return ctx.reply(
        `╭═══〘 *Settings* 〙═══⊷❍\n${lines.join("\n")}\n╰═════════════════⊷`
      );
    },
  },
];
