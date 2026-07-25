const crypto = require("crypto");

/**
 * WhatsApp reads sticker pack/author from an EXIF chunk embedded in the WebP.
 * sharp cannot write that chunk, so we build it by hand and splice it in with
 * node-webpmux. Without this the sticker still sends, but shows no pack name
 * and cannot be added to a pack — which is what `.setstickername` is for.
 */
function buildExif({ pack = "David-md", author = "David", emojis = [], id } = {}) {
  const payload = {
    "sticker-pack-id": id || crypto.randomBytes(16).toString("hex"),
    "sticker-pack-name": String(pack || ""),
    "sticker-pack-publisher": String(author || ""),
    emojis: Array.isArray(emojis) ? emojis : [],
  };

  const json = Buffer.from(JSON.stringify(payload), "utf8");

  // Minimal TIFF/EXIF header with one custom tag (0x5741 "AW") whose value is
  // the JSON above. The length is patched into bytes 14..17.
  const header = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);

  const exif = Buffer.concat([header, json]);
  exif.writeUIntLE(json.length, 14, 4);
  return exif;
}

/** Attach pack metadata to a finished WebP buffer. */
async function writeStickerMetadata(webpBuffer, meta = {}) {
  let webpmux;
  try {
    webpmux = require("node-webpmux");
  } catch {
    // Metadata is a nicety; a missing optional dep must not break stickers.
    return webpBuffer;
  }

  try {
    const image = new webpmux.Image();
    await image.load(webpBuffer);
    image.exif = buildExif(meta);
    return await image.save(null);
  } catch (err) {
    console.error("sticker metadata failed:", err.message);
    return webpBuffer;
  }
}

module.exports = { buildExif, writeStickerMetadata };
