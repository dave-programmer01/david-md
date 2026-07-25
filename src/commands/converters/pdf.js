const sharp = require("sharp");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const store = require("../../store");

/**
 * Images → PDF, written by hand rather than pulling in a PDF library.
 *
 * A PDF is a small, well-specified container: each page is an XObject holding
 * the raw JPEG bytes (DCTDecode is a native PDF filter, so JPEGs embed with no
 * re-encoding), plus a cross-reference table. That is a few dozen lines here
 * versus a multi-megabyte dependency.
 */
function buildPdf(pages) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length; // 1-indexed object numbers
  };

  const kidsPlaceholder = add(null); // Pages node, filled in once kids are known
  const pageIds = [];

  for (const page of pages) {
    const imageId = add(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.data.length} >>\nstream\n`
        ),
        page.data,
        Buffer.from("\nendstream"),
      ])
    );

    const content = `q\n${page.width} 0 0 ${page.height} 0 0 cm\n/Im0 Do\nQ`;
    const contentId = add(Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));

    pageIds.push(
      add(
        Buffer.from(
          `<< /Type /Page /Parent ${kidsPlaceholder} 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
            `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
        )
      )
    );
  }

  objects[kidsPlaceholder - 1] = Buffer.from(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`
  );
  const catalogId = add(Buffer.from(`<< /Type /Catalog /Pages ${kidsPlaceholder} 0 R >>`));

  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [];
  let position = chunks[0].length;

  objects.forEach((body, index) => {
    offsets.push(position);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      body,
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(chunk);
    position += chunk.length;
  });

  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");

  chunks.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${position}\n%%EOF`
    )
  );

  return Buffer.concat(chunks);
}

const command = {
  name: "pdf",
  aliases: ["topdf"],
  category: "Converters",
  desc: "Turn images into a PDF",
  usage: "Reply to an image with .pdf, or send several then .pdf",
  permission: "public",
  execute: async (ctx) => {
    const sources = [];
    if (ctx.m.isMedia && ctx.m.type === "imageMessage") sources.push(ctx.m.raw);
    if (ctx.quoted?.type === "imageMessage") sources.push(ctx.quoted.raw);

    // Same album trick as .sticker — images sent just before the command count.
    if (!ctx.quoted) {
      const recent = (store.recentImages.get(ctx.chat) || [])
        .filter((entry) => Date.now() - entry.time < 20_000 && entry.m.type === "imageMessage")
        .map((entry) => entry.m.raw)
        .filter((raw) => raw.key.id !== ctx.m.key.id);
      sources.push(...recent);
    }

    if (!sources.length) {
      return ctx.reply(
        `❌ Reply to an image with *${ctx.prefix}pdf*.\n\n` +
          `_For several pages, send the images first, then_ ${ctx.prefix}pdf`
      );
    }
    if (sources.length > 30) return ctx.reply("❌ 30 pages is the limit.");

    if (sources.length > 1) await ctx.reply(`⏳ Building a ${sources.length}-page PDF…`);

    const pages = [];
    for (const raw of sources) {
      const buffer = await downloadMediaMessage(raw, "buffer", {});
      // Normalise to baseline JPEG so DCTDecode can embed it directly.
      const jpeg = await sharp(buffer)
        .rotate()
        .resize(1240, 1754, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: false })
        .toBuffer();
      const meta = await sharp(jpeg).metadata();
      pages.push({ data: jpeg, width: meta.width, height: meta.height });
    }

    store.recentImages.delete(ctx.chat);
    const pdf = buildPdf(pages);

    return ctx.reply({
      document: pdf,
      mimetype: "application/pdf",
      fileName: `${ctx.text.trim() || "document"}.pdf`,
      caption: `📄 ${pages.length} page(s) — ${(pdf.length / 1024).toFixed(0)} KB`,
    });
  },
};

module.exports = command;
// Exported so the PDF structure can be tested without a WhatsApp message.
module.exports.buildPdf = buildPdf;
