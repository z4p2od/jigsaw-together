import {
  loadVSRoom, joinVSRoom, setVSReady, onVSRoom,
  initVSPieces, onVSPieces, onVSOpponentPieces,
  updateVSGroupPosition, lockVSGroup, unlockVSGroup,
  writeVSSnap, updateVSPieceRotation,
  updateVSGroupRotationAndPositions, solveVSGroup,
  setVSPlaying, setVSWinner, setVSFinished, setVSRematch,
  getPlayerColor,
  sendChatMessage, onChatMessages,
} from './firebase.js';
import { cutPiece, getPad } from './jigsaw.js';

const BOARD_W   = 900;
const BOARD_H   = 650;
const SCALE_MIN = 0.3;
const SCALE_MAX = 3.0;

const roomId   = new URLSearchParams(location.search).get('room');
const playerId = getOrCreatePlayerId();

let playerName  = sessionStorage.getItem('playerName') || null;
let meta        = null;
let pieceEls    = [];
let pieceStates = [];
let solvedCount = 0;
let totalPieces = 0;
let startedAt   = null;
let timerInterval = null;
let unsubRoom   = null;
let unsubPieces = null;
let unsubOpp    = null;
let gameStarted = false;
let winnerDeclared = false;

const groups    = {};
const pieceGroup = [];
let dragging    = null;
let scale       = 1;
let pinch       = null;
let lastTap     = { time: 0, el: null };

// Chat
let chatUnread = 0;
let chatOpen   = false;

// Win counter (persisted in sessionStorage for rematch series)
// key: sorted pair of playerIds joined by '|'
function winsKey(oppId) {
  return 'vsWins:' + [playerId, oppId].sort().join('|');
}
function getWins(oppId) {
  const raw = sessionStorage.getItem(winsKey(oppId));
  return raw ? JSON.parse(raw) : { [playerId]: 0, [oppId]: 0 };
}
function recordWin(winnerId, oppId) {
  const wins = getWins(oppId);
  wins[winnerId] = (wins[winnerId] ?? 0) + 1;
  sessionStorage.setItem(winsKey(oppId), JSON.stringify(wins));
  return wins;
}

// Opponent board (read-only)
const oppPieceEls    = [];
const oppPieceStates = [];
const oppGroups      = {};
const oppPieceGroup  = [];

// DOM refs
const loadingEl      = document.getElementById('loading-overlay');
const loadingText    = document.getElementById('loading-text');
const nameModal      = document.getElementById('name-modal');
const nameInput      = document.getElementById('name-input');
const nameSubmit     = document.getElementById('name-submit');
const helpModal      = document.getElementById('help-modal');
const helpList       = document.getElementById('help-list');
const helpClose      = document.getElementById('help-close');
const helpBtn        = document.getElementById('help-btn');
const peekBtn        = document.getElementById('peek-btn');
const boxCover       = document.getElementById('box-cover');
const boxCoverImg    = document.getElementById('box-cover-img');
const vsLobby        = document.getElementById('vs-lobby');
const vsReadyBtn     = document.getElementById('vs-ready-btn');
const vsShareUrl     = document.getElementById('vs-share-url');
const vsCopyBtn      = document.getElementById('vs-copy-btn');
const vsLobbyStatus  = document.getElementById('vs-lobby-status');
const vsCountdown    = document.getElementById('vs-countdown');
const vsCountNum     = document.getElementById('vs-countdown-num');
const vsResult       = document.getElementById('vs-result');
const vsResultTitle  = document.getElementById('vs-result-title');
const vsResultTimes  = document.getElementById('vs-result-times');
const vsRematchBtn   = document.getElementById('vs-rematch-btn');
const vsScoreBoard   = document.getElementById('vs-score-board');
const vsScoreMe      = document.getElementById('vs-score-me');
const vsScoreOpp     = document.getElementById('vs-score-opp');
const vsGame         = document.getElementById('vs-game');
const board          = document.getElementById('puzzle-board');
const oppBoard       = document.getElementById('puzzle-board-opp');
const oppBoardLabel  = document.getElementById('opp-board-label');
const chatBtn        = document.getElementById('chat-btn');
const chatPanel      = document.getElementById('chat-panel');
const chatClose      = document.getElementById('chat-close');
const chatMessages   = document.getElementById('chat-messages');
const chatInput      = document.getElementById('chat-input');
const chatSendBtn    = document.getElementById('chat-send');
const timerEl        = document.getElementById('timer-display');
const vspMeName      = document.getElementById('vsp-me-name');
const vspMeFill      = document.getElementById('vsp-me-fill');
const vspMePct       = document.getElementById('vsp-me-pct');
const vspOppName     = document.getElementById('vsp-opp-name');
const vspOppFill     = document.getElementById('vsp-opp-fill');
const vspOppPct      = document.getElementById('vsp-opp-pct');

