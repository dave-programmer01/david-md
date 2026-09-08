const db = require("../db");
const store = require("../store");
const { groupMetadata, findParticipant } = require("../lib/ctx");
const { jidNormalizedUser } = require("@whiskeysockets/baileys");

const GROUP_LINK = /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/i;
const ANY_LINK = /(https?:\/\/|www\.)\S+/i;

const numberOf = (jid) => String(jid || "").split("@")[0].split(":")[0];

/**
 * Accepts either a single JID or every identity a sender is known by, because
 * a group addressed by LID won't match a phone JID (see lib/ctx.js).
 * Getting this wrong here means admins get moderated by their own anti-link.
 */
async function isAdminIn(sock, chat, identities) {
  try {
    const meta = await groupMetadata(sock, chat);
    const entry = findParticipant(meta.participants, identities);
    return ["admin", "superadmin"].includes(entry?.admin);
  } catch {
    return false;
  }
}

async function botIsAdmin(sock, chat) {
  const ids = [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser);
  return isAdminIn(sock, chat, ids);
}

/** Delete a message, and kick or warn depending on the configured action. */
async function enforce(sock, m, action, reason) {
  const canModerate = await botIsAdmin(sock, m.chat);
  if (!canModerate) {
    await sock.sendMessage(m.chat, { text: `⚠️ ${reason}\n_(Promote me to admin so I can act on this.)_` });
    return true;
  }

  await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {});

  if (action === "kick") {
    await sock.groupParticipantsUpdate(m.chat, [m.sender], "remove").catch(() => {});
    await sock.sendMessage(m.chat, { text: `🚫 @${numberOf(m.sender)} removed — ${reason}`, mentions: [m.sender] });
  } else if (action === "warn") {
    const key = `${m.chat}:${m.sender}`;
    const entry = (await db.raw().get(db.WARNS, key, null)) || { count: 0, reasons: [] };
    entry.count += 1;
    entry.reasons.push(reason);
    await db.raw().set(db.WARNS, key, entry);
    const limit = Number(await db.get("warnLimit")) || 3;
    if (entry.count >= limit) {
      await sock.groupParticipantsUpdate(m.chat, [m.sender], "remove").catch(() => {});
      await db.raw().del(db.WARNS, key);
      await sock.sendMessage(m.chat, {
        text: `🚫 @${numberOf(m.sender)} removed — reached ${limit}/${limit} warnings.`,
        mentions: [m.sender],
      });
    } else {
      await sock.sendMessage(m.chat, {
        text: `⚠️ @${numberOf(m.sender)} warned (${entry.count}/${limit}) — ${reason}`,
        mentions: [m.sender],
      });
    }
  } else {
    await sock.sendMessage(m.chat, { text: `🗑️ Deleted — ${reason}` });
  }
  return true;
}

// ── Individual hooks. Each returns true if it consumed the message. ───────

async function stickerWindow(sock, m) {
  if (!m.isMedia) return false;
  if (!["imageMessage", "videoMessage"].includes(m.type)) return false;

  // Remember recent media so a `.sticker` sent *after* a batch of photos can
  // still find them (WhatsApp delivers the caption last for albums).
  const list = store.recentImages.get(m.chat) || [];
  list.push({ m, time: Date.now() });
  store.recentImages.set(m.chat, list.filter((i) => Date.now() - i.time < 10_000));

  // If `.sticker` was sent moments ago, convert trailing media automatically.
  const until = store.activeStickerRequests.get(m.chat);
  if (!m.body && until && until > Date.now()) {
    const { convertMediaToSticker } = require("../utils/media");
    try {
      const buffer = await require("@whiskeysockets/baileys").downloadMediaMessage(m.raw, "buffer", {});
      const sticker = await convertMediaToSticker(buffer, m.type === "videoMessage", {
        pack: await db.get("stickerPack"),
        author: await db.get("stickerAuthor"),
      });
      await sock.sendMessage(m.chat, { sticker });
    } catch (err) {
      console.error("  ↳ auto-sticker failed:", err.message);
    }
    return true;
  }
  return false;
}

async function afk(sock, m) {
  if (m.fromMe) return false;

  // Someone who was AFK just spoke — clear it.
  const own = await db.raw().get(db.AFK, m.sender, null);
  if (own) {
    await db.raw().del(db.AFK, m.sender);
    const mins = Math.round((Date.now() - own.since) / 60000);
    await sock.sendMessage(m.chat, {
      text: `👋 Welcome back @${numberOf(m.sender)} — you were away for ${mins} minute(s).`,
      mentions: [m.sender],
    });
  }

  // Someone mentioned (or replied to) a user who is AFK.
  const targets = new Set([...(m.mentions || [])]);
  if (m.quoted?.sender) targets.add(m.quoted.sender);
  for (const jid of targets) {
    const entry = await db.raw().get(db.AFK, jid, null);
    if (!entry) continue;
    const mins = Math.round((Date.now() - entry.since) / 60000);
    await sock.sendMessage(m.chat, {
      text: `💤 @${numberOf(jid)} is AFK${entry.reason ? `: ${entry.reason}` : ""}\n_Away for ${mins} minute(s)._`,
      mentions: [jid],
    });
  }
  return false;
}

