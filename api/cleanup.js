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
  if (req.headers['authorization'] !== `Bearer ${process.env.CLEANUP_SECRET}`) {
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

    // Delete Cloudinary image if present
    const pidRes  = await fetch(`${dbUrl}/puzzles/${id}/meta/imagePublicId.json?auth=${secret}`);
    const publicId = await pidRes.json();
    if (publicId) {
      try { await deleteCloudinaryImage(publicId); } catch {}
    }

    await fetch(`${dbUrl}/puzzles/${id}.json?auth=${secret}`, { method: 'DELETE' });
    deleted++;
  }));

  res.json({ deleted, checked: Object.keys(puzzleIds).length });
}
