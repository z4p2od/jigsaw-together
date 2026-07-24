/**
 * Pure helpers for puzzle completion UI / state.
 * Kept free of DOM globals so Vitest can cover the load-vs-live paths.
 */

/**
 * @param {object} opts
 * @param {number} [opts.solvedCount]
 * @param {number} [opts.totalPieces]
 * @param {number} [opts.groupedPieceCount]
 * @param {number} [opts.activeGroupCount]
 */
export function isPuzzleComplete({
  solvedCount = 0,
  totalPieces = 0,
  groupedPieceCount = 0,
  activeGroupCount = 0,
} = {}) {
  if (!totalPieces || totalPieces < 1) return false;
  if (solvedCount >= totalPieces) return true;
  return groupedPieceCount === totalPieces && activeGroupCount === 1;
}

/** Welcome CTA when opening `/?id=…` vs a cold POTD visit. */
export function welcomeStartLabel(hasExistingPuzzleId) {
  return hasExistingPuzzleId ? 'Open Puzzle' : "Play Today's Puzzle";
}

/**
 * Clear celebration banner state so a later `.show` can display again.
 * Inline `display:none` (used by older "Play another" handlers) must be cleared
 * or it permanently wins over `#celebration.show { display: flex }`.
 *
 * @param {HTMLElement | null | undefined} celebration
 * @param {{ timeEl?: HTMLElement | null, lbEl?: HTMLElement | null, lbListEl?: HTMLElement | null }} [extras]
 */
export function resetCelebrationEl(celebration, extras = {}) {
  if (!celebration) return;
  celebration.classList.remove('show');
  celebration.style.display = '';
  if (extras.timeEl) extras.timeEl.textContent = '';
  if (extras.lbEl) extras.lbEl.style.display = 'none';
  if (extras.lbListEl) extras.lbListEl.innerHTML = '';
}

/**
 * Show the celebration banner, clearing any stale inline hide.
 * @param {HTMLElement | null | undefined} celebration
 */
export function showCelebrationEl(celebration) {
  if (!celebration) return;
  celebration.style.display = '';
  celebration.classList.add('show');
}
