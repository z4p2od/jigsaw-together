/**
 * Vercel cron job — creates today's Puzzle of the Day from the admin catalog
 * (random entry, using that puzzle's piece count and rotation). If the catalog
 * is empty, falls back to a 100-piece upright puzzle from potd-pool / puzzle-library.
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
import { scatterPieces } from '../js/scatter-pieces.js';
import { calculateGrid, resolveGrid } from '../js/puzzle-grid.js';

const BOARD_W = 1080;
const BOARD_H = 780;

// ── Pure puzzle logic (duplicated from jigsaw.js — no DOM) ───────────

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

async function listImagesFromFolder(folder) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const auth = Buffer.from(`${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`).toString('base64');

  function isFolderResource(r) {
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

  return resources.filter(isFolderResource);
}

async function listPOTDImages() {
  const potdImages = await listImagesFromFolder('potd-pool');
  if (potdImages.length > 0) return { images: potdImages, sourceFolder: 'potd-pool' };

  const libraryImages = await listImagesFromFolder('puzzle-library');
  if (libraryImages.length > 0) return { images: libraryImages, sourceFolder: 'puzzle-library' };

  return { images: [], sourceFolder: null };
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
  const recentIds = (await fbGet('potd/recentIds')) || [];

  const catalog = (await fbGet('catalog')) || {};
  const catalogEntries = Object.entries(catalog)
    .map(([id, entry]) => ({ id, ...entry }))
    .filter((e) => e.imageUrl && e.width && e.height && (e.cols || e.pieces));

  let imageUrl;
  let imagePublicId = null;
  let imgW;
  let imgH;
  let pieceCount;
  let hardMode;
  let catalogId = null;
  let sourceFolder = 'catalog';
  let catalogEntry = null;
  let usedRecentId;

  if (catalogEntries.length) {
    const fresh = catalogEntries.filter((e) => !recentIds.includes(e.id));
    const pool = fresh.length ? fresh : catalogEntries;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    imageUrl = picked.imageUrl;
    imagePublicId = picked.publicId || null;
    imgW = Number(picked.width);
    imgH = Number(picked.height);
    pieceCount = Number(picked.pieces) || Number(picked.cols) * Number(picked.rows);
    hardMode = !!picked.hardMode;
    catalogId = picked.id;
    catalogEntry = picked;
    usedRecentId = picked.id;
  } else {
    const listed = await listPOTDImages();
    if (!listed.images.length) {
      return res.status(500).json({ error: 'Catalog is empty and no library images were found' });
    }
    sourceFolder = listed.sourceFolder;
    const fresh = listed.images.filter((img) => !recentIds.includes(img.public_id));
    const pool = fresh.length ? fresh : listed.images;
    const image = pool[Math.floor(Math.random() * pool.length)];
    imageUrl = image.secure_url;
    imagePublicId = image.public_id;
    imgW = image.width;
    imgH = image.height;
    pieceCount = 100;
    hardMode = false;
    usedRecentId = image.public_id;
  }

  const { cols, rows } = catalogEntry
    ? resolveGrid({ ...catalogEntry, width: imgW, height: imgH })
    : calculateGrid(pieceCount, imgW, imgH);
  const actualCount = cols * rows;
  const pieceW = Math.floor(imgW / cols);
  const pieceH = Math.floor(imgH / rows);
  const scale = Math.min((BOARD_W * 0.55) / imgW, (BOARD_H * 0.55) / imgH, 1);
  const displayW = Math.floor(pieceW * scale);
  const displayH = Math.floor(pieceH * scale);
  const edges = generateEdges(cols, rows);
  const pieces = scatterPieces({
    count: actualCount,
    dispW: displayW,
    dispH: displayH,
    hardMode,
    boardW: BOARD_W,
    boardH: BOARD_H,
  });

  const puzzleId = crypto.randomUUID();
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

  const meta = {
    imageUrl,
    imagePublicId,
    cols, rows, pieceW, pieceH, displayW, displayH,
    edges,
    hardMode,
    isPOTD: true,
    potdDifficulty: 'daily',
    catalogId,
    createdAt: Date.now(),
  };

  await fbPut(`puzzles/${puzzleId}`, { meta, pieces: piecesObj });
  await fbPatch('potd/daily', {
    puzzleId,
    date,
    imageUrl,
    pieces: actualCount,
    cols,
    rows,
    hardMode,
    catalogId,
  });

  const newRecent = [usedRecentId, ...recentIds].slice(0, 30);
  await fbPut('potd/recentIds', newRecent);

  res.json({
    date,
    sourceFolder,
    created: [{ difficulty: 'daily', puzzleId, pieces: actualCount, hardMode, catalogId }],
  });
}
