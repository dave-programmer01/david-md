const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const APP_ROOT = path.join(__dirname, "..", "..");
const bin = (name, env) =>
  (process.env[env] && fs.existsSync(process.env[env]) && process.env[env]) ||
  (fs.existsSync(path.join(APP_ROOT, name)) && path.join(APP_ROOT, name)) ||
  name;

function run(cmd, args, timeout = 90_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code ?? 1 : 0, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

/**
 * One-shot, gated on YT_PROBE=1. Answers the only question that matters when
 * .play is blocked despite the provider being installed: does the token
 * actually generate, and does a fetch through it get past the bot check from
 * THIS server's IP? Prints a compact verdict to the log; costs nothing on a
 * normal boot because it doesn't run unless asked.
 */
async function probe() {
  if (process.env.YT_PROBE !== "1") return;
  const yt = bin("yt-dlp", "YTDLP_PATH");
  const potScript = process.env.BGUTIL_POT_SCRIPT;
  const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  console.log("\n🔬 YT_PROBE — diagnosing .play from this server\n");

  // 1. Can the bgutil deno script mint a token at all?
  if (potScript && fs.existsSync(potScript)) {
    const deno = bin("deno", "DENO_PATH");
    const gen = await run(deno, ["run", "--allow-all", potScript], 60_000);
    const mintedToken = /"poToken"\s*:\s*"/.test(gen.stdout);
    console.log(`  token generation : ${mintedToken ? "✅ produced a PO token" : "❌ FAILED"}`);
    if (!mintedToken) {
      const why = (gen.stderr || gen.stdout).split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 200);
      console.log(`     reason        : ${why || "no output"}`);
    }
  } else {
    console.log("  token generation : ✗ no PoT script (BGUTIL_POT_SCRIPT unset)");
  }

  // 2. End-to-end: fetch metadata through the provider, from this IP.
  const args = ["-J", "--no-warnings", "--no-playlist"];
  if (potScript && fs.existsSync(potScript)) {
    args.push("--extractor-args", `youtubepot-bgutilscript:script_path=${potScript}`);
  }
  args.push(VIDEO);

  const fetch = await run(yt, args, 90_000);
  if (fetch.code === 0 && /"id"\s*:/.test(fetch.stdout)) {
    console.log("  fetch with token : ✅ PASSED — YouTube accepted the request from this IP");
  } else {
    const err = fetch.stderr.split("\n").filter(Boolean).pop() || `exit ${fetch.code}`;
    const botCheck = /sign in to confirm|not a bot/i.test(fetch.stderr);
    console.log(`  fetch with token : ❌ ${botCheck ? "STILL BLOCKED — YouTube refused even with a token" : "failed"}`);
    console.log(`     yt-dlp says   : ${err.slice(0, 200)}`);
    console.log(
      botCheck
        ? "     verdict       : the token generates but this datacentre IP is refused — PoT is not enough here; cookies are the only reliable fix.\n"
        : "     verdict       : not a bot-check — a different yt-dlp/network issue.\n"
    );
  }
}

module.exports = { probe };
