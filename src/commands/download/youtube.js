const ytdlp = require("../../utils/providers/ytdlp");
const { spotifyTrack } = require("../../utils/providers/misc");

const CATEGORY = "Download";

const YT = /https?:\/\/(?:\w+\.)?(?:youtube\.com|youtu\.be)\/\S+/i;

const clock = (seconds) => {
  if (!seconds) return "unknown";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/** Resolve either a YouTube link or a search phrase to one video. */
async function resolve(ctx) {
  const query = (ctx.text || ctx.quoted?.text || "").trim();
  if (!query) return null;

  const link = query.match(YT)?.[0];
  if (link) return link;

  const [first] = await ytdlp.search(query, 1);
  return first?.url || null;
}

const fetchCommand = ({ name, aliases = [], desc, kind }) => ({
  name,
  aliases,
  category: CATEGORY,
  desc,
  usage: `.${name} <search or YouTube link>`,
  permission: "public",
  execute: async (ctx) => {
    const url = await resolve(ctx);
    if (!url) {
      return ctx.reply(
        `*Usage:* ${ctx.prefix}${name} <song name or link>\n\n` +
          `${ctx.prefix}${name} bohemian rhapsody\n${ctx.prefix}${name} https://youtu.be/abc123`
      );
    }

    await ctx.reply(`⏳ Downloading the ${kind === "audio" ? "audio" : "video"}…`);

    const result = kind === "audio" ? await ytdlp.audio(url) : await ytdlp.video(url, 480);
    const { meta } = result;

    if (kind === "audio") {
      return ctx.reply({
        audio: result.buffer,
        mimetype: "audio/mpeg",
        fileName: `${meta.title}.mp3`,
      });
    }

    return ctx.reply({
      video: result.buffer,
      caption:
        `*${meta.title}*\n` +
        `_${meta.uploader} · ${clock(meta.duration)}_`,
    });
  },
});

module.exports = [
  fetchCommand({ name: "song", aliases: ["music"], desc: "Download a song as audio", kind: "audio" }),
  fetchCommand({ name: "play", desc: "Search and send a song", kind: "audio" }),
  fetchCommand({ name: "yta", desc: "YouTube link to audio", kind: "audio" }),
  fetchCommand({ name: "video", desc: "Search and send a video", kind: "video" }),
  fetchCommand({ name: "ytv", desc: "YouTube link to video", kind: "video" }),

  {
    name: "yts",
    aliases: ["ytsearch"],
    category: CATEGORY,
    desc: "Search YouTube without downloading",
    usage: ".yts lofi hip hop",
    permission: "public",
    execute: async (ctx) => {
      const query = ctx.text.trim();
      if (!query) return ctx.reply(`*Usage:* ${ctx.prefix}yts <what to search for>`);

      const results = await ytdlp.search(query, 8);
      if (!results.length) return ctx.reply(`❌ Nothing found for *${query}*.`);

      const lines = results.map(
        (r, i) =>
          `┃◬│ ${i + 1}. *${String(r.title).slice(0, 45)}*\n` +
          `┃◬│    _${r.uploader} · ${clock(r.duration)}_\n` +
          `┃◬│    ${r.url}`
      );

      return ctx.reply(
        `╭═══〘 *YouTube* 〙═══⊷❍\n${lines.join("\n┃◬│\n")}\n╰═════════════════⊷\n\n` +
          `_Download one:_ ${ctx.prefix}song <paste a link>`
      );
    },
  },

  {
    name: "spotify",
    category: CATEGORY,
    desc: "Download a track from a Spotify link",
    usage: ".spotify https://open.spotify.com/track/...",
    permission: "public",
    execute: async (ctx) => {
      const url = (ctx.text || ctx.quoted?.text || "").match(/https?:\/\/open\.spotify\.com\/\S+/i)?.[0];
      if (!url) {
        return ctx.reply(
          `*Usage:* ${ctx.prefix}spotify <track link>\n\n` +
            `${ctx.prefix}spotify https://open.spotify.com/track/abc123`
        );
      }

      await ctx.reply("⏳ Looking that track up…");

      // Spotify's own audio is DRM-protected and can't be downloaded, so the
      // track's title and artist are read from its public oEmbed data and the
      // matching audio is fetched from YouTube instead.
      const track = await spotifyTrack(url);
      if (!track.query) return ctx.reply("❌ Couldn't read the track name from that link.");

      const [match] = await ytdlp.search(`${track.query} audio`, 1);
      if (!match) return ctx.reply(`❌ Couldn't find *${track.title}* to download.`);

      const { buffer, meta } = await ytdlp.audio(match.url);

      return ctx.reply({
        audio: buffer,
        mimetype: "audio/mpeg",
        fileName: `${track.title || meta.title}.mp3`,
      });
    },
  },
];
