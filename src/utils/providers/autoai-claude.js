const S = require("../../settings");

/**
 * Optional upgrade path for `.autoai`.
 *
 * Meta AI is the default brain and needs no key, but it is text-only — command
 * choice rides on it following a "RUN:" convention. When an ANTHROPIC_API_KEY
 * is configured, this runs the same commands through real tool calling
 * instead, which picks better and can take more than one step.
 *
 * Nothing here changes what is allowed: it calls the same execute() from
 * autoai.js, so every command still goes through the caller's own permissions.
 */

let client = null;

function getClient() {
  if (!client) {
    let Anthropic;
    try {
      Anthropic = require("@anthropic-ai/sdk");
    } catch {
      throw new Error("The @anthropic-ai/sdk package is missing. Run: npm install @anthropic-ai/sdk");
    }
    client = new Anthropic({ apiKey: S.ANTHROPIC_API_KEY });
  }
  return client;
}

const BASE_PROMPT =
  "You are the assistant inside a WhatsApp bot. You do two things: answer " +
  "questions like a normal chatbot, and run the bot's own commands when that " +
  "is what the person actually wants.\n\n" +
  "When to use run_command:\n" +
  "- The request maps onto a command — 'make this a sticker', 'kick him', " +
  "'download this song', 'show the menu'. Run it. Don't explain how to run it.\n" +
  "- You are unsure which command fits: call list_commands first.\n" +
  "- It's a general question ('why is the sky blue') — just answer, no tools.\n\n" +
  "Whatever a command prints is delivered to the chat by the command itself. " +
  "You do not need to repeat, quote or summarise it. After a command succeeds, " +
  "reply with one short line at most, or with nothing at all when the output " +
  "already speaks for itself.\n\n" +
  "Run only what was asked for. Never chain in an extra command the person " +
  "didn't ask for, and never run anything destructive (kick, ban, delete, mute, " +
  "warn) on a guess — if the target is ambiguous, ask who they mean instead.\n\n" +
  "Plain text only: WhatsApp does not render markdown headings, tables or code " +
  "fences, so never use them. Use *bold* and _italic_ sparingly, the way a " +
  "person texting would. Keep answers to a few sentences unless asked for more.";

const TOOLS = [
  {
    name: "run_command",
    description:
      "Run one of the bot's commands. It runs as the person who is talking to " +
      "you, with their permissions — if they aren't allowed, it fails and you " +
      "are told so. Its output goes straight to the chat.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: 'Command name, without the prefix. e.g. "sticker", "play", "kick".',
        },
        args: {
          type: "string",
          description:
            "Everything after the command name, exactly as a person would type " +
            "it. Empty when the command takes no arguments. A command that acts " +
            "on a replied-to message or an attached image needs no args — it " +
            "already sees the original message.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "list_commands",
    description:
      "Look up commands by name, description or category when you need the " +
      "exact name or the argument format before running something.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Word to match against command names, descriptions and categories.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

/** The full command catalogue. Stable between calls, so it caches well. */
function catalogue(usable) {
  const byCategory = new Map();
  for (const cmd of usable()) {
    if (!byCategory.has(cmd.category)) byCategory.set(cmd.category, []);
    byCategory.get(cmd.category).push(cmd);
  }
  const lines = [];
  for (const [category, cmds] of byCategory) {
    const names = cmds
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `${c.name} — ${c.desc || "no description"}`);
    lines.push(`${category}:\n  ${names.join("\n  ")}`);
  }
  return `Available commands, by category:\n\n${lines.join("\n\n")}`;
}

/** Who the model is talking to, and what they're allowed to do. */
function situation(ctx) {
  const role = ctx.isOwner
    ? "the bot owner"
    : ctx.isSudo
      ? "a sudo user"
      : ctx.isAdmin
        ? "a group admin"
        : "a regular user";
  return [
    `You are ${S.BOT_NAME}. The command prefix is "${ctx.prefix}".`,
    `You are talking to ${ctx.pushName}, who is ${role}.`,
    ctx.isGroup
      ? `This is a group chat${ctx.groupMeta?.subject ? ` called "${ctx.groupMeta.subject}"` : ""}. ` +
        `You are ${ctx.isBotAdmin ? "" : "not "}an admin here.`
      : "This is a one-to-one chat, so group commands will not work.",
    ctx.m?.quoted
      ? `Their message replies to another one${ctx.m.quoted.isMedia ? ` containing ${ctx.m.quoted.type}` : ""}. ` +
        "Commands that act on a replied-to message will find it."
      : null,
    ctx.m?.isMedia ? `Their message has ${ctx.m.type} attached.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Turn execute()'s result into something the model can read. */
function describe(name, result) {
  if (result.denied) return `Not allowed: ${result.text.replace(/^❌\s*/, "")}`;
  if (!result.ok) return result.text;
  if (!result.text) return `Ran ${name}. It produced no text output.`;
  return `Ran ${name}. Output, already sent to the chat:\n${result.text}`;
}

async function runWithTools({ ctx, prompt, execute, search, usable, MAX_STEPS }) {
  const messages = [{ role: "user", content: prompt }];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await getClient().beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 8000,
      // Medium rather than low: picking the right command out of ~160 and
      // getting its arguments right is where this earns its keep.
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        // Split so the big, unchanging half stays cacheable across every user
        // and chat, and only the per-chat lines below it vary.
        {
          type: "text",
          text: `${BASE_PROMPT}\n\n${catalogue(usable)}`,
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: situation(ctx) },
      ],
      tools: TOOLS,
      messages,
    });

    // Opus 5's safety classifiers can decline with a 200 and no content at all,
    // so stop_reason has to be checked before content is read.
    if (response.stop_reason === "refusal") return "🚫 I can't help with that one.";

    const answer = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const calls = response.content.filter((b) => b.type === "tool_use");
    if (!calls.length) return answer;

    messages.push({ role: "assistant", content: response.content });

    // Results for every call go back in one user message — splitting them
    // teaches the model to stop asking for parallel work.
    const results = [];
    for (const call of calls) {
      let content;
      if (call.name === "run_command") {
        const name = call.input?.command;
        console.log(`🤖 autoai → ${ctx.prefix}${name} ${call.input?.args || ""}`.trim());
        content = describe(name, await execute(ctx, name, call.input?.args));
      } else if (call.name === "list_commands") {
        content = search(call.input?.query);
      } else {
        content = `Unknown tool "${call.name}".`;
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content });
    }
    messages.push({ role: "user", content: results });
  }

  return "I went round in circles on that one — try asking more directly.";
}

module.exports = { runWithTools, catalogue, situation, TOOLS };