async function antilink(sock, m, g) {
  if (!g.antilink || !m.body) return false;
  const pattern = g.antilinkAll ? ANY_LINK : GROUP_LINK;
  if (!pattern.test(m.body)) return false;
  if (await isAdminIn(sock, m.chat, m.senderIds || [m.sender])) return false;
  return enforce(sock, m, g.antilinkAction || "warn", "links are not allowed here");
}

async function antiword(sock, m, g) {
  if (!g.antiword || !m.body || !(g.antiwords || []).length) return false;
  const lower = m.body.toLowerCase();
  const hit = g.antiwords.find((w) => lower.includes(String(w).toLowerCase()));
  if (!hit) return false;
  if (await isAdminIn(sock, m.chat, m.senderIds || [m.sender])) return false;
  return enforce(sock, m, g.antiwordAction || "warn", "that word is blocked here");
}

async function antispam(sock, m, g) {
  if (!g.antispam) return false;
  if (await isAdminIn(sock, m.chat, m.senderIds || [m.sender])) return false;

  const key = `${m.chat}:${m.sender}`;
  const hits = (store.spamCounters.get(key) || []).filter((t) => Date.now() - t < 10_000);
  hits.push(Date.now());
  store.spamCounters.set(key, hits);

  if (hits.length < 6) return false;
  store.spamCounters.delete(key);
  return enforce(sock, m, g.antispamAction || "warn", "sending messages too fast");
}

async function antibot(sock, m, g) {
  if (!g.antibot || m.fromMe) return false;
  // Heuristic: library-generated messages use a 32-char hex id or the Baileys
  // default "3EB0" prefix, where real WhatsApp clients use shorter ids. It is
  // a heuristic, not a guarantee — hence opt-in per group.
  const id = m.id || "";
  const looksAutomated = /^3EB0/.test(id) || (id.length >= 32 && /^[0-9A-F]+$/.test(id));
  if (!looksAutomated) return false;
  if (await isAdminIn(sock, m.chat, m.senderIds || [m.sender])) return false;
  return enforce(sock, m, "kick", "bots are not allowed here");
}

/**
 * Word Chain Game input: a `join` during the lobby, or the current player's
 * answer during a turn. Runs before the anti-* hooks so a perfectly good game
 * word can't be caught by anti-word, and consumes the message so it isn't also
 * routed as a command or an AFK trigger.
 */
async function wcgInput(sock, m) {
  const wcg = require("../utils/wcg");
  if (!wcg.games.has(m.chat)) return false;

  const body = (m.body || "").trim();

  if (wcg.isJoinable(m.chat) && /^join$/i.test(body)) {
    const result = wcg.addPlayer(m.chat, m.sender, m.pushName || m.sender.split("@")[0]);
    if (result && !result.already) {
      await sock.sendMessage(m.chat, {
        text: `✅ @${m.sender.split("@")[0].split(":")[0]} joined (${result.count} in).`,
        mentions: [m.sender],
      });
    }
    return true;
  }

  // submitAnswer only consumes the message when it's actually this player's
  // turn; everyone else's chatter passes straight through.
  return wcg.submitAnswer(m.chat, m);
}

/** A sticker bound with `.stickcmd` acts as a shortcut for that command. */
async function stickerCommand(sock, m) {
  if (m.type !== "stickerMessage") return false;

  const { hashOf, COLLECTION } = require("../commands/utility/stickcmd");
  const hash = hashOf(m.message);
  if (!hash) return false;

  const bound = await db.raw().get(COLLECTION, hash, null);
  if (!bound) return false;

  const registry = require("../lib/registry");
  const [name, ...args] = String(bound.command).trim().split(/\s+/);
  const command = registry.resolve(name.toLowerCase());
  if (!command) return false;

  const { buildContext } = require("../lib/ctx");
  const prefix = (await db.get("prefix")) || ".";
  const ctx = await buildContext({
    sock, m, command, args, text: args.join(" "), prefix,
  });

  const { checkPermission } = require("./message");
  const denial = checkPermission(command, ctx);
  if (denial) {
    await ctx.reply(denial);
    return true;
  }

  try {
    await command.execute(ctx);
  } catch (err) {
    await ctx.reply(`❌ *${prefix}${name}* failed:\n${err.message}`).catch(() => {});
  }
  return true;
}

