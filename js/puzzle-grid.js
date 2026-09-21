/** Allowed piece counts for catalogued puzzles. */
export const ALLOWED_PIECES = [24, 40, 100, 250, 500];

/**
 * Choose a cols×rows grid close to pieceCount whose aspect matches the image.
 * @param {number} pieceCount
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @returns {{ cols: number, rows: number }}
 */
export function calculateGrid(pieceCount, imgWidth, imgHeight) {
  const aspect = imgWidth / imgHeight;
  let bestCols = 1;
  let bestRows = pieceCount;
  let bestDiff = Infinity;
  for (let cols = 1; cols <= pieceCount; cols++) {
    const rows = Math.round(pieceCount / cols);
    if (cols * rows === 0) continue;
    const diff = Math.abs(cols / rows - aspect);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestCols = cols;
      bestRows = rows;
    }
  }
  return { cols: bestCols, rows: bestRows };
}

export function formatPuzzleDifficulty(pieces, hardMode) {
  const n = Number(pieces) || 0;
  return hardMode ? `${n} pieces · rotated` : `${n} pieces`;
}
