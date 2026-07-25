const os = require("os");
const fs = require("fs");
const path = require("path");
const db = require("../../db");
const S = require("../../settings");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");

const CATEGORY = "Settings";

const setting = (name, { key, label, desc, usage, validate, transform, aliases = [] }) => ({
  name,
  aliases,
  category: CATEGORY,
  desc,
  usage,
  permission: "owner",
  execute: async (ctx) => {
    const value = ctx.text.trim();
    if (!value) {
      const current = await db.get(key);
      return ctx.reply(
        `*${label}* is currently: ${current || "_not set_"}\n\n` +
          `To change it:\n${ctx.prefix}${name} <new value>`
      );
    }
    if (validate) {
      const problem = validate(value);
      if (problem) return ctx.reply(`❌ ${problem}`);
    }
    const stored = transform ? transform(value) : value;
    await db.set(key, stored);
    return ctx.reply(`✅ *${label}* set to: ${stored}`);
  },
});

module.exports = [
  setting("setprefix", {
    key: "prefix",
    label: "Prefix",
    desc: "Change the character that starts every command",
    usage: ".setprefix !",
    validate: (v) =>
      v.length > 2 ? "A prefix must be 1 or 2 characters." :
      /\s/.test(v) ? "A prefix can't contain spaces." :
      /[0-9a-z]/i.test(v) ? "Pick a symbol, not a letter or number — otherwise normal words become commands." :
      null,
  }),

  setting("setowner", {
    key: "ownerName",
    label: "Owner name",
    desc: "Set the owner name shown in the menu",
    usage: ".setowner David",
    validate: (v) => (v.length > 40 ? "Keep it under 40 characters." : null),
  }),

  setting("setownernumber", {
    key: "ownerNumber",
    label: "Owner number",
    desc: "Set which number counts as the bot owner",
    usage: ".setownernumber 2348012345678",
    validate: (v) =>
      v.replace(/[^0-9]/g, "").length < 7 ? "That doesn't look like a full number with country code." : null,
    transform: (v) => v.replace(/[^0-9]/g, ""),
  }),

  setting("setname", {
    key: "botName",
    label: "Bot name",
    desc: "Rename the bot in the menu and alive card",
    usage: ".setname David-md",
    validate: (v) => (v.length > 30 ? "Keep it under 30 characters." : null),
  }),

  setting("setstickername", {
    key: "stickerPack",
    label: "Sticker pack name",
    desc: "Name shown on stickers the bot makes",
    usage: ".setstickername My Pack",
    validate: (v) => (v.length > 60 ? "Keep it under 60 characters." : null),
  }),

  setting("setstickerauthor", {
    key: "stickerAuthor",
    label: "Sticker author",
    desc: "Author shown on stickers the bot makes",
    usage: ".setstickerauthor David",
    validate: (v) => (v.length > 60 ? "Keep it under 60 characters." : null),
  }),

  setting("setinfo", {
    key: "info",
    label: "Bot info",
    desc: "Set the description shown by .info",
    usage: ".setinfo A multi-purpose bot",
  }),

  setting("language", {
    key: "language",
    label: "Language",
    desc: "Language code used for text-to-speech",
    usage: ".language en",
    validate: (v) => (!/^[a-z]{2}(-[a-zA-Z]{2})?$/.test(v) ? "Use a code like en, fr, es or pt-BR." : null),
  }),

  {
    name: "mode",
    category: CATEGORY,
    desc: "Switch between private (owner only) and public",
    usage: ".mode public",
    permission: "owner",
    execute: async (ctx) => {
      const wanted = ctx.args[0]?.toLowerCase();
      if (!["private", "public"].includes(wanted)) {
        const current = await db.get("mode");
        return ctx.reply(
          `Mode is *${current}*.\n\n` +
            `_private_ — only you and sudo users can use the bot\n` +
            `_public_ — anyone can\n\n` +
            `${ctx.prefix}mode public   |   ${ctx.prefix}mode private`
        );
      }
      await db.set("mode", wanted);
      return ctx.reply(
        wanted === "public"
          ? "🌍 Public mode — anyone can use the bot now."
          : "🔒 Private mode — only you and sudo users can use the bot."
      );
    },
  },

  {
    name: "antidelete",
    category: CATEGORY,
    desc: "Repost messages that get deleted",
    usage: ".antidelete on | dm | off",
    permission: "owner",
    execute: async (ctx) => {
      const wanted = ctx.args[0]?.toLowerCase();
      if (!["on", "off", "dm"].includes(wanted)) {
        const current = await db.get("antidelete");
        return ctx.reply(
          `Anti-delete is *${current || "off"}*.\n\n` +
            `\`${ctx.prefix}antidelete on\`  — repost in the same chat\n` +
            `\`${ctx.prefix}antidelete dm\`  — send it to you privately instead\n` +
            `\`${ctx.prefix}antidelete off\``
        );
      }
      await db.set("antidelete", wanted === "off" ? false : wanted);
      return ctx.reply(
        wanted === "off"
          ? "✅ Anti-delete off."
          : wanted === "dm"
            ? "✅ Deleted messages will be sent to you privately."
            : "✅ Deleted messages will be reposted in the chat."
      );
    },
  },

  {
    name: "setimage",
    aliases: ["setalivepic"],
    category: CATEGORY,
    desc: "Set the picture shown with .alive",
    usage: "Reply to an image with .setimage",
    permission: "owner",
    execute: async (ctx) => {
      const media = ctx.media();
      if (!media) return ctx.reply(`❌ Reply to an image or video with *${ctx.prefix}setimage*.`);

      const buffer = await downloadMediaMessage(media.raw, "buffer", {});
      const ext = media.type === "videoMessage" ? "mp4" : "jpg";
      const file = path.join(S.MEDIA_DIR, `alive.${ext}`);

      fs.mkdirSync(S.MEDIA_DIR, { recursive: true });
      // Only one alive image can be set, so clear the other format.
      for (const old of ["alive.jpg", "alive.mp4"]) {
        fs.rmSync(path.join(S.MEDIA_DIR, old), { force: true });
      }
      fs.writeFileSync(file, buffer);
      await db.set("aliveMedia", file);

      return ctx.reply(`✅ Saved. It'll show whenever someone runs *${ctx.prefix}alive*.`);
    },
  },

  {
    name: "platform",
    category: CATEGORY,
    desc: "Show what this bot is running on",
    usage: ".platform",
    permission: "public",
    execute: async (ctx) => {
      const where =
        process.env.DYNO ? "Heroku" :
        fs.existsSync("/.dockerenv") ? "Docker" :
        process.env.RAILWAY_ENVIRONMENT ? "Railway" :
        process.env.RENDER ? "Render" :
        process.env.PTERODACTYL_UUID || process.env.P_SERVER_UUID ? "Pterodactyl panel" :
        "VPS / bare metal";

      return ctx.reply(
        `╭═══〘 *Platform* 〙═══⊷❍\n` +
          `┃◬│ Host    : ${where}\n` +
          `┃◬│ OS      : ${os.type()} ${os.release()}\n` +
          `┃◬│ Arch    : ${os.arch()}\n` +
          `┃◬│ CPUs    : ${os.cpus().length}\n` +
          `┃◬│ Node    : ${process.version}\n` +
          `┃◬│ Storage : ${db.raw().constructor.name === "PostgresStore" ? "Postgres" : "Files (data/)"}\n` +
          `╰═════════════════⊷`
      );
    },
  },
];
