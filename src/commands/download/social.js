const ytdlp = require("../../utils/providers/ytdlp");
const misc = require("../../utils/providers/misc");
const instagram = require("../../utils/providers/instagram");
const { sendMedia } = require("../../utils/deliver");

const CATEGORY = "Download";

/**
 * Every social downloader is the same flow with a different link pattern, so
 * they share one factory. yt-dlp does the site-specific work by default; a
 * command can override `fetcher` when a site needs a different route (TikTok
 * blocks datacentre IPs, so it goes through a resolver instead).
 */
function socialCommand({ name, aliases = [], label, pattern, example, desc, fetcher }) {
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
      await sendMedia(ctx, await (fetcher ? fetcher(url) : ytdlp.media(url)), label);
    },
  };
}

module.exports = [
  socialCommand({
    name: "insta",
    aliases: ["ig2", "instagram"],
    label: "Instagram",
    desc: "Download an Instagram post or reel",
    pattern: instagram.LINK,
    example: "https://instagram.com/p/ABC123",
    fetcher: instagram.download,
  }),

  socialCommand({
    name: "story",
    label: "Instagram stories",
    desc: "Download an Instagram story",
    pattern: /(?:https?:\/\/)?(?:[\w-]+\.)?instagram\.com\/(?:stories|s)\/\S+/i,
    example: "https://instagram.com/stories/username/123456",
    fetcher: instagram.download,
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
    // The resolver fetches from its own IP (TikTok challenges datacentre IPs on
    // the web page yt-dlp would scrape). yt-dlp is the fallback if it's down.
    fetcher: async (url) => {
      try {
        return await misc.tiktok(url);
      } catch {
        return await ytdlp.media(url);
      }
    },
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
