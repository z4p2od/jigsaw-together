import {
  loadPuzzle,
  lockPiece,
  unlockPiece,
  updatePiecePosition,
  solvePiece,
  onPiecesChanged,
} from './firebase.js';

// ── State ─────────────────────────────────────────────────────────────────────

const puzzleId  = new URLSearchParams(location.search).get('id');
const playerId  = getOrCreatePlayerId();

let meta        = null;   // { imageData, cols, rows, pieceW, pieceH }
let pieceEls    = [];     // DOM elements indexed by piece number
let pieceStates = [];     // local mirror of Firebase piece data
let solvedCount = 0;
let totalPieces = 0;

let dragging    = null;   // { index, offsetX, offsetY }
let unsubscribe = null;

const board       = document.getElementById('puzzle-board');
const loadingEl   = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const celebration = document.getElementById('celebration');
const progressEl  = document.getElementById('progress-text');
const shareUrlEl  = document.getElementById('share-url');
const copyBtn     = document.getElementById('copy-btn');

// ── Boot ──────────────────────────────────────────────────────────────────────

if (!puzzleId) {
  location.href = '/';
} else {
  initPuzzle();
}

async function initPuzzle() {
  try {
    loadingText.textContent = 'Loading puzzle...';
    const data = await loadPuzzle(puzzleId);
    meta        = data.meta;
    pieceStates = Object.values(data.pieces);
    totalPieces = pieceStates.length;
    solvedCount = pieceStates.filter(p => p.solved).length;

    setupBoard();
    await renderAllPieces();
    setupShareLink();
    attachDragListeners();

    // Subscribe to real-time updates
    unsubscribe = onPiecesChanged(puzzleId, applyRemoteUpdate);

    loadingEl.style.display = 'none';
    updateProgress();
  } catch (err) {
    console.error(err);
    loadingText.textContent = 'Puzzle not found.';
  }
}

// ── Board setup ───────────────────────────────────────────────────────────────

const BOARD_W = 900;
const BOARD_H = 650;

function setupBoard() {
  board.style.width  = BOARD_W + 'px';
  board.style.height = BOARD_H + 'px';
}

// ── Render pieces ─────────────────────────────────────────────────────────────

/**
 * Cut the full image into pieces using canvas and render them as divs.
 * For large piece counts we batch the rendering to avoid blocking the thread.
 */
async function renderAllPieces() {
  const img = await loadImage('data:image/jpeg;base64,' + meta.imageData);
  const { cols, rows, pieceW, pieceH } = meta;

  // Scale pieces to fit nicely on the board
  const scaleX = (BOARD_W * 0.55) / img.naturalWidth;
  const scaleY = (BOARD_H * 0.55) / img.naturalHeight;
  const scale  = Math.min(scaleX, scaleY, 1); // never upscale

  const displayW = Math.floor(pieceW * scale);
  const displayH = Math.floor(pieceH * scale);

  loadingText.textContent = `Cutting ${totalPieces} pieces...`;

  const BATCH = 100;
  for (let start = 0; start < totalPieces; start += BATCH) {
    await new Promise(resolve => setTimeout(resolve, 0)); // yield to browser
    const end = Math.min(start + BATCH, totalPieces);
    for (let i = start; i < end; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const dataUrl = cutPiece(img, col * pieceW, row * pieceH, pieceW, pieceH, displayW, displayH);
      const p = pieceStates[i];
      renderPiece(i, dataUrl, p.x, p.y, p.solved, displayW, displayH);
    }
    loadingText.textContent = `Cutting pieces... ${Math.min(end, totalPieces)} / ${totalPieces}`;
  }

  // Store display dimensions on meta for snap calculations
  meta._displayW = displayW;
  meta._displayH = displayH;
}

function cutPiece(img, sx, sy, sw, sh, displayW, displayH) {
  const c = document.createElement('canvas');
  c.width  = displayW;
  c.height = displayH;
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, displayW, displayH);
  return c.toDataURL('image/jpeg', 0.92);
}

function renderPiece(index, dataUrl, x, y, solved, w, h) {
  const el = document.createElement('img');
  el.src    = dataUrl;
  el.className = 'piece' + (solved ? ' solved' : '');
  el.dataset.index = index;
  el.style.width  = w + 'px';
  el.style.height = h + 'px';
  el.style.left   = x + 'px';
  el.style.top    = y + 'px';
  el.draggable    = false;

  board.appendChild(el);
  pieceEls[index] = el;
}

// ── Drag ──────────────────────────────────────────────────────────────────────

