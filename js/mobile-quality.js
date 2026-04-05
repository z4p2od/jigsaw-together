/**
 * Shared mobile texture / HQ policy: capability signals only (DPR, optional
 * deviceMemory / hardwareConcurrency, reduced motion). UA is used only in
 * computeIsMobileLike() for touch UX branching — not as a per-model quality tier.
 */

export function computeIsMobileLike() {
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

function mobileTextureConstrained() {
  const mem = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  if (mem > 0 && mem < 4) return true;
  if (cores >= 1 && cores < 4) return true;
  return false;
}

export function shouldAutoEnableHQ() {
  const dpr = Number(window.devicePixelRatio || 1);
  const mem = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

  if (reduceMotion) return false;
  if (dpr < 2) return false;
  if (cores >= 1 && cores < 4) return false;
  if (mem > 0 && mem < 4) return false;
  return true;
}

export function initHighQualityPreference(isMobileLike, safeLocalGet) {
  if (!isMobileLike) return true;
  const saved = safeLocalGet('jt-high-quality');
  if (saved === '1') return true;
  if (saved === '0') return false;
  return shouldAutoEnableHQ();
}

/**
 * @param {number} total - piece count
 * @param {boolean} isMobileLike
 * @param {boolean} highQualityMode
 */
export function getTextureScale(total, isMobileLike, highQualityMode) {
  const constrained = isMobileLike && mobileTextureConstrained();
  const hqLargePuzzle = isMobileLike && highQualityMode && total > 200;
  const hqTight = constrained || hqLargePuzzle;

  if (!isMobileLike) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (total <= 40) return Math.max(1.35, Math.min(2.5, dpr));
    if (total <= 120) return Math.max(1.22, Math.min(2.15, dpr * 0.98));
    if (total <= 250) return Math.max(1.12, Math.min(1.7, dpr * 0.88));
    return Math.max(1.06, Math.min(1.38, dpr * 0.72));
  }
  if (highQualityMode) {
    const dprCap = hqTight ? 2.0 : 2.2;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    if (total <= 40) return Math.max(hqTight ? 1.12 : 1.2, Math.min(dprCap, dpr));
    if (total <= 120) {
      return Math.max(hqTight ? 1.08 : 1.15, Math.min(hqTight ? 1.65 : 1.8, dpr * (hqTight ? 0.9 : 0.95)));
    }
    if (total <= 250) {
      return Math.max(hqTight ? 1.0 : 1.05, Math.min(hqTight ? 1.22 : 1.35, dpr * (hqTight ? 0.72 : 0.78)));
    }
    return 1;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (total <= 40) return Math.max(constrained ? 1.1 : 1.12, dpr);
  if (total <= 120) return Math.max(constrained ? 1.05 : 1.08, Math.min(1.7, dpr * 1.2));
  if (total <= 250) return Math.max(1, Math.min(1.45, dpr));
  return 1;
}

/** High-DPR mobile: nudge scale so board edge maps to ~integer device pixels. */
export function snapBoardScaleToDevicePixels(s, boundByHeight, boardW, boardH, scaleMin, scaleMax, isMobileLike) {
  if (!Number.isFinite(s) || s <= 0) return s;
  if (!isMobileLike) return s;
  const dpr = Number(window.devicePixelRatio) || 1;
  if (dpr < 2) return s;
  const clamp = x => Math.min(scaleMax, Math.max(scaleMin, x));
  const dim = boundByHeight ? boardH : boardW;
  const deviceLen = dim * s * dpr;
  const snapped = Math.max(1, Math.round(deviceLen));
  return clamp(snapped / (dim * dpr));
}
