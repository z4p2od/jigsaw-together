/**
 * Collects in-game feedback and bug reports.
 *
 * POST /api/feedback
 * Body: {
 *   type: 'bug' | 'idea' | 'other',
 *   message: string,
 *   contact?: string,
 *   context?: string,
 *   url?: string,
 *   path?: string,
 *   puzzleId?: string,
 *   roomId?: string,
 *   screen?: string,
 *   userAgent?: string
 * }
 *
 * Stores under: feedback/{autoId}
 */

function fbPost(path, value) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  if (!url || !s) {
    throw new Error('Missing Firebase env vars');
  }
  return fetch(`${url}/${path}.json?auth=${s}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    type,
    message,
    contact,
    context,
    url,
    path,
    puzzleId,
    roomId,
    screen,
    userAgent,
  } = req.body || {};

  const trimmedMessage = (message || '').trim();
  const kind = (type || 'bug').toLowerCase();

  if (!trimmedMessage) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const allowedTypes = new Set(['bug', 'idea', 'feedback', 'other']);
  const storedType = allowedTypes.has(kind) ? kind : 'other';

  const now = Date.now();

  try {
    const payload = {
      type: storedType,
      message: trimmedMessage,
      contact: (contact || '').trim() || null,
      context: (context || '').trim() || null,
      meta: {
        url: url || null,
        path: path || null,
        puzzleId: puzzleId || null,
        roomId: roomId || null,
        screen: screen || null,
        userAgent: userAgent || null,
      },
      createdAt: now,
    };

    await fbPost('feedback', payload);

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Failed to write feedback', err);
    return res.status(500).json({ error: 'Failed to save feedback' });
  }
}

