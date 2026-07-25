const store = require("../../store");
const registry = require("../../lib/registry");
const { buildContext } = require("../../lib/ctx");

module.exports = [
  {
    name: "clear",
    aliases: ["cls"],
    category: "Misc",
    desc: "Clear this chat's history for the bot's own account",
    usage: ".clear",
    permission: "sudo",
    execute: async (ctx) => {
      // This only clears the copy on the bot's linked device — it cannot
      // delete anything from anyone else's phone.
      await ctx.sock.chatModify({ delete: true, lastMessages: [{ key: ctx.m.key, messageTimestamp: ctx.m.timestamp / 1000 }] }, ctx.chat)
        .catch(() => {});

      store.messageCache.clear();
      store.recentImages.delete(ctx.chat);

      return ctx.reply(
        "🧹 Cleared my copy of this chat.\n\n" +
          "_This only affects the bot's device — nobody else's messages are touched._"
      );
    },
  },

  {
    name: "retry",
    category: "Misc",
    desc: "Run the last command again",
    usage: ".retry",
    permission: "public",
    execute: async (ctx) => {
      const last = store.lastCommand.get(ctx.chat);
      if (!last) return ctx.reply("Nothing to retry — no command has run in this chat yet.");
      if (last.name === "retry") return ctx.reply("That would just loop. Run the real command again.");

      const command = registry.resolve(last.name);
      if (!command) return ctx.reply(`❌ *${last.name}* no longer exists.`);

      await ctx.reply(`♻️ Re-running *${ctx.prefix}${last.name}${last.text ? ` ${last.text}` : ""}*`);

      const retryCtx = await buildContext({
        sock: ctx.sock,
        m: ctx.m,
        command,
        args: last.args,
        text: last.text,
        prefix: ctx.prefix,
      });

      await command.execute(retryCtx);
    },
  },
];