// ── Boot ──────────────────────────────────────────────────────────────────────

if (!roomId) { location.href = '/'; }
else { askNameThenInit(); }

async function askNameThenInit() {
  if (!playerName) {
    playerName = await showNameModal();
    sessionStorage.setItem('playerName', playerName);
  }
  nameModal.style.display = 'none';
  initVS();
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

function getOrCreatePlayerId() {
  let id = sessionStorage.getItem('playerId');
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('playerId', id); }
  return id;
}

// ── Seeded scatter (same seed = same positions for both players) ──────────────

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function scatterFromSeed(seed, count, dispW, dispH, hardMode) {
  const rand = seededRandom(seed);
  const ROTS = [0, 90, 180, 270];
  return Array.from({ length: count }, () => ({
    x: rand() * (BOARD_W - dispW),
    y: rand() * (BOARD_H - dispH),
    rotation: hardMode ? ROTS[Math.floor(rand() * 4)] : 0,
  }));
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function initVS() {
  try {
    loadingText.textContent = 'Loading room…';
    const room = await loadVSRoom(roomId);
    meta = room.meta;

    const color = getPlayerColor(playerId);
    await joinVSRoom(roomId, playerId, playerName, color);

    // Share link in lobby
    vsShareUrl.textContent = location.href;
    vsCopyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(location.href).then(() => {
        vsCopyBtn.textContent = 'Copied!';
        setTimeout(() => (vsCopyBtn.textContent = 'Copy Link'), 2000);
      });
    });

    // Ready button
    vsReadyBtn.disabled = false;
    vsReadyBtn.addEventListener('click', () => {
      vsReadyBtn.disabled = true;
      vsReadyBtn.textContent = 'Waiting…';
      setVSReady(roomId, playerId);
    });

    // Rematch button — creates a new room with same settings,
    // then writes rematchRoomId so the opponent auto-follows
    vsRematchBtn.addEventListener('click', async () => {
      vsRematchBtn.disabled = true;
      vsRematchBtn.textContent = 'Creating rematch…';
      const pieces = meta?.pieces ?? 100;
      const hard   = meta?.hardMode ?? false;
      try {
        const res     = await fetch(`/api/vs-create?pieces=${pieces}&hard=${hard}&json=1`);
        const { roomId: newRoom } = await res.json();
        if (newRoom) {
          await setVSRematch(roomId, newRoom);
          location.href = `/vs.html?room=${newRoom}`;
        }
      } catch {
        vsRematchBtn.disabled = false;
        vsRematchBtn.textContent = '⚡ Rematch';
      }
    });

    loadingEl.style.display = 'none';

    // Subscribe to room — drives all state transitions
    unsubRoom = onVSRoom(roomId, handleRoomUpdate);
  } catch (err) {
    console.error(err);
    loadingText.textContent = 'Room not found.';
  }
}

let prevStatus = null;

function handleRoomUpdate(room) {
  if (!room) return;
  const { meta: m, players = {}, pieces = {} } = room;

  updateLobbyUI(players);

  if (m.status === 'waiting' || m.status === 'ready') {
    // Check if all present players are ready → start countdown
    const playerList = Object.values(players);
    if (playerList.length === 2 && playerList.every(p => p.ready) && prevStatus !== 'playing' && prevStatus !== 'done') {
      // Only one player triggers the countdown + setVSPlaying to avoid double-fire
      const ids = Object.keys(players).sort();
      if (ids[0] === playerId) setVSPlaying(roomId);
    }
  }

  if (m.status === 'playing' && !gameStarted) {
    gameStarted = true;
    startedAt = m.startedAt;
    startCountdown().then(() => startGame(room));
  }

  if (m.status === 'done' && prevStatus !== 'done') {
    showResult(room);
  }

  // Opponent clicked Rematch first — follow them to the new room
  if (m.rematchRoomId && m.status === 'done') {
    location.href = `/vs.html?room=${m.rematchRoomId}`;
    return;
  }

  prevStatus = m.status;
}

function updateLobbyUI(players) {
  const ids = Object.keys(players);
  for (let slot = 0; slot < 2; slot++) {
    const pid  = ids[slot];
    const p    = pid ? players[pid] : null;
    const avatarEl = document.getElementById(`vs-avatar-${slot}`);
    const nameEl   = document.getElementById(`vs-name-${slot}`);
    const readyEl  = document.getElementById(`vs-ready-${slot}`);
    if (p) {
      avatarEl.textContent    = p.name[0].toUpperCase();
      avatarEl.style.background = p.color;
      nameEl.textContent      = pid === playerId ? `${p.name} (you)` : p.name;
      readyEl.textContent     = p.ready ? '✓ Ready' : '';
      readyEl.style.color     = p.ready ? '#34d399' : '';
    } else {
      avatarEl.textContent    = '?';
      avatarEl.style.background = 'var(--surface2)';
      nameEl.textContent      = 'Waiting…';
      readyEl.textContent     = '';
    }
  }
  if (ids.length < 2) {
    vsLobbyStatus.textContent = 'Waiting for opponent to join…';
  } else {
    const allReady = Object.values(players).every(p => p.ready);
    vsLobbyStatus.textContent = allReady ? 'Starting…' : 'Both players must click Ready!';
    vsReadyBtn.style.display = '';
  }
  // Show my name in progress bar
  const me = players[playerId];
  if (me) vspMeName.textContent = me.name + ' (you)';
  const oppId = Object.keys(players).find(id => id !== playerId);
  if (oppId) vspOppName.textContent = players[oppId].name;
}

