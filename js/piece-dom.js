/** Cardboard back clipped to the cut-piece shape (see `.piece-back` in style.css). */
export function applyPieceBackMask(backEl, dataUrl) {
  backEl.className = 'piece-back';
  const safeUrl = String(dataUrl).replace(/"/g, '\\"');
  const mask = `url("${safeUrl}")`;
  backEl.style.maskImage = mask;
  backEl.style.webkitMaskImage = mask;
  backEl.style.maskSize = '100% 100%';
  backEl.style.webkitMaskSize = '100% 100%';
  backEl.style.maskRepeat = 'no-repeat';
  backEl.style.webkitMaskRepeat = 'no-repeat';
  backEl.style.maskPosition = 'center';
  backEl.style.webkitMaskPosition = 'center';
}

export function getPieceFrontSrc(pieceEl) {
  if (!pieceEl) return '';
  const front = pieceEl.querySelector?.('.piece-front');
  if (front?.src) return front.src;
  if (pieceEl.tagName === 'IMG') return pieceEl.src;
  return '';
}
