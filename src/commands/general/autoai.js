const db = require("../../db");
const autoai = require("../../utils/providers/autoai");

const help = (prefix) =>
  `*AutoAI* — ask me anything, or tell me what to do.\n\n` +
  `${prefix}autoai what's the capital of Peru?\n` +
  `${prefix}autoai turn this photo into a sticker\n` +
  `${prefix}autoai who are the admins here?\n\n` +
  `Or just *reply to any of my messages* and I'll answer — no prefix needed.\n\n` +
  `${prefix}autoai on   |   ${prefix}autoai off   _(owner — the reply trigger)_\n` +
  `${prefix}autoai reset   _(forget our conversation)_\n\n` +
  `_Powered by Meta AI, built into WhatsApp. No API key needed._`;

module.exports = {
  name: "autoai",
  aliases: ["auto"],
  category: "General",
  desc: "Chat with me, and let me run commands for you",
  usage: ".autoai make this a sticker",
  permission: "public",
  execute: async (ctx) => {
    const first = ctx.args[0]?.toLowerCase();

    // `on`/`off` govern the passive reply trigger, so they're owner-only even
    // though asking a question is not.
    if (["on", "off"].includes(first) && ctx.args.length === 1) {
      if (!ctx.isOwner) return ctx.reply("❌ Owner only — that switch is not yours to flip.");
      await db.set("autoai", first === "on");
      return ctx.reply(
        first === "on"
          ? "✅ AutoAI on. Reply to any message of mine and I'll answer — and run commands if that's what you're after."
          : `❌ AutoAI reply trigger off. ${ctx.prefix}autoai <question> still works.`
      );
    }

    if (first === "reset" && ctx.args.length === 1) {
      autoai.forget(ctx.sender);
      return ctx.reply("🧹 Forgotten. We're starting fresh.");
    }

    // Falls back to the replied-to message so `.autoai` on its own still has
    // something to work with.
    const prompt = ctx.text || ctx.quoted?.text;
    if (!prompt) return ctx.reply(help(ctx.prefix));

    const answer = await autoai.run(ctx, prompt);
    // An empty answer is normal and correct: the command it ran has already
    // sent its own output, and there was nothing left worth adding.
    if (answer) await ctx.reply(answer);
  },
};
