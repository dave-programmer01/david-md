const crypto = require("crypto");
const db = require("../db");
const store = require("../store");

// setTimeout overflows past ~24.8 days and fires immediately, so anything
// further out is re-armed in chunks.
const MAX_TIMEOUT = 2_147_483_000;

/** Parse "10m", "2h30m", "1d", or an absolute "2026-08-01 09:00" into an epoch. */
function parseWhen(input) {
  const text = String(input || "").trim();
  if (!text) return null;

  const relative = text.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day|w|week)s?$/i);
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const ms =
      unit.startsWith("s") ? n * 1000 :
      unit.startsWith("m") ? n * 60_000 :
      unit.startsWith("h") ? n * 3_600_000 :
      unit.startsWith("d") ? n * 86_400_000 :
      n * 604_800_000;
    return Date.now() + ms;
  }

  const compound = [...text.matchAll(/(\d+)\s*(d|h|m|s)/gi)];
  if (compound.length > 1) {
    let ms = 0;
    for (const [, n, unit] of compound) {
      const v = Number(n);
      ms += unit.toLowerCase() === "d" ? v * 86_400_000
        : unit.toLowerCase() === "h" ? v * 3_600_000
        : unit.toLowerCase() === "m" ? v * 60_000
        : v * 1000;
    }
    return Date.now() + ms;
  }

  const absolute = Date.parse(text);
  return Number.isNaN(absolute) ? null : absolute;
}

function arm(sock, job) {
  const delay = job.at - Date.now();

  if (delay > MAX_TIMEOUT) {
    const timer = setTimeout(() => arm(sock, job), MAX_TIMEOUT);
    store.scheduleTimers.set(job.id, timer);
    return;
  }

  const timer = setTimeout(async () => {
    store.scheduleTimers.delete(job.id);
    try {
      await sock.sendMessage(job.chat, { text: job.text, mentions: job.mentions || [] });
    } catch (err) {
      console.error(`scheduled message ${job.id} failed:`, err.message);
    }
    await db.raw().del(db.SCHEDULE, job.id);
  }, Math.max(0, delay));

  store.scheduleTimers.set(job.id, timer);
}

async function schedule(sock, { chat, text, at, mentions = [], by }) {
  const id = crypto.randomBytes(4).toString("hex");
  const job = { id, chat, text, at, mentions, by, created: Date.now() };
  await db.raw().set(db.SCHEDULE, id, job);
  arm(sock, job);
  return job;
}

async function cancel(id) {
  const timer = store.scheduleTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    store.scheduleTimers.delete(id);
  }
  const job = await db.raw().get(db.SCHEDULE, id, null);
  if (job) await db.raw().del(db.SCHEDULE, id);
  return job;
}

async function list(chat = null) {
  const all = Object.values(await db.raw().all(db.SCHEDULE));
  const jobs = chat ? all.filter((j) => j.chat === chat) : all;
  return jobs.sort((a, b) => a.at - b.at);
}

/**
 * Re-arm every stored job after a restart. Jobs whose time passed while the
 * bot was down are sent immediately rather than dropped.
 */
async function rehydrateSchedules(sock) {
  const jobs = Object.values(await db.raw().all(db.SCHEDULE));
  if (!jobs.length) return 0;
  for (const job of jobs) arm(sock, job);
  console.log(`⏰ ${jobs.length} scheduled message(s) restored.`);
  return jobs.length;
}

module.exports = { parseWhen, schedule, cancel, list, rehydrateSchedules, arm };
