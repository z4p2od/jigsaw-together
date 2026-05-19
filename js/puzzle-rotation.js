export function normalizeRotationDeg(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

/** Snap any angle to the nearest quarter-turn (0, 90, 180, 270). */
export function snapRotationToQuarterTurn(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  const normalized = ((n % 360) + 360) % 360;
  const quarters = [0, 90, 180, 270];
  let best = 0;
  let bestDist = Infinity;
  for (const q of quarters) {
    const d = Math.min(Math.abs(normalized - q), 360 - Math.abs(normalized - q));
    if (d < bestDist) {
      bestDist = d;
      best = q;
    }
  }
  return best;
}

/**
 * Rotate a connected set of pieces 90° clockwise around their centroid.
 * Returns [{ index, x, y, rotation }, ...].
 */
export function rotateGroupQuarterTurnCW(pieceStates, indices, displayW, displayH) {
  if (!Array.isArray(indices) || indices.length === 0) return [];

  const cx = indices.reduce((s, i) => s + pieceStates[i].x + displayW / 2, 0) / indices.length;
  const cy = indices.reduce((s, i) => s + pieceStates[i].y + displayH / 2, 0) / indices.length;

  return indices.map((i) => {
    const px = pieceStates[i].x + displayW / 2;
    const py = pieceStates[i].y + displayH / 2;
    const x = cx - (py - cy) - displayW / 2;
    const y = cy + (px - cx) - displayH / 2;
    const rotation = normalizeRotationDeg((pieceStates[i].rotation ?? 0) + 90);
    return { index: i, x, y, rotation };
  });
}
