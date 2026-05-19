/** @typedef {'bw'|'invert'|'scramble'|'flip'|'shake'|'shuffle'} PowerupType */

export const TARGET_SLOW_POWERUPS = 5;
export const EXPECTED_MERGE_WEIGHT = 2.5;
export const COMBO_WINDOW_MS = 5000;
export const COMBO_MAX = 4;
export const PER_MERGE_CAP = 25;

/** @type {PowerupType[]} */
export const POWERUP_TYPES = ['bw', 'invert', 'scramble', 'flip', 'shake', 'shuffle'];

/** @type {Record<PowerupType, string>} */
export const POWERUP_EMOJI = {
  bw: '👁',
  invert: '🔄',
  scramble: '💥',
  flip: '🔃',
  shake: '📳',
  shuffle: '🔀',
};

const FILL_PER_MERGE_FRACTION = (100 * TARGET_SLOW_POWERUPS) / EXPECTED_MERGE_WEIGHT;

/**
 * Bar % added for one snap (before combo), capped per merge.
 * @param {number} draggedCount pieces moved this snap
 * @param {number} totalPieces
 * @param {number} comboMultiplier 1–COMBO_MAX
 */
export function computeMergeFill(draggedCount, totalPieces, comboMultiplier = 1) {
  if (totalPieces <= 0 || draggedCount <= 0) return 0;
  const mergeFraction = draggedCount / totalPieces;
  const baseFill = mergeFraction * FILL_PER_MERGE_FRACTION;
  const capped = Math.min(baseFill, PER_MERGE_CAP);
  return capped * Math.max(1, comboMultiplier);
}

/**
 * Combo level after a successful snap (1 = no streak yet on this chain).
 * @param {number|null} lastSnapAt ms timestamp of previous snap
 * @param {number} now ms
 * @param {number} currentComboLevel level used on previous snap (1–COMBO_MAX)
 */
export function nextComboLevel(lastSnapAt, now, currentComboLevel) {
  if (lastSnapAt == null || now - lastSnapAt >= COMBO_WINDOW_MS) return 1;
  return Math.min(currentComboLevel + 1, COMBO_MAX);
}

/**
 * @param {number} charge current bar 0–100+
 * @param {number} fill amount to add
 * @returns {{ charge: number, awards: number }}
 */
export function applyCharge(charge, fill) {
  if (fill <= 0) return { charge, awards: 0 };
  const total = charge + fill;
  const awards = Math.floor(total / 100);
  return { charge: total - awards * 100, awards };
}

/**
 * @param {{ solvedCount: number, totalPieces: number, pieceGroup: (string|null)[], groups: Record<string, Set<number>> }} board
 */
export function isPuzzleComplete(board) {
  const { solvedCount, totalPieces, pieceGroup, groups } = board;
  if (totalPieces <= 0) return false;
  if (solvedCount >= totalPieces) return true;
  const gids = new Set(pieceGroup.filter(Boolean));
  if (gids.size !== 1) return false;
  const gid = [...gids][0];
  return (groups[gid]?.size ?? 0) === totalPieces;
}

/**
 * @param {() => number} [rng]
 * @returns {PowerupType}
 */
export function pickRandomPowerup(rng = Math.random) {
  const i = Math.floor(rng() * POWERUP_TYPES.length);
  return POWERUP_TYPES[i];
}

/**
 * Replay a merge sequence for pacing tests.
 * @param {{ now: number, draggedCount: number, skipFill?: boolean }[]} snaps
 * @param {{ totalPieces?: number }} [opts]
 */
export function simulateGame(snaps, opts = {}) {
  const totalPieces = opts.totalPieces ?? 100;
  let charge = 0;
  let totalAwards = 0;
  let lastSnapAt = null;
  let comboLevel = 1;

  for (const snap of snaps) {
    if (snap.skipFill) {
      lastSnapAt = snap.now;
      continue;
    }
    comboLevel = nextComboLevel(lastSnapAt, snap.now, comboLevel);
    const fill = computeMergeFill(snap.draggedCount, totalPieces, comboLevel);
    const result = applyCharge(charge, fill);
    charge = result.charge;
    totalAwards += result.awards;
    lastSnapAt = snap.now;
  }

  return { totalAwards, finalCharge: charge };
}

/** Build a slow-play snap list (~5 powerups at combo 1). */
export function buildSlowSnapSequence(_totalPieces = 100, snapCount = 85) {
  const snaps = [];
  let t = 0;
  for (let i = 0; i < snapCount; i++) {
    t += 8000;
    const draggedCount = i % 3 === 0 ? 2 : 3;
    snaps.push({ now: t, draggedCount });
  }
  return snaps;
}

/** Build a fast combo snap list (more powerups than slow). */
export function buildFastSnapSequence(_totalPieces = 100, snapCount = 55) {
  const snaps = [];
  let t = 0;
  let comboLevel = 1;
  for (let i = 0; i < snapCount; i++) {
    t += 2500;
    comboLevel = i === 0 ? 1 : nextComboLevel(t - 2500, t, comboLevel);
    const draggedCount = 2 + (i % 2);
    snaps.push({ now: t, draggedCount });
  }
  return snaps;
}
