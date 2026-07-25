const db = require("../db");

const numberOf = (jid) => String(jid || "").split("@")[0].split(":")[0];

/**
 * Auto-reject incoming calls when `.callreject on` is set.
 * WhatsApp fires this event repeatedly for one call, so only the "offer"
 * stage is acted on.
 */
async function handleCall(sock, calls) {
  if (!(await db.get("rejectCalls"))) return;

  for (const call of calls || []) {
    if (call.status !== "offer") continue;
    try {
      await sock.rejectCall(call.id, call.from);
      await sock.sendMessage(call.from, {
        text: "📵 Sorry, calls are automatically rejected. Send a message instead.",
      });
      console.log(`📵 Rejected a call from ${numberOf(call.from)}`);
    } catch (err) {
      console.error("Call reject failed:", err.message);
    }
  }
}

module.exports = { handleCall };
