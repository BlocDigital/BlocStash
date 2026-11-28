# BlocStash — Product & Architecture Brief (for Hermes Agents)

## 1. Core Concept

**BlocStash** (Household Edition) is a **local-first, self-hosted household photo and video library** designed to replace cloud photo subscriptions for families and flatmates without requiring cloud accounts, external databases, or complex setup.

One designated machine on the home network (a Windows PC, or a Linux/ChromeOS machine) runs the Node.js server and stores all original media. Phones, tablets, Chromebooks, and other computers connect over the local Wi-Fi (or optionally Tailscale) through a Progressive Web App (PWA).

---

## 2. Target Users & Experience Goals

- **Primary users:** Non-technical household members (families, partners, flatmates) who want Google Photos / iCloud-like convenience on their own hardware.
- **Zero-friction setup:** Run via a single launcher (`start-blocstash.bat` on Windows, `start-blocstash.sh` on Linux/macOS/ChromeOS) with no npm install step required for core server operation.
- **Privacy by default:**
  - Media never leaves the home LAN unless explicitly accessed via Tailscale or user-configured HTTPS.
  - Each household member has a **Personal** library that even the household administrator cannot read, alongside a **Shared** household library.

---

## 3. Architecture & Tech Stack

The codebase is intentionally **dependency-free** on the Node.js side and single-file/vanilla on the frontend:

- **Backend (`server/stash-server.js`):**
  - Pure Node.js (`18+`) HTTP/HTTPS server (default port `8787`, bound to `0.0.0.0`).
  - Optional TLS via `STASH_CERT` / `STASH_KEY`.
  - Atomic JSON metadata store (`stash-data/household.json`) holding accounts, sessions, library indexes, central storage path, and trash metadata.
  - Legacy `stash-data/index.json` migration into the first administrator's Personal library on setup.
  - Media stored on disk under `<storage-root>/users/<username>/<year>/<month>/` with dot-prefixed thumbnails and filename-based case-insensitive duplicate detection.
  - `server/qr_svg.py` + vendored `server/vendor/qrcode` (pure-Python QR SVG generator) used to render one-use, 5-minute invitation QR codes without external CDNs.
- **Frontend (`public/`):**
  - Single-page PWA (`public/index.html`, `public/manifest.webmanifest`, `public/sw.js`) with local fonts (`Outfit`, `YoungSerif`) and icons.
  - Features: Personal/Shared library switcher, search, albums, favorites, lightbox & slideshow, multi-select/marquee selection, upload progress panel, map/EXIF view, 30-day recoverable Trash, and Settings/Admin dialogs.
- **Tests (`check.js`):**
  - Repository verification script.

---

## 4. Security & Access Model

- **Invite-only household:** First run creates one administrator account (passwords >= 12 characters). Public signup is disabled; only the admin can generate 5-minute, single-use invite links/QR codes.
- **Auth & Sessions:** Salted `scrypt` password hashes; random session tokens stored server-side as SHA-256 hashes; `HttpOnly`, `SameSite=Strict` `stash_session` cookie (default 30 days, configurable 1/30/90/365 days). Login rate limiting per client IP (`STASH_LOGIN_MAX_FAILS`, default 5).
- **Library Isolation:**
  - **Personal:** Private to the owning user (including their Trash).
  - **Shared:** Visible to all household members; members manage their own uploads, while the admin can manage all shared items and shared Trash.
- **Central Storage (`Storage`):** Admin-configured central folder (`STASH_DIR` or selected via native Windows folder picker / typed path on Linux/ChromeOS). Copies existing media/trash before switching and refuses silent fallback if the target drive is disconnected.

---

## 5. Key Constraints & Design Principles for Agents

1. **Keep core runtime dependency-free:** Avoid introducing `npm` build steps or heavy runtime dependencies unless explicitly requested; the project ships as a self-contained folder/zip for household users.
2. **Preserve privacy boundaries:** Never weaken Personal library or Trash isolation between members and admins.
3. **Local-first & offline-resilient:** Core auth, upload, browsing, and QR invite generation must work on an isolated LAN without internet access (note: map tiles / external EXIF helpers are currently the only internet-dependent pieces).
4. **Windows & ChromeOS parity:** Account for Windows interactive desktop constraints (e.g., native folder picker) and ChromeOS Linux container port forwarding / `STASH_PUBLIC_HOST`.
5. **Safe data handling:** Metadata writes must remain atomic, backups rely on consistent `stash-data` directory snapshots, and storage switches must never discard data.

---

## 6. Planned Evolution / Next Steps

- **SQLite migration:** Replace `household.json` with SQLite for stronger concurrency, scalability on large libraries, and crash resilience.
- **HTTPS / trusted certificates:** Enable trusted HTTPS on the LAN so WebAuthn (passkeys / biometric login) and stricter PWA/secure-context features can be enabled.
- **Offline map/EXIF independence:** Remove remaining external network dependencies for map tiles and EXIF parsing.
- **Content-based deduplication (optional):** Complement fast filename matching with hash-based duplicate checks where appropriate.
