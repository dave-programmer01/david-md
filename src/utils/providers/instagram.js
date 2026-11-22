const fs = require("fs");
const ytdlp = require("./ytdlp");
const { UA } = require("./search");

/**
 * Everything Instagram-specific: telling a post link from a profile, routing
 * downloads through yt-dlp with the right flags, and turning Instagram's
 * server-blocking errors into something a user can act on.
 */

// Scheme optional — people paste "instagram.com/reel/…" as often as the full URL.
const LINK = /(?:https?:\/\/)?(?:[\w-]+\.)?(?:instagram\.com|instagr\.am)\/[^\s<>"'*]+/i;

// A post, reel, IGTV video, story, highlight or share link. The optional
// leading segment covers "instagram.com/<user>/p/<code>/".
const MEDIA_PATH =
  /^\/(?:(?:[\w.]+\/)?(?:p|reels?|tv)\/[\w-]+|stories\/[^/]+|s\/[\w-]+|share\/(?:\w+\/)?[\w-]+)/i;

const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

// First path segments that are Instagram pages rather than accounts.
const RESERVED = new Set([
  "about", "accounts", "api", "challenge", "developer", "direct", "directory",
  "emails", "explore", "graphql", "legal", "lite", "privacy", "session",
  "stories", "terms", "web",
]);

/**
 * Work out what the user gave us.
 *   → { kind: "post", url }         a post/reel/story link, to download
 *   → { kind: "profile", username } a username, @handle or profile link
 *   → null                          neither
 */
function parse(input) {
  const text = String(input || "").trim();
  const link = text.match(LINK)?.[0];

  if (link) {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`);
    } catch {
      return null;
    }
    if (MEDIA_PATH.test(url.pathname)) {
      // Rebuilt on the canonical host so m./instagr.am links match yt-dlp's
      // patterns. The query stays: highlight links carry the item id in it.
      return { kind: "post", url: `https://www.instagram.com${url.pathname}${url.search}` };
    }
    const [first, second] = url.pathname.split("/").filter(Boolean);
    if (first === "_u" && USERNAME.test(second || "")) return { kind: "profile", username: second.toLowerCase() };
    if (first && USERNAME.test(first) && !RESERVED.has(first.toLowerCase())) {
      return { kind: "profile", username: first.toLowerCase() };
    }
    return null;
  }

  const handle = text.replace(/^@/, "").replace(/\/+$/, "");
  return USERNAME.test(handle) ? { kind: "profile", username: handle.toLowerCase() } : null;
}

// ── Cookies (optional) ───────────────────────────────────────────────────
//
// Instagram serves logged-out visitors from cloud IPs a login wall or a rate
// limit far sooner than it does home connections. A cookies file from a
// logged-in browser lifts that — the same opt-in as YT_COOKIES, with the same
// caveat: an account used from a datacentre IP can get flagged, so use a
// spare one.

function cookiesFile() {
  const file = process.env.IG_COOKIES;
  return file && fs.existsSync(file) ? file : null;
}

/** The instagram.com cookies from a Netscape cookies.txt, as a Cookie header. */
function cookieHeader() {
  const file = cookiesFile();
  if (!file) return null;
  const now = Date.now() / 1000;
  const pairs = [];
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.startsWith("#HttpOnly_") ? raw.slice("#HttpOnly_".length) : raw;
    if (!line || line.startsWith("#")) continue;
    const [domain, , , , expires, name, value] = line.split("\t");
    if (value === undefined || !/(^|\.)instagram\.com$/i.test(domain)) continue;
    if (Number(expires) > 0 && Number(expires) < now) continue;
    pairs.push(`${name}=${value}`);
  }
  return pairs.length ? pairs.join("; ") : null;
}

const cookieHint = (what = "public posts") =>
  cookiesFile()
    ? "_Instagram cookies are set (IG_COOKIES), so they have probably expired — the owner should export fresh ones._"
    : `_If ${what} keep failing, the bot owner can add Instagram cookies (IG_COOKIES — see the README)._`;

// ── Downloads ────────────────────────────────────────────────────────────

