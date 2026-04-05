/**
 * One-line structured logs for Vercel function logs (JSON per line).
 * Lives outside `api/` so it is not counted as a separate serverless route.
 * @param {string} route
 * @param {Record<string, unknown>} data
 */
export function logApiEvent(route, data) {
  console.error(JSON.stringify({ t: Date.now(), route, ...data }));
}
