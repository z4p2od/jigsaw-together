/**
 * Creates a collaborative puzzle room from a catalogued puzzle (fixed difficulty)
 * or from explicit image + piece params.
 *
 * GET /api/room-create?catalog=ID&public=true
 * GET /api/room-create?pieces=100&hard=false&image=URL&w=1200&h=800&public=true
 * Returns: { puzzleId }
 */
import crypto from 'crypto';
import { scatterPieces } from '../js/scatter-pieces.js';
import { ALLOWED_PIECES, calculateGrid } from '../js/puzzle-grid.js';

const BOARD_W = 1080;
const BOARD_H = 780;

function generateEdges(cols, rows) {
  let nextId = 1;
  const hEdges = Array.from({ length: rows + 1 }, (_, r) =>
    Array.from({ length: cols }, () =>
      r === 0 || r === rows
        ? { dir: 0, seed: 0, id: 0 }
        : { dir: Math.random() < 0.5 ? 1 : -1, seed: Math.random(), id: nextId++ }
    )
  );
  const vEdges = Array.from({ length: rows }, () =>
    Array.from({ length: cols + 1 }, (_, c) =>
      c === 0 || c === cols
        ? { dir: 0, seed: 0, id: 0 }
        : { dir: Math.random() < 0.5 ? 1 : -1, seed: Math.random(), id: nextId++ }
    )
  );
  const edges = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = hEdges[row][col], b = hEdges[row + 1][col];
      const l = vEdges[row][col], r = vEdges[row][col + 1];
      edges.push({
        top: -t.dir, bottom: b.dir, left: -l.dir, right: r.dir,
        seedTop: t.seed, seedBottom: b.seed, seedLeft: l.seed, seedRight: r.seed,
        idTop: t.id, idBottom: b.id, idLeft: l.id, idRight: r.id,
      });
    }
  }
  return edges;
}

function fbGet(path) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  return fetch(`${url}/${path}.json?auth=${s}`).then((r) => r.json());
}

function fbPut(path, value) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  return fetch(`${url}/${path}.json?auth=${s}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

function fbPatch(path, value) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  return fetch(`${url}/${path}.json?auth=${s}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

export default async function handler(req, res) {
  const isPublic = req.query.public === 'true';
  const catalogId = String(req.query.catalog || '').trim();

  let imageUrl;
  let imgW;
  let imgH;
  let pieceCount;
  let hardMode;

  if (catalogId) {
    const entry = await fbGet(`catalog/${catalogId}`);
    if (!entry?.imageUrl || !entry.width || !entry.height || !entry.pieces) {
      return res.status(404).json({ error: 'Catalog puzzle not found' });
    }
    imageUrl = entry.imageUrl;
    imgW = Number(entry.width);
    imgH = Number(entry.height);
    pieceCount = Number(entry.pieces);
    hardMode = !!entry.hardMode;
  } else {
    const rawPieces = parseInt(req.query.pieces, 10);
    pieceCount = ALLOWED_PIECES.includes(rawPieces) ? rawPieces : 100;
    hardMode = req.query.hard === 'true';
    imageUrl = req.query.image;
    imgW = parseInt(req.query.w, 10);
    imgH = parseInt(req.query.h, 10);
    if (!imageUrl || !imgW || !imgH) {
      return res.status(400).json({ error: 'Missing catalog, or image/w/h params' });
    }
  }

  const expectedHost = `res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}`;
  if (!imageUrl.includes(expectedHost)) {
    return res.status(400).json({ error: 'Invalid image URL' });
  }

  const { cols, rows } = calculateGrid(pieceCount, imgW, imgH);
  const pieceW   = Math.floor(imgW / cols);
  const pieceH   = Math.floor(imgH / rows);
  const scale    = Math.min((BOARD_W * 0.55) / imgW, (BOARD_H * 0.55) / imgH, 1);
  const displayW = Math.floor(pieceW * scale);
  const displayH = Math.floor(pieceH * scale);

  const edges  = generateEdges(cols, rows);
  const pieces = scatterPieces({
    count: cols * rows,
    dispW: displayW,
    dispH: displayH,
    hardMode,
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

  const puzzleId  = crypto.randomUUID();
  const createdAt = Date.now();

  await fbPut(`puzzles/${puzzleId}`, {
    meta: {
      imageUrl, cols, rows, pieceW, pieceH, displayW, displayH,
      edges, hardMode, isPublic, createdAt,
      catalogId: catalogId || null,
    },
    pieces: piecesObj,
  });

  if (isPublic) {
    await fbPatch(`rooms-index/${puzzleId}`, {
      imageUrl,
      pieces:      cols * rows,
      hardMode,
      status:      'active',
      createdAt,
      creatorName: null,
      playerCount: 0,
      solvedCount: 0,
    });
  }

  res.json({ puzzleId });
}
