const search = require("../../utils/providers/search");
const ytdlp = require("../../utils/providers/ytdlp");

const CATEGORY = "Search";

module.exports = [
  {
    name: "img",
    aliases: ["image", "imgsearch"],
    category: CATEGORY,
    desc: "Search the web for images",
    usage: ".img red panda  |  .img 3 red panda",
    permission: "public",
    execute: async (ctx) => {
      // An optional leading number says how many to send.
      let count = 3;
      let query = ctx.text.trim();
      const leading = Number(ctx.args[0]);
      if (Number.isInteger(leading) && leading >= 1 && leading <= 8) {
        count = leading;
        query = ctx.args.slice(1).join(" ").trim();
      }

      if (!query) {
        return ctx.reply(`*Usage:* ${ctx.prefix}img <what to look for>\n\n${ctx.prefix}img 5 red panda`);
      }

      const results = await search.images(query, count);
      if (!results.length) return ctx.reply(`❌ Nothing found for *${query}*.`);

      let sent = 0;
      for (const result of results) {
        try {
          const res = await fetch(result.image, {
            headers: { "User-Agent": search.UA },
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) continue;
          const buffer = Buffer.from(await res.arrayBuffer());
          if (buffer.length > 8 * 1024 * 1024) continue;

          await ctx.send(ctx.chat, {
            image: buffer,
            caption: sent === 0 ? `🔍 *${query}*` : "",
          });
          sent += 1;
        } catch {
          // Individual images fail all the time (hotlink blocks, dead CDNs) —
          // skip and keep going rather than failing the whole command.
        }
      }

      if (!sent) return ctx.reply(`❌ Found results for *${query}* but none of them would download.`);
    },
  },

  {
    name: "find",
    aliases: ["google", "websearch"],
    category: CATEGORY,
    desc: "Search the web",
    usage: ".find how to boil an egg",
    permission: "public",
    execute: async (ctx) => {
      const query = ctx.text.trim();
      if (!query) return ctx.reply(`*Usage:* ${ctx.prefix}find <what to look for>`);

      const results = await search.web(query, 6);
      const lines = results.map(
        (r, i) =>
          `┃◬│ ${i + 1}. *${String(r.title).slice(0, 55)}*\n` +
          (r.snippet ? `┃◬│    _${r.snippet.slice(0, 90)}_\n` : "") +
          `┃◬│    ${r.url}`
      );

      return ctx.reply(
        `╭═══〘 *${query}* 〙═══⊷❍\n${lines.join("\n┃◬│\n")}\n╰═════════════════⊷`
      );
    },
  },

  {
    name: "ig",
    category: CATEGORY,
    desc: "Look up an Instagram profile",
    usage: ".ig username",
    permission: "public",
    execute: async (ctx) => {
      const handle = ctx.text.trim().replace(/^@/, "").replace(/\/$/, "");
      if (!handle || /\s/.test(handle)) {
        return ctx.reply(`*Usage:* ${ctx.prefix}ig <username>\n\n${ctx.prefix}ig natgeo`);
      }

      const url = `https://www.instagram.com/${encodeURIComponent(handle)}/`;

      try {
        const info = await ytdlp.info(url);
        return ctx.reply(
          `╭═══〘 *@${handle}* 〙═══⊷❍\n` +
            `┃◬│ Name : ${info.uploader || handle}\n` +
            `┃◬│ Link : ${url}\n` +
            `┃◬│\n` +
            `┃◬│ ${String(info.description || "").slice(0, 200) || "_no bio available_"}\n` +
            `╰═════════════════⊷\n\n` +
            `_Download a post with_ ${ctx.prefix}insta <post link>`
        );
      } catch (err) {
        return ctx.reply(
          `❌ Couldn't read *@${handle}*.\n\n` +
            `_Instagram blocks most profile lookups from servers. Public post links still work with_ ` +
            `${ctx.prefix}insta_._`
        );
      }
    },
  },
];
