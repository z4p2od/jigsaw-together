import {
  loadPuzzle,
  lockGroup,
  unlockGroup,
  updateGroupPosition,
  writeSnappedPositions,
  solveGroup,
  onPiecesChanged,
  updatePlayerPresence,
  removePlayer,
  onPlayersChanged,
  getPlayerColor,
  setStartedAt,
  updatePieceRotation,
  updateGroupRotation,
  updateGroupRotationAndPositions,
} from './firebase.js';
import { cutPiece, getPad } from './jigsaw.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const BOARD_W   = 900;
const BOARD_H   = 650;
const SCALE_MIN = 0.3;
const SCALE_MAX = 3.0;

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
let scale       = 1;   // current zoom level applied to #puzzle-board
let pinch       = null; // { dist0, scale0 } — active pinch gesture state

// Double-tap for mobile rotate (hard mode only)
let lastTap = { time: 0, el: null };

// Player presence
let playerName  = sessionStorage.getItem('playerName') || null;
let unsubPlayers = null;

// Timer
let timerInterval = null;
let startedAt     = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const board           = document.getElementById('puzzle-board');
const loadingEl       = document.getElementById('loading-overlay');
const loadingText     = document.getElementById('loading-text');
const celebration     = document.getElementById('celebration');
const celebrationTime = document.getElementById('celebration-time');
const progressEl      = document.getElementById('progress-text');
const shareUrlEl      = document.getElementById('share-url');
const copyBtn         = document.getElementById('copy-btn');
const playersListEl   = document.getElementById('players-list');
const timerEl         = document.getElementById('timer-display');
const nameModal       = document.getElementById('name-modal');
const nameInput       = document.getElementById('name-input');
const nameSubmit      = document.getElementById('name-submit');
const helpModal       = document.getElementById('help-modal');
const helpList        = document.getElementById('help-list');
const helpClose       = document.getElementById('help-close');
const helpBtn         = document.getElementById('help-btn');
const peekBtn         = document.getElementById('peek-btn');
const boxCover        = document.getElementById('box-cover');
const boxCoverImg     = document.getElementById('box-cover-img');

// ── Boot ──────────────────────────────────────────────────────────────────────

if (!puzzleId) {
  location.href = '/';
} else {
  askNameThenInit();
}

async function askNameThenInit() {
  if (!playerName) {
    playerName = await showNameModal();
    sessionStorage.setItem('playerName', playerName);
  }
  nameModal.style.display = 'none';
  initPuzzle();
}

function showNameModal() {
  return new Promise(resolve => {
    nameModal.style.display = 'flex';
    nameInput.focus();
    const submit = () => {
      const name = nameInput.value.trim() || 'Anonymous';
      resolve(name);
    };
    nameSubmit.addEventListener('click', submit);
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  });
}

async function initPuzzle() {
  try {
    loadingText.textContent = 'Loading puzzle...';
    const data  = await loadPuzzle(puzzleId);
    meta        = data.meta;
    pieceStates = Object.values(data.pieces);
    totalPieces = pieceStates.length;
    solvedCount = pieceStates.filter(p => p.solved).length;

    if (meta.hardMode) document.getElementById('hard-badge').style.display = '';

    setupBoard();
    await renderAllPieces();
    reconstructGroups();
    setupShareLink();
    attachDragListeners();

    setupHelp();
    setupPeek();

    unsubscribe = onPiecesChanged(puzzleId, applyRemoteUpdate);
    unsubPlayers = onPlayersChanged(puzzleId, renderPlayers);

    // Register this player
    await updatePlayerPresence(puzzleId, playerId, playerName);
    // Heartbeat every 15s
    setInterval(() => updatePlayerPresence(puzzleId, playerId, playerName), 15000);

    // Timer — resume if already started; update display immediately so
    // late-joining players see the current elapsed time without a 1s delay.
    if (meta.startedAt) {
      startedAt = meta.startedAt;
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      timerEl.textContent = formatTime(secs);
      startTimer();
    }

    loadingEl.style.display = 'none';
    updateProgress();
  } catch (err) {
    console.error(err);
    loadingText.textContent = 'Puzzle not found.';
  }
}

function setupBoard() {
  board.style.width          = BOARD_W + 'px';
  board.style.height         = BOARD_H + 'px';
  board.style.transformOrigin = 'top left';
}

// ── Rendering ─────────────────────────────────────────────────────────────────

