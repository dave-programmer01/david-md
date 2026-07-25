const S = require("../settings");
const db = require("../db");
const store = require("../store");
const registry = require("../lib/registry");
const { serialize } = require("../lib/serialize");
const { buildContext } = require("../lib/ctx");
const hooks = require("./hooks");

const PERMISSION_MESSAGES = {
  group: "❌ This command only works inside a group.",
  admin: "❌ You need to be a group *admin* to use this.",
  botAdmin: "❌ I need to be a group *admin* to do that. Promote me and try again.",
  owner: "❌ Owner only.",
  sudo: "❌ Owner and sudo users only.",
};

function checkPermission(cmd, ctx) {
  switch (cmd.permission) {
    case "group":
      return ctx.isGroup ? null : PERMISSION_MESSAGES.group;
    case "admin":
      if (!ctx.isGroup) return PERMISSION_MESSAGES.group;
      if (!ctx.isAdmin) return PERMISSION_MESSAGES.admin;
      return null;
    case "botAdmin":
      if (!ctx.isGroup) return PERMISSION_MESSAGES.group;
      if (!ctx.isAdmin) return PERMISSION_MESSAGES.admin;
      if (!ctx.isBotAdmin) return PERMISSION_MESSAGES.botAdmin;
      return null;
    case "owner":
      return ctx.isOwner ? null : PERMISSION_MESSAGES.owner;
    case "sudo":
      return ctx.isSudo ? null : PERMISSION_MESSAGES.sudo;
    default:
      return null;
  }
}

async function handleMessageUpsert(sock, upsert) {
  if (upsert.type !== "notify") return;
  for (const raw of upsert.messages || []) {
    try {
      await handleOne(sock, raw);
    } catch (err) {
      console.error("Message handler error:", err.message);
    }
  }
}

async function handleOne(sock, raw) {
  if (raw.key?.remoteJid === "status@broadcast") return;
  if (!raw.message) return;

  const m = serialize(sock, raw);
  if (!m) return;

  // Keep a copy for antidelete before anything else can touch it.
  store.messageCache.set(m.id, m);

  // Ignore backlog delivered on reconnect — otherwise every command queued
  // while the bot was offline fires at once the moment it returns.
  if (m.timestamp && m.timestamp < store.botStartTimestamp - 60_000) return;

  // Drives "Total Users" in the menu and the `.users` command.
  if (!m.fromMe && m.sender) await db.raw().set(db.USERS, m.sender, Date.now());

  if (m.body) {
    const who = m.isGroup ? `${m.pushName || m.sender} @ group` : m.pushName || m.chat;
    console.log(`📩 ${who}: ${m.body.slice(0, 120)}`);
  }

  // Passive processing: anti-*, afk, filters, autodl, chatbot, sticker window.
  // If a hook consumed the message destructively (antilink deleted it, say),
  // there is nothing left to route.
  if (await hooks.run(sock, m)) return;

  // ── Command routing ────────────────────────────────────────────────────
  const prefix = (await db.get("prefix")) || S.PREFIX;
  const body = (m.body || "").trim();
  if (!body.startsWith(prefix)) return;

  const withoutPrefix = body.slice(prefix.length).trim();
  if (!withoutPrefix) return;

  const parts = withoutPrefix.split(/\s+/);
  const name = parts[0].toLowerCase();
  // Only the command NAME is lowercased. Args keep their original casing,
  // which is what makes `.setalive Hello World` and `.gname My Group` work.
  const args = parts.slice(1);
  const text = withoutPrefix.slice(parts[0].length).trim();

  const cmd = registry.resolve(name);
  if (!cmd) return;

  if (!m.fromMe && (await db.raw().get(db.BANNED, m.sender, false))) return;

  const ctx = await buildContext({ sock, m, command: cmd, args, text, prefix });

  // Private mode: the bot answers only its owner and sudo users.
  const mode = (await db.get("mode")) || S.MODE;
  if (mode === "private" && !ctx.isSudo) return;

  const denial = checkPermission(cmd, ctx);
  if (denial) return void (await ctx.reply(denial));

  store.lastCommand.set(m.chat, { name, args, text });

  const autoReact = (await db.get("autoReact")) && cmd.react !== false;
  try {
    if (autoReact) await ctx.react("⏳");
    await cmd.execute(ctx);
    if (autoReact) await ctx.react("✅");
  } catch (err) {
    console.error(`Command "${name}" failed:`, err);
    if (autoReact) await ctx.react("❌");
    await ctx.reply(`❌ *${prefix}${name}* failed:\n${err.message || err}`).catch(() => {});
  }
}

module.exports = { handleMessageUpsert, checkPermission };
