/** Fraction of pieces that start face-down with a random angle. */
export const FACE_DOWN_FRACTION = 0.3;

const QUARTER_ROTS = [0, 90, 180, 270];

/**
 * Pick ~30% of piece indices (deterministic for a given rng).
 * @param {number} count
 * @param {() => number} rng returns value in [0, 1)
 * @returns {Set<number>}
 */
export function pickFaceDownIndices(count, rng) {
  const n = Math.ceil(count * FACE_DOWN_FRACTION);
  const indices = Array.from({ length: count }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return new Set(indices.slice(0, n));
}

/**
 * Scatter pieces on the board with optional face-down subset.
 * @param {object} opts
 * @param {number} opts.count
 * @param {number} opts.dispW
 * @param {number} opts.dispH
 * @param {boolean} opts.hardMode
 * @param {number} [opts.boardW=1080]
 * @param {number} [opts.boardH=780]
 * @param {() => number} [opts.rng=Math.random]
 * @returns {{ x: number, y: number, rotation: number, faceDown: boolean }[]}
 */
export function scatterPieces({
  count,
  dispW,
  dispH,
  hardMode,
  boardW = 1080,
  boardH = 780,
  rng = Math.random,
}) {
  const faceDownSet = pickFaceDownIndices(count, rng);
  const maxX = Math.max(0, boardW - dispW);
  const maxY = Math.max(0, boardH - dispH);

  return Array.from({ length: count }, (_, i) => {
    const faceDown = faceDownSet.has(i);
    let rotation;
    if (faceDown) {
      rotation = rng() * 360;
    } else if (hardMode) {
      rotation = QUARTER_ROTS[Math.floor(rng() * 4)];
    } else {
      rotation = 0;
    }
    return {
      x: rng() * maxX,
      y: rng() * maxY,
      rotation,
      faceDown,
    };
  });
}

/** Seeded RNG for VS (same seed → same sequence). */
export function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

/**
 * VS scatter from room seed (deterministic across clients and board keys).
 */
export function scatterFromSeed(seed, count, dispW, dispH, hardMode, boardW = 1080, boardH = 780) {
  return scatterPieces({
    count,
    dispW,
    dispH,
    hardMode,
    boardW,
    boardH,
    rng: seededRandom(seed),
  });
}
