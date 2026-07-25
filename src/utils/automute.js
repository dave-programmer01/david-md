const db = require("../db");

/**
 * Scheduled group locking.
 *
 * Rather than arming a timer per group (which would need rehydrating on every
 * restart and re-arming across DST), a single minute-ticker scans the groups
 * that have a time set and acts when the clock matches. One timer, no state to
 * rebuild, and a restart can at worst miss the minute it was down for.
 */
let timer = null;
let lastTick = "";

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const isValidTime = (value) => HHMM.test(String(value || "").trim());

function nowHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

const normalise = (value) => {
  const match = String(value).trim().match(HHMM);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
};

async function tick(sock) {
  const current = nowHHMM();
  // The interval can fire twice inside the same minute; only act once.
  if (current === lastTick) return;
  lastTick = current;

  const groups = await db.raw().all(db.GROUPS);

  for (const [jid, settings] of Object.entries(groups || {})) {
    if (!jid.endsWith("@g.us")) continue;

    try {
      if (settings.automute && normalise(settings.automute) === current) {
        await sock.groupSettingUpdate(jid, "announcement");
        await sock.sendMessage(jid, { text: `🔒 Scheduled lock — only admins can post now.` });
      }
      if (settings.autounmute && normalise(settings.autounmute) === current) {
        await sock.groupSettingUpdate(jid, "not_announcement");
        await sock.sendMessage(jid, { text: `🔓 Scheduled unlock — everyone can post again.` });
      }
    } catch (err) {
      // Usually "not an admin any more" — not worth crashing the ticker over.
      console.error(`automute for ${jid}:`, err.message);
    }
  }
}

function startAutoMute(sock) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick(sock).catch(() => {}), 30_000);
  // Node shouldn't stay alive purely for this timer.
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { startAutoMute, isValidTime, normalise, nowHHMM };
