/**
 * Admin endpoint to update feedback triage status.
 *
 * POST /api/feedback-triage
 * Body:
 * {
 *   id: string,
 *   status: 'new' | 'triaged' | 'in_progress' | 'fixed' | 'ignored',
 *   decision?: 'bug' | 'idea' | 'question' | 'not_actionable',
 *   severity?: 'low' | 'medium' | 'high' | 'critical',
 *   notes?: string,
 *   reviewer?: string
 * }
 *
 * Security:
 * - Requires Authorization: Bearer <FEEDBACK_ADMIN_TOKEN>
 */

function requireAuth(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return false;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return false;
  return token === process.env.FEEDBACK_ADMIN_TOKEN;
}

async function fbPatch(path, value) {
  const { FIREBASE_DB_URL: url, FIREBASE_DB_SECRET: s } = process.env;
  if (!url || !s) {
    throw new Error('Missing Firebase env vars');
  }
  const res = await fetch(`${url}/${path}.json?auth=${s}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firebase error: ${res.status} ${text}`);
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

  const { id, status, decision, severity, notes, reviewer } = req.body || {};
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id is required' });
  }
  if (!status || typeof status !== 'string') {
    return res.status(400).json({ error: 'status is required' });
  }

  const allowedStatus = new Set(['new', 'triaged', 'in_progress', 'fixed', 'ignored']);
  const allowedDecision = new Set(['bug', 'idea', 'question', 'not_actionable']);
  const allowedSeverity = new Set(['low', 'medium', 'high', 'critical']);

  const triage = {
    status: allowedStatus.has(status) ? status : 'triaged',
    decision: allowedDecision.has(decision) ? decision : null,
    severity: allowedSeverity.has(severity) ? severity : null,
    notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
    reviewer: typeof reviewer === 'string' && reviewer.trim() ? reviewer.trim() : null,
    updatedAt: Date.now(),
  };

  try {
    await fbPatch(`feedback/${id}`, { triage });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Failed to update triage', err);
    return res.status(500).json({ error: 'Failed to update triage' });
  }
}

