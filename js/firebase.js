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
    piecesObj[i] = { x: p.x, y: p.y, solved: false, lockedBy: null };
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
