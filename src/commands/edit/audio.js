const media = require("../../utils/media");
const { mediaCommand } = require("../general/media");

const CATEGORY = "Edit";

const EXT_FOR = {
  audioMessage: "mp3",
  videoMessage: "mp4",
  documentMessage: "mp3",
};

/** An ffmpeg audio filter applied to a replied-to audio or video. */
const effect = (name, { effect: key, desc, label }) =>
  mediaCommand({
    name,
    category: CATEGORY,
    desc,
    usage: `Reply to audio or a video with .${name}`,
    accepts: "an audio file or video",
    handler: async (ctx, buffer, target) => {
      if (!["audioMessage", "videoMessage", "documentMessage"].includes(target.type)) {
        return { text: "❌ That needs to be audio or a video." };
      }
      const audio = await media.audioEffect(buffer, key, EXT_FOR[target.type] || "mp3");
      return { audio, mimetype: "audio/mpeg", ptt: false, caption: label };
    },
  });

module.exports = [
  mediaCommand({
    name: "mp3",
    aliases: ["toaudio"],
    category: CATEGORY,
    desc: "Pull the audio out of a video",
    usage: "Reply to a video with .mp3",
    accepts: "a video or audio file",
    handler: async (ctx, buffer, target) => {
      const audio = await media.toMp3(buffer, target.type === "audioMessage" ? "mp3" : "mp4");
      return { audio, mimetype: "audio/mpeg" };
    },
  }),

  effect("slow", { effect: "slow", desc: "Slow the audio down", label: "🐢 Slowed" }),
  effect("sped", { effect: "sped", desc: "Speed the audio up", label: "🐇 Sped up" }),
  effect("bass", { effect: "bass", desc: "Boost the bass", label: "🔊 Bass boosted" }),
];
