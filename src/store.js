const { LRU } = require("./lib/cache");

/**
 * Hot, in-memory state only. Anything that must survive a restart lives in
 * src/db instead.
 */
module.exports = {
  botStartTimestamp: 0,
  isConnected: false,
  sock: null,

  // Counters behind the heartbeat. They exist to answer one question a silent
  // bot can't otherwise answer: is it dead, or alive and receiving nothing?
  stats: {
    upserts: 0,
    messages: 0,
    skippedBacklog: 0,
    skippedNotNotify: 0,
    commands: 0,
    errors: 0,
  },

  // Sticker flow: media arriving just before/after a `.sticker` caption.
  recentImages: new Map(),
  activeStickerRequests: new Map(),

  // Antidelete: recent messages, so a revoked one can be reposted.
  messageCache: new LRU({ max: 800, ttl: 30 * 60_000 }),

  // Antispam: "<chat>:<sender>" -> timestamps of recent messages.
  spamCounters: new LRU({ max: 500, ttl: 60_000 }),

  // `.retry` — last failed command per chat.
  lastCommand: new LRU({ max: 200, ttl: 30 * 60_000 }),

  // Simple cooldown so one user cannot hammer expensive commands.
  cooldowns: new LRU({ max: 500, ttl: 60_000 }),

  // In-flight games keyed by chat (`.games`).
  games: new Map(),

  // Timers for `.schedule`, rehydrated from the DB at boot.
  scheduleTimers: new Map(),
};
