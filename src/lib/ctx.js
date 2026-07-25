const { downloadMediaMessage, jidNormalizedUser } = require("@whiskeysockets/baileys");
const S = require("../settings");
const db = require("../db");
const { LRU } = require("./cache");

// groupMetadata() is a network round-trip. Calling it per message on a busy
// account is a fast route to being rate-limited by WhatsApp, so it is cached.
const metaCache = new LRU({ max: 200, ttl: 60_000 });

const numberOf = (jid) => String(jid || "").split("@")[0].split(":")[0];
const toJid = (number) => `${String(number).replace(/[^0-9]/g, "")}@s.whatsapp.net`;

async function groupMetadata(sock, jid, { fresh = false } = {}) {
  if (fresh) metaCache.delete(jid);
  return metaCache.fetch(jid, () => sock.groupMetadata(jid));
}

async function buildContext({ sock, m, command = null, args = [], text = "", prefix = "." }) {
  const botJid = jidNormalizedUser(sock.user?.id || "");
  const ownerNumber = String((await db.get("ownerNumber")) || "").replace(/[^0-9]/g, "");
  const sudoList = await db.raw().all(db.SUDO);

  const senderNumber = numberOf(m.sender);
  const isOwner = m.fromMe || (!!ownerNumber && senderNumber === ownerNumber);
  const isSudo = isOwner || !!sudoList[m.sender];

  let groupMeta = null;
  let isAdmin = false;
  let isBotAdmin = false;
  let participants = [];

  if (m.isGroup) {
    try {
      groupMeta = await groupMetadata(sock, m.chat);
      participants = groupMeta.participants || [];
      const find = (jid) => participants.find((p) => jidNormalizedUser(p.id) === jid);
      const senderEntry = find(m.sender);
      const botEntry = find(botJid);
      isAdmin = ["admin", "superadmin"].includes(senderEntry?.admin) || isOwner;
      isBotAdmin = ["admin", "superadmin"].includes(botEntry?.admin);
    } catch {
      // Metadata can fail transiently; commands that need it check isBotAdmin
      // and report a clear message rather than throwing.
    }
  }

  const ctx = {
    sock, m, command, args, prefix,
    text: text || args.join(" "),
    chat: m.chat,
    chatId: m.chat,
    sender: m.sender,
    senderNumber,
    pushName: m.pushName || senderNumber,
    botJid,
    isGroup: m.isGroup,
    isDM: !m.isGroup,
    isOwner, isSudo, isAdmin, isBotAdmin,
    groupMeta, participants,
    quoted: m.quoted,
    mentions: m.mentions,
    db, settings: S,

    /** Everyone the command should act on: mentions, a reply, or a raw number. */
    targets() {
      const out = new Set(m.mentions || []);
      if (m.quoted?.sender) out.add(m.quoted.sender);
      for (const arg of args) {
        const digits = arg.replace(/[^0-9]/g, "");
        if (digits.length >= 7) out.add(toJid(digits));
      }
      return [...out];
    },

    reply(content, options = {}) {
      const payload = typeof content === "string" ? { text: content } : content;
      return sock.sendMessage(m.chat, payload, { quoted: m.raw, ...options });
    },

    send(jid, content, options = {}) {
      const payload = typeof content === "string" ? { text: content } : content;
      return sock.sendMessage(jid, payload, options);
    },

    async react(emoji) {
      try {
        await sock.sendMessage(m.chat, { react: { text: emoji, key: m.key } });
      } catch {
        // Reactions are cosmetic — never let one failing break a command.
      }
    },

    /** Download the media on this message, or on the message it replies to. */
    async download(target = null) {
      const src = target || (m.isMedia ? m.raw : m.quoted?.raw);
      if (!src) return null;
      return downloadMediaMessage(src, "buffer", {});
    },

    /** The media message this command should operate on, if any. */
    media() {
      if (m.isMedia) return { raw: m.raw, type: m.type, message: m.message };
      if (m.quoted?.isMedia) return { raw: m.quoted.raw, type: m.quoted.type, message: m.quoted.message };
      return null;
    },

    groupSettings: () => db.group(m.chat),
    setGroupSetting: (key, value) => db.setGroup(m.chat, key, value),
    refreshGroup: () => groupMetadata(sock, m.chat, { fresh: true }),
  };

  return ctx;
}

module.exports = { buildContext, groupMetadata, metaCache, numberOf, toJid };
