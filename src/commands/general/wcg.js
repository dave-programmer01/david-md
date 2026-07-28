const wcg = require("../../utils/wcg");

module.exports = {
  name: "wcg",
  aliases: ["wordchain"],
  category: "General",
  desc: "Play a word chain spelling game",
  usage: ".wcg easy  |  .wcg hard  |  .wcg cancel",
  permission: "public",
  execute: async (ctx) => {
    const arg = ctx.args[0]?.toLowerCase();

    if (arg === "cancel" || arg === "stop") {
      // The host or any admin can pull the plug.
      if (wcg.cancel(ctx.chat)) return ctx.reply("🛑 Word game cancelled.");
      return ctx.reply("There's no word game running here.");
    }

    if (!["easy", "hard"].includes(arg)) {
      return ctx.reply(
        `🎮 *Word Chain Game*\n\n` +
          `Take turns giving real words that start with a given letter, before the clock runs out. ` +
          `Each word chains off the last letter of the one before it. Last one standing wins.\n\n` +
          `*Start a game*\n` +
          `${ctx.prefix}wcg easy  — more time, retry until the clock runs out\n` +
          `${ctx.prefix}wcg hard  — less time, one wrong word and you're out\n\n` +
          `Everyone else has *30 seconds* to type *join*.`
      );
    }

    const result = wcg.startLobby(ctx.chat, ctx.sender, ctx.pushName || ctx.senderNumber, arg);
    if (result.error) return ctx.reply(`❌ ${result.error}`);

    return ctx.reply(
      `🎮 *${ctx.pushName || "Someone"}* started a *${arg.toUpperCase()}* word chain game!\n\n` +
        `Type *join* in the next *30 seconds* to play.\n` +
        `_You're already in._`
    );
  },
};
