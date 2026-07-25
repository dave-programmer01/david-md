const S = require("../../settings");
const { LRU } = require("../../lib/cache");

// Short rolling history per user so `.chatbot` feels like a conversation
// without growing unbounded on a busy group.
const history = new LRU({ max: 200, ttl: 60 * 60_000 });

const SYSTEM =
  "You are a helpful assistant replying inside WhatsApp. " +
  "Keep answers short and conversational — a few sentences at most unless the " +
  "user explicitly asks for detail. Plain text only: WhatsApp does not render " +
  "markdown headings, tables or code fences, so never use them. Use *bold* and " +
  "_italic_ sparingly, the way a person texting would.";

let client = null;

function getClient() {
  if (!S.ANTHROPIC_API_KEY) {
    throw new Error(
      "No API key set. Open config.js and put your Anthropic key in ANTHROPIC_API_KEY, then restart."
    );
  }
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

const isConfigured = () => !!S.ANTHROPIC_API_KEY;

/** One-shot question, no memory — used by `.ai`. */
async function ask(prompt) {
  return complete([{ role: "user", content: prompt }]);
}

/** Conversational reply with per-user memory — used by `.chatbot`. */
async function chat(prompt, userJid) {
  const past = history.get(userJid) || [];
  const messages = [...past, { role: "user", content: prompt }];
  const answer = await complete(messages);
  // Keep the last 5 exchanges; the API is stateless so this is the whole memory.
  history.set(userJid, [...messages, { role: "assistant", content: answer }].slice(-10));
  return answer;
}

async function complete(messages) {
  const response = await getClient().beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 8000,
    // Thinking is on by default on Opus 5 and max_tokens covers thinking plus
    // reply, so the budget is deliberately larger than any WhatsApp message.
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages,
  });

  // Opus 5's safety classifiers can decline with a 200 and an empty content
  // array — reading content[0] blindly would throw.
  if (response.stop_reason === "refusal") {
    return "🚫 I can't help with that one.";
  }

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

const forget = (userJid) => history.delete(userJid);

module.exports = { ask, chat, forget, isConfigured, SYSTEM };
