/**
 * Creates a VS mode room — two players race the same puzzle.
 * Picks a random image from the POTD pool, generates shared grid/edges,
 * and writes the room to Firebase. Piece positions are generated client-side
 * from the seed to avoid writing 200 pieces server-side.
 *
 * GET /api/vs-create
 * Redirects to /vs.html?room={roomId}
 */
import crypto from 'crypto';

const BOARD_W = 900;
const BOARD_H = 650;
const ALLOWED_PIECES = [4, 24, 40, 100, 250, 500, 1000];

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

async function listPoolImages() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return [];

  // Vercel may treat this handler as CommonJS internally; using a dynamic import
  // avoids ERR_REQUIRE_ESM when loading our `.mjs` helper.
  let filterResourcesByFolder = (resources) => Array.isArray(resources) ? resources : [];
  try {
    const mod = await import('./cloudinary-folder-utils.mjs');
    filterResourcesByFolder = mod?.filterResourcesByFolder || filterResourcesByFolder;
  } catch {
    // If the helper fails to load, just skip folder filtering.
  }

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  const r = await fetch(
    // Cloudinary Admin API scopes "resources/image" listing by "prefix"
    `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?prefix=${encodeURIComponent('puzzle-library')}&max_results=500`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  // Cloudinary sometimes returns non-JSON bodies for auth/rate-limit errors.
  // Avoid throwing on JSON parse here; treat it as "no images".
  const text = await r.text().catch(() => '');
  try {
    const data = JSON.parse(text);
    const resources = data?.resources || [];
    return filterResourcesByFolder(resources, 'puzzle-library');
  } catch {
    return [];
  }
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
  try {
    const query = req.query || {};
    const rawPieces = parseInt(query.pieces, 10);
    const PIECE_COUNT = ALLOWED_PIECES.includes(rawPieces) ? rawPieces : 100;
    const chaosMode = query.chaos === 'true';
    const hardMode = !chaosMode && query.hard === 'true';

    const images = await listPoolImages();
    if (images.length === 0) return res.status(500).json({ error: 'No images available' });

    const image = images[Math.floor(Math.random() * images.length)];
    const imgW = Number(image?.width) || 1000;
    const imgH = Number(image?.height) || 800;

    const { cols, rows } = calculateGrid(PIECE_COUNT, imgW, imgH);
    const pieceW = Math.floor(imgW / cols);
    const pieceH = Math.floor(imgH / rows);
    const scale = Math.min((BOARD_W * 0.55) / imgW, (BOARD_H * 0.55) / imgH, 1);
    const displayW = Math.floor(pieceW * scale);
    const displayH = Math.floor(pieceH * scale);

    const edges = generateEdges(cols, rows);
    const seed = (Math.random() * 1e9) | 0; // shared scatter seed
    const roomId = crypto.randomUUID();

    const createdAt = Date.now();

    await fbPut(`vs/${roomId}`, {
      meta: {
        imageUrl: image?.secure_url || null,
        cols,
        rows,
        pieceW,
        pieceH,
        displayW,
        displayH,
        edges,
        seed,
        pieces: PIECE_COUNT,
        hardMode,
        chaosMode,
        status: 'waiting',
        winner: null,
        winnerSecs: null,
        createdAt,
      },
      players: {},
      pieces: {},
    });

    // Write a lightweight index entry for the open rooms browser
    await fbPatch(`vs-index/${roomId}`, {
      pieces: PIECE_COUNT,
      hardMode,
      chaosMode,
      status: 'waiting',
      createdAt,
      creatorName: null,
    });

    if (query.json === '1') {
      return res.json({ roomId });
    }
    res.redirect(302, `/vs.html?room=${roomId}`);
  } catch (err) {
    console.error('vs-create failed', err);
    return res.status(500).json({ error: 'Failed to create VS room' });
  }
}
