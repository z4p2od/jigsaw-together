# Jigsaw Together

A real-time multiplayer jigsaw puzzle app. Upload a photo, share a link, and solve it together — or race a friend in VS Mode.

**Live:** deployed on Vercel with Firebase Realtime Database for sync.

---

## Features

### Co-op Puzzle
- Upload any image (JPEG/PNG/WebP up to 10MB), pick piece count (4–1000), choose Normal or Hard mode
- Hard mode: pieces start randomly rotated; right-click or double-tap to rotate
- Pieces snap together automatically when close enough (edge-ID matching — only truly adjacent pieces snap)
- Groups of connected pieces drag and rotate as one unit
- Real-time sync across all players — see others' cursors, locked pieces, and avatars
- Shared timer starts on first interaction
- Chat panel (bottom-left) with emoji reactions that float across the board
- Zoom with pinch-to-zoom (mobile) or scroll

### Puzzle of the Day (POTD)
- Three daily puzzles: Easy (25 pieces), Medium (100 pieces), Hard (100 pieces, rotated)
- Each player gets their own private clone — progress is independent
- Daily leaderboard on the landing page and in the completion screen
- Resets at midnight Greek time (Europe/Athens); cron at 22:00 UTC

### VS Mode — 1v1 Race
- Both players get the same puzzle (same image, same grid, same initial scatter via seeded RNG)
- Each player controls only their own pieces; opponent's board shown read-only on the right
- Lobby with share link + open rooms browser (`/vs-rooms`) — join without a link
- Ready → 3-2-1-GO countdown → race starts
- Progress bars at the top show both players' completion %
- First to finish wins; result screen shows times and win/loss
- **Rematch**: offer/accept flow — either player can offer, other sees a pulsing Accept button; on accept the new room is pre-started (no ready screen), same settings, same opponent
- Win counter persists across rematches in the session
- Chat + emoji reactions: your emoji flies on the opponent's board, theirs on yours
- Piece count (24/100/250) and mode (Normal/Hard) chosen before creating a room

---

## Architecture

### Stack
- **Frontend**: Vanilla JS (ES modules), single `style.css`, no build step
- **Backend**: Vercel serverless functions (`/api/*`)
- **Database**: Firebase Realtime Database (client SDK via CDN)
- **Images**: Cloudinary (upload, storage, CDN delivery)
- **Hosting**: Vercel

### File Structure

```
├── index.html          Landing page (upload, POTD cards, VS entry)
├── puzzle.html         Co-op puzzle page
├── vs.html             VS mode game page
├── vs-rooms.html       Open VS rooms browser
│
├── js/
│   ├── app.js          Landing page logic (upload, POTD load, VS create)
│   ├── puzzle.js       Co-op puzzle: rendering, drag, snap, sync, chat
│   ├── vs.js           VS mode: lobby, countdown, split boards, rematch
│   ├── vs-rooms.js     Open rooms list (live Firebase subscription)
│   ├── firebase.js     All Firebase read/write helpers (single source of truth)
│   └── jigsaw.js       Pure functions: edge generation, piece cutting (canvas)
│
├── css/
│   └── style.css       All styles (dark theme, puzzle board, VS UI, chat)
│
├── api/
│   ├── config.js       Returns Firebase config from env vars (called by client)
│   ├── cloudinary-config.js  Returns Cloudinary upload preset (called by client)
│   ├── potd.js         Cron: generates daily POTD puzzles, writes to Firebase
│   ├── potd-play.js    Creates a private puzzle clone for each POTD player
│   ├── vs-create.js    Creates a VS room (picks image, generates grid/edges/seed)
│   └── cleanup.js      Cron: deletes puzzles + VS rooms older than 24h
│
└── vercel.json         Rewrites (/puzzle, /vs, /vs-rooms) + cron schedules
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

vs/{roomId}/
  meta/           imageUrl, cols, rows, pieceW/H, displayW/H, edges[], seed,
                  pieces, hardMode, status, createdAt, startedAt,
                  winner, winnerSecs, rematchOffers/{playerId}, rematchRoomId
  players/
    {playerId}/   name, color, ready, finishedAt
  pieces/
    {playerId}/   — each player owns their own piece set
      {index}/    x, y, rotation, solved, lockedBy, groupId

vs-index/{roomId}/   lightweight index for the open rooms browser
  pieces, hardMode, status, createdAt, creatorName

potd/{difficulty}/
  date, imageUrl, cols, rows, ...meta
  leaderboard/{puzzleId}/  names[], secs, date

chat/{puzzleId}/{pushId}/  playerId, name, color, text, ts
```

### Key Design Decisions

**Piece snapping** uses edge IDs — every internal edge has a unique integer ID shared between the two adjacent pieces. Snap only triggers when the shared edge IDs match and pieces are within a distance threshold (~40% of the smaller piece dimension). This prevents false snaps between non-adjacent pieces.

**Groups** are tracked client-side only (not in Firebase) as `groups: {groupId → Set<index>}` + `pieceGroup: [groupId per index]`. When a snap happens, `writeSnappedPositions` persists the `groupId` field so late-joining players can reconstruct groups from Firebase on load.

**VS scatter** uses a seeded LCG random number generator (`s = (s * 1664525 + 1013904223) & 0xffffffff`) with a shared seed stored in Firebase meta. Both clients run the same function and get identical starting positions/rotations — no need to write 200 piece positions server-side.

**Opponent board** in VS mode renders a full second board (read-only) from `onVSOpponentPieces` (Firebase `onValue` on the opponent's piece path). Updates are full snapshots — efficient enough for 100-piece games.

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
| `CLOUDINARY_CLOUD_NAME` | api/cloudinary-config.js, api/* | |
| `CLOUDINARY_API_KEY` | api/* | Server-side Cloudinary ops |
| `CLOUDINARY_API_SECRET` | api/* | |
| `CLOUDINARY_UPLOAD_PRESET` | api/cloudinary-config.js | Unsigned upload preset |
| `CLEANUP_SECRET` | api/cleanup.js | Bearer token Vercel sends to cron routes |

---

## Local Development

No build step. Serve the root directory with any static server and proxy `/api` to Vercel dev:

```bash
npx vercel dev
```

Requires a `.env` file (or Vercel environment variables) with the vars above.