async function filters(sock, m) {
  if (!m.body) return false;
  const set = (await db.raw().get(db.FILTERS, m.chat, null)) || {};
  const lower = m.body.toLowerCase();
  for (const [keyword, f] of Object.entries(set)) {
    if (f.on === false) continue;
    const match = f.exact ? lower === keyword.toLowerCase() : lower.includes(keyword.toLowerCase());
    if (match) {
      await sock.sendMessage(m.chat, { text: f.response }, { quoted: m.raw });
      return false; // informational, not destructive — let routing continue
    }
  }
  return false;
}

async function autodl(sock, m) {
  if (!(await db.get("autodl")) || !m.body) return false;
  const { detect } = require("../utils/providers");
  const match = detect(m.body);
  if (!match) return false;
  try {
    const { download } = require("../utils/providers");
    const result = await download(match.provider, match.url);
    if (result) await sock.sendMessage(m.chat, result, { quoted: m.raw });
  } catch (err) {
    console.error("autodl failed:", err.message);
  }
  return false;
}

async function chatbot(sock, m) {
  if (!(await db.get("chatbot")) || m.fromMe || !m.body) return false;
  const prefix = await db.get("prefix");
  if (m.body.startsWith(prefix)) return false;
  // In groups the bot only answers when spoken to, otherwise it would reply
  // to every single message in the group.
  const botJid = jidNormalizedUser(sock.user?.id || "");
  if (m.isGroup && !(m.mentions || []).includes(botJid) && m.quoted?.sender !== botJid) return false;

  try {
    const { chat } = require("../utils/providers/ai");
    const answer = await chat(m.body, m.sender);
    if (answer) await sock.sendMessage(m.chat, { text: answer }, { quoted: m.raw });
  } catch (err) {
    console.error("chatbot failed:", err.message);
  }
  return false;
}

// One AutoAI turn at a time per chat.
const autoAiBusy = new Set();

/**
 * AutoAI: replying to one of the bot's own messages talks to the assistant,
 * which can answer or run a command on the sender's behalf. Mentioning the bot
 * in a group counts too — that's the other way people address it.
 *
 * This consumes the message so `chatbot` can't answer the same one twice;
 * where both are on, AutoAI is the one that handles being spoken to and
 * `chatbot` keeps its DM small talk.
 */
async function autoAi(sock, m) {
  if (!(await db.get("autoai")) || !m.body) return false;

  // Not `m.fromMe`: the owner talks to the bot from their own account, so their
  // replies arrive flagged as the bot's. What must be skipped is the bot's own
  // output — otherwise every answer it sends is a reply to itself.
  if (store.ownMessages.has(m.id)) return false;

  const prefix = (await db.get("prefix")) || ".";
  if (m.body.startsWith(prefix)) return false; // that's a command, not a question

  const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser);
  const addressed =
    botIds.includes(m.quoted?.sender) || (m.mentions || []).some((jid) => botIds.includes(jid));
  if (!addressed) return false;

  const autoai = require("../utils/providers/autoai");

  // A turn can run several commands and take a while. One at a time per chat,
  // so a second message mid-answer queues behind it instead of racing it.
  if (autoAiBusy.has(m.chat)) return false;
  autoAiBusy.add(m.chat);

  try {
    const { buildContext } = require("../lib/ctx");
    const registry = require("../lib/registry");
    const ctx = await buildContext({
      sock, m, command: registry.resolve("autoai"), text: m.body, prefix,
    });
    const answer = await autoai.run(ctx, m.body);
    if (answer) await sock.sendMessage(m.chat, { text: answer }, { quoted: m.raw });
  } catch (err) {
    console.error("autoai failed:", err.message);
    await sock.sendMessage(m.chat, { text: `❌ ${err.message}` }, { quoted: m.raw }).catch(() => {});
  } finally {
    autoAiBusy.delete(m.chat);
  }
  return true;
}

/** Run every passive hook. Returns true when the message was consumed. */
async function run(sock, m) {
  const { maybeHandleRevoke } = require("./antidelete");
  if (await maybeHandleRevoke(sock, m)) return true;

  if (await wcgInput(sock, m)) return true;
  if (await stickerCommand(sock, m)) return true;
  if (await stickerWindow(sock, m)) return true;

  if (m.isGroup) {
    const g = await db.group(m.chat);
    if (await antilink(sock, m, g)) return true;
    if (await antiword(sock, m, g)) return true;
    if (await antispam(sock, m, g)) return true;
    if (await antibot(sock, m, g)) return true;
  }

  await afk(sock, m);
  await filters(sock, m);
  await autodl(sock, m);
  if (await autoAi(sock, m)) return true;
  await chatbot(sock, m);
  return false;
}

module.exports = { run, enforce, isAdminIn, botIsAdmin, GROUP_LINK, ANY_LINK };