async function renderAllPieces() {
  const img = await loadImage('data:image/jpeg;base64,' + meta.imageData);
  const { cols, rows, pieceW, pieceH, edges, displayW, displayH } = meta;
  const pad = getPad(displayW, displayH);

  // Store on meta for use by snap/move logic
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
  updatePieceZIndex(index);
}

// Position and rotate a piece using a single CSS transform.
// x,y are inner-rect coords (top-left of the unpadded cell).
// We translate by (x-pad, y-pad) then rotate around the element centre.
// Using transform for both keeps positioning and rotation independent —
// no interaction between left/top and rotate.
function movePieceEl(index, x, y, el) {
  const pad = meta?._pad ?? 0;
  const e   = el ?? pieceEls[index];
  if (!e) return;
  const rot = pieceStates[index]?.rotation ?? 0;
  e.style.left = '0';
  e.style.top  = '0';
  e.style.transform = rot
    ? `translate(${x - pad}px, ${y - pad}px) rotate(${rot}deg)`
    : `translate(${x - pad}px, ${y - pad}px)`;
}


// Set z-index so tab edges render on top of the slot pieces they protrude into.
// A right-tab on piece (col,row) protrudes into (col+1,row) → needs z > that piece.
// A bottom-tab protrudes into (col,row+1) → needs z > that piece.
// Solution: z = (cols-col) + (rows-row)*cols so pieces with smaller col/row
// get higher z when they have tabs pointing toward higher col/row neighbours.
function updatePieceZIndex(index) {
  const e = pieceEls[index];
  if (!e || e.classList.contains('dragging')) return;
  const edges = meta?.edges?.[index];
  if (!edges || !meta.cols || !meta.rows) return;
  const col = index % meta.cols;
  const row = Math.floor(index / meta.cols);
  // Base z from grid position (lower col/row = higher z by default)
  let z = (meta.cols - col) + (meta.rows - row);
  // Boost if this piece has tabs pointing right or down (into higher-index neighbours)
  if (edges.right > 0) z += meta.rows;
  if (edges.bottom > 0) z += meta.cols;
  e.style.zIndex = z;
}

// ── Drag ──────────────────────────────────────────────────────────────────────

function attachDragListeners() {
  board.addEventListener('mousedown',   onMouseDown);
  board.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('mousemove',  onMouseMove);
  window.addEventListener('mouseup',    onMouseUp);

  // Double-tap for mobile rotation (hard mode only)
  board.addEventListener('touchend', onDoubleTap);

  // Use the wrap for touch so pinch-to-zoom works even when fingers start outside board
  const wrap = board.parentElement;
  wrap.addEventListener('touchstart', onTouchStart, { passive: false });
  wrap.addEventListener('touchmove',  onTouchMove,  { passive: false });
  wrap.addEventListener('touchend',   onTouchEnd);
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

  // Start timer on first move
  if (!startedAt) {
    startedAt = await setStartedAt(puzzleId);
    startTimer();
  }

  const boardRect = board.getBoundingClientRect();
  const anchorX   = pieceStates[index].x;
  const anchorY   = pieceStates[index].y;
  // Divide by scale to convert screen pixels to board (unscaled) coordinates
  const offsetX   = (e.clientX - boardRect.left) / scale - anchorX;
  const offsetY   = (e.clientY - boardRect.top)  / scale - anchorY;

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

  const anchorX = (e.clientX - boardRect.left) / scale - offsetX;
  const anchorY = (e.clientY - boardRect.top)  / scale - offsetY;

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
  const anchorX   = (e.clientX - boardRect.left) / scale - offsetX;
  const anchorY   = (e.clientY - boardRect.top)  / scale - offsetY;

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
    const { cols, _displayW: dW, _displayH: dH } = meta;

    // Collect every piece index in the newly merged group
    const neighbourGroupIndices = pieceGroup[snap.neighbourIndex]
      ? [...groups[pieceGroup[snap.neighbourIndex]]]
      : [snap.neighbourIndex];
    const allIndices = [...new Set([...indices, ...neighbourGroupIndices])];

    // Anchor = the stationary neighbour piece. Compute every piece's exact position
    // from grid coordinates relative to the anchor. This prevents any accumulated error.
    const anchorIdx = snap.neighbourIndex;
    const anchorCol = anchorIdx % cols;
    const anchorRow = Math.floor(anchorIdx / cols);
    const anchorX   = pieceStates[anchorIdx].x;
    const anchorY   = pieceStates[anchorIdx].y;

    // Rotation of the snapping pieces (both sides share the same rotation)
    const rot = pieceStates[snap.neighbourIndex].rotation ?? 0;

    const positions = [];
    allIndices.forEach(i => {
      const iCol = i % cols;
      const iRow = Math.floor(i / cols);
      const dcI  = iCol - anchorCol;
      const drI  = iRow - anchorRow;
      // Offset from anchor to piece i in inner-rect coords.
      // Same rotation formula: 90° CW maps (dx,dy)→(-dy,dx).
      let ox, oy;
      if (rot === 0)        { ox =  dcI * dW;   oy =  drI * dH;  }
      else if (rot === 90)  { ox = -drI * dH;   oy =  dcI * dW;  }
      else if (rot === 180) { ox = -dcI * dW;   oy = -drI * dH;  }
      else                  { ox =  drI * dH;   oy = -dcI * dW;  }
      const x = anchorX + ox;
      const y = anchorY + oy;
      pieceStates[i] = { ...pieceStates[i], x, y, lockedBy: null };
      movePieceEl(i, x, y);
      positions.push({ index: i, x, y });
    });

    // Write snapped positions + clear locks in one batch so Firebase is
    // authoritative and the remote listener won't overwrite our positions.
    mergeGroups(allIndices);
    // Persist groupId so late-joining players reconstruct the same groups
    const gid = pieceGroup[allIndices[0]];
    await writeSnappedPositions(puzzleId, positions, gid);
    checkSolvedState();
    updateProgress();
    checkCompletion();
  } else {
    await unlockGroup(puzzleId, indices);
    indices.forEach(i => { pieceStates[i].lockedBy = null; });
  }
}

