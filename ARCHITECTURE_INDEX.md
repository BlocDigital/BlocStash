# Architecture Index: Design Patterns for AI Coding Agent Efficiency

## Purpose

This document catalogs design decisions and architectural patterns used in this codebase that reduce AI agent token expenditure during code analysis, navigation, and generation. Patterns are organized by their primary benefit:

- **Token economy** — reduce the tokens required to understand, navigate, and generate code.
- **Self-containment** — reduce external dependencies so an agent can reason about the project without fetching external services.
- **Graph locality** — keep related code in the same files or nearby, reducing hop count during graph traversal.
- **Deterministic behavior** — reduce the need for repeated tool calls and clarification turns.

---

## 1. Single-File-Per-Route Pattern

**Location:** `server/stash-server.js`

Every HTTP route is a single function:

```js
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawnSync } = require('node:child_process');
```

All logic for a route lives in a single function. Benefits:

- An AI agent can understand a route by reading one function instead of following multiple arrows across files.
- The function signature is its own contract; no separate type file is needed.
- Related utilities are hoisted above the route so they stay visible when the agent inspects the file.

**Token savings:** Eliminates the need for an agent to open multiple files to understand a route handler. Reduces context size per reasoning step.

---

## 2. No Framework — Dependency-Free

**Location:** `server/stash-server.js` (lines 4–13)

The entire server is built from Node.js built-ins:

| Concept | Framework approach | This repo approach |
|---------|-------------------|--------------------|
| HTTP routing | Express/Koa router definitions | `if (req.path === '/api/...') { ... }` |
| Session store | Redis / MongoDB | In-memory object + atomic JSON file |
| Database | SQL ORM, migrations | Atomic JSON file with `fs.promises` |
| Authentication | Passport, JWT library | Custom `scrypt` + SHA-256 hash |
| Templating | EJS, Pug, Handlebars | Static HTML files in `public/` |
| File upload | `multer`, `formidable` | Manual `fs` stream piping |
| QR code generation | `qrcode` npm package | Pure Python `qrcode` CLI invoked via `spawnSync` |

**Token savings:** An agent can reason about the entire system by reading only the source files in the repo. No need to fetch package.json dependencies, read third-party source, or infer framework conventions.

---

## 3. Atomic Write Pattern

**Location:** `server/stash-server.js` lines 88–94

