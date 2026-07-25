const db = require("../../db");
const font = require("../../lib/font");
const media = require("../../utils/media");
const { tts } = require("../../utils/providers/misc");

const CATEGORY = "Utility";

module.exports = [
  {
    name: "fancy",
    aliases: ["font", "style"],
    category: CATEGORY,
    desc: "Rewrite text in fancy unicode fonts",
    usage: ".fancy 3 Hello world",
    permission: "public",
    execute: async (ctx) => {
      const styles = font.names();
      const first = ctx.args[0];
      const index = Number(first);

      // With no style number, show every option rendered with their text so
      // they can see what each looks like before choosing.
      if (!Number.isInteger(index) || index < 1 || index > styles.length) {
        const sample = ctx.text || ctx.quoted?.text || "David";
        const preview = styles
          .map((style, i) => `${i + 1}. ${font.apply(sample.slice(0, 18), style)}`)
          .join("\n");
        return ctx.reply(
          `*Pick a style*\n\n${preview}\n\n` +
            `Then: ${ctx.prefix}fancy 1 ${sample.slice(0, 18)}`
        );
      }

      const text = ctx.args.slice(1).join(" ") || ctx.quoted?.text;
      if (!text) return ctx.reply(`*Usage:* ${ctx.prefix}fancy ${index} <your text>`);

      return ctx.reply(font.apply(text, styles[index - 1]));
    },
  },

  {
    name: "attp",
    category: CATEGORY,
    desc: "Turn text into a sticker",
    usage: ".attp hello",
    permission: "public",
    execute: async (ctx) => {
      const text = ctx.text || ctx.quoted?.text;
      if (!text) return ctx.reply(`*Usage:* ${ctx.prefix}attp <text>`);
      if (text.length > 60) return ctx.reply("❌ Keep it under 60 characters or it won't be readable.");

      const webp = await media.textToSticker(text);
      const { writeStickerMetadata } = require("../../utils/exif");
      const sticker = await writeStickerMetadata(webp, {
        pack: await db.get("stickerPack"),
        author: await db.get("stickerAuthor"),
      });

      return ctx.reply({ sticker });
    },
  },

  {
    name: "tts",
    aliases: ["say", "voice"],
    category: CATEGORY,
    desc: "Read text out loud as a voice note",
    usage: ".tts hello there  |  .tts fr bonjour",
    permission: "public",
    execute: async (ctx) => {
      let lang = await db.get("language");
      let text = ctx.text || ctx.quoted?.text || "";

      // An explicit two-letter first word is treated as a language override.
      const maybeLang = ctx.args[0];
      if (maybeLang && /^[a-z]{2}$/i.test(maybeLang) && ctx.args.length > 1) {
        lang = maybeLang.toLowerCase();
        text = ctx.args.slice(1).join(" ");
      }

      if (!text.trim()) {
        return ctx.reply(
          `*Usage:* ${ctx.prefix}tts <text>\n\n` +
            `Another language:\n${ctx.prefix}tts fr bonjour tout le monde`
        );
      }

      const audio = await tts(text, lang);
      return ctx.reply({ audio, mimetype: "audio/mpeg", ptt: true });
    },
  },
];
