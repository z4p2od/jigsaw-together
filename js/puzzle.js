import {
  loadPuzzle,
  lockGroup,
  unlockGroup,
  updateGroupPosition,
  solveGroup,
  onPiecesChanged,
} from './firebase.js';
import { cutPiece } from './jigsaw.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const BOARD_W = 900;
const BOARD_H = 650;

// ── State ─────────────────────────────────────────────────────────────────────

const puzzleId  = new URLSearchParams(location.search).get('id');
const playerId  = getOrCreatePlayerId();

let meta        = null;
let pieceEls    = [];
let pieceStates = [];
let solvedCount = 0;
let totalPieces = 0;

// Groups — local only, never synced to Firebase
const groups    = {};   // groupId -> Set<number>
const pieceGroup = [];  // pieceGroup[i] = groupId | null

let dragging    = null; // { indices, anchorIndex, offsetX, offsetY, relOffsets }
let unsubscribe = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

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
    const data  = await loadPuzzle(puzzleId);
    meta        = data.meta;
    pieceStates = Object.values(data.pieces);
    totalPieces = pieceStates.length;
    solvedCount = pieceStates.filter(p => p.solved).length;

    setupBoard();
    await renderAllPieces();
    reconstructGroups();
    setupShareLink();
    attachDragListeners();

    unsubscribe = onPiecesChanged(puzzleId, applyRemoteUpdate);

    loadingEl.style.display = 'none';
    updateProgress();
  } catch (err) {
    console.error(err);
    loadingText.textContent = 'Puzzle not found.';
  }
}

function setupBoard() {
  board.style.width  = BOARD_W + 'px';
  board.style.height = BOARD_H + 'px';
}

// ── Rendering ─────────────────────────────────────────────────────────────────

async function renderAllPieces() {
  const img = await loadImage('data:image/jpeg;base64,' + meta.imageData);
  const { cols, rows, pieceW, pieceH, edges } = meta;

  const scaleX = (BOARD_W * 0.55) / img.naturalWidth;
  const scaleY = (BOARD_H * 0.55) / img.naturalHeight;
  const scale  = Math.min(scaleX, scaleY, 1);

  const displayW = Math.floor(pieceW * scale);
  const displayH = Math.floor(pieceH * scale);
  const tabSize  = Math.round(Math.min(displayW, displayH) * 0.22);
  const pad      = tabSize;

  meta._displayW = displayW;
  meta._displayH = displayH;
  meta._pad      = pad;

  const BATCH = 50;
  for (let start = 0; start < totalPieces; start += BATCH) {
    await new Promise(r => setTimeout(r, 0));
    const end = Math.min(start + BATCH, totalPieces);
    for (let i = start; i < end; i++) {
      const col    = i % cols;
      const row    = Math.floor(i / cols);
      const dataUrl = cutPiece(img, col, row, pieceW, pieceH, displayW, displayH, edges[i]);
      const p      = pieceStates[i];
      renderPiece(i, dataUrl, p.x, p.y, p.solved, displayW + pad * 2, displayH + pad * 2);
    }
    loadingText.textContent = `Cutting pieces... ${Math.min(end, totalPieces)} / ${totalPieces}`;
  }
}

function renderPiece(index, dataUrl, x, y, solved, elW, elH) {
  const el      = document.createElement('img');
  el.src        = dataUrl;
  el.className  = 'piece' + (solved ? ' solved' : '');
  el.dataset.index = index;
  el.style.width   = elW + 'px';
  el.style.height  = elH + 'px';
  el.draggable     = false;
  movePieceEl(index, x, y, el);
  board.appendChild(el);
  pieceEls[index] = el;
}

// x,y are inner-rect coords; subtract pad for DOM position
function movePieceEl(index, x, y, el) {
  const pad = meta?._pad ?? 0;
  const e   = el ?? pieceEls[index];
  if (!e) return;
  e.style.left = (x - pad) + 'px';
  e.style.top  = (y - pad) + 'px';
}

// ── Drag ──────────────────────────────────────────────────────────────────────

function attachDragListeners() {
  board.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup',   onMouseUp);
}

async function onMouseDown(e) {
  const el = e.target.closest('.piece');
  if (!el || el.classList.contains('solved')) return;

  const index   = Number(el.dataset.index);
  const state   = pieceStates[index];
  if (state.lockedBy && state.lockedBy !== playerId) return;

  const gid     = pieceGroup[index];
  const indices = gid ? [...groups[gid]] : [index];

  // Check none locked by others
  if (indices.some(i => pieceStates[i].lockedBy && pieceStates[i].lockedBy !== playerId)) return;

  await lockGroup(puzzleId, indices, playerId);

  const boardRect = board.getBoundingClientRect();
  const anchorX   = pieceStates[index].x;
  const anchorY   = pieceStates[index].y;
  const offsetX   = e.clientX - boardRect.left - anchorX;
  const offsetY   = e.clientY - boardRect.top  - anchorY;

  const relOffsets = {};
  indices.forEach(i => {
    relOffsets[i] = {
      dx: pieceStates[i].x - anchorX,
      dy: pieceStates[i].y - anchorY,
    };
  });

  dragging = { indices, anchorIndex: index, offsetX, offsetY, relOffsets };

  indices.forEach(i => {
    pieceEls[i]?.classList.add('dragging');
    if (pieceEls[i]) pieceEls[i].style.zIndex = 1000;
  });
}

