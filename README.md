# David-MD

A multi-purpose WhatsApp bot with **162 commands** — stickers, group moderation,
downloads, media editing and more. Deploy your own copy in a couple of minutes.

---

## Setting it up

### 1. Get your session ID

**→ [david-pair-x6t8.onrender.com](https://david-pair-x6t8.onrender.com)**

Enter your WhatsApp number and you'll get an 8-character code. Link it on your
phone:

> **WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number instead**

Your session ID is then sent to you **on WhatsApp**, as a message to yourself.

### 2. Put it in `config.js`

Download this repo, open **`config.js`**, and paste the ID between the quotes:

```js
const SESSION_ID = "David~eyJub2lzZUtleSI6...";
```

It's a long string — a few thousand characters. Copy the whole thing; a partial
paste is the single most common setup problem, and the bot will tell you if that
happened.

That's the only edit you need. Everything else in `config.js` is optional.

> ### ⚠️ Your session ID is a full WhatsApp login
>
> Anyone who reads it can control your account. Never post `config.js`, or a
> screenshot of it, anywhere. Never push it to a **public** GitHub repo.

### 3. Deploy

<details open>
<summary><b>VPS or any Linux box</b></summary>

```bash
npm install
npm start
```

To keep it running after you close the terminal:

```bash
npm install -g pm2
pm2 start index.js --name david-md
pm2 save && pm2 startup
```

You'll need `ffmpeg` for media commands and `yt-dlp` for downloads:

```bash
sudo apt install -y ffmpeg python3
sudo curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp
```

</details>

<details>
<summary><b>Docker</b> — everything bundled, nothing to install</summary>

```bash
docker compose up -d
```

No environment variables needed — your session ID is already in `config.js`.

```bash
docker compose logs -f      # watch it start
docker compose restart      # restart
docker compose down         # stop
```

</details>

<details>
<summary><b>Railway</b></summary>

1. **New Project → Deploy from GitHub repo →** pick **`david-md`**
   Point it at *this repo*, not a folder containing it. Railway needs the
   `Dockerfile` at the root of what it builds; if it reports
   *"could not determine how to build the app"* it's looking one level too high
   — open **Settings → Root Directory** and set it to `david-md`.
2. **Variables →** add `SESSION_ID` with the ID from the pairing site.
   (You can paste it into `config.js` instead, but only if your copy of the
   repo is **private** — the variable is safer.)
3. **Variables →** optionally add `OWNER_NUMBER`, `OWNER_NAME`, `BOT_NAME`,
   `PREFIX`, `MODE`.
4. **Add a volume** — this one matters. **Settings → Volumes → Add**, mount
   path `/app/session`. Without it, every redeploy throws away the signal keys
   the bot has accumulated and group messages start failing to decrypt. Add a
   second volume at `/app/data` to keep your settings across deploys.

`railway.json` already selects the Dockerfile builder and sets the restart
policy, so `.restart` and `.update` bring the bot back up.

</details>

<details>
<summary><b>Pterodactyl panel</b></summary>

1. Create a **Node.js** server (Node 20+)
2. Upload the ZIP, unarchive it, move the files to `/home/container`
3. Edit `config.js` in the panel's file editor and paste your session ID
4. Console: `npm install` — this brings ffmpeg with it
5. Startup command: `node index.js`, then press **Start**

For downloads, drop `yt-dlp` and `deno` next to the bot — no root needed, and
they're picked up automatically.

**→ [Full step-by-step guide with screenshots of every value](docs/PANEL.md)**

</details>

<details>
<summary><b>Heroku</b></summary>

Heroku deploys from GitHub, and your `config.js` contains a live login — so
**do not fork this repo**. Forks of a public repo can never be made private.

1. Download this repo as a ZIP and unzip it
2. Edit `config.js` with your session ID
3. Create a **new private repository** on GitHub and push the folder to it
4. In Heroku: **New → Create new app → Deploy → GitHub →** pick your private repo
5. **Resources →** turn the `worker` dyno on (not `web`)

**Add the Postgres add-on.** Heroku deletes all files roughly every 24 hours, so
without a database every setting you change in chat resets daily. The add-on
fills in `DATABASE_URL` automatically and the bot picks it up.

</details>

---

## Using it

Send `.menu` for the full command list. Some things to try first:

| Command | What it does |
|---|---|
| `.ping` | Check it's alive, with latency |
| `.sticker` | Send a photo captioned `.sticker` |
| `.alive` | Status card |
| `.menu group` | Just the group commands |

### Make it yours

```
.setprefix !          change . to something else
.setname MyBot        rename it in the menu
.setowner Your Name   the name shown as owner
.setalive <text>      custom status message (reply to an image to add a picture)
.setstickername Pack  the pack name on your stickers
.mode public          let anyone use it (default is owner-only)
```

Settings apply instantly — no restart.

### In groups

Make the bot an **admin** and it can moderate:

```
.antilink on          delete group invite links
.welcome on           greet new members
.warn @user spamming  three warnings and they're removed
.kick @user           remove someone
.fumigate             remove everyone except admins
.mute 30              lock the group for 30 minutes
```

---

## Troubleshooting

**"NO SESSION ID FOUND"** — `config.js` still has the placeholder. Paste your ID
between the quotes.

**"SESSION ID LOOKS TOO SHORT"** — the paste got cut off. Copy the whole message
again; it's a few thousand characters.

**"LOGGED OUT"** — the session was unlinked. On your phone, remove the device
under Linked Devices, then generate a fresh session ID.

**`npm error code EALLOWGIT`** — a host that blocks git fetching (most panels
do). Nothing is fetched from git any more; if you hit this, you're on an older
copy — re-download the repo.

**Media commands fail** — `ffmpeg` isn't installed. Use the Docker image, or
install it (see the VPS section).

**Downloads fail** — `yt-dlp` isn't installed, or the site changed. Update it
with `yt-dlp -U`. These commands depend on third-party sites and break from time
to time; that is inherent to what they do, not a bug in the bot.

**"Sign in to confirm you're not a bot"** — YouTube challenges datacentre IPs,
which is what every cloud host has. The bot retries across several player
clients automatically, and the Docker image ships Deno so yt-dlp can decipher
signatures properly (without a JS runtime it falls back to exactly the clients
YouTube blocks hardest). If it still happens:

- Wait a few minutes — the block is usually temporary
- Not using Docker? Install Deno so yt-dlp has a JS runtime
- As a last resort, export YouTube cookies to a file and point `YT_COOKIES` at
  it. Note that using a logged-in account's cookies from a datacentre IP can get
  that account flagged, so prefer a throwaway.

**Settings keep resetting** — you're on Heroku without the Postgres add-on.

**`.ai` says it needs a key** — put an Anthropic key in `config.js`. Every other
command works without one.

---

## Development

```bash
npm run check     # loads all 162 commands, validates the registry, renders the menu
```

Commands live in `src/commands/<category>/`. A file exports one command or an
array of them:

```js
module.exports = {
  name: "hello",
  aliases: ["hi"],
  category: "Utility",         // one of the 12 menu categories
  desc: "Say hello",
  usage: ".hello",
  permission: "public",        // public | group | admin | botAdmin | sudo | owner
  execute: async (ctx) => ctx.reply("Hi!"),
};
```

Add the name to `MENU_ORDER` in `src/lib/registry.js` to place it in the menu.
