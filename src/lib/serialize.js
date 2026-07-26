const { jidNormalizedUser } = require("@whiskeysockets/baileys");

/**
 * WhatsApp wraps messages in a surprising number of envelopes — disappearing
 * chats, view-once, documents-with-caption and edits all nest the real payload
 * one or more levels down. Everything downstream (commands, anti-* hooks,
 * media download) should only ever see the unwrapped inner message.
 */
function unwrap(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    if (m.ephemeralMessage) { m = m.ephemeralMessage.message; continue; }
    if (m.viewOnceMessage) { m = m.viewOnceMessage.message; continue; }
    if (m.viewOnceMessageV2) { m = m.viewOnceMessageV2.message; continue; }
    if (m.viewOnceMessageV2Extension) { m = m.viewOnceMessageV2Extension.message; continue; }
    if (m.documentWithCaptionMessage) { m = m.documentWithCaptionMessage.message; continue; }
    if (m.editedMessage) { m = m.editedMessage.message; continue; }
    if (m.protocolMessage?.editedMessage) { m = m.protocolMessage.editedMessage; continue; }
    break;
  }
  return m || {};
}

const MEDIA_TYPES = [
  "imageMessage", "videoMessage", "audioMessage",
  "stickerMessage", "documentMessage",
];

function typeOf(message) {
  const keys = Object.keys(message || {});
  return keys.find((k) => k !== "messageContextInfo" && k !== "senderKeyDistributionMessage") || "unknown";
}

/** Pull display text out of whatever shape the message happens to be. */
function textOf(message, type) {
  const m = message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m[type]?.caption ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.templateButtonReplyMessage?.selectedId ||
    m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
    m.reactionMessage?.text ||
    ""
  );
}

/**
 * Normalise a raw Baileys message into a flat object.
 * Returns null for messages with nothing usable in them.
 */
function serialize(sock, raw) {
  if (!raw?.message || !raw.key) return null;

  const message = unwrap(raw.message);
  const type = typeOf(message);
  const chat = raw.key.remoteJid;
  const isGroup = chat?.endsWith("@g.us");
  const fromMe = !!raw.key.fromMe;

  const botJid = jidNormalizedUser(sock?.user?.id || "");
  const sender = isGroup
    ? jidNormalizedUser(raw.key.participant || raw.participant || "")
    : fromMe
      ? botJid
      : jidNormalizedUser(chat || "");

  /**
   * WhatsApp addresses users two ways now — a phone-number JID
   * (@s.whatsapp.net) and an anonymised LID (@lid) — and a group uses one or
   * the other depending on its addressingMode. The two never compare equal, so
   * anything matching a sender against a participant list has to try every
   * identity the message carries, not just `key.participant`.
   */
  const senderIds = [
    ...new Set(
      [
        sender,
        raw.key.participantPn,
        raw.key.participantLid,
        raw.key.senderPn,
        raw.key.senderLid,
        !isGroup ? chat : null,
      ]
        .filter(Boolean)
        .map(jidNormalizedUser)
        .filter(Boolean)
    ),
  ];

  const context =
    message.extendedTextMessage?.contextInfo ||
    message[type]?.contextInfo ||
    message.messageContextInfo ||
    {};

  // Rebuild the quoted message as a standalone, downloadable message object.
  let quoted = null;
  const quotedMsg = context.quotedMessage ? unwrap(context.quotedMessage) : null;
  if (quotedMsg) {
    const quotedType = typeOf(quotedMsg);
    const participant = jidNormalizedUser(context.participant || "");
    quoted = {
      type: quotedType,
      text: textOf(quotedMsg, quotedType),
      sender: participant,
      isMedia: MEDIA_TYPES.includes(quotedType),
      message: quotedMsg,
      // Shape expected by downloadMediaMessage()
      key: {
        remoteJid: chat,
        id: context.stanzaId,
        participant: isGroup ? participant : undefined,
        fromMe: participant === botJid,
      },
      raw: { key: { remoteJid: chat, id: context.stanzaId, participant, fromMe: participant === botJid }, message: quotedMsg },
    };
  }

  const body = textOf(message, type);

  return {
    raw,
    key: raw.key,
    id: raw.key.id,
    chat,
    isGroup,
    isDM: !isGroup,
    fromMe,
    sender,
    senderIds,
    pushName: raw.pushName || "",
    timestamp: Number(raw.messageTimestamp || 0) * 1000,
    type,
    message,
    body,
    isMedia: MEDIA_TYPES.includes(type),
    mentions: (context.mentionedJid || []).map(jidNormalizedUser),
    quoted,
    // View-once needs the pre-unwrap payload, which is what `.vv` reads.
    isViewOnce: !!(raw.message.viewOnceMessage || raw.message.viewOnceMessageV2 || raw.message.viewOnceMessageV2Extension),
  };
}

module.exports = { serialize, unwrap, typeOf, textOf, MEDIA_TYPES };
