const store = require("../store");
const { sameUser, numberOf } = require("../lib/ctx");

// 275k words, loaded once into a Set for O(1) validation, plus an index of the
// (first-letter, length) combinations that actually exist so the bot only ever
// asks for a length it's possible to answer. Built on first game — the ~30MB is
// only paid if someone plays.
let DICT = null;
let COMBOS = null;
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
  COMBOS = new Set();
  for (const w of words) if (/^[a-z]+$/.test(w)) COMBOS.add(`${w[0]}:${w.length}`);
}
const feasible = (letter, len) => COMBOS.has(`${letter}:${len}`);

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

const send = (chat, content) => store.sock?.sendMessage(chat, content).catch(() => {});
const clean = (text) => String(text || "").trim().toLowerCase().replace(/[^a-z]/g, "");
const alive = (game) => game.players.filter((p) => !p.out);

function timeLimit(game) {
  // game.cycle counts completed rounds, so time steps once per round.
  return Math.max(game.mode.floorMs, game.mode.startMs - game.cycle * game.mode.shrinkMs);
}

/**
 * The exact length this turn demands, given the difficulty ramp and the current
 * letter. Targets base + (rounds/lenEvery), then snaps to the nearest length
 * that actually has words for this letter, so a turn is never impossible.
 */
function requiredLength(game) {
  const m = game.mode;
  const target = Math.min(m.lenCap, m.lenBase + Math.floor(game.cycle / m.lenEvery));
  if (feasible(game.letter, target)) return target;

  // Walk outward from the target to the nearest solvable length.
  for (let delta = 1; delta <= 8; delta++) {
    if (target - delta >= 3 && feasible(game.letter, target - delta)) return target - delta;
    if (target + delta <= 12 && feasible(game.letter, target + delta)) return target + delta;
  }
  return Math.max(3, target); // extremely unlikely; validation still guards it
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
      `On your turn I'll ask for a word of an exact length, starting with a given letter. ` +
      `Send it before the clock runs out — keep trying as many times as you like until then. ` +
      `Run out of time and you're out.\n` +
      `Each word chains off the last letter of the one before it. Last player standing wins.`,
  });

  setTimeout(() => nextTurn(chat), 2500);
}

function nextTurn(chat) {
  const game = games.get(chat);
  if (!game || game.phase !== "playing") return;
  clearTimers(game);

  const remaining = alive(game);
  if (remaining.length <= 1) return endGame(chat, remaining[0]);

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

  send(chat, {
    text:
      `🔤 @${numberOf(player.jid)} — your turn!\n\n` +
      `Spell a *${game.len}-letter* word starting with *${game.letter.toUpperCase()}*.\n` +
      `⏱️ *${Math.round(limit / 1000)}s*`,
    mentions: [player.jid],
  });
}

function onTimeout(chat) {
  const game = games.get(chat);
  if (!game || game.phase !== "playing") return;

  const player = game.players[game.turn];
  player.out = true;
  send(chat, { text: `⏰ Time's up — @${numberOf(player.jid)} is out.`, mentions: [player.jid] });
  nextTurn(chat);
}

/**
 * A message from the player whose turn it is. Returns true if it was consumed
 * as a game answer, so the router doesn't also treat it as a command and the
 * anti-word hook doesn't flag a perfectly good word. A wrong answer is
 * corrected but never eliminates — only the clock does.
 */
function submitAnswer(chat, m) {
  const game = games.get(chat);
  if (!game || game.phase !== "playing") return false;

  const player = game.players[game.turn];
  if (!player || player.out) return false;
  if (!sameUser(m.senderIds || [m.sender], [player.jid])) return false; // not their turn

  const word = clean(m.body);
  const retry = (reason) => send(chat, { text: `🚫 ${reason} Try again.` });

  if (!word) return void retry("That's not a word."), true;
  if (!word.startsWith(game.letter)) return void retry(`It has to start with *${game.letter.toUpperCase()}*.`), true;
  if (word.length !== game.len) return void retry(`It has to be exactly *${game.len}* letters — *${word}* has ${word.length}.`), true;
  if (game.used.has(word)) return void retry(`*${word}* has already been used.`), true;
  if (!DICT.has(word)) return void retry(`*${word}* isn't a word.`), true;

  // Accepted — chain onward from its last letter.
  clearTimeout(game.turnTimer);
  game.used.add(word);
  game.accepted += 1;
  game.letter = word[word.length - 1];

  send(chat, { text: `✅ *${word}* — nice.` });
  nextTurn(chat);
  return true;
}

function endGame(chat, winner) {
  const game = games.get(chat);
  const total = game?.accepted || 0;
  if (game) clearTimers(game);
  games.delete(chat);

  if (!winner) return send(chat, { text: "🏁 Game over — nobody's left standing." });
  return send(chat, {
    text: `🏆 *${winner.name}* wins!\n\n@${numberOf(winner.jid)} outlasted everyone over ${total} word(s).`,
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
