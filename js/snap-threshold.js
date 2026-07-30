/**
 * Neighbour-snap distance for jigsaw piece edges.
 *
 * Historically this was `Math.max(40, minSide * 0.4)`. That 40px floor works for
 * typical piece sizes, but high piece-count puzzles shrink displayW/H well below
 * 40px (e.g. 16×16 → ~26px). A floor larger than the piece itself snaps from more
 * than a full piece away and produces runaway group merges.
 *
 * Keep the ~40% / 40px preference for large pieces, but never exceed half a piece.
 *
 * @param {number} displayW
 * @param {number} displayH
 * @returns {number}
 */
export function getSnapThreshold(displayW, displayH) {
  const w = Number(displayW);
  const h = Number(displayH);
  const pieceMin = Math.min(w, h);
  if (!(pieceMin > 0)) return 40;
  const preferred = pieceMin * 0.4;
  return Math.min(Math.max(40, preferred), pieceMin * 0.5);
}
