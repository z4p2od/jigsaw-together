/**
 * Admin endpoint to list feedback reports for tooling/agents.
 *
 * GET /api/feedback-list?limit=50
 *
 * Security:
 * - Requires Authorization: Bearer <FEEDBACK_ADMIN_TOKEN>
 *   where FEEDBACK_ADMIN_TOKEN is set in the environment.
 *
 * Response: [{ id, type, message, contact, context, meta, createdAt }, ...]
 */

function requireAuth(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return false;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return false;
  return token === process.env.FEEDBACK_ADMIN_TOKEN;
}

async function fbGetFeedback(limit) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  if (!url || !s) {
    throw new Error('Missing Firebase env vars');
  }

  // Use RTDB REST API with orderBy/limitToLast.
  const params = new URLSearchParams({
    auth: s,
    orderBy: JSON.stringify('createdAt'),
    limitToLast: String(limit),
  });

  const res = await fetch(`${url}/feedback.json?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firebase error: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data || {};
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= 500 ? rawLimit : 50;

  try {
    const obj = await fbGetFeedback(limit);
    const list = Object.entries(obj).map(([id, v]) => ({ id, ...(v || {}) }));
    // Sort newest first
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return res.json({ items: list });
  } catch (err) {
    console.error('Failed to list feedback', err);
    return res.status(500).json({ error: 'Failed to load feedback' });
  }
}

