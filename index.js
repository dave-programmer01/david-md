const fs = require("fs");

// Must run BEFORE Baileys is required: libsignal captures a reference to
// console.log at module load, so patching afterwards has no effect on it.
const { setupLogger, baileysLogger } = require("./src/utils/logger");
setupLogger();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} = require("@whiskeysockets/baileys");

const S = require("./src/settings");

const db = require("./src/db");
const store = require("./src/store");
const registry = require("./src/lib/registry");
const { restoreSession } = require("./src/lib/session");
const { handleMessageUpsert } = require("./src/handlers/message");
const { handleParticipantsUpdate, handleGroupsUpdate } = require("./src/handlers/group");
const { handleCall } = require("./src/handlers/call");
const { rehydrateSchedules } = require("./src/utils/schedule");
const { startAutoMute } = require("./src/utils/automute");
const font = require("./src/lib/font");

// Single-flight guard + backoff. The old version called startBot() on a fixed
// 3s timer from inside the close handler, which stacked a new socket on every
// flap until the account got rate-limited.
let connecting = false;
let attempts = 0;

function ensureDirs() {
  for (const dir of [S.DATA_DIR, S.MEDIA_DIR, S.TMP_DIR, S.PLUGIN_DIR, S.SESSION_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function splash(count) {
  // Styled glyphs are astral-plane, so String.length overstates their width —
  // measure in code points and pad from that.
  const width = 56;
  const line = (text) => {
    const visible = [...text].length;
    return `║  ${text}${" ".repeat(Math.max(0, width - visible - 2))}║`;
  };

  console.log(
    [
      "",
      `╔${"═".repeat(width)}╗`,
      line(""),
      line(`${font.apply(S.BOT_NAME, "sans")}   v${S.VERSION}`),
      line(`${count} commands loaded`),
      line(""),
      `╚${"═".repeat(width)}╝`,
      "",
    ].join("\n")
  );
}

/**
 * Periodic proof-of-life.
 *
 * A bot that logs "Listening" and then nothing looks identical whether the
 * process died, the socket is up but WhatsApp is delivering nothing, or
 * messages are arriving and being filtered. The counters separate those.
 */
let heartbeat = null;
function startHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = setInterval(() => {
    const s = store.stats;
    const mins = Math.round((Date.now() - store.botStartTimestamp) / 60000);
    console.log(
      `💓 up ${mins}m | socket ${store.isConnected ? "open" : "CLOSED"} | ` +
        `upserts ${s.upserts} messages ${s.messages} commands ${s.commands} | ` +
        `skipped ${s.skippedNotNotify} backlog ${s.skippedBacklog} errors ${s.errors}` +
        (s.upserts === 0 ? "  ← nothing at all from WhatsApp yet" : "")
    );
  }, 5 * 60_000);
  if (heartbeat.unref) heartbeat.unref();
}

async function startBot() {
  if (connecting) return;
  connecting = true;

  const { state, saveCreds } = await useMultiFileAuthState(S.SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: baileysLogger,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    syncFullHistory: false,
    markOnlineOnConnect: await db.get("alwaysOnline"),
    generateHighQualityLinkPreview: true,
    getMessage: async (key) => store.messageCache.get(key.id)?.message || undefined,
  });

  store.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      connecting = false;
      attempts = 0;
      store.isConnected = true;
      store.botStartTimestamp = Date.now();

      const me = jidNormalizedUser(sock.user?.id || "");
      console.log(`✅ Connected as ${sock.user?.name || me}`);

      const pairedNumber = me.split("@")[0];
      const configuredOwner = await db.get("ownerNumber");

      // First boot with no owner configured: assume the paired account.
      if (!configuredOwner) {
        if (pairedNumber) {
          await db.set("ownerNumber", pairedNumber);
          console.log(`👑 Owner set to ${pairedNumber} (change it with .setownernumber)`);

          try {
            await sock.sendMessage(me, {
              text: "🎉 *Welcome to David-MD!*\n\nYour bot has been successfully paired, deployed, and connected!\n\nType *.menu* to see what I can do!"
            });
          } catch (err) {
            console.error("Failed to send welcome message:", err.message);
          }
        }
      } else if (configuredOwner !== pairedNumber) {
        // In private mode the bot answers only the owner. If that number isn't
        // the account that was paired, whoever deployed it gets silence — which
        // is indistinguishable from a broken bot.
        const mode = (await db.get("mode")) || S.MODE;
        console.log(
          `\n⚠️  OWNER_NUMBER is ${configuredOwner}, but the paired account is ${pairedNumber}.` +
            (mode === "private"
              ? `\n   Private mode replies only to ${configuredOwner}; messages from anyone else are ignored.` +
                `\n   Either message the bot from ${configuredOwner}, or clear OWNER_NUMBER so it` +
                `\n   defaults to the paired account, or switch to public mode.\n`
              : `\n   Mode is public, so everyone gets a reply regardless.\n`)
        );
      }

      await rehydrateSchedules(sock);
      startAutoMute(sock);
      startHeartbeat();
      require("./src/utils/ytcheck").reportYouTubeSupport().catch(() => {});
      console.log("👂 Listening…\n");
    }

    if (connection === "close") {
      connecting = false;
      store.isConnected = false;

      const statusCode = lastDisconnect?.error?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        console.error(`
╔══════════════════════════════════════════════════════════╗
║  LOGGED OUT                                              ║
║                                                          ║
║  This session is no longer valid. On your phone open     ║
║  WhatsApp > Settings > Linked Devices and remove this    ║
║  device, then generate a NEW session ID from the         ║
║  pairing website and paste it into config.js.            ║
╚══════════════════════════════════════════════════════════╝
`);
        process.exit(1);
      }

      // Exponential backoff, capped at 60s.
      attempts += 1;
      const delay = Math.min(60_000, 2_000 * 2 ** Math.min(attempts - 1, 5));
      console.log(`⚠️  Disconnected (${statusCode ?? "unknown"}). Reconnecting in ${delay / 1000}s…`);
      setTimeout(() => startBot().catch((e) => console.error("Reconnect failed:", e.message)), delay);
    }
  });

  sock.ev.on("messages.upsert", (upsert) => handleMessageUpsert(sock, upsert));
  sock.ev.on("group-participants.update", (u) => handleParticipantsUpdate(sock, u).catch((e) => console.error("group event:", e.message)));
  sock.ev.on("groups.update", (u) => handleGroupsUpdate(sock, u).catch(() => {}));
  sock.ev.on("call", (calls) => handleCall(sock, calls).catch(() => {}));

  return sock;
}

async function main() {
  ensureDirs();
  restoreSession();
  await db.init();

  registry.load();
  splash(registry.size);

  await startBot();
}

async function shutdown(signal) {
  console.log(`\n${signal} — saving state…`);
  try {
    await db.raw().close();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err?.message || err));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err?.message || err));

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
