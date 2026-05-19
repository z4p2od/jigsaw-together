/**
 * GET /api/potd-today — today's POTD pointers + preview image URLs in one round trip.
 * Used by the landing page so the preview does not wait on Firebase client SDK + N reads.
 */
const DIFFICULTIES = ['easy', 'medium', 'hard'];

function todayAthens() {
  return new Date().toLocaleDateString('sv', { timeZone: 'Europe/Athens' });
}

function fbGet(path) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  if (!url || !s) throw new Error('Firebase not configured');
  return fetch(`${url}/${path}.json?auth=${s}`).then((r) => r.json());
}

/** Smaller Cloudinary delivery for the landing preview card. */
function previewImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  if (/\/upload\/[^/]*c_/.test(url)) return url;
  return url.replace('/upload/', '/upload/c_fill,w_640,h_360,q_auto,f_auto/');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  const today = todayAthens();

  try {
    const puzzles = (
      await Promise.all(
        DIFFICULTIES.map(async (difficulty) => {
          const potd = await fbGet(`potd/${difficulty}`);
          if (!potd || potd.date !== today || !potd.puzzleId) return null;

          let imageUrl = potd.imageUrl || null;
          if (!imageUrl) {
            const meta = await fbGet(`puzzles/${potd.puzzleId}/meta`);
            imageUrl = meta?.imageUrl || null;
          }

          return {
            difficulty,
            puzzleId: potd.puzzleId,
            date: potd.date,
            imageUrl: previewImageUrl(imageUrl),
          };
        }),
      )
    ).filter(Boolean);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json({ date: today, puzzles });
  } catch (err) {
    console.error('potd-today', err);
    return res.status(500).json({ error: 'Failed to load puzzle of the day' });
  }
}
