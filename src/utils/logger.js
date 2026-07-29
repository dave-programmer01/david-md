const pino = require("pino");

/**
 * libsignal (vendored inside Baileys) writes session-ratchet churn straight to
 * console.log — dozens of lines per group message, none of them actionable.
 *
 * The previous version of this file patched process.stdout.write and dropped
 * ANY line containing one of a list of substrings, which also swallowed the
 * bot's own output (anything containing "closed:", for instance). This version
 * patches console methods only, anchors its patterns at the start of the
 * message, and can be disabled entirely with DEBUG_SIGNAL=1.
 */
const SIGNAL_NOISE = [
  /^Bad MAC/,
  /^Closing (open )?session/,
  /^Session error/,
  /^Failed to decrypt/,
  /^SessionEntry/,
  /^Removing old closed session/,
];

function isSignalNoise(args) {
  if (!args.length) return false;
  const first = args[0];
  if (typeof first === "string" && SIGNAL_NOISE.some((re) => re.test(first.trim()))) return true;

  // libsignal also dumps raw ratchet objects, sometimes as the only argument
  // and sometimes trailing a message string — check every argument.
  const RATCHET_KEYS = [
    "currentRatchet", "_chains", "chainKey", "indexInfo",
    "pendingPreKey", "remoteIdentityKey", "ephemeralKeyPair",
  ];
  return args.some(
    (arg) =>
      arg && typeof arg === "object" && RATCHET_KEYS.some((key) => key in arg)
  );
}

function setupLogger() {
  if (process.env.DEBUG_SIGNAL === "1") return;
  // libsignal's session-ratchet noise goes through console.info specifically
  // ("Closing session:", the SessionEntry dump) — a distinct function from
  // console.log, so it has to be patched by name too.
  for (const method of ["log", "info", "error", "warn"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      if (isSignalNoise(args)) return;
      original(...args);
    };
  }
}

// Baileys needs a pino instance. Silent unless DEBUG_BAILEYS=1.
const baileysLogger = pino({ level: process.env.DEBUG_BAILEYS === "1" ? "debug" : "silent" });

module.exports = { setupLogger, baileysLogger };
