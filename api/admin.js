/**
 * Admin catalog + signed Cloudinary upload.
 *
 * Auth: Authorization: Bearer <ADMIN_TOKEN or FEEDBACK_ADMIN_TOKEN>
 *
 * GET  ?action=sign     — Cloudinary signed-upload params (folder puzzle-library)
 * GET  ?action=catalog  — full catalog entries
 * POST ?action=catalog  — create/update { imageUrl, publicId, width, height, pieces, hardMode }
 * DELETE ?action=catalog&id= — remove a catalog entry
 */
import crypto from 'crypto';
import { ALLOWED_PIECES } from '../js/puzzle-grid.js';

const LIBRARY_FOLDER = 'puzzle-library';

function requireAdmin(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return false;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return false;
  const valid = [process.env.ADMIN_TOKEN, process.env.FEEDBACK_ADMIN_TOKEN].filter(Boolean);
  return valid.includes(token);
}

function fbUrl(path) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  if (!url || !s) throw new Error('Firebase not configured');
  return `${url}/${path}.json?auth=${s}`;
}

async function fbGet(path) {
  const r = await fetch(fbUrl(path));
  return r.json();
}

function fbPut(path, value) {
  return fetch(fbUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

function expectedCloudinaryHost() {
  return `res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}`;
}

function signUpload() {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = LIBRARY_FOLDER;
  const toSign = `folder=${folder}&timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    signature,
  };
}

async function listCatalog(_req, res) {
  const raw = (await fbGet('catalog')) || {};
  const puzzles = Object.entries(raw).map(([id, entry]) => ({ id, ...entry }));
  puzzles.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return res.status(200).json({ puzzles });
}

async function saveCatalog(req, res) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const pieces = parseInt(body.pieces, 10);
  if (!ALLOWED_PIECES.includes(pieces)) {
    return res.status(400).json({ error: `pieces must be one of ${ALLOWED_PIECES.join(', ')}` });
  }
  const imageUrl = String(body.imageUrl || '');
  const width = parseInt(body.width, 10);
  const height = parseInt(body.height, 10);
  if (!imageUrl || !width || !height) {
    return res.status(400).json({ error: 'Missing imageUrl, width, or height' });
  }
  if (!imageUrl.includes(expectedCloudinaryHost())) {
    return res.status(400).json({ error: 'Image must be on this Cloudinary cloud' });
  }

  const id = String(body.id || crypto.randomUUID());
  const entry = {
    imageUrl,
    publicId: body.publicId || null,
    width,
    height,
    pieces,
    hardMode: body.hardMode === true || body.hardMode === 'true',
    createdAt: body.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await fbPut(`catalog/${id}`, entry);
  return res.status(200).json({ id, ...entry });
}

async function deleteCatalog(req, res) {
  const id = String(req.query.id || '');
  if (!id || id.includes('/')) return res.status(400).json({ error: 'Missing id' });
  await fbPut(`catalog/${id}`, null);
  return res.status(200).json({ deleted: id });
}

export default async function handler(req, res) {
  if (!requireAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const action = String(req.query.action || '');

  try {
    if (action === 'sign' && req.method === 'GET') {
      if (!process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_API_KEY) {
        return res.status(500).json({ error: 'Cloudinary is not configured' });
      }
      return res.status(200).json(signUpload());
    }
    if (action === 'catalog' && req.method === 'GET') return listCatalog(req, res);
    if (action === 'catalog' && req.method === 'POST') return saveCatalog(req, res);
    if (action === 'catalog' && req.method === 'DELETE') return deleteCatalog(req, res);
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('admin', err);
    return res.status(500).json({ error: err.message || 'Admin request failed' });
  }
}
