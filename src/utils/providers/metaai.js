const { META_AI_JID, jidNormalizedUser } = require("@whiskeysockets/baileys");

/**
 * Talks to Meta AI — the assistant already built into WhatsApp — by messaging
 * it from the bot's own account and relaying what comes back.
 *
 * There is no API here and no key to buy: Meta AI is just another chat. That
 * also sets the limits. Replies arrive asynchronously in one shared thread, so
 * questions have to be asked one at a time and matched to the next thing that
 * comes back; and Meta AI streams an answer by *editing* its message as it
 * writes, so a reply is only finished once it stops changing.
 */

const JID = jidNormalizedUser(META_AI_JID); // 13135550002@s.whatsapp.net

// Meta AI edits its message while it writes. Wait for the text to stop
// changing rather than sending the first fragment we happen to see.
const SETTLE_MS = 2_500;
// Nothing at all after this long means Meta AI isn't answering this account.
const FIRST_REPLY_TIMEOUT_MS = 25_000;
// A long answer that keeps growing still has to end somewhere.
const HARD_TIMEOUT_MS = 60_000;

const isMetaAi = (jid) => jidNormalizedUser(String(jid || "")) === JID;

let pending = null;
// Every question gets a number, so a timer left over from an earlier one can
// never fire against the question that replaced it.
let seq = 0;
// One question at a time: two in flight would race for the same replies.
let queue = Promise.resolve();

const UNREACHABLE =
  "Meta AI didn't reply. It has to be available on this WhatsApp account — " +
  "open a chat with Meta AI from the phone once and check it answers there.";

function clearPending() {
  if (!pending) return;
  clearTimeout(pending.settleTimer);
  clearTimeout(pending.firstTimer);
  clearTimeout(pending.hardTimer);
  pending = null;
}

function finish() {
  if (!pending) return;
  const { resolve, parts } = pending;
  clearPending();
  resolve([...parts.values()].join("\n").trim());
}

/**
 * Hand a message from the Meta AI thread to whoever is waiting on it.
 *
 * Returns true for anything in that thread, answered or not — those messages
 * are the bot's own plumbing and must never reach the command router or the
 * passive hooks, or the bot would end up chatting with Meta AI on its own.
 */
function intercept(m) {
  if (!isMetaAi(m.chat)) return false;
  if (m.fromMe || !pending) return true; // our own outgoing prompt, or nobody waiting

  const text = (m.body || "").trim();
  if (text) {
    // Keyed by message id, because a streamed answer arrives as repeated
    // edits of one message — the last version is the real one.
    pending.parts.set(m.id, text);
    clearTimeout(pending.settleTimer);
    pending.settleTimer = setTimeout(finish, SETTLE_MS);
  }
  return true;
}

async function send(sock, prompt) {
  if (pending) throw new Error("Still waiting on Meta AI for the last question.");

  await sock.sendMessage(JID, { text: prompt });

  return new Promise((resolve, reject) => {
    const id = ++seq;
    const mine = () => pending && pending.id === id;
    const fail = () => {
      if (!mine()) return;
      clearPending();
      reject(new Error(UNREACHABLE));
    };

    pending = {
      id,
      resolve,
      parts: new Map(),
      settleTimer: null,
      // A shorter clock until the *first* fragment, so an unreachable Meta AI
      // fails in seconds rather than after the full hard timeout.
      firstTimer: setTimeout(() => {
        if (mine() && !pending.parts.size) fail();
      }, FIRST_REPLY_TIMEOUT_MS),
      // Something arrived and never stopped growing — take what we have.
      hardTimer: setTimeout(() => {
        if (!mine()) return;
        if (pending.parts.size) return finish();
        fail();
      }, HARD_TIMEOUT_MS),
    };
  });
}

/** Ask Meta AI something. Questions queue, so callers never interleave. */
function ask(sock, prompt) {
  const run = queue.then(
    () => send(sock, prompt),
    () => send(sock, prompt) // a failed predecessor must not poison the queue
  );
  // Keep the chain alive whatever this call does.
  queue = run.then(
    () => {},
    () => {}
  );
  return run;
}

module.exports = { ask, intercept, isMetaAi, JID, SETTLE_MS, FIRST_REPLY_TIMEOUT_MS, HARD_TIMEOUT_MS };
