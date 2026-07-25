const { UA } = require("./search");

/**
 * Google Translate's TTS endpoint. No API key, but it caps each request at
 * ~200 characters, so longer text is split on word boundaries and the MP3
 * fragments are concatenated (valid for MP3 frames).
 */
async function tts(text, lang = "en") {
  const clean = String(text).trim();
  if (!clean) throw new Error("Nothing to say.");
  if (clean.length > 1500) throw new Error("That's too long — keep it under 1500 characters.");

  const chunks = [];
  let current = "";
  for (const word of clean.split(/\s+/)) {
    if ((current + " " + word).trim().length > 190) {
      chunks.push(current.trim());
      current = word;
    } else {
      current += ` ${word}`;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  const buffers = [];
  for (const [i, chunk] of chunks.entries()) {
    const url =
      `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob` +
      `&q=${encodeURIComponent(chunk)}&tl=${encodeURIComponent(lang)}` +
      `&total=${chunks.length}&idx=${i}&textlen=${chunk.length}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://translate.google.com/" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Text-to-speech failed (${res.status}).`);
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  return Buffer.concat(buffers);
}

/** Upload a buffer to catbox.moe and return the public URL — used by `.upload` / `.url`. */
async function upload(buffer, filename = "file.bin") {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("fileToUpload", new Blob([buffer]), filename);

  const res = await fetch("https://catbox.moe/user/api.php", {
    method: "POST",
    body: form,
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(120_000),
  });

  const text = (await res.text()).trim();
  if (!res.ok || !text.startsWith("http")) throw new Error(`Upload failed: ${text.slice(0, 120)}`);
  return text;
}

/**
 * Spotify streams are DRM-protected and cannot be downloaded. What works — and
 * what every bot in this space actually does — is read the track's title and
 * artist from Spotify's public oEmbed endpoint, then fetch the matching audio
 * from YouTube.
 */
async function spotifyTrack(url) {
  const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error("Couldn't read that Spotify link.");
  const data = await res.json();
  return {
    title: data.title || "",
    thumbnail: data.thumbnail_url || null,
    // oEmbed gives "Artist - Track" or just the track name depending on type.
    query: String(data.title || "").replace(/\s*[-–]\s*song( and lyrics)? by\s*/i, " ").trim(),
  };
}

module.exports = { tts, upload, spotifyTrack };
