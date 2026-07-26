# Deploying David-MD on a Pterodactyl panel

A complete walkthrough, from downloading the files to running your first
command. No prior panel experience assumed.

**Time:** about 10 minutes.

---

## Before you start

You need two things:

1. **A panel server running the Node.js egg** (any host that gives you
   Pterodactyl — most "bot hosting" providers do). Node **20 or newer**.
2. **Your session ID** from the pairing site. If you don't have one yet, get it
   first — the bot won't start without it.

> **A note on panels.** You get no root access, so you can't `apt install`
> anything. That's fine: `ffmpeg` arrives with `npm install`, and the two other
> optional tools are single files you can drop in. This guide covers all of it.

---

## Step 1 — Get your session ID

Open the pairing site and enter your WhatsApp number **with country code, no
`+`, no spaces, no leading zero**:

```
2348012345678        ✅
+234 801 234 5678    ❌
08012345678          ❌
```

You'll get an 8-character code. On your phone:

> **WhatsApp → Settings → Linked Devices → Link a Device →
> Link with phone number instead** → enter the code

Within a few seconds you'll receive **two messages from yourself**:

1. A long string starting with `David~` — **that's your session ID**
2. A deploy guide

Long-press the first message → **Copy**. Keep that chat open; you'll paste it in
Step 4.

> ⚠️ **That ID is a full login to your WhatsApp account.** Anyone who has it can
> read and send your messages. Never post it, screenshot it, or put it in a
> public GitHub repo.

---

## Step 2 — Download the bot

Go to **https://github.com/dave-programmer01/david-md**

Click the green **Code** button → **Download ZIP**.

You now have `david-md-main.zip`. **Don't unzip it** — the panel can do that,
and uploading one file is far faster than uploading a few hundred.

---

## Step 3 — Upload it to the panel

1. Open your server in the panel
2. Go to the **Files** tab
3. Make sure you're in the root folder (the path bar shows `/home/container`)
4. Click **Upload** and choose `david-md-main.zip`
5. Wait for it to finish, then click the **⋮** menu next to it → **Unarchive**

You'll now have a folder called `david-md-main`. **Open it** and check you can
see `index.js`, `config.js` and `package.json`.

### Move the files up one level

The panel runs from `/home/container`, but your files are one folder deeper. You
have two options:

**Option A — move them (recommended).** Select all files inside
`david-md-main`, click **Move**, and set the destination to `/home/container`.
Then delete the now-empty `david-md-main` folder and the ZIP.

**Option B — leave them and adjust the startup command.** Skip the moving, and
in Step 6 use `cd david-md-main && node index.js` instead.

Option A keeps everything simpler later, so the rest of this guide assumes it.

---

## Step 4 — Put your session ID in `config.js`

In the **Files** tab, click **`config.js`** to open the panel's editor.

Find this line near the top (around line 33):

```js
const SESSION_ID = "PASTE_YOUR_SESSION_ID_HERE";
```

Select the text **between the quotes** and paste your session ID over it:

```js
const SESSION_ID = "David~eyJub2lzZUtleSI6eyJwcml2YXRlIjp7InR5cGUiOiJCdWZmZXI...";
```

**Keep the quotes and the semicolon.** Only the placeholder text changes.

While you're here, you can also set:

```js
const OWNER_NUMBER = "2348012345678";   // your number, digits only
const OWNER_NAME   = "Your Name";
const BOT_NAME     = "My Bot";
const PREFIX       = ".";                // the character before every command
const MODE         = "private";          // "public" lets anyone use it
```

`OWNER_NUMBER` can be left blank — the bot will use whichever account you
paired.

Click **Save Content**.

> **The single most common mistake** is pasting only part of the ID. It's a few
> thousand characters. If you got it wrong the bot will say
> *"SESSION ID LOOKS TOO SHORT"* on startup and tell you how many characters it
> received — so you'll know.

---

## Step 5 — Install dependencies

Go to the **Console** tab and run:

```bash
npm install
```

This takes 1–3 minutes. Some warnings scrolling past are normal — an `npm ERR!`
is not.

> **If you see `npm error code EALLOWGIT`**, you're on an older copy of the bot.
> Baileys used to pull one dependency straight from GitHub, and most panels
> block git fetching for security. Download the repo again — current versions
> install everything from the npm registry, with no git access needed.

This also installs **ffmpeg**, which every sticker, audio and video command
needs. It arrives as a normal npm package, so no root is required.

### Optional: downloads and YouTube

Skip this if you don't care about `.play`, `.song`, `.tiktok`, `.insta` and
friends. Everything else works without it.

Those commands need **yt-dlp**, which isn't an npm package. It's a single file
you can drop next to the bot — from the Console:

