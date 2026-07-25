const os = require("os");
const S = require("../settings");
const db = require("../db");
const registry = require("./registry");
const font = require("./font");
const store = require("../store");

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  if (m || h || d) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(" ");
}

function ramLine() {
  const used = Math.round((os.totalmem() - os.freemem()) / MB);
  const total = os.totalmem() / GB;
  const totalStr = total >= 1 ? `${Math.round(total)} GB` : `${Math.round(os.totalmem() / MB)} MB`;
  return `${used} MB of ${totalStr}`;
}

async function headerData(ctx) {
  const [botName, ownerName, mode] = await Promise.all([
    db.get("botName"),
    db.get("ownerName"),
    db.get("mode"),
  ]);
  const users = Object.keys(await db.raw().all(db.USERS)).length;
  return {
    botName: botName || S.BOT_NAME,
    ownerName: ownerName || S.OWNER_NAME,
    user: ctx?.pushName || "—",
    mode: mode || S.MODE,
    server: os.type(),
    ram: ramLine(),
    users,
    version: S.VERSION,
  };
}

/** The boxed header block, byte-identical in shape to the supplied template. */
function renderHeader(d) {
  const styled = font.apply(d.botName, "sans");
  return [
    `╭═══〘 \`${styled}\` 〙═══⊷❍`,
    `┃◬╭──────────────`,
    `┃◬│`,
    `┃◬│ _*\`Owner\`*_ : ${d.ownerName}`,
    `┃◬│ _*\`User\`*_ : ${d.user}`,
    `┃◬│ _*\`Mode\`*_ : ${d.mode}`,
    `┃◬│ _*\`Server\`*_ : ${d.server}`,
    `┃◬│ _*\`Available RAM\`*_ : ${d.ram}`,
    `┃◬│ _*\`Total Users\`*_ : ${d.users}`,
    `┃◬│ _*\`Version\`*_ : ${d.version}`,
    `┃◬│`,
    `┃◬│`,
    `┃◬│  ▎▍▌▌▉▏▎▌▉▐▏▌▎`,
    `┃◬│  ▎▍▌▌▉▏▎▌▉▐▏▌▎`,
    `┃◬│   ${styled}`,
    `┃◬│`,
    `┃◬╰───────────────`,
    `╰═════════════════⊷`,
  ].join("\n");
}

function renderCategoryBlock(category, cmds, prefix, counter) {
  const lines = [`╭════〘 *_\`${category}\`_* 〙════⊷❍`];
  for (const cmd of cmds) {
    lines.push(`┃◬│ _\`${counter.n++}.\` ${prefix}${cmd.name}_`);
  }
  lines.push(`┃◬╰─────────────────❍`);
  lines.push(`╰══════════════════⊷❍`);
  return lines.join("\n");
}

/** Full menu: header + every category, numbered continuously. */
async function renderMenu(ctx, { only = null } = {}) {
  const prefix = ctx?.prefix || (await db.get("prefix")) || S.PREFIX;
  const data = await headerData(ctx);
  const groups = registry.byCategory();

  const blocks = [renderHeader(data)];
  const counter = { n: 1 };

  for (const [category, cmds] of groups) {
    if (only && category.toLowerCase() !== only.toLowerCase()) {
      counter.n += cmds.length; // keep global numbering stable when filtering
      continue;
    }
    blocks.push(renderCategoryBlock(category, cmds, prefix, counter));
  }

  return blocks.join("\n\n");
}

/** Plain text list — used by `.list`, easier to read than the boxed menu. */
async function renderList(ctx) {
  const prefix = ctx?.prefix || (await db.get("prefix")) || S.PREFIX;
  const out = [];
  for (const [category, cmds] of registry.byCategory()) {
    out.push(`*${category}* (${cmds.length})`);
    out.push(cmds.map((c) => `${prefix}${c.name}`).join(", "));
    out.push("");
  }
  out.push(`_Total: ${registry.size} commands_`);
  return out.join("\n");
}

/** Default `.alive` card, shown when the user hasn't set a custom one. */
async function renderAlive(ctx) {
  const d = await headerData(ctx);
  const uptime = formatUptime(Date.now() - (store.botStartTimestamp || Date.now()));
  return [
    `╭═══〘 \`${font.apply(d.botName, "sans")}\` 〙═══⊷❍`,
    `┃◬│`,
    `┃◬│ _*\`Status\`*_ : Online ✅`,
    `┃◬│ _*\`Uptime\`*_ : ${uptime}`,
    `┃◬│ _*\`Owner\`*_ : ${d.ownerName}`,
    `┃◬│ _*\`Mode\`*_ : ${d.mode}`,
    `┃◬│ _*\`Server\`*_ : ${d.server}`,
    `┃◬│ _*\`RAM\`*_ : ${d.ram}`,
    `┃◬│ _*\`Commands\`*_ : ${registry.size}`,
    `┃◬│ _*\`Version\`*_ : ${d.version}`,
    `┃◬│`,
    `╰═════════════════⊷`,
  ].join("\n");
}

module.exports = { renderMenu, renderList, renderAlive, renderHeader, headerData, formatUptime, ramLine };
