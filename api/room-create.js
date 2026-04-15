/**
 * Creates a collaborative puzzle room from a picked image.
 * Generates grid, edges, and scattered pieces server-side.
 * If public=true, also writes a rooms-index entry for the lobby.
 *
 * GET /api/room-create?pieces=100&hard=false&image=URL&w=1200&h=800&public=true
 * Returns: { puzzleId }
 */
import crypto from 'crypto';

const BOARD_W = 1080;
const BOARD_H = 780;
const ALLOWED_PIECES = [24, 100, 250, 500, 1000];

function calculateGrid(pieceCount, imgWidth, imgHeight) {
  const aspect = imgWidth / imgHeight;
  let bestCols = 1, bestRows = pieceCount, bestDiff = Infinity;
  for (let cols = 1; cols <= pieceCount; cols++) {
    const rows = Math.round(pieceCount / cols);
    if (cols * rows === 0) continue;
    const diff = Math.abs(cols / rows - aspect);
    if (diff < bestDiff) { bestDiff = diff; bestCols = cols; bestRows = rows; }
  }
  return { cols: bestCols, rows: bestRows };
}

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

function scatterPieces(count, dispW, dispH, hardMode) {
  const ROTS = [0, 90, 180, 270];
  return Array.from({ length: count }, () => ({
    x:        Math.random() * (BOARD_W - dispW),
    y:        Math.random() * (BOARD_H - dispH),
    rotation: hardMode ? ROTS[Math.floor(Math.random() * 4)] : 0,
  }));
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
  const rawPieces  = parseInt(req.query.pieces, 10);
  const pieceCount = ALLOWED_PIECES.includes(rawPieces) ? rawPieces : 100;
  const hardMode   = req.query.hard === 'true';
  const isPublic   = req.query.public === 'true';
  const imageUrl   = req.query.image;
  const imgW       = parseInt(req.query.w, 10);
  const imgH       = parseInt(req.query.h, 10);

  if (!imageUrl || !imgW || !imgH) {
    return res.status(400).json({ error: 'Missing image, w, or h params' });
  }

  // Basic validation: must be a Cloudinary URL for our cloud
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
  const pieces = scatterPieces(cols * rows, displayW, displayH, hardMode);

  const piecesObj = {};
  pieces.forEach((p, i) => {
    piecesObj[i] = { x: p.x, y: p.y, rotation: p.rotation, solved: false };
  });

  const puzzleId  = crypto.randomUUID();
  const createdAt = Date.now();

  await fbPut(`puzzles/${puzzleId}`, {
    meta: {
      imageUrl, cols, rows, pieceW, pieceH, displayW, displayH,
      edges, hardMode, isPublic, createdAt,
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