function startCountdown() {
  return new Promise(resolve => {
    vsLobby.style.display = 'none';
    vsCountdown.style.display = 'flex';
    const steps = ['3', '2', '1', 'GO!'];
    let i = 0;
    const tick = () => {
      vsCountNum.textContent = steps[i];
      i++;
      if (i < steps.length) setTimeout(tick, 800);
      else setTimeout(() => { vsCountdown.style.display = 'none'; resolve(); }, 600);
    };
    tick();
  });
}

async function startGame(room) {
  const { meta: m, pieces: existingPieces = {}, players = {} } = room;
  meta = m;

  vsGame.style.display = '';

  // Compute split-board scale so both boards fit side by side
  scale = computeSplitScale();

  const count     = m.cols * m.rows;
  totalPieces     = count;
  const scattered = scatterFromSeed(m.seed, count, m.displayW, m.displayH, m.hardMode);

  // Init my pieces in Firebase only if not already there
  if (!existingPieces[playerId]) {
    await initVSPieces(roomId, playerId, scattered);
  }

  pieceStates = (existingPieces[playerId]
    ? Object.values(existingPieces[playerId])
    : scattered.map(p => ({ ...p, solved: false })));

  solvedCount = pieceStates.filter(p => p.solved).length;

  setupBoard();
  await renderAllPieces();
  reconstructGroups();
  setupHelp();
  setupPeek();
  setupChat();
  attachDragListeners();
  if (m.hardMode) attachRotateListeners();

  // Timer
  if (startedAt) {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    timerEl.textContent = formatTime(secs);
    startTimer();
  }

  updateMyProgress();

  // Subscribe to my own piece changes
  unsubPieces = onVSPieces(roomId, playerId, applyRemoteUpdate);

  // Set up opponent board
  const oppId = Object.keys(players).find(id => id !== playerId);
  if (oppId) {
    const oppName = players[oppId]?.name || 'Opponent';
    if (oppBoardLabel) oppBoardLabel.textContent = oppName;
    vspOppName.textContent = oppName;

    setupOppBoard();
    const initialOppPieces = existingPieces[oppId]
      ? Object.values(existingPieces[oppId])
      : scattered.map(p => ({ ...p, solved: false }));
    await renderOppPieces(initialOppPieces);

    unsubOpp = onVSOpponentPieces(roomId, oppId, applyOppUpdate);
  }

  window.addEventListener('beforeunload', cleanup);
}

// ── Board + Rendering ─────────────────────────────────────────────────────────

function computeSplitScale() {
  const headerH  = 120; // progress bar + header
  const availW   = (window.innerWidth  / 2) - 12;
  const availH   = window.innerHeight  - headerH;
  return Math.min(availW / BOARD_W, availH / BOARD_H, 1);
}

function setupBoard() {
  board.style.width           = BOARD_W + 'px';
  board.style.height          = BOARD_H + 'px';
  board.style.transformOrigin = 'top left';
  applyScale(scale);
}

function setupOppBoard() {
  oppBoard.style.width           = BOARD_W + 'px';
  oppBoard.style.height          = BOARD_H + 'px';
  oppBoard.style.transformOrigin = 'top left';
  applyOppScale(scale);
}

function renderPiece(index, dataUrl, x, y, solved, elW, elH) {
  const el     = document.createElement('img');
  el.src       = dataUrl;
  el.className = 'piece' + (solved ? ' solved' : '');
  el.dataset.index = index;
  el.style.width   = elW + 'px';
  el.style.height  = elH + 'px';
  el.draggable     = false;
  movePieceEl(index, x, y, el);
  board.appendChild(el);
  pieceEls[index] = el;
  updatePieceZIndex(index);
}

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

