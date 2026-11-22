const ytdlp = require("./ytdlp");
const instagram = require("./instagram");

const PATTERNS = [
  // Only post/reel links — a profile link shared in chat isn't a download.
  { provider: "instagram", re: /(?:https?:\/\/)?(?:[\w-]+\.)?(?:instagram\.com|instagr\.am)\/(?:[\w.]+\/)?(?:p|reels?|tv)\/[\w-]+\S*/i },
  { provider: "tiktok", re: /https?:\/\/(?:\w+\.)?tiktok\.com\/\S+/i },
  { provider: "facebook", re: /https?:\/\/(?:\w+\.)?(?:facebook\.com|fb\.watch)\/\S+/i },
  { provider: "pinterest", re: /https?:\/\/(?:\w+\.)?(?:pinterest\.[a-z.]+|pin\.it)\/\S+/i },
  { provider: "twitter", re: /https?:\/\/(?:\w+\.)?(?:twitter\.com|x\.com)\/\S+/i },
  { provider: "youtube", re: /https?:\/\/(?:\w+\.)?(?:youtube\.com|youtu\.be)\/\S+/i },
];

/** Find a supported media link in a message — powers `.autodl`. */
function detect(text) {
  for (const { provider, re } of PATTERNS) {
    const match = String(text || "").match(re);
    if (match) return { provider, url: match[0] };
  }
  return null;
}

/**
 * Fetch whatever is at a detected link and shape it into a Baileys message
 * payload. YouTube links are deliberately excluded from autodl — they are
 * usually shared to be watched, not re-uploaded, and are often long.
 */
async function download(provider, url) {
  if (provider === "youtube") return null;

  const { files, meta } = provider === "instagram" ? await instagram.download(url) : await ytdlp.media(url);
  const first = files[0];
  const caption = meta.title && meta.title !== "Download" ? `*${meta.title}*` : "";

  return first.isVideo
    ? { video: first.buffer, caption }
    : { image: first.buffer, caption };
}

module.exports = { detect, download, PATTERNS, ytdlp };
