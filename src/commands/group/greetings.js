const { fill, DEFAULT_WELCOME, DEFAULT_GOODBYE } = require("../../handlers/group");

const CATEGORY = "Group";

const PLACEHOLDERS =
  "*Placeholders you can use*\n" +
  "`@user`   — tags the person\n" +
  "`{group}` — the group name\n" +
  "`{count}` — how many members\n" +
  "`{desc}`  — the group description";

const greeting = ({ name, key, textKey, label, fallback, desc }) => ({
  name,
  category: CATEGORY,
  desc,
  usage: `.${name} on | off | <your message>`,
  permission: "admin",
  execute: async (ctx) => {
    const arg = ctx.text.trim();
    const g = await ctx.groupSettings();

    if (!arg) {
      return ctx.reply(
        `*${label}* is ${g[key] ? "on ✅" : "off ❌"}\n\n` +
          `Current message:\n_${g[textKey] || fallback}_\n\n` +
          `${ctx.prefix}${name} on\n${ctx.prefix}${name} off\n` +
          `${ctx.prefix}${name} Welcome @user to {group}!\n\n${PLACEHOLDERS}`
      );
    }

    if (arg.toLowerCase() === "on") {
      await ctx.setGroupSetting(key, true);
      return ctx.reply(`✅ ${label} on.\n\nMessage:\n_${g[textKey] || fallback}_`);
    }

    if (arg.toLowerCase() === "off") {
      await ctx.setGroupSetting(key, false);
      return ctx.reply(`❌ ${label} off.`);
    }

    if (arg.toLowerCase() === "reset") {
      await ctx.setGroupSetting(textKey, "");
      return ctx.reply(`✅ Back to the default message:\n_${fallback}_`);
    }

    if (arg.length > 800) return ctx.reply("❌ Keep it under 800 characters.");

    await ctx.setGroupSetting(textKey, arg);
    await ctx.setGroupSetting(key, true);

    return ctx.reply(
      `✅ ${label} message saved and turned on.\n\n` +
        `*Preview*\n${fill(arg, { jid: ctx.sender, meta: ctx.groupMeta })}\n\n` +
        `_Test it properly with_ ${ctx.prefix}test${name}`
    );
  },
});

const test = ({ name, key, textKey, fallback, label }) => ({
  name: `test${name}`,
  category: CATEGORY,
  desc: `Preview the ${label.toLowerCase()} message`,
  usage: `.test${name}`,
  permission: "admin",
  execute: async (ctx) => {
    const g = await ctx.groupSettings();
    const template = g[textKey] || fallback;
    const rendered = fill(template, { jid: ctx.sender, meta: ctx.groupMeta });

    await ctx.send(ctx.chat, { text: rendered, mentions: [ctx.sender] });
    return ctx.reply(
      `☝️ That's what people will see.\n\n` +
        `${label} is currently *${g[key] ? "on" : "off"}*` +
        (g[key] ? "" : `\n_Turn it on with_ ${ctx.prefix}${name} on`)
    );
  },
});

const welcomeSpec = {
  name: "welcome",
  key: "welcome",
  textKey: "welcomeText",
  label: "Welcome",
  fallback: DEFAULT_WELCOME,
  desc: "Greet people when they join",
};

const goodbyeSpec = {
  name: "goodbye",
  key: "goodbye",
  textKey: "goodbyeText",
  label: "Goodbye",
  fallback: DEFAULT_GOODBYE,
  desc: "Say something when people leave",
};

module.exports = [
  greeting(welcomeSpec),
  greeting(goodbyeSpec),
  test(welcomeSpec),
  test(goodbyeSpec),
];
