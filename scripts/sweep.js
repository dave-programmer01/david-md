#!/usr/bin/env node
/**
 * Execute every command's no-argument path against a mock context.
 *
 * Most commands answer a bare invocation with a usage message, so this proves
 * the handler runs, reads settings, and produces output — without touching
 * WhatsApp. It is a crash sweep, not a behaviour test.
 */
const registry = require("../src/lib/registry");
const db = require("../src/db");

// Commands that end the process, leave groups, or block people. Their handlers
// are still loaded and validated, they're just not invoked here.
const DESTRUCTIVE = new Set([
  "restart", "reboot", "update", "setvar", "delvar", "leave",
  "block", "unblock", "clear", "install", "pupdate", "remove",
]);

// Commands that reach out to a third-party service.
const NETWORKED = new Set([
  "ai", "tts", "upload", "url", "img", "find", "ig",
  "insta", "fb", "story", "pinterest", "tiktok",
  "song", "play", "yta", "video", "ytv", "yts", "spotify",
]);

const only = process.argv.includes("--network");

function mockContext(command) {
  const sent = [];
  const ctx = {
    sock: {
      user: { id: "15550000000:1@s.whatsapp.net", name: "Test" },
      sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: "MOCK" } }; },
      groupMetadata: async () => ({ subject: "Test Group", participants: [], owner: null, creation: 0, desc: "" }),
      groupFetchAllParticipating: async () => ({}),
      groupInviteCode: async () => "ABC123",
      groupRevokeInvite: async () => "XYZ789",
      groupRequestParticipantsList: async () => [],
      groupRequestParticipantsUpdate: async () => [],
      groupParticipantsUpdate: async () => [],
      groupSettingUpdate: async () => {},
      groupUpdateSubject: async () => {},
      groupUpdateDescription: async () => {},
      groupLeave: async () => {},
      updateBlockStatus: async () => {},
      updateProfilePicture: async () => {},
      chatModify: async () => {},
    },
    m: {
      key: { id: "MOCK", remoteJid: "123@g.us" },
      chat: "123@g.us", sender: "15551111111@s.whatsapp.net",
      isGroup: true, fromMe: false, isMedia: false,
      type: "conversation", message: {}, body: "", mentions: [], timestamp: Date.now(),
      raw: { key: { id: "MOCK" }, message: {} },
    },
    command, args: [], text: "", prefix: ".",
    chat: "123@g.us", chatId: "123@g.us",
    sender: "15551111111@s.whatsapp.net", senderNumber: "15551111111",
    pushName: "Tester", botJid: "15550000000@s.whatsapp.net",
    isGroup: true, isDM: false,
    isOwner: true, isSudo: true, isAdmin: true, isBotAdmin: true,
    groupMeta: { subject: "Test Group", participants: [], desc: "", owner: null, creation: 0 },
    participants: [], quoted: null, mentions: [], db,
    targets: () => [],
    reply: async (c) => { sent.push({ jid: "reply", content: c }); return { key: { id: "MOCK" } }; },
    send: async (jid, c) => { sent.push({ jid, content: c }); return { key: { id: "MOCK" } }; },
    react: async () => {},
    download: async () => null,
    media: () => null,
    groupSettings: () => db.group("123@g.us"),
    setGroupSetting: (k, v) => db.setGroup("123@g.us", k, v),
    refreshGroup: async () => ({}),
  };
  return { ctx, sent };
}

(async () => {
  registry.load();
  await db.init();

  const results = { ok: [], replied: [], silent: [], skipped: [], failed: [] };

  for (const command of registry.list()) {
    if (DESTRUCTIVE.has(command.name)) { results.skipped.push(command.name); continue; }
    if (NETWORKED.has(command.name) && !only) { results.skipped.push(command.name); continue; }

    const { ctx, sent } = mockContext(command);
    try {
      await command.execute(ctx);
      if (sent.length) results.replied.push(command.name);
      else results.silent.push(command.name);
      results.ok.push(command.name);
    } catch (err) {
      results.failed.push({ name: command.name, error: err.message });
    }
  }

  console.log(`\n── Sweep of ${registry.size} commands ──────────────────\n`);
  console.log(`  ran and replied : ${results.replied.length}`);
  console.log(`  ran, no output  : ${results.silent.length}${results.silent.length ? `  (${results.silent.join(", ")})` : ""}`);
  console.log(`  skipped         : ${results.skipped.length}  (destructive or networked)`);
  console.log(`  crashed         : ${results.failed.length}`);

  if (results.failed.length) {
    console.log("\n  Failures:");
    for (const f of results.failed) console.log(`    ❌ ${f.name.padEnd(18)} ${f.error}`);
  }

  console.log(
    results.failed.length
      ? `\n❌ ${results.failed.length} command(s) crashed on their no-argument path\n`
      : `\n✅ every non-skipped command ran without crashing\n`
  );

  await db.raw().close().catch(() => {});
  process.exit(results.failed.length ? 1 : 0);
})().catch((err) => {
  console.error("Sweep crashed:", err);
  process.exit(1);
});