function updatePieceZIndex(index) {
  const e = pieceEls[index];
  if (!e || e.classList.contains('dragging')) return;
  const edges = meta?.edges?.[index];
  if (!edges || !meta.cols || !meta.rows) return;
  const col = index % meta.cols;
  const row = Math.floor(index / meta.cols);
  let z = (meta.cols - col) + (meta.rows - row);
  if (edges.right > 0) z += meta.rows;
  if (edges.bottom > 0) z += meta.cols;
  e.style.zIndex = z;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ── Opponent board rendering ───────────────────────────────────────────────────

// _cachedImg is set during renderAllPieces so opp rendering can reuse it
let _cachedImg = null;

async function renderAllPieces() {
  const src = meta.imageUrl;
  _cachedImg = await loadImage(src);
  const img = _cachedImg;
  const { cols, rows, pieceW, pieceH, edges, displayW, displayH } = meta;
  const pad = getPad(displayW, displayH);
  meta._displayW = displayW;
  meta._displayH = displayH;
  meta._pad      = pad;

  const BATCH = 50;
  for (let start = 0; start < totalPieces; start += BATCH) {
    await new Promise(r => setTimeout(r, 0));
    const end = Math.min(start + BATCH, totalPieces);
    for (let i = start; i < end; i++) {
      const col     = i % cols;
      const row     = Math.floor(i / cols);
      const dataUrl = cutPiece(img, col, row, pieceW, pieceH, displayW, displayH, edges[i]);
      const p       = pieceStates[i];
      renderPiece(i, dataUrl, p.x, p.y, p.solved, displayW + pad * 2, displayH + pad * 2);
    }
    loadingText.textContent = `Cutting pieces... ${Math.min(end, totalPieces)} / ${totalPieces}`;
  }
}

async function renderOppPieces(states) {
  const img = _cachedImg;
  if (!img) return;
  const { cols, pieceW, pieceH, edges, displayW, displayH } = meta;
  const pad = meta._pad;
  const elW = displayW + pad * 2;
  const elH = displayH + pad * 2;

  for (let i = 0; i < states.length; i++) {
    oppPieceStates[i] = states[i] ?? { x: 0, y: 0, rotation: 0, solved: false };
    const col     = i % cols;
    const row     = Math.floor(i / cols);
    const dataUrl = cutPiece(img, col, row, pieceW, pieceH, displayW, displayH, edges[i]);
    const el      = document.createElement('img');
    el.src        = dataUrl;
    el.className  = 'piece' + (oppPieceStates[i].solved ? ' solved' : '');
    el.draggable  = false;
    el.style.width  = elW + 'px';
    el.style.height = elH + 'px';
    moveOppPieceEl(i, oppPieceStates[i].x, oppPieceStates[i].y, el);
    oppBoard.appendChild(el);
    oppPieceEls[i] = el;
  }
}

function moveOppPieceEl(index, x, y, el) {
  const pad = meta?._pad ?? 0;
  const e   = el ?? oppPieceEls[index];
  if (!e) return;
  const rot = oppPieceStates[index]?.rotation ?? 0;
  e.style.left = '0';
  e.style.top  = '0';
  e.style.transform = rot
    ? `translate(${x - pad}px, ${y - pad}px) rotate(${rot}deg)`
    : `translate(${x - pad}px, ${y - pad}px)`;
}

function applyOppUpdate(allPieces) {
  if (!allPieces) return;
  const entries = Object.entries(allPieces);

  // Update progress bar
  const oppTotal   = entries.length;
  const oppSolved  = entries.filter(([, p]) => p.solved).length;
  const oppGrouped = entries.filter(([, p]) => p.groupId).length;
  const oppPlaced  = Math.max(oppSolved, oppGrouped);
  const pct = oppTotal > 0 ? Math.round(oppPlaced / oppTotal * 100) : 0;
  vspOppFill.style.width = pct + '%';
  vspOppPct.textContent  = pct + '%';

  // Update each opponent piece element
  entries.forEach(([key, p]) => {
    const i = Number(key);
    if (!oppPieceEls[i]) return;
    oppPieceStates[i] = { ...(oppPieceStates[i] ?? {}), ...p };
    moveOppPieceEl(i, p.x, p.y);
    if (p.solved) oppPieceEls[i].classList.add('solved');
  });
}

function applyOppScale(s) {
  oppBoard.style.transform   = s === 1 ? '' : `scale(${s})`;
  oppBoard.style.marginRight  = s > 1 ? BOARD_W * (s - 1) + 'px' : '';
  oppBoard.style.marginBottom = s > 1 ? BOARD_H * (s - 1) + 'px' : '';
}

// ── Drag ──────────────────────────────────────────────────────────────────────

function attachDragListeners() {
  board.addEventListener('mousedown',   onMouseDown);
  window.addEventListener('mousemove',  onMouseMove);
  window.addEventListener('mouseup',    onMouseUp);
  const wrap = board.parentElement;
  wrap.addEventListener('touchstart', onTouchStart, { passive: false });
  wrap.addEventListener('touchmove',  onTouchMove,  { passive: false });
  wrap.addEventListener('touchend',   onTouchEnd);
}

function attachRotateListeners() {
  board.addEventListener('contextmenu', onContextMenu);
  board.addEventListener('touchend',    onDoubleTap);
}

function onContextMenu(e) {
  e.preventDefault();
  const el = e.target.closest('.piece');
  if (!el) return;
  const index = Number(el.dataset.index);
  if (pieceStates[index]?.lockedBy && pieceStates[index].lockedBy !== playerId) return;
  rotateAtIndex(index);
}

function onDoubleTap(e) {
  const touch = e.changedTouches[0];
  const el    = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.piece');
  if (!el) return;
  const now  = Date.now();
  const same = lastTap.el === el && (now - lastTap.time) < 300;
  lastTap    = { time: now, el };
  if (!same) return;
  e.preventDefault();
  const index = Number(el.dataset.index);
  if (pieceStates[index]?.lockedBy && pieceStates[index].lockedBy !== playerId) return;
  rotateAtIndex(index);
}

function rotateAtIndex(index) {
  const gid     = pieceGroup[index];
  const indices = gid ? [...groups[gid]] : [index];
  const newRot  = ((pieceStates[index].rotation ?? 0) + 90) % 360;
  const { _displayW: dW, _displayH: dH } = meta;

  if (indices.length === 1) {
    pieceStates[index].rotation = newRot;
    movePieceEl(index, pieceStates[index].x, pieceStates[index].y);
    updateVSPieceRotation(roomId, playerId, index, newRot);
    return;
  }

  const cx = indices.reduce((s, i) => s + pieceStates[i].x + dW / 2, 0) / indices.length;
  const cy = indices.reduce((s, i) => s + pieceStates[i].y + dH / 2, 0) / indices.length;
  const positions = [];
  indices.forEach(i => {
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
  updateVSGroupRotationAndPositions(roomId, playerId, positions, newRot);
}

function onMouseDown(e) {
  const el = e.target.closest('.piece');
  if (!el || el.classList.contains('solved')) return;
  const index = Number(el.dataset.index);
  const state = pieceStates[index];
  if (state.lockedBy && state.lockedBy !== playerId) return;
  const gid     = pieceGroup[index];
  const indices = gid ? [...groups[gid]] : [index];
  if (indices.some(i => pieceStates[i].lockedBy && pieceStates[i].lockedBy !== playerId)) return;
  const boardRect = board.getBoundingClientRect();
  const anchorX   = pieceStates[index].x;
  const anchorY   = pieceStates[index].y;
  const offsetX   = (e.clientX - boardRect.left) / scale - anchorX;
  const offsetY   = (e.clientY - boardRect.top)  / scale - anchorY;
  const relOffsets = {};
  indices.forEach(i => {
    relOffsets[i] = { dx: pieceStates[i].x - anchorX, dy: pieceStates[i].y - anchorY };
  });
  dragging = { indices, anchorIndex: index, offsetX, offsetY, relOffsets, locked: false };
}

function onMouseMove(e) {
  if (!dragging) return;
  const { indices, offsetX, offsetY, relOffsets } = dragging;
  if (!dragging.locked) {
    dragging.locked = true;
    lockVSGroup(roomId, playerId, indices, playerId);
    indices.forEach(i => { pieceStates[i].lockedBy = playerId; });
    indices.forEach(i => {
      pieceEls[i]?.classList.add('dragging');
      if (pieceEls[i]) pieceEls[i].style.zIndex = 1000;
    });
  }
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
  updateVSGroupPosition(roomId, playerId, positions);
}

async function onMouseUp(e) {
  if (!dragging) return;
  const { indices, anchorIndex, offsetX, offsetY, relOffsets, locked } = dragging;
  dragging = null;
  indices.forEach(i => {
    pieceEls[i]?.classList.remove('dragging');
    if (pieceEls[i]) pieceEls[i].style.zIndex = '';
  });
  if (!locked) return;
  const boardRect = board.getBoundingClientRect();
  const anchorX   = (e.clientX - boardRect.left) / scale - offsetX;
  const anchorY   = (e.clientY - boardRect.top)  / scale - offsetY;
  indices.forEach(i => {
    const x = anchorX + relOffsets[i].dx;
    const y = anchorY + relOffsets[i].dy;
    pieceStates[i].x = x;
    pieceStates[i].y = y;
    movePieceEl(i, x, y);
  });
  const snap = findNeighbourSnap(indices);
  if (snap) {
    const { cols, _displayW: dW, _displayH: dH } = meta;
    const neighbourGroupIndices = pieceGroup[snap.neighbourIndex]
      ? [...groups[pieceGroup[snap.neighbourIndex]]]
      : [snap.neighbourIndex];
    const allIndices = [...new Set([...indices, ...neighbourGroupIndices])];
    const anchorIdx = snap.neighbourIndex;
    const anchorCol = anchorIdx % cols;
    const anchorRow = Math.floor(anchorIdx / cols);
    const aX = pieceStates[anchorIdx].x;
    const aY = pieceStates[anchorIdx].y;
    const rot = pieceStates[snap.neighbourIndex].rotation ?? 0;
    const positions = [];
    allIndices.forEach(i => {
      const iCol = i % cols, iRow = Math.floor(i / cols);
      const dcI = iCol - anchorCol, drI = iRow - anchorRow;
      let ox, oy;
      if (rot === 0)        { ox =  dcI * dW; oy =  drI * dH; }
      else if (rot === 90)  { ox = -drI * dH; oy =  dcI * dW; }
      else if (rot === 180) { ox = -dcI * dW; oy = -drI * dH; }
      else                  { ox =  drI * dH; oy = -dcI * dW; }
      const x = aX + ox, y = aY + oy;
      pieceStates[i] = { ...pieceStates[i], x, y, lockedBy: null };
      movePieceEl(i, x, y);
      positions.push({ index: i, x, y });
    });
    mergeGroups(allIndices);
    const gid = pieceGroup[allIndices[0]];
    await writeVSSnap(roomId, playerId, positions, gid);
    checkSolvedState();
    updateMyProgress();
    checkCompletion();
  } else {
    await unlockVSGroup(roomId, playerId, indices);
    indices.forEach(i => { pieceStates[i].lockedBy = null; });
  }
}

function onTouchStart(e) {
  if (e.touches.length === 2) {
    if (dragging) {
      if (dragging.locked) unlockVSGroup(roomId, playerId, dragging.indices);
      dragging.indices.forEach(i => { pieceEls[i]?.classList.remove('dragging'); if (pieceEls[i]) pieceEls[i].style.zIndex = ''; });
      dragging = null;
    }
    pinch = { dist0: touchDist(e.touches), scale0: scale };
    e.preventDefault(); return;
  }
  if (pinch) return;
  const touch = e.touches[0];
  onMouseDown({ clientX: touch.clientX, clientY: touch.clientY,
    target: document.elementFromPoint(touch.clientX, touch.clientY) });
  if (dragging) e.preventDefault();
}

function onTouchMove(e) {
  if (e.touches.length === 2 && pinch) {
    e.preventDefault();
    const raw = pinch.scale0 * (touchDist(e.touches) / pinch.dist0);
    applyScale(Math.min(SCALE_MAX, Math.max(SCALE_MIN, raw))); return;
  }
  if (!dragging) return;
  e.preventDefault();
  const touch = e.touches[0];
  onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
}

function onTouchEnd(e) {
  if (pinch && e.touches.length < 2) { pinch = null; return; }
  if (!dragging) return;
  const touch = e.changedTouches[0];
  onMouseUp({ clientX: touch.clientX, clientY: touch.clientY });
}

function touchDist(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

function applyScale(s) {
  scale = s;
  board.style.transform = scale === 1 ? '' : `scale(${scale})`;
  board.style.marginRight  = scale > 1 ? BOARD_W * (scale - 1) + 'px' : '';
  board.style.marginBottom = scale > 1 ? BOARD_H * (scale - 1) + 'px' : '';
}

// ── Snap / merge ──────────────────────────────────────────────────────────────

function findNeighbourSnap(dragIndices) {
  const { cols, rows, _displayW: dW, _displayH: dH, edges } = meta;
  const threshold = Math.max(40, Math.min(dW, dH) * 0.4);
  const dragSet   = new Set(dragIndices);

  const checks = [
    { dc:  0, dr: -1, myEdge: 'idTop',    neighbourEdge: 'idBottom' },
    { dc:  0, dr:  1, myEdge: 'idBottom', neighbourEdge: 'idTop'    },
    { dc: -1, dr:  0, myEdge: 'idLeft',   neighbourEdge: 'idRight'  },
    { dc:  1, dr:  0, myEdge: 'idRight',  neighbourEdge: 'idLeft'   },
  ];

  for (const i of dragIndices) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const eI  = edges[i];

    for (const { dc, dr, myEdge, neighbourEdge } of checks) {
      const nCol = col + dc;
      const nRow = row + dr;
      if (nCol < 0 || nCol >= cols || nRow < 0 || nRow >= rows) continue;

      const nIdx = nRow * cols + nCol;
      if (dragSet.has(nIdx)) continue;

      const eN = edges[nIdx];
      if (eI[myEdge] === 0 || eI[myEdge] !== eN[neighbourEdge]) continue;

      const rot = pieceStates[i].rotation ?? 0;
      if (rot !== (pieceStates[nIdx].rotation ?? 0)) continue;

      const actualDx = pieceStates[i].x - pieceStates[nIdx].x;
      const actualDy = pieceStates[i].y - pieceStates[nIdx].y;

      let expectedDx, expectedDy;
      if (rot === 0)        { expectedDx = -dc * dW;  expectedDy = -dr * dH; }
      else if (rot === 90)  { expectedDx =  dr * dH;  expectedDy = -dc * dW; }
      else if (rot === 180) { expectedDx =  dc * dW;  expectedDy =  dr * dH; }
      else                  { expectedDx = -dr * dH;  expectedDy =  dc * dW; }

      const dist = Math.hypot(actualDx - expectedDx, actualDy - expectedDy);
      if (dist <= threshold) {
        return {
          dragIndex:      i,
          neighbourIndex: nIdx,
          targetX:        pieceStates[nIdx].x + expectedDx,
          targetY:        pieceStates[nIdx].y + expectedDy,
        };
      }
    }
  }
  return null;
}

function checkSolvedState() {
  for (let i = 0; i < totalPieces; i++) {
    const gid = pieceGroup[i];
    if (!gid) continue;
    if (groups[gid]?.size === totalPieces) {
      const updates = {};
      groups[gid].forEach(j => {
        pieceStates[j] = { ...pieceStates[j], solved: true, lockedBy: null };
        pieceEls[j]?.classList.add('solved');
        updates[j] = { x: pieceStates[j].x, y: pieceStates[j].y };
      });
      solvedCount = totalPieces;
      solveVSGroup(roomId, playerId, updates);
      return;
    }
    return;
  }
}

function mergeGroups(indices) {
  const existingIds = [...new Set(indices.map(i => pieceGroup[i]).filter(Boolean))];
  const keepId = existingIds[0] ?? crypto.randomUUID();
  if (!groups[keepId]) groups[keepId] = new Set();
  indices.forEach(i => {
    const oldId = pieceGroup[i];
    if (oldId && oldId !== keepId && groups[oldId]) {
      groups[oldId].forEach(j => { groups[keepId].add(j); pieceGroup[j] = keepId; });
      delete groups[oldId];
    } else {
      groups[keepId].add(i);
      pieceGroup[i] = keepId;
    }
  });
}

function reconstructGroups() {
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

  const wasGroupId = pieceStates[index]?.groupId;
  const lockedBy   = Object.prototype.hasOwnProperty.call(data, 'lockedBy')
    ? data.lockedBy : null;
  const incoming = { ...data, lockedBy };
  if (incoming.lockedBy === playerId && !dragging?.indices.includes(index)) {
    delete incoming.lockedBy;
  }
  pieceStates[index] = { ...pieceStates[index], ...incoming };
  movePieceEl(index, data.x, data.y);

  if (data.groupId && data.groupId !== wasGroupId) {
    const groupMembers = pieceStates
      .map((p, i) => p.groupId === data.groupId ? i : -1)
      .filter(i => i >= 0);
    if (groupMembers.length > 1) mergeGroups(groupMembers);
    updateMyProgress();
  }

  if (data.solved) {
    pieceEls[index]?.classList.add('solved');
    solvedCount = pieceStates.filter(p => p.solved).length;
    updateMyProgress();
    checkCompletion();
  }
}

// ── Progress / completion ─────────────────────────────────────────────────────

function updateMyProgress() {
  const placed = pieceStates.filter((p, i) => pieceGroup[i] || p.solved).length;
  const pct = totalPieces > 0 ? Math.round(placed / totalPieces * 100) : 0;
  vspMeFill.style.width = pct + '%';
  vspMePct.textContent  = pct + '%';
}

function checkCompletion() {
  const done = solvedCount >= totalPieces ||
    (() => {
      const gids = new Set(pieceGroup.filter(Boolean));
      return gids.size === 1 && groups[[...gids][0]]?.size === totalPieces;
    })();
  if (!done || winnerDeclared) return;
  winnerDeclared = true;

  stopTimer();
  const finishedAt = Date.now();
  const secs = Math.floor((finishedAt - startedAt) / 1000);
  setVSFinished(roomId, playerId, finishedAt);
  setVSWinner(roomId, playerId, secs);
}

function showResult(room) {
  stopTimer();
  const { meta: m, players = {} } = room;
  const winnerId = m.winner;
  const iWon     = winnerId === playerId;
  const oppId    = Object.keys(players).find(id => id !== playerId);

  vsResult.style.display = 'flex';
  vsGame.style.opacity   = '0.4';

  vsResultTitle.textContent = iWon ? '🏆 You Won!' : '😔 You Lost';

  const lines = [];
  Object.entries(players).forEach(([pid, p]) => {
    if (p.finishedAt && startedAt) {
      const s = Math.floor((p.finishedAt - startedAt) / 1000);
      lines.push(`${pid === playerId ? '⭐ ' : ''}${p.name}: ${formatTime(s)}`);
    }
  });
  vsResultTimes.textContent = lines.join('  ·  ');

  // Win counter
  if (oppId) {
    const wins = recordWin(winnerId, oppId);
    vsScoreMe.textContent  = wins[playerId]  ?? 0;
    vsScoreOpp.textContent = wins[oppId]     ?? 0;
    vsScoreBoard.style.display = '';
  }
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

// ── Help / Peek ───────────────────────────────────────────────────────────────

function setupHelp() {
  const controls = [
    { key: 'Drag',           desc: 'Move a piece or connected group' },
    { key: 'Drop near edge', desc: 'Pieces snap together automatically' },
    { key: 'Pinch (mobile)', desc: 'Zoom in / out' },
    { key: 'Scroll',         desc: 'Pan the board' },
  ];
  helpList.innerHTML = controls.map(c =>
    `<li><strong>${c.key}</strong> — ${c.desc}</li>`
  ).join('');
  helpBtn.addEventListener('click', () => { helpModal.style.display = 'flex'; });
  helpClose.addEventListener('click', () => { helpModal.style.display = 'none'; });
  helpModal.addEventListener('click', e => { if (e.target === helpModal) helpModal.style.display = 'none'; });
}

function setupPeek() {
  boxCoverImg.src = meta.imageUrl;
  const toggle = () => boxCover.classList.toggle('show');
  const hide   = () => boxCover.classList.remove('show');
  peekBtn.addEventListener('click', toggle);
  boxCover.addEventListener('click', hide);
}

// ── Chat ──────────────────────────────────────────────────────────────────────

function setupChat() {
  const open  = () => { chatPanel.classList.add('open'); chatOpen = true; setChatBadge(0); };
  const close = () => { chatPanel.classList.remove('open'); chatOpen = false; };

  chatBtn.addEventListener('click', () => chatOpen ? close() : open());
  chatClose.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && chatOpen) close(); });

  const send = () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    const color = getPlayerColor(playerId);
    sendChatMessage(roomId, { playerId, name: playerName, color, text, ts: Date.now() });
  };
  chatSendBtn.addEventListener('click', send);
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

  chatPanel.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = getPlayerColor(playerId);
      sendChatMessage(roomId, { playerId, name: playerName, color, text: btn.dataset.emoji, ts: Date.now() });
    });
  });

  onChatMessages(roomId, msg => {
    appendChatMessage(msg);
    if (isSingleEmoji(msg.text)) spawnBoardEmoji(msg);
    if (!chatOpen && msg.playerId !== playerId) setChatBadge(chatUnread + 1);
  });
}

