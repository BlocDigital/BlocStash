# BlocStash Household Edition

BlocStash is a local-first household photo and video library. One computer — a Windows PC, or a Chromebook/Linux machine — runs the server and stores the original media. Phones, Chromebooks and other computers connect over your home Wi-Fi. No cloud account or Firebase hosting is required for core use.

## Quick start (Windows)

You need a Windows PC to act as the server (using a Chromebook or Linux machine instead? See [Chromebook and ChromeOS](#chromebook-and-chromeos)), and phones or other computers on the **same home Wi-Fi**.

> The addresses in the screenshots (such as `192.168.1.42`) are examples. Yours will be different — always use the address your own server prints.

### 1. Start the server

1. Install [Node.js](https://nodejs.org/) 18 or newer. (Optional but recommended: install [Python 3](https://www.python.org/downloads/) so the invitation QR code can be drawn. During setup, tick **Add python.exe to PATH**. Without Python you can still share the invitation link.)
2. Extract this project([Release1.0](https://github.com/BlocDigital/BlocStash/releases/tag/v1.0)) to a permanent folder, for example `C:\Users\<you>\BlocStash`.
3. Double-click **`start-blocstash.bat`**. A terminal window opens and prints two addresses:

![Terminal showing the localhost address and the phone address](docs/screenshots/01-start-server.png)

- **(1) `On this computer`** – open this address in a browser on the PC.
- **(2) `On your phone`** – the PC's address on your home network. Phones and other computers use this one.

Keep the terminal window open while you use BlocStash. Closing it stops the server.

> **Windows Firewall:** the first time you start the server, Windows asks whether to allow Node.js. Tick **Private networks** and choose **Allow access**. If you missed the prompt, open *Windows Security → Firewall & network protection → Allow an app through firewall* and enable **Node.js JavaScript Runtime** for **Private**.
>
> **Can't see the phone address?** Open a Command Prompt and run `ipconfig`. Your PC's *IPv4 Address* (for example `192.168.1.42`) followed by `:8787` is the phone address.

On macOS or Linux, run `./start-blocstash.sh` instead.

### 2. Create the administrator account (first launch only)

On the PC, open the **`http://localhost:8787`** address (1 above). The first time, BlocStash asks you to create the household administrator account.

![First-run screen with username, password and Create household button](docs/screenshots/02-create-admin.png)

1. Enter a username and a unique password of **at least 12 characters**.
2. Click **Create household**.

You are now signed in as the administrator.

### 3. Connect a phone or another computer

There are two ways to get a device connected. Both need the device to be on the same Wi-Fi as the PC.

**Option A – sign in with an existing account**

Open the phone address from the terminal (`http://<PC-LAN-IP>:8787`) in the phone's browser and sign in.

<img src="docs/screenshots/05-phone-signin.png" alt="Phone browser on the PC's address showing the BlocStash sign-in screen" width="280">

**Option B – invite a new member (flatmate, partner, your own second phone)**

Only the administrator can invite people, and registration is invite-only.

1. **Open BlocStash on the PC using the phone address** (`http://192.168.x.x:8787`) if you can. The invitation QR code and link are built from the address you are browsing with. If you browse via `localhost`, the server substitutes the PC's network address automatically. To force a specific address (for example on a Chromebook), start the server with `STASH_PUBLIC_HOST=<address>:8787`.
2. Click **Settings** (top right), then **Invite member**.

![Settings dialog with arrows pointing to the Settings button and Invite member](docs/screenshots/03-settings-invite.png)

3. A QR code and a link appear. Scan the QR code with the phone camera, or send the link to the person.

![Invitation dialog with arrows pointing to the QR code and the invitation link](docs/screenshots/04-invite-qr.png)

4. The phone opens the join page. The new member chooses their own username and a password of at least 12 characters, then taps **Join household**.

<img src="docs/screenshots/06-phone-join.png" alt="Phone join page opened from the QR code" width="280">

Invitations expire after **five minutes** and work **once**. If it has expired, just create a new one.

Want to connect from outside your home? See [Access from anywhere](#access-from-anywhere-free-with-tailscale).

### Auto-start with Windows (optional)

So you don't have to double-click `start-blocstash.bat` after every reboot, you can have Windows start the server automatically.

**Option A – Startup folder (simplest, runs when you sign in)**

1. Open your BlocStash folder, right-click **`start-blocstash.bat`**, and choose **Create shortcut** (on Windows 11, click **Show more options** first).
2. Press **`Win + R`**, type `shell:startup`, and press **Enter** to open your Windows Startup folder.
3. Move the shortcut you just created into the Startup folder.
4. *(Optional)* Right-click the shortcut in the Startup folder → **Properties**, set **Run** to **Minimized**, and click **OK** so the terminal window starts out of the way in your taskbar.

Because this runs inside your desktop session, the **Storage** folder picker continues to work normally.

**Option B – Task Scheduler (runs in the background without a window, or before sign-in)**

1. Press **`Win + R`**, type `taskschd.msc`, and press **Enter** to open **Task Scheduler**.
2. Click **Create Task...** in the right-hand panel and give it a name such as `BlocStash`.
3. On the **General** tab, choose **Run whether user is logged on or not** (or leave **Run only when user is logged on** if you still want to use the **Storage** folder picker).
4. On the **Triggers** tab, click **New...** and set **Begin the task** to **At startup** (or **At log on**).
5. On the **Actions** tab, click **New...**, keep **Start a program**, and fill in:
   - **Program/script:** `node`
   - **Add arguments:** `server\stash-server.js`
   - **Start in:** the full path to your BlocStash folder (for example `C:\Users\<you>\BlocStash`)
6. On the **Conditions** tab, uncheck **Start the task only if the computer is on AC power** if the server is a laptop.
7. Click **OK** to save the task.

> If you set `STASH_DIR` in `start-blocstash.bat`, set the same environment variable in Windows (*System Properties → Environment Variables*) when using Task Scheduler so `node` picks it up.

### Troubleshooting

- **The phone can't open the address:** check that both devices are on the same Wi-Fi, that the firewall allows Node.js on *Private networks*, and that the terminal window is still open. Guest Wi-Fi or "client/AP isolation" on the router stops devices from seeing each other.
- **The QR code doesn't appear:** Python 3 isn't installed or isn't on the PATH. Use the copyable invitation link instead, or [install Python 3](https://www.python.org/downloads/) and restart the server.
- **"Invitation invalid or expired":** create a new invitation (step 3 of Option B).
- **The address changes after a reboot:** routers can hand out a new address. Check the terminal for the current one, or reserve a fixed address for the PC in your router settings.
- **Browser says "Not secure":** expected. The home-network server uses plain HTTP, so only use it on a trusted private Wi-Fi (see *Local network and security* below).

## Chromebook and ChromeOS

### Using a Chromebook as a client

Nothing to install. On the Chromebook, open Chrome and go to the server's phone address (`http://<server-IP>:8787`, printed in the server's terminal), then sign in or join with an invitation link. Both devices must be on the same Wi-Fi. The invitation link can be pasted into Chrome's address bar if you can't scan the QR code.

### Running the server on a Chromebook

The server runs inside the Chromebook's Linux environment. This needs a Chromebook that supports Linux, and (if it is managed by a school or employer) Linux must be allowed by its administrator.

1. **Turn on Linux:** *Settings → Advanced → Developers → Linux development environment → Turn on*.
2. **Install Node.js and Python.** Open the **Terminal** app and run:

   ```bash
   sudo apt update && sudo apt install -y nodejs python3 unzip
   node -v
   ```

   If `node -v` shows a version older than 18, install a newer Node.js from <https://nodejs.org/en/download>. Python 3 is only used to draw the invitation QR code.
3. **Put BlocStash in your Linux files.** In the Files app, copy the project zip into **Linux files**, then in the Terminal:

   ```bash
   cd ~ && unzip blocstash-updated.zip -d blocstash && cd blocstash
   ./start-blocstash.sh
   ```

   (If you get "permission denied", run `sh start-blocstash.sh` instead.)
4. **Forward the port so other devices can reach it.** Phones cannot reach the Linux container directly. Go to *Settings → Advanced → Developers → Linux → Port forwarding*, add **TCP port 8787**, and make sure it is switched on.
5. **Find the Chromebook's IP address:** *Settings → Network →* select your Wi-Fi network. Other devices open `http://<that IP address>:8787`.
6. Open `http://localhost:8787` in Chrome on the Chromebook and create the administrator account as described above. To make invitation QR codes use the Chromebook's address, stop the server and start it again with the address set:

   ```bash
   STASH_PUBLIC_HOST=192.168.1.50:8787 ./start-blocstash.sh
   ```

   (replace `192.168.1.50` with your Chromebook's IP address).

Good to know:

- The server only works while the Chromebook is awake and Linux is running. Closing the lid or letting it sleep stops uploads and browsing from other devices. Keep the Terminal window open.
- The address shown by the server for the Linux container (`100.115.x.x`) is internal and is hidden for ChromeOS. Use the Chromebook's Wi-Fi address from step 5.
- Your Wi-Fi address can change after a reboot. Check *Settings → Network* again, or reserve a fixed address for the Chromebook in your router.
- Chromebook storage is often small. Use **Central storage folder** (below) to keep media on an external drive or SD card.
## Access from anywhere (free, with Tailscale)

By default BlocStash only works on your home Wi-Fi. To use it away from home, BlocStash supports [Tailscale](https://tailscale.com/), a free private network (VPN) for your own devices. Your computer and your phones join the same private network, so they can reach each other from anywhere, encrypted, **without opening any port on your router** and without putting BlocStash on the public internet.

**Cost:** Tailscale's Personal plan is free. At the time of writing it allows up to 6 users and unlimited devices, and it is meant for non-commercial use such as a household photo library. Check [tailscale.com/pricing](https://tailscale.com/pricing) for the current terms.

### 1. Set up Tailscale

1. Create a free account at [login.tailscale.com](https://login.tailscale.com/start) (you can sign in with Google, Microsoft, Apple or GitHub).
2. Install Tailscale on **the computer that runs BlocStash** ([download](https://tailscale.com/download)), sign in, and leave it running.
3. Install Tailscale on each phone, tablet or Chromebook that will connect (App Store or Google Play), and sign in to the same account.

### 2. Start BlocStash

Start the server as usual. If Tailscale is running, the terminal shows an extra line with the remote address:

```text
From anywhere (Tailscale): http://100.x.y.z:8787  or  http://your-pc.your-network.ts.net:8787
```

The administrator can also see it in the app: **Settings → Remote access**. Tap **Check again** if you installed Tailscale after starting BlocStash.

<img src="docs/screenshots/07-remote-access-button.png" alt="Settings dialog with an arrow pointing to the Remote access button" width="720">

<img src="docs/screenshots/08-remote-access-address.png" alt="Remote access dialog with an arrow pointing to the addresses that work at home and away" width="720">

*(The addresses in the screenshots are examples. Yours will be different.)*

### 3. Connect your own phone

With Tailscale switched on in the phone, open the address from the terminal (or the Remote access dialog) in the phone's browser and sign in. The same address works at home and away, and it does not change when your router hands out new Wi-Fi addresses.

### 4. Invite members

Every member uses the same address, so it works at home and away at the same time. Each person needs the Tailscale app on their phone (switched on) and access to your Tailscale network. Either:

- **add them to your Tailscale network** from the Tailscale admin console (this counts towards the free plan's user limit), or
- **let them keep their own free Tailscale account** and *share this computer* with them from the Tailscale admin console (open the computer's menu and choose Share). They only get access to that one computer.

Then in BlocStash choose **Settings → Invite member** and send the QR code or link. When remote access is set up, invitations automatically use your Tailscale address, so the same invitation works at home and away. As before, an invitation works once and expires after five minutes.

<img src="docs/screenshots/09-invite-remote.png" alt="Invitation dialog with arrows pointing to the QR code and the Tailscale address in the link" width="720">

At home, members can also keep signing in with the home Wi-Fi address from the terminal if their Tailscale app is off. Invitations created before Tailscale was set up use the Wi-Fi address and only work on your home network.

### Optional: an HTTPS address

Tailscale can put an HTTPS address in front of BlocStash, still private to your Tailscale network. Turn on **HTTPS Certificates** in the Tailscale admin console (DNS page), then run this on the BlocStash computer:

```bash
tailscale serve --bg 8787
```

It prints an address like `https://your-pc.your-network.ts.net`. BlocStash recognises it, and invitations created while you browse through it use `https://`. To make invitations use it as well, start BlocStash with `STASH_PUBLIC_URL=https://your-pc.your-network.ts.net`. Do **not** use `tailscale funnel`, which publishes the address on the public internet.

### Sign-in protection

BlocStash now limits password guessing: after **5** wrong passwords from the same device, that device is blocked for **15 minutes**. There is also a looser limit per username. This applies at home and away. To change the number of attempts, start the server with `STASH_LOGIN_MAX_FAILS=<number>`.

### Troubleshooting remote access

- **"Remote access is not set up on this computer":** Tailscale is not installed or not signed in on the BlocStash computer. Fix that, then open **Settings → Remote access** and tap **Check again**.
- **The phone cannot connect when away:** check that Tailscale shows *Connected* on the phone, that the BlocStash computer is awake (turn off sleep) with BlocStash running, and that the person has access to your Tailscale network or the shared computer. Try the numeric address if the name does not work.
- **Works on Wi-Fi but not through Tailscale (Windows):** Windows Firewall may treat the Tailscale network as *Public*. In *Windows Security → Firewall & network protection → Allow an app through firewall*, tick **Public** as well for **Node.js JavaScript Runtime**. Only devices on your Tailscale network can reach that connection.
- **Running the server on a Chromebook:** remote access depends on Tailscale working inside the Chromebook's Linux environment, which can vary by device. This has not been tested there; running the server on a Windows PC is the safest choice.

## Libraries and permissions

- **Personal:** each member can view and manage their own private library. The household administrator cannot read another member's private library.
- **Shared:** everyone can view the household collection. Members can modify and delete their own contributions. The administrator can manage all shared content.
- **Trash:** deleted items are recoverable for 30 days. The trash view follows the same privacy boundary: members see their own deleted items; the administrator can manage shared-library trash but not private-library trash.
- **Sessions:** each browser gets an individual server-side session. Signing out revokes that session.

The library selector in the app switches between Personal and Shared without signing out.

## Data location

By default, BlocStash stores data in `./stash-data` next to the server:

```text
stash-data/
  files/             Original photos, videos and thumbnails
  trash/             Recoverable deleted media (30 days)
  household.json     Accounts, sessions, library indexes and trash metadata
  .token             Legacy compatibility token; household APIs use account sessions
  index.json         Legacy index retained after migration as a safety copy
```

Set `STASH_DIR` to move storage to another disk. For example, edit `start-blocstash.bat` to set it before starting Node:

```bat
@echo off
cd /d "%~dp0"
set STASH_DIR=D:\BlocStashData
node server\stash-server.js
pause
```

## Existing BlocStash data migration

On first administrator setup, if `stash-data/index.json` exists and contains a valid `items` array, BlocStash imports its entries into the administrator's Personal library. Existing media files are left in place. The old `index.json` is retained as a recovery copy; it is not deleted. Make a complete backup of the old `stash-data` folder before upgrading.

If the legacy index is invalid, setup refuses to overwrite it. Repair or restore the index from backup before retrying.

## Backups and recovery

Stop the server before copying the entire `stash-data` directory. This keeps `household.json`, media files and trash in a consistent backup. Do not back up only `household.json` or only `files/`.

Trash is automatically purged after 30 days. Keep independent backups if you need longer-term recovery.

## Local network and security

- The default local server uses HTTP. Traffic is not encrypted on the LAN; use a trusted private Wi-Fi network.
- Do not expose port 8787 directly to the public internet (no router port forwarding, no `tailscale funnel`). For access away from home, use the private Tailscale route described in [Access from anywhere](#access-from-anywhere-free-with-tailscale).
- Repeated wrong passwords are rate limited (5 attempts, then a 15 minute block per device).
- Passwords are stored as salted scrypt hashes. Session tokens are random and only their SHA-256 hashes are stored on the server. The browser receives an HttpOnly, SameSite=Strict session cookie.
- Core app, login, upload and browsing work locally. The map and EXIF helper currently use external libraries/tiles and may need internet access.
- Household metadata is currently stored in an atomic JSON database (`household.json`) to keep this build dependency-free. SQLite migration is a later hardening step; do not treat this first household build as a substitute for independent backups.

## Central household media folder

After signing in as the household administrator on the Windows PC, choose **Storage** in the toolbar or Settings → Central storage folder. On Windows the server opens a native folder picker; select the drive/folder that should hold the household's originals, thumbnails, and recoverable trash. On Linux and ChromeOS there is no picker, so BlocStash asks you to type the full folder path instead (for example `/mnt/chromeos/removable/MyDrive/BlocStash`).

The server copies existing media and trash into the selected folder before switching. The previous folder is retained as a backup. The selected path is stored in `stash-data/household.json`; all household uploads from the PC and phones are written by the server into that same folder. Personal and shared libraries remain separated by account metadata and permissions.

On ChromeOS, folders and drives are only visible to Linux after you share them: in the Files app, right-click the folder or external drive and choose **Share with Linux**. Shared items appear under `/mnt/chromeos/` (for example `/mnt/chromeos/MyFiles/…` or `/mnt/chromeos/removable/<drive name>`). Only the administrator can change the central folder. Members cannot select a different destination. If the selected drive is disconnected or not writable, uploads and media access fail with a storage error; BlocStash does not silently fall back to another folder. The Windows folder picker requires the server to be running in an interactive Windows desktop session. The typed-path option has no such requirement.

## Invite-only household and QR invitations

- Registration is invite-only after the first administrator account is created. There is no public signup route.
- Only the administrator can create household invitations. Member accounts receive a `403` when attempting to create invitations.
- Invitations are one-use and expire after five minutes.
- The administrator's **Settings** menu has **Invite member**. It displays a real QR code and a copyable invite URL.
- QR images are generated locally by a bundled pure-Python QR generator; no third-party CDN is required. Python 3 must be available (`py -3` or `python` on Windows; `python3` on Linux/macOS). If Python is unavailable, the copyable invite URL remains available.
- The QR code encodes the invite URL using the local server's host address, so the invited phone must be on the same Wi-Fi/LAN. Once Tailscale is set up, it encodes your Tailscale address instead, so members can join from home or away (they need the Tailscale app; see [Access from anywhere](#access-from-anywhere-free-with-tailscale)).
- The QR image endpoint requires an authenticated administrator and checks that the invitation is still valid.

## Login, settings and local folders

- Household login keeps users signed in for 30 days by default. On the login screen, uncheck **Keep me signed in for 30 days** to use a shorter one-day session.
- Once logged in, the top-right **Settings** button is visible. It includes account/session duration, member list, invitations (admin), trash and sign out. Session duration can be changed to 30, 90 or 365 days.
- The **Storage** button is shown only to the household administrator. It selects the server-owned central media folder. The login page no longer offers browser-local folder mode, so selecting a folder cannot bypass household authentication.
- Passkey/biometric login is not yet enabled. WebAuthn needs a trusted secure origin for browser and phone support; the current LAN server uses plain HTTP. HTTPS/certificate setup is a prerequisite for the next authentication stage.

## Household media folder layout

New household uploads retain their original filenames on disk and are stored under `users/<username>/<year>/<month>/`. Capture date metadata is used when available; otherwise the file's last-modified date is used. Thumbnail files are stored alongside their original media with an internal dot-prefixed name. If the same account uploads two files with the same name on the same date, BlocStash adds a short unique suffix to the later stored copy; the filename shown in the library remains unchanged.

Duplicate detection compares filenames only (case-insensitive). It does not read or hash the contents of selected or existing media, so it is substantially quicker, but two different files with the same filename are treated as potential duplicates.
