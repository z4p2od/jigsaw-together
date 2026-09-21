import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  push,
  onValue,
  onChildChanged,
  onChildAdded,
  off,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

// Fetch Firebase config from Vercel serverless function (which reads env vars)
// Hardening: never let module-load hang forever (prevents "Loading puzzle" forever).
async function fetchJsonWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// No top-level await — Safari 14 (iOS 14) doesn't support it.
// Start the fetch immediately but resolve lazily so the module parses on all browsers.
let _db = null;
const _dbReady = fetchJsonWithTimeout('/api/config', 8000).then(config => {
  const app = initializeApp(config);
  _db = getDatabase(app);
  return _db;
});
// Suppress unhandledrejection at module level — the rejection still surfaces when
// callers do `await _dbReady` inside initPuzzle's try/catch. Without this, a
// transient /api/config failure fires window.unhandledrejection before loadPuzzle
// ever runs, incorrectly triggering the module-error overlay.
_dbReady.catch(() => {});

// Per-piece write throttle: track last write time per piece
const lastWrite = {};

/**
 * Load puzzle meta + all piece states once.
 * @returns {Promise<{ meta, pieces: object }>}
 */
export async function loadPuzzle(puzzleId) {
  const db = await _dbReady;
  const snap = await get(ref(db, `puzzles/${puzzleId}`));
  if (!snap.exists()) throw new Error('Puzzle not found');
  return snap.val();
}

/**
 * Attempt to lock a piece for a player.
 * Only writes if piece is currently unlocked.
 */
export async function lockPiece(puzzleId, pieceIndex, playerId) {
  const db = await _dbReady;
  const pieceRef = ref(db, `puzzles/${puzzleId}/pieces/${pieceIndex}`);
  const snap = await get(pieceRef);
  const piece = snap.val();
  if (piece.solved || (piece.lockedBy && piece.lockedBy !== playerId)) return false;
  await update(pieceRef, { lockedBy: playerId });
  return true;
}

/** Release a piece lock. */
export function unlockPiece(puzzleId, pieceIndex) {
  return update(ref(_db, `puzzles/${puzzleId}/pieces/${pieceIndex}`), { lockedBy: null });
}

/**
 * Throttled position update — max one write per 50ms per piece.
 */
export function updatePiecePosition(puzzleId, pieceIndex, x, y) {
  const now = Date.now();
  if (lastWrite[pieceIndex] && now - lastWrite[pieceIndex] < 50) return;
  lastWrite[pieceIndex] = now;
  update(ref(_db, `puzzles/${puzzleId}/pieces/${pieceIndex}`), { x, y });
}

/** Mark a piece as solved at its snapped position and release lock. */
export function solvePiece(puzzleId, pieceIndex, x, y) {
  return update(ref(_db, `puzzles/${puzzleId}/pieces/${pieceIndex}`), {
    x, y, solved: true, lockedBy: null,
  });
}

/**
 * Batch-solve multiple pieces at once (for group snapping).
 * updates = { [pieceIndex]: { x, y } }
 */
export function solveGroup(puzzleId, updates) {
  const flat = {};
  Object.entries(updates).forEach(([index, { x, y }]) => {
    flat[`${index}/x`]       = x;
    flat[`${index}/y`]       = y;
    flat[`${index}/solved`]  = true;
    flat[`${index}/lockedBy`] = null;
  });
  return update(ref(_db, `puzzles/${puzzleId}/pieces`), flat);
}

/**
 * Throttled batch position update for dragging a group.
 * positions = [{ index, x, y }, ...]
 */
let lastGroupWrite = 0;
export function updateGroupPosition(puzzleId, positions) {
  const now = Date.now();
  if (now - lastGroupWrite < 50) return;
  lastGroupWrite = now;
  const flat = {};
  positions.forEach(({ index, x, y }) => {
    flat[`${index}/x`] = x;
    flat[`${index}/y`] = y;
  });
  update(ref(_db, `puzzles/${puzzleId}/pieces`), flat);
}

/**
 * Lock multiple pieces for a player (group drag start).
 */
export async function lockGroup(puzzleId, indices, playerId) {
  const db = await _dbReady;
  const flat = {};
  for (const index of indices) {
    flat[`${index}/lockedBy`] = playerId;
  }
  await update(ref(db, `puzzles/${puzzleId}/pieces`), flat);
}

/**
 * Unlock multiple pieces (group drag end without snap).
 */
export function unlockGroup(puzzleId, indices) {
  const flat = {};
  indices.forEach(i => { flat[`${i}/lockedBy`] = null; });
  return update(ref(_db, `puzzles/${puzzleId}/pieces`), flat);
}

/**
 * Write x, y, rotation when releasing from pocket back to pre-pocket positions (not throttled).
 * entries: [{ index, x, y, rotation }, ...]
 */
export function writePocketRestoreStates(puzzleId, entries) {
  const flat = {};
  entries.forEach(({ index, x, y, rotation, faceDown }) => {
    flat[`${index}/x`] = x;
    flat[`${index}/y`] = y;
    flat[`${index}/rotation`] = rotation;
    if (faceDown !== undefined) flat[`${index}/faceDown`] = !!faceDown;
  });
  return update(ref(_db, `puzzles/${puzzleId}/pieces`), flat);
}

/**
 * Write snapped positions and clear locks in one atomic batch.
 * positions = [{ index, x, y }, ...]
 */
export function writeSnappedPositions(puzzleId, positions, groupId) {
  const flat = {};
  positions.forEach(({ index, x, y }) => {
    flat[`${index}/x`]        = x;
    flat[`${index}/y`]        = y;
    flat[`${index}/lockedBy`] = null;
    flat[`${index}/groupId`]  = groupId;
  });
  return update(ref(_db, `puzzles/${puzzleId}/pieces`), flat);
}

/** Update the rotation of a single piece. */
export function updatePieceRotation(puzzleId, pieceIndex, rotation) {
  return update(ref(_db, `puzzles/${puzzleId}/pieces/${pieceIndex}`), { rotation });
}

/** Flip face-up and optionally correct rotation (co-op). */
export function updatePieceReveal(puzzleId, pieceIndex, { faceDown, rotation }) {
  const patch = { faceDown };
  if (rotation !== undefined) patch.rotation = rotation;
  return update(ref(_db, `puzzles/${puzzleId}/pieces/${pieceIndex}`), patch);
}

/** Batch-update rotation for multiple pieces (group rotate). */
export function updateGroupRotation(puzzleId, indices, rotation) {
  const flat = {};
  indices.forEach(i => { flat[`${i}/rotation`] = rotation; });
  return update(ref(_db, `puzzles/${puzzleId}/pieces`), flat);
}

/** Batch-update rotation + positions for a group rotate (single write). */
export function updateGroupRotationAndPositions(puzzleId, positions) {
  const flat = {};
  positions.forEach(({ index, x, y, rotation }) => {
    flat[`${index}/x`]        = x;
    flat[`${index}/y`]        = y;
    flat[`${index}/rotation`] = rotation;
  });
  return update(ref(_db, `puzzles/${puzzleId}/pieces`), flat);
}

// ── Player presence ───────────────────────────────────────────────────────────

const PLAYER_COLORS = ['#e94560','#f5a623','#4ecdc4','#a78bfa','#34d399','#60a5fa','#f472b6','#fb923c'];

export function getPlayerColor(playerId) {
  // Deterministic color from playerId
  let hash = 0;
  for (const c of playerId) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return PLAYER_COLORS[hash % PLAYER_COLORS.length];
}

export function updatePlayerPresence(puzzleId, playerId, name) {
  return update(ref(_db, `puzzles/${puzzleId}/players/${playerId}`), {
    name,
    color: getPlayerColor(playerId),
    lastSeen: Date.now(),
  });
}

export function removePlayer(puzzleId, playerId) {
  return set(ref(_db, `puzzles/${puzzleId}/players/${playerId}`), null);
}

export function onPlayersChanged(puzzleId, callback) {
  const r = ref(_db, `puzzles/${puzzleId}/players`);
  const handler = snap => callback(snap.val() || {});
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/** Set startedAt only if not already set. */
export async function setStartedAt(puzzleId) {
  const db = await _dbReady;
  const r = ref(db, `puzzles/${puzzleId}/meta/startedAt`);
  const snap = await get(r);
  if (!snap.exists()) await set(r, Date.now());
  return (await get(r)).val();
}

/**
 * Subscribe to all piece changes for a puzzle.
 * @param {(pieceIndex: number, data: object) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function onPiecesChanged(puzzleId, callback) {
  const piecesRef = ref(_db, `puzzles/${puzzleId}/pieces`);
  const handler = (snap) => callback(Number(snap.key), snap.val());
  onChildChanged(piecesRef, handler);
  return () => off(piecesRef, 'child_changed', handler);
}

// ── Puzzle of the Day ─────────────────────────────────────────────────────────

/** Fetch today's POTD entry for a difficulty (one-time read). */
export async function getPOTD(difficulty) {
  const db = await _dbReady;
  const snap = await get(ref(db, `potd/${difficulty}`));
  return snap.val();
}

/** Subscribe to POTD leaderboard for a difficulty, filtered to today's date. */
export function onPOTDLeaderboard(difficulty, date, callback) {
  let detach = null;
  let cancelled = false;
  _dbReady.then((db) => {
    if (cancelled) return;
    const r = ref(db, `potd/${difficulty}/leaderboard`);
    const handler = (snap) => {
      const all   = snap.val() || {};
      const today = Object.fromEntries(Object.entries(all).filter(([, v]) => v.date === date));
      callback(today);
    };
    onValue(r, handler);
    detach = () => off(r, 'value', handler);
  });
  return () => {
    cancelled = true;
    if (detach) detach();
  };
}

/** Cover image URL stored on a puzzle (e.g. POTD template). */
export async function getPuzzleImageUrl(puzzleId) {
  const db = await _dbReady;
  const snap = await get(ref(db, `puzzles/${puzzleId}/meta/imageUrl`));
  return snap.val() || null;
}

/** Send a chat message (or emoji reaction) to a puzzle's chat. */
export function sendChatMessage(puzzleId, msg) {
  return push(ref(_db, `chat/${puzzleId}`), msg);
}

/** Subscribe to chat messages. Calls callback for each new message. Returns unsubscribe fn. */
export function onChatMessages(puzzleId, callback) {
  const r = ref(_db, `chat/${puzzleId}`);
  const handler = snap => { if (snap.val()) callback(snap.val()); };
  onChildAdded(r, handler);
  return () => off(r, 'child_added', handler);
}

// ── Public Rooms Index ────────────────────────────────────────────────────────

export function onRoomsIndex(callback) {
  let detach = null;
  let cancelled = false;
  _dbReady.then((db) => {
    if (cancelled) return;
    const r = ref(db, 'rooms-index');
    const handler = snap => callback(snap.val() || {});
    onValue(r, handler);
    detach = () => off(r, 'value', handler);
  });
  return () => {
    cancelled = true;
    if (detach) detach();
  };
}

export function updateRoomsIndex(roomId, fields) {
  return update(ref(_db, `rooms-index/${roomId}`), fields);
}

export function deleteRoomsIndex(roomId) {
  return set(ref(_db, `rooms-index/${roomId}`), null);
}

/** Write a POTD completion score. Keyed by puzzleId so each game is one entry. */
export function recordPOTDScore(puzzleId, difficulty, names, secs) {
  const date = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Athens' });
  return set(ref(_db, `potd/${difficulty}/leaderboard/${puzzleId}`), { names, secs, date });
}
