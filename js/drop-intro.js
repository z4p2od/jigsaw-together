/** Skip drop intro above this piece count (performance). */
export const MAX_DROP_INTRO_PIECES = 150;

/**
 * @param {object} opts
 * @param {{ startedAt?: number|null }} [opts.meta]
 * @param {Array<{ groupId?: string|null, solved?: boolean }>} [opts.pieceStates]
 * @param {number} [opts.solvedCount]
 * @param {boolean} [opts.prefersReducedMotion]
 */
export function shouldPlayDropIntro({
  meta,
  pieceStates,
  solvedCount = 0,
  prefersReducedMotion = false,
}) {
  if (prefersReducedMotion) return false;
  if (meta?.startedAt) return false;
  if (solvedCount > 0) return false;
  if (!Array.isArray(pieceStates) || pieceStates.length === 0) return false;
  if (pieceStates.length > MAX_DROP_INTRO_PIECES) return false;
  if (pieceStates.some((p) => p?.groupId)) return false;
  return true;
}

/**
 * Box layout on the board (board coordinate space).
 * @param {object} meta
 * @param {number} boardW
 * @param {number} boardH
 */
export function getDropBoxLayout(meta, boardW, boardH) {
  const displayW = meta._displayW ?? meta.displayW ?? 80;
  const displayH = meta._displayH ?? meta.displayH ?? 80;
  const cols = meta.cols ?? 1;
  const rows = meta.rows ?? 1;
  const gridW = cols * displayW;
  const gridH = rows * displayH;
  const boxW = Math.min(Math.max(gridW * 0.55, 140), boardW * 0.42);
  const boxH = Math.min(Math.max(gridH * 0.22, 72), 110);
  const boxX = (boardW - boxW) / 2;
  const boxY = Math.max(16, boardH * 0.05);

  return {
    boxX,
    boxY,
    boxW,
    boxH,
    mouthX: boxX + boxW / 2,
    mouthY: boxY + boxH - 6,
    displayW,
    displayH,
  };
}

/**
 * Deterministic spawn point per piece index (stable across clients).
 * @param {number} index
 * @param {ReturnType<typeof getDropBoxLayout>} layout
 */
export function getDropSpawnPosition(index, layout) {
  const t = ((index * 17 + 3) % 100) / 100;
  const u = ((index * 31 + 7) % 100) / 100;
  const spreadX = Math.min(36, layout.boxW * 0.35);
  const spreadY = 14;
  return {
    x: layout.mouthX - layout.displayW / 2 + (t - 0.5) * spreadX,
    y: layout.mouthY - layout.displayH / 2 + u * spreadY,
  };
}

/** Stagger + duration tuned so large puzzles finish within ~4s. */
export function getDropTiming(pieceCount) {
  const capped = Math.max(1, pieceCount);
  const duration = Math.round(Math.min(580, Math.max(360, 500 - capped * 0.8)));
  const maxTotal = 4200;
  const stagger = Math.round(Math.min(90, Math.max(16, (maxTotal - duration) / capped)));
  return { duration, stagger };
}

/** CSS transform string for a piece at board coords. */
export function pieceTransform(x, y, rotationDeg, pad = 0) {
  const tx = x - pad;
  const ty = y - pad;
  const rot = Number.isFinite(Number(rotationDeg)) ? Number(rotationDeg) : 0;
  return rot
    ? `translate3d(${tx}px,${ty}px,0) rotate(${rot}deg)`
    : `translate3d(${tx}px,${ty}px,0)`;
}
