const db = require("../../db");
const store = require("../../store");
const media = require("../../utils/media");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");

module.exports = {
  name: "sticker",
  aliases: ["s", "stick"],
  category: "Edit",
  desc: "Turn an image or short video into a sticker",
  usage: "Send an image captioned .sticker, or reply to one",
  permission: "public",
  execute: async (ctx) => {
    // Photos in an album arrive *after* the caption, so a short window is kept
    // open to catch the ones that land right behind this command.
    store.activeStickerRequests.set(ctx.chat, Date.now() + 5000);

    const queue = [];

    // The message itself, if it carries media.
    if (ctx.m.isMedia) queue.push(ctx.m.raw);

    // The message being replied to.
    if (ctx.quoted?.isMedia) queue.push(ctx.quoted.raw);

    // Anything sent in the seconds just before the command.
    if (!ctx.quoted?.isMedia) {
      const recent = (store.recentImages.get(ctx.chat) || [])
        .filter((entry) => Date.now() - entry.time < 10_000)
        .map((entry) => entry.m.raw)
        .filter((raw) => raw.key.id !== ctx.m.key.id);
      queue.push(...recent);
      store.recentImages.delete(ctx.chat);
    }

    if (!queue.length) {
      return ctx.reply(
        `❌ Send an image or video captioned *${ctx.prefix}sticker*, or reply to one.\n\n` +
          `_Videos need to be 10 seconds or shorter._`
      );
    }

    const [pack, author] = await Promise.all([db.get("stickerPack"), db.get("stickerAuthor")]);

    if (queue.length > 1) await ctx.reply(`⏳ Converting ${queue.length} item(s)…`);

    let sent = 0;
    const problems = [];

    for (const raw of queue) {
      const video = raw.message?.videoMessage;
      if (video && video.seconds > 10) {
        problems.push(`A ${video.seconds}s video was skipped — the limit is 10 seconds.`);
        continue;
      }

      try {
        const buffer = await downloadMediaMessage(raw, "buffer", {});
        const sticker = await media.convertMediaToSticker(buffer, !!video, { pack, author });
        await ctx.send(ctx.chat, { sticker });
        sent += 1;
      } catch (err) {
        problems.push(err.message);
      }
    }

    if (!sent) {
      return ctx.reply(`❌ Couldn't make a sticker.\n${problems.join("\n")}`);
    }
    if (problems.length) {
      return ctx.reply(`⚠️ ${sent} made, ${problems.length} skipped:\n${problems.join("\n")}`);
    }
  },
};
