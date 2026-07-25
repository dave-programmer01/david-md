const { toJid, numberOf } = require("../../lib/ctx");

const CATEGORY = "Whatsapp";

module.exports = [
  {
    name: "react",
    category: CATEGORY,
    desc: "React to a message with an emoji",
    usage: "Reply to a message with .react 🔥",
    permission: "public",
    react: false,
    execute: async (ctx) => {
      if (!ctx.quoted) return ctx.reply(`Reply to a message with *${ctx.prefix}react 🔥*.`);

      const emoji = ctx.text.trim();
      if (!emoji) return ctx.reply(`*Usage:* reply with ${ctx.prefix}react 🔥\n\n_Send_ ${ctx.prefix}react - _to remove one._`);

      await ctx.sock.sendMessage(ctx.chat, {
        react: { text: emoji === "-" ? "" : emoji, key: ctx.quoted.key },
      });
    },
  },

  {
    name: "edit",
    category: CATEGORY,
    desc: "Edit a message the bot sent",
    usage: "Reply to my message with .edit <new text>",
    permission: "sudo",
    execute: async (ctx) => {
      if (!ctx.quoted) return ctx.reply(`Reply to one of my messages with *${ctx.prefix}edit <new text>*.`);
      if (ctx.quoted.sender !== ctx.botJid) return ctx.reply("❌ I can only edit my own messages.");

      const text = ctx.text.trim();
      if (!text) return ctx.reply(`*Usage:* ${ctx.prefix}edit <new text>`);

      await ctx.sock.sendMessage(ctx.chat, { edit: ctx.quoted.key, text });
    },
  },

  {
    name: "send",
    aliases: ["dm"],
    category: CATEGORY,
    desc: "Send a message to someone else",
    usage: ".send 2348012345678 Hello there",
    permission: "sudo",
    execute: async (ctx) => {
      const first = ctx.args[0];
      if (!first) {
        return ctx.reply(
          `*Usage:* ${ctx.prefix}send <number> <message>\n\n` +
            `${ctx.prefix}send 2348012345678 Hello there\n\n` +
            `_You can also reply to media to forward it with a caption._`
        );
      }

      const digits = first.replace(/[^0-9]/g, "");
      if (digits.length < 7) return ctx.reply("❌ Give a full number including the country code.");

      const target = toJid(digits);
      const text = ctx.args.slice(1).join(" ").trim();
      const media = ctx.quoted?.isMedia ? ctx.quoted : null;

      if (!text && !media) return ctx.reply("❌ Nothing to send — add a message or reply to some media.");

      if (media) {
        const buffer = await ctx.download(media.raw);
        const KIND = {
          imageMessage: "image", videoMessage: "video",
          audioMessage: "audio", stickerMessage: "sticker", documentMessage: "document",
        };
        const kind = KIND[media.type];
        const payload = { [kind]: buffer };
        if (text && kind !== "sticker" && kind !== "audio") payload.caption = text;
        if (kind === "document") {
          payload.mimetype = media.message.documentMessage?.mimetype || "application/octet-stream";
          payload.fileName = media.message.documentMessage?.fileName || "file";
        }
        await ctx.send(target, payload);
      } else {
        await ctx.send(target, { text });
      }

      return ctx.reply(`✅ Sent to @${digits}`, { mentions: [target] });
    },
  },

  {
    name: "forward",
    aliases: ["fwd"],
    category: CATEGORY,
    desc: "Forward a message to another chat",
    usage: "Reply to a message with .forward <number or group id>",
    permission: "sudo",
    execute: async (ctx) => {
      if (!ctx.quoted) return ctx.reply(`Reply to a message with *${ctx.prefix}forward <number>*.`);

      const first = ctx.args[0];
      if (!first) {
        return ctx.reply(
          `*Usage:* reply, then\n${ctx.prefix}forward 2348012345678\n` +
            `${ctx.prefix}forward 1234567890@g.us   _(a group)_\n` +
            `${ctx.prefix}forward here   _(re-post in this chat)_`
        );
      }

      const target =
        first === "here" ? ctx.chat :
        first.includes("@") ? first :
        toJid(first.replace(/[^0-9]/g, ""));

      // forward:true keeps WhatsApp's own "Forwarded" label and re-uploads the
      // media server-side, so nothing has to be downloaded first.
      await ctx.sock.sendMessage(target, { forward: ctx.quoted.raw });

      return ctx.reply(`✅ Forwarded to ${target.includes("@g.us") ? "that group" : `@${numberOf(target)}`}`, {
        mentions: target.includes("@g.us") ? [] : [target],
      });
    },
  },
];
