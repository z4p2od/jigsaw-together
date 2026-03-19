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
    piecesObj[i] = { x: p.x, y: p.y, rotation: p.rotation ?? 0, solved: false };
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
  const handler = (snap) => callback(Number(snap.key), snap.val());
  onChildChanged(piecesRef, handler);
  return () => off(piecesRef, 'child_changed', handler);
}

// ── Puzzle of the Day ─────────────────────────────────────────────────────────

/** Fetch today's POTD entry for a difficulty (one-time read). */
export async function getPOTD(difficulty) {
  const snap = await get(ref(db, `potd/${difficulty}`));
  return snap.val();
}

/** Subscribe to POTD leaderboard for a difficulty, filtered to today's date. */
export function onPOTDLeaderboard(difficulty, date, callback) {
  const r = ref(db, `potd/${difficulty}/leaderboard`);
  const handler = snap => {
    const all     = snap.val() || {};
    const today   = Object.fromEntries(Object.entries(all).filter(([, v]) => v.date === date));
    callback(today);
  };
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

/** Send a chat message (or emoji reaction) to a puzzle's chat. */
export function sendChatMessage(puzzleId, msg) {
  return push(ref(db, `chat/${puzzleId}`), msg);
}

/** Subscribe to chat messages. Calls callback for each new message. Returns unsubscribe fn. */
export function onChatMessages(puzzleId, callback) {
  const r = ref(db, `chat/${puzzleId}`);
  const handler = snap => { if (snap.val()) callback(snap.val()); };
  onChildAdded(r, handler);
  return () => off(r, 'child_added', handler);
}

// ── VS Mode ───────────────────────────────────────────────────────────────────

export async function loadVSRoom(roomId) {
  const snap = await get(ref(db, `vs/${roomId}`));
  if (!snap.exists()) throw new Error('Room not found');
  return snap.val();
}

export async function joinVSRoom(roomId, playerId, name, color) {
  await update(ref(db, `vs/${roomId}/players/${playerId}`), { name, color, ready: false, finishedAt: null });
  // Set creatorName in vs-index if not already set (first joiner becomes creator)
  const idxRef = ref(db, `vs-index/${roomId}/creatorName`);
  const snap   = await get(idxRef);
  if (!snap.exists() || snap.val() === null) {
    await set(idxRef, name);
  }
}

export function setVSReady(roomId, playerId) {
  return set(ref(db, `vs/${roomId}/players/${playerId}/ready`), true);
}

export function onVSRoom(roomId, callback) {
  const r = ref(db, `vs/${roomId}`);
  const handler = snap => callback(snap.val());
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

export function initVSPieces(roomId, playerId, pieces) {
  const flat = {};
  pieces.forEach((p, i) => { flat[i] = { x: p.x, y: p.y, rotation: 0, solved: false }; });
  return set(ref(db, `vs/${roomId}/pieces/${playerId}`), flat);
}

export function onVSPieces(roomId, playerId, callback) {
  const r = ref(db, `vs/${roomId}/pieces/${playerId}`);
  const handler = snap => callback(Number(snap.key), snap.val());
  onChildChanged(r, handler);
  return () => off(r, 'child_changed', handler);
}

export function onVSOpponentPieces(roomId, playerId, callback) {
  const r = ref(db, `vs/${roomId}/pieces/${playerId}`);
  const handler = snap => callback(snap.val() || {});
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

let lastVSGroupWrite = 0;
export function updateVSGroupPosition(roomId, playerId, positions) {
  const now = Date.now();
  if (now - lastVSGroupWrite < 50) return;
  lastVSGroupWrite = now;
  const flat = {};
  positions.forEach(({ index, x, y }) => { flat[`${index}/x`] = x; flat[`${index}/y`] = y; });
  update(ref(db, `vs/${roomId}/pieces/${playerId}`), flat);
}

/** Scatter grouped pieces: write new x/y and clear groupId + lockedBy in one batch. */
export function writeVSShufflePositions(roomId, playerId, positions) {
  const flat = {};
  positions.forEach(({ index, x, y }) => {
    flat[`${index}/x`]        = x;
    flat[`${index}/y`]        = y;
    flat[`${index}/groupId`]  = null;
    flat[`${index}/lockedBy`] = null;
  });
  return update(ref(db, `vs/${roomId}/pieces/${playerId}`), flat);
}

export function lockVSGroup(roomId, playerId, indices, lockerId) {
  const flat = {};
  indices.forEach(i => { flat[`${i}/lockedBy`] = lockerId; });
  return update(ref(db, `vs/${roomId}/pieces/${playerId}`), flat);
}

export function unlockVSGroup(roomId, playerId, indices) {
  const flat = {};
  indices.forEach(i => { flat[`${i}/lockedBy`] = null; });
  return update(ref(db, `vs/${roomId}/pieces/${playerId}`), flat);
}

export function writeVSSnap(roomId, playerId, positions, groupId) {
  const flat = {};
  positions.forEach(({ index, x, y }) => {
    flat[`${index}/x`]        = x;
    flat[`${index}/y`]        = y;
    flat[`${index}/lockedBy`] = null;
    flat[`${index}/groupId`]  = groupId;
  });
  return update(ref(db, `vs/${roomId}/pieces/${playerId}`), flat);
}

export function updateVSPieceRotation(roomId, playerId, index, rotation) {
  return update(ref(db, `vs/${roomId}/pieces/${playerId}/${index}`), { rotation });
}

export function updateVSGroupRotationAndPositions(roomId, playerId, positions, rotation) {
  const flat = {};
  positions.forEach(({ index, x, y }) => {
    flat[`${index}/x`] = x; flat[`${index}/y`] = y; flat[`${index}/rotation`] = rotation;
  });
  return update(ref(db, `vs/${roomId}/pieces/${playerId}`), flat);
}

export function solveVSGroup(roomId, playerId, updates) {
  const flat = {};
  Object.entries(updates).forEach(([index, { x, y }]) => {
    flat[`${index}/x`] = x; flat[`${index}/y`] = y;
    flat[`${index}/solved`] = true; flat[`${index}/lockedBy`] = null;
  });
  return update(ref(db, `vs/${roomId}/pieces/${playerId}`), flat);
}

export function offerVSRematch(roomId, playerId) {
  return set(ref(db, `vs/${roomId}/meta/rematchOffers/${playerId}`), true);
}

export function setVSRematch(roomId, newRoomId) {
  return update(ref(db, `vs/${roomId}/meta`), { rematchRoomId: newRoomId });
}

export function setVSPlaying(roomId) {
  update(ref(db, `vs-index/${roomId}`), { status: 'playing' });
  return update(ref(db, `vs/${roomId}/meta`), { status: 'playing', startedAt: Date.now() });
}

export function setVSWinner(roomId, playerId, secs) {
  update(ref(db, `vs-index/${roomId}`), { status: 'done' });
  return update(ref(db, `vs/${roomId}/meta`), { status: 'done', winner: playerId, winnerSecs: secs });
}

// ── VS Index (open rooms browser) ─────────────────────────────────────────────

export function onVSIndex(callback) {
  const r = ref(db, 'vs-index');
  const handler = snap => callback(snap.val() || {});
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

export function updateVSIndex(roomId, fields) {
  return update(ref(db, `vs-index/${roomId}`), fields);
}

export function setVSFinished(roomId, playerId, finishedAt) {
  return set(ref(db, `vs/${roomId}/players/${playerId}/finishedAt`), finishedAt);
}

// ── Public Rooms Index ────────────────────────────────────────────────────────

export function onRoomsIndex(callback) {
  const r = ref(db, 'rooms-index');
  const handler = snap => callback(snap.val() || {});
  onValue(r, handler);
  return () => off(r, 'value', handler);
}

export function updateRoomsIndex(roomId, fields) {
  return update(ref(db, `rooms-index/${roomId}`), fields);
}

export function deleteRoomsIndex(roomId) {
  return set(ref(db, `rooms-index/${roomId}`), null);
}

// ── VS Powerups (Chaos mode) ───────────────────────────────────────────────────

export function writeVSPowerupEarned(roomId, playerId, pieceIndex) {
  return set(ref(db, `vs/${roomId}/powerups/${playerId}/${pieceIndex}`), true);
}

export function writeVSEffect(roomId, targetPlayerId, effect) {
  return push(ref(db, `vs/${roomId}/effects/${targetPlayerId}`), effect);
}

export function onVSEffects(roomId, playerId, callback) {
  const r = ref(db, `vs/${roomId}/effects/${playerId}`);
  const handler = snap => { if (snap.val()) callback(snap.val()); };
  onChildAdded(r, handler);
  return () => off(r, 'child_added', handler);
}

/** Write a POTD completion score. Keyed by puzzleId so each game is one entry. */
export function recordPOTDScore(puzzleId, difficulty, names, secs) {
  const date = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Athens' });
  return set(ref(db, `potd/${difficulty}/leaderboard/${puzzleId}`), { names, secs, date });
}

// ── Landing screen feedback ─────────────────────────────────────────────────
// The auto-fix pipeline that processes feedback relies on consistent IDs
// and required context fields (screen/path). We write the record in two
// steps (POST -> PATCH) so downstream tooling can observe the transition.

function validateLandingFeedbackInput({ message, screen, path }) {
  if (typeof message !== 'string' || message.trim().length < 3) {
    throw new Error('Feedback message must be at least 3 characters.');
  }
  if (typeof screen !== 'string' || screen.trim().length === 0) {
    throw new Error('Feedback screen is required.');
  }
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new Error('Feedback path is required.');
  }
}

/**
 * Submit landing feedback to Firebase.
 * Performs a two-step write:
 *  1) set() (creates the child key / POST)
 *  2) update() (adds status fields / PATCH)
 *
 * @param {{ message: string, path?: string, screen?: string, extra?: object }} input
 * @returns {Promise<string>} feedbackId (Firebase child key)
 */
export async function submitLandingFeedback({ message, path = '/', screen = 'landing', extra = null } = {}) {
  validateLandingFeedbackInput({ message, screen, path });

  const now = Date.now();
  // Generate a stable "feedbackId" (the id used by downstream tooling / doc
  // filenames) separately from the Firebase child key used for the record.
  // This matches the observed flow: POST /feedback.json (child key),
  // PATCH /feedback/<childKey>.json (same record), while doc naming uses
  // the stable feedbackId stored in the record.
  const feedbackIdRef = push(ref(db, 'feedback-id-temp'));
  const feedbackId = feedbackIdRef.key;

  const feedbackRef = push(ref(db, 'feedback'));
  const feedbackChildKey = feedbackRef.key;

  if (!feedbackId) throw new Error('Failed to generate stable feedback id.');
  if (!feedbackChildKey) throw new Error('Failed to generate feedback record key.');

  const trimmedMessage = message.trim();
  // Write the record first so clients/bots observing /feedback can see it.
  await set(feedbackRef, {
    // Stable identifiers used by downstream automation (doc filenames, etc).
    id: feedbackId,
    feedbackId,
    feedbackChildKey,

    // Required context for routing/triage.
    screen,
    path,

    // Payload.
    message: trimmedMessage,
    extra,

    createdAt: now,
    status: 'received',
    updatedAt: now,
  });

  // Patch status fields in a second write (matches POST -> PATCH tooling flow).
  await update(feedbackRef, {
    status: 'submitted',
    submittedAt: now,
  });

  return feedbackId;
}
