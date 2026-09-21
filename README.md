# Jigsaw Together

A real-time multiplayer jigsaw puzzle app. Play Puzzle of the Day or pick a library image, share a link, and solve it together.

**Live:** deployed on Vercel with Firebase Realtime Database for sync.

---

## Features

### Co-op Puzzle
- Pick a catalogued puzzle (grid and rotation are set by admin), then invite friends
- Public rooms appear in the open rooms browser (`/rooms`); private rooms are share-link only
- Hard mode: pieces start randomly rotated; right-click or double-tap to rotate
- Pieces snap together automatically when close enough (edge-ID matching — only truly adjacent pieces snap)
- Groups of connected pieces drag and rotate as one unit
- Real-time sync across all players — see others' cursors, locked pieces, and avatars
- Shared timer starts on first interaction
- Chat panel (bottom-left) with emoji reactions that float across the board
- Zoom with pinch-to-zoom (mobile) or scroll

### Catalog admin
- `/admin` is temporarily open (no secret) for testing
- Aim for ~25 / ~50 / ~100; `calculateGrid` picks a squarish cols×rows for that photo
- Live cut preview overlays the jigsaw outline on the image as you change parameters
- Library images missing from Firebase `catalog/` are auto-filled; you can still edit and save

### Puzzle of the Day (POTD)
- One daily puzzle, picked at random from the admin catalog (keeps that puzzle’s grid and rotation)
- Each player gets their own private clone — progress is independent
- Daily leaderboard on the landing page and in the completion screen
- Resets at midnight Greek time (Europe/Athens); cron at 08:05 UTC

VS Mode and custom photo upload are not on `main`. The last snapshot that still includes them is on `archive/vs-mode` and `archive/custom-upload`.

---

## Architecture

### Stack
- **Frontend**: Vanilla JS (ES modules), single `style.css`, **no production build** (ship `js/` as static files)
- **Tooling**: npm **devDependencies** only — ESLint, Vitest, TypeScript (`npm run lint` / `npm test` / `npm run typecheck`); CI runs the same on `main`
- **Backend**: Vercel serverless functions (`/api/*`)
- **Database**: Firebase Realtime Database (client SDK via CDN)
- **Images**: Cloudinary (library storage, CDN delivery)
- **Hosting**: Vercel

### File Structure

