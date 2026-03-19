/**
 * Admin endpoint to delete (or archive+delete) feedback reports.
 *
 * POST /api/feedback-delete
 * Body:
 * {
 *   id: string,                           // feedback/{id}
 *   archive?: boolean,                   // default: true
 *   reason?: string                      // optional, for audit on archive record
 * }
 *
 * Security:
 * - Requires Authorization: Bearer <FEEDBACK_ADMIN_TOKEN>
 *
 * Storage:
 * - Archived at feedback-archive/{id} when archive=true
 * - Deleted from feedback/{id} always when endpoint succeeds
 */

function requireAuth(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return false;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return false;
  return token === process.env.FEEDBACK_ADMIN_TOKEN;
}

async function fbGet(pathname) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  if (!url || !s) throw new Error('Missing Firebase env vars');
  const res = await fetch(`${url}/${pathname}.json?auth=${s}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firebase GET error: ${res.status} ${text}`);
  }
  return res.json();
}

async function fbPut(pathname, value) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  if (!url || !s) throw new Error('Missing Firebase env vars');
  const res = await fetch(`${url}/${pathname}.json?auth=${s}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firebase PUT error: ${res.status} ${text}`);
  }
}

async function fbDelete(pathname) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  if (!url || !s) throw new Error('Missing Firebase env vars');
  const res = await fetch(`${url}/${pathname}.json?auth=${s}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firebase DELETE error: ${res.status} ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id, archive, reason } = req.body || {};
  const feedbackId = typeof id === 'string' ? id.trim() : '';
  const okId = /^[A-Za-z0-9_-]+$/.test(feedbackId);
  if (!okId) return res.status(400).json({ error: 'Valid id is required' });

  const shouldArchive = archive === undefined ? true : !!archive;
  const auditReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;

  try {
    const existing = await fbGet(`feedback/${feedbackId}`);
    if (!existing) {
      return res.status(404).json({ error: 'Feedback item not found' });
    }

    if (shouldArchive) {
      await fbPut(`feedback-archive/${feedbackId}`, {
        ...existing,
        archivedAt: Date.now(),
        archiveReason: auditReason,
      });
    }

    await fbDelete(`feedback/${feedbackId}`);
    return res.json({ ok: true, archived: shouldArchive });
  } catch (err) {
    console.error('Failed to delete feedback', err);
    return res.status(500).json({ error: 'Failed to delete feedback' });
  }
}