function onTouchStart(e) {
  if (e.touches.length === 2) {
    // Two fingers — start pinch zoom; cancel any ongoing drag
    if (dragging) {
      unlockGroup(puzzleId, dragging.indices);
      dragging.indices.forEach(i => {
        pieceEls[i]?.classList.remove('dragging');
        if (pieceEls[i]) pieceEls[i].style.zIndex = '';
      });
      dragging = null;
    }
    pinch = { dist0: touchDist(e.touches), scale0: scale };
    e.preventDefault();
    return;
  }

  if (pinch) return; // ignore single-finger start during active pinch

  const touch = e.touches[0];
  onMouseDown({ clientX: touch.clientX, clientY: touch.clientY,
                target: document.elementFromPoint(touch.clientX, touch.clientY) })
    .then(() => { if (dragging) e.preventDefault(); });
}

function onTouchMove(e) {
  if (e.touches.length === 2 && pinch) {
    e.preventDefault();
    const newDist = touchDist(e.touches);
    const raw     = pinch.scale0 * (newDist / pinch.dist0);
    applyScale(Math.min(SCALE_MAX, Math.max(SCALE_MIN, raw)));
    return;
  }

  if (!dragging) return;
  e.preventDefault();
  const touch = e.touches[0];
  onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
}

function onTouchEnd(e) {
  if (pinch && e.touches.length < 2) {
    pinch = null;
    return;
  }

  if (!dragging) return;
  const touch = e.changedTouches[0];
  onMouseUp({ clientX: touch.clientX, clientY: touch.clientY });
}

// ── Rotation ──────────────────────────────────────────────────────────────────

function onContextMenu(e) {
  e.preventDefault();
  if (!meta?.hardMode) return;
  const el = e.target.closest('.piece');
  if (!el) return;
  const index = Number(el.dataset.index);
  if (pieceStates[index].lockedBy && pieceStates[index].lockedBy !== playerId) return;
  rotateAtIndex(index);
}

function onDoubleTap(e) {
  if (!meta?.hardMode) return;
  const touch = e.changedTouches[0];
  const el    = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.piece');
  if (!el) return;

  const now  = Date.now();
  const same = lastTap.el === el && (now - lastTap.time) < 300;
  lastTap = { time: now, el };
  if (!same) return;

  // Double-tap confirmed
  e.preventDefault();
  const index = Number(el.dataset.index);
  if (pieceStates[index].lockedBy && pieceStates[index].lockedBy !== playerId) return;
  rotateAtIndex(index);
}

