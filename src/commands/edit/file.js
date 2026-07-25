const { mediaCommand } = require("../general/media");
const { upload } = require("../../utils/providers/misc");

const CATEGORY = "Edit";

const MIME = {
  imageMessage: ["image/jpeg", "jpg"],
  videoMessage: ["video/mp4", "mp4"],
  audioMessage: ["audio/mpeg", "mp3"],
  stickerMessage: ["image/webp", "webp"],
};

module.exports = [
  mediaCommand({
    name: "doc",
    aliases: ["todoc", "file"],
    category: CATEGORY,
    desc: "Re-send media as a file, so it downloads at full quality",
    usage: "Reply to media with .doc",
    accepts: "any media",
    handler: async (ctx, buffer, target) => {
      const [mimetype, ext] = MIME[target.type] || ["application/octet-stream", "bin"];
      const given = ctx.text.trim();
      const fileName = given
        ? (given.includes(".") ? given : `${given}.${ext}`)
        : target.message?.documentMessage?.fileName || `file-${Date.now()}.${ext}`;

      return {
        document: buffer,
        mimetype,
        fileName,
        caption: `📎 ${fileName} — ${(buffer.length / 1024).toFixed(0)} KB`,
      };
    },
  }),

  mediaCommand({
    name: "url",
    aliases: ["geturl"],
    category: CATEGORY,
    desc: "Get a direct link to a piece of media",
    usage: "Reply to media with .url",
    accepts: "any media",
    handler: async (ctx, buffer, target) => {
      const [, ext] = MIME[target.type] || ["", "bin"];
      const name = target.message?.documentMessage?.fileName || `file.${ext}`;
      const link = await upload(buffer, name);

      return {
        text:
          `🔗 ${link}\n\n` +
          `Size: ${(buffer.length / 1024).toFixed(0)} KB\n` +
          `_Anyone with this link can open it, and it does not expire._`,
      };
    },
  }),
];
