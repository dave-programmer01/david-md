const fs = require("fs");
const path = require("path");
const db = require("../../db");
const S = require("../../settings");
const menu = require("../../lib/menu");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");

const CATEGORY = "General";

/**
 * Build the alive message. If the owner set custom text and/or media with
 * `.setalive`, that is used; otherwise the default status card.
 * The uptime block is always appended so the reply is genuinely informative.
 */
async function buildAlive(ctx) {
  const [customText, mediaPath] = await Promise.all([db.get("aliveText"), db.get("aliveMedia")]);
  const body = customText ? `${customText}\n\n${await menu.renderAlive(ctx)}` : await menu.renderAlive(ctx);

  if (mediaPath && fs.existsSync(mediaPath)) {
    const buffer = fs.readFileSync(mediaPath);
    const isVideo = /\.(mp4|mov|webm)$/i.test(mediaPath);
    return isVideo
      ? { video: buffer, caption: body, gifPlayback: true }
      : { image: buffer, caption: body };
  }

  return { text: body };
}

module.exports = [
  {
    name: "alive",
    aliases: ["status"],
    category: CATEGORY,
    desc: "Check the bot is running",
    usage: ".alive",
    permission: "public",
    execute: async (ctx) => ctx.reply(await buildAlive(ctx)),
  },

  {
    name: "setalive",
    category: CATEGORY,
    desc: "Set your own alive message, with an optional image or video",
    usage: ".setalive I'm up and running | reply to media with .setalive <text>",
    permission: "owner",
    execute: async (ctx) => {
      const media = ctx.media();
      const text = ctx.text.trim();

      if (!media && !text) {
        const [currentText, currentMedia] = await Promise.all([db.get("aliveText"), db.get("aliveMedia")]);
        return ctx.reply(
          `*Your alive message*\n\n` +
            `Text  : ${currentText || "_default_"}\n` +
            `Media : ${currentMedia && fs.existsSync(currentMedia) ? path.basename(currentMedia) : "_none_"}\n\n` +
            `*Set text:*\n${ctx.prefix}setalive Hello, I'm online\n\n` +
            `*Set text + picture:*\nSend or reply to an image with\n${ctx.prefix}setalive Hello, I'm online\n\n` +
            `*Reset to default:*\n${ctx.prefix}setalive reset`
        );
      }

      if (text.toLowerCase() === "reset") {
        const old = await db.get("aliveMedia");
        if (old) fs.rmSync(old, { force: true });
        await db.set("aliveText", "");
        await db.set("aliveMedia", "");
        return ctx.reply("✅ Back to the default alive message.");
      }

      if (media) {
        if (!["imageMessage", "videoMessage"].includes(media.type)) {
          return ctx.reply("❌ That needs to be an image or a video.");
        }
        const buffer = await downloadMediaMessage(media.raw, "buffer", {});
        const ext = media.type === "videoMessage" ? "mp4" : "jpg";
        const file = path.join(S.MEDIA_DIR, `alive.${ext}`);

        fs.mkdirSync(S.MEDIA_DIR, { recursive: true });
        for (const old of ["alive.jpg", "alive.mp4"]) {
          fs.rmSync(path.join(S.MEDIA_DIR, old), { force: true });
        }
        fs.writeFileSync(file, buffer);
        await db.set("aliveMedia", file);
      }

      if (text) await db.set("aliveText", text);

      return ctx.reply(
        `✅ Saved.\n\n` +
          `${text ? `Text: _${text}_\n` : ""}` +
          `${media ? `Media: ${media.type === "videoMessage" ? "video" : "image"}\n` : ""}` +
          `\nTry it: ${ctx.prefix}alive`
      );
    },
  },
];

module.exports.buildAlive = buildAlive;
