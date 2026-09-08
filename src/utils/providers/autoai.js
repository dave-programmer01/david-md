const S = require("../../settings");
const registry = require("../../lib/registry");
const metaai = require("./metaai");
const { LRU } = require("../../lib/cache");

/**
 * `.autoai` — a chatbot that can also *use* the bot.
 *
 * The brain is Meta AI, the assistant already inside WhatsApp, reached by
 * messaging it from the bot's own account (see metaai.js). Free, no key.
 *
 * Meta AI is text-in, text-out — there is no tool calling — so commands are
 * reached two ways:
 *
 *   1. The message opens with a command name ("sticker", "play despacito").
 *      Matched here, run immediately, Meta AI never involved.
 *   2. Anything else goes to Meta AI along with a shortlist of commands that
 *      look relevant, and a protocol: answer normally, or open the reply with
 *      "RUN: <command> <args>". A RUN line is parsed out, run, and stripped
 *      from what the user sees.
 *
 * Two rules keep that safe:
 *
 *   - A command runs through the same permission check the user would have hit
 *     typing it themselves, so a RUN line Meta AI was talked into emitting can
 *     never do more than its asker already could.
 *   - Commands run against the *original* message, so a reply, a mention or an
 *     attached image is still there for the command to find.
 *
 * If an ANTHROPIC_API_KEY happens to be set, run() uses Claude's tool calling
 * instead — same commands, same permission checks, better at choosing. That is
 * an optional upgrade; everything works without it.
 */

// Per-user continuity. The Meta AI thread is shared by everyone talking to the
// bot, so recent turns are replayed into each question to keep one person's
// conversation from reading as another's.
const history = new LRU({ max: 200, ttl: 60 * 60_000 });

// Commands the AI must not start on its own. These either kill the process
// mid-answer (so the user gets silence instead of a reply) or would have it
// call itself. The owner can still run them by typing them.
const BLOCKED = new Set(["autoai", "restart", "reboot", "update", "pupdate"]);

// How much of a command's chat output the AI gets told about. Enough to react
// to ("the group has 42 members"), not enough for `.menu` to swamp the reply.
const OUTPUT_LIMIT = 1200;

// Claude-only: a runaway tool loop costs money and floods the chat.
const MAX_STEPS = 6;

// Words too common to say anything about which command was meant.
const STOPWORDS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "it", "its", "my", "your",
  "me", "you", "i", "we", "us", "he", "she", "they", "them", "him", "her",
  "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "can",
  "could", "would", "should", "will", "shall", "may", "might", "must",
  "to", "of", "in", "on", "at", "for", "with", "from", "by", "as", "into",
  "and", "or", "but", "if", "then", "than", "so", "not", "no", "yes",
  "please", "pls", "bot", "hey", "hi", "hello", "ok", "okay", "just", "some",
  "what", "why", "how", "who", "when", "where", "which",
  "one", "all", "any", "out", "up", "down", "here", "there", "now",
]);

const normalize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Every command the AI is allowed to reach. */
const usable = () => registry.list().filter((c) => !c.hidden && !BLOCKED.has(c.name));

/**
 * Commands worth putting in front of Meta AI for this message.
 *
 * High recall on purpose — Meta AI does the choosing, this only keeps the
 * prompt short enough to send. An empty list means nothing looked like a
 * command, so the question goes over as plain conversation.
 */