```
├── package.json        Dev-only: ESLint, Vitest, TypeScript (no app bundle)
├── eslint.config.js    Flat ESLint config for js/ + api/ + lib/
├── vitest.config.js    Unit tests (pure modules under test/)
├── tsconfig.json       typecheck entry (types/ for now)
├── scripts/            Node-only helpers (not deployed as `/api/*` — keeps Vercel Hobby within function limits)
│
├── index.html          Landing page (POTD, Play Together)
├── puzzle.html         Co-op puzzle page (redirects to `/`)
├── play.html           Catalog picker
├── rooms.html          Open co-op rooms browser
├── admin.html          Catalog admin (temporarily open at /admin, no token)
│
├── js/
│   ├── app.js          Landing page logic (POTD load, Play Together create)
│   ├── puzzle.js       Co-op puzzle: rendering, drag, snap, sync, chat
│   ├── play.js         Standalone catalog picker
│   ├── admin.js        Catalog admin: Cloudinary pick/upload, live cut preview, save
│   ├── rooms.js        Open rooms list (live Firebase subscription)
│   ├── firebase.js     All Firebase read/write helpers (single source of truth)
│   ├── jigsaw.js       Pure functions: edge generation, piece cutting (canvas)
│   ├── puzzle-grid.js  Squarish cols×rows helper (shared client/server)
│   ├── mobile-quality.js  Texture / HQ heuristics (shared with puzzle paths)
│   └── client-observe.js  Optional: POSTs errors to /api/client-error when configured
│
├── css/
│   └── style.css       All styles (dark theme, puzzle board, chat)
│
├── lib/
│   ├── structured-log.js     Shared JSON-per-line logger (kept outside api/ for Vercel Hobby function limits)
│   └── puzzle-library.js     Cloudinary puzzle-library listing (shared by room-images + admin seed)
│
├── api/
│   ├── config.js       Returns Firebase config from env vars (called by client)
│   ├── client-error.js Optional: receives truncated client error payloads (logs JSON line)
│   ├── potd.js         Cron: one daily catalog puzzle
│   ├── potd-play.js    Creates a private puzzle clone for each POTD player
│   ├── potd-today.js   Today's POTD pointer + preview URL
│   ├── catalog.js      Public catalog list
│   ├── admin.js        Signed Cloudinary upload + catalog CRUD
│   ├── room-create.js  Creates a co-op puzzle from a catalog entry
│   ├── room-images.js  Lists Cloudinary puzzle-library images
│   └── cleanup.js      Cron: deletes puzzles + leftover VS rooms older than 24h
│
└── vercel.json         Rewrites (/puzzle, /play, /rooms, /admin; /vs → /) + cron schedules
```

### Firebase Data Model

```
puzzles/{puzzleId}/
  meta/           imageUrl, cols, rows, pieceW/H, displayW/H, edges[], seed,
                  hardMode, createdAt, startedAt, isPOTD, potdDifficulty
  pieces/
    {index}/      x, y, rotation, solved, lockedBy, groupId
  players/
    {playerId}/   name, color, lastSeen

rooms-index/{puzzleId}/  lightweight index for the open rooms browser
  pieces, hardMode, status, createdAt, imageUrl, solvedCount, playerCount, creatorName

catalog/{id}/
  imageUrl, publicId, width, height, cols, rows, pieces, hardMode, createdAt

potd/daily/
  puzzleId, date, imageUrl, pieces, cols, rows, hardMode, catalogId
  leaderboard/{puzzleId}/  names[], secs, date

chat/{puzzleId}/{pushId}/  playerId, name, color, text, ts
```

### Key Design Decisions

**Piece snapping** uses edge IDs — every internal edge has a unique integer ID shared between the two adjacent pieces. Snap only triggers when the shared edge IDs match and pieces are within a distance threshold (~40% of the smaller piece dimension). This prevents false snaps between non-adjacent pieces.

**Groups** are tracked client-side only (not in Firebase) as `groups: {groupId → Set<index>}` + `pieceGroup: [groupId per index]`. When a snap happens, `writeSnappedPositions` persists the `groupId` field so late-joining players can reconstruct groups from Firebase on load.

**POTD cloning**: each player hitting `/api/potd-play` gets their own `puzzles/{newId}` clone of the daily template, with `startedAt` stripped so their timer is fresh.

---

## Environment Variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `FIREBASE_DB_URL` | api/* | Realtime Database URL |
| `FIREBASE_DB_SECRET` | api/* | Legacy DB secret (server-side writes) |
| `FIREBASE_API_KEY` | api/config.js | Client SDK config |
| `FIREBASE_AUTH_DOMAIN` | api/config.js | |
| `FIREBASE_PROJECT_ID` | api/config.js | |
| `FIREBASE_STORAGE_BUCKET` | api/config.js | |
| `FIREBASE_MESSAGING_SENDER_ID` | api/config.js | |
| `FIREBASE_APP_ID` | api/config.js | |
| `CLOUDINARY_CLOUD_NAME` | api/* | Cloudinary cloud for library listing and CDN delivery |
| `CLOUDINARY_API_KEY` | api/* | Server-side Cloudinary ops |
| `CLOUDINARY_API_SECRET` | api/* | |
| `CLEANUP_SECRET` | api/cleanup.js | Bearer token Vercel sends to cron routes |
| `FEEDBACK_ADMIN_TOKEN` | api/feedback.js | Admin token for feedback triage. Catalog `/admin` is temporarily open (no token). |
| `ADMIN_TOKEN` | api/admin.js | Unused while `/admin` is open; restore later for the secret catalog link |

---

## Local Development

**Production** does not run `npm run build`; Vercel should leave the project **build command empty** and deploy static files plus `api/` as today.

Install dev tooling once:

```bash
npm install
npm run lint
npm test
npm run typecheck
```

Serve the app with API routes:

```bash
npx vercel dev
```

Requires a `.env` file (or Vercel environment variables) with the vars above.

**Client errors**: `index.html` sets `window.__JT_CLIENT_ERROR_ENDPOINT = '/api/client-error'`, which logs a short JSON line per report in Vercel function logs (rate-limited on the client). Remove or override the global to disable.

---

## Feedback Triage Automation

The app includes:

- `POST /api/feedback` — stores player bug/feedback submissions
  - For `type=bug`, it also auto-triages immediately and attempts GitHub automation (draft PR if confident, otherwise an issue)
- `GET /api/feedback-list?limit=50` — admin-only list endpoint
- `POST /api/feedback-triage` — admin-only triage status updater
- `POST /api/feedback-delete` — admin-only archive+delete a resolved report
- `scripts/feedback-agent.mjs` — local CLI helper for triage + PR scaffolding

### Run the triage helper

Set env vars:

```bash
export FEEDBACK_BASE_URL="http://localhost:3000"
export FEEDBACK_ADMIN_TOKEN="your-shared-admin-token"
```

Dry-run classification:

```bash
node scripts/feedback-agent.mjs triage --limit 50
```

Apply triage results back to Firebase:

```bash
node scripts/feedback-agent.mjs triage --limit 50 --apply --reviewer "cursor-agent"
```

Aggressive bug labeling (default):

```bash
export FEEDBACK_AGENT_MODE="aggressive"
```

More conservative labeling:

```bash
export FEEDBACK_AGENT_MODE="conservative"
```

Seed a fix branch + draft PR for one feedback item:

```bash
node scripts/feedback-agent.mjs seed-pr --id "<feedbackId>"
```

This creates a branch, adds a fix brief in `docs/feedback-fixes/`, pushes the branch, opens a draft PR via `gh`, and marks the report as `in_progress`.

### GitHub automation env vars (for auto PR/issue)

Set these in Vercel:

```bash
export GITHUB_TOKEN="ghp_... (PAT) with repo access"
export GITHUB_REPO="owner/jigsaw-together"
export GITHUB_BASE_BRANCH="main" # optional (default: main)
```

When `POST /api/feedback` receives a `type=bug` submission, the server attempts:

- If confidence is high: open a **draft PR** with a scaffold fix brief under `docs/feedback-fixes/`
- Otherwise: open a **GitHub issue** with the report + triage explanation

### Cursor Cloud Agent auto-fix (optional)

If you also set `CURSOR_API_KEY`, the server will additionally launch a Cursor Cloud Agent **on the created draft PR** so Cursor can implement the fix.

```bash
export CURSOR_API_KEY="from Cursor Dashboard (Cloud Agents)"
export CURSOR_MODEL="default" # optional
```
