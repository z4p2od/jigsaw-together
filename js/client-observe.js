/**
 * Optional client error reporting. Set window.__JT_CLIENT_ERROR_ENDPOINT (e.g. '/api/client-error')
 * before this module loads. Payloads are truncated; avoid PII.
 */

const MAX_SENDS = 8;
let sends = 0;

function endpoint() {
  const u = globalThis.__JT_CLIENT_ERROR_ENDPOINT;
  return typeof u === 'string' && u.length > 0 ? u : '';
}

function report(payload) {
  const url = endpoint();
  if (!url || sends >= MAX_SENDS) return;
  sends += 1;
  const body = JSON.stringify({
    type: payload.type,
    message: payload.message,
    url: payload.url,
    stack: payload.stack ? String(payload.stack).slice(0, 2000) : '',
  });
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

window.addEventListener('error', (ev) => {
  report({
    type: 'error',
    message: ev.message || 'error',
    url: window.location?.href || '',
    stack: ev.error?.stack,
  });
});

window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason;
  report({
    type: 'unhandledrejection',
    message: r instanceof Error ? r.message : String(r),
    url: window.location?.href || '',
    stack: r instanceof Error ? r.stack : '',
  });
});
