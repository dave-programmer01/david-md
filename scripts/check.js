#!/usr/bin/env node
/**
 * Boot-time sanity check — run with `npm run check`.
 * Loads every command, asserts the registry is sound, and renders the menu so
 * formatting problems surface here rather than in a chat.
 */
const path = require("path");
process.env.SESSION_ID = process.env.SESSION_ID || "check-only";

const registry = require("../src/lib/registry");
const db = require("../src/db");
const menu = require("../src/lib/menu");
const font = require("../src/lib/font");

const EXPECTED = 166;

let failures = 0;
const ok = (msg) => console.log(`  ✅ ${msg}`);
const bad = (msg) => {
  failures += 1;
  console.log(`  ❌ ${msg}`);
};

(async () => {
  console.log("\n── Registry ──────────────────────────────────");

  registry.load();
  const all = registry.list();

  console.log(`  ${all.length} commands loaded`);
  if (all.length === EXPECTED) ok(`exactly ${EXPECTED} commands`);
  else bad(`expected ${EXPECTED} commands, got ${all.length}`);

  const names = new Set();
  const aliases = new Set();
  for (const cmd of all) {
    if (names.has(cmd.name)) bad(`duplicate name: ${cmd.name}`);
    names.add(cmd.name);
    for (const alias of cmd.aliases) {
      if (aliases.has(alias) || names.has(alias)) bad(`duplicate alias: ${alias} (on ${cmd.name})`);
      aliases.add(alias);
    }
    if (!cmd.desc) bad(`${cmd.name} has no description`);
    if (!cmd.usage) bad(`${cmd.name} has no usage line`);
    if (typeof cmd.execute !== "function") bad(`${cmd.name} has no execute()`);
  }
  if (!failures) ok("no duplicate names or aliases");

  console.log("\n── Categories ────────────────────────────────");
  const byCategory = registry.byCategory();
  let counted = 0;
  for (const [category, cmds] of byCategory) {
    counted += cmds.length;
    console.log(`  ${String(cmds.length).padStart(3)}  ${category}`);
  }
  if (counted === all.length) ok("every command has a valid category");
  else bad(`${all.length - counted} command(s) fell outside the known categories`);

  console.log("\n── Permissions ───────────────────────────────");
  const perms = {};
  for (const cmd of all) perms[cmd.permission] = (perms[cmd.permission] || 0) + 1;
  for (const [perm, n] of Object.entries(perms)) console.log(`  ${String(n).padStart(3)}  ${perm}`);

  console.log("\n── Menu render ───────────────────────────────");
  await db.init();
  const rendered = await menu.renderMenu({ pushName: "Test User", prefix: "." });

  const numbers = [...rendered.matchAll(/_`(\d+)\.`/g)].map((m) => Number(m[1]));
  const contiguous = numbers.every((n, i) => n === i + 1);

  if (numbers.length === all.length) ok(`menu lists all ${all.length} commands`);
  else bad(`menu lists ${numbers.length} of ${all.length}`);

  if (contiguous) ok(`numbering runs 1 → ${numbers.length} with no gaps`);
  else bad("menu numbering has a gap or repeat");

  const requiredGlyphs = ["╭═══〘", "┃◬╭──────────────", "▎▍▌▌▉▏▎▌▉▐▏▌▎", "╰═════════════════⊷", "⊷❍"];
  const missing = requiredGlyphs.filter((glyph) => !rendered.includes(glyph));
  if (!missing.length) ok("template box characters intact");
  else bad(`menu is missing: ${missing.join("  ")}`);

  if (rendered.includes(font.apply("David-md", "sans"))) ok("bot name renders in the template font");
  else bad("styled bot name missing from the header");

  console.log("\n── Sample of the rendered menu ───────────────\n");
  console.log(rendered.split("\n").slice(0, 24).join("\n"));

  console.log(`\n${failures ? `❌ ${failures} problem(s)` : "✅ All checks passed"}\n`);
  await db.raw().close().catch(() => {});
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error("\n💥 Check crashed:", err);
  process.exit(1);
});
