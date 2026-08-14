const store = require("../store");
const { sameUser, numberOf } = require("../lib/ctx");

// 275k words, loaded once into a Set for O(1) validation, plus the longest word
// available for each starting letter. The length the bot asks for is a MINIMUM,
// so a turn is answerable as long as the letter has some word at least that
// long — MAXLEN tells us that. Built on first game — the ~30MB is only paid if
// someone plays.
let DICT = null;
let MAXLEN = null;
function load() {
  if (DICT) return;
  let words;
  try {
    words = require("an-array-of-english-words");
  } catch {
    // The one dependency this game needs isn't installed. On a panel that
    // means the word list was added after the last `npm install`.
    throw new Error(
      "The word list isn't installed. Run *npm install* (or rebuild the image) and try again."
    );
  }
  DICT = new Set(words);
  MAXLEN = {};
  for (const w of words) {
    if (!/^[a-z]+$/.test(w)) continue;
    const c = w[0];
    if (!MAXLEN[c] || w.length > MAXLEN[c]) MAXLEN[c] = w.length;
  }
}

/**
 * Difficulty is time and word length — nothing else. Both modes let you keep
 * trying until your clock runs out; only running out of time gets you out.
 *
 * The clock and the word length step **once per full round** — after everyone
 * still in has had a turn — not once per turn. Shrinking every turn made even a
 * two-player game collapse in seconds; per-round keeps it going. Everyone in the
 * same round faces the same time and length, which is also fairer than a later
 * seat drawing a harder word than an earlier one in the same round.
 *
 * shrinkMs / lenEvery are therefore *per round*, not per turn.
 */
const MODES = {
  easy: { joinMs: 30_000, startMs: 60_000, shrinkMs: 2_000, floorMs: 25_000, lenBase: 3, lenEvery: 3, lenCap: 6 },
  hard: { joinMs: 30_000, startMs: 40_000, shrinkMs: 2_000, floorMs: 10_000, lenBase: 4, lenEvery: 2, lenCap: 8 },
};

// Avoid opening on letters almost nothing starts with.
const START_LETTERS = "abcdefghlmprstw".split("");

const games = store.wcg; // Map<chatJid, game>

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// WhatsApp silently throttles rapid consecutive sends, and a dropped turn
// prompt leaves the game frozen with nobody knowing what to spell. Retry a few
// times with a short back-off so the prompt reliably lands.
async function send(chat, content) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!store.sock) return;
    try {
      return await store.sock.sendMessage(chat, content);
    } catch {
      await wait(500);
    }
  }
}
const clean = (text) => String(text || "").trim().toLowerCase().replace(/[^a-z]/g, "");
const alive = (game) => game.players.filter((p) => !p.out);

function timeLimit(game) {
  // game.cycle counts completed rounds, so time steps once per round.
  return Math.max(game.mode.floorMs, game.mode.startMs - game.cycle * game.mode.shrinkMs);
}

/**
 * The MINIMUM length this turn demands, from the difficulty ramp. A longer word
 * is always fine — "elephant" answers a "3+ letters starting with E". Capped at
 * the longest word the current letter actually has, so the minimum is never
 * higher than anything answerable.
 */
function requiredLength(game) {
  const m = game.mode;
  const target = Math.min(m.lenCap, m.lenBase + Math.floor(game.cycle / m.lenEvery));
  const max = MAXLEN[game.letter] || 3;
  return Math.min(target, max);
}

function clearTimers(game) {
  if (game.joinTimer) clearTimeout(game.joinTimer);
  if (game.turnTimer) clearTimeout(game.turnTimer);
  game.joinTimer = game.turnTimer = null;
}

// ── Lobby ──────────────────────────────────────────────────────────────────

function startLobby(chat, host, hostName, difficulty) {
  load();
  if (games.has(chat)) return { error: "A word game is already running in this chat." };

  const mode = MODES[difficulty];
  if (!mode) return { error: null, needsMode: true };

  const game = {
    chat,
    phase: "lobby",
    difficulty,
    mode,
    players: [{ jid: host, name: hostName, out: false }],
    used: new Set(),
    letter: START_LETTERS[Math.floor(Math.random() * START_LETTERS.length)],
    len: mode.lenBase,
    turn: 0,
    cycle: 0, // completed full rounds — drives both the clock and word length
    accepted: 0,
    joinTimer: null,
    turnTimer: null,
  };
  games.set(chat, game);

  game.joinTimer = setTimeout(() => beginPlay(chat), mode.joinMs);
  return { game };
}

function addPlayer(chat, jid, name) {
  const game = games.get(chat);
  if (!game || game.phase !== "lobby") return null;
  if (game.players.some((p) => sameUser([p.jid], [jid]))) return { already: true };
  game.players.push({ jid, name, out: false });
  return { count: game.players.length };
}

// ── Play ───────────────────────────────────────────────────────────────────

