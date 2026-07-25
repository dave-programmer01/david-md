const db = require("../../db");
const store = require("../../store");
const registry = require("../../lib/registry");
const menu = require("../../lib/menu");
const S = require("../../settings");
const ai = require("../../utils/providers/ai");
const { toJid, numberOf } = require("../../lib/ctx");

const CATEGORY = "General";

const toggle = (name, { key, label, desc, on, off }) => ({
  name,
  category: CATEGORY,
  desc,
  usage: `.${name} on | off`,
  permission: "owner",
  execute: async (ctx) => {
    const wanted = ctx.args[0]?.toLowerCase();
    if (!["on", "off"].includes(wanted)) {
      const current = await db.get(key);
      return ctx.reply(
        `*${label}* is ${current ? "on ✅" : "off ❌"}\n\n${ctx.prefix}${name} on   |   ${ctx.prefix}${name} off`
      );
    }
    await db.set(key, wanted === "on");
    return ctx.reply(wanted === "on" ? on : off);
  },
});

module.exports = [
  toggle("autodl", {
    key: "autodl",
    label: "Auto-download",
    desc: "Automatically download media from links people paste",
    on: "✅ I'll download media from Instagram, TikTok, Facebook and Pinterest links automatically.",
    off: "❌ Auto-download off.",
  }),

  toggle("chatbot", {
    key: "chatbot",
    label: "Chatbot",
    desc: "Reply conversationally when spoken to",
    on: "✅ Chatbot on. In groups, mention or reply to me and I'll answer.",
    off: "❌ Chatbot off.",
  }),

  {
    name: "delsudo",
    category: CATEGORY,
    desc: "Remove someone's sudo access",
    usage: ".delsudo @user",
    permission: "owner",
    execute: async (ctx) => {
      const targets = ctx.targets();
      if (!targets.length) {
        return ctx.reply(`Reply to someone, or mention them:\n${ctx.prefix}delsudo @user`);
      }
      const removed = [];
      for (const jid of targets) {
        if (await db.raw().get(db.SUDO, jid, false)) {
          await db.raw().del(db.SUDO, jid);
          removed.push(numberOf(jid));
        }
      }
      if (!removed.length) return ctx.reply("None of those users had sudo access.");
      return ctx.reply(`✅ Removed sudo from: ${removed.map((n) => `@${n}`).join(", ")}`, {
        mentions: targets,
      });
    },
  },

  {
    name: "afk",
    category: CATEGORY,
    desc: "Mark yourself away — I'll tell people who tag you",
    usage: ".afk having lunch",
    permission: "public",
    execute: async (ctx) => {
      const existing = await db.raw().get(db.AFK, ctx.sender, null);
      if (existing && !ctx.text) {
        await db.raw().del(db.AFK, ctx.sender);
        return ctx.reply("👋 Welcome back — you're no longer AFK.");
      }
      await db.raw().set(db.AFK, ctx.sender, { since: Date.now(), reason: ctx.text || "" });
      return ctx.reply(
        `💤 You're now AFK${ctx.text ? `: _${ctx.text}_` : ""}.\n\n` +
          `_I'll let people know if they tag you. Send any message to come back._`
      );
    },
  },

  {
    name: "ai",
    aliases: ["gpt", "claude", "ask"],
    category: CATEGORY,
    desc: "Ask a question and get an answer",
    usage: ".ai why is the sky blue?",
    permission: "public",
    execute: async (ctx) => {
      const prompt = ctx.text || ctx.quoted?.text;
      if (!prompt) return ctx.reply(`*Usage:* ${ctx.prefix}ai <your question>`);
      if (!ai.isConfigured()) {
        return ctx.reply(
          "🔑 This needs an API key.\n\n" +
            "Open *config.js*, put your key in *ANTHROPIC_API_KEY* (get one at console.anthropic.com), and restart.\n\n" +
            "_Every other command works without it._"
        );
      }
      const answer = await ai.ask(prompt);
      return ctx.reply(answer || "I didn't get a response — try again.");
    },
  },

  {
    name: "info",
    category: CATEGORY,
    desc: "About this bot",
    usage: ".info",
    permission: "public",
    execute: async (ctx) => {
      const custom = await db.get("info");
      const name = (await db.get("botName")) || S.BOT_NAME;
      const owner = (await db.get("ownerName")) || S.OWNER_NAME;
      return ctx.reply(
        `╭═══〘 *${name}* 〙═══⊷❍\n` +
          `┃◬│ ${custom || "A multi-purpose WhatsApp bot."}\n` +
          `┃◬│\n` +
          `┃◬│ Owner    : ${owner}\n` +
          `┃◬│ Version  : ${S.VERSION}\n` +
          `┃◬│ Commands : ${registry.size}\n` +
          `┃◬│ Prefix   : ${ctx.prefix}\n` +
          `┃◬│ Repo     : github.com/${S.REPO}\n` +
          `┃◬│\n` +
          `┃◬│ Deploy your own from the repo above.\n` +
          `╰═════════════════⊷`
      );
    },
  },

  {
    name: "list",
    category: CATEGORY,
    desc: "Every command as a plain list",
    usage: ".list",
    permission: "public",
    execute: async (ctx) => ctx.reply(await menu.renderList(ctx)),
  },

  {
    name: "games",
    category: CATEGORY,
    desc: "Play a quick guessing game",
    usage: ".games",
    permission: "public",
    execute: async (ctx) => {
      const existing = store.games.get(ctx.chat);

      if (existing && ctx.args[0]) {
        const guess = Number(ctx.args[0]);
        if (!Number.isInteger(guess)) return ctx.reply("Guess a whole number.");
        existing.tries += 1;
        if (guess === existing.answer) {
          store.games.delete(ctx.chat);
          return ctx.reply(`🎉 Got it! It was *${existing.answer}* — took you ${existing.tries} guesses.`);
        }
        if (existing.tries >= 8) {
          store.games.delete(ctx.chat);
          return ctx.reply(`💀 Out of guesses. It was *${existing.answer}*.`);
        }
        return ctx.reply(
          `${guess < existing.answer ? "📈 Higher" : "📉 Lower"} — ${8 - existing.tries} guesses left.`
        );
      }

      store.games.set(ctx.chat, { answer: Math.floor(Math.random() * 100) + 1, tries: 0 });
      return ctx.reply(
        `🎲 I'm thinking of a number between *1* and *100*.\n\n` +
          `You get 8 guesses. Try:\n${ctx.prefix}games 50`
      );
    },
  },

  {
    name: "mention",
    aliases: ["tagall"],
    category: CATEGORY,
    desc: "Tag everyone in the group",
    usage: ".mention we start in 5 minutes",
    permission: "admin",
    execute: async (ctx) => {
      const members = ctx.participants.map((p) => p.id);
      if (!members.length) return ctx.reply("I couldn't read the member list — try again in a moment.");

      const body =
        `📢 *${ctx.text || "Attention everyone"}*\n\n` +
        members.map((jid) => `➤ @${numberOf(jid)}`).join("\n");

      return ctx.send(ctx.chat, { text: body, mentions: members });
    },
  },

  {
    name: "reload",
    category: CATEGORY,
    desc: "Reload commands without restarting",
    usage: ".reload",
    permission: "owner",
    execute: async (ctx) => {
      const before = registry.size;
      registry.load();
      return ctx.reply(`♻️ Reloaded — ${registry.size} commands${before !== registry.size ? ` (was ${before})` : ""}.`);
    },
  },

  {
    name: "reboot",
    category: CATEGORY,
    desc: "Restart the bot process",
    usage: ".reboot",
    permission: "owner",
    execute: async (ctx) => {
      await ctx.reply("🔄 Rebooting — back in a few seconds.");
      setTimeout(() => process.exit(0), 1200);
    },
  },

  {
    name: "delete",
    aliases: ["del"],
    category: CATEGORY,
    desc: "Delete a message the bot sent",
    usage: "Reply to the message with .delete",
    permission: "public",
    execute: async (ctx) => {
      const quoted = ctx.quoted;
      if (!quoted) return ctx.reply(`Reply to the message you want gone with *${ctx.prefix}delete*.`);

      // Anyone can delete the bot's own messages; deleting someone else's is a
      // moderation action and needs admin plus admin rights for the bot.
      const isOwn = quoted.sender === ctx.botJid;
      if (!isOwn) {
        if (!ctx.isGroup) return ctx.reply("❌ I can only delete my own messages in a private chat.");
        if (!ctx.isAdmin) return ctx.reply("❌ Only admins can delete other people's messages.");
        if (!ctx.isBotAdmin) return ctx.reply("❌ Make me an admin and I can delete that.");
      }

      await ctx.sock.sendMessage(ctx.chat, { delete: quoted.key });
    },
  },
];
