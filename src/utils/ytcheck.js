const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const APP_ROOT = path.join(__dirname, "..", "..");

/**
 * Boot-time probe of the YouTube download toolchain.
 *
 * A `.play` failure is one of three very different problems — yt-dlp missing,
 * no JS runtime, or no Proof-of-Origin provider — and from a chat error alone
 * they look identical. Printing what's actually present at startup turns
 * "downloads don't work" into a one-line answer, and in particular reveals
 * when a deploy is running an image built before the provider was added.
 */
function has(name, envVar) {
  if (envVar && process.env[envVar] && fs.existsSync(process.env[envVar])) return process.env[envVar];
  const beside = path.join(APP_ROOT, name);
  if (fs.existsSync(beside)) return beside;
  return null; // may still be on PATH — resolved by the check below
}

function version(bin, args = ["--version"]) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 8000 }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim().split("\n")[0]);
    });
  });
}

async function reportYouTubeSupport() {
  const ytBin = has("yt-dlp", "YTDLP_PATH") || "yt-dlp";
  const denoBin = has("deno", "DENO_PATH") || "deno";
  const potScript = process.env.BGUTIL_POT_SCRIPT;

  const [yt, deno] = await Promise.all([version(ytBin), version(denoBin)]);
  const pot = potScript && fs.existsSync(potScript);

  const tick = (ok) => (ok ? "✓" : "✗");
  console.log(
    `🎵 YouTube: yt-dlp ${tick(yt)}  deno ${tick(deno)}  bot-check bypass ${tick(pot)}` +
      (yt ? "" : "  — no downloads: install yt-dlp") +
      (yt && !deno ? "  — YouTube may be blocked: no JS runtime" : "") +
      (yt && deno && !pot ? "  — YouTube will be blocked on a datacentre IP: no PoT provider (rebuild the Docker image)" : "")
  );

  return { yt: !!yt, deno: !!deno, pot: !!pot };
}

module.exports = { reportYouTubeSupport };
