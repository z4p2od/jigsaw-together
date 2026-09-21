/**
 * Creates a fresh clone of today's POTD for the requesting player.
 *
 * GET /api/potd-play?json=1  → { puzzleId }
 * Redirects to /?id=<newPuzzleId>
 */
import crypto from 'crypto';
import { scatterPieces } from '../js/scatter-pieces.js';

const BOARD_W = 1080;
const BOARD_H = 780;

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
  const today = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Athens' });

  let potd = await fbGet('potd/daily');
  if (!potd?.puzzleId || potd.date !== today) {
    potd = await fbGet('potd/easy');
  }
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
  const pieces = scatterPieces({
    count,
    dispW: templateMeta.displayW,
    dispH: templateMeta.displayH,
    hardMode: templateMeta.hardMode,
    boardW: BOARD_W,
    boardH: BOARD_H,
  });

  const piecesObj = {};
  pieces.forEach((p, i) => {
    piecesObj[i] = {
      x: p.x,
      y: p.y,
      rotation: p.rotation,
      faceDown: !!p.faceDown,
      solved: false,
    };
  });

  const { startedAt: _drop, ...templateMetaClean } = templateMeta;
  const newMeta = {
    ...templateMetaClean,
    isPOTD:         true,
    potdDifficulty: 'daily',
    createdAt:      Date.now(),
  };

  const puzzleId = crypto.randomUUID();
  await fbPut(`puzzles/${puzzleId}`, { meta: newMeta, pieces: piecesObj });

  if (req.query.json === '1' || req.query.format === 'json') {
    return res.status(200).json({ puzzleId });
  }

  res.redirect(302, `/?id=${puzzleId}`);
}
