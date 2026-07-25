const { jidNormalizedUser } = require("@whiskeysockets/baileys");
const db = require("../db");
const store = require("../store");

const numberOf = (jid) => String(jid || "").split("@")[0].split(":")[0];

const MEDIA_KEYS = {
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  stickerMessage: "sticker",
  documentMessage: "document",
};

/**
 * A revoke ("delete for everyone") arrives as a protocolMessage of type 0
 * pointing at the id of the original. We keep recent messages in an LRU, so
 * if the original is still there we can repost it.
 *
 * Returns true if the message was a revoke (and so should not be routed).
 */
async function maybeHandleRevoke(sock, m) {
  if (m.type !== "protocolMessage") return false;
  const proto = m.message?.protocolMessage;
  if (!proto || proto.type !== 0) return false;

  const setting = await db.get("antidelete");
  if (!setting || setting === "off") return true;

  const original = store.messageCache.get(proto.key?.id);
  if (!original || original.fromMe) return true;

  // "dm" sends recovered messages privately to the owner instead of putting
  // them back in the chat, which is less confrontational in groups.
  let destination = m.chat;
  if (setting === "dm" || setting === "owner") {
    const owner = String(await db.get("ownerNumber")).replace(/[^0-9]/g, "");
    if (!owner) return true;
    destination = `${owner}@s.whatsapp.net`;
  }

  const deleter = jidNormalizedUser(proto.key?.participant || m.sender || "");
  const header =
    `🗑️ *Deleted message recovered*\n` +
    `• From: @${numberOf(original.sender)}\n` +
    `• Deleted by: @${numberOf(deleter)}\n` +
    (destination !== m.chat && original.isGroup ? `• Chat: ${original.chat}\n` : "");
  const mentions = [original.sender, deleter];

  try {
    const mediaKey = MEDIA_KEYS[original.type];
    if (mediaKey) {
      const { downloadMediaMessage } = require("@whiskeysockets/baileys");
      const buffer = await downloadMediaMessage(original.raw, "buffer", {});
      const payload = { [mediaKey]: buffer, mentions };
      if (mediaKey === "document") {
        payload.mimetype = original.message.documentMessage?.mimetype || "application/octet-stream";
        payload.fileName = original.message.documentMessage?.fileName || "file";
      }
      if (mediaKey !== "sticker") payload.caption = header + (original.body ? `\n${original.body}` : "");
      await sock.sendMessage(destination, payload);
      if (mediaKey === "sticker") await sock.sendMessage(destination, { text: header, mentions });
    } else {
      await sock.sendMessage(destination, { text: `${header}\n${original.body || "(no text)"}`, mentions });
    }
  } catch (err) {
    console.error("antidelete failed:", err.message);
  }

  return true;
}

module.exports = { maybeHandleRevoke };
