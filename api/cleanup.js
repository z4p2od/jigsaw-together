/**
 * Vercel cron job — deletes puzzles older than 24 hours.
 * Also deletes the associated Cloudinary image if present.
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

async function deleteCloudinaryImage(publicId) {
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

    // Delete Cloudinary image only if it was user-uploaded (not from managed library folders)
    const pidRes  = await fetch(`${dbUrl}/puzzles/${id}/meta/imagePublicId.json?auth=${secret}`);
    const publicId = await pidRes.json();
    const PROTECTED_PREFIXES = ['potd-pool', 'puzzle-library'];
    const isProtected = publicId && PROTECTED_PREFIXES.some(p => String(publicId).startsWith(p));
    if (publicId && !isProtected) {
      try { await deleteCloudinaryImage(publicId); } catch {}
    }

    await fetch(`${dbUrl}/puzzles/${id}.json?auth=${secret}`, { method: 'DELETE' });
    // Also remove from rooms-index if it was a public room
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
