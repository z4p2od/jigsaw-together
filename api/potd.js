/**
 * Vercel cron job — creates three Puzzle of the Day puzzles (Easy/Medium/Hard).
 * Images are picked randomly from the 'potd-pool' folder in Cloudinary.
 * Schedule: daily at 4am UTC (configured in vercel.json).
 *
 * Required env vars:
 *   FIREBASE_DB_URL        — Firebase Realtime Database URL
 *   FIREBASE_DB_SECRET     — legacy Firebase database secret
 *   CLOUDINARY_CLOUD_NAME  — Cloudinary cloud name
 *   CLOUDINARY_API_KEY     — Cloudinary API key
 *   CLOUDINARY_API_SECRET  — Cloudinary API secret
 *   POTD_SECRET            — Bearer token for this endpoint
 */
import crypto from 'crypto';

const BOARD_W = 900;
const BOARD_H = 650;

const DIFFICULTIES = [
  { key: 'easy',   pieceCount: 25,  hardMode: false },
  { key: 'medium', pieceCount: 100, hardMode: false },
  { key: 'hard',   pieceCount: 100, hardMode: true  },
];

// ── Pure puzzle logic (duplicated from app.js / jigsaw.js — no DOM) ───────────

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

function scatterPieces(count, dispW, dispH, hardMode) {
  const ROTS = [0, 90, 180, 270];
  return Array.from({ length: count }, () => ({
    x:        Math.random() * (BOARD_W - dispW),
    y:        Math.random() * (BOARD_H - dispH),
    rotation: hardMode ? ROTS[Math.floor(Math.random() * 4)] : 0,
  }));
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

// ── Cloudinary helpers ────────────────────────────────────────────────────────

async function listPOTDImages() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const auth = Buffer.from(`${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`).toString('base64');
  const folder = 'potd-pool';

  function isPOTDResource(r) {
    if (!r) return false;
    const norm = s => String(s ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
    const af = norm(r.asset_folder);
    if (af) return af === folder || af.startsWith(folder + '/');
    const f  = norm(r.folder);
    if (f)  return f  === folder || f.startsWith(folder + '/');
    const id = String(r.public_id ?? '');
    if (id) return id === folder || id.startsWith(folder + '/');
    const url = String(r.secure_url ?? '');
    return url.includes('/' + folder + '/') || url.includes('/' + folder);
  }

  let resources = [];
  try {
    // Admin Search API — reliable folder filtering
    const resp = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/resources/search`,
      {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expression: `resource_type:image AND (asset_folder="${folder}" OR asset_folder:${folder}/*)`, max_results: 500 }),
      }
    );
    const text = await resp.text().catch(() => '');
    if (!resp.ok) throw new Error(`search failed: ${resp.status} ${text}`);
    const data = JSON.parse(text);
    resources = Array.isArray(data?.resources) ? data.resources : [];
  } catch {
    // Fallback to legacy prefix listing
    try {
      const resp = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?prefix=${encodeURIComponent(folder + '/')}&max_results=500`,
        { headers: { Authorization: `Basic ${auth}` } }
      );
      const text = await resp.text().catch(() => '');
      const data = JSON.parse(text);
      resources = Array.isArray(data?.resources) ? data.resources : [];
    } catch {
      return [];
    }
  }

  return resources.filter(isPOTDResource);
}

// ── Firebase REST helpers ─────────────────────────────────────────────────────

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

function fbPatch(path, value) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  return fetch(`${url}/${path}.json?auth=${s}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const token = (req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
  const validTokens = [process.env.POTD_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!validTokens.length || !validTokens.includes(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const date = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Athens' });

  // List available images
  const images = await listPOTDImages();
  if (images.length === 0) {
    return res.status(500).json({ error: 'No images in potd-pool folder' });
  }

  // Load recent IDs to avoid repeats
  const recentIds = (await fbGet('potd/recentIds')) || [];

  // Pick 3 distinct images (one per difficulty), avoiding recent ones
  const fresh = images.filter(img => !recentIds.includes(img.public_id));
  const pool  = fresh.length >= 3 ? fresh : images; // fallback if pool nearly exhausted

  function pickRandom(exclude = []) {
    const available = pool.filter(img => !exclude.includes(img.public_id));
    const src = available.length > 0 ? available : pool;
    return src[Math.floor(Math.random() * src.length)];
  }

  const created = [];
  const usedIds = [];

  for (const diff of DIFFICULTIES) {
    const image = pickRandom(usedIds);
    usedIds.push(image.public_id);

    const imgW = image.width;
    const imgH = image.height;

    const { cols, rows } = calculateGrid(diff.pieceCount, imgW, imgH);
    const actualCount    = cols * rows;

    const pieceW = Math.floor(imgW / cols);
    const pieceH = Math.floor(imgH / rows);
    const scale  = Math.min((BOARD_W * 0.55) / imgW, (BOARD_H * 0.55) / imgH, 1);
    const displayW = Math.floor(pieceW * scale);
    const displayH = Math.floor(pieceH * scale);

    const edges  = generateEdges(cols, rows);
    const pieces = scatterPieces(actualCount, displayW, displayH, diff.hardMode);

    const puzzleId   = crypto.randomUUID();
    const piecesObj  = {};
    pieces.forEach((p, i) => {
      piecesObj[i] = { x: p.x, y: p.y, rotation: p.rotation, solved: false };
    });

    const meta = {
      imageUrl:       image.secure_url,
      imagePublicId:  image.public_id,
      cols, rows, pieceW, pieceH, displayW, displayH,
      edges,
      hardMode:       diff.hardMode,
      isPOTD:         true,
      potdDifficulty: diff.key,
      createdAt:      Date.now(),
    };

    // Write puzzle to Firebase
    await fbPut(`puzzles/${puzzleId}`, { meta, pieces: piecesObj });

    // Update potd/{difficulty} pointer
    await fbPatch(`potd/${diff.key}`, { puzzleId, date });

    created.push({ difficulty: diff.key, puzzleId, pieces: actualCount });
  }

  // Update recent IDs (keep last 30)
  const newRecent = [...usedIds, ...recentIds].slice(0, 30);
  await fbPut('potd/recentIds', newRecent);

  res.json({ date, created });
}
