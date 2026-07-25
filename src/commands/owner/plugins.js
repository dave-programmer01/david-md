const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const S = require("../../settings");
const registry = require("../../lib/registry");

const CATEGORY = "Owner";
const run = promisify(execFile);

const safeName = (name) => String(name).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);

/** Turn a GitHub blob / gist page URL into its raw-content equivalent. */
function rawUrl(url) {
  return String(url)
    .replace(/^https?:\/\/github\.com\/(.+)\/blob\/(.+)$/, "https://raw.githubusercontent.com/$1/$2")
    .replace(/^(https?:\/\/gist\.github\.com\/[^/]+\/[a-f0-9]+)$/, "$1/raw");
}

module.exports = [
  {
    name: "install",
    aliases: ["addplugin"],
    category: CATEGORY,
    desc: "Install an extra command from a URL",
    usage: ".install <url to a .js file>",
    permission: "owner",
    execute: async (ctx) => {
      const url = ctx.args[0];
      if (!url || !/^https?:\/\//.test(url)) {
        return ctx.reply(
          `*Usage:* ${ctx.prefix}install <url>\n\n` +
            `Point it at a raw .js file (a GitHub file or gist works).\n\n` +
            `⚠️ *This runs someone else's code inside your bot.* Only install ` +
            `plugins from a source you actually trust — a malicious one can read ` +
            `your session and take over the account.`
        );
      }

      const res = await fetch(rawUrl(url), { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return ctx.reply(`❌ Couldn't fetch that (${res.status}).`);
      const code = await res.text();

      if (!/module\.exports/.test(code)) {
        return ctx.reply("❌ That file doesn't look like a plugin — it has no `module.exports`.");
      }

      const name = safeName(path.basename(new URL(url).pathname, ".js")) || `plugin-${Date.now()}`;
      const file = path.join(S.PLUGIN_DIR, `${name}.js`);

      fs.mkdirSync(S.PLUGIN_DIR, { recursive: true });
      fs.writeFileSync(file, code);

      try {
        const loaded = registry.loadFile(file, { strict: true });
        // Record where it came from so .pupdate can re-fetch it later.
        const manifest = path.join(S.PLUGIN_DIR, ".sources.json");
        const sources = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")) : {};
        sources[name] = url;
        fs.writeFileSync(manifest, JSON.stringify(sources, null, 2));

        return ctx.reply(
          `✅ Installed *${name}*\n\n` +
            `New commands: ${loaded.map((c) => `${ctx.prefix}${c.name}`).join(", ")}`
        );
      } catch (err) {
        fs.rmSync(file, { force: true });
        return ctx.reply(`❌ That plugin wouldn't load, so I removed it:\n${err.message}`);
      }
    },
  },

  {
    name: "plugin",
    aliases: ["plugins"],
    category: CATEGORY,
    desc: "List installed plugins",
    usage: ".plugin",
    permission: "owner",
    execute: async (ctx) => {
      const files = fs.existsSync(S.PLUGIN_DIR)
        ? fs.readdirSync(S.PLUGIN_DIR).filter((f) => f.endsWith(".js"))
        : [];

      if (!files.length) {
        return ctx.reply(`No plugins installed.\n\nAdd one with:\n${ctx.prefix}install <url>`);
      }

      const lines = files.map((file) => {
        const full = path.join(S.PLUGIN_DIR, file);
        const commands = registry.list().filter((c) => c.source === full);
        return `┃◬│ *${file.replace(/\.js$/, "")}*\n┃◬│   ${
          commands.length ? commands.map((c) => ctx.prefix + c.name).join(", ") : "_no commands loaded_"
        }`;
      });

      return ctx.reply(`╭═══〘 *Plugins* 〙═══⊷❍\n${lines.join("\n┃◬│\n")}\n╰═════════════════⊷`);
    },
  },

  {
    name: "remove",
    aliases: ["delplugin", "uninstall"],
    category: CATEGORY,
    desc: "Uninstall a plugin",
    usage: ".remove myplugin",
    permission: "owner",
    execute: async (ctx) => {
      const name = safeName(ctx.args[0] || "");
      if (!name) return ctx.reply(`*Usage:* ${ctx.prefix}remove <plugin name>\n\nSee them with ${ctx.prefix}plugin`);

      const file = path.join(S.PLUGIN_DIR, `${name}.js`);
      if (!fs.existsSync(file)) return ctx.reply(`❌ No plugin called *${name}*.`);

      fs.rmSync(file, { force: true });
      registry.load();
      return ctx.reply(`🗑️ Removed *${name}*.`);
    },
  },

  {
    name: "pupdate",
    category: CATEGORY,
    desc: "Re-download every installed plugin's newest version",
    usage: ".pupdate",
    permission: "owner",
    execute: async (ctx) => {
      const manifest = path.join(S.PLUGIN_DIR, ".sources.json");
      if (!fs.existsSync(manifest)) {
        return ctx.reply(
          "Nothing to update — I don't have the original URLs on record.\n\n" +
            `_Plugins installed from now on are tracked, so ${ctx.prefix}pupdate will work for them._`
        );
      }
      const sources = JSON.parse(fs.readFileSync(manifest, "utf8"));
      const results = [];

      for (const [name, url] of Object.entries(sources)) {
        try {
          const res = await fetch(rawUrl(url), { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          fs.writeFileSync(path.join(S.PLUGIN_DIR, `${name}.js`), await res.text());
          results.push(`✅ ${name}`);
        } catch (err) {
          results.push(`❌ ${name} — ${err.message}`);
        }
      }

      registry.load();
      return ctx.reply(`*Plugin update*\n\n${results.join("\n")}`);
    },
  },

  {
    name: "update",
    category: CATEGORY,
    desc: "Pull the newest bot code and restart",
    usage: ".update",
    permission: "owner",
    execute: async (ctx) => {
      if (!fs.existsSync(path.join(S.ROOT, ".git"))) {
        return ctx.reply(
          "❌ This copy wasn't installed with git, so I can't pull updates.\n\n" +
            `Download the latest from github.com/${S.REPO}, copy your *config.js* across, and redeploy.`
        );
      }

      await ctx.reply("⬇️ Checking for updates…");

      try {
        const { stdout } = await run("git", ["pull", "--ff-only"], { cwd: S.ROOT, timeout: 60_000 });
        if (/Already up to date/i.test(stdout)) return ctx.reply("✅ Already on the latest version.");

        await ctx.reply(
          `✅ Updated:\n\`\`\`${stdout.trim().slice(0, 700)}\`\`\`\n\n` +
            `Restarting — if any new packages were added, run \`npm install\` first.`
        );
        setTimeout(() => process.exit(0), 2000);
      } catch (err) {
        return ctx.reply(
          `❌ Update failed:\n${String(err.stderr || err.message).slice(0, 400)}\n\n` +
            `_If you edited files locally, git won't overwrite them._`
        );
      }
    },
  },
];
