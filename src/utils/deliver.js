/**
 * Send what a social downloader returned ({ files, meta }) — every item in
 * order, with the caption on the first. Shared by the download commands and
 * `.ig`, which downloads when it's given a post link.
 */
async function sendMedia(ctx, { files, meta }, label) {
  const caption = `*${meta.title || label}*` + (meta.uploader ? `\n_by ${meta.uploader}_` : "");

  for (const [index, file] of files.entries()) {
    const text = index === 0 ? caption : "";
    await ctx.send(ctx.chat, file.isVideo ? { video: file.buffer, caption: text } : { image: file.buffer, caption: text });
  }

  if (files.length > 1) await ctx.reply(`✅ Sent ${files.length} item(s).`);
}

module.exports = { sendMedia };