function beginPlay(chat) {
  const game = games.get(chat);
  if (!game || game.phase !== "lobby") return;
  clearTimers(game);

  if (game.players.length < 2) {
    games.delete(chat);
    return send(chat, {
      text: "❌ Not enough players joined — a word game needs at least 2. Start again with *.wcg easy* or *.wcg hard*.",
    });
  }

  game.phase = "playing";
  game.turn = -1; // nextTurn advances to 0

  send(chat, {
    text:
      `🎮 *Word Chain — ${game.difficulty.toUpperCase()}*\n\n` +
      `${game.players.length} players:\n` +
      game.players.map((p) => `• ${p.name}`).join("\n") +
      `\n\n*How it works*\n` +
      `On your turn I'll give you a letter and a minimum length — send a word that starts ` +
      `with that letter and is at least that long (longer is fine). Keep trying as many ` +
      `times as you like before the clock runs out. Run out of time and you're out.\n` +
      `Each word chains off the last letter of the one before it. Last player standing wins.`,
  });

  setTimeout(() => nextTurn(chat), 2500);
}

async function nextTurn(chat, lead = "") {
  const game = games.get(chat);
  if (!game || game.phase !== "playing") return;
  clearTimers(game);

  const remaining = alive(game);
  if (remaining.length <= 1) return endGame(chat, remaining[0], lead);

  // Advance round-robin to the next player who isn't out. When the index wraps
  // past the end of the list back to an earlier seat, a full round has elapsed
  // — that's when the clock and word length step, not on every turn.
  const prev = game.turn;
  do {
    game.turn = (game.turn + 1) % game.players.length;
  } while (game.players[game.turn].out);
  if (game.turn <= prev) game.cycle += 1;

  game.len = requiredLength(game);
  const player = game.players[game.turn];
  const limit = timeLimit(game);

  game.turnTimer = setTimeout(() => onTimeout(chat), limit);

  // The acceptance/elimination note (lead) rides along in the SAME message as
  // the turn prompt, so there's only ever one send per turn — no second message
  // to be throttled away, and the prompt can never go missing on its own.
  await send(chat, {
    text:
      lead +
      `🔤 @${numberOf(player.jid)} — your turn!\n\n` +
      `Give a word starting with *${game.letter.toUpperCase()}*, ` +
      `at least *${game.len}* letters long.\n` +
      `⏱️ *${Math.round(limit / 1000)}s*`,
    mentions: [player.jid],
  });
}

function onTimeout(chat) {
  const game = games.get(chat);
  if (!game || game.phase !== "playing") return;

  const player = game.players[game.turn];
  player.out = true;
  // Fold the elimination into the next prompt so it's one reliable message.
  nextTurn(chat, `⏰ Time's up — *${player.name}* is out.\n\n`);
}

/**
 * A message from the player whose turn it is. Returns true if it was consumed
 * as a game answer, so the router doesn't also treat it as a command and the
 * anti-word hook doesn't flag a perfectly good word. A wrong answer is
 * corrected but never eliminates — only the clock does.
 */
async function submitAnswer(chat, m) {
  const game = games.get(chat);
  if (!game || game.phase !== "playing") return false;

  const player = game.players[game.turn];
  if (!player || player.out) return false;
  if (!sameUser(m.senderIds || [m.sender], [player.jid])) return false; // not their turn

  const word = clean(m.body);
  const retry = (reason) => {
    send(chat, { text: `🚫 ${reason} Try again.` });
    return true;
  };

  if (!word) return retry("That's not a word.");
  if (!word.startsWith(game.letter)) return retry(`It has to start with *${game.letter.toUpperCase()}*.`);
  if (word.length < game.len) return retry(`Too short — needs at least *${game.len}* letters, *${word}* has ${word.length}.`);
  if (game.used.has(word)) return retry(`*${word}* has already been used.`);
  if (!DICT.has(word)) return retry(`*${word}* isn't a word.`);

  // Accepted — chain onward from its last letter. The "nice" note is merged
  // into the next turn's prompt so both arrive as a single message.
  clearTimeout(game.turnTimer);
  game.used.add(word);
  game.accepted += 1;
  game.letter = word[word.length - 1];

  await nextTurn(chat, `✅ *${word}* — nice.\n\n`);
  return true;
}

function endGame(chat, winner, lead = "") {
  const game = games.get(chat);
  const total = game?.accepted || 0;
  if (game) clearTimers(game);
  games.delete(chat);

  if (!winner) return send(chat, { text: `${lead}🏁 Game over — nobody's left standing.` });
  return send(chat, {
    text: `${lead}🏆 *${winner.name}* wins!\n\n@${numberOf(winner.jid)} outlasted everyone over ${total} word(s).`,
    mentions: [winner.jid],
  });
}

function cancel(chat) {
  const game = games.get(chat);
  if (!game) return false;
  clearTimers(game);
  games.delete(chat);
  return true;
}

const isJoinable = (chat) => {
  const game = games.get(chat);
  return game && game.phase === "lobby";
};

module.exports = { startLobby, addPlayer, submitAnswer, cancel, isJoinable, MODES, games };
