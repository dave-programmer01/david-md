const crypto = require("crypto");
const db = require("../../db");
const registry = require("../../lib/registry");

const CATEGORY = "Utility";
const COLLECTION = "stickcmd";

/**
 * Bind a sticker to a command: send that sticker and the command runs.
 * Stickers are identified by the SHA-256 of their file, which WhatsApp already
 * carries on the message — no need to download the image to recognise it.
 */
const hashOf = (message) => {
  const sticker = message?.stickerMessage;
  if (!sticker?.fileSha256) return null;
  return Buffer.from(sticker.fileSha256).toString("hex");
};

module.exports = [
  {
    name: "stickcmd",
    category: CATEGORY,
    desc: "Make a sticker run a command",
    usage: "Reply to a sticker with .stickcmd menu",
    permission: "sudo",
    execute: async (ctx) => {
      const hash = hashOf(ctx.quoted?.message);
      if (!hash) return ctx.reply(`Reply to a *sticker* with *${ctx.prefix}stickcmd <command>*.`);

      const command = ctx.text.trim().replace(new RegExp(`^\\${ctx.prefix}`), "");
      if (!command) {
        return ctx.reply(
          `*Usage:* reply to a sticker with\n${ctx.prefix}stickcmd menu\n\n` +
            `_After that, sending that sticker runs_ ${ctx.prefix}menu`
        );
      }

      const target = registry.resolve(command.split(/\s+/)[0]);
      if (!target) return ctx.reply(`❌ There's no command called *${command.split(/\s+/)[0]}*.`);

      await db.raw().set(COLLECTION, hash, { command, by: ctx.sender, at: Date.now() });
      return ctx.reply(`✅ That sticker now runs *${ctx.prefix}${command}*.\n\n_Send it to try._`);
    },
  },

  {
    name: "unstick",
    category: CATEGORY,
    desc: "Unbind a sticker from its command",
    usage: "Reply to the sticker with .unstick",
    permission: "sudo",
    execute: async (ctx) => {
      const hash = hashOf(ctx.quoted?.message);
      if (!hash) return ctx.reply(`Reply to the sticker with *${ctx.prefix}unstick*.`);

      const existing = await db.raw().get(COLLECTION, hash, null);
      if (!existing) return ctx.reply("That sticker isn't bound to anything.");

      await db.raw().del(COLLECTION, hash);
      return ctx.reply(`🗑️ Unbound. It no longer runs *${ctx.prefix}${existing.command}*.`);
    },
  },

  {
    name: "getstick",
    category: CATEGORY,
    desc: "List every sticker bound to a command",
    usage: ".getstick",
    permission: "sudo",
    execute: async (ctx) => {
      const all = await db.raw().all(COLLECTION);
      const entries = Object.entries(all);

      if (!entries.length) {
        return ctx.reply(
          `No sticker commands yet.\n\n` +
            `Reply to a sticker with:\n${ctx.prefix}stickcmd menu`
        );
      }

      const lines = entries.map(([hash, entry], i) => {
        const when = entry.at ? new Date(entry.at).toLocaleDateString() : "";
        return `┃◬│ ${i + 1}. ${ctx.prefix}${entry.command}\n┃◬│    _${hash.slice(0, 12)}…${when ? ` · ${when}` : ""}_`;
      });

      return ctx.reply(
        `╭═══〘 *Sticker commands* 〙═══⊷❍\n${lines.join("\n")}\n╰═════════════════⊷\n\n` +
          `_Reply to one with_ ${ctx.prefix}unstick _to remove it._`
      );
    },
  },
];

module.exports.hashOf = hashOf;
module.exports.COLLECTION = COLLECTION;