// What yt-dlp says when Instagram refuses a logged-out request: private or
// deleted posts, and — the common case on a cloud host — a rate-limited IP.
const REFUSED =
  /login required|rate-?limit|empty media response|locked behind the login|Please wait a few minutes|checkpoint|HTTP Error (?:401|403|429)|use --cookies/i;

/** Download a post, reel or story. Returns { files, meta } like ytdlp.media. */
async function download(input) {
  const target = parse(input);
  if (target?.kind === "profile") {
    throw new Error(
      `That's a link to @${target.username}'s profile, not to a post. ` +
        "Send a post or reel link — or use the *ig* command with the username to look the account up."
    );
  }
  if (!target) throw new Error("That doesn't look like an Instagram post or reel link.");

  const file = cookiesFile();
  try {
    return await ytdlp.media(target.url, { photos: true, args: file ? ["--cookies", file] : [] });
  } catch (err) {
    if (!REFUSED.test(err.message)) throw err;
    console.warn(`  ↳ Instagram refused ${target.url}: ${err.message.split("\n")[0].slice(0, 160)}`);
    throw new Error(
      "Instagram wouldn't give this server that post.\n\n" +
        "Either it's private or deleted, or Instagram is rate-limiting this server — " +
        "cloud servers get limited far sooner than phones, so a public post that fails " +
        "now will often work again in a few minutes.\n\n" +
        cookieHint()
    );
  }
}

// ── Profiles ─────────────────────────────────────────────────────────────

const decodeEntities = (s) =>
  String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

function metaTag(html, key) {
  const value =
    html.match(new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]*\\bcontent="([^"]*)"`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]*(?:property|name)="${key}"`, "i"))?.[1];
  return value === undefined ? null : decodeEntities(value).trim();
}

/**
 * Pull the profile out of the page's preview tags — the same tags WhatsApp and
 * every other link preview reads. Exported for testing.
 *   og:description → "1.2M Followers, 150 Following, 3,000 Posts - See Instagram photos and videos from Name (@user)"
 *   description    → "… - Name (@user) on Instagram: "bio""
 *   og:title       → "Name (@user) • Instagram photos and videos"
 */
function parseProfilePage(html, username) {
  const summary = metaTag(html, "og:description");
  const counts = summary?.match(/([\d.,]+\s?[KMB]?)\s+Followers?,\s*([\d.,]+\s?[KMB]?)\s+Following,\s*([\d.,]+\s?[KMB]?)\s+Posts?/i);
  if (!counts) return null;

  const title = metaTag(html, "og:title") || "";
  const description = metaTag(html, "description") || "";
  return {
    username,
    name: title.match(/^(.*?)\s*\(@[^)]+\)/)?.[1] || summary.match(/from (.*?) \(@/)?.[1] || username,
    followers: counts[1].replace(/\s/g, ""),
    following: counts[2].replace(/\s/g, ""),
    posts: counts[3].replace(/\s/g, ""),
    bio: description.match(/on Instagram:\s*"([\s\S]*)"\s*$/)?.[1]?.trim() || "",
    picture: metaTag(html, "og:image"),
    url: `https://www.instagram.com/${username}/`,
  };
}

/**
 * Look up a public profile. yt-dlp can't do this — its Instagram profile
 * extractor is marked broken upstream — so this reads the public profile page
 * directly. Instagram often answers cloud servers with a login page instead;
 * that's reported as `blocked` rather than as a missing account.
 */
async function profile(username) {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  const cookie = cookieHeader();

  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, reason: "blocked", hint: cookieHint("lookups") };
  }
  if (res.status === 404) return { ok: false, reason: "missing" };

  const html = await res.text().catch(() => "");
  const found = res.ok && !/\/accounts\/login/.test(res.url) ? parseProfilePage(html, username) : null;
  if (found) return { ok: true, profile: found };

  if (/<title>[^<]*Page Not Found/i.test(html)) return { ok: false, reason: "missing" };
  return { ok: false, reason: "blocked", hint: cookieHint("lookups") };
}

module.exports = { parse, download, profile, parseProfilePage, cookieHeader, LINK };
