const { jidNormalizedUser } = require("@whiskeysockets/baileys");
const db = require("../../db");
const store = require("../../store");
const { numberOf } = require("../../lib/ctx");

const CATEGORY = "Group";

module.exports = [
  {
    name: "jid",
    category: CATEGORY,
    desc: "Show the ID of this chat or a person",
    usage: ".jid  |  reply to someone with .jid",
    permission: "public",
    execute: async (ctx) => {
      if (ctx.quoted?.sender) return ctx.reply(`\`\`\`${ctx.quoted.sender}\`\`\``);
      if (ctx.mentions.length) return ctx.reply(ctx.mentions.map((j) => `\`\`\`${j}\`\`\``).join("\n"));
      return ctx.reply(`*This chat*\n\`\`\`${ctx.chat}\`\`\`\n\n*You*\n\`\`\`${ctx.sender}\`\`\``);
    },
  },

  {
    name: "getjids",
    category: "Utility",
    desc: "List every member's ID as a file",
    usage: ".getjids",
    permission: "admin",
    execute: async (ctx) => {
      const jids = ctx.participants.map((p) => jidNormalizedUser(p.id));
      const body = jids.join("\n");
      return ctx.reply({
        document: Buffer.from(body, "utf8"),
        mimetype: "text/plain",
        fileName: `members-${ctx.chat.split("@")[0]}.txt`,
        caption: `${jids.length} member(s)`,
      });
    },
  },

  {
    name: "invite",
    aliases: ["link"],
    category: CATEGORY,
    desc: "Get this group's invite link",
    usage: ".invite",
    permission: "botAdmin",
    execute: async (ctx) => {
      const code = await ctx.sock.groupInviteCode(ctx.chat);
      return ctx.reply(
        `🔗 *${ctx.groupMeta?.subject || "Group"}*\n\nhttps://chat.whatsapp.com/${code}`
      );
    },
  },

  {
    name: "revoke",
    aliases: ["resetlink"],
    category: CATEGORY,
    desc: "Invalidate the old invite link and make a new one",
    usage: ".revoke",
    permission: "botAdmin",
    execute: async (ctx) => {
      const code = await ctx.sock.groupRevokeInvite(ctx.chat);
      return ctx.reply(
        `♻️ Old link is dead. New one:\n\nhttps://chat.whatsapp.com/${code}`
      );
    },
  },

  {
    name: "glock",
    aliases: ["close"],
    category: CATEGORY,
    desc: "Only admins can send messages",
    usage: ".glock",
    permission: "botAdmin",
    execute: async (ctx) => {
      await ctx.sock.groupSettingUpdate(ctx.chat, "announcement");
      return ctx.reply("🔒 Group locked — only admins can send messages now.");
    },
  },

  {
    name: "gunlock",
    aliases: ["open"],
    category: CATEGORY,
    desc: "Let everyone send messages again",
    usage: ".gunlock",
    permission: "botAdmin",
    execute: async (ctx) => {
      await ctx.sock.groupSettingUpdate(ctx.chat, "not_announcement");
      return ctx.reply("🔓 Group unlocked — everyone can send messages.");
    },
  },

  {
    name: "gname",
    aliases: ["setgname"],
    category: CATEGORY,
    desc: "Rename the group",
    usage: ".gname My New Group Name",
    permission: "botAdmin",
    execute: async (ctx) => {
      const name = ctx.text.trim();
      if (!name) return ctx.reply(`*Usage:* ${ctx.prefix}gname My New Group Name`);
      if (name.length > 100) return ctx.reply("❌ Group names max out at 100 characters.");

      await ctx.sock.groupUpdateSubject(ctx.chat, name);
      await ctx.refreshGroup();
      return ctx.reply(`✅ Renamed to *${name}*`);
    },
  },

  {
    name: "gdesc",
    aliases: ["setgdesc"],
    category: CATEGORY,
    desc: "Change the group description",
    usage: ".gdesc Read the pinned message before posting",
    permission: "botAdmin",
    execute: async (ctx) => {
      const desc = ctx.text.trim();
      if (!desc) return ctx.reply(`*Usage:* ${ctx.prefix}gdesc <new description>`);

      await ctx.sock.groupUpdateDescription(ctx.chat, desc);
      await ctx.refreshGroup();
      return ctx.reply("✅ Description updated.");
    },
  },

  {
    name: "gstatus",
    aliases: ["ginfo"],
    category: CATEGORY,
    desc: "Everything about this group",
    usage: ".gstatus",
    permission: "group",
    execute: async (ctx) => {
      const meta = ctx.groupMeta;
      if (!meta) return ctx.reply("❌ I couldn't read this group's details — try again in a moment.");

      const admins = ctx.participants.filter((p) => ["admin", "superadmin"].includes(p.admin));
      const owner = meta.owner ? `@${numberOf(meta.owner)}` : "unknown";
      const created = meta.creation ? new Date(meta.creation * 1000).toLocaleDateString() : "unknown";

      return ctx.reply(
        `╭═══〘 *${meta.subject}* 〙═══⊷❍\n` +
          `┃◬│ Members    : ${ctx.participants.length}\n` +
          `┃◬│ Admins     : ${admins.length}\n` +
          `┃◬│ Created by : ${owner}\n` +
          `┃◬│ Created on : ${created}\n` +
          `┃◬│ Locked     : ${meta.announce ? "yes (admins only)" : "no"}\n` +
          `┃◬│ Edit info  : ${meta.restrict ? "admins only" : "everyone"}\n` +
          `┃◬│ I am admin : ${ctx.isBotAdmin ? "yes ✅" : "no ❌"}\n` +
          `┃◬│\n` +
          `┃◬│ ${meta.desc ? String(meta.desc).slice(0, 200) : "_no description_"}\n` +
          `╰═════════════════⊷`,
        { mentions: meta.owner ? [meta.owner] : [] }
      );
    },
  },

  {
    name: "common",
    category: CATEGORY,
    desc: "Groups you and I are both in",
    usage: ".common",
    permission: "sudo",
    execute: async (ctx) => {
      const all = await ctx.sock.groupFetchAllParticipating();
      const target = ctx.quoted?.sender || ctx.mentions[0] || ctx.sender;

      const shared = Object.values(all).filter((g) =>
        (g.participants || []).some((p) => jidNormalizedUser(p.id) === target)
      );

      if (!shared.length) return ctx.reply(`@${numberOf(target)} isn't in any group with me.`, { mentions: [target] });

      const lines = shared.slice(0, 40).map((g, i) => `┃◬│ ${i + 1}. ${g.subject} _(${g.participants.length})_`);
      return ctx.reply(
        `╭═〘 Groups with @${numberOf(target)} 〙═⊷❍\n${lines.join("\n")}\n╰═════════════════⊷\n\n` +
          `${shared.length} group(s) in common.`,
        { mentions: [target] }
      );
    },
  },

  {
    name: "tag",
    category: CATEGORY,
    desc: "Tag everyone silently (no visible @mentions)",
    usage: ".tag read the pinned message",
    permission: "admin",
    execute: async (ctx) => {
      const members = ctx.participants.map((p) => p.id);
      const body = ctx.text || ctx.quoted?.text || "📢 Attention";
      // Mentions without the @handles in the text: everyone gets notified but
      // the message stays readable.
      return ctx.send(ctx.chat, { text: body, mentions: members });
    },
  },

  {
    name: "quoted",
    category: CATEGORY,
    desc: "Show the message being replied to",
    usage: "Reply to a message with .quoted",
    permission: "public",
    execute: async (ctx) => {
      if (!ctx.quoted) return ctx.reply(`Reply to a message with *${ctx.prefix}quoted*.`);

      const q = ctx.quoted;
      const preview = q.text ? `\n\n${q.text.slice(0, 800)}` : "";
      return ctx.reply(
        `*Quoted message*\n\n` +
          `From : @${numberOf(q.sender)}\n` +
          `Type : ${q.type.replace(/Message$/, "")}\n` +
          `ID   : \`\`\`${q.key.id}\`\`\`${preview}`,
        { mentions: [q.sender] }
      );
    },
  },

  {
    name: "msgs",
    aliases: ["activity"],
    category: CATEGORY,
    desc: "Who has been talking in this group",
    usage: ".msgs",
    permission: "admin",
    execute: async (ctx) => {
      const counts = new Map();
      for (const [, m] of store.messageCache.map) {
        const msg = m.value;
        if (msg?.chat !== ctx.chat || msg.fromMe) continue;
        counts.set(msg.sender, (counts.get(msg.sender) || 0) + 1);
      }

      if (!counts.size) {
        return ctx.reply(
          "I haven't seen enough messages yet.\n\n" +
            "_Counting starts when the bot boots and covers the last few hundred messages._"
        );
      }

      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
      const lines = ranked.map(([jid, n], i) => `┃◬│ ${i + 1}. @${numberOf(jid)} — ${n}`);

      return ctx.reply(
        `╭═══〘 *Most active* 〙═══⊷❍\n${lines.join("\n")}\n╰═════════════════⊷\n\n` +
          `_Since the bot last restarted._`,
        { mentions: ranked.map(([jid]) => jid) }
      );
    },
  },

  {
    name: "inactive",
    aliases: ["ghosts"],
    category: CATEGORY,
    desc: "Members who haven't said anything",
    usage: ".inactive",
    permission: "admin",
    execute: async (ctx) => {
      const spoke = new Set();
      for (const [, m] of store.messageCache.map) {
        if (m.value?.chat === ctx.chat) spoke.add(m.value.sender);
      }

      const silent = ctx.participants
        .map((p) => jidNormalizedUser(p.id))
        .filter((jid) => !spoke.has(jid) && jid !== ctx.botJid);

      if (!silent.length) return ctx.reply("Everyone has spoken since I started. 🎉");

      const shown = silent.slice(0, 50);
      return ctx.reply(
        `╭═══〘 *Quiet members* 〙═══⊷❍\n` +
          shown.map((jid, i) => `┃◬│ ${i + 1}. @${numberOf(jid)}`).join("\n") +
          `\n╰═════════════════⊷\n\n` +
          `${silent.length} member(s) haven't spoken since the bot restarted.\n` +
          `_This only reflects recent messages, not the group's whole history._`,
        { mentions: shown }
      );
    },
  },
];