```js
async function saveHouse() {
  houseWrite = houseWrite.catch(() => {}).then(async () => {
    const tmp = `${HOUSE}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(household), { flag: 'wx', mode: 0o600 });
    await fsp.rename(tmp, HOUSE);
  });
  return houseWrite;
}
```

Benefits:

- No partial writes or race conditions that an agent must reason about.
- No need for a database schema or migration system.
- The state file (`household.json`) is the single source of truth.

**Token savings:** An agent reads one file to understand the entire application state. No schema, no migrations, no ORM to learn.

---

## 4. In-Memory State with Single Source of Truth

**Location:** `server/stash-server.js` lines 42–46

```js
const HOUSE = path.join(DIR, 'household.json');
let household = { version: 1, users: [], sessions: [], invites: [], personal: {}, shared: { items: [] }, trash: [], assetOwners: {}, storageRoot: null };
try { household = { ...household, ...JSON.parse(fs.readFileSync(HOUSE, 'utf8')) }; }
catch (e) { if (e.code !== 'ENOENT') { console.error('household.json is invalid; refusing to overwrite it.'); process.exit(1); } }
```

The application state lives in a single JSON file. All routes read and write this same object.

**Token savings:** An agent never needs to "reconcile" multiple sources of state. The entire application state is one file.

---

## 5. URL-Routed File Serving

**Location:** `server/stash-server.js` (not shown in excerpt, but referenced in README)

Media files are served directly via URL routing, not streamed through a database record.

```js
req.pipe(fs.createReadStream(mediaFile(name)));
```

**Token savings:** No ORM to learn. No migration system. No database schema to reason about.

---

## 6. Pure-Python QR Code Generation

**Location:** `server/stash-server.js` line 68–72

```js
const script = "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog...";
const picked = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: false, timeout: 120000 });
```

QR codes are generated by a pure-Python library bundled in the project, invoked via `spawnSync`. No third-party Node package is installed.

**Token savings:** The agent does not need to fetch an external npm package to understand how QR codes are generated.

---

## 7. Environment Variable Configuration

**Location:** `server/stash-server.js` lines 16–19

```js
const PORT = Number(E.PORT) || 8787;
const ORIGIN = E.STASH_ORIGIN || '*';
const MAX_INDEX_BYTES = Number(E.STASH_MAX_INDEX_BYTES) || 50 * 1024 * 1024;
const MAX_FILE_BYTES = Number(E.STASH_MAX_FILE_BYTES) || 20 * 1024 * 1024 * 1024;
const DIR = path.resolve(E.STASH_DIR || './stash-data');
```

Configuration is declarative and typed at the top of the file.

**Token savings:** The agent reads a single block of code to understand the runtime configuration. No config file parsing or nested environment object to decode.

---

## 8. Path Normalization

**Location:** `server/stash-server.js` line 49

```js
const safeFolder = value => String(value || 'user').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+|\.+$/g, '').slice(0,64) || 'user';
```

Usernames are normalized to a safe, consistent string.

**Token savings:** The agent does not need to reason about filesystem quirks or Unicode normalization rules when exploring the codebase.

---

## 9. Stream-Based File Upload

**Location:** `server/stash-server.js` (stream piping shown in excerpt)

Uploads are handled by piping `req` into a stream that writes to the filesystem. No `multer`, no `formidable`, no ORM.

**Token savings:** No framework-specific patterns to learn. No dependency on a package the agent must fetch.

---

## 10. No External Database — Atomic JSON

**Location:** `server/stash-server.js` lines 42–44

```js
const HOUSE = path.join(DIR, 'household.json');
let household = { version: 1, users: [], sessions: [], invites: [], personal: {}, shared: { items: [] }, trash: [], assetOwners: {}, storageRoot: null };
try { household = { ...household, ...JSON.parse(fs.readFileSync(HOUSE, 'utf8')) }; }
catch (e) { if (e.code !== 'ENOENT') { console.error('household.json is invalid; refusing to overwrite it.'); process.exit(1); } }
```

The entire application state is a single JSON object. All routes read and write it atomically.

**Token savings:** Zero ORM, zero migrations, zero schema. The agent reads one file to understand the entire data model.

---

## 11. Self-Contained Crypto

**Location:** `server/stash-server.js` line 97

```js
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
```

No external crypto library. No JWT library. No password-hashing library.

**Token savings:** The agent does not need to fetch an external dependency to understand how secrets are handled.

---

## 12. No Build Step — Plain JavaScript

**Location:** All source files

The server is a single `.js` file. The public folder contains static HTML. There is no `build` step, no `dist` folder, no webpack/rollup/vite config.

**Token savings:** The agent does not need to read a build config or understand a transpiled bundle. The source is the artifact.

---

## 13. Minimal `.gitignore` — Only Secrets and Runtime Data

**Location:** `.gitignore`

```
# Environment variables and secrets
.env
.env.*
!.env.example
*.env
*.local
*.secret
secrets/
.secret/

# BlocStash local runtime data (accounts, password hashes, sessions, invites, tokens, indexes, media)
stash-data/
**/stash-data/
.token
**/.token
household.json
**/household.json
index.json
**/index.json
files/
**/files/
.stash-trash/
**/.stash-trash/

# Credentials, private keys and certificates
*service-account*.json
*firebase-adminsdk*.json
*credentials*.json
*credential*.json
*secrets*.json
*.pem
*.key
*.p12
*.pfx
*.keystore
*.jks
id_rsa
id_ed25519

# Cloud / deployment credentials
.firebase/
.firebaserc
.firebase-debug.log
firebase-debug.log

# Dependencies and generated output
node_modules/
**/node_modules/
dist/
build/
coverage/
.cache/
.tmp/
tmp/

# Logs and diagnostics
*.log
logs/
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*

# Backups and local exports
*.bak
*.backup
*.old
*.dump
*.sqlite
*.sqlite3
*.db
*.zip

# OS / editor files
.DS_Store
Thumbs.db
Desktop.ini
.vscode/
.idea/
*.swp
*.swo
```

Only secrets, runtime data, and build artifacts are ignored. The repo contains only source and documentation.

**Token savings:** An agent can clone the repository and immediately understand the system without fetching build artifacts or build configs.

---

## 14. No Type System — Plain JavaScript

**Location:** All source files

There is no TypeScript, no `.d.ts`, no type assertion gymnastics. The code is plain JavaScript.

**Token savings:** The agent does not need to reason about type annotations, generic parameters, or type aliases. The code is self-documenting through function names and docstrings.

---

## 15. Single Point of Entry — `server/stash-server.js`

**Location:** `start-blocstash.bat` → `node server/stash-server.js`

All logic lives in one file. The HTTP server, authentication, file storage, and templating are all in one place.

**Token savings:** An agent can read one file to understand the entire system.

---

## Summary

This architecture minimizes the tokens an AI coding agent needs to:

- **Navigate** the codebase (single-file-per-route, single source of truth).
- **Understand** external dependencies (no frameworks, no ORM, no external DB).
- **Generate** code changes (declarative config, no build step, plain JS).
- **Verify** behavior (deterministic atomic writes, no race conditions).

The result is a system that is cheap to reason about, cheap to reason about its dependencies, and cheap to modify.
