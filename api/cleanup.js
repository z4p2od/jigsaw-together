/**
 * Vercel cron job — removes puzzle *sessions* (Firebase RTDB) older than 24 hours.
 *
 * Cloudinary: only destroys images that live under the user-upload folder (default
 * `puzzles`). Library picks (`/api/room-create`), POTD templates, and POTD clones
 * all reference shared assets under `puzzle-library` / `potd-pool` (or have no
 * `imagePublicId`) — those are never destroyed here.
 *
 * Optional env: CLOUDINARY_USER_UPLOAD_FOLDER — must match the folder on your
 * unsigned upload preset (default: puzzles).
 *
 * Schedule: daily at 3am UTC (configured in vercel.json).
 *
 * Required env vars:
 *   FIREBASE_DB_URL        — e.g. https://your-project-default-rtdb.firebaseio.com
 *   FIREBASE_DB_SECRET     — legacy database secret
 *   CLEANUP_SECRET         — Bearer token (Vercel sends automatically for cron routes)
 *   CLOUDINARY_CLOUD_NAME  — your Cloudinary cloud name
 *   CLOUDINARY_API_KEY     — Cloudinary API key
 *   CLOUDINARY_API_SECRET  — Cloudinary API secret
 */
import crypto from 'crypto';

function normalizeFolder(s) {
  return String(s ?? '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/** Only these Cloudinary paths may be destroyed (ephemeral user uploads). */
function userUploadFolderRoots() {
  const raw = process.env.CLOUDINARY_USER_UPLOAD_FOLDER || 'puzzles';
  return raw
    .split(',')
    .map(normalizeFolder)
    .filter(Boolean);
}

function isUserUploadCloudinaryPublicId(publicId) {
  const id = normalizeFolder(publicId);
  if (!id) return false;
  return userUploadFolderRoots().some(
    (root) => id === root || id.startsWith(`${root}/`)
  );
}

async function deleteCloudinaryImage(publicId) {
  if (!isUserUploadCloudinaryPublicId(publicId)) return;

  const ts  = Math.floor(Date.now() / 1000);
  const sig = crypto.createHash('sha1')
    .update(`public_id=${publicId}&timestamp=${ts}${process.env.CLOUDINARY_API_SECRET}`)
    .digest('hex');
  await fetch(`https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/destroy`, {
    method: 'POST',
    body: new URLSearchParams({
      public_id: publicId,
      timestamp: ts,
      signature: sig,
      api_key:   process.env.CLOUDINARY_API_KEY,
    }),
  });
}

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET || process.env.CLEANUP_SECRET;
  if (req.headers['authorization'] !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dbUrl  = process.env.FIREBASE_DB_URL;
  const secret = process.env.FIREBASE_DB_SECRET;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

  // Fetch puzzle IDs only (shallow=true skips pieces/image data)
  const listRes   = await fetch(`${dbUrl}/puzzles.json?shallow=true&auth=${secret}`);
  const puzzleIds = await listRes.json();
  if (!puzzleIds) return res.json({ deleted: 0 });

  let deleted = 0;
  await Promise.all(Object.keys(puzzleIds).map(async (id) => {
    const metaRes   = await fetch(`${dbUrl}/puzzles/${id}/meta/createdAt.json?auth=${secret}`);
    const createdAt = await metaRes.json();
    if (!createdAt || createdAt >= cutoff) return;

    const pidRes   = await fetch(`${dbUrl}/puzzles/${id}/meta/imagePublicId.json?auth=${secret}`);
    const publicId = await pidRes.json();
    if (publicId) {
      try { await deleteCloudinaryImage(publicId); } catch {}
    }

    await fetch(`${dbUrl}/puzzles/${id}.json?auth=${secret}`, { method: 'DELETE' });
    await fetch(`${dbUrl}/rooms-index/${id}.json?auth=${secret}`, { method: 'DELETE' });
    deleted++;
  }));

  // Also clean up VS rooms + index entries older than 24h
  const vsListRes = await fetch(`${dbUrl}/vs.json?shallow=true&auth=${secret}`);
  const vsRoomIds = await vsListRes.json();
  let vsDeleted = 0;
  if (vsRoomIds) {
    await Promise.all(Object.keys(vsRoomIds).map(async (id) => {
      const metaRes   = await fetch(`${dbUrl}/vs/${id}/meta/createdAt.json?auth=${secret}`);
      const createdAt = await metaRes.json();
      if (!createdAt || createdAt >= cutoff) return;
      await fetch(`${dbUrl}/vs/${id}.json?auth=${secret}`, { method: 'DELETE' });
      await fetch(`${dbUrl}/vs-index/${id}.json?auth=${secret}`, { method: 'DELETE' });
      vsDeleted++;
    }));
  }

  res.json({ deleted, checked: Object.keys(puzzleIds).length, vsDeleted });
}
