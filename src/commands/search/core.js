const search = require("../../utils/providers/search");
const instagram = require("../../utils/providers/instagram");
const { sendMedia } = require("../../utils/deliver");

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
    desc: "Look up an Instagram profile, or download a post/reel link",
    usage: ".ig username  |  .ig <post or reel link>",
    permission: "public",
    execute: async (ctx) => {
      // A bare `.ig` in reply to a message with a link uses that link.
      const input = ctx.text.trim() || String(ctx.quoted?.text || "").match(instagram.LINK)?.[0] || "";
      const target = instagram.parse(input);
      if (!target) {
        return ctx.reply(
          `*Usage:* ${ctx.prefix}ig <username or link>\n\n` +
            `${ctx.prefix}ig natgeo\n${ctx.prefix}ig https://instagram.com/reel/ABC123`
        );
      }

      // Most people reach for .ig with a post link — download it rather than
      // misreading the whole URL as a username.
      if (target.kind === "post") {
        await ctx.reply("⏳ Fetching from Instagram…");
        return sendMedia(ctx, await instagram.download(target.url), "Instagram");
      }

      const { username } = target;
      const result = await instagram.profile(username);
      if (!result.ok) {
        if (result.reason === "missing") return ctx.reply(`❌ There's no Instagram account called *@${username}*.`);
        return ctx.reply(
          `❌ Instagram wouldn't show *@${username}*'s profile to this server.\n\n` +
            `Instagram blocks most profile lookups from cloud servers. ` +
            `Post and reel links still download: ${ctx.prefix}ig <link>\n\n${result.hint}`
        );
      }

      const p = result.profile;
      const card =
        `╭═══〘 *@${p.username}* 〙═══⊷❍\n` +
        `┃◬│ Name      : ${p.name}\n` +
        `┃◬│ Followers : ${p.followers}\n` +
        `┃◬│ Following : ${p.following}\n` +
        `┃◬│ Posts     : ${p.posts}\n` +
        `┃◬│ Link      : ${p.url}\n` +
        `┃◬│\n` +
        `┃◬│ ${p.bio.slice(0, 200) || "_no bio_"}\n` +
        `╰═════════════════⊷\n\n` +
        `_Download a post with_ ${ctx.prefix}ig <post link>`;

      // The profile picture is a bonus — if the CDN refuses, the card still goes.
      if (p.picture) {
        try {
          const res = await fetch(p.picture, { headers: { "User-Agent": search.UA }, signal: AbortSignal.timeout(15_000) });
          if (res.ok) {
            return await ctx.reply({ image: Buffer.from(await res.arrayBuffer()), caption: card });
          }
        } catch {}
      }
      return ctx.reply(card);
    },
  },
];
