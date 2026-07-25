const S = require("../settings");
const JsonStore = require("./json");
const PostgresStore = require("./postgres");

// Collections
const GLOBAL = "settings";   // bot-wide: prefix, mode, owner, alive, sticker meta
const GROUPS = "groups";     // per-group toggles, keyed by group JID
const WARNS = "warns";       // "<groupJid>:<userJid>" -> { count, reasons[] }
const FILTERS = "filters";   // "<chatJid>" -> { keyword: {response, exact, on} }
const SUDO = "sudo";         // JID -> true
const USERS = "users";       // JID -> lastSeen (drives "Total Users" in the menu)
const SCHEDULE = "schedule"; // id -> { chat, text, at }
const AFK = "afk";           // JID -> { since, reason }
const BANNED = "banned";     // JID -> true (bot-level ignore list)
const NOTES = "notes";       // misc scratch (chatbot toggles, automute times…)

let store = null;

async function init() {
  store = S.DATABASE_URL ? new PostgresStore(S.DATABASE_URL) : new JsonStore(S.DATA_DIR);
  try {
    await store.init();
  } catch (err) {
    if (S.DATABASE_URL) {
      // A bad DATABASE_URL should degrade, not kill the bot. Settings will
      // reset on restart, which is survivable; being offline is not.
      console.error(`⚠️  Postgres unavailable (${err.message}) — falling back to files in data/.`);
      store = new JsonStore(S.DATA_DIR);
      await store.init();
    } else {
      throw err;
    }
  }
  return store;
}

const raw = () => {
  if (!store) throw new Error("Database used before init()");
  return store;
};

// ── Global settings, with config.js as the fallback layer ────────────────
const DEFAULTS = {
  prefix: S.PREFIX,
  mode: S.MODE,
  ownerName: S.OWNER_NAME,
  ownerNumber: S.OWNER_NUMBER,
  botName: S.BOT_NAME,
  stickerPack: S.STICKER_PACK,
  stickerAuthor: S.STICKER_AUTHOR,
  rejectCalls: S.REJECT_CALLS,
  alwaysOnline: S.ALWAYS_ONLINE,
  autoReact: S.AUTO_REACT,
  antidelete: false,
  autodl: false,
  chatbot: false,
  language: "en",
  aliveText: "",
  aliveMedia: "",
  info: "",
  warnLimit: 3,
};

const get = (key) => raw().get(GLOBAL, key, DEFAULTS[key] ?? null);
const set = (key, value) => raw().set(GLOBAL, key, value);
const del = (key) => raw().del(GLOBAL, key);
const all = async () => ({ ...DEFAULTS, ...(await raw().all(GLOBAL)) });

// ── Per-group settings ───────────────────────────────────────────────────
const GROUP_DEFAULTS = {
  welcome: false, welcomeText: "", goodbye: false, goodbyeText: "",
  antilink: false, antilinkAction: "warn", antiword: false, antiwords: [],
  antibot: false, antispam: false, antifake: false, antifakePrefixes: [],
  antipromote: false, antidemote: false, pdm: false, events: false,
  automute: "", autounmute: "", locked: false,
};

async function group(jid) {
  const data = (await raw().get(GROUPS, jid, null)) || {};
  return { ...GROUP_DEFAULTS, ...data };
}

async function setGroup(jid, key, value) {
  const data = (await raw().get(GROUPS, jid, null)) || {};
  data[key] = value;
  return raw().set(GROUPS, jid, data);
}

module.exports = {
  init, raw, get, set, del, all, group, setGroup,
  DEFAULTS, GROUP_DEFAULTS,
  GLOBAL, GROUPS, WARNS, FILTERS, SUDO, USERS, SCHEDULE, AFK, BANNED, NOTES,
};
