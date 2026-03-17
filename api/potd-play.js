/**
 * Creates a fresh clone of a POTD puzzle for the requesting player.
 * Each player (or team) gets their own puzzle instance so scores are independent.
 * The clone shares the same image/grid/edges as the template but has freshly
 * scattered pieces and a new puzzleId.
 *
 * GET /api/potd-play?difficulty=easy|medium|hard
 * Redirects to /puzzle.html?id=<newPuzzleId>
 */
import crypto from 'crypto';

const BOARD_W = 900;
const BOARD_H = 650;

function scatterPieces(count, dispW, dispH, hardMode) {
  const ROTS = [0, 90, 180, 270];
  return Array.from({ length: count }, () => ({
    x:        Math.random() * (BOARD_W - dispW),
    y:        Math.random() * (BOARD_H - dispH),
    rotation: hardMode ? ROTS[Math.floor(Math.random() * 4)] : 0,
  }));
}

function fbGet(path) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  return fetch(`${url}/${path}.json?auth=${s}`).then(r => r.json());
}

function fbPut(path, value) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  return fetch(`${url}/${path}.json?auth=${s}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

export default async function handler(req, res) {
  const difficulty = req.query.difficulty;
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    return res.status(400).json({ error: 'Invalid difficulty' });
  }

  const today = new Date().toISOString().split('T')[0];

  // Load the POTD template for this difficulty
  const potd = await fbGet(`potd/${difficulty}`);
  if (!potd || potd.date !== today) {
    return res.status(404).json({ error: 'No puzzle of the day available' });
  }

  // Load the template puzzle meta
  const templateMeta = await fbGet(`puzzles/${potd.puzzleId}/meta`);
  if (!templateMeta) {
    return res.status(404).json({ error: 'Template puzzle not found' });
  }

  // Create a fresh clone with new scattered pieces
  const count  = templateMeta.cols * templateMeta.rows;
  const pieces = scatterPieces(count, templateMeta.displayW, templateMeta.displayH, templateMeta.hardMode);

  const piecesObj = {};
  pieces.forEach((p, i) => {
    piecesObj[i] = { x: p.x, y: p.y, rotation: p.rotation, solved: false };
  });

  const { startedAt: _drop, ...templateMetaClean } = templateMeta;
  const newMeta = {
    ...templateMetaClean,
    isPOTD:         true,
    potdDifficulty: difficulty,
    createdAt:      Date.now(),
  };

  const puzzleId = crypto.randomUUID();
  await fbPut(`puzzles/${puzzleId}`, { meta: newMeta, pieces: piecesObj });

  res.redirect(302, `/puzzle.html?id=${puzzleId}`);
}