function onMouseMove(e) {
  if (!dragging) return;
  const { indices, offsetX, offsetY, relOffsets } = dragging;
  const boardRect = board.getBoundingClientRect();

  const anchorX = e.clientX - boardRect.left - offsetX;
  const anchorY = e.clientY - boardRect.top  - offsetY;

  const positions = [];
  indices.forEach(i => {
    const x = anchorX + relOffsets[i].dx;
    const y = anchorY + relOffsets[i].dy;
    pieceStates[i].x = x;
    pieceStates[i].y = y;
    movePieceEl(i, x, y);
    positions.push({ index: i, x, y });
  });

  updateGroupPosition(puzzleId, positions);
}

async function onMouseUp(e) {
  if (!dragging) return;
  const { indices, anchorIndex, offsetX, offsetY, relOffsets } = dragging;
  dragging = null;

  indices.forEach(i => {
    pieceEls[i]?.classList.remove('dragging');
    if (pieceEls[i]) pieceEls[i].style.zIndex = '';
  });

  const boardRect = board.getBoundingClientRect();
  const anchorX   = e.clientX - boardRect.left - offsetX;
  const anchorY   = e.clientY - boardRect.top  - offsetY;

  const snapped = checkSnap(anchorIndex, anchorX, anchorY);
  if (snapped) {
    const updates = {};
    let newlySolved = 0;
    indices.forEach(i => {
      const x = snapped.x + relOffsets[i].dx;
      const y = snapped.y + relOffsets[i].dy;
      if (!pieceStates[i].solved) newlySolved++;
      pieceStates[i] = { ...pieceStates[i], x, y, solved: true, lockedBy: null };
      movePieceEl(i, x, y);
      pieceEls[i]?.classList.add('solved');
      updates[i] = { x, y };
    });
    solvedCount += newlySolved;

    await solveGroup(puzzleId, updates);
    indices.forEach(i => checkAndMerge(i));
    updateProgress();
    checkCompletion();
  } else {
    await unlockGroup(puzzleId, indices);
    indices.forEach(i => { pieceStates[i].lockedBy = null; });
  }
}

// ── Snap ──────────────────────────────────────────────────────────────────────

function checkSnap(index, x, y) {
  const { cols, _displayW: dW, _displayH: dH } = meta;
  const col      = index % cols;
  const row      = Math.floor(index / cols);
  const originX  = (BOARD_W - dW * meta.cols) / 2;
  const originY  = (BOARD_H - dH * meta.rows) / 2;
  const correctX = originX + col * dW;
  const correctY = originY + row * dH;
  const threshold = Math.max(15, dW * 0.25);
  const dist = Math.hypot(x + dW / 2 - (correctX + dW / 2), y + dH / 2 - (correctY + dH / 2));
  return dist <= threshold ? { x: correctX, y: correctY } : null;
}

// ── Group merging ─────────────────────────────────────────────────────────────

function getNeighbourIndices(index) {
  const { cols, rows } = meta;
  const col = index % cols;
  const row = Math.floor(index / cols);
  const neighbours = [];
  if (row > 0)        neighbours.push(index - cols);
  if (row < rows - 1) neighbours.push(index + cols);
  if (col > 0)        neighbours.push(index - 1);
  if (col < cols - 1) neighbours.push(index + 1);
  return neighbours;
}

function checkAndMerge(index) {
  const solvedNeighbours = getNeighbourIndices(index).filter(n => pieceStates[n]?.solved);
  if (solvedNeighbours.length === 0) return;
  const toMerge = [index, ...solvedNeighbours];
  mergeGroups(toMerge);
}

function mergeGroups(indices) {
  // Collect all existing groupIds among these indices
  const existingIds = [...new Set(indices.map(i => pieceGroup[i]).filter(Boolean))];
  const keepId = existingIds[0] ?? crypto.randomUUID();

  if (!groups[keepId]) groups[keepId] = new Set();

  // Absorb all other groups + ungrouped pieces
  indices.forEach(i => {
    const oldId = pieceGroup[i];
    if (oldId && oldId !== keepId && groups[oldId]) {
      groups[oldId].forEach(j => {
        groups[keepId].add(j);
        pieceGroup[j] = keepId;
      });
      delete groups[oldId];
    } else {
      groups[keepId].add(i);
      pieceGroup[i] = keepId;
    }
  });
}

function reconstructGroups() {
  pieceStates.forEach((p, i) => {
    if (p.solved) checkAndMerge(i);
  });
}

// ── Remote updates ────────────────────────────────────────────────────────────

function applyRemoteUpdate(index, data) {
  if (dragging && dragging.indices.includes(index)) return;

  const wasSolved = pieceStates[index]?.solved;
  pieceStates[index] = { ...pieceStates[index], ...data };

  movePieceEl(index, data.x, data.y);

  if (data.solved && !wasSolved) {
    pieceEls[index]?.classList.add('solved');
    pieceEls[index]?.classList.remove('locked-by-other');
    solvedCount++;
    checkAndMerge(index);
    updateProgress();
    checkCompletion();
    return;
  }

  if (data.lockedBy && data.lockedBy !== playerId) {
    pieceEls[index]?.classList.add('locked-by-other');
  } else {
    pieceEls[index]?.classList.remove('locked-by-other');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  shareUrlEl.textContent = location.href;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(location.href).then(() => {
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
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('playerId', id); }
  return id;
}

window.addEventListener('beforeunload', () => {
  if (unsubscribe) unsubscribe();
  if (dragging) unlockGroup(puzzleId, dragging.indices);
});