```bash
curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o yt-dlp
chmod +x yt-dlp
```

For YouTube specifically, also add **Deno**. Without a JavaScript runtime,
yt-dlp can't decipher YouTube's signatures and falls back to the exact clients
YouTube blocks — you'd get *"Sign in to confirm you're not a bot"*:

```bash
curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -o deno.zip
unzip deno.zip && chmod +x deno && rm deno.zip
```

The bot looks for both files beside itself automatically. No configuration, no
startup-command changes.

Check they landed:

```bash
./yt-dlp --version
./deno --version
```

---

## Step 6 — Set the startup command

Go to the **Startup** tab.

Set the startup command to:

```
node index.js
```

Some Node eggs use a **Main File** or **JS File** variable instead — in that
case set it to `index.js` and leave the command alone.

If you chose Option B in Step 3:

```
cd david-md-main && node index.js
```

---

## Step 7 — Start it

Press **Start**.

You should see, within about ten seconds:

```
✅ Session restored for Your Name.

╔════════════════════════════════════════════════════════╗
║                                                        ║
║  𝖣𝖺𝗏𝗂𝖽-𝗆𝖽   v1.0.0                                     ║
║  162 commands loaded                                   ║
║                                                        ║
╚════════════════════════════════════════════════════════╝

✅ Connected as Your Name
👑 Owner set to 2348012345678
👂 Listening…
```

You'll also get a **"Welcome to David-MD!"** message on WhatsApp.

---

## Step 8 — Try it

Message yourself on WhatsApp (the *Message Yourself* chat) and send:

```
.menu
```

You should get the full command list back. Then try:

| Command | What it does |
|---|---|
| `.ping` | Round-trip latency |
| `.alive` | Status card |
| `.sticker` | Send a photo with this as the caption |
| `.menu group` | Just the group commands |

**Done.** Everything below is reference.

---

## If something goes wrong

Read the Console — the bot explains itself rather than dumping stack traces.

| What you see | What it means |
|---|---|
| **NO SESSION ID FOUND** | `config.js` still has the placeholder. Redo Step 4. |
| **SESSION ID LOOKS TOO SHORT** | Partial paste. It tells you how many characters arrived; copy the whole message again. |
| **SESSION ID IS DAMAGED** | Truncated or a character was lost. Copy it again. |
| **LOGGED OUT** | The device was unlinked. Remove it under Linked Devices and pair fresh. |
| `Cannot find module` | `npm install` didn't finish. Run it again. |
| Starts, then stops immediately | Almost always the session ID. Read the last few lines before it exited. |

### The bot connects but ignores you

Check the Console when you send a command:

- **`🔒 Ignored .menu from … private mode`** — you're messaging from a different
  number than `OWNER_NUMBER`. Either fix that value, or send `.mode public`.
- **Nothing appears at all** — messages aren't reaching it. Usually a second
  copy running somewhere on the same session; check **Linked Devices** on your
  phone and remove anything unexpected.

### Media commands fail

`npm install` didn't complete — ffmpeg comes from it. Run it again and watch for
errors.

### Downloads fail

`yt-dlp` isn't there. Redo the optional part of Step 5, and check `./yt-dlp
--version` works.

**"Sign in to confirm you're not a bot"** means YouTube is blocking the server's
IP. Add Deno (Step 5) if you haven't. It's usually temporary otherwise.

---

## Restarts and updates

**Restarting** — use the panel's Restart button, or send `.restart`.

**Your settings survive restarts.** Prefix, warnings, filters and alive message
live in `data/`, on the panel's disk.

**Updating** — download the new ZIP and re-upload, but **keep your `config.js`**.
The simplest safe order:

1. Copy your session ID out of `config.js` (or download the file)
2. Upload and unarchive the new version, overwriting
3. Paste your session ID back into the new `config.js`
4. `npm install` again, then Start

Don't delete the `session/` folder — that's the live connection. If you do, the
bot re-creates it from your session ID on the next start.

---

## Customising it

All of these work from any chat, and take effect immediately:

```
.setprefix !            use ! instead of .
.setname MyBot          rename it in the menu
.setowner Your Name     the owner name shown
.setalive Hello!        custom status message (reply to an image to add one)
.setstickername Pack    the pack name on your stickers
.mode public            let anyone use it
.mode private           back to owner-only
```

In groups where the bot is an **admin**:

```
.antilink on            delete invite links
.welcome on             greet new members
.warn @user reason      three warnings and they're removed
.kick @user             remove someone
.mute 30                lock the group for 30 minutes
.fumigate               remove everyone except admins
```

Full list: `.menu`