function rotateAtIndex(index) {
  const gid     = pieceGroup[index];
  const indices = gid ? [...groups[gid]] : [index];
  const newRot  = ((pieceStates[index].rotation ?? 0) + 90) % 360;
  const { _displayW: dW, _displayH: dH } = meta;

  if (indices.length === 1) {
    // Single piece — update rotation only, position unchanged
    pieceStates[index].rotation = newRot;
    movePieceEl(index, pieceStates[index].x, pieceStates[index].y);
    updatePieceRotation(puzzleId, index, newRot);
    return;
  }

  // Group — rotate all piece positions 90° CW around the group's bounding-box centre.
  // Each piece's logical position is its top-left inner-rect corner (x, y).
  // The piece centre is at (x + dW/2, y + dH/2).
  const cx = indices.reduce((s, i) => s + pieceStates[i].x + dW / 2, 0) / indices.length;
  const cy = indices.reduce((s, i) => s + pieceStates[i].y + dH / 2, 0) / indices.length;

  const positions = [];
  indices.forEach(i => {
    // Rotate piece centre 90° CW in screen coords (y-down): newPx = cx-(py-cy), newPy = cy+(px-cx)
    const px   = pieceStates[i].x + dW / 2;
    const py   = pieceStates[i].y + dH / 2;
    const newX = cx - (py - cy) - dW / 2;
    const newY = cy + (px - cx) - dH / 2;
    pieceStates[i].x        = newX;
    pieceStates[i].y        = newY;
    pieceStates[i].rotation = newRot;
    movePieceEl(i, newX, newY);
    positions.push({ index: i, x: newX, y: newY });
  });

  // Batch write new positions + rotation in one call
  updateGroupRotationAndPositions(puzzleId, positions, newRot);
}

function touchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function applyScale(s) {
  scale = s;
  board.style.transform = scale === 1 ? '' : `scale(${scale})`;
  // CSS transform doesn't affect layout, so manually size a margin-bottom/right
  // on the board so the wrap's scrollbars track the scaled dimensions.
  const extraW = BOARD_W * (scale - 1);
  const extraH = BOARD_H * (scale - 1);
  board.style.marginRight  = extraW > 0 ? extraW + 'px' : '';
  board.style.marginBottom = extraH > 0 ? extraH + 'px' : '';
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
  const threshold = Math.max(40, Math.min(dW, dH) * 0.4);  // 40% of smaller piece side
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

      // Both pieces must be at the same rotation to snap
      const rot = pieceStates[i].rotation ?? 0;
      if (rot !== (pieceStates[nIdx].rotation ?? 0)) continue;

      // Actual relative offset between x/y (inner-rect top-left) positions
      const actualDx = pieceStates[i].x - pieceStates[nIdx].x;
      const actualDy = pieceStates[i].y - pieceStates[nIdx].y;

      // Expected offset between inner-rect top-lefts (x/y coords).
      // At 0°: (-dc*dW, -dr*dH). Rotate 90° CW: (dx,dy)→(-dy,dx).
      let expectedDx, expectedDy;
      if (rot === 0) {
        expectedDx = -dc * dW;   expectedDy = -dr * dH;
      } else if (rot === 90) {
        expectedDx =  dr * dH;   expectedDy = -dc * dW;
      } else if (rot === 180) {
        expectedDx =  dc * dW;   expectedDy =  dr * dH;
      } else { // 270
        expectedDx = -dr * dH;   expectedDy =  dc * dW;
      }

      const dist = Math.hypot(actualDx - expectedDx, actualDy - expectedDy);

      console.log(`piece ${i} → neighbour ${nIdx}: edgeID=${eI[myEdge]}, dist=${dist.toFixed(1)}, threshold=${threshold.toFixed(1)}`);

      if (dist <= threshold) {
        const targetX = pieceStates[nIdx].x + expectedDx;
        const targetY = pieceStates[nIdx].y + expectedDy;
        console.log(`✅ SNAP: piece ${i} → ${nIdx}`);
        return {
          dragIndex:      i,
          neighbourIndex: nIdx,
          targetX,
          targetY,
        };
      }
    }
  }
  return null;
}

/**
 * Check if all pieces are in one group → puzzle complete.
 */
