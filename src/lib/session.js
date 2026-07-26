const fs = require("fs");
const path = require("path");
const S = require("../settings");

function banner(lines) {
  const width = 68;
  const bar = "═".repeat(width);
  console.error(`\n╔${bar}╗`);
  for (const line of lines) {
    console.error(`║ ${line.padEnd(width - 2)} ║`);
  }
  console.error(`╚${bar}╝\n`);
}

function fatal(lines) {
  banner(lines);
  process.exit(1);
}

/**
 * Turn the SESSION_ID from config.js into session/creds.json.
 *
 * If creds.json already exists we leave it completely alone. A running
 * deployment accumulates pre-keys, sender-keys and app-state that are NOT in
 * the session ID; overwriting them on every restart would silently break group
 * decryption.
 */
function restoreSession() {
  const credsPath = path.join(S.SESSION_DIR, "creds.json");

  if (fs.existsSync(credsPath)) {
    console.log("🔄 Existing session found — resuming it.");
    return;
  }

  if (S.isPlaceholder) {
    fatal([
      "",
      "  NO SESSION ID FOUND",
      "",
      "  Open the file  config.js  in this folder and paste your",
      "  session ID between the quotes on the SESSION_ID line:",
      "",
      '      const SESSION_ID = "David~...";',
      "",
      "  Don't have one yet? Get it from the pairing website —",
      "  it will be sent to you on WhatsApp.",
      "",
    ]);
  }

  const raw = S.SESSION_ID.replace(/^David~/i, "").trim();

  if (raw.length < 200) {
    fatal([
      "",
      "  SESSION ID LOOKS TOO SHORT",
      "",
      `  Got ${raw.length} characters — a real one is around 2500.`,
      "",
      "  You probably copied only part of it. Go back to the message",
      "  on WhatsApp, long-press it, Copy, and paste the WHOLE thing",
      "  into config.js. Make sure you got the very end.",
      "",
    ]);
  }

  let decoded;
  try {
    decoded = Buffer.from(raw, "base64").toString("utf8");
  } catch {
    fatal(["", "  SESSION ID IS NOT VALID", "", "  It could not be decoded. Copy it again from WhatsApp.", ""]);
  }

  let parsed;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    fatal([
      "",
      "  SESSION ID IS DAMAGED",
      "",
      "  It decoded, but the result isn't valid session data. This",
      "  almost always means the paste was cut short or a character",
      "  was lost. Copy it again from WhatsApp — the whole string.",
      "",
    ]);
  }

  fs.mkdirSync(S.SESSION_DIR, { recursive: true });

  if (parsed["creds.json"]) {
    // New format: bundle of all session files
    for (const [filename, b64] of Object.entries(parsed)) {
      if (filename.endsWith(".json")) {
        fs.writeFileSync(path.join(S.SESSION_DIR, filename), Buffer.from(b64, "base64"));
      }
    }
    const credsStr = Buffer.from(parsed["creds.json"], "base64").toString("utf8");
    const creds = JSON.parse(credsStr);
    console.log(`✅ Session restored for ${creds.me?.name || creds.me?.id || "your account"}.`);
  } else if (parsed.noiseKey && parsed.me) {
    // Old format: just creds.json content
    fs.writeFileSync(credsPath, decoded);
    console.log(`✅ Session restored for ${parsed.me?.name || parsed.me?.id || "your account"}.`);
  } else {
    fatal([
      "",
      "  SESSION ID IS MISSING ITS LOGIN KEYS",
      "",
      "  This is not a David-md session ID, or it was truncated.",
      "  Generate a fresh one from the pairing website.",
      "",
    ]);
  }
}

/** Build a session ID out of the current creds — used by .getsession and tests. */
function exportSession() {
  const credsPath = path.join(S.SESSION_DIR, "creds.json");
  if (!fs.existsSync(credsPath)) return null;
  return "David~" + fs.readFileSync(credsPath).toString("base64");
}

module.exports = { restoreSession, exportSession };