function setChatBadge(n) {
  chatUnread = n;
  let badge = chatBtn.querySelector('.chat-badge');
  if (n > 0) {
    if (!badge) { badge = document.createElement('div'); badge.className = 'chat-badge'; chatBtn.appendChild(badge); }
    badge.textContent = n > 9 ? '9+' : n;
  } else {
    badge?.remove();
  }
}

function appendChatMessage(msg) {
  const mine = msg.playerId === playerId;
  const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const emojiOnly = isSingleEmoji(msg.text);
  const el = document.createElement('div');
  el.className = 'chat-msg' + (mine ? ' mine' : '');
  el.innerHTML = `
    <div class="chat-msg-meta">
      ${!mine ? `<div class="chat-msg-dot" style="background:${msg.color}"></div>` : ''}
      <span>${mine ? 'You' : msg.name}</span>
      <span>${time}</span>
    </div>
    <div class="chat-msg-bubble${emojiOnly ? ' emoji-only' : ''}">${escapeHtml(msg.text)}</div>
  `;
  chatMessages.appendChild(el);
  while (chatMessages.children.length > 50) chatMessages.removeChild(chatMessages.firstChild);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function spawnBoardEmoji(msg) {
  // Spawn on own board and opponent board, 10 total each
  [board, oppBoard].forEach(target => {
    if (!target) return;
    for (let i = 0; i < 10; i++) {
      const x = 40 + Math.random() * (BOARD_W - 80);
      const y = 40 + Math.random() * (BOARD_H - 80);
      const el = document.createElement('div');
      el.className = 'board-emoji';
      el.textContent = msg.text;
      el.style.left = x + 'px';
      el.style.top  = y + 'px';
      el.style.animationDelay = (i * 60) + 'ms';
      target.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }
  });
}

function isSingleEmoji(text) {
  return /^\p{Emoji_Presentation}$/u.test(text.trim()) || /^\p{Emoji}\uFE0F?$/u.test(text.trim());
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanup() {
  if (unsubRoom)   { unsubRoom();   unsubRoom   = null; }
  if (unsubPieces) { unsubPieces(); unsubPieces = null; }
  if (unsubOpp)    { unsubOpp();    unsubOpp    = null; }
  stopTimer();
  if (dragging?.locked) unlockVSGroup(roomId, playerId, dragging.indices);
}
