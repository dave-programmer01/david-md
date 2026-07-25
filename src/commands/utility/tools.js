const db = require("../../db");
const store = require("../../store");
const { upload } = require("../../utils/providers/misc");
const { unwrap, typeOf } = require("../../lib/serialize");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");

const CATEGORY = "Utility";

const DAY = 86_400_000;

/** Break a millisecond span into human units. */
function breakdown(ms) {
  const abs = Math.abs(ms);
  const days = Math.floor(abs / DAY);
  const years = Math.floor(days / 365.25);
  const months = Math.floor((days - years * 365.25) / 30.44);
  return {
    years,
    months,
    days,
    remainingDays: Math.floor(days - years * 365.25 - months * 30.44),
    hours: Math.floor((abs % DAY) / 3_600_000),
    minutes: Math.floor((abs % 3_600_000) / 60_000),
    weeks: Math.floor(days / 7),
  };
}

const parseDate = (input) => {
  const text = String(input || "").trim();
  // Accept DD/MM/YYYY as well as anything Date.parse understands, since the
  // slash form is what most people type and JS reads it as US order.
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) return new Date(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1]));
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed);
};

module.exports = [
  {
    name: "age",
    category: CATEGORY,
    desc: "How long ago a date was",
    usage: ".age 15/03/1998",
    permission: "public",
    execute: async (ctx) => {
      const date = parseDate(ctx.text);
      if (!date) {
        return ctx.reply(`*Usage:* ${ctx.prefix}age 15/03/1998\n\n_Also accepts 1998-03-15._`);
      }
      if (date > new Date()) {
        return ctx.reply(`That date is in the future — try *${ctx.prefix}cntd* instead.`);
      }

      const b = breakdown(Date.now() - date.getTime());
      return ctx.reply(
        `╭═══〘 *Age* 〙═══⊷❍\n` +
          `┃◬│ Date  : ${date.toDateString()}\n` +
          `┃◬│\n` +
          `┃◬│ *${b.years} years, ${b.months} months, ${b.remainingDays} days*\n` +
          `┃◬│\n` +
          `┃◬│ ${b.days.toLocaleString()} days\n` +
          `┃◬│ ${b.weeks.toLocaleString()} weeks\n` +
          `┃◬│ ${(b.days * 24).toLocaleString()} hours\n` +
          `╰═════════════════⊷`
      );
    },
  },

  {
    name: "cntd",
    aliases: ["countdown"],
    category: CATEGORY,
    desc: "Time left until a date",
    usage: ".cntd 25/12/2026",
    permission: "public",
    execute: async (ctx) => {
      const date = parseDate(ctx.text);
      if (!date) return ctx.reply(`*Usage:* ${ctx.prefix}cntd 25/12/2026`);

      const remaining = date.getTime() - Date.now();
      if (remaining <= 0) {
        const b = breakdown(-remaining);
        return ctx.reply(`⏳ That was *${b.days}* day(s) ago (${date.toDateString()}).`);
      }

      const b = breakdown(remaining);
      return ctx.reply(
        `╭═══〘 *Countdown* 〙═══⊷❍\n` +
          `┃◬│ To : ${date.toDateString()}\n` +
          `┃◬│\n` +
          `┃◬│ *${b.days} days, ${b.hours} hours, ${b.minutes} min*\n` +
          `┃◬│\n` +
          `┃◬│ ${b.weeks} weeks\n` +
          `┃◬│ ${(b.days * 24 + b.hours).toLocaleString()} hours\n` +
          `╰═════════════════⊷`
      );
    },
  },

  {
    name: "diff",
    category: CATEGORY,
    desc: "Time between two dates",
    usage: ".diff 01/01/2020 31/12/2024",
    permission: "public",
    execute: async (ctx) => {
      const [first, second] = ctx.args;
      const a = parseDate(first);
      const b = parseDate(second);

      if (!a || !b) {
        return ctx.reply(`*Usage:* ${ctx.prefix}diff 01/01/2020 31/12/2024`);
      }

      const span = breakdown(b.getTime() - a.getTime());
      const [from, to] = a < b ? [a, b] : [b, a];

      return ctx.reply(
        `╭═══〘 *Difference* 〙═══⊷❍\n` +
          `┃◬│ From : ${from.toDateString()}\n` +
          `┃◬│ To   : ${to.toDateString()}\n` +
          `┃◬│\n` +
          `┃◬│ *${span.years}y ${span.months}m ${span.remainingDays}d*\n` +
          `┃◬│\n` +
          `┃◬│ ${span.days.toLocaleString()} days\n` +
          `┃◬│ ${span.weeks.toLocaleString()} weeks\n` +
          `╰═════════════════⊷`
      );
    },
  },

  {
    name: "users",
    category: CATEGORY,
    desc: "How many people have used the bot",
    usage: ".users",
    permission: "sudo",
    execute: async (ctx) => {
      const all = await db.raw().all(db.USERS);
      const entries = Object.entries(all);
      const now = Date.now();

      const active24h = entries.filter(([, seen]) => now - seen < DAY).length;
      const active7d = entries.filter(([, seen]) => now - seen < 7 * DAY).length;

      let groups = 0;
      try {
        groups = Object.keys(await ctx.sock.groupFetchAllParticipating()).length;
      } catch {
        // Not fatal — just omit the number rather than failing the command.
      }

      return ctx.reply(
        `╭═══〘 *Users* 〙═══⊷❍\n` +
          `┃◬│ Total seen   : ${entries.length}\n` +
          `┃◬│ Last 24h     : ${active24h}\n` +
          `┃◬│ Last 7 days  : ${active7d}\n` +
          `┃◬│ Groups       : ${groups}\n` +
          `╰═════════════════⊷\n\n` +
          `_Counted since the bot was first deployed._`
      );
    },
  },

  {
    name: "vv",
    aliases: ["reveal"],
    category: CATEGORY,
    desc: "Re-send a view-once photo or video",
    usage: "Reply to a view-once message with .vv",
    permission: "sudo",
    execute: async (ctx) => {
      const quotedRaw = ctx.m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!quotedRaw) return ctx.reply(`Reply to the view-once message with *${ctx.prefix}vv*.`);

      const isViewOnce =
        quotedRaw.viewOnceMessage || quotedRaw.viewOnceMessageV2 || quotedRaw.viewOnceMessageV2Extension;

      const inner = unwrap(quotedRaw);
      const type = typeOf(inner);

      if (!["imageMessage", "videoMessage", "audioMessage"].includes(type)) {
        return ctx.reply("❌ That isn't a photo, video or voice note.");
      }
      if (!isViewOnce && !inner[type]?.viewOnce) {
        return ctx.reply("_That wasn't view-once, but here it is again anyway._");
      }

      const buffer = await downloadMediaMessage(
        { key: ctx.m.quoted.key, message: inner },
        "buffer",
        {}
      );
      const caption = inner[type]?.caption || "🔓 View-once unlocked";

      if (type === "imageMessage") return ctx.reply({ image: buffer, caption });
      if (type === "videoMessage") return ctx.reply({ video: buffer, caption });
      return ctx.reply({ audio: buffer, mimetype: "audio/mpeg", ptt: true });
    },
  },

  {
    name: "upload",
    aliases: ["tourl"],
    category: CATEGORY,
    desc: "Upload media and get a shareable link",
    usage: "Reply to any file with .upload",
    permission: "public",
    execute: async (ctx) => {
      const target = ctx.media();
      if (!target) return ctx.reply(`Reply to an image, video, audio or document with *${ctx.prefix}upload*.`);

      const buffer = await ctx.download(target.raw);
      if (!buffer) return ctx.reply("❌ Couldn't download that — try re-sending it.");

      const EXT = {
        imageMessage: "jpg", videoMessage: "mp4", audioMessage: "mp3",
        stickerMessage: "webp", documentMessage: "bin",
      };
      const name = target.message?.documentMessage?.fileName || `file.${EXT[target.type] || "bin"}`;

      const url = await upload(buffer, name);
      return ctx.reply(
        `📤 *Uploaded*\n\n${url}\n\n` +
          `Size: ${(buffer.length / 1024).toFixed(0)} KB\n` +
          `_Hosted on catbox.moe — links do not expire, and anyone with the link can open it._`
      );
    },
  },
];
