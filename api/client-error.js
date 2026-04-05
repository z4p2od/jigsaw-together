import { logApiEvent } from './structured-log.js';

function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') {
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  }
  return {};
}

export default function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).setHeader('Allow', 'POST, OPTIONS').end();
    return;
  }

  const payload = readBody(req);
  logApiEvent('client-error', {
    type: String(payload.type || '').slice(0, 64),
    message: String(payload.message || '').slice(0, 500),
    url: String(payload.url || '').slice(0, 500),
    stackLen: payload.stack ? String(payload.stack).length : 0,
  });

  res.status(204).end();
}
