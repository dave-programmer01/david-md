const fs = require("fs");
const path = require("path");
const S = require("../settings");

// Fixed order — this is what the menu prints, top to bottom.
const CATEGORY_ORDER = [
  "General", "Owner", "Settings", "Group", "Utility", "Search",
  "Edit", "Misc", "Converters", "System", "Download", "Whatsapp",
];

const PERMISSIONS = new Set(["public", "group", "admin", "botAdmin", "owner", "sudo"]);

/**
 * The order commands appear inside their category in the menu.
 *
 * Files are loaded alphabetically, which would scatter related commands, so
 * this fixes the listing to the layout the menu was designed around. Anything
 * not listed here (a plugin, say) falls to the end of its category.
 */
const MENU_ORDER = [
  // General
  "setvar", "getvar", "delvar", "setenv", "delsudo", "afk", "autodl", "chatbot",
  "ai", "info", "list", "alive", "setalive", "games", "wcg", "gif", "rotate", "flip",
  "mention", "reload", "reboot", "delete",
  // Owner
  "allvar", "settings", "setsudo", "getsudo", "callreject", "install", "plugin",
  "remove", "pupdate", "ban", "unban", "banlist", "block", "join", "unblock",
  "pp", "gpp", "update",
  // Settings
  "setprefix", "platform", "language", "mode", "antidelete", "setinfo", "setname",
  "setowner", "setownernumber", "setimage", "setstickername", "setstickerauthor",
  // Group
  "toggle", "antibot", "antispam", "pdm", "antidemote", "antipromote", "antilink",
  "antiword", "automute", "autounmute", "getmute", "antifake", "kick", "fumigate",
  "add", "promote", "requests", "leave", "quoted", "demote", "mute", "unmute",
  "jid", "invite", "revoke", "glock", "gunlock", "gname", "gdesc", "common", "tag",
  "gstatus", "msgs", "inactive", "warn", "warnings", "rmwarn", "resetwarn",
  "warnlist", "setwarnlimit", "warnstats", "welcome", "goodbye", "testwelcome",
  "testgoodbye",
  // Utility
  "uptime", "menu", "testalive", "attp", "tts", "upload", "fancy", "filter",
  "filters", "delfilter", "togglefilter", "testfilter", "filterhelp", "stickcmd",
  "unstick", "getstick", "diff", "getjids", "users", "schedule", "scheduled",
  "cancel", "age", "cntd", "ping", "vv",
  // Search
  "img", "find", "ig",
  // Edit
  "sticker", "mp3", "slow", "sped", "bass", "photo", "doc", "square", "resize",
  "compress", "trim", "black", "avmix", "vmix", "slowmo", "circle", "interp",
  "take", "mp4", "url",
  // Misc / Converters / System
  "clear", "retry", "pdf", "restart",
  // Download
  "insta", "fb", "story", "pinterest", "tiktok", "song", "yts", "ytv", "video",
  "yta", "play", "spotify",
  // Whatsapp
  "react", "edit", "send", "forward",
];

const ORDER_INDEX = new Map(MENU_ORDER.map((name, i) => [name, i]));
const rank = (cmd) => ORDER_INDEX.get(cmd.name) ?? Number.MAX_SAFE_INTEGER;

const commands = new Map(); // name -> command
const aliases = new Map();  // alias -> name

function validate(cmd, source) {
  const where = path.relative(S.ROOT, source);
  if (!cmd || typeof cmd !== "object") throw new Error(`${where}: export is not a command object`);
  if (!cmd.name) throw new Error(`${where}: command is missing a name`);
  if (typeof cmd.execute !== "function") throw new Error(`${where}: "${cmd.name}" has no execute()`);
  if (!CATEGORY_ORDER.includes(cmd.category)) {
    throw new Error(`${where}: "${cmd.name}" has category "${cmd.category}" — must be one of ${CATEGORY_ORDER.join(", ")}`);
  }
  if (cmd.permission && !PERMISSIONS.has(cmd.permission)) {
    throw new Error(`${where}: "${cmd.name}" has unknown permission "${cmd.permission}"`);
  }
  if (commands.has(cmd.name)) throw new Error(`${where}: duplicate command name "${cmd.name}"`);
  if (aliases.has(cmd.name)) throw new Error(`${where}: "${cmd.name}" collides with an existing alias`);
  for (const a of cmd.aliases || []) {
    if (commands.has(a) || aliases.has(a)) throw new Error(`${where}: duplicate alias "${a}" on "${cmd.name}"`);
  }
}

function register(cmd, source) {
  validate(cmd, source);
  cmd.permission = cmd.permission || "public";
  cmd.aliases = cmd.aliases || [];
  cmd.source = source;
  commands.set(cmd.name, cmd);
  for (const a of cmd.aliases) aliases.set(a, cmd.name);
  return cmd;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out.sort();
}

function loadFile(file, { strict = true } = {}) {
  delete require.cache[require.resolve(file)];
  const mod = require(file);
  // A file may export one command or an array of them. Grouping related
  // commands in one file keeps 162 of them navigable; plugins stay single.
  const list = Array.isArray(mod) ? mod : [mod];
  const loaded = [];
  for (const cmd of list) {
    try {
      loaded.push(register(cmd, file));
    } catch (err) {
      if (strict) throw err;
      console.error(`⚠️  ${err.message}`);
    }
  }
  return loaded;
}

function load() {
  commands.clear();
  aliases.clear();

  for (const file of walk(path.join(__dirname, "..", "commands"))) {
    loadFile(file, { strict: true });
  }

  // Plugins are user-installed and must never stop the bot from booting.
  for (const file of walk(S.PLUGIN_DIR)) {
    try {
      loadFile(file, { strict: false });
    } catch (err) {
      console.error(`⚠️  Plugin ${path.basename(file)} failed to load: ${err.message}`);
    }
  }

  return commands;
}

const resolve = (name) => {
  const key = String(name || "").toLowerCase();
  return commands.get(key) || commands.get(aliases.get(key)) || null;
};

const list = () => [...commands.values()];

/** Commands grouped into the fixed category order, for the menu. */
function byCategory() {
  const groups = new Map();
  for (const category of CATEGORY_ORDER) {
    const inCat = list()
      .filter((c) => c.category === category && !c.hidden)
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    if (inCat.length) groups.set(category, inCat);
  }
  return groups;
}

module.exports = {
  load, loadFile, register, resolve, list, byCategory,
  commands, aliases, CATEGORY_ORDER, PERMISSIONS, MENU_ORDER,
  get size() { return commands.size; },
};
