const { numberOf } = require("../../lib/ctx");

const CATEGORY = "Owner";

module.exports = [
  {
    name: "block",
    category: CATEGORY,
    desc: "Block someone on WhatsApp",
    usage: ".block @user",
    permission: "owner",
    execute: async (ctx) => {
      const targets = ctx.targets();
      if (!targets.length) return ctx.reply(`Reply to someone or mention them:\n${ctx.prefix}block @user`);

      for (const jid of targets) await ctx.sock.updateBlockStatus(jid, "block");
      return ctx.reply(`🚫 Blocked ${targets.map((j) => `@${numberOf(j)}`).join(", ")}`, { mentions: targets });
    },
  },

  {
    name: "unblock",
    category: CATEGORY,
    desc: "Unblock someone",
    usage: ".unblock 2348012345678",
    permission: "owner",
    execute: async (ctx) => {
      const targets = ctx.targets();
      if (!targets.length) return ctx.reply(`*Usage:* ${ctx.prefix}unblock 2348012345678`);

      for (const jid of targets) await ctx.sock.updateBlockStatus(jid, "unblock");
      return ctx.reply(`✅ Unblocked ${targets.map((j) => `@${numberOf(j)}`).join(", ")}`, { mentions: targets });
    },
  },

  {
    name: "pp",
    aliases: ["setpp"],
    category: CATEGORY,
    desc: "Change the bot's profile picture",
    usage: "Reply to an image with .pp",
    permission: "owner",
    execute: async (ctx) => {
      const target = ctx.media();
      if (!target || target.type !== "imageMessage") {
        return ctx.reply(`❌ Reply to an image with *${ctx.prefix}pp*.`);
      }
      const buffer = await ctx.download(target.raw);
      await ctx.sock.updateProfilePicture(ctx.botJid, buffer);
      return ctx.reply("✅ Profile picture updated.");
    },
  },

  {
    name: "gpp",
    aliases: ["setgpp"],
    category: CATEGORY,
    desc: "Change this group's picture",
    usage: "Reply to an image with .gpp",
    permission: "botAdmin",
    execute: async (ctx) => {
      const target = ctx.media();
      if (!target || target.type !== "imageMessage") {
        return ctx.reply(`❌ Reply to an image with *${ctx.prefix}gpp*.`);
      }
      const buffer = await ctx.download(target.raw);
      await ctx.sock.updateProfilePicture(ctx.chat, buffer);
      return ctx.reply("✅ Group picture updated.");
    },
  },

  {
    name: "join",
    category: CATEGORY,
    desc: "Join a group from its invite link",
    usage: ".join https://chat.whatsapp.com/XXXX",
    permission: "owner",
    execute: async (ctx) => {
      const match = ctx.text.match(/chat\.whatsapp\.com\/([A-Za-z0-9]{10,})/);
      if (!match) {
        return ctx.reply(`*Usage:* ${ctx.prefix}join https://chat.whatsapp.com/XXXXXXXX`);
      }
      try {
        const groupId = await ctx.sock.groupAcceptInvite(match[1]);
        const meta = await ctx.sock.groupMetadata(groupId).catch(() => null);
        return ctx.reply(`✅ Joined *${meta?.subject || groupId}*`);
      } catch (err) {
        return ctx.reply(
          `❌ Couldn't join: ${err.message}\n\n_The link may have expired, or I may already be a member._`
        );
      }
    },
  },
];
