# Bookworm rather than Alpine: sharp's libvips prebuilds and the bundled
# ffmpeg binary are both glibc-only and fail on musl.
FROM node:20-bookworm-slim

# ffmpeg  — every .sticker / .mp3 / video command
# webp    — animated sticker encoding
# python3 — required by yt-dlp
# git     — used by .update
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      webp \
      git \
      python3 \
      ca-certificates \
      curl \
      tini \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
         -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first so `npm ci` is cached until dependencies actually change.
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# Runtime state. Mount a volume here so settings and the session survive a
# container rebuild.
# Runtime state.
RUN mkdir -p data/media data/tmp session plugins

ENV NODE_ENV=production

# tini reaps the ffmpeg and yt-dlp child processes; without it they pile up as
# zombies over a long-running deployment.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]