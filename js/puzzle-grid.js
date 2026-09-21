/** Target totals for the “aim for ~N” shortcuts. Actual cols×rows may differ. */
export const TARGET_PIECE_COUNTS = [25, 50, 100];
/** Kept for the non-catalog room-create query fallback. */
export const ALLOWED_PIECES = [24, 40, 100, 250, 500];

/** Stable ~25 / ~50 / ~100 assignment from a Cloudinary public id. */
export function defaultTargetPieces(publicId) {
  const s = String(publicId || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return TARGET_PIECE_COUNTS[Math.abs(h) % TARGET_PIECE_COUNTS.length];
}

export const MIN_AXIS = 2;
export const MAX_AXIS = 40;
export const MAX_PIECES = 500;

/**
 * Choose a cols×rows grid close to pieceCount whose aspect matches the image.
 * That keeps pieces close to square. The photo itself is never stretched:
 * each cell is (imgW/cols)×(imgH/rows) from the source, then scaled uniformly.
 * @param {number} pieceCount
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @returns {{ cols: number, rows: number }}
 */
export function calculateGrid(pieceCount, imgWidth, imgHeight) {
  const target = Math.max(1, Math.round(Number(pieceCount) || 100));
  const aspect = (Number(imgWidth) || 1) / (Number(imgHeight) || 1);
  let bestCols = 1;
  let bestRows = target;
  let bestScore = Infinity;
  for (let cols = 1; cols <= target; cols++) {
    const rows = Math.max(1, Math.round(target / cols));
    if (cols * rows === 0) continue;
    const aspectDiff = Math.abs(cols / rows - aspect);
    const countDiff = Math.abs(cols * rows - target) / target;
    const score = aspectDiff + countDiff * 0.15;
    if (score < bestScore) {
      bestScore = score;
      bestCols = cols;
      bestRows = rows;
    }
  }
  return clampGrid(bestCols, bestRows);
}

export function clampAxis(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return MIN_AXIS;
  return Math.min(MAX_AXIS, Math.max(MIN_AXIS, v));
}

/** Clamp a grid to axis and total-piece limits. */
export function clampGrid(cols, rows) {
  let c = clampAxis(cols);
  let r = clampAxis(rows);
  if (c * r > MAX_PIECES) {
    r = Math.max(MIN_AXIS, Math.floor(MAX_PIECES / c));
    if (c * r > MAX_PIECES) {
      c = Math.max(MIN_AXIS, Math.floor(MAX_PIECES / r));
    }
  }
  return { cols: c, rows: r };
}

/**
 * Prefer an explicit cols×rows (what admin previewed). Fall back to calculateGrid.
 * @param {{ cols?: number, rows?: number, pieces?: number, width?: number, height?: number }} entry
 */
export function resolveGrid(entry) {
  const c = Math.round(Number(entry?.cols));
  const r = Math.round(Number(entry?.rows));
  if (c >= MIN_AXIS && r >= MIN_AXIS && c <= MAX_AXIS && r <= MAX_AXIS && c * r <= MAX_PIECES) {
    return { cols: c, rows: r };
  }
  return calculateGrid(entry?.pieces || 100, entry?.width, entry?.height);
}

/** Cell width/height ratio. 1 = square pieces. */
export function pieceCellAspect(cols, rows, imgW, imgH) {
  if (!cols || !rows || !imgW || !imgH) return 1;
  return (imgW / cols) / (imgH / rows);
}

export function describePieceShape(cols, rows, imgW, imgH) {
  const a = pieceCellAspect(cols, rows, imgW, imgH);
  if (a >= 1.4) return 'Pieces will be wide (photo stays unstretched)';
  if (a <= 1 / 1.4) return 'Pieces will be tall (photo stays unstretched)';
  return 'Pieces will be close to square';
}

export function formatPuzzleDifficulty(pieces, hardMode, cols, rows) {
  const c = Number(cols);
  const r = Number(rows);
  const n = (c > 0 && r > 0) ? c * r : (Number(pieces) || 0);
  const grid = (c > 0 && r > 0) ? `${c}×${r} · ` : '';
  const label = `${grid}${n} pieces`;
  return hardMode ? `${label} · rotated` : label;
}
