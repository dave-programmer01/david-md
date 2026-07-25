const sharp = require("sharp");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const { writeStickerMetadata } = require("./exif");

// Prefer the system ffmpeg (present in the Docker image and on most panels);
// fall back to the bundled binary for a bare `npm start` on a laptop.
try {
  const installer = require("@ffmpeg-installer/ffmpeg");
  if (!process.env.FFMPEG_PATH) ffmpeg.setFfmpegPath(installer.path);
} catch {
  // System ffmpeg on PATH will be used instead.
}
if (process.env.FFMPEG_PATH) ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);

const tmp = (ext) => path.join(os.tmpdir(), `david-${crypto.randomBytes(6).toString("hex")}.${ext}`);
const unlink = (...files) => Promise.all(files.map((f) => fs.promises.unlink(f).catch(() => {})));

/**
 * Run an ffmpeg graph over one or more input buffers.
 * Everything media-related funnels through here so temp files are always
 * cleaned up, including when ffmpeg fails.
 */
function run({ inputs, inExt = "mp4", outExt = "mp4", inputOptions = [], outputOptions = [], format }) {
  const inFiles = [];
  const outFile = tmp(outExt);

  return (async () => {
    try {
      for (const buf of inputs) {
        const file = tmp(inExt);
        await fs.promises.writeFile(file, buf);
        inFiles.push(file);
      }

      await new Promise((resolve, reject) => {
        let chain = ffmpeg();
        for (const file of inFiles) chain = chain.input(file);
        if (inputOptions.length) chain = chain.inputOptions(inputOptions);
        if (outputOptions.length) chain = chain.outputOptions(outputOptions);
        if (format) chain = chain.toFormat(format);
        chain
          .on("end", resolve)
          .on("error", (err) => reject(new Error(String(err.message).split("\n").pop() || err.message)))
          .save(outFile);
      });

      return await fs.promises.readFile(outFile);
    } finally {
      await unlink(...inFiles, outFile);
    }
  })();
}

// ── Stickers ─────────────────────────────────────────────────────────────

async function convertToSticker(imageBuffer) {
  return sharp(imageBuffer)
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 80 })
    .toBuffer();
}

/**
 * Video → animated WebP.
 *
 * Two routes, because ffmpeg builds differ: the direct libwebp encoder gives
 * the best quality and smallest files, but plenty of builds ship without it —
 * including the bundled @ffmpeg-installer binary on macOS/arm64. The fallback
 * renders a GIF (palettegen is in every build) and lets sharp do the WebP
 * encoding, which needs nothing from ffmpeg at all.
 */
async function convertVideoToSticker(videoBuffer) {
  try {
    return await run({
      inputs: [videoBuffer],
      outExt: "webp",
      inputOptions: ["-t 10"],
      outputOptions: [
        "-vcodec libwebp",
        "-vf scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=#00000000",
        "-loop 0", "-preset default", "-an", "-vsync 0",
      ],
      format: "webp",
    });
  } catch (err) {
    if (!/libwebp|Unknown encoder|Encoder.*not found/i.test(err.message)) throw err;

    const gif = await run({
      inputs: [videoBuffer],
      outExt: "gif",
      inputOptions: ["-t 10"],
      outputOptions: [
        "-vf scale=512:512:force_original_aspect_ratio=decrease,fps=15," +
          "pad=512:512:-1:-1:color=white@0.0,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
        "-loop 0",
      ],
      format: "gif",
    });

    return sharp(gif, { animated: true }).webp({ quality: 75 }).toBuffer();
  }
}

/** One entry point for both still and animated stickers, with pack metadata. */
async function convertMediaToSticker(buffer, animated = false, meta = {}) {
  const webp = animated ? await convertVideoToSticker(buffer) : await convertToSticker(buffer);
  return writeStickerMetadata(webp, meta);
}

/** Sticker → PNG, for `.photo`. */
async function stickerToImage(buffer) {
  return sharp(buffer, { animated: false }).png().toBuffer();
}

/** Animated sticker / GIF → MP4, for `.mp4`. */
async function toMp4(buffer, inExt = "webp") {
  return run({
    inputs: [buffer],
    inExt,
    outExt: "mp4",
    outputOptions: [
      "-movflags faststart", "-pix_fmt yuv420p",
      "-vf scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v libx264", "-crf 26",
    ],
  });
}

async function toGif(buffer, inExt = "mp4") {
  return run({
    inputs: [buffer],
    inExt,
    outExt: "gif",
    outputOptions: [
      "-vf fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
      "-loop 0",
    ],
    format: "gif",
  });
}

// ── Audio ────────────────────────────────────────────────────────────────

async function toMp3(buffer, inExt = "mp4") {
  return run({
    inputs: [buffer],
    inExt,
    outExt: "mp3",
    outputOptions: ["-vn", "-ab 128k", "-ar 44100"],
    format: "mp3",
  });
}

const AUDIO_EFFECTS = {
  slow: "atempo=0.75",
  sped: "atempo=1.35",
  bass: "bass=g=18,dynaudnorm=f=200",
  nightcore: "asetrate=44100*1.25,aresample=44100",
  deep: "asetrate=44100*0.8,aresample=44100",
  reverse: "areverse",
  robot: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75",
  blown: "acrusher=level_in=8:level_out=18:bits=8:mode=log:aexp=1",
};

async function audioEffect(buffer, effect, inExt = "mp3") {
  const filter = AUDIO_EFFECTS[effect];
  if (!filter) throw new Error(`Unknown audio effect "${effect}"`);
  return run({
    inputs: [buffer],
    inExt,
    outExt: "mp3",
    outputOptions: [`-af ${filter}`, "-vn", "-ab 128k", "-ar 44100"],
    format: "mp3",
  });
}

