/**
 * Vercel cron job — deletes puzzles older than 24 hours.
 * Schedule: daily at 3am UTC (configured in vercel.json).
 *
 * Required env vars:
 *   FIREBASE_DB_URL     — e.g. https://your-project-default-rtdb.firebaseio.com
 *   FIREBASE_DB_SECRET  — legacy database secret (Firebase console → Project settings
 *                         → Service accounts → Database secrets)
 *   CLEANUP_SECRET      — arbitrary secret; Vercel sends it automatically for cron
 *                         routes, but also lets you trigger manually with:
 *                         curl -H "Authorization: Bearer <secret>" /api/cleanup
 */
export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CLEANUP_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dbUrl  = process.env.FIREBASE_DB_URL;
  const secret = process.env.FIREBASE_DB_SECRET;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

  // Fetch puzzle IDs only (shallow=true skips pieces/image data)
  const listRes = await fetch(`${dbUrl}/puzzles.json?shallow=true&auth=${secret}`);
  const puzzleIds = await listRes.json();
  if (!puzzleIds) return res.json({ deleted: 0 });

  let deleted = 0;
  await Promise.all(Object.keys(puzzleIds).map(async (id) => {
    const metaRes   = await fetch(`${dbUrl}/puzzles/${id}/meta/createdAt.json?auth=${secret}`);
    const createdAt = await metaRes.json();
    if (createdAt && createdAt < cutoff) {
      await fetch(`${dbUrl}/puzzles/${id}.json?auth=${secret}`, { method: 'DELETE' });
      deleted++;
    }
  }));

  res.json({ deleted, checked: Object.keys(puzzleIds).length });
}
