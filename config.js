// ═══════════════════════════════════════════════════════════════════════
//
//    ██████╗  █████╗ ██╗   ██╗██╗██████╗       ███╗   ███╗██████╗
//    ██╔══██╗██╔══██╗██║   ██║██║██╔══██╗      ████╗ ████║██╔══██╗
//    ██║  ██║███████║╚██╗ ██╔╝██║██║  ██║█████╗██╔████╔██║██║  ██║
//    ██║  ██║██╔══██║ ╚████╔╝ ██║██║  ██║╚════╝██║╚██╔╝██║██║  ██║
//    ██████╔╝██║  ██║  ╚██╔╝  ██║██████╔╝      ██║ ╚═╝ ██║██████╔╝
//    ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝       ╚═╝     ╚═╝╚═════╝
//
//   THIS IS THE ONLY FILE YOU NEED TO EDIT.
//
//   1. Get your SESSION ID from https://david-pair-x6t8.onrender.com
//   2. Paste it between the quotes on the SESSION_ID line below.
//   3. Save this file, then deploy. That's it.
//
// ═══════════════════════════════════════════════════════════════════════
//
//   ⚠️  YOUR SESSION ID IS A FULL WHATSAPP LOGIN.
//
//   Anyone who reads it can control your WhatsApp account.
//
//   • NEVER post this file, or a screenshot of it, anywhere.
//   • NEVER push it to a PUBLIC GitHub repo.
//     If you need it on GitHub (for Heroku), make a NEW PRIVATE repo.
//     Do NOT "Fork" — forks of a public repo can never be made private.
//
// ═══════════════════════════════════════════════════════════════════════

// ─── PASTE YOUR SESSION ID HERE ────────────────────────────────────────
// It is a long string that starts with "David~". Paste the WHOLE thing —
// it is around 2500 characters, so make sure you copied the very end too.

const SESSION_ID = "PASTE_YOUR_SESSION_ID_HERE";

// ─── YOUR DETAILS ──────────────────────────────────────────────────────

// Your WhatsApp number: country code + number, digits only.
// No "+", no spaces, no dashes.   Example: "2348012345678"
const OWNER_NUMBER = "";

// The name the bot shows as its owner.
const OWNER_NAME = "David";

// What your bot calls itself.
const BOT_NAME = "David-md";

// ─── BEHAVIOUR ─────────────────────────────────────────────────────────

// The character you type before every command.  "." means you type ".ping"
const PREFIX = ".";

// "private" → only YOU can use the bot.
// "public"  → anyone in any chat can use it.
const MODE = "private";

// Automatically reject incoming calls.
const REJECT_CALLS = false;

// Show as "online" all the time.
const ALWAYS_ONLINE = false;

// React with ⏳ / ✅ while a command runs.
const AUTO_REACT = true;

// Default sticker pack name / author (change with .setstickername in chat).
const STICKER_PACK = "David-md";
const STICKER_AUTHOR = "David";

// ─── OPTIONAL: AI COMMANDS ─────────────────────────────────────────────
// Needed only for .ai and .chatbot.  Get a key at console.anthropic.com
// Leave empty if you don't want them — every other command still works.

const ANTHROPIC_API_KEY = "";

// ─── OPTIONAL: DATABASE ────────────────────────────────────────────────
// Leave empty and your settings are saved to files in the data/ folder.
// That is what you want on a VPS, a panel, or Docker.
//
// ONLY fill this in if you deploy on HEROKU, because Heroku deletes all
// files every day — without a database your settings would reset daily.
// Paste a Postgres URL (postgres://user:pass@host:5432/dbname).

const DATABASE_URL = "";

// ═══════════════════════════════════════════════════════════════════════
//   Nothing below this line needs to be changed.
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
  SESSION_ID,
  OWNER_NUMBER,
  OWNER_NAME,
  BOT_NAME,
  PREFIX,
  MODE,
  REJECT_CALLS,
  ALWAYS_ONLINE,
  AUTO_REACT,
  STICKER_PACK,
  STICKER_AUTHOR,
  ANTHROPIC_API_KEY,
  DATABASE_URL,
};