function checkSolvedState() {
  for (let i = 0; i < totalPieces; i++) {
    const gid = pieceGroup[i];
    if (!gid) continue;
    if (groups[gid]?.size === totalPieces) {
      // All pieces joined — mark solved in Firebase
      const updates = {};
      groups[gid].forEach(j => {
        pieceStates[j] = { ...pieceStates[j], solved: true, lockedBy: null };
        pieceEls[j]?.classList.add('solved');
        updates[j] = { x: pieceStates[j].x, y: pieceStates[j].y };
      });
      solvedCount = totalPieces;
      solveGroup(puzzleId, updates);
      return;
    }
    return; // only need to check first grouped piece
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
  // Rebuild groups from groupId stored in Firebase (set when pieces snap together)
  pieceStates.forEach((p, i) => {
    if (p.groupId) {
      if (!groups[p.groupId]) groups[p.groupId] = new Set();
      groups[p.groupId].add(i);
      pieceGroup[i] = p.groupId;
    }
  });
}

// ── Remote updates ────────────────────────────────────────────────────────────

function applyRemoteUpdate(index, data) {
  if (dragging && dragging.indices.includes(index)) return;

  const wasSolved  = pieceStates[index]?.solved;
  const wasGroupId = pieceStates[index]?.groupId;
  pieceStates[index] = { ...pieceStates[index], ...data };

  movePieceEl(index, data.x, data.y);

  // If this piece just joined a group (from another player's snap), merge locally
  if (data.groupId && data.groupId !== wasGroupId) {
    // Find all pieces with this groupId and merge them
    const groupMembers = pieceStates
      .map((p, i) => p.groupId === data.groupId ? i : -1)
      .filter(i => i >= 0);
    if (groupMembers.length > 1) mergeGroups(groupMembers);
    updateProgress();
  }

  if (data.solved && !wasSolved) {
    pieceEls[index]?.classList.add('solved');
    pieceEls[index]?.classList.remove('locked-by-other');
    solvedCount++;
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
  const done = solvedCount >= totalPieces ||
    (() => { const gids = new Set(pieceGroup.filter(Boolean)); return gids.size === 1 && groups[[...gids][0]]?.size === totalPieces; })();
  if (!done) return;

  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  stopTimer();
  if (startedAt) {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    celebrationTime.textContent = `Solved in ${formatTime(secs)}`;
  }
  celebration.classList.add('show');
}

function setupHelp() {
  const controls = [
    { key: 'Drag',            desc: 'Move a piece or a connected group' },
    { key: 'Drop near edge',  desc: 'Pieces snap together automatically' },
    { key: 'Pinch (mobile)',  desc: 'Zoom in / out' },
    { key: 'Scroll',          desc: 'Pan the board' },
  ];
  if (meta.hardMode) {
    controls.push({ key: 'Right-click',  desc: 'Rotate a piece or group 90°' });
    controls.push({ key: 'Double-tap',   desc: 'Rotate a piece or group on mobile' });
  }
  helpList.innerHTML = controls.map(c =>
    `<li><strong>${c.key}</strong>${c.desc}</li>`
  ).join('');

  helpBtn.addEventListener('click', () => {
    helpModal.style.display = 'flex';
  });
  helpClose.addEventListener('click', () => {
    helpModal.style.display = 'none';
  });
  helpModal.addEventListener('click', e => {
    if (e.target === helpModal) helpModal.style.display = 'none';
  });
}

function setupPeek() {
  boxCoverImg.src = 'data:image/jpeg;base64,' + meta.imageData;

  const toggle = () => boxCover.classList.toggle('show');
  const hide   = () => boxCover.classList.remove('show');

  peekBtn.addEventListener('click', toggle);
  boxCover.addEventListener('click', hide);
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

// ── Players ───────────────────────────────────────────────────────────────────

function renderPlayers(players) {
  // Remove players inactive > 30s
  const now = Date.now();
  playersListEl.innerHTML = '';
  Object.entries(players).forEach(([id, p]) => {
    if (now - p.lastSeen > 30000) return;
    const dot = document.createElement('div');
    dot.className = 'player-dot';
    dot.style.background = p.color;
    dot.title = p.name;
    dot.textContent = p.name[0].toUpperCase();
    if (id === playerId) dot.classList.add('me');
    playersListEl.appendChild(dot);
  });
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function startTimer() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    timerEl.textContent = formatTime(secs);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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
  if (unsubPlayers) unsubPlayers();
  if (dragging) unlockGroup(puzzleId, dragging.indices);
  removePlayer(puzzleId, playerId);
});
