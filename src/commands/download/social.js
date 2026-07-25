const ytdlp = require("../../utils/providers/ytdlp");

const CATEGORY = "Download";

/**
 * Every social downloader is the same flow with a different link pattern, so
 * they share one factory. yt-dlp does the site-specific work.
 */
function socialCommand({ name, aliases = [], label, pattern, example, desc }) {
  return {
    name,
    aliases,
    category: CATEGORY,
    desc,
    usage: `.${name} <link>`,
    permission: "public",
    execute: async (ctx) => {
      const url = (ctx.text || ctx.quoted?.text || "").match(pattern)?.[0];
      if (!url) {
        return ctx.reply(`*Usage:* ${ctx.prefix}${name} <${label} link>\n\n*Example*\n${ctx.prefix}${name} ${example}`);
      }

      await ctx.reply(`⏳ Fetching from ${label}…`);

      const { files, meta } = await ytdlp.media(url);
      const caption =
        `*${meta.title || label}*` +
        (meta.uploader ? `\n_by ${meta.uploader}_` : "");

      for (const [index, file] of files.entries()) {
        const payload = file.isVideo
          ? { video: file.buffer, caption: index === 0 ? caption : "" }
          : { image: file.buffer, caption: index === 0 ? caption : "" };
        await ctx.send(ctx.chat, payload);
      }

      if (files.length > 1) await ctx.reply(`✅ Sent ${files.length} item(s).`);
    },
  };
}

module.exports = [
  socialCommand({
    name: "insta",
    aliases: ["ig2", "instagram"],
    label: "Instagram",
    desc: "Download an Instagram post or reel",
    pattern: /https?:\/\/(?:www\.)?instagram\.com\/\S+/i,
    example: "https://instagram.com/p/ABC123",
  }),

  socialCommand({
    name: "story",
    label: "Instagram stories",
    desc: "Download an Instagram story",
    pattern: /https?:\/\/(?:www\.)?instagram\.com\/(?:stories|s)\/\S+/i,
    example: "https://instagram.com/stories/username/123456",
  }),

  socialCommand({
    name: "fb",
    aliases: ["facebook"],
    label: "Facebook",
    desc: "Download a Facebook video",
    pattern: /https?:\/\/(?:\w+\.)?(?:facebook\.com|fb\.watch)\/\S+/i,
    example: "https://fb.watch/abc123",
  }),

  socialCommand({
    name: "tiktok",
    aliases: ["tt"],
    label: "TikTok",
    desc: "Download a TikTok, no watermark",
    pattern: /https?:\/\/(?:\w+\.)?tiktok\.com\/\S+/i,
    example: "https://tiktok.com/@user/video/123",
  }),

  socialCommand({
    name: "pinterest",
    aliases: ["pin"],
    label: "Pinterest",
    desc: "Download a Pinterest image or video",
    pattern: /https?:\/\/(?:\w+\.)?(?:pinterest\.[a-z.]+|pin\.it)\/\S+/i,
    example: "https://pin.it/abc123",
  }),
];
