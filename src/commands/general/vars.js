const fs = require("fs");
const S = require("../../settings");

const CATEGORY = "General";

// Keys a user may change from chat. SESSION_ID is deliberately excluded —
// rewriting it at runtime would lock the bot out of its own account.
const EDITABLE = new Set([
  "OWNER_NUMBER", "OWNER_NAME", "BOT_NAME", "PREFIX", "MODE",
  "REJECT_CALLS", "ALWAYS_ONLINE", "AUTO_REACT",
  "STICKER_PACK", "STICKER_AUTHOR", "ANTHROPIC_API_KEY", "DATABASE_URL",
]);

const SECRET = new Set(["SESSION_ID", "ANTHROPIC_API_KEY", "DATABASE_URL", "HEROKU_API_KEY"]);

const mask = (key, value) => {
  if (!value) return "_(empty)_";
  if (!SECRET.has(key)) return value;
  const str = String(value);
  return `${str.slice(0, 6)}…${str.slice(-4)} _(${str.length} chars, hidden)_`;
};

const onHeroku = () => !!(S.HEROKU_API_KEY && S.HEROKU_APP_NAME);

async function herokuSet(updates) {
  const res = await fetch(`https://api.heroku.com/apps/${S.HEROKU_APP_NAME}/config-vars`, {
    method: "PATCH",
    headers: {
      Accept: "application/vnd.heroku+json; version=3",
      Authorization: `Bearer ${S.HEROKU_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Heroku rejected that (${res.status}). Check HEROKU_API_KEY and HEROKU_APP_NAME.`);
}

/**
 * Rewrite a `const NAME = "value";` line in config.js in place.
 *
 * A line rewrite rather than an AST transform: config.js is a fixed, flat file
 * we ship ourselves, and this keeps every comment the user reads intact.
 */
function writeConfig(key, value) {
  const source = fs.readFileSync(S.CONFIG_FILE, "utf8");
  const pattern = new RegExp(`^(\\s*const\\s+${key}\\s*=\\s*)(.*?)(;\\s*)$`, "m");
  if (!pattern.test(source)) throw new Error(`${key} isn't in config.js.`);

  const literal =
    typeof value === "boolean" || value === "true" || value === "false"
      ? String(value) === "true" || value === true
      : JSON.stringify(String(value));

  const updated = source.replace(pattern, `$1${literal}$3`);
  fs.writeFileSync(S.CONFIG_FILE, updated);
}

module.exports = [
  {
    name: "setvar",
    category: CATEGORY,
    desc: "Change a setting in config.js (survives restarts)",
    usage: ".setvar BOT_NAME=MyBot",
    permission: "owner",
    execute: async (ctx) => {
      const input = ctx.text.trim();
      const match = input.match(/^([A-Z_][A-Z0-9_]*)\s*[=:]\s*([\s\S]*)$/i);
      if (!match) {
        return ctx.reply(
          `*Usage:* ${ctx.prefix}setvar KEY=value\n\n` +
            `*You can change:*\n${[...EDITABLE].map((k) => `• ${k}`).join("\n")}`
        );
      }

      const key = match[1].toUpperCase();
      const value = match[2].trim();

      if (key === "SESSION_ID") {
        return ctx.reply(
          "❌ The session ID can't be changed from chat — it would disconnect the bot mid-command.\n\n" +
            "Edit *config.js* directly and restart."
        );
      }
      if (!EDITABLE.has(key)) {
        return ctx.reply(`❌ *${key}* isn't a setting you can change.\n\nTry: ${ctx.prefix}allvar`);
      }

      if (onHeroku()) {
        // A Heroku dyno's filesystem is wiped on every restart, so the write
        // has to go to the platform's config vars instead of config.js.
        await herokuSet({ [key]: value });
        await ctx.reply(`✅ *${key}* saved to Heroku. Restarting…`);
      } else {
        writeConfig(key, value);
        await ctx.reply(`✅ *${key}* saved to config.js. Restarting…`);
      }

      setTimeout(() => process.exit(0), 1500);
    },
  },

  {
    name: "getvar",
    category: CATEGORY,
    desc: "Show one setting's current value",
    usage: ".getvar BOT_NAME",
    permission: "owner",
    execute: async (ctx) => {
      const key = ctx.args[0]?.toUpperCase();
      if (!key) return ctx.reply(`*Usage:* ${ctx.prefix}getvar BOT_NAME`);
      if (!(key in S)) return ctx.reply(`❌ There's no setting called *${key}*.`);
      return ctx.reply(`*${key}* = ${mask(key, S[key])}`);
    },
  },

  {
    name: "setenv",
    category: CATEGORY,
    desc: "Set a value for this run only — no restart, lost on reboot",
    usage: ".setenv DEBUG_BAILEYS=1",
    permission: "owner",
    execute: async (ctx) => {
      const match = ctx.text.trim().match(/^([A-Z_][A-Z0-9_]*)\s*[=:]\s*([\s\S]*)$/i);
      if (!match) {
        return ctx.reply(
          `*Usage:* ${ctx.prefix}setenv KEY=value\n\n` +
            `Unlike *${ctx.prefix}setvar*, this takes effect immediately without a restart — ` +
            `but it is forgotten the next time the bot reboots. Good for trying something out.`
        );
      }
      const key = match[1].toUpperCase();
      process.env[key] = match[2].trim();
      return ctx.reply(
        `✅ *${key}* set for this session.\n\n` +
          `_Use ${ctx.prefix}setvar to make it permanent._`
      );
    },
  },

  {
    name: "delvar",
    category: CATEGORY,
    desc: "Clear a setting back to empty",
    usage: ".delvar ANTHROPIC_API_KEY",
    permission: "owner",
    execute: async (ctx) => {
      const key = ctx.args[0]?.toUpperCase();
      if (!key) return ctx.reply(`*Usage:* ${ctx.prefix}delvar KEY`);
      if (!EDITABLE.has(key)) return ctx.reply(`❌ *${key}* can't be cleared.`);

      if (onHeroku()) await herokuSet({ [key]: null });
      else writeConfig(key, "");

      await ctx.reply(`✅ *${key}* cleared. Restarting…`);
      setTimeout(() => process.exit(0), 1500);
    },
  },
];

module.exports.helpers = { mask, EDITABLE, SECRET, onHeroku, herokuSet, writeConfig };