// ── Image / video transforms ─────────────────────────────────────────────

async function rotate(buffer, degrees = 90) {
  return sharp(buffer).rotate(Number(degrees) || 90).toBuffer();
}

async function flip(buffer, direction = "h") {
  const img = sharp(buffer);
  return (direction === "v" ? img.flip() : img.flop()).toBuffer();
}

async function circle(buffer) {
  const size = 512;
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`
  );
  return sharp(buffer)
    .resize(size, size, { fit: "cover" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function square(buffer, isVideo = false) {
  if (!isVideo) {
    const { width, height } = await sharp(buffer).metadata();
    const side = Math.max(width || 512, height || 512);
    return sharp(buffer)
      .resize(side, side, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  }
  return run({
    inputs: [buffer],
    outputOptions: [
      "-vf scale=w=720:h=720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2:black",
      "-c:a copy",
    ],
  });
}

async function resize(buffer, width, height, isVideo = false) {
  const w = Number(width) || 512;
  const h = Number(height) || w;
  if (!isVideo) return sharp(buffer).resize(w, h, { fit: "fill" }).toBuffer();
  return run({ inputs: [buffer], outputOptions: [`-vf scale=${w}:${h}`, "-c:a copy"] });
}

async function compress(buffer, isVideo = false, quality = 40) {
  if (!isVideo) return sharp(buffer).jpeg({ quality: Number(quality) || 40 }).toBuffer();
  return run({
    inputs: [buffer],
    outputOptions: ["-vcodec libx264", "-crf 32", "-preset veryfast", "-acodec aac", "-b:a 96k"],
  });
}

async function trim(buffer, start = "00:00:00", end = null, inExt = "mp4") {
  const inputOptions = [`-ss ${start}`];
  if (end) inputOptions.push(`-to ${end}`);
  return run({ inputs: [buffer], inExt, outExt: inExt, inputOptions, outputOptions: ["-c copy"] });
}

async function grayscale(buffer, isVideo = false) {
  if (!isVideo) return sharp(buffer).grayscale().toBuffer();
  return run({ inputs: [buffer], outputOptions: ["-vf hue=s=0", "-c:a copy"] });
}

async function slowmo(buffer, factor = 2) {
  const f = Math.max(1.1, Number(factor) || 2);
  return run({
    inputs: [buffer],
    outputOptions: [`-filter:v setpts=${f}*PTS`, `-filter:a atempo=${(1 / f).toFixed(3)}`],
  });
}

/** Frame interpolation — makes slow motion smooth rather than stuttery. */
async function interpolate(buffer, fps = 60) {
  return run({
    inputs: [buffer],
    outputOptions: [
      `-vf minterpolate=fps=${Number(fps) || 60}:mi_mode=mci:mc_mode=aobmc:vsbmc=1`,
      "-c:a copy",
    ],
  });
}

/** Replace a video's audio with another file's (`.take` / `.avmix`). */
async function replaceAudio(videoBuffer, audioBuffer) {
  const videoFile = tmp("mp4");
  const audioFile = tmp("mp3");
  const outFile = tmp("mp4");
  try {
    await fs.promises.writeFile(videoFile, videoBuffer);
    await fs.promises.writeFile(audioFile, audioBuffer);
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoFile)
        .input(audioFile)
        .outputOptions(["-map 0:v:0", "-map 1:a:0", "-c:v copy", "-shortest"])
        .on("end", resolve)
        .on("error", (e) => reject(new Error(String(e.message).split("\n").pop())))
        .save(outFile);
    });
    return await fs.promises.readFile(outFile);
  } finally {
    await unlink(videoFile, audioFile, outFile);
  }
}

/** Join two videos, re-encoding so mismatched sizes/codecs still concatenate. */
async function concatVideos(a, b) {
  const fileA = tmp("mp4");
  const fileB = tmp("mp4");
  const outFile = tmp("mp4");
  try {
    await fs.promises.writeFile(fileA, a);
    await fs.promises.writeFile(fileB, b);
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(fileA)
        .input(fileB)
        .complexFilter([
          "[0:v]scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:-1:-1,setsar=1[v0]",
          "[1:v]scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:-1:-1,setsar=1[v1]",
          "[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]",
        ])
        .outputOptions(["-map [v]", "-map [a]", "-preset veryfast"])
        .on("end", resolve)
        .on("error", (e) => reject(new Error(String(e.message).split("\n").pop())))
        .save(outFile);
    });
    return await fs.promises.readFile(outFile);
  } finally {
    await unlink(fileA, fileB, outFile);
  }
}

/** Render text as a sticker (`.attp`). */
async function textToSticker(text, { color = "#ffffff" } = {}) {
  const escaped = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const size = Math.max(28, Math.min(110, Math.floor(760 / Math.max(4, escaped.length))));
  const svg = `
    <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
      <style>
        .t { fill:${color}; font-size:${size}px; font-family:'DejaVu Sans',sans-serif;
             font-weight:bold; paint-order:stroke; stroke:#000; stroke-width:${Math.round(size / 12)}px; }
      </style>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" class="t">${escaped}</text>
    </svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer();
}

module.exports = {
  run, tmp, unlink,
  convertToSticker, convertVideoToSticker, convertMediaToSticker,
  stickerToImage, toMp4, toGif,
  toMp3, audioEffect, AUDIO_EFFECTS,
  rotate, flip, circle, square, resize, compress, trim, grayscale,
  slowmo, interpolate, replaceAudio, concatVideos, textToSticker,
};
