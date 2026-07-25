const { jidNormalizedUser } = require("@whiskeysockets/baileys");
const { numberOf } = require("../../lib/ctx");

const CATEGORY = "Group";

// WhatsApp rate-limits bulk participant changes hard. Removing a whole group in
// one burst is a reliable way to get the account flagged, so batches are small
// and spaced out.
const BATCH_SIZE = 5;
const BATCH_DELAY = 1200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function inBatches(ctx, jids, action) {
  const done = [];
  const failed = [];
  for (let i = 0; i < jids.length; i += BATCH_SIZE) {
    const batch = jids.slice(i, i + BATCH_SIZE);
    try {
      const result = await ctx.sock.groupParticipantsUpdate(ctx.chat, batch, action);
      for (const entry of result || []) {
        (entry.status === "200" ? done : failed).push(jidNormalizedUser(entry.jid));
      }
    } catch {
      failed.push(...batch);
    }
    if (i + BATCH_SIZE < jids.length) await sleep(BATCH_DELAY);
  }
  return { done, failed };
}

const participantCommand = ({ name, aliases = [], action, desc, verb, past }) => ({
  name,
  aliases,
  category: CATEGORY,
  desc,
  usage: `.${name} @user`,
  permission: "botAdmin",
  execute: async (ctx) => {
    const targets = ctx.targets().filter((jid) => jid !== ctx.botJid);
    if (!targets.length) {
      return ctx.reply(
        `Reply to someone, mention them, or give a number:\n` +
          `${ctx.prefix}${name} @user\n${ctx.prefix}${name} 2348012345678`
      );
    }

    const { done, failed } = await inBatches(ctx, targets, action);

    const parts = [];
    if (done.length) parts.push(`✅ ${past} ${done.map((j) => `@${numberOf(j)}`).join(", ")}`);
    if (failed.length) {
      parts.push(
        `❌ Couldn't ${verb} ${failed.map((j) => `@${numberOf(j)}`).join(", ")}` +
          `\n_They may have left, be an admin, or have privacy settings that block it._`
      );
    }

    return ctx.reply(parts.join("\n\n"), { mentions: [...done, ...failed] });
  },
});

module.exports = [
  participantCommand({
    name: "kick",
    aliases: ["boot"],
    action: "remove",
    desc: "Remove someone from the group",
    verb: "remove",
    past: "Removed",
  }),

  participantCommand({
    name: "add",
    action: "add",
    desc: "Add someone to the group",
    verb: "add",
    past: "Added",
  }),

  participantCommand({
    name: "promote",
    action: "promote",
    desc: "Make someone an admin",
    verb: "promote",
    past: "Promoted",
  }),

  participantCommand({
    name: "demote",
    action: "demote",
    desc: "Remove someone's admin",
    verb: "demote",
    past: "Demoted",
  }),

  {
    name: "fumigate",
    aliases: ["purge"],
    category: CATEGORY,
    desc: "Remove everyone except the admins",
    usage: ".fumigate  then  .fumigate confirm",
    permission: "botAdmin",
    execute: async (ctx) => {
      const admins = new Set(
        ctx.participants.filter((p) => ["admin", "superadmin"].includes(p.admin)).map((p) => jidNormalizedUser(p.id))
      );
      const victims = ctx.participants
        .map((p) => jidNormalizedUser(p.id))
        .filter((jid) => !admins.has(jid) && jid !== ctx.botJid);

      if (!victims.length) return ctx.reply("Everyone here is already an admin — nothing to do.");

      // Destructive and irreversible, so it takes a second, explicit command.
      if (ctx.args[0]?.toLowerCase() !== "confirm") {
        return ctx.reply(
          `⚠️ *This will remove ${victims.length} member${victims.length === 1 ? "" : "s"}.*\n\n` +
            `${admins.size} admin${admins.size === 1 ? "" : "s"} will stay. This cannot be undone.\n\n` +
            `Estimated time: about ${Math.ceil((victims.length / BATCH_SIZE) * (BATCH_DELAY / 1000))}s ` +
            `— I remove people in small batches so WhatsApp doesn't flag the account.\n\n` +
            `If you're sure:\n*${ctx.prefix}fumigate confirm*`
        );
      }

      await ctx.reply(`🧹 Removing ${victims.length} member(s)… I'll report back when it's done.`);
      const { done, failed } = await inBatches(ctx, victims, "remove");

      return ctx.reply(
        `🧹 *Done*\n\n` +
          `Removed : ${done.length}\n` +
          `Failed  : ${failed.length}\n` +
          `Admins kept : ${admins.size}`
      );
    },
  },

  {
    name: "requests",
    aliases: ["pending"],
    category: CATEGORY,
    desc: "See and handle people waiting to join",
    usage: ".requests | .requests approve all | .requests reject @user",
    permission: "botAdmin",
    execute: async (ctx) => {
      const pending = await ctx.sock.groupRequestParticipantsList(ctx.chat).catch(() => []);
      if (!pending?.length) return ctx.reply("No one is waiting to join.");

      const action = ctx.args[0]?.toLowerCase();
      if (!["approve", "reject"].includes(action)) {
        const lines = pending.map((p, i) => `┃◬│ ${i + 1}. @${numberOf(p.jid)}`);
        return ctx.reply(
          `╭═══〘 *Join requests* (${pending.length}) 〙═══⊷❍\n${lines.join("\n")}\n╰═════════════════⊷\n\n` +
            `${ctx.prefix}requests approve all\n${ctx.prefix}requests reject all\n` +
            `${ctx.prefix}requests approve @user`,
          { mentions: pending.map((p) => p.jid) }
        );
      }

      const all = ctx.args[1]?.toLowerCase() === "all";
      const chosen = all ? pending.map((p) => p.jid) : ctx.targets();
      if (!chosen.length) return ctx.reply(`Say *all*, or mention who:\n${ctx.prefix}requests ${action} all`);

      await ctx.sock.groupRequestParticipantsUpdate(ctx.chat, chosen, action);
      return ctx.reply(
        `${action === "approve" ? "✅ Approved" : "🚫 Rejected"} ${chosen.length} request(s).`
      );
    },
  },

  {
    name: "leave",
    aliases: ["exit"],
    category: CATEGORY,
    desc: "Make the bot leave this group",
    usage: ".leave",
    permission: "owner",
    execute: async (ctx) => {
      if (!ctx.isGroup) return ctx.reply("❌ This only works inside a group.");
      await ctx.reply("👋 Leaving. Add me back any time.");
      await new Promise((r) => setTimeout(r, 1500));
      await ctx.sock.groupLeave(ctx.chat);
    },
  },
];

module.exports.helpers = { inBatches, BATCH_SIZE, BATCH_DELAY };