function shortlist(text, limit = 12) {
  const words = normalize(text).filter((w) => !STOPWORDS.has(w));
  if (!words.length) return [];

  const scored = [];
  for (const cmd of usable()) {
    let score = 0;
    for (const word of words) {
      if (cmd.name === word) score += 10;
      else if ((cmd.aliases || []).includes(word)) score += 8;
      else if (cmd.name.startsWith(word) && word.length >= 4) score += 4;
      if (String(cmd.desc || "").toLowerCase().includes(word)) score += 3;
    }
    if (score) scored.push({ cmd, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.cmd.name.localeCompare(b.cmd.name))
    .slice(0, limit)
    .map((s) => s.cmd);
}

/** "sticker", "play despacito" — the message just names a command outright. */
function explicitMatch(text) {
  const trimmed = String(text || "").trim();
  const [first, ...rest] = trimmed.split(/\s+/);
  if (!first) return null;
  const cmd = registry.resolve(first.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (!cmd || BLOCKED.has(cmd.name)) return null;
  return { name: cmd.name, args: rest.join(" ") };
}

/** Look up commands by name, description or category. */
function search(query) {
  const q = String(query || "").toLowerCase().trim();
  const hits = usable()
    .filter(
      (c) =>
        !q ||
        c.name.includes(q) ||
        (c.aliases || []).some((a) => a.includes(q)) ||
        String(c.desc || "").toLowerCase().includes(q) ||
        String(c.category || "").toLowerCase().includes(q)
    )
    .slice(0, 25);

  if (!hits.length) return `No command matches "${query}".`;
  return hits
    .map((c) => `${c.name} (${c.category}, ${c.permission}) — ${c.desc || ""}\n  usage: ${c.usage || `.${c.name}`}`)
    .join("\n");
}

/**
 * Run one command on the caller's behalf.
 *
 * The original message is reused verbatim, so `ctx.quoted`, `ctx.media()`,
 * `ctx.targets()` and the mention list all still resolve — that is what lets
 * "turn this into a sticker" work on the image the user replied to.
 *
 * Output is sent to the chat as it normally would be *and* recorded, so the
 * caller knows what happened without the user seeing it twice.
 */
async function execute(parent, name, argString) {
  const key = String(name || "").replace(/^[^a-z0-9]+/i, "").toLowerCase();
  if (BLOCKED.has(key)) {
    return { ok: false, text: `"${key}" can't be run this way — tell the user to type ${parent.prefix}${key} themselves.` };
  }

  const command = registry.resolve(key);
  if (!command) return { ok: false, text: `There is no command called "${key}".` };

  const { buildContext } = require("../../lib/ctx");
  const { checkPermission } = require("../../handlers/message");

  const text = String(argString || "").trim();
  const args = text ? text.split(/\s+/) : [];
  const ctx = await buildContext({
    sock: parent.sock,
    m: parent.m,
    command,
    args,
    text,
    prefix: parent.prefix,
  });

  const denial = checkPermission(command, ctx);
  if (denial) return { ok: false, denied: true, text: denial };

  const captured = [];
  const record = (payload) => {
    if (typeof payload === "string") return captured.push(payload);
    if (payload?.text) return captured.push(payload.text);
    if (payload?.caption) return captured.push(payload.caption);
    const kind = Object.keys(payload || {})[0] || "something";
    captured.push(`[sent ${kind}]`);
  };

  const proxy = {
    ...ctx,
    reply(content, options) {
      record(content);
      return ctx.reply(content, options);
    },
    send(jid, content, options) {
      record(content);
      return ctx.send(jid, content, options);
    },
    // The ⏳/✅ reactions belong to the AI's own turn, not to each step of it.
    react: async () => {},
  };

  try {
    await command.execute(proxy);
  } catch (err) {
    return { ok: false, text: `${key} failed: ${err.message || err}` };
  }

  const output = captured.join("\n").trim();
  return {
    ok: true,
    ran: key,
    text: output.length > OUTPUT_LIMIT ? `${output.slice(0, OUTPUT_LIMIT)}…` : output,
  };
}

// ── Meta AI path (the default) ───────────────────────────────────────────

const RUN_LINE = /^[ \t>*_]*RUN:\s*([A-Za-z0-9_]+)[ \t]*(.*)$/gim;

/** Pull a RUN directive out of Meta AI's reply, and strip it from the text. */
function extractRun(reply) {
  RUN_LINE.lastIndex = 0;
  const match = RUN_LINE.exec(reply || "");
  if (!match) return { run: null, text: (reply || "").trim() };
  return {
    run: { name: match[1], args: (match[2] || "").replace(/^[*_~`]+|[*_~`]+$/g, "").trim() },
    text: String(reply).replace(RUN_LINE, "").trim(),
  };
}

/** The message actually sent over to Meta AI. */
function composePrompt(ctx, prompt) {
  const candidates = shortlist(prompt);
  const past = history.get(ctx.sender) || [];

  const lines = [];
  if (past.length) {
    lines.push("Earlier in this conversation:");
    for (const turn of past) lines.push(`  ${turn}`);
    lines.push("");
  }

  if (candidates.length) {
    lines.push(
      `You are the assistant inside a WhatsApp bot called ${S.BOT_NAME}. ` +
        `${ctx.pushName} is asking you something. If they are asking the bot to DO ` +
        `one of the things below, reply with nothing but a single line:`
    );
    lines.push("RUN: <command> <arguments>");
    lines.push("");
    lines.push("The things the bot can do here:");
    for (const c of candidates) lines.push(`  ${c.name} — ${c.desc || c.name}`);
    lines.push("");
    lines.push(
      "A command that works on a photo, a video or a replied-to message needs no " +
        "arguments — the bot already has the message. If none of them is what they " +
        "meant, ignore all of this and just answer the question normally, in plain " +
        "text, in a few sentences."
    );
    lines.push("");
  }

  lines.push(`${ctx.pushName} says: ${prompt}`);
  return lines.join("\n");
}

async function runViaMeta(ctx, prompt) {
  const reply = await metaai.ask(ctx.sock, composePrompt(ctx, prompt));
  const { run, text } = extractRun(reply);

  if (!run) {
    remember(ctx.sender, prompt, text);
    return text || "Meta AI didn't say anything back.";
  }

  console.log(`🤖 autoai → ${ctx.prefix}${run.name} ${run.args}`.trim());
  const result = await execute(ctx, run.name, run.args);

  // A refusal or a crash is plumbing, not conversation — say it, don't store it.
  if (result.denied) return result.text;
  if (!result.ok) return text ? `${text}\n\n⚠️ ${result.text}` : `⚠️ ${result.text}`;

  remember(ctx.sender, prompt, `(ran ${result.ran})`);
  // The command already sent its own output — anything more would be a repeat.
  return text;
}

/** Two turns of per-user context, short enough to prepend to every question. */
function remember(userJid, prompt, answer) {
  const trim = (s, n) => (String(s || "").length > n ? `${String(s).slice(0, n)}…` : String(s || ""));
  const turn = `They asked: "${trim(prompt, 160)}" — you answered: "${trim(answer, 200)}"`;
  history.set(userJid, [...(history.get(userJid) || []), turn].slice(-2));
}

// ── Claude path (optional, only when a key is configured) ────────────────

const usingClaude = () => !!S.ANTHROPIC_API_KEY;

async function runViaClaude(ctx, prompt) {
  const { runWithTools } = require("./autoai-claude");
  return runWithTools({ ctx, prompt, execute, search, usable, OUTPUT_LIMIT, MAX_STEPS, BLOCKED });
}

/** Answer one message, running a command along the way if that's what it takes. */
async function run(ctx, prompt) {
  // "sticker", "play despacito" — no point asking an AI what that means.
  const explicit = explicitMatch(prompt);
  if (explicit) {
    console.log(`🤖 autoai → ${ctx.prefix}${explicit.name} ${explicit.args}`.trim());
    const result = await execute(ctx, explicit.name, explicit.args);
    if (result.denied || !result.ok) return result.text;
    return ""; // the command spoke for itself
  }

  return usingClaude() ? runViaClaude(ctx, prompt) : runViaMeta(ctx, prompt);
}

/** Meta AI needs no key, so AutoAI is always usable. */
const isConfigured = () => true;

const forget = (userJid) => history.delete(userJid);

module.exports = {
  run, forget, isConfigured, search, shortlist, explicitMatch, extractRun,
  execute, composePrompt, usingClaude, BLOCKED, MAX_STEPS, OUTPUT_LIMIT,
};
