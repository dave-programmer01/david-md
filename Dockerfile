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

# Deno — yt-dlp needs a JavaScript runtime to decipher YouTube signatures.
# Without one it warns "extraction without a JS runtime has been deprecated"
# and silently falls back to a narrow set of player clients, which are exactly
# the ones YouTube challenges with "Sign in to confirm you're not a bot" on
# datacenter IPs like Railway's.
RUN ARCH="$(dpkg --print-architecture)" \
    && case "$ARCH" in \
         amd64) DENO_ARCH=x86_64-unknown-linux-gnu ;; \
         arm64) DENO_ARCH=aarch64-unknown-linux-gnu ;; \
         *) echo "unsupported arch $ARCH" && exit 1 ;; \
       esac \
    && curl -fsSL "https://github.com/denoland/deno/releases/latest/download/deno-${DENO_ARCH}.zip" -o /tmp/deno.zip \
    && apt-get update && apt-get install -y --no-install-recommends unzip \
    && unzip -q /tmp/deno.zip -d /usr/local/bin \
    && chmod a+rx /usr/local/bin/deno \
    && rm -f /tmp/deno.zip \
    && apt-get purge -y unzip && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && deno --version

# PO Token provider.
#
# YouTube refuses datacentre IPs outright — every player client answers "Sign
# in to confirm you're not a bot", so retrying across clients cannot help. A
# Proof-of-Origin token is what actually satisfies that check. yt-dlp has the
# framework built in but ships no provider; this is the standard one, run
# through the deno runtime that's already here.
ENV DENO_DIR=/opt/deno-cache
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip \
    && pip install --break-system-packages --no-cache-dir bgutil-ytdlp-pot-provider \
    && mkdir -p /opt/bgutil \
    && curl -fsSL https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/refs/tags/1.3.1.tar.gz -o /tmp/bgutil.tgz \
    && tar xzf /tmp/bgutil.tgz -C /opt/bgutil --strip-components=1 \
    && rm -f /tmp/bgutil.tgz \
    && cd /opt/bgutil/server \
    && deno install --allow-scripts \
    && deno cache src/generate_once.ts \
    && chmod -R a+rX /opt/bgutil /opt/deno-cache \
    && apt-get purge -y python3-pip && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

ENV BGUTIL_POT_SCRIPT=/opt/bgutil/server/src/generate_once.ts

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