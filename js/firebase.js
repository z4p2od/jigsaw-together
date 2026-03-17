import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
  off,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

// Fetch Firebase config from Vercel serverless function (which reads env vars)
const configRes = await fetch('/api/config');
const firebaseConfig = await configRes.json();

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// Per-piece write throttle: track last write time per piece
const lastWrite = {};

/**
 * Write a new puzzle to Firebase.
 * @param {{ imageData: string, cols: number, rows: number }} meta
 * @param {Array<{ x: number, y: number }>} pieces  initial scattered positions
 * @returns {Promise<string>} puzzleId
 */
export async function createPuzzle(meta, pieces) {
  const puzzleId = crypto.randomUUID();
  const piecesObj = {};
  pieces.forEach((p, i) => {
    piecesObj[i] = { x: p.x, y: p.y, rotation: p.rotation ?? 0, solved: false, lockedBy: null };
  });

  await set(ref(db, `puzzles/${puzzleId}`), {
    meta: { ...meta, createdAt: Date.now() },
    pieces: piecesObj,
  });

  return puzzleId;
}

/**
 * Load puzzle meta + all piece states once.
 * @returns {Promise<{ meta, pieces: object }>}
 */
export async function loadPuzzle(puzzleId) {
  const snap = await get(ref(db, `puzzles/${puzzleId}`));
  if (!snap.exists()) throw new Error('Puzzle not found');
  return snap.val();
}

/**
 * Attempt to lock a piece for a player.
 * Only writes if piece is currently unlocked.
 */
export async function lockPiece(puzzleId, pieceIndex, playerId) {
  const pieceRef = ref(db, `puzzles/${puzzleId}/pieces/${pieceIndex}`);
  const snap = await get(pieceRef);
  const piece = snap.val();
  if (piece.solved || (piece.lockedBy && piece.lockedBy !== playerId)) return false;
  await update(pieceRef, { lockedBy: playerId });
  return true;
}

/** Release a piece lock. */
export function unlockPiece(puzzleId, pieceIndex) {
  return update(ref(db, `puzzles/${puzzleId}/pieces/${pieceIndex}`), { lockedBy: null });
}

/**
 * Throttled position update — max one write per 50ms per piece.
 */
export function updatePiecePosition(puzzleId, pieceIndex, x, y) {
  const now = Date.now();
  if (lastWrite[pieceIndex] && now - lastWrite[pieceIndex] < 50) return;
  lastWrite[pieceIndex] = now;
  update(ref(db, `puzzles/${puzzleId}/pieces/${pieceIndex}`), { x, y });
}

/** Mark a piece as solved at its snapped position and release lock. */
export function solvePiece(puzzleId, pieceIndex, x, y) {
  return update(ref(db, `puzzles/${puzzleId}/pieces/${pieceIndex}`), {
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
  return update(ref(db, `puzzles/${puzzleId}/pieces`), flat);
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
  update(ref(db, `puzzles/${puzzleId}/pieces`), flat);
}

/**
 * Lock multiple pieces for a player (group drag start).
 */
export async function lockGroup(puzzleId, indices, playerId) {
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
  return update(ref(db, `puzzles/${puzzleId}/pieces`), flat);
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
  return update(ref(db, `puzzles/${puzzleId}/pieces`), flat);
}

/** Update the rotation of a single piece. */
export function updatePieceRotation(puzzleId, pieceIndex, rotation) {
  return update(ref(db, `puzzles/${puzzleId}/pieces/${pieceIndex}`), { rotation });
}

/** Batch-update rotation for multiple pieces (group rotate). */
export function updateGroupRotation(puzzleId, indices, rotation) {
  const flat = {};
  indices.forEach(i => { flat[`${i}/rotation`] = rotation; });
  return update(ref(db, `puzzles/${puzzleId}/pieces`), flat);
}

/** Batch-update rotation + positions for a group rotate (single write). */
export function updateGroupRotationAndPositions(puzzleId, positions, rotation) {
  const flat = {};
  positions.forEach(({ index, x, y }) => {
    flat[`${index}/x`]        = x;
    flat[`${index}/y`]        = y;
    flat[`${index}/rotation`] = rotation;
  });
  return update(ref(db, `puzzles/${puzzleId}/pieces`), flat);
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
  return update(ref(db, `puzzles/${puzzleId}/players/${playerId}`), {
    name,
    color: getPlayerColor(playerId),
    lastSeen: Date.now(),
  });
}

export function removePlayer(puzzleId, playerId) {
  return set(ref(db, `puzzles/${puzzleId}/players/${playerId}`), null);
}

export function onPlayersChanged(puzzleId, callback) {
  const r = ref(db, `puzzles/${puzzleId}/players`);
  const handler = snap => callback(snap.val() || {});
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/** Set startedAt only if not already set. */
export async function setStartedAt(puzzleId) {
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
  const piecesRef = ref(db, `puzzles/${puzzleId}/pieces`);
  const handler = (snap) => {
    const pieces = snap.val();
    if (!pieces) return;
    Object.entries(pieces).forEach(([index, data]) => {
      callback(Number(index), data);
    });
  };
  onValue(piecesRef, handler);
  return () => off(piecesRef, 'value', handler);
}
