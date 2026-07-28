const store = require("../store");
const { sameUser, numberOf } = require("../lib/ctx");

// 275k words, loaded once into a Set for O(1) validation. ~30MB resident, paid
// only if someone actually plays — require() is lazy at module load but the
// Set build happens on first game.
let DICTIONARY = null;
function dictionary() {
  if (!DICTIONARY) DICTIONARY = new Set(require("an-array-of-english-words"));
  return DICTIONARY;
}

/**
 * Difficulty is more than a timer. Easy lets you retry a wrong word until your
 * clock runs out and never raises the minimum length; hard eliminates you on
 * the first wrong answer and demands longer words as the game wears on. Both
 * shrink the clock each round, hard faster and to a lower floor.
 */
const MODES = {
  easy: { joinMs: 30_000, startMs: 45_000, shrinkMs: 3_000, floorMs: 15_000, minLen: 3, ramp: false, strict: false },
  hard: { joinMs: 30_000, startMs: 28_000, shrinkMs: 4_000, floorMs: 8_000, minLen: 4, ramp: true, strict: true },
};

// Avoid opening on letters almost nothing starts with.
const START_LETTERS = "abcdefghlmprstw".split("");

const games = store.wcg; // Map<chatJid, game>

const send = (chat, content) => store.sock?.sendMessage(chat, content).catch(() => {});
const clean = (text) => String(text || "").trim().toLowerCase().replace(/[^a-z]/g, "");
const alive = (game) => game.players.filter((p) => !p.out);
const minLenFor = (game) => (game.mode.ramp ? Math.min(7, game.mode.minLen + Math.floor(game.accepted / 5)) : game.mode.minLen);

function timeLimit(game) {
  return Math.max(game.mode.floorMs, game.mode.startMs - game.round * game.mode.shrinkMs);
}

function clearTimers(game) {
  if (game.joinTimer) clearTimeout(game.joinTimer);
  if (game.turnTimer) clearTimeout(game.turnTimer);
  game.joinTimer = game.turnTimer = null;
}

// ── Lobby ──────────────────────────────────────────────────────────────────

function startLobby(chat, host, hostName, difficulty) {
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
    turn: 0,
    round: 0,
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
      `\n\n*Rules*\n` +
      `When it's your turn, reply with a real word starting with the given letter, before time runs out.\n` +
      (game.mode.strict
        ? `_Hard: one wrong word and you're out, and the words get longer as you go._`
        : `_Easy: keep trying until your time runs out._`),
  });

  setTimeout(() => nextTurn(chat), 2500);
}

function nextTurn(chat) {
  const game = games.get(chat);
  if (!game || game.phase !== "playing") return;
  clearTimers(game);

  const remaining = alive(game);
  if (remaining.length <= 1) return endGame(chat, remaining[0]);

  // Advance round-robin to the next player who isn't out.
  do {
    game.turn = (game.turn + 1) % game.players.length;
  } while (game.players[game.turn].out);

  game.round += 1;
  const player = game.players[game.turn];
  const limit = timeLimit(game);
  const minLen = minLenFor(game);

  game.turnTimer = setTimeout(() => onTimeout(chat), limit);

  send(chat, {
    text:
      `🔤 @${numberOf(player.jid)} — your turn!\n\n` +
      `Give a word starting with *${game.letter.toUpperCase()}*` +
      (minLen > 3 ? ` (at least *${minLen}* letters)` : "") +
      `\n⏱️ *${Math.round(limit / 1000)}s*`,
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
 * as a game answer, so the router doesn't also treat it as a command or let
 * the anti-word hook flag a perfectly good word.
 */
function submitAnswer(chat, m) {
  const game = games.get(chat);
  if (!game || game.phase !== "playing") return false;

  const player = game.players[game.turn];
  if (!player || player.out) return false;
  if (!sameUser(m.senderIds || [m.sender], [player.jid])) return false; // not their turn

  const word = clean(m.body);
  const minLen = minLenFor(game);
  const eliminate = (reason) => {
    clearTimeout(game.turnTimer);
    player.out = true;
    send(chat, { text: `❌ @${numberOf(player.jid)} — ${reason} You're out.`, mentions: [player.jid] });
    nextTurn(chat);
  };
  const reject = (reason) => {
    // Easy mode: correct them but let the clock keep running so they can retry.
    if (game.mode.strict) return eliminate(reason);
    send(chat, { text: `🚫 ${reason} Try again.` });
  };

  if (!word) {
    reject("That's not a word.");
    return true;
  }
  if (!word.startsWith(game.letter)) {
    reject(`It has to start with *${game.letter.toUpperCase()}*.`);
    return true;
  }
  if (word.length < minLen) {
    reject(`Too short — needs at least *${minLen}* letters.`);
    return true;
  }
  if (game.used.has(word)) {
    reject(`*${word}* has already been used.`);
    return true;
  }
  if (!dictionary().has(word)) {
    reject(`*${word}* isn't a word.`);
    return true;
  }

  // Accepted — chain onward from its last letter.
  clearTimeout(game.turnTimer);
  game.used.add(word);
  game.accepted += 1;
  game.letter = word[word.length - 1];

  send(chat, { text: `✅ *${word}* — nice.`, mentions: [] });
  nextTurn(chat);
  return true;
}

function endGame(chat, winner) {
  const game = games.get(chat);
  if (game) clearTimers(game);
  games.delete(chat);

  if (!winner) {
    return send(chat, { text: "🏁 Game over — nobody's left standing." });
  }
  return send(chat, {
    text:
      `🏆 *${winner.name}* wins!\n\n` +
      `@${numberOf(winner.jid)} outlasted everyone over ${game?.accepted || 0} word(s).`,
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
