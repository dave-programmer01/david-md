const media = require("../../utils/media");

const CATEGORY = "General";

/** Shared shape for "take the replied-to media, transform it, send it back". */
function mediaCommand({ name, aliases = [], category, desc, usage, accepts, handler }) {
  return {
    name,
    aliases,
    category,
    desc,
    usage,
    permission: "public",
    execute: async (ctx) => {
      const target = ctx.media();
      if (!target) {
        return ctx.reply(`❌ Send or reply to ${accepts || "media"} with *${ctx.prefix}${name}*.\n\n_${usage}_`);
      }
      const buffer = await ctx.download(target.raw);
      if (!buffer) return ctx.reply("❌ I couldn't download that — try re-sending it.");
      const result = await handler(ctx, buffer, target);
      if (result) await ctx.reply(result);
    },
  };
}

module.exports = [
  mediaCommand({
    name: "gif",
    category: CATEGORY,
    desc: "Turn a video or sticker into a GIF",
    usage: "Reply to a video with .gif",
    accepts: "a video or animated sticker",
    handler: async (ctx, buffer, target) => {
      const ext = target.type === "stickerMessage" ? "webp" : "mp4";
      const gif = await media.toGif(buffer, ext);
      // WhatsApp has no real GIF type — an mp4 with gifPlayback is how GIFs
      // are actually sent, so convert back for delivery.
      const mp4 = await media.toMp4(gif, "gif");
      return { video: mp4, gifPlayback: true, caption: "🎞️ Here's your GIF" };
    },
  }),

  mediaCommand({
    name: "rotate",
    category: CATEGORY,
    desc: "Rotate an image",
    usage: ".rotate 90  (90, 180 or 270)",
    accepts: "an image",
    handler: async (ctx, buffer) => {
      const degrees = Number(ctx.args[0]) || 90;
      return { image: await media.rotate(buffer, degrees), caption: `🔄 Rotated ${degrees}°` };
    },
  }),

  mediaCommand({
    name: "flip",
    category: CATEGORY,
    desc: "Mirror an image",
    usage: ".flip h  (horizontal) or .flip v (vertical)",
    accepts: "an image",
    handler: async (ctx, buffer) => {
      const direction = ctx.args[0]?.toLowerCase().startsWith("v") ? "v" : "h";
      return {
        image: await media.flip(buffer, direction),
        caption: direction === "v" ? "🔃 Flipped vertically" : "🔄 Flipped horizontally",
      };
    },
  }),
];

module.exports.mediaCommand = mediaCommand;
