const media = require("../../utils/media");
const { mediaCommand } = require("../general/media");

const CATEGORY = "Edit";
const isVideo = (target) => target.type === "videoMessage";

module.exports = [
  mediaCommand({
    name: "photo",
    aliases: ["toimg", "topic"],
    category: CATEGORY,
    desc: "Turn a sticker back into a picture",
    usage: "Reply to a sticker with .photo",
    accepts: "a sticker",
    handler: async (ctx, buffer, target) => {
      if (target.type !== "stickerMessage") return { text: "❌ Reply to a *sticker*." };
      return { image: await media.stickerToImage(buffer), caption: "🖼️ Here you go" };
    },
  }),

  mediaCommand({
    name: "circle",
    category: CATEGORY,
    desc: "Crop an image into a circle",
    usage: "Reply to an image with .circle",
    accepts: "an image",
    handler: async (ctx, buffer) => ({
      image: await media.circle(buffer),
      caption: "⭕ Cropped",
    }),
  }),

  mediaCommand({
    name: "square",
    category: CATEGORY,
    desc: "Pad an image or video into a square",
    usage: "Reply to an image or video with .square",
    accepts: "an image or video",
    handler: async (ctx, buffer, target) => {
      const out = await media.square(buffer, isVideo(target));
      return isVideo(target)
        ? { video: out, caption: "⬜ Squared" }
        : { image: out, caption: "⬜ Squared" };
    },
  }),

  mediaCommand({
    name: "resize",
    category: CATEGORY,
    desc: "Resize an image or video",
    usage: ".resize 512 512",
    accepts: "an image or video",
    handler: async (ctx, buffer, target) => {
      const width = Number(ctx.args[0]);
      const height = Number(ctx.args[1]) || width;

      if (!width || width < 16 || width > 4096) {
        return {
          text:
            `*Usage:* ${ctx.prefix}resize <width> [height]\n\n` +
            `${ctx.prefix}resize 512      _(square)_\n` +
            `${ctx.prefix}resize 1280 720 _(widescreen)_`,
        };
      }

      const out = await media.resize(buffer, width, height, isVideo(target));
      const caption = `📐 Resized to ${width}×${height}`;
      return isVideo(target) ? { video: out, caption } : { image: out, caption };
    },
  }),

  mediaCommand({
    name: "compress",
    category: CATEGORY,
    desc: "Shrink a file's size",
    usage: "Reply with .compress  |  .compress 20  (lower = smaller)",
    accepts: "an image or video",
    handler: async (ctx, buffer, target) => {
      const quality = Number(ctx.args[0]) || 40;
      const out = await media.compress(buffer, isVideo(target), quality);
      const saved = Math.max(0, Math.round((1 - out.length / buffer.length) * 100));
      const caption = `🗜️ ${(buffer.length / 1024).toFixed(0)} KB → ${(out.length / 1024).toFixed(0)} KB (${saved}% smaller)`;
      return isVideo(target) ? { video: out, caption } : { image: out, caption };
    },
  }),

  mediaCommand({
    name: "black",
    aliases: ["bw", "grayscale"],
    category: CATEGORY,
    desc: "Make an image or video black and white",
    usage: "Reply to an image or video with .black",
    accepts: "an image or video",
    handler: async (ctx, buffer, target) => {
      const out = await media.grayscale(buffer, isVideo(target));
      const caption = "⚫ Black and white";
      return isVideo(target) ? { video: out, caption } : { image: out, caption };
    },
  }),
];
