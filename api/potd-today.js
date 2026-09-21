/**
 * GET /api/potd-today — today's Puzzle of the Day pointer + preview image.
 */
function todayAthens() {
  return new Date().toLocaleDateString('sv', { timeZone: 'Europe/Athens' });
}

function fbGet(path) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  if (!url || !s) throw new Error('Firebase not configured');
  return fetch(`${url}/${path}.json?auth=${s}`).then((r) => r.json());
}

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
    let potd = await fbGet('potd/daily');
    if (!potd?.puzzleId || potd.date !== today) {
      potd = await fbGet('potd/easy');
    }
    if (!potd || potd.date !== today || !potd.puzzleId) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return res.status(200).json({ date: today, puzzle: null });
    }

    let imageUrl = potd.imageUrl || null;
    if (!imageUrl) {
      const meta = await fbGet(`puzzles/${potd.puzzleId}/meta`);
      imageUrl = meta?.imageUrl || null;
    }

    const puzzle = {
      puzzleId: potd.puzzleId,
      date: potd.date,
      imageUrl: previewImageUrl(imageUrl),
      pieces: potd.pieces || null,
      cols: potd.cols || null,
      rows: potd.rows || null,
      hardMode: !!potd.hardMode,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json({ date: today, puzzle });
  } catch (err) {
    console.error('potd-today', err);
    return res.status(500).json({ error: 'Failed to load puzzle of the day' });
  }
}
