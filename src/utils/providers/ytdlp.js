const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

/**
 * Every download command routes through yt-dlp rather than a per-site scraper
 * API. It supports YouTube, TikTok, Instagram, Facebook, Pinterest, Twitter,
 * Reddit and SoundCloud from one interface, and — crucially — it updates
 * itself when those sites change, which hand-rolled scrapers do not.
 */
const BIN = process.env.YTDLP_PATH || "yt-dlp";

// WhatsApp rejects media much beyond this; failing early beats a long download
// that can never be delivered.
const MAX_BYTES = 48 * 1024 * 1024;

/**
 * YouTube challenges datacenter IPs with "Sign in to confirm you're not a bot",
 * and which player client you present changes how often that happens. There is
 * no single client that always works, so the ones that need no login are tried
 * in turn. `default` goes first because with a JS runtime present (deno, in the
 * Docker image) it gives the best formats.
 */
const YT_CLIENTS = ["default", "tv_simply", "web_safari", "mweb", "tv"];

const isBotCheck = (message) =>
  /Sign in to confirm|not a bot|confirm your age|429|Too Many Requests/i.test(String(message));

/** Shared flags for every YouTube call. */
function youtubeArgs(client) {
  const args = ["--no-warnings", "--no-playlist"];

  // A cookies file lifts the bot check outright. Optional — most installs
  // never need it, and cookies from a logged-in account used via a datacenter
  // IP can get that account flagged, so it stays opt-in.
  if (process.env.YT_COOKIES && fs.existsSync(process.env.YT_COOKIES)) {
    args.push("--cookies", process.env.YT_COOKIES);
  }
  if (client && client !== "default") {
    args.push("--extractor-args", `youtube:player_client=${client}`);
  }
  return args;
}

const isYouTube = (url) => /(?:youtube\.com|youtu\.be)/i.test(String(url));

function run(args, { timeout = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Download timed out."));
    }, timeout);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        err.code === "ENOENT"
          ? new Error("yt-dlp is not installed on this server. Add it, or use the Docker image which bundles it.")
          : err
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      const reason = String(stderr).split("\n").filter(Boolean).pop() || `exit ${code}`;
      reject(new Error(reason.replace(/^ERROR:\s*/i, "")));
    });
  });
}

/**
 * Run a yt-dlp operation, retrying across player clients when YouTube throws a
 * bot check. Non-YouTube URLs and non-bot-check errors fail on the first try —
 * retrying those would just be slow.
 */
async function withClientFallback(url, operation) {
  if (!isYouTube(url)) return operation(null);

  let lastError;
  for (const client of YT_CLIENTS) {
    try {
      return await operation(client);
    } catch (err) {
      lastError = err;
      if (!isBotCheck(err.message)) throw err;
      console.log(`  ↳ youtube blocked the "${client}" client, trying the next one`);
    }
  }

  throw new Error(
    "YouTube is blocking this server — it asked to \"confirm you're not a bot\".\n\n" +
      "This happens because the bot runs in a datacentre, and YouTube treats " +
      "those addresses as suspicious. Every player client was refused.\n\n" +
      "_Usually temporary — try again in a few minutes. If it keeps happening, " +
      "the owner can supply a cookies file via the YT_COOKIES variable._"
  );
}

async function available() {
  try {
    await run(["--version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** Metadata only — title, duration, thumbnail, uploader. */
async function info(url) {
  const raw = await withClientFallback(url, (client) =>
    run(["-J", ...youtubeArgs(client), url], { timeout: 60_000 })
  );
  const data = JSON.parse(raw);
  return {
    id: data.id,
    title: data.title || "Unknown",
    uploader: data.uploader || data.channel || "Unknown",
    duration: data.duration || 0,
    thumbnail: data.thumbnail || null,
    url: data.webpage_url || url,
    views: data.view_count || 0,
    description: data.description || "",
  };
}

/** YouTube search — returns lightweight results for `.yts` / `.play`. */
async function search(query, limit = 5) {
  const raw = await withClientFallback("https://youtube.com/", (client) =>
    run(["-J", "--flat-playlist", ...youtubeArgs(client), `ytsearch${limit}:${query}`], { timeout: 60_000 })
  );
  const data = JSON.parse(raw);
  return (data.entries || []).map((e) => ({
    id: e.id,
    title: e.title || "Unknown",
    uploader: e.uploader || e.channel || "Unknown",
    duration: e.duration || 0,
    url: e.url?.startsWith("http") ? e.url : `https://www.youtube.com/watch?v=${e.id}`,
  }));
}

async function withTempDir(fn) {
  const dir = path.join(os.tmpdir(), `dl-${crypto.randomBytes(6).toString("hex")}`);
  await fs.promises.mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readOnlyFile(dir) {
  const files = await fs.promises.readdir(dir);
  if (!files.length) throw new Error("Nothing was downloaded.");
  const file = path.join(dir, files[0]);
  const stat = await fs.promises.stat(file);
  if (stat.size > MAX_BYTES) {
    throw new Error(`That file is ${(stat.size / 1048576).toFixed(0)} MB — too big to send on WhatsApp.`);
  }
  return { buffer: await fs.promises.readFile(file), name: files[0], size: stat.size };
}

/** Audio as mp3, for `.song` / `.yta` / `.mp3` / `.spotify`. */
async function audio(url) {
  const meta = await info(url);
  const file = await withTempDir(async (dir) => {
    await withClientFallback(url, (client) =>
      run([
        "-f", "bestaudio/best",
        "-x", "--audio-format", "mp3", "--audio-quality", "128K",
        ...youtubeArgs(client),
        "-o", path.join(dir, "%(title).80s.%(ext)s"),
        url,
      ])
    );
    return readOnlyFile(dir);
  });
  return { ...file, meta };
}

/** Video as mp4, height-capped so the result stays sendable. */
async function video(url, maxHeight = 480) {
  const meta = await info(url);
  const file = await withTempDir(async (dir) => {
    await withClientFallback(url, (client) =>
      run([
        "-f", `bestvideo[height<=${maxHeight}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${maxHeight}]/best`,
        "--merge-output-format", "mp4",
        ...youtubeArgs(client),
        "-o", path.join(dir, "%(title).80s.%(ext)s"),
        url,
      ])
    );
    return readOnlyFile(dir);
  });
  return { ...file, meta };
}

/** Images or videos from a social post — Instagram, TikTok, Facebook, Pinterest. */
async function media(url) {
  const meta = await info(url).catch(() => ({ title: "Download", uploader: "", description: "" }));
  const files = await withTempDir(async (dir) => {
    await run([
      "-f", "best[ext=mp4]/best",
      "--no-warnings",
      "-o", path.join(dir, "%(autonumber)s.%(ext)s"),
      url,
    ]);
    const names = await fs.promises.readdir(dir);
    const out = [];
    for (const name of names.slice(0, 10)) {
      const full = path.join(dir, name);
      const stat = await fs.promises.stat(full);
      if (stat.size > MAX_BYTES) continue;
      out.push({
        buffer: await fs.promises.readFile(full),
        name,
        isVideo: /\.(mp4|mkv|webm|mov)$/i.test(name),
      });
    }
    if (!out.length) throw new Error("Nothing downloadable was found at that link (or it was too large).");
    return out;
  });
  return { files, meta };
}

module.exports = { run, available, info, search, audio, video, media, MAX_BYTES, BIN };