function attachDragListeners() {
  board.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

async function onMouseDown(e) {
  const el = e.target.closest('.piece');
  if (!el || el.classList.contains('solved')) return;

  const index = Number(el.dataset.index);
  const state = pieceStates[index];

  // Don't grab if locked by someone else
  if (state.lockedBy && state.lockedBy !== playerId) return;

  const acquired = await lockPiece(puzzleId, index, playerId);
  if (!acquired) return;

  const rect = el.getBoundingClientRect();
  const boardRect = board.getBoundingClientRect();

  dragging = {
    index,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
  };

  el.classList.add('dragging');
  el.style.zIndex = 1000;
}

function onMouseMove(e) {
  if (!dragging) return;
  const { index, offsetX, offsetY } = dragging;
  const boardRect = board.getBoundingClientRect();

  const x = e.clientX - boardRect.left - offsetX;
  const y = e.clientY - boardRect.top  - offsetY;

  movePieceEl(index, x, y);
  updatePiecePosition(puzzleId, index, x, y);
}

async function onMouseUp(e) {
  if (!dragging) return;
  const { index, offsetX, offsetY } = dragging;
  dragging = null;

  const el = pieceEls[index];
  el.classList.remove('dragging');

  const boardRect = board.getBoundingClientRect();
  const x = e.clientX - boardRect.left - offsetX;
  const y = e.clientY - boardRect.top  - offsetY;

  const snapped = checkSnap(index, x, y);
  if (snapped) {
    movePieceEl(index, snapped.x, snapped.y);
    el.classList.add('solved');
    pieceStates[index].solved = true;
    solvedCount++;
    await solvePiece(puzzleId, index, snapped.x, snapped.y);
    updateProgress();
    checkCompletion();
  } else {
    movePieceEl(index, x, y);
    await unlockPiece(puzzleId, index);
    pieceStates[index].lockedBy = null;
  }
}

// ── Snap ──────────────────────────────────────────────────────────────────────

/**
 * Returns snapped { x, y } if piece is within threshold of its correct position,
 * otherwise null.
 *
 * Correct position is where the piece would sit if the completed puzzle were
 * centred on the board.
 */
function checkSnap(index, x, y) {
  const { cols, _displayW: dW, _displayH: dH } = meta;
  const col = index % cols;
  const row = Math.floor(index / cols);

  // Centre the completed puzzle on the board
  const totalW = dW * meta.cols;
  const totalH = dH * meta.rows;
  const originX = (BOARD_W - totalW) / 2;
  const originY = (BOARD_H - totalH) / 2;

  const correctX = originX + col * dW;
  const correctY = originY + row * dH;

  const threshold = getSnapThreshold(dW);

  const cx = x + dW / 2;
  const cy = y + dH / 2;
  const ccx = correctX + dW / 2;
  const ccy = correctY + dH / 2;

  const dist = Math.hypot(cx - ccx, cy - ccy);
  if (dist <= threshold) {
    return { x: correctX, y: correctY };
  }
  return null;
}

function getSnapThreshold(pieceWidth) {
  return Math.max(15, pieceWidth * 0.25);
}

// ── Remote updates ────────────────────────────────────────────────────────────

function applyRemoteUpdate(index, data) {
  // Don't override our own dragging piece
  if (dragging && dragging.index === index) return;

  pieceStates[index] = { ...pieceStates[index], ...data };

  const el = pieceEls[index];
  if (!el) return;

  if (data.solved) {
    movePieceEl(index, data.x, data.y);
    if (!el.classList.contains('solved')) {
      el.classList.add('solved');
      el.classList.remove('locked-by-other');
      solvedCount++;
      updateProgress();
      checkCompletion();
    }
    return;
  }

  movePieceEl(index, data.x, data.y);

  if (data.lockedBy && data.lockedBy !== playerId) {
    el.classList.add('locked-by-other');
  } else {
    el.classList.remove('locked-by-other');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function movePieceEl(index, x, y) {
  const el = pieceEls[index];
  if (!el) return;
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
}

function updateProgress() {
  progressEl.textContent = `${solvedCount} / ${totalPieces} pieces`;
}

function checkCompletion() {
  if (solvedCount >= totalPieces) {
    if (unsubscribe) unsubscribe();
    celebration.classList.add('show');
  }
}

function setupShareLink() {
  const url = location.href;
  shareUrlEl.textContent = url;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy Link'), 2000);
    });
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function getOrCreatePlayerId() {
  let id = sessionStorage.getItem('playerId');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('playerId', id);
  }
  return id;
}

// Cleanup Firebase listener on page unload
window.addEventListener('beforeunload', () => {
  if (unsubscribe) unsubscribe();
  if (dragging) unlockPiece(puzzleId, dragging.index);
});
