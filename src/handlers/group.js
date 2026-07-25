const { jidNormalizedUser } = require("@whiskeysockets/baileys");
const db = require("../db");
const { groupMetadata, metaCache } = require("../lib/ctx");

const numberOf = (jid) => String(jid || "").split("@")[0].split(":")[0];

/** Placeholders usable in welcome/goodbye text. */
function fill(template, { jid, meta }) {
  return String(template)
    .replace(/@user|\{user\}/gi, `@${numberOf(jid)}`)
    .replace(/\{group\}/gi, meta?.subject || "this group")
    .replace(/\{desc\}/gi, meta?.desc || "")
    .replace(/\{count\}/gi, String(meta?.participants?.length || 0));
}

const DEFAULT_WELCOME = "👋 Welcome @user to *{group}*!\nYou are member #{count}.";
const DEFAULT_GOODBYE = "👋 @user has left *{group}*.";

async function handleParticipantsUpdate(sock, update) {
  const { id: chat, participants, action, author } = update;
  if (!chat?.endsWith("@g.us")) return;

  // Membership just changed, so the cached participant list is stale.
  metaCache.delete(chat);

  const g = await db.group(chat);
  let meta = null;
  try {
    meta = await groupMetadata(sock, chat);
  } catch {
    // Non-fatal: greetings degrade to the JID rather than the group name.
  }

  const botJid = jidNormalizedUser(sock.user?.id || "");

  for (const rawJid of participants) {
    const jid = jidNormalizedUser(rawJid);

    if (action === "add") {
      if (g.antifake && (g.antifakePrefixes || []).length) {
        const number = numberOf(jid);
        const allowed = g.antifakePrefixes.some((p) => number.startsWith(String(p).replace(/[^0-9]/g, "")));
        if (!allowed) {
          await sock.groupParticipantsUpdate(chat, [jid], "remove").catch(() => {});
          await sock.sendMessage(chat, {
            text: `🚫 Removed @${number} — number prefix not on the allow-list.`,
            mentions: [jid],
          });
          continue;
        }
      }

      if (g.welcome) {
        const text = fill(g.welcomeText || DEFAULT_WELCOME, { jid, meta });
        await sock.sendMessage(chat, { text, mentions: [jid] }).catch(() => {});
      }
    }

    if (action === "remove" && g.goodbye) {
      const text = fill(g.goodbyeText || DEFAULT_GOODBYE, { jid, meta });
      await sock.sendMessage(chat, { text, mentions: [jid] }).catch(() => {});
    }

    if (action === "promote") {
      const byBot = jidNormalizedUser(author || "") === botJid;
      if (g.antipromote && !byBot) {
        await sock.groupParticipantsUpdate(chat, [jid], "demote").catch(() => {});
        await sock.sendMessage(chat, {
          text: `↩️ Anti-promote is on — @${numberOf(jid)} was demoted back.`,
          mentions: [jid],
        });
      } else if (g.pdm) {
        await sock.sendMessage(chat, {
          text: `⬆️ @${numberOf(jid)} is now an admin.`,
          mentions: [jid],
        });
      }
    }

    if (action === "demote") {
      const byBot = jidNormalizedUser(author || "") === botJid;
      if (g.antidemote && !byBot) {
        await sock.groupParticipantsUpdate(chat, [jid], "promote").catch(() => {});
        await sock.sendMessage(chat, {
          text: `↩️ Anti-demote is on — @${numberOf(jid)} was promoted back.`,
          mentions: [jid],
        });
      } else if (g.pdm) {
        await sock.sendMessage(chat, {
          text: `⬇️ @${numberOf(jid)} is no longer an admin.`,
          mentions: [jid],
        });
      }
    }
  }
}

/** Group subject/description/settings changed. */
async function handleGroupsUpdate(sock, updates) {
  for (const update of updates || []) {
    if (update.id) metaCache.delete(update.id);
    const g = await db.group(update.id).catch(() => null);
    if (!g?.events) continue;
    if (update.subject) {
      await sock.sendMessage(update.id, { text: `📝 Group name changed to *${update.subject}*` }).catch(() => {});
    }
    if (update.desc) {
      await sock.sendMessage(update.id, { text: `📝 Group description was updated.` }).catch(() => {});
    }
  }
}

module.exports = { handleParticipantsUpdate, handleGroupsUpdate, fill, DEFAULT_WELCOME, DEFAULT_GOODBYE };
