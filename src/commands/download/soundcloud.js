const ytdlp = require("../../utils/providers/ytdlp");

const SC_URL = /https?:\/\/(?:on\.)?soundcloud\.com\/\S+/i;

const clock = (seconds) => {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

module.exports = {
  name: "soundcloud",
  aliases: ["sc", "scdl"],
  category: "Download",
  desc: "Download a song from SoundCloud",
  usage: ".soundcloud <song name or SoundCloud link>",
  permission: "public",
  execute: async (ctx) => {
    const input = (ctx.text || ctx.quoted?.text || "").trim();
    if (!input) {
      return ctx.reply(
        `*Usage:* ${ctx.prefix}soundcloud <song or link>\n\n` +
          `${ctx.prefix}soundcloud lofi chill beats\n` +
          `${ctx.prefix}soundcloud https://soundcloud.com/artist/track`
      );
    }

    // A direct SoundCloud link downloads straight off; anything else is a
    // search, and the top hit is what gets sent.
    let url = input.match(SC_URL)?.[0];
    if (!url) {
      await ctx.reply("🔎 Searching SoundCloud…");
      const [first] = await ytdlp.scSearch(input, 1);
      if (!first) return ctx.reply(`❌ Nothing on SoundCloud for *${input}*.`);
      url = first.url;
    }

    await ctx.reply("⏳ Downloading…");

    // Oversize is caught inside audio() with a friendly message the handler
    // surfaces, so there's nothing to guard here.
    const { buffer, meta } = await ytdlp.audio(url);

    return ctx.reply({
      audio: buffer,
      mimetype: "audio/mpeg",
      fileName: `${meta.title}.mp3`,
      contextInfo: {
        externalAdReply: {
          title: String(meta.title).slice(0, 60),
          body: `${meta.uploader}${meta.duration ? ` · ${clock(meta.duration)}` : ""} · SoundCloud`,
          mediaType: 2,
          thumbnailUrl: meta.thumbnail || undefined,
          sourceUrl: meta.url,
        },
      },
    });
  },
};
