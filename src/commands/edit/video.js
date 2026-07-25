const media = require("../../utils/media");
const { mediaCommand } = require("../general/media");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");

const CATEGORY = "Edit";

/**
 * Commands that need TWO pieces of media: the one you reply to and the one you
 * send with the command. WhatsApp gives no way to attach two files at once, so
 * the pattern is always "send B while replying to A".
 */
function pairCommand({ name, aliases = [], desc, usage, hint, combine }) {
  return {
    name,
    aliases,
    category: CATEGORY,
    desc,
    usage,
    permission: "public",
    execute: async (ctx) => {
      if (!ctx.m.isMedia || !ctx.quoted?.isMedia) {
        return ctx.reply(`❌ ${hint}\n\n_${usage}_`);
      }
      const [second, first] = await Promise.all([
        downloadMediaMessage(ctx.m.raw, "buffer", {}),
        downloadMediaMessage(ctx.quoted.raw, "buffer", {}),
      ]);
      return ctx.reply(await combine(ctx, first, second));
    },
  };
}

module.exports = [
  mediaCommand({
    name: "trim",
    aliases: ["cut"],
    category: CATEGORY,
    desc: "Cut a section out of a video or audio file",
    usage: ".trim 00:00:10 00:00:25",
    accepts: "a video or audio file",
    handler: async (ctx, buffer, target) => {
      const [start, end] = ctx.args;
      if (!start) {
        return {
          text:
            `*Usage:* ${ctx.prefix}trim <start> [end]\n\n` +
            `${ctx.prefix}trim 00:00:10 00:00:25\n` +
            `${ctx.prefix}trim 10 25   _(seconds also work)_`,
        };
      }
      const isAudio = target.type === "audioMessage";
      const out = await media.trim(buffer, start, end, isAudio ? "mp3" : "mp4");
      const caption = `✂️ Trimmed ${start}${end ? ` → ${end}` : " to the end"}`;
      return isAudio ? { audio: out, mimetype: "audio/mpeg" } : { video: out, caption };
    },
  }),

  mediaCommand({
    name: "slowmo",
    category: CATEGORY,
    desc: "Slow a video down",
    usage: "Reply to a video with .slowmo  |  .slowmo 3",
    accepts: "a video",
    handler: async (ctx, buffer) => {
      const factor = Number(ctx.args[0]) || 2;
      return {
        video: await media.slowmo(buffer, factor),
        caption: `🐢 ${factor}× slower\n\n_For a smoother result, run_ ${ctx.prefix}interp _on this._`,
      };
    },
  }),

  mediaCommand({
    name: "interp",
    aliases: ["smooth"],
    category: CATEGORY,
    desc: "Add frames so slow motion looks smooth",
    usage: "Reply to a video with .interp  |  .interp 60",
    accepts: "a video",
    handler: async (ctx, buffer) => {
      const fps = Number(ctx.args[0]) || 60;
      if (fps < 24 || fps > 120) return { text: "❌ Pick an fps between 24 and 120." };

      await ctx.reply("⏳ Interpolating — this one is slow, give it a minute.");
      return {
        video: await media.interpolate(buffer, fps),
        caption: `✨ Interpolated to ${fps} fps`,
      };
    },
  }),

  mediaCommand({
    name: "mp4",
    aliases: ["tovideo"],
    category: CATEGORY,
    desc: "Turn an animated sticker or GIF into a video",
    usage: "Reply to an animated sticker with .mp4",
    accepts: "an animated sticker or GIF",
    handler: async (ctx, buffer, target) => {
      const ext = target.type === "stickerMessage" ? "webp" : "mp4";
      return { video: await media.toMp4(buffer, ext), caption: "🎬 Converted" };
    },
  }),

  pairCommand({
    name: "take",
    desc: "Put one video's audio onto another video",
    usage: "Reply to the video you want, then send the audio with .take",
    hint: "Reply to a *video*, and send the *audio* along with this command.",
    combine: async (ctx, video, audio) => ({
      video: await media.replaceAudio(video, audio),
      caption: "🎵 Audio swapped in",
    }),
  }),

  pairCommand({
    name: "avmix",
    desc: "Combine a video with a separate audio track",
    usage: "Reply to a video, then send an audio file with .avmix",
    hint: "Reply to a *video*, and send the *audio file* with this command.",
    combine: async (ctx, video, audio) => ({
      video: await media.replaceAudio(video, audio),
      caption: "🎬 Mixed",
    }),
  }),

  pairCommand({
    name: "vmix",
    desc: "Join two videos end to end",
    usage: "Reply to the first video, then send the second with .vmix",
    hint: "Reply to the *first* video, and send the *second* one with this command.",
    combine: async (ctx, first, second) => {
      await ctx.reply("⏳ Joining — re-encoding both so they line up.");
      return { video: await media.concatVideos(first, second), caption: "🎬 Joined" };
    },
  }),
];
