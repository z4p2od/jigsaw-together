/**
 * GET /api/catalog — published puzzle catalog for Play Together.
 * Each entry has a fixed piece count and rotation (hardMode).
 */
function fbGet(path) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  if (!url || !s) throw new Error('Firebase not configured');
  return fetch(`${url}/${path}.json?auth=${s}`).then((r) => r.json());
}

function previewUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  if (/\/upload\/[^/]*c_/.test(url)) return url;
  return url.replace('/upload/', '/upload/c_fill,w_480,h_360,q_auto,f_auto/');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  try {
    const raw = (await fbGet('catalog')) || {};
    const puzzles = Object.entries(raw)
      .map(([id, entry]) => {
        if (!entry?.imageUrl || !entry.pieces) return null;
        return {
          id,
          imageUrl: previewUrl(entry.imageUrl),
          fullUrl: entry.imageUrl,
          width: entry.width,
          height: entry.height,
          pieces: entry.pieces,
          hardMode: !!entry.hardMode,
          createdAt: entry.createdAt || 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    return res.status(200).json({ puzzles });
  } catch (err) {
    console.error('catalog', err);
    return res.status(500).json({ error: 'Failed to load catalog' });
  }
}
