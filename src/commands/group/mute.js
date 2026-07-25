const { isValidTime, normalise } = require("../../utils/automute");

const CATEGORY = "Group";

const scheduleCommand = ({ name, key, label, setting, desc, verb }) => ({
  name,
  category: CATEGORY,
  desc,
  usage: `.${name} 22:00  |  .${name} off`,
  permission: "admin",
  execute: async (ctx) => {
    const arg = ctx.args[0]?.trim();
    const g = await ctx.groupSettings();

    if (!arg) {
      return ctx.reply(
        `*${label}* is ${g[key] ? `set for *${normalise(g[key])}* every day` : "off ❌"}\n\n` +
          `${ctx.prefix}${name} 22:00   _(24-hour time, server clock)_\n` +
          `${ctx.prefix}${name} off`
      );
    }

    if (arg.toLowerCase() === "off") {
      await ctx.setGroupSetting(key, "");
      return ctx.reply(`❌ ${label} cancelled.`);
    }

    if (!isValidTime(arg)) {
      return ctx.reply(`❌ Use 24-hour time, like *22:00* or *07:30*.`);
    }

    if (!ctx.isBotAdmin) {
      return ctx.reply(`❌ Make me an admin first — I can't ${verb} the group otherwise.`);
    }

    await ctx.setGroupSetting(key, normalise(arg));
    return ctx.reply(
      `⏰ I'll ${verb} this group at *${normalise(arg)}* every day.\n\n` +
        `_Times use the server's clock, not yours._`
    );
  },
});

module.exports = [
  scheduleCommand({
    name: "automute",
    key: "automute",
    label: "Auto-lock",
    desc: "Lock the group at the same time every day",
    verb: "lock",
  }),

  scheduleCommand({
    name: "autounmute",
    key: "autounmute",
    label: "Auto-unlock",
    desc: "Unlock the group at the same time every day",
    verb: "unlock",
  }),

  {
    name: "getmute",
    category: CATEGORY,
    desc: "Show this group's lock schedule",
    usage: ".getmute",
    permission: "group",
    execute: async (ctx) => {
      const g = await ctx.groupSettings();
      const lock = g.automute ? normalise(g.automute) : null;
      const unlock = g.autounmute ? normalise(g.autounmute) : null;

      if (!lock && !unlock) {
        return ctx.reply(
          `No schedule set for this group.\n\n` +
            `${ctx.prefix}automute 22:00 — lock every night\n` +
            `${ctx.prefix}autounmute 07:00 — unlock every morning`
        );
      }

      return ctx.reply(
        `╭═══〘 *Schedule* 〙═══⊷❍\n` +
          `┃◬│ Lock   : ${lock || "_not set_"}\n` +
          `┃◬│ Unlock : ${unlock || "_not set_"}\n` +
          `┃◬│ Now    : ${new Date().toTimeString().slice(0, 5)} _(server time)_\n` +
          `╰═════════════════⊷`
      );
    },
  },

  {
    name: "mute",
    category: CATEGORY,
    desc: "Lock the group now, optionally for a set number of minutes",
    usage: ".mute  |  .mute 30",
    permission: "botAdmin",
    execute: async (ctx) => {
      const minutes = Number(ctx.args[0]);
      await ctx.sock.groupSettingUpdate(ctx.chat, "announcement");

      if (Number.isFinite(minutes) && minutes > 0 && minutes <= 1440) {
        await ctx.reply(`🔇 Locked for *${minutes}* minute(s). I'll open it again automatically.`);
        setTimeout(async () => {
          try {
            await ctx.sock.groupSettingUpdate(ctx.chat, "not_announcement");
            await ctx.send(ctx.chat, { text: "🔊 Time's up — the group is open again." });
          } catch {
            // Bot may have lost admin in the meantime; nothing to do.
          }
        }, minutes * 60_000);
        return;
      }

      return ctx.reply(`🔇 Group locked. Open it with *${ctx.prefix}unmute*.`);
    },
  },

  {
    name: "unmute",
    category: CATEGORY,
    desc: "Unlock the group now",
    usage: ".unmute",
    permission: "botAdmin",
    execute: async (ctx) => {
      await ctx.sock.groupSettingUpdate(ctx.chat, "not_announcement");
      return ctx.reply("🔊 Group unlocked — everyone can post.");
    },
  },
];
