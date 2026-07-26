const { downloadMediaMessage, jidNormalizedUser, areJidsSameUser } = require("@whiskeysockets/baileys");
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

/**
 * Every identity one participant can be addressed by.
 *
 * A group is either phone-number-addressed or LID-addressed, and the two
 * formats never compare equal — so matching on `participant.id` alone misses
 * whenever the group's addressing mode differs from the identity you hold.
 * That failure is silent, and it reads as "you are not an admin".
 */
const identitiesOf = (participant) =>
  [participant?.id, participant?.jid, participant?.lid]
    .filter(Boolean)
    .map(jidNormalizedUser)
    .filter(Boolean);

/** True if any identity on the left refers to the same person as any on the right. */
function sameUser(left, right) {
  const a = (Array.isArray(left) ? left : [left]).filter(Boolean);
  const b = (Array.isArray(right) ? right : [right]).filter(Boolean);
  for (const x of a) {
    for (const y of b) {
      if (x === y) return true;
      // Also covers the device suffix (…:12@s.whatsapp.net).
      try {
        if (areJidsSameUser(x, y)) return true;
      } catch {}
    }
  }
  return false;
}

/** Find a participant by any identity they might be known under. */
const findParticipant = (participants, identities) =>
  (participants || []).find((p) => sameUser(identitiesOf(p), identities));

async function buildContext({ sock, m, command = null, args = [], text = "", prefix = "." }) {
  const botJid = jidNormalizedUser(sock.user?.id || "");
  // The bot has both identities too, and which one appears in a group's
  // participant list depends on that group's addressing mode.
  const botIds = [botJid, sock.user?.lid].filter(Boolean).map(jidNormalizedUser);
  const ownerNumber = String((await db.get("ownerNumber")) || "").replace(/[^0-9]/g, "");
  const sudoList = await db.raw().all(db.SUDO);

  // Every way this sender might be addressed — phone JID, LID, device-suffixed.
  const senderIds = m.senderIds?.length ? m.senderIds : [m.sender].filter(Boolean);
  const senderNumber = numberOf(m.sender);

  const isOwner =
    m.fromMe ||
    sameUser(senderIds, botIds) ||
    (!!ownerNumber && senderIds.some((jid) => numberOf(jid) === ownerNumber));
  const isSudo = isOwner || senderIds.some((jid) => !!sudoList[jid]);

  let groupMeta = null;
  let isAdmin = false;
  let isBotAdmin = false;
  let participants = [];

  if (m.isGroup) {
    try {
      groupMeta = await groupMetadata(sock, m.chat);
      participants = groupMeta.participants || [];
      const senderEntry = findParticipant(participants, senderIds);
      const botEntry = findParticipant(participants, botIds);
      isAdmin = ["admin", "superadmin"].includes(senderEntry?.admin) || isOwner;
      isBotAdmin = ["admin", "superadmin"].includes(botEntry?.admin);

      // A miss here is the difference between "you're not an admin" and "I
      // couldn't tell", and the two need very different fixes.
      if (!senderEntry && process.env.DEBUG_ADMIN === "1") {
        console.log(
          `🔍 sender not in participant list (group addressingMode=${groupMeta.addressingMode}).\n` +
            `   looked for: ${senderIds.join(", ")}\n` +
            `   list has  : ${participants.slice(0, 3).map((p) => identitiesOf(p).join("/")).join(" | ")}…`
        );
      }
    } catch (err) {
      // Metadata can fail transiently; commands that need it check isBotAdmin
      // and report a clear message rather than throwing.
      if (process.env.DEBUG_ADMIN === "1") console.log(`🔍 groupMetadata failed: ${err.message}`);
    }
  }

  const ctx = {
    sock, m, command, args, prefix,
    text: text || args.join(" "),
    chat: m.chat,
    chatId: m.chat,
    sender: m.sender,
    senderIds,
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

module.exports = {
  buildContext, groupMetadata, metaCache, numberOf, toJid,
  identitiesOf, sameUser, findParticipant,
};
