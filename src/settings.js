const path = require("path");

let file = {};
try {
  file = require(path.join(__dirname, "..", "config.js"));
} catch (err) {
  console.error("\n❌ Could not read config.js — is it still there, and is the syntax valid?");
  console.error(`   ${err.message}\n`);
  process.exit(1);
}

const PLACEHOLDER = "PASTE_YOUR_SESSION_ID_HERE";

// Env wins over the file. Nothing in the documented flow sets env vars — this
// exists so the Heroku one-click button works for people who would rather not
// edit a file, and so `docker run -e` can override a baked image.
const pick = (key, fallback) => {
  const env = process.env[key];
  if (env !== undefined && env !== "") return env;
  const val = file[key];
  return val === undefined || val === "" ? fallback : val;
};

const bool = (key, fallback) => {
  const v = pick(key, fallback);
  if (typeof v === "boolean") return v;
  return String(v).toLowerCase() === "true";
};

const ROOT = path.join(__dirname, "..");

const settings = {
  SESSION_ID: String(pick("SESSION_ID", "")).trim(),
  OWNER_NUMBER: String(pick("OWNER_NUMBER", "")).replace(/[^0-9]/g, ""),
  OWNER_NAME: pick("OWNER_NAME", "David"),
  BOT_NAME: pick("BOT_NAME", "David-md"),
  PREFIX: pick("PREFIX", "."),
  MODE: String(pick("MODE", "private")).toLowerCase() === "public" ? "public" : "private",

  REJECT_CALLS: bool("REJECT_CALLS", false),
  ALWAYS_ONLINE: bool("ALWAYS_ONLINE", false),
  AUTO_REACT: bool("AUTO_REACT", true),

  STICKER_PACK: pick("STICKER_PACK", "David-md"),
  STICKER_AUTHOR: pick("STICKER_AUTHOR", "David"),

  ANTHROPIC_API_KEY: String(pick("ANTHROPIC_API_KEY", "")).trim(),
  DATABASE_URL: String(pick("DATABASE_URL", "")).trim(),

  HEROKU_API_KEY: String(pick("HEROKU_API_KEY", "")).trim(),
  HEROKU_APP_NAME: String(pick("HEROKU_APP_NAME", "")).trim(),

  ROOT,
  CONFIG_FILE: path.join(ROOT, "config.js"),
  SESSION_DIR: path.join(ROOT, "session"),
  DATA_DIR: path.join(ROOT, "data"),
  MEDIA_DIR: path.join(ROOT, "data", "media"),
  PLUGIN_DIR: path.join(ROOT, "plugins"),
  TMP_DIR: path.join(ROOT, "data", "tmp"),

  VERSION: require(path.join(ROOT, "package.json")).version,
  REPO: "dave-programmer01/david-md",
  PLACEHOLDER,
};

settings.isPlaceholder = !settings.SESSION_ID || settings.SESSION_ID === PLACEHOLDER;

module.exports = settings;
