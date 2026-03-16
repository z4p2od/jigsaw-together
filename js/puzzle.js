import {
  loadPuzzle,
  lockGroup,
  unlockGroup,
  updateGroupPosition,
  solveGroup,
  onPiecesChanged,
} from './firebase.js';
import { cutPiece, getPad } from './jigsaw.js';

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
  const pad      = getPad(displayW, displayH);

  meta._displayW = displayW;
  meta._displayH = displayH;
  meta._pad      = pad;

  console.log(`Board: ${BOARD_W}×${BOARD_H}, piece display: ${displayW}×${displayH}, pad: ${pad}, threshold: ${Math.max(60, displayW * 0.6).toFixed(1)}`);
  console.log('Piece positions:', pieceStates.map((p,i) => `${i}:(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' '));

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

  // Apply final positions locally
  indices.forEach(i => {
    const x = anchorX + relOffsets[i].dx;
    const y = anchorY + relOffsets[i].dy;
    pieceStates[i].x = x;
    pieceStates[i].y = y;
    movePieceEl(i, x, y);
  });

  // Check if any piece in the dragged group is close enough to snap to a neighbour
  const snap = findNeighbourSnap(indices);
  if (snap) {
    // snap = { dragIndex, neighbourIndex, dx, dy }
    // Shift the entire group so dragIndex aligns perfectly with its neighbour
    const updates = {};
    indices.forEach(i => {
      const x = pieceStates[i].x + snap.dx;
      const y = pieceStates[i].y + snap.dy;
      pieceStates[i] = { ...pieceStates[i], x, y, lockedBy: null };
      movePieceEl(i, x, y);
      updates[i] = { x, y };
    });
    // Update Firebase positions (not solved yet — just merged)
    await unlockGroup(puzzleId, indices);
    // Merge groups locally
    mergeGroups([...indices, snap.neighbourIndex,
      ...(pieceGroup[snap.neighbourIndex] ? [...groups[pieceGroup[snap.neighbourIndex]]] : [])
    ]);
    // Check if fully solved (all pieces in one group at correct positions)
    checkSolvedState();
    updateProgress();
    checkCompletion();
  } else {
    await unlockGroup(puzzleId, indices);
    indices.forEach(i => { pieceStates[i].lockedBy = null; });
  }
}

// ── Snap / merge ──────────────────────────────────────────────────────────────

/**
 * Check if any piece in the dragged group is close enough to snap
 * to a neighbouring piece outside the group.
 *
 * Uses edge IDs to ensure only truly adjacent pieces snap together.
 * Each shared edge has a unique ID — piece A's right edge ID must equal
 * piece B's left edge ID (they are the same physical edge).
 *
 * Returns { dragIndex, neighbourIndex, dx, dy } — exact correction offset
 * to perfectly align the two pieces. Returns null if no snap found.
 */
function findNeighbourSnap(dragIndices) {
  const { cols, rows, _displayW: dW, _displayH: dH, edges } = meta;
  const threshold = Math.max(80, Math.min(dW, dH));  // up to one full piece dimension
  const dragSet   = new Set(dragIndices);

  // For each direction: which edge ID of piece i must match which edge ID of neighbour
  const checks = [
    { dc:  0, dr: -1, myEdge: 'idTop',    neighbourEdge: 'idBottom' }, // neighbour above
    { dc:  0, dr:  1, myEdge: 'idBottom', neighbourEdge: 'idTop'    }, // neighbour below
    { dc: -1, dr:  0, myEdge: 'idLeft',   neighbourEdge: 'idRight'  }, // neighbour left
    { dc:  1, dr:  0, myEdge: 'idRight',  neighbourEdge: 'idLeft'   }, // neighbour right
  ];

  for (const i of dragIndices) {
    const col    = i % cols;
    const row    = Math.floor(i / cols);
    const eI     = edges[i];

    for (const { dc, dr, myEdge, neighbourEdge } of checks) {
      const nCol = col + dc;
      const nRow = row + dr;
      if (nCol < 0 || nCol >= cols || nRow < 0 || nRow >= rows) continue;

      const nIdx = nRow * cols + nCol;
      if (dragSet.has(nIdx)) continue; // same dragged group

      const eN = edges[nIdx];

      // Edge IDs must match (they share the same physical edge)
      // Border edges have id=0 — skip those
      if (eI[myEdge] === 0 || eI[myEdge] !== eN[neighbourEdge]) continue;

      // Actual relative offset between piece i and its neighbour
      const actualDx = pieceStates[i].x - pieceStates[nIdx].x;
      const actualDy = pieceStates[i].y - pieceStates[nIdx].y;

      // Expected relative offset if perfectly aligned
      const expectedDx = dc * dW;
      const expectedDy = dr * dH;

      const dist = Math.hypot(actualDx - expectedDx, actualDy - expectedDy);

      console.log(`piece ${i} → neighbour ${nIdx}: edgeID=${eI[myEdge]}, dist=${dist.toFixed(1)}, threshold=${threshold.toFixed(1)}`);

      if (dist <= threshold) {
        // Shift piece i (and its group) so it aligns perfectly with nIdx
        const snapDx = expectedDx - actualDx;
        const snapDy = expectedDy - actualDy;
        console.log(`✅ SNAP: piece ${i} → ${nIdx}`);
        return {
          dragIndex:      i,
          neighbourIndex: nIdx,
          dx:             snapDx,
          dy:             snapDy,
        };
      }
    }
  }
  return null;
}

/**
 * Check if all pieces are now in the same group and at correct relative positions.
 * Mark them all solved if so.
 */
function checkSolvedState() {
  const { cols, _displayW: dW, _displayH: dH } = meta;
  const originX = (BOARD_W - dW * meta.cols) / 2;
  const originY = (BOARD_H - dH * meta.rows) / 2;

  // Find a reference piece that we can use to check if group is at correct absolute position
  for (let i = 0; i < totalPieces; i++) {
    const gid = pieceGroup[i];
    if (!gid) continue;
    const g = groups[gid];
    if (g.size !== totalPieces) continue;

    // All pieces in one group — check if position is correct
    const col = i % cols;
    const row = Math.floor(i / cols);
    const correctX = originX + col * dW;
    const correctY = originY + row * dH;
    const dist = Math.hypot(pieceStates[i].x - correctX, pieceStates[i].y - correctY);
    if (dist < dW * 0.5) {
      // Mark all solved
      const updates = {};
      let newlySolved = 0;
      g.forEach(j => {
        if (!pieceStates[j].solved) newlySolved++;
        const jCol = j % cols;
        const jRow = Math.floor(j / cols);
        const x = originX + jCol * dW;
        const y = originY + jRow * dH;
        pieceStates[j] = { ...pieceStates[j], x, y, solved: true, lockedBy: null };
        movePieceEl(j, x, y);
        pieceEls[j]?.classList.add('solved');
        updates[j] = { x, y };
      });
      solvedCount = totalPieces;
      solveGroup(puzzleId, updates);
    }
    return;
  }
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
  // Count pieces that are in a group (merged) as "placed"
  const placed = pieceStates.filter((p, i) => pieceGroup[i] || p.solved).length;
  progressEl.textContent = `${placed} / ${totalPieces} pieces`;
}

function checkCompletion() {
  if (solvedCount >= totalPieces) {
    if (unsubscribe) unsubscribe();
    celebration.classList.add('show');
  }
  // Also check if all pieces are in one group
  const gids = new Set(pieceGroup.filter(Boolean));
  if (gids.size === 1 && groups[[...gids][0]]?.size === totalPieces) {
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
