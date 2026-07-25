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

It's a long string — around 2,500 characters. Copy the whole thing; a partial
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
<summary><b>Pterodactyl panel</b></summary>

1. Create a **Node.js** server
2. Upload this folder (with your edited `config.js`)
3. Set the startup command to `node index.js`
4. From the console, run `npm install`
5. Press **Start**

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
again; it's ~2,500 characters.

**"LOGGED OUT"** — the session was unlinked. On your phone, remove the device
under Linked Devices, then generate a fresh session ID.

**Media commands fail** — `ffmpeg` isn't installed. Use the Docker image, or
install it (see the VPS section).

**Downloads fail** — `yt-dlp` isn't installed, or the site changed. Update it
with `yt-dlp -U`. These commands depend on third-party sites and break from time
to time; that is inherent to what they do, not a bug in the bot.

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
