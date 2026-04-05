window.__puzzleModuleLoaded = true;

import {
  loadPuzzle,
  lockGroup,
  unlockGroup,
  updateGroupPosition,
  writePocketRestoreStates,
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
  recordPOTDScore,
  onPOTDLeaderboard,
  sendChatMessage,
  onChatMessages,
  updateRoomsIndex,
} from './firebase.js';
import { cutPiece, getPad } from './jigsaw.js';
import {
  computeIsMobileLike,
  initHighQualityPreference,
  getTextureScale,
  snapBoardScaleToDevicePixels,
} from './mobile-quality.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const BOARD_W   = 900;
const BOARD_H   = 650;
/** Horizontal and bottom padding for scroll content (px). Top adds SCROLL_TOP_GUTTER in sync. */
const BOARD_SCROLL_PADDING = 20;
/** Extra scroll-area padding above the board so piece tabs / zoomed tops stay scrollable below the header edge. */
const SCROLL_TOP_GUTTER = 48;
/** Extra slack (board coords) around the piece AABB when sizing the scroll region — shadows / AA. */
const BOARD_CLOUD_SLACK = 14;
/** Horizontal: bias scroll anchor slightly off center (narrow windows / left clipping). */
const BOARD_VIEW_CENTER_BIAS_X = 0.06;
/** Pixels from board-wrap top to the cloud’s top edge when framing (tabs / shadow room). */
const FRAME_CLOUD_TOP_MARGIN_PX = 52;
/** Extra board-space above the cloud bbox top (knobs, antialias). */
const FRAME_CLOUD_TOP_PAD_BOARD = 12;
const SCALE_MIN = 0.3;
const SCALE_MAX = 3.0;

/** Set true only for local agent debugging (ingest + in-memory ring). */
const JT_DEBUG_AGENT = false;
function jtDbgLog(payload) {
  if (!JT_DEBUG_AGENT) return;
  const line = { sessionId: 'c7426d', timestamp: Date.now(), ...payload };
  try {
    window.__JT_DEBUG_LOGS = window.__JT_DEBUG_LOGS || [];
    window.__JT_DEBUG_LOGS.push(line);
    if (window.__JT_DEBUG_LOGS.length > 120) window.__JT_DEBUG_LOGS.shift();
  } catch (_) { /* ignore */ }
  const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!isLocalDev) return;
  fetch('http://127.0.0.1:7319/ingest/be2f6902-b67c-428c-8ee3-1dabde1e3930', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'c7426d' },
    body: JSON.stringify(line),
  }).catch(() => {});
}

// crypto.randomUUID() requires Safari 15.4. Use a polyfill so iOS 14/15.0–15.3 works.
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4)).toString(16)
  );
}

function safeSessionGet(key) {
  try {
    return sessionStorage.getItem(key) || null;
  } catch (_) {
    return null;
  }
}

function safeSessionSet(key, val) {
  try {
    sessionStorage.setItem(key, val);
  } catch (_) {
    /* In-app / private mode — session may be blocked */
  }
}

function safeLocalGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function safeLocalSet(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (_) {
    /* ignore */
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

const puzzleId  = new URLSearchParams(location.search).get('id');
let fallbackPlayerId = null;
const playerId  = getOrCreatePlayerId();

let meta        = null;
let pieceEls    = [];
let pieceStates = [];
let solvedCount = 0;
let totalPieces = 0;

// Groups — local only, never synced to Firebase
const groups    = {};   // groupId -> Set<number>
const pieceGroup = [];  // pieceGroup[i] = groupId | null

let dragging    = null; // { indices, anchorIndex, offsetX, offsetY, relOffsets, locked, fromTouch, ... }
let unsubscribe = null;
let scale       = 1;   // current zoom level applied to #puzzle-board
let pinch       = null; // { dist0, scale0 } — active pinch gesture state
let viewportPan = null; // { startX, startY, scrollLeft, scrollTop }
/** Coalesce wheel/trackpad deltas to one applyScale per animation frame (smoother on web). */
let wheelZoomRaf = null;
let wheelDeltaFrame = 0;
let wheelZoomAnchor = { anchorClientX: 0, anchorClientY: 0 };
/** Trackpad pinch often maps to ctrl+wheel with wrong clientX/Y in Chromium; prefer real pointer. */
let lastBoardWrapPointerClient = { x: NaN, y: NaN };
let hasLastBoardWrapPointer = false;
/**
 * Pan offset when scroll can't reach the ideal zoom pivot. Applied as margin (not transform
 * translate) so the flex scroll area grows and trackpad scroll can reach the full board.
 */
let boardTx = 0;
let boardTy = 0;
/** Coalesce scroll-content resizes after rapid piece moves (remote + drag). */
let boardScrollSyncRaf = null;
/** After touch + preventDefault, ignore the delayed compatibility mousedown (avoids double-pick). */
let suppressMouseDownPickUntil = 0;
/** Avoid duplicate resize / visualViewport listeners from setupViewportControls. */
let boardViewportListenersAttached = false;
let hand = [];           // indices of pieces currently in the player's hand
/** index → { x, y, rotation } when piece entered pocket; restored on timer / tap / remote bump (not on dbl-click drop). */
const pocketHomeByIndex = new Map();
let lastAddToHandAt = 0;
let handContainer = null;
/** Per logical pocket slot: `g:<groupId>` or `s:<pieceIndex>` → auto-release wall time. */
const handSlotExpiresAt = new Map();
/** Per-slot setTimeout ids for auto-release. */
const handSlotTimeoutIds = new Map();
/** Updates per-slot timer bar widths while the pocket is open. */
let handSlotTimerTickInterval = null;
/** Timeouts for native grab/grabbing cursor phases (pocket + drag release). */
let handCursorSeqTimerIds = [];
const HAND_RELEASE_MS = 15000;
/** Max size (px) of the composite pocket preview. */
const HAND_BLOCK_MAX_W = 136;
const HAND_BLOCK_MAX_H = 100;
/** When the pocket holds multiple entries (merged group + loose singles), each slot preview uses this cap. */
const HAND_BLOCK_SLOT_MAX_W = 104;
const HAND_BLOCK_SLOT_MAX_H = 76;
/** Merged groups larger than this cannot go in the pocket (keep big assemblies on the board). */
const POCKET_MAX_GROUP_PIECES = 5;
const forceReleaseState = {}; // index → { count, lastTime }
let lastEmptyTap = { time: 0, x: 0, y: 0 };
const TOUCH_HOLD_MS = 280;
const TOUCH_HOLD_SLOP = 10;
const DRAG_DEAD_ZONE_DESKTOP = 6;
const DRAG_DEAD_ZONE_TOUCH = 10;
const DRAG_START_GRACE_MS = 150;
let touchHold = null; // { index, startX, startY, activated, timer }

// Double-tap for mobile rotate (hard mode only)
let lastTap = { time: 0, el: null };

// Player presence
let playerName  = safeSessionGet('playerName');
let unsubPlayers = null;
let playersMap  = {}; // id → { name, color } — kept up to date by renderPlayers

// Timer
let timerInterval = null;

// Chat
let chatUnread    = 0;
let chatOpen      = false;
const lastPlayerPos = {}; // playerId → { x, y } last known board position
let startedAt     = null;
// Coarse pointer or common mobile UA: drives touch UX (pan, pinch, HQ button). Texture
// quality itself uses capability APIs in mobile-quality.js, not UA string matching.
const isMobileLike = computeIsMobileLike();
let highQualityMode = initHighQualityPreference(isMobileLike, safeLocalGet);
let pageTouchStart = null;
const isLikelySafari = (() => {
  const ua = navigator.userAgent || '';
  // Safari only; exclude Chromium/Firefox-branded browsers.
  return /Safari/i.test(ua) && !/Chrome|CriOS|Edg|EdgiOS|FxiOS|OPiOS/i.test(ua);
})();

// Rooms-index sync (public rooms only)
let lastRoomsSolvedSync = 0;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const boardWrap          = document.getElementById('puzzle-board-wrap');
const boardScrollContent = document.getElementById('puzzle-board-scroll-content');
const board              = document.getElementById('puzzle-board');
const loadingEl       = document.getElementById('loading-overlay');
const loadingText     = document.getElementById('loading-text');
const celebration     = document.getElementById('celebration');
const celebrationTime = document.getElementById('celebration-time');
const celebrationLb   = document.getElementById('celebration-lb');
const celebrationLbList = document.getElementById('celebration-lb-list');
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
const chatBtn         = document.getElementById('chat-btn');
const chatPanel       = document.getElementById('chat-panel');
const chatClose       = document.getElementById('chat-close');
const chatMessages    = document.getElementById('chat-messages');
const chatInput       = document.getElementById('chat-input');
const chatSendBtn     = document.getElementById('chat-send');
const qualityBtn      = document.getElementById('quality-btn');

// ── Boot ──────────────────────────────────────────────────────────────────────

if (!puzzleId) {
  location.href = '/';
} else {
  askNameThenInit();
}

async function askNameThenInit() {
  if (!playerName) {
    playerName = await showNameModal();
    safeSessionSet('playerName', playerName);
  }
  nameModal.style.display = 'none';
  initPuzzle().catch(fatalOverlayError);
}

function fatalOverlayError(err) {
  console.error('initPuzzle rejected:', err);
  if (loadingEl) {
    loadingText.textContent = 'Something went wrong. Please refresh the page.';
    loadingEl.classList.add('loading-overlay--error');
    const sp = loadingEl.querySelector('.spinner');
    if (sp) sp.style.display = 'none';
  }
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
  const watchdog = window.setTimeout(() => {
    if (!loadingEl || getComputedStyle(loadingEl).display === 'none') return;
    loadingText.textContent =
      'Still loading… In-app browsers often block this. Try opening in Safari (Share → Open in Browser).';
  }, 22000);
  try {
    jtDbgLog({
      runId: 'pre-fix-1',
      hypothesisId: 'H1-H3',
      location: 'puzzle.js:initPuzzle:start',
      message: 'initPuzzle start',
      data: {
        puzzleId,
        isMobileLike,
        isLikelySafari,
        dpr: window.devicePixelRatio || 1,
        screenW: window.innerWidth,
        screenH: window.innerHeight,
        ua: (navigator.userAgent || '').slice(0, 180),
      },
    });
    loadingText.textContent = 'Loading puzzle...';
    const data = await loadPuzzle(puzzleId);
    // #region agent log
    jtDbgLog({
      runId: 'pre-fix-1',
      hypothesisId: 'H1-H2',
      location: 'puzzle.js:initPuzzle:afterLoad',
      message: 'loadPuzzle resolved',
      data: {
        hasMeta: !!data?.meta,
        piecesType: Array.isArray(data?.pieces) ? 'array' : typeof data?.pieces,
        piecesKeys:
          data?.pieces && typeof data.pieces === 'object' && !Array.isArray(data.pieces)
            ? Object.keys(data.pieces).length
            : null,
      },
    });
    // #endregion
    const normalized = normalizeLoadedPuzzle(data);
    meta = normalized.meta;
    pieceStates = normalized.pieceStates;
    totalPieces = pieceStates.length;
    solvedCount = pieceStates.filter(p => p.solved).length;

    if (meta.hardMode) document.getElementById('hard-badge').style.display = '';

    setupBoard();
    // #region agent log
    jtDbgLog({
      runId: 'pre-fix-1',
      hypothesisId: 'H4',
      location: 'puzzle.js:initPuzzle:afterSetupBoard',
      message: 'board setup snapshot',
      data: {
        scale,
        wrapW: boardWrap?.clientWidth || 0,
        wrapH: boardWrap?.clientHeight || 0,
        scrollW: boardWrap?.scrollWidth || 0,
        scrollH: boardWrap?.scrollHeight || 0,
        scrollLeft: boardWrap?.scrollLeft || 0,
        scrollTop: boardWrap?.scrollTop || 0,
      },
    });
    // #endregion
    await renderAllPieces();
    reconstructGroups();
    setupShareLink();
    attachDragListeners();

    setupHelp();
    setupPeek();
    setupQualityMode();
    setupHorizontalPageLock();
    setupChat();

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

    window.clearTimeout(watchdog);
    loadingEl.style.display = 'none';
    scheduleMobilePieceFraming();
    updateProgress();
  } catch (err) {
    window.clearTimeout(watchdog);
    try { console.error(err); } catch (_) { /* */ }
    jtDbgLog({
      runId: 'pre-fix-1',
      hypothesisId: 'H1-H3',
      location: 'puzzle.js:initPuzzle:catch',
      message: 'initPuzzle failed',
      data: {
        name: err?.name || 'Error',
        message: String(err?.message || err),
        stack: String(err?.stack || '').slice(0, 220),
      },
    });
    const msg = (err && typeof err === 'object' && err.name === 'AbortError')
      || /Failed to fetch|NetworkError|load failed/i.test(String(err?.message || err))
        ? 'Could not reach the server. Try Safari if you opened this link from a social app.'
        : 'Puzzle not found.';
    if (loadingText) loadingText.textContent = msg;
    if (loadingEl) loadingEl.classList.add('loading-overlay--error');
    const sp = loadingEl?.querySelector('.spinner');
    if (sp) sp.style.display = 'none';
  }
}

function normalizeLoadedPuzzle(data) {
  const rawMeta = data?.meta ?? {};
  const meta = { ...rawMeta };
  const cols = Number(meta.cols) || 0;
  const rows = Number(meta.rows) || 0;
  const expectedCount = Math.max(0, cols * rows);

  // Legacy puzzles may miss displayW/displayH; derive the same way create flow does.
  if (!(Number(meta.displayW) > 0) || !(Number(meta.displayH) > 0)) {
    const pieceW = Number(meta.pieceW) || 0;
    const pieceH = Number(meta.pieceH) || 0;
    if (pieceW > 0 && pieceH > 0 && cols > 0 && rows > 0) {
      const imageW = pieceW * cols;
      const imageH = pieceH * rows;
      const fitScale = Math.min((BOARD_W * 0.55) / imageW, (BOARD_H * 0.55) / imageH, 1);
      meta.displayW = Math.max(1, Math.floor(pieceW * fitScale));
      meta.displayH = Math.max(1, Math.floor(pieceH * fitScale));
    }
  }

  // Last-resort guard so rendering math cannot produce NaN/invisible pieces.
  if (!(Number(meta.displayW) > 0) || !(Number(meta.displayH) > 0)) {
    meta.displayW = 80;
    meta.displayH = 80;
    console.warn('Puzzle metadata missing display size; applied fallback dimensions.');
  }

  const piecesObj = data?.pieces ?? {};
  const piecesArr = Array.isArray(piecesObj)
    ? piecesObj
    : Object.entries(piecesObj)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, v]) => v);

  const count = expectedCount > 0 ? expectedCount : piecesArr.length;
  const maxX = Math.max(0, BOARD_W - meta.displayW);
  const maxY = Math.max(0, BOARD_H - meta.displayH);
  const pieceStates = Array.from({ length: count }, (_, index) => {
    const p = piecesArr[index] ?? {};
    const x = Number.isFinite(p.x) ? p.x : Math.random() * maxX;
    const y = Number.isFinite(p.y) ? p.y : Math.random() * maxY;
    return {
      x,
      y,
      solved: !!p.solved,
      rotation: Number.isFinite(Number(p.rotation)) ? normalizeRotationDeg(p.rotation) : 0,
      lockedBy: p.lockedBy ?? null,
      groupId: p.groupId ?? null,
    };
  });

  if (pieceStates.length === 0) {
    console.warn('Puzzle loaded with zero pieces after normalization.', { puzzleId });
  }

  return { meta, pieceStates };
}

function setupBoard() {
  board.style.width          = BOARD_W + 'px';
  board.style.height         = BOARD_H + 'px';
  board.style.transformOrigin = 'top left';
  board.style.marginLeft = '';
  board.style.marginTop = '';
  board.style.marginRight = '';
  board.style.marginBottom = '';
  boardTx = 0;
  boardTy = 0;
  syncBoardScrollContentSize();
  if (isMobileLike) {
    setupViewportControls();
    fitBoardToViewport();
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

async function renderAllPieces() {
  const src = meta.imageUrl ?? ('data:image/jpeg;base64,' + meta.imageData);
  const img = await loadImage(src);
  const { cols, rows, pieceW, pieceH, edges, displayW, displayH } = meta;
  const pad = getPad(displayW, displayH);
  const textureScale = getTextureScale(totalPieces, isMobileLike, highQualityMode);
  // #region agent log
  jtDbgLog({
    runId: 'pre-fix-1',
    hypothesisId: 'H2-H3',
    location: 'puzzle.js:renderAllPieces:start',
    message: 'render pieces start',
    data: {
      srcScheme: (() => {
        try {
          return new URL(src, location.href).protocol;
        } catch {
          return 'invalid';
        }
      })(),
      totalPieces,
      cols,
      rows,
      pieceW,
      pieceH,
      displayW,
      displayH,
      pad,
      textureScale,
      imgNaturalW: img.naturalWidth,
      imgNaturalH: img.naturalHeight,
      hasEdges: Array.isArray(edges),
      edgesLen: Array.isArray(edges) ? edges.length : null,
    },
  });
  // #endregion
  const texDisplayW = Math.round(displayW * textureScale);
  const texDisplayH = Math.round(displayH * textureScale);

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
      let dataUrl;
      try {
        dataUrl = cutPiece(img, col, row, pieceW, pieceH, texDisplayW, texDisplayH, edges[i]);
      } catch (cutErr) {
        // #region agent log
        jtDbgLog({
          runId: 'pre-fix-1',
          hypothesisId: 'H3',
          location: 'puzzle.js:renderAllPieces:cutPiece',
          message: 'cutPiece threw',
          data: {
            i,
            col,
            row,
            name: cutErr?.name,
            msg: String(cutErr?.message || cutErr),
          },
        });
        // #endregion
        throw cutErr;
      }
      const p      = pieceStates[i];
      // Keep gameplay dimensions exactly unchanged; only improve texture density.
      renderPiece(i, dataUrl, p.x, p.y, p.solved, displayW + pad * 2, displayH + pad * 2);
    }
    loadingText.textContent = `Cutting pieces... ${Math.min(end, totalPieces)} / ${totalPieces}`;
  }
  // #region agent log
  const firstEl = pieceEls.find(Boolean);
  jtDbgLog({
    runId: 'pre-fix-1',
    hypothesisId: 'H3-H4',
    location: 'puzzle.js:renderAllPieces:end',
    message: 'render pieces completed',
    data: {
      pieceElsCount: pieceEls.filter(Boolean).length,
      firstImgW: firstEl?.naturalWidth,
      firstImgH: firstEl?.naturalHeight,
      firstComplete: firstEl?.complete,
      scale,
      wrapW: boardWrap?.clientWidth || 0,
      wrapH: boardWrap?.clientHeight || 0,
      scrollW: boardWrap?.scrollWidth || 0,
      scrollH: boardWrap?.scrollHeight || 0,
      scrollLeft: boardWrap?.scrollLeft || 0,
      scrollTop: boardWrap?.scrollTop || 0,
    },
  });
  // #endregion
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

function normalizeRotationDeg(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

/** After pocket filter/animation, force a clean transform (fixes stuck / wrong rotation in some browsers). */
function refreshPieceTransformAfterPocket(index) {
  const e = pieceEls[index];
  const p = pieceStates[index];
  if (!e || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  e.style.willChange = 'auto';
  e.style.transform = 'none';
  void e.offsetHeight;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      movePieceEl(index, p.x, p.y);
    });
  });
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
  const rot = normalizeRotationDeg(pieceStates[index]?.rotation);
  e.style.left = '0';
  e.style.top  = '0';
  const tx = x - pad;
  const ty = y - pad;
  e.style.transform = rot
    ? `translate3d(${tx}px,${ty}px,0) rotate(${rot}deg)`
    : `translate3d(${tx}px,${ty}px,0)`;
  if (!el) updateAvatarPosition(index); // el is only passed during initial render
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

function resolvePiecePick(target, clientX, clientY) {
  let node = target;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  let el = node?.nodeType === 1 ? node.closest('.piece') : null;
  if (!el && Number.isFinite(clientX) && Number.isFinite(clientY)) {
    el = document.elementFromPoint(clientX, clientY)?.closest('.piece');
  }
  return el;
}

function puzzlePlayRoot() {
  return boardWrap?.closest('.puzzle-page') ?? null;
}

function clearHandCursorSequence() {
  handCursorSeqTimerIds.forEach(id => clearTimeout(id));
  handCursorSeqTimerIds = [];
  puzzlePlayRoot()?.classList.remove('jt-cursor-phase-grab', 'jt-cursor-phase-grabbing');
}

function setHandCursorPhase(phase) {
  const root = puzzlePlayRoot();
  if (!root) return;
  root.classList.remove('jt-cursor-phase-grab', 'jt-cursor-phase-grabbing');
  if (phase === 'grab') root.classList.add('jt-cursor-phase-grab');
  else if (phase === 'grabbing') root.classList.add('jt-cursor-phase-grabbing');
}

/** Click-to-pocket: open → closed → open (reach, grasp, release into pocket). */
function runPocketHandCursorSequence() {
  clearHandCursorSequence();
  if (!puzzlePlayRoot()) return;
  setHandCursorPhase('grab');
  handCursorSeqTimerIds.push(window.setTimeout(() => setHandCursorPhase('grabbing'), 95));
  handCursorSeqTimerIds.push(window.setTimeout(() => setHandCursorPhase('grab'), 230));
  handCursorSeqTimerIds.push(window.setTimeout(() => clearHandCursorSequence(), 400));
}

/** After moving a piece: brief closed then open (let go). */
function runReleaseHandCursorSequence() {
  clearHandCursorSequence();
  if (!puzzlePlayRoot()) return;
  setHandCursorPhase('grabbing');
  handCursorSeqTimerIds.push(window.setTimeout(() => setHandCursorPhase('grab'), 100));
  handCursorSeqTimerIds.push(window.setTimeout(() => clearHandCursorSequence(), 300));
}

function attachDragListeners() {
  board.addEventListener('mousedown',   onMouseDown);
  // Touch/pen: pointerdown runs before touchstart — pickup here only, then touchstart skips duplicate onMouseDown.
  if (typeof PointerEvent === 'function') {
    board.addEventListener('pointerdown', onBoardPointerDownPick, { passive: false });
  }
  boardWrap.addEventListener('mousedown', onViewportPanStart);
  board.addEventListener('contextmenu', onContextMenu);
  board.addEventListener('dragstart', e => e.preventDefault(), true); // capture: block native <img> drag
  window.addEventListener('mousemove',  onMouseMove);
  window.addEventListener('mouseup',    onMouseUp);
  if (!isMobileLike) {
    boardWrap.addEventListener('wheel', onWheelZoom, { passive: false });
    boardWrap.addEventListener('pointerover',  onBoardWrapPointerOver, { passive: true });
    boardWrap.addEventListener('pointermove',  onBoardWrapPointerMove, { passive: true });
    boardWrap.addEventListener('pointerleave', onBoardWrapPointerLeave,{ passive: true });
  }
  board.addEventListener('touchend', onDoubleTap);
  boardWrap.addEventListener('dblclick', onBoardDblClick);
  boardWrap.addEventListener('touchstart', onTouchStart, { passive: false });
  boardWrap.addEventListener('touchmove',  onTouchMove,  { passive: false });
  boardWrap.addEventListener('touchend',   onTouchEnd);
  window.addEventListener('resize', syncBoardScrollContentSize, { passive: true });
}

/** Touch / pen pickup (mouse still uses mousedown — avoids double onMouseDown from touchstart). */
function onBoardPointerDownPick(e) {
  if (!e.isPrimary) return;
  if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;

  onMouseDown({
    clientX: e.clientX,
    clientY: e.clientY,
    target: e.target,
    button: 0,
    isTouch: true,
  });
  if (dragging) {
    e.preventDefault();
    suppressMouseDownPickUntil = Date.now() + 650;
    if (isMobileLike && dragging.indices.length === 1) {
      startTouchHoldSelection(dragging.anchorIndex, e.clientX, e.clientY);
    }
  }
}

function onMouseDown(e) {
  if (typeof e.button === 'number' && e.button !== 0) return;
  if (e.button === 0 && e.ctrlKey) return;
  if (Date.now() < suppressMouseDownPickUntil) return;
  const el = resolvePiecePick(e.target, e.clientX, e.clientY);

  if (!el || el.classList.contains('solved')) return;

  const index = Number(el.dataset.index);
  const state = pieceStates[index];

  if (state.lockedBy && state.lockedBy !== playerId) {
    tryForceRelease(index);
    return;
  }

  if (hand.includes(index)) return;

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
    relOffsets[i] = {
      dx: pieceStates[i].x - anchorX,
      dy: pieceStates[i].y - anchorY,
    };
  });

  dragging = {
    indices,
    anchorIndex: index,
    offsetX,
    offsetY,
    relOffsets,
    locked: false,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startTs: Date.now(),
    fromTouch: !!e?.isTouch,
  };
}

function onMouseMove(e) {
  if (viewportPan) {
    e.preventDefault();
    boardWrap.scrollLeft = viewportPan.scrollLeft - (e.clientX - viewportPan.startX);
    boardWrap.scrollTop  = viewportPan.scrollTop  - (e.clientY - viewportPan.startY);
    return;
  }
  if (!dragging) return;
  const { indices, offsetX, offsetY, relOffsets } = dragging;

  if (!dragging.locked) {
    const dx = e.clientX - dragging.startClientX;
    const dy = e.clientY - dragging.startClientY;
    const dist = Math.hypot(dx, dy);
    const threshold = dragging.fromTouch ? DRAG_DEAD_ZONE_TOUCH : DRAG_DEAD_ZONE_DESKTOP;
    const elapsed = Date.now() - (dragging.startTs || 0);
    if (elapsed < DRAG_START_GRACE_MS && dist < threshold + 2) return;
    if (dist < threshold) return;
  }

  if (!dragging.locked) {
    dragging.locked = true;
    lockGroup(puzzleId, indices, playerId);
    indices.forEach(i => { pieceStates[i].lockedBy = playerId; });
    indices.forEach(i => {
      pieceEls[i]?.classList.add('dragging');
      if (pieceEls[i]) pieceEls[i].style.zIndex = 1000;
    });
    if (!startedAt) {
      setStartedAt(puzzleId).then(t => {
        startedAt = t;
        startTimer();
      });
    }
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

  updateGroupPosition(puzzleId, positions);
  const ap = pieceStates[dragging?.anchorIndex ?? indices[0]];
  if (ap) lastPlayerPos[playerId] = { x: ap.x, y: ap.y };
  scheduleSyncBoardScrollContentSize();
}

async function onMouseUp(e) {
  if (viewportPan) {
    viewportPan = null;
    boardWrap.classList.remove('panning');
    return;
  }
  if (!dragging) return;
  if (typeof e.button === 'number' && e.button !== 0) {
    if (!dragging.locked) dragging = null;
    return;
  }
  const { indices, anchorIndex, offsetX, offsetY, relOffsets, locked } = dragging;
  dragging = null;

  indices.forEach(i => {
    pieceEls[i]?.classList.remove('dragging');
    if (pieceEls[i]) pieceEls[i].style.zIndex = '';
  });

  if (!locked) {
    addToHand(anchorIndex);
    return;
  }

  runReleaseHandCursorSequence();

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
    const anchorX   = pieceStates[anchorIdx].x;
    const anchorY   = pieceStates[anchorIdx].y;

    const rot = pieceStates[snap.neighbourIndex].rotation ?? 0;

    const positions = [];
    allIndices.forEach(i => {
      const iCol = i % cols;
      const iRow = Math.floor(i / cols);
      const dcI  = iCol - anchorCol;
      const drI  = iRow - anchorRow;
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

    mergeGroups(allIndices);
    const gid = pieceGroup[allIndices[0]];
    await writeSnappedPositions(puzzleId, positions, gid);
    checkSolvedState();
    updateProgress();
    checkCompletion();
  } else {
    await unlockGroup(puzzleId, indices);
    indices.forEach(i => { pieceStates[i].lockedBy = null; });
  }
  syncBoardScrollContentSize();
}

function onTouchStart(e) {
  if (e.touches.length === 2) {
    cancelTouchHoldSelection();
    if (dragging) {
      if (dragging.locked) unlockGroup(puzzleId, dragging.indices);
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

  if (pinch) return;

  // PointerEvent path already ran onBoardPointerDownPick (before this touchstart).
  if (typeof PointerEvent === 'function') {
    if (dragging) {
      e.preventDefault();
      return;
    }
  }

  const touch = e.touches[0];
  const root = touch.target?.nodeType === Node.TEXT_NODE ? touch.target.parentElement : touch.target;
  onMouseDown({
    clientX: touch.clientX,
    clientY: touch.clientY,
    target: root,
    button: 0,
    isTouch: true,
  });
  if (dragging) {
    e.preventDefault();
    suppressMouseDownPickUntil = Date.now() + 650;
    if (isMobileLike && dragging.indices.length === 1) {
      startTouchHoldSelection(dragging.anchorIndex, touch.clientX, touch.clientY);
    }
  }
}

function onTouchMove(e) {
  if (e.touches.length === 2 && pinch) {
    e.preventDefault();
    const newDist = touchDist(e.touches);
    const raw     = pinch.scale0 * (newDist / pinch.dist0);
    const mid = touchMidpoint(e.touches);
    applyScale(Math.min(SCALE_MAX, Math.max(SCALE_MIN, raw)), zoomAnchorFromClient(mid.x, mid.y));
    return;
  }

  const touch = e.touches[0];
  if (touchHold) {
    const dx = Math.abs(touch.clientX - touchHold.startX);
    const dy = Math.abs(touch.clientY - touchHold.startY);
    if (dx > TOUCH_HOLD_SLOP || dy > TOUCH_HOLD_SLOP) cancelTouchHoldSelection();
  }

  if (!dragging) return;
  e.preventDefault();
  onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
}

function onTouchEnd(e) {
  const holdActivated = !!touchHold?.activated;
  cancelTouchHoldSelection();

  if (pinch && e.touches.length < 2) {
    pinch = null;
    return;
  }

  if (holdActivated) return;

  if (!dragging) {
    if (hand.length > 0 && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      const target = document.elementFromPoint(t.clientX, t.clientY);
      if (!target?.closest('.piece')) {
        if (checkEmptyDoubleTap(t.clientX, t.clientY)) return;
      }
    }
    return;
  }
  const touch = e.changedTouches[0];
  onMouseUp({ clientX: touch.clientX, clientY: touch.clientY, isTouch: true });
}

function startTouchHoldSelection(index, startX, startY) {
  cancelTouchHoldSelection();
  touchHold = { index, startX, startY, activated: false, timer: null };
  touchHold.timer = setTimeout(() => {
    if (!touchHold || touchHold.index !== index) return;
    if (!dragging || dragging.locked || dragging.anchorIndex !== index) return;
    dragging = null;
    addToHand(index);
    touchHold.activated = true;
  }, TOUCH_HOLD_MS);
}

function cancelTouchHoldSelection() {
  if (!touchHold) return;
  if (touchHold.timer) clearTimeout(touchHold.timer);
  touchHold = null;
}

// ── Rotation ──────────────────────────────────────────────────────────────────

function onContextMenu(e) {
  e.preventDefault();
  if (!meta?.hardMode) return;
  const el = e.target.closest('.piece');
  if (!el) return;
  const index = Number(el.dataset.index);
  // Cancel in-progress "click to hand" on same piece (e.g. Ctrl+click path started mousedown).
  if (dragging && !dragging.locked && dragging.anchorIndex === index) {
    dragging = null;
  }
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
    scheduleSyncBoardScrollContentSize();
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
  scheduleSyncBoardScrollContentSize();
}

function touchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function touchMidpoint(touches) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

function clampScale(s) {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
}

function updateBoardTransform() {
  const hasPan = Math.abs(boardTx) > 0.5 || Math.abs(boardTy) > 0.5;
  if (hasPan) {
    board.style.marginLeft = `${boardTx}px`;
    board.style.marginTop = `${boardTy}px`;
  } else {
    board.style.marginLeft = '';
    board.style.marginTop = '';
  }
  if (scale === 1 && !hasPan) {
    board.style.transform = '';
  } else {
    board.style.transform = `translateZ(0) scale(${scale})`;
  }
}

function resetBoardTranslate() {
  boardTx = 0;
  boardTy = 0;
  updateBoardTransform();
}

function syncBoardScrollContentSize() {
  if (!boardScrollContent || !boardWrap) return;
  const cw = boardWrap.clientWidth || 0;
  const ch = boardWrap.clientHeight || 0;

  let contentW = BOARD_W;
  let contentH = BOARD_H;
  const aabb = getPieceCloudAabbBoard();
  if (aabb) {
    const s = BOARD_CLOUD_SLACK;
    const leftBound = Math.min(0, aabb.minX - s);
    const topBound = Math.min(0, aabb.minY - s);
    const rightBound = Math.max(BOARD_W, aabb.maxX + s);
    const bottomBound = Math.max(BOARD_H, aabb.maxY + s);
    contentW = Math.max(BOARD_W, rightBound - leftBound);
    contentH = Math.max(BOARD_H, bottomBound - topBound);
  }

  const visualW = contentW * scale;
  const visualH = contentH * scale;
  const padX = BOARD_SCROLL_PADDING;
  const padTop = BOARD_SCROLL_PADDING + SCROLL_TOP_GUTTER;
  const padBottom = BOARD_SCROLL_PADDING;
  boardScrollContent.style.padding = `${padTop}px ${padX}px ${padBottom}px`;
  const innerW = padX * 2 + visualW;
  const innerH = padTop + padBottom + visualH;
  const minLayoutW = padX * 2 + BOARD_W;
  const minLayoutH = padTop + padBottom + BOARD_H;
  boardScrollContent.style.width = Math.max(innerW, cw, minLayoutW) + 'px';
  boardScrollContent.style.height = Math.max(innerH, ch, minLayoutH) + 'px';
  // transform-origin: 0 0 makes the board grow only right/down, but flex centering
  // positions the layout box (BOARD_W × BOARD_H). Compensate so flex centres the
  // VISUAL extent, keeping scroll symmetric and zoom anchors accurate.
  board.style.marginRight  = (BOARD_W * (scale - 1)) + 'px';
  board.style.marginBottom = (BOARD_H * (scale - 1)) + 'px';
}

function scheduleSyncBoardScrollContentSize() {
  if (boardScrollSyncRaf != null) return;
  boardScrollSyncRaf = requestAnimationFrame(() => {
    boardScrollSyncRaf = null;
    syncBoardScrollContentSize();
  });
}

/** Center of the visible scroll viewport (stable zoom pivot for toolbar +/-). */
function zoomAnchorViewportCenter() {
  const wr = boardWrap.getBoundingClientRect();
  return {
    anchorClientX: wr.left + wr.width / 2,
    anchorClientY: wr.top + wr.height / 2,
  };
}

/**
 * Zoom anchor in viewport (client) coords. Clamp to boardWrap so Ctrl+wheel and
 * pinch always zoom toward the pointer / pinch midpoint — not the board center
 * when the cursor is over padding, gutters, or the scaled board’s visual edge.
 */
function zoomAnchorFromClient(clientX, clientY) {
  if (!boardWrap) {
    return { anchorClientX: clientX, anchorClientY: clientY };
  }
  const wr = boardWrap.getBoundingClientRect();
  const x = Math.max(wr.left, Math.min(wr.right, clientX));
  const y = Math.max(wr.top, Math.min(wr.bottom, clientY));
  return { anchorClientX: x, anchorClientY: y };
}

/** Viewport → board inner coords (same space as piece x,y). Clamps to the board’s painted rect so wrap padding / missed clicks don’t skew the drop point. */
function clientToBoardPoint(clientX, clientY) {
  const br = board.getBoundingClientRect();
  const ax = Math.max(br.left, Math.min(br.right - 1e-4, clientX));
  const ay = Math.max(br.top, Math.min(br.bottom - 1e-4, clientY));
  return {
    x: (ax - br.left) / scale,
    y: (ay - br.top) / scale,
  };
}

function applyScale(s, opts = {}) {
  const next = clampScale(s);
  if (!Number.isFinite(next)) return;
  const prev = scale;
  if (Math.abs(next - prev) < 0.001) return;

  const { anchorClientX, anchorClientY } = opts;
  const hasAnchor = Number.isFinite(anchorClientX) && Number.isFinite(anchorClientY);

  let bx, by, ox, oy, scrollLeft0, scrollTop0;
  if (hasAnchor) {
    // Board-local point under the anchor using the board’s on-screen rect (after transform).
    // scrollLeft + (client - wrap) − offsetLeft mixes scroll content vs padding/flex and skews the pivot.
    const br = board.getBoundingClientRect();
    bx = (anchorClientX - br.left) / prev;
    by = (anchorClientY - br.top) / prev;
    ox = board.offsetLeft;
    oy = board.offsetTop;
    scrollLeft0 = boardWrap.scrollLeft;
    scrollTop0 = boardWrap.scrollTop;
  }

  scale = next;
  syncBoardScrollContentSize();

  if (hasAnchor) {
    const ox2 = board.offsetLeft;
    const oy2 = board.offsetTop;
    // Invariant: screenX ≈ wrapLeft - scrollLeft + offsetLeft + pan + bx*scale
    // (pan is margin-left/top when scroll hits limits.) Conserved: scrollLeft - boardTx in the pre-margin model.
    const kx = scrollLeft0 - boardTx + (ox2 - ox) + bx * (next - prev);
    const ky = scrollTop0 - boardTy + (oy2 - oy) + by * (next - prev);
    const maxSl = Math.max(0, boardWrap.scrollWidth - boardWrap.clientWidth);
    const maxSt = Math.max(0, boardWrap.scrollHeight - boardWrap.clientHeight);
    const sl = Math.max(0, Math.min(maxSl, Math.round(kx)));
    const st = Math.max(0, Math.min(maxSt, Math.round(ky)));
    boardTx = sl - kx;
    boardTy = st - ky;
    boardWrap.scrollLeft = sl;
    boardWrap.scrollTop = st;
  } else {
    const maxSl = Math.max(0, boardWrap.scrollWidth - boardWrap.clientWidth);
    const maxSt = Math.max(0, boardWrap.scrollHeight - boardWrap.clientHeight);
    if (maxSl <= 0) boardTx = 0;
    if (maxSt <= 0) boardTy = 0;
  }

  updateBoardTransform();
}

function centerBoardInView() {
  if (!boardWrap || boardWrap.clientWidth < 8 || boardWrap.clientHeight < 8) return;
  boardTx = 0; boardTy = 0;
  updateBoardTransform();
  const maxSl = Math.max(0, boardWrap.scrollWidth - boardWrap.clientWidth);
  const maxSt = Math.max(0, boardWrap.scrollHeight - boardWrap.clientHeight);
  boardWrap.scrollLeft = Math.round(maxSl / 2);
  boardWrap.scrollTop = Math.round(maxSt / 2);
}

function centerPieceCloudInView() {
  if (!boardWrap || boardWrap.clientWidth < 8 || boardWrap.clientHeight < 8) return;
  const bounds = getPieceCloudBounds();
  if (!bounds) {
    centerBoardInView();
    return;
  }
  framePieceCloudTopInView(bounds);
}

/** After loading overlay hides: wait for real wrap dimensions (iOS / in-app WebViews can report 0 briefly). */
function scheduleMobilePieceFraming() {
  if (!isMobileLike || !boardWrap) return;
  const MIN = 40;
  const MAX_TRIES = 20;
  let tries = 0;
  const step = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const w = boardWrap.clientWidth;
        const h = boardWrap.clientHeight;
        if (w >= MIN && h >= MIN) {
          framePieceCloudInView();
          return;
        }
        tries += 1;
        if (tries < MAX_TRIES) {
          setTimeout(step, 48);
          return;
        }
        syncBoardScrollContentSize();
        fitBoardToViewport();
      });
    });
  };
  step();
}

function framePieceCloudInView() {
  if (!boardWrap || boardWrap.clientWidth < 32 || boardWrap.clientHeight < 32) return;
  const bounds = getPieceCloudBounds();
  if (!bounds) {
    centerBoardInView();
    return;
  }

  // Mobile: zoom to piece cloud first (with gutter), then center on it.
  // This avoids "pieces stuck on one side until manual zoom/pan".
  const gutter = Math.max(24, BOARD_SCROLL_PADDING + 8);
  const vw = Math.max(1, boardWrap.clientWidth - gutter * 2);
  const vh = Math.max(1, boardWrap.clientHeight - gutter * 2);
  const wRatio = vw / bounds.w;
  const hRatio = vh / bounds.h;
  const fitCloud = Math.min(wRatio, hRatio);
  if (Number.isFinite(fitCloud) && fitCloud > 0) {
    // Use true fit on mobile so wide scatters remain reachable on smaller screens.
    const boundByHeight = hRatio <= wRatio;
    const targetScale = snapBoardScaleToDevicePixels(
      clampScale(fitCloud),
      boundByHeight,
      BOARD_W,
      BOARD_H,
      SCALE_MIN,
      SCALE_MAX,
      isMobileLike,
    );
    if (Math.abs(targetScale - scale) > 0.001) {
      applyScale(targetScale, zoomAnchorViewportCenter());
    }
  }
  framePieceCloudTopInView(bounds);
}

/**
 * Scroll so the piece cloud’s top (plus pad) sits FRAME_CLOUD_TOP_MARGIN_PX below the wrap top;
 * horizontal anchor stays the cloud center (cx).
 */
function framePieceCloudTopInView(bounds) {
  if (!boardWrap || boardWrap.clientWidth < 8 || boardWrap.clientHeight < 8) return;
  boardTx = 0; boardTy = 0;
  updateBoardTransform();
  const cw = boardWrap.clientWidth;
  const cloudTopBoard = bounds.cy - bounds.h * 0.5 - FRAME_CLOUD_TOP_PAD_BOARD;
  const targetLeft = board.offsetLeft + bounds.cx * scale - cw * (0.5 + BOARD_VIEW_CENTER_BIAS_X);
  const targetTop = board.offsetTop + cloudTopBoard * scale - FRAME_CLOUD_TOP_MARGIN_PX;

  const maxSl = Math.max(0, boardWrap.scrollWidth - boardWrap.clientWidth);
  const maxSt = Math.max(0, boardWrap.scrollHeight - boardWrap.clientHeight);
  boardWrap.scrollLeft = Math.max(0, Math.min(maxSl, Math.round(targetLeft)));
  boardWrap.scrollTop = Math.max(0, Math.min(maxSt, Math.round(targetTop)));
}

/**
 * Axis-aligned bounds of all on-board pieces in board-local coordinates (same space as piece x/y).
 * Used for scroll-area sizing so scattered / negative positions stay reachable when zoomed.
 */
function getPieceCloudAabbBoard() {
  if (!pieceStates?.length || !board) return null;

  const pad = meta?._pad ?? 0;
  const drawW = (meta?.displayW ?? 0) + pad * 2;
  const drawH = (meta?.displayH ?? 0) + pad * 2;
  if (drawW <= 0 || drawH <= 0) return null;

  const br = board.getBoundingClientRect();
  if (pieceEls?.length && br.width > 0 && br.height > 0 && scale > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let any = false;
    for (const el of pieceEls) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const left = (r.left - br.left) / scale;
      const top = (r.top - br.top) / scale;
      const right = (r.right - br.left) / scale;
      const bottom = (r.bottom - br.top) / scale;
      if (left < minX) minX = left;
      if (top < minY) minY = top;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
      any = true;
    }
    if (any && Number.isFinite(minX) && Number.isFinite(minY)) {
      return { minX, minY, maxX, maxY };
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pieceStates) {
    const left = p.x - pad;
    const top = p.y - pad;
    const right = left + drawW;
    const bottom = top + drawH;
    if (left < minX) minX = left;
    if (top < minY) minY = top;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

function getPieceCloudBounds() {
  if (!boardWrap) return null;
  const a = getPieceCloudAabbBoard();
  if (!a) return null;
  return {
    cx: (a.minX + a.maxX) / 2,
    cy: (a.minY + a.maxY) / 2,
    w: Math.max(1, a.maxX - a.minX),
    h: Math.max(1, a.maxY - a.minY),
  };
}

function fitBoardToViewport() {
  if (!boardWrap || boardWrap.clientWidth < 8 || boardWrap.clientHeight < 8) return;
  const gutter = BOARD_SCROLL_PADDING * 2;
  const wFit = Math.max(0.01, (boardWrap.clientWidth - gutter) / BOARD_W);
  const hFit = Math.max(0.01, (boardWrap.clientHeight - gutter) / BOARD_H);
  const fit = Math.min(1, wFit, hFit);
  const boundByHeight = hFit <= wFit;
  const snapped = snapBoardScaleToDevicePixels(
    fit || 1,
    boundByHeight,
    BOARD_W,
    BOARD_H,
    SCALE_MIN,
    SCALE_MAX,
    isMobileLike,
  );
  applyScale(clampScale(snapped));
  centerBoardInView();
  // #region agent log
  jtDbgLog({
    runId: 'pre-fix-1',
    hypothesisId: 'H4',
    location: 'puzzle.js:fitBoardToViewport:end',
    message: 'fitBoardToViewport applied',
    data: {
      fit,
      snapped,
      scale,
      clientW: boardWrap?.clientWidth || 0,
      clientH: boardWrap?.clientHeight || 0,
      scrollW: boardWrap?.scrollWidth || 0,
      scrollH: boardWrap?.scrollHeight || 0,
      scrollLeft: boardWrap?.scrollLeft || 0,
      scrollTop: boardWrap?.scrollTop || 0,
      padding: BOARD_SCROLL_PADDING,
    },
  });
  // #endregion
}

function flushWheelZoom() {
  wheelZoomRaf = null;
  if (dragging) {
    wheelDeltaFrame = 0;
    return;
  }
  const sum = wheelDeltaFrame;
  wheelDeltaFrame = 0;
  if (sum === 0) return;
  const capped = Math.max(-280, Math.min(280, sum));
  const factor = Math.exp(-capped * 0.00135);
  const zoomingOut = factor < 1;
  const anchorOpts = zoomingOut
    ? zoomAnchorViewportCenter()
    : zoomAnchorFromClient(wheelZoomAnchor.anchorClientX, wheelZoomAnchor.anchorClientY);
  applyScale(scale * factor, anchorOpts);
}

function onBoardWrapPointerOver(e) {
  lastBoardWrapPointerClient.x = e.clientX;
  lastBoardWrapPointerClient.y = e.clientY;
  hasLastBoardWrapPointer = true;
}

function onBoardWrapPointerMove(e) {
  lastBoardWrapPointerClient.x = e.clientX;
  lastBoardWrapPointerClient.y = e.clientY;
  hasLastBoardWrapPointer = true;
}

function onBoardWrapPointerLeave(e) {
  const rel = e.relatedTarget;
  if (!rel || !boardWrap.contains(rel)) hasLastBoardWrapPointer = false;
}

function onWheelZoom(e) {
  if (dragging) return;
  const wantsZoom = e.ctrlKey || e.metaKey;
  if (!wantsZoom) return;
  e.preventDefault();
  const wr = boardWrap?.getBoundingClientRect();
  const wheelInside = wr && e.clientX >= wr.left && e.clientX <= wr.right
    && e.clientY >= wr.top && e.clientY <= wr.bottom;
  // Prefer wheel event coords when inside the wrap (correct for mouse + many trackpads).
  // Fall back to last pointer only when wheel clientX/Y are missing or outside (Chromium ctrl+wheel pinch quirk).
  let ax = e.clientX;
  let ay = e.clientY;
  if (wheelInside && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
    lastBoardWrapPointerClient.x = e.clientX;
    lastBoardWrapPointerClient.y = e.clientY;
    hasLastBoardWrapPointer = true;
  } else if (hasLastBoardWrapPointer && Number.isFinite(lastBoardWrapPointerClient.x)) {
    ax = lastBoardWrapPointerClient.x;
    ay = lastBoardWrapPointerClient.y;
  }
  let delta = e.deltaY;
  if (e.deltaMode === 1) delta *= 16;
  if (e.deltaMode === 2) delta *= boardWrap.clientHeight;
  wheelDeltaFrame += delta;
  wheelZoomAnchor = { anchorClientX: ax, anchorClientY: ay };
  if (!wheelZoomRaf) wheelZoomRaf = requestAnimationFrame(flushWheelZoom);
}

function onBoardDblClick(e) {
  if (hand.length === 0) return;
  if (e.target.closest('.piece')) return;
  if (Date.now() - lastAddToHandAt < 600) return;
  e.preventDefault();
  dropHandAt(e.clientX, e.clientY);
}

function onViewportPanStart(e) {
  if (isMobileLike || dragging) return;
  if (e.button !== 0) return;
  if (scale <= 1.01) return;
  if (e.target.closest('.piece')) return;
  viewportPan = {
    startX: e.clientX,
    startY: e.clientY,
    scrollLeft: boardWrap.scrollLeft,
    scrollTop: boardWrap.scrollTop,
  };
  boardWrap.classList.add('panning');
  e.preventDefault();
}

// ── Hand (multi-select) system ─────────────────────────────────────────────

function getPocketIndicesForPiece(index) {
  if (!pieceStates[index] || pieceStates[index].solved) return null;
  const gid = pieceGroup[index];
  if (!gid) return [index];
  const arr = [...groups[gid]];
  if (arr.length > POCKET_MAX_GROUP_PIECES) return null;
  return arr;
}

/** All hand indices that belong to the same merged group as `index` (or just [index] if single). */
function handIndicesCoPocketed(index) {
  const gid = pieceGroup[index];
  if (!gid) return [index];
  const members = groups[gid];
  if (!members) return [index];
  return hand.filter(i => members.has(i));
}

/** One slot per merged group in the pocket, plus one per loose single (order follows `hand`). */
function getHandPocketSlots() {
  const seenG = new Set();
  /** @type {number[][]} */
  const slots = [];
  for (const i of hand) {
    const gid = pieceGroup[i];
    if (gid != null && groups[gid]) {
      if (seenG.has(gid)) continue;
      seenG.add(gid);
      const members = [...groups[gid]].filter(idx => hand.includes(idx));
      if (members.length) slots.push(members);
      else slots.push([i]);
    } else {
      slots.push([i]);
    }
  }
  return slots;
}

function getHandSlotKey(slotIndices) {
  const i = slotIndices[0];
  const gid = pieceGroup[i];
  if (gid != null && groups[gid]) return `g:${gid}`;
  return `s:${i}`;
}

function createHandContainer() {
  const el = document.createElement('div');
  el.id = 'piece-hand';
  el.className = 'piece-hand';
  document.body.appendChild(el);
  return el;
}

function stopHandSlotTimerTick() {
  if (handSlotTimerTickInterval != null) {
    clearInterval(handSlotTimerTickInterval);
    handSlotTimerTickInterval = null;
  }
}

function tickHandSlotTimerBars() {
  if (!handContainer || hand.length === 0) return;
  handContainer.querySelectorAll('.hand-pocket-slot[data-hand-slot-key]').forEach(col => {
    const key = col.dataset.handSlotKey;
    const end = handSlotExpiresAt.get(key);
    const bar = col.querySelector('.hand-block-timer');
    if (!bar) return;
    const rem = end != null ? Math.max(0, end - Date.now()) : 0;
    const pct = Math.min(100, (rem / HAND_RELEASE_MS) * 100);
    bar.style.transition = 'none';
    bar.style.width = pct + '%';
  });
}

function ensureHandSlotTimerTick() {
  if (handSlotTimerTickInterval != null) return;
  handSlotTimerTickInterval = setInterval(tickHandSlotTimerBars, 200);
}

function clearAllHandSlotTimers() {
  stopHandSlotTimerTick();
  for (const tid of handSlotTimeoutIds.values()) clearTimeout(tid);
  handSlotTimeoutIds.clear();
  handSlotExpiresAt.clear();
}

function rescheduleHandSlotTimeout(key) {
  const prev = handSlotTimeoutIds.get(key);
  if (prev != null) clearTimeout(prev);
  const until = handSlotExpiresAt.get(key);
  if (until == null) return;
  const delay = Math.max(0, until - Date.now());
  const tid = setTimeout(() => {
    handSlotTimeoutIds.delete(key);
    onHandSlotExpired(key);
  }, delay);
  handSlotTimeoutIds.set(key, tid);
}

function onHandSlotExpired(key) {
  const slot = getHandPocketSlots().find(s => getHandSlotKey(s) === key);
  if (!slot?.length) return;
  releasePocketIndicesOnly([...slot]);
}

/** New slots get a fresh deadline; existing slots keep theirs. Removed slots drop out. */
function syncHandSlotTimers() {
  const keys = new Set(getHandPocketSlots().map(getHandSlotKey));
  for (const key of [...handSlotExpiresAt.keys()]) {
    if (!keys.has(key)) {
      const tid = handSlotTimeoutIds.get(key);
      if (tid != null) clearTimeout(tid);
      handSlotTimeoutIds.delete(key);
      handSlotExpiresAt.delete(key);
    }
  }
  for (const key of keys) {
    if (!handSlotExpiresAt.has(key)) {
      handSlotExpiresAt.set(key, Date.now() + HAND_RELEASE_MS);
      rescheduleHandSlotTimeout(key);
    }
  }
}

/** Apply saved pre-pocket positions; returns entries for Firebase (only indices that had a snapshot). */
function restorePocketHomeLocal(indices) {
  const entries = [];
  for (const i of indices) {
    const home = pocketHomeByIndex.get(i);
    if (!home) continue;
    pieceStates[i].x = home.x;
    pieceStates[i].y = home.y;
    pieceStates[i].rotation = home.rotation;
    movePieceEl(i, home.x, home.y);
    pocketHomeByIndex.delete(i);
    entries.push({
      index: i,
      x: home.x,
      y: home.y,
      rotation: home.rotation,
    });
  }
  return entries;
}

/** Put pocketed pieces back on the board (one block / whole hand). */
function releaseAllFromPocket() {
  clearAllHandSlotTimers();
  const idx = [...hand];
  if (idx.length === 0) {
    renderHand();
    return;
  }
  hand = [];
  for (const i of idx) {
    pieceEls[i]?.classList.remove('in-hand', 'pocket-pulse');
    pieceStates[i].lockedBy = null;
  }
  const restored = restorePocketHomeLocal(idx);
  if (restored.length) writePocketRestoreStates(puzzleId, restored);
  unlockGroup(puzzleId, idx);
  for (const i of idx) {
    if (Number.isFinite(pieceStates[i].x) && Number.isFinite(pieceStates[i].y)) {
      refreshPieceTransformAfterPocket(i);
    }
    updatePieceZIndex(i);
  }
  renderHand();
}

/** Unlock a subset still in the pocket (e.g. clearing outsiders before pocketing a group). */
function releasePocketIndicesOnly(indices) {
  const uniq = [...new Set(indices)].filter(i => hand.includes(i));
  if (!uniq.length) return;
  hand = hand.filter(h => !uniq.includes(h));
  for (const i of uniq) {
    pieceEls[i]?.classList.remove('in-hand', 'pocket-pulse');
    pieceStates[i].lockedBy = null;
  }
  const restored = restorePocketHomeLocal(uniq);
  if (restored.length) writePocketRestoreStates(puzzleId, restored);
  unlockGroup(puzzleId, uniq);
  uniq.forEach(i => {
    if (Number.isFinite(pieceStates[i].x) && Number.isFinite(pieceStates[i].y)) {
      refreshPieceTransformAfterPocket(i);
    }
    updatePieceZIndex(i);
  });
  syncHandSlotTimers();
  renderHand();
}

function pieceDrawOrderZ(index) {
  const edges = meta?.edges?.[index];
  if (!edges || !meta?.cols || !meta?.rows) return index;
  const col = index % meta.cols;
  const row = Math.floor(index / meta.cols);
  let z = (meta.cols - col) + (meta.rows - row) * meta.cols;
  if (edges.right > 0) z += meta.rows;
  if (edges.bottom > 0) z += meta.cols;
  return z;
}

function layoutMetaForHandIndices(indices, maxW, maxH) {
  if (!indices.length || !meta) return null;
  const pad = meta._pad ?? 0;
  const dw = meta.displayW ?? 0;
  const dh = meta.displayH ?? 0;
  const elW = dw + pad * 2;
  const elH = dh + pad * 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of indices) {
    const p = pieceStates[i];
    if (!p) continue;
    const left = p.x - pad;
    const top = p.y - pad;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + elW);
    maxY = Math.max(maxY, top + elH);
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  if (!(bw > 0) || !(bh > 0)) return null;
  const k = Math.min(maxW / bw, maxH / bh, 2.5);
  return { minX, minY, bw, bh, k, elW, elH, pad };
}

/** Union bbox of all pocketed pieces (board coords) — used for rigid drop, not preview pixels. */
function getHandPocketLayoutMeta() {
  return layoutMetaForHandIndices(hand, HAND_BLOCK_MAX_W, HAND_BLOCK_MAX_H);
}

function buildHandSlotPreviewElement(slotIndices, maxW, maxH) {
  const layout = layoutMetaForHandIndices(slotIndices, maxW, maxH);
  const preview = document.createElement('div');
  preview.className = 'hand-block-preview';
  if (layout) {
    const { minX, minY, bw, bh, k, elW, elH, pad } = layout;
    const pw = Math.max(1, Math.round(bw * k));
    const ph = Math.max(1, Math.round(bh * k));
    preview.style.width = pw + 'px';
    preview.style.height = ph + 'px';

    const ordered = [...slotIndices].sort((a, b) => pieceDrawOrderZ(a) - pieceDrawOrderZ(b));
    for (const index of ordered) {
      const src = pieceEls[index]?.src;
      if (!src) continue;
      const img = document.createElement('img');
      img.src = src;
      img.className = 'hand-block-piece-img';
      img.draggable = false;
      const p = pieceStates[index];
      const left = (p.x - pad - minX) * k;
      const top = (p.y - pad - minY) * k;
      const w = elW * k;
      const h = elH * k;
      img.style.left = `${left}px`;
      img.style.top = `${top}px`;
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
      const rot = normalizeRotationDeg(p.rotation);
      img.style.transformOrigin = 'center center';
      img.style.transform = rot ? `rotate(${rot}deg)` : '';
      preview.appendChild(img);
    }
  } else {
    preview.style.width = '64px';
    preview.style.height = '64px';
    preview.style.background = 'rgba(255,255,255,0.06)';
  }
  return preview;
}

function addToHand(index) {
  const gid = pieceGroup[index];
  if (gid && groups[gid].size > POCKET_MAX_GROUP_PIECES) {
    showPocketGroupTooBigToast();
    return;
  }

  const indices = getPocketIndicesForPiece(index);
  if (!indices) return;

  if (indices.some(i => pieceStates[i].lockedBy && pieceStates[i].lockedBy !== playerId)) return;

  const pocketExactMatch =
    hand.length > 0 &&
    hand.length === indices.length &&
    hand.every(h => indices.includes(h)) &&
    indices.every(i => hand.includes(i));
  if (pocketExactMatch) {
    releaseAllFromPocket();
    return;
  }

  if (indices.length === 1 && hand.includes(indices[0]) && hand.length > 1) {
    releasePocketIndicesOnly([indices[0]]);
    return;
  }

  lockGroup(puzzleId, indices, playerId);

  const now = Date.now();
  lastAddToHandAt = now;

  for (const i of indices) {
    if (!hand.includes(i)) {
      pocketHomeByIndex.set(i, {
        x: pieceStates[i].x,
        y: pieceStates[i].y,
        rotation: normalizeRotationDeg(pieceStates[i].rotation ?? 0),
      });
      hand.push(i);
    }
    pieceStates[i].lockedBy = playerId;
    const el = pieceEls[i];
    el?.classList.add('in-hand', 'pocket-pulse');
    window.setTimeout(() => el?.classList.remove('pocket-pulse'), 500);
  }

  syncHandSlotTimers();
  renderHand();
  runPocketHandCursorSequence();

  if (!startedAt) {
    setStartedAt(puzzleId).then(t => { startedAt = t; startTimer(); });
  }
}

function removeFromHand(_index) {
  releaseAllFromPocket();
}

function removeFromHandSilent(index) {
  const toRemove = handIndicesCoPocketed(index);
  for (const i of toRemove) {
    hand = hand.filter(h => h !== i);
    pieceEls[i]?.classList.remove('in-hand', 'pocket-pulse');
  }
  const restored = restorePocketHomeLocal(toRemove);
  if (restored.length) writePocketRestoreStates(puzzleId, restored);
  for (const i of toRemove) {
    if (Number.isFinite(pieceStates[i].x) && Number.isFinite(pieceStates[i].y)) {
      refreshPieceTransformAfterPocket(i);
    }
    updatePieceZIndex(i);
  }
  syncHandSlotTimers();
  renderHand();
}

function currentHandBoardBBox(pad, elW, elH) {
  let nMinX = Infinity, nMinY = Infinity, nMaxX = -Infinity, nMaxY = -Infinity;
  for (const idx of hand) {
    const p = pieceStates[idx];
    const left = p.x - pad;
    const top = p.y - pad;
    nMinX = Math.min(nMinX, left);
    nMinY = Math.min(nMinY, top);
    nMaxX = Math.max(nMaxX, left + elW);
    nMaxY = Math.max(nMaxY, top + elH);
  }
  return { nMinX, nMinY, nMaxX, nMaxY };
}

function shiftAllHandPieces(dx, dy) {
  for (const idx of hand) {
    const p = pieceStates[idx];
    p.x += dx;
    p.y += dy;
    movePieceEl(idx, p.x, p.y);
  }
}

function clampHandFormationToBoard(pad, elW, elH) {
  for (let iter = 0; iter < 8; iter++) {
    let changed = false;
    let b = currentHandBoardBBox(pad, elW, elH);
    if (b.nMinX < 0) {
      shiftAllHandPieces(-b.nMinX, 0);
      changed = true;
    }
    b = currentHandBoardBBox(pad, elW, elH);
    if (b.nMaxX > BOARD_W) {
      shiftAllHandPieces(BOARD_W - b.nMaxX, 0);
      changed = true;
    }
    b = currentHandBoardBBox(pad, elW, elH);
    if (b.nMinY < 0) {
      shiftAllHandPieces(0, -b.nMinY);
      changed = true;
    }
    b = currentHandBoardBBox(pad, elW, elH);
    if (b.nMaxY > BOARD_H) {
      shiftAllHandPieces(0, BOARD_H - b.nMaxY);
      changed = true;
    }
    if (!changed) break;
  }
}

/** Nudge so the outer bbox centroid sits on the drop point (re-applies clamp — fixes drift from edge fitting). */
function snapHandFormationCentroidTo(targetX, targetY, pad, elW, elH) {
  for (let pass = 0; pass < 5; pass++) {
    const b = currentHandBoardBBox(pad, elW, elH);
    const cx = (b.nMinX + b.nMaxX) / 2;
    const cy = (b.nMinY + b.nMaxY) / 2;
    const rdx = targetX - cx;
    const rdy = targetY - cy;
    if (Math.abs(rdx) < 0.4 && Math.abs(rdy) < 0.4) break;
    shiftAllHandPieces(rdx, rdy);
    clampHandFormationToBoard(pad, elW, elH);
  }
}

function dropHandAt(clientX, clientY) {
  if (hand.length === 0) return;
  clearAllHandSlotTimers();
  const { x: centerX, y: centerY } = clientToBoardPoint(clientX, clientY);

  const pad = meta?._pad ?? 0;
  const elW = (meta?._displayW ?? 0) + pad * 2;
  const elH = (meta?._displayH ?? 0) + pad * 2;
  const handIndices = [...hand];

  const finalizeRigidDrop = () => {
    handIndices.forEach(idx => pocketHomeByIndex.delete(idx));
    const positions = handIndices.map(idx => ({
      index: idx,
      x: pieceStates[idx].x,
      y: pieceStates[idx].y,
    }));
    handIndices.forEach(idx => {
      pieceEls[idx]?.classList.remove('in-hand', 'pocket-pulse');
    });
    updateGroupPosition(puzzleId, positions);
    unlockGroup(puzzleId, handIndices);
    handIndices.forEach(i => { pieceStates[i].lockedBy = null; });
    handIndices.forEach(i => updatePieceZIndex(i));
    hand = [];
    renderHand();
    syncBoardScrollContentSize();
  };

  const pocketLayout = getHandPocketLayoutMeta();
  const bboxAfterDelta = (dx, dy) => {
    let nMinX = Infinity;
    let nMinY = Infinity;
    let nMaxX = -Infinity;
    let nMaxY = -Infinity;
    for (const idx of handIndices) {
      const p = pieceStates[idx];
      const x = p.x + dx;
      const y = p.y + dy;
      const left = x - pad;
      const top = y - pad;
      nMinX = Math.min(nMinX, left);
      nMinY = Math.min(nMinY, top);
      nMaxX = Math.max(nMaxX, left + elW);
      nMaxY = Math.max(nMaxY, top + elH);
    }
    return { nMinX, nMinY, nMaxX, nMaxY };
  };

  let dx = 0;
  let dy = 0;
  if (pocketLayout && elW > 0 && elH > 0) {
    const cx = pocketLayout.minX + pocketLayout.bw / 2;
    const cy = pocketLayout.minY + pocketLayout.bh / 2;
    dx = centerX - cx;
    dy = centerY - cy;
    for (let iter = 0; iter < 8; iter++) {
      let b = bboxAfterDelta(dx, dy);
      let changed = false;
      if (b.nMinX < 0) {
        dx += -b.nMinX;
        changed = true;
      }
      b = bboxAfterDelta(dx, dy);
      if (b.nMaxX > BOARD_W) {
        dx -= b.nMaxX - BOARD_W;
        changed = true;
      }
      b = bboxAfterDelta(dx, dy);
      if (b.nMinY < 0) {
        dy += -b.nMinY;
        changed = true;
      }
      b = bboxAfterDelta(dx, dy);
      if (b.nMaxY > BOARD_H) {
        dy -= b.nMaxY - BOARD_H;
        changed = true;
      }
      if (!changed) break;
    }
    for (const idx of handIndices) {
      const p = pieceStates[idx];
      p.x += dx;
      p.y += dy;
      movePieceEl(idx, p.x, p.y);
    }
    snapHandFormationCentroidTo(centerX, centerY, pad, elW, elH);
    finalizeRigidDrop();
    return;
  }

  const dW = meta._displayW;
  const dH = meta._displayH;
  const gridCols = meta.cols;
  const shuffled = shuffleNonAdjacent([...handIndices], gridCols);
  const layoutCols = Math.ceil(Math.sqrt(shuffled.length));
  const layoutRows = Math.ceil(shuffled.length / layoutCols);
  const spreadW = dW * 1.06;
  const spreadH = dH * 1.06;
  const positions = [];
  shuffled.forEach((idx, i) => {
    const c = i % layoutCols;
    const rw = Math.floor(i / layoutCols);
    const jitterX = (Math.random() - 0.5) * dW * 0.18;
    const jitterY = (Math.random() - 0.5) * dH * 0.18;
    const x = centerX - (layoutCols * spreadW / 2) + c * spreadW + jitterX;
    const y = centerY - (layoutRows * spreadH / 2) + rw * spreadH + jitterY;
    pieceStates[idx].x = x;
    pieceStates[idx].y = y;
    movePieceEl(idx, x, y);
    pieceEls[idx]?.classList.remove('in-hand', 'pocket-pulse');
  });
  if (elW > 0 && elH > 0) snapHandFormationCentroidTo(centerX, centerY, pad, elW, elH);
  shuffled.forEach(idx => pocketHomeByIndex.delete(idx));
  for (const idx of shuffled) {
    positions.push({ index: idx, x: pieceStates[idx].x, y: pieceStates[idx].y });
  }
  updateGroupPosition(puzzleId, positions);
  unlockGroup(puzzleId, shuffled);
  shuffled.forEach(i => { pieceStates[i].lockedBy = null; });
  shuffled.forEach(i => updatePieceZIndex(i));
  hand = [];
  renderHand();
  syncBoardScrollContentSize();
}

function shuffleNonAdjacent(indices, gridCols) {
  if (indices.length <= 1) return indices;

  const isAdj = (a, b) => {
    const colA = a % gridCols, rowA = Math.floor(a / gridCols);
    const colB = b % gridCols, rowB = Math.floor(b / gridCols);
    return Math.abs(colA - colB) + Math.abs(rowA - rowB) === 1;
  };

  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < indices.length - 1; i++) {
      if (isAdj(indices[i], indices[i + 1])) {
        const swap = indices.findIndex((_, k) =>
          k > i + 1 && !isAdj(indices[i], indices[k]) &&
          (i === 0 || !isAdj(indices[i - 1], indices[k]))
        );
        if (swap !== -1) {
          [indices[i + 1], indices[swap]] = [indices[swap], indices[i + 1]];
        }
      }
    }
  }
  return indices;
}

function clearHand() {
  releaseAllFromPocket();
}

function renderHand() {
  if (!handContainer) handContainer = createHandContainer();
  stopHandSlotTimerTick();
  handContainer.innerHTML = '';
  if (hand.length === 0) { handContainer.style.display = 'none'; return; }
  handContainer.style.display = 'flex';

  const wrap = document.createElement('div');
  wrap.className = 'hand-block-wrap';
  wrap.title = 'Tap to put pieces back on the board';

  const slots = getHandPocketSlots();
  const multi = slots.length > 1;
  const slotMaxW = multi ? HAND_BLOCK_SLOT_MAX_W : HAND_BLOCK_MAX_W;
  const slotMaxH = multi ? HAND_BLOCK_SLOT_MAX_H : HAND_BLOCK_MAX_H;

  const row = document.createElement('div');
  row.className = 'hand-pocket-slots-row';
  const slotList = multi ? slots : [slots[0] ?? hand];
  for (const slot of slotList) {
    const key = getHandSlotKey(slot);
    const col = document.createElement('div');
    col.className = 'hand-pocket-slot';
    col.dataset.handSlotKey = key;
    col.appendChild(buildHandSlotPreviewElement(slot, multi ? slotMaxW : HAND_BLOCK_MAX_W, multi ? slotMaxH : HAND_BLOCK_MAX_H));

    const timerTrack = document.createElement('div');
    timerTrack.className = 'hand-block-timer-track';
    const timer = document.createElement('div');
    timer.className = 'hand-block-timer';
    const end = handSlotExpiresAt.get(key);
    const rem = end != null ? Math.max(0, end - Date.now()) : HAND_RELEASE_MS;
    const pct = Math.min(100, (rem / HAND_RELEASE_MS) * 100);
    timer.style.width = pct + '%';
    timer.style.transition = 'none';
    timerTrack.appendChild(timer);
    col.appendChild(timerTrack);

    row.appendChild(col);
  }

  wrap.appendChild(row);

  wrap.addEventListener('click', () => releaseAllFromPocket());
  handContainer.appendChild(wrap);

  tickHandSlotTimerBars();
  ensureHandSlotTimerTick();
}

function checkEmptyDoubleTap(cx, cy) {
  const now = Date.now();
  if (now - lastAddToHandAt < 600) return false;
  const dist = Math.hypot(cx - lastEmptyTap.x, cy - lastEmptyTap.y);
  if (now - lastEmptyTap.time < 400 && dist < 40) {
    dropHandAt(cx, cy);
    lastEmptyTap = { time: 0, x: 0, y: 0 };
    return true;
  }
  lastEmptyTap = { time: now, x: cx, y: cy };
  return false;
}

function tryForceRelease(index) {
  const now = Date.now();
  const st = forceReleaseState[index] || { count: 0, lastTime: 0 };
  if (now - st.lastTime > 3000) st.count = 0;
  st.count++;
  st.lastTime = now;
  forceReleaseState[index] = st;
  if (st.count >= 5) {
    unlockGroup(puzzleId, [index]);
    forceReleaseState[index] = { count: 0, lastTime: 0 };
    showForceReleaseToast();
  }
}

function showForceReleaseToast() {
  const t = document.createElement('div');
  t.className = 'powerup-toast';
  t.style.background = 'var(--accent2)';
  t.textContent = 'Piece released!';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

function showPocketGroupTooBigToast() {
  const t = document.createElement('div');
  t.className = 'powerup-toast';
  t.style.background = 'var(--surface2)';
  t.textContent = `Pocket fits up to ${POCKET_MAX_GROUP_PIECES} connected pieces — split the group or drag it.`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function setupViewportControls() {
  if (boardViewportListenersAttached) return;
  boardViewportListenersAttached = true;

  window.addEventListener('resize', () => {
    syncBoardScrollContentSize();
    if (scale <= 1.05) fitBoardToViewport();
  });

  const vv = window.visualViewport;
  if (vv) {
    let vvTimer = null;
    vv.addEventListener('resize', () => {
      if (vvTimer) clearTimeout(vvTimer);
      vvTimer = setTimeout(() => {
        syncBoardScrollContentSize();
        if (pieceEls?.length) centerPieceCloudInView();
      }, 120);
    });
  }

  window.addEventListener('orientationchange', () => {
    window.setTimeout(() => {
      syncBoardScrollContentSize();
      if (pieceEls?.length) framePieceCloudInView();
    }, 380);
  });
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

      if (dist <= threshold) {
        const targetX = pieceStates[nIdx].x + expectedDx;
        const targetY = pieceStates[nIdx].y + expectedDy;
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
  const keepId = existingIds[0] ?? generateUUID();

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
  if (!pieceStates[index]) return;

  const wasSolved  = pieceStates[index]?.solved;
  const wasGroupId = pieceStates[index]?.groupId;

  // Firebase deletes fields set to null, so they won't appear in the snapshot.
  // Always normalise lockedBy: if absent from data, treat as null (unlocked).
  // Also ignore our own lock echoes that arrive after we've already released.
  const lockedBy = Object.prototype.hasOwnProperty.call(data, 'lockedBy')
    ? data.lockedBy
    : null;  // field was deleted (null-write) → piece is unlocked
  let patch = { ...data };
  if (hand.includes(index) && pieceStates[index]?.lockedBy === playerId) {
    delete patch.x;
    delete patch.y;
    delete patch.rotation;
  }
  const incoming = { ...patch, lockedBy };
  if (
    incoming.lockedBy === playerId
    && !dragging?.indices.includes(index)
    && !hand.includes(index)
  ) {
    // Stale echo of our own lock write — already released locally, discard.
    delete incoming.lockedBy;
  }
  pieceStates[index] = { ...pieceStates[index], ...incoming };
  if (Object.prototype.hasOwnProperty.call(pieceStates[index], 'rotation')) {
    pieceStates[index].rotation = normalizeRotationDeg(pieceStates[index].rotation);
  }

  // If a piece in our hand got force-released remotely, remove from hand
  if (hand.includes(index) && pieceStates[index].lockedBy !== playerId) {
    removeFromHandSilent(index);
  }

  const pAfter = pieceStates[index];
  if (Number.isFinite(pAfter.x) && Number.isFinite(pAfter.y)) {
    movePieceEl(index, pAfter.x, pAfter.y);
  } else if (Object.prototype.hasOwnProperty.call(patch, 'rotation')) {
    if (Number.isFinite(pAfter.x) && Number.isFinite(pAfter.y)) movePieceEl(index, pAfter.x, pAfter.y);
  }

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
    setPieceAvatar(index, null);
    solvedCount++;
    updateProgress();
    syncRoomsSolvedCount();
    checkCompletion();
    return;
  }

  const currentLock = pieceStates[index].lockedBy;
  if (currentLock && currentLock !== playerId) {
    pieceEls[index]?.classList.add('locked-by-other');
    setPieceAvatar(index, currentLock);
    // Track last known position for emoji animations
    lastPlayerPos[currentLock] = { x: pieceStates[index].x, y: pieceStates[index].y };
  } else {
    pieceEls[index]?.classList.remove('locked-by-other');
    setPieceAvatar(index, null);
  }

  scheduleSyncBoardScrollContentSize();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function updateProgress() {
  // Count pieces that are in a group (merged) as "placed"
  const placed = pieceStates.filter((p, i) => pieceGroup[i] || p.solved).length;
  progressEl.textContent = `${placed} / ${totalPieces} pieces`;
}

function syncRoomsSolvedCount() {
  if (!meta?.isPublic) return;
  const now = Date.now();
  if (now - lastRoomsSolvedSync < 2000) return;
  lastRoomsSolvedSync = now;
  updateRoomsIndex(puzzleId, { solvedCount });
}

function checkCompletion() {
  const done = solvedCount >= totalPieces ||
    (() => { const gids = new Set(pieceGroup.filter(Boolean)); return gids.size === 1 && groups[[...gids][0]]?.size === totalPieces; })();
  if (!done) return;

  if (meta?.isPublic) updateRoomsIndex(puzzleId, { status: 'done', solvedCount });

  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  stopTimer();
  if (startedAt) {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    celebrationTime.textContent = `Solved in ${formatTime(secs)}`;

    // Record POTD leaderboard entry — only the player who triggers completion writes it
    if (meta.isPOTD && meta.potdDifficulty) {
      const names = Object.values(playersMap).map(p => p.name);
      if (names.length === 0) names.push(playerName);
      recordPOTDScore(puzzleId, meta.potdDifficulty, names, secs);
      // Show live leaderboard in celebration banner
      const today = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Athens' });
      celebrationLb.style.display = '';
      onPOTDLeaderboard(meta.potdDifficulty, today, entries => {
        const sorted = Object.values(entries).sort((a, b) => a.secs - b.secs).slice(0, 5);
        celebrationLbList.innerHTML = sorted.length === 0
          ? '<li class="lb-empty">No completions yet</li>'
          : sorted.map((e, i) => `<li>
              <span class="lb-rank">${i + 1}.</span>
              <span class="lb-names">${formatNames(e.names)}</span>
              <span class="lb-time">${formatTime(e.secs)}</span>
            </li>`).join('');
      });
    }
  }
  celebration.classList.add('show');
}

function setupHelp() {
  const controls = [
    { key: 'Drag',            desc: 'Move a piece or a connected group' },
    { key: 'Drop near edge',  desc: 'Pieces snap together automatically' },
    { key: 'Scroll / drag bg',desc: 'Pan the board' },
    { key: 'Click piece',     desc: `Pick up into pocket — singles or merged groups up to ${POCKET_MAX_GROUP_PIECES} pieces` },
    { key: 'Tap pocket',      desc: 'Put everything in the pocket back on the board' },
    { key: 'Dbl-click board', desc: 'Drop pocket pieces at that spot' },
  ];
  if (!isMobileLike) {
    controls.push({
      key: 'Two-finger scroll',
      desc: 'Pan the board; Ctrl/⌘ + scroll (or trackpad pinch in Chrome) zooms at cursor',
    });
  }
  if (isMobileLike) {
    controls.push({ key: 'Pinch (mobile)', desc: 'Zoom in / out' });
    controls.push({
      key: 'HQ',
      desc: 'Sharper pieces when zoomed — default follows device RAM/CPU/DPR (reloads; more memory)',
    });
  }
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

function setupQualityMode() {
  if (!qualityBtn) return;
  if (!isMobileLike) {
    qualityBtn.style.display = 'none';
    return;
  }
  const applyState = () => {
    qualityBtn.classList.toggle('active', highQualityMode);
    qualityBtn.title = highQualityMode
      ? 'High quality ON (tap for standard textures)'
      : 'High quality OFF (tap for sharper zoomed pieces)';
  };
  applyState();

  qualityBtn.addEventListener('click', () => {
    highQualityMode = !highQualityMode;
    safeLocalSet('jt-high-quality', highQualityMode ? '1' : '0');
    applyState();
    // Piece textures are generated at load time, so refresh to rebuild.
    location.reload();
  });
}

function setupHorizontalPageLock() {
  // iOS Safari can still rubber-band horizontally even with overflow hidden.
  // We only block horizontal swipes that start outside the puzzle board area.
  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { pageTouchStart = null; return; }
    const t = e.touches[0];
    pageTouchStart = {
      x: t.clientX,
      y: t.clientY,
      inBoardWrap: !!e.target.closest('.puzzle-board-wrap'),
      onPiece: !!e.target.closest('.piece'),
    };
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!pageTouchStart || e.touches.length !== 1) return;
    if (pageTouchStart.onPiece) return;
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - pageTouchStart.x);
    const dy = Math.abs(t.clientY - pageTouchStart.y);
    if (dx <= dy || dx <= 5) return;

    // Only allow horizontal pan if gesture started in the board area AND the wrap
    // actually has horizontal scroll slack (layout width, zoom, padding).
    const canPanBoardX = boardWrap && (boardWrap.scrollWidth - boardWrap.clientWidth) > 2;
    const allowHorizontal = pageTouchStart.inBoardWrap && canPanBoardX;
    if (!allowHorizontal) e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', () => { pageTouchStart = null; }, { passive: true });
  document.addEventListener('touchcancel', () => { pageTouchStart = null; }, { passive: true });
}

function setupPeek() {
  boxCoverImg.src = meta.imageUrl ?? ('data:image/jpeg;base64,' + meta.imageData);

  const toggle = () => boxCover.classList.toggle('show');
  const hide   = () => boxCover.classList.remove('show');

  peekBtn.addEventListener('click', toggle);
  boxCover.addEventListener('click', hide);
}

function setupChat() {
  // Open / close panel
  const open  = () => { chatPanel.classList.add('open'); chatOpen = true; setChatBadge(0); };
  const close = () => { chatPanel.classList.remove('open'); chatOpen = false; };

  chatBtn.addEventListener('click', () => chatOpen ? close() : open());
  chatClose.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && chatOpen) close(); });

  // Send on Enter or send button
  const send = () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    const color = getPlayerColor(playerId);
    sendChatMessage(puzzleId, { playerId, name: playerName, color, text, ts: Date.now() });
  };
  chatSendBtn.addEventListener('click', send);
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

  // Emoji buttons — send as chat message
  chatPanel.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji;
      const color = getPlayerColor(playerId);
      sendChatMessage(puzzleId, { playerId, name: playerName, color, text: emoji, ts: Date.now() });
    });
  });

  // Listen for incoming messages
  onChatMessages(puzzleId, msg => {
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

  // Keep max 50 messages in DOM
  while (chatMessages.children.length > 50) chatMessages.removeChild(chatMessages.firstChild);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function spawnBoardEmoji(msg) {
  const rect = board.getBoundingClientRect();
  for (let i = 0; i < 6; i++) {
    const x = rect.left + 40 + Math.random() * (rect.width  - 80);
    const y = rect.top  + 40 + Math.random() * (rect.height - 80);
    const el = document.createElement('div');
    el.className = 'board-emoji';
    el.textContent = msg.text;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.style.animationDelay = (i * 80) + 'ms';
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}

function isSingleEmoji(text) {
  return /^\p{Emoji_Presentation}$/u.test(text.trim()) || /^\p{Emoji}\uFE0F?$/u.test(text.trim());
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
  const now = Date.now();
  playersMap = {};
  playersListEl.innerHTML = '';
  Object.entries(players).forEach(([id, p]) => {
    if (now - p.lastSeen > 30000) return;
    playersMap[id] = p;
    const dot = document.createElement('div');
    dot.className = 'player-dot';
    dot.style.background = p.color;
    dot.title = p.name;
    dot.textContent = getAvatarText(p.name);
    if (id === playerId) dot.classList.add('me');
    playersListEl.appendChild(dot);
  });

  if (meta?.isPublic) {
    const count = Object.keys(playersMap).length;
    // Set creatorName on first player join if not set yet
    const updates = { playerCount: count };
    if (count === 1 && players[playerId]) updates.creatorName = playerName;
    updateRoomsIndex(puzzleId, updates);
  }
}

// avatarEls[index] = the avatar div for pieces locked by other players
const avatarEls = [];

function setPieceAvatar(index, lockOwner) {
  // Get all indices in this piece's group
  const gid     = pieceGroup[index];
  const indices = gid ? [...groups[gid]] : [index];

  // Remove avatars from all pieces in the group
  indices.forEach(i => { avatarEls[i]?.remove(); avatarEls[i] = null; });

  if (!lockOwner || lockOwner === playerId) return;
  const player = playersMap[lockOwner];
  if (!player) return;

  // Show avatar only on the top-right piece of the group (min row, max col)
  const cols = meta?.cols ?? 1;
  const anchor = indices.reduce((best, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const bestRow = Math.floor(best / cols);
    const bestCol = best % cols;
    if (row < bestRow || (row === bestRow && col > bestCol)) return i;
    return best;
  });

  const avatar = document.createElement('div');
  avatar.className = 'piece-avatar';
  avatar.style.background = player.color;
  avatar.textContent = getAvatarText(player.name);
  avatar.title = player.name;
  board.appendChild(avatar);
  avatarEls[anchor] = avatar;
  updateAvatarPosition(anchor);
}

function updateAvatarPosition(index) {
  const avatar = avatarEls[index];
  const el     = pieceEls[index];
  if (!avatar || !el) return;
  const p   = pieceStates[index];
  if (!p) return;
  const x = p.x + meta._displayW - 12;
  const y = p.y - 12;
  avatar.style.left = x + 'px';
  avatar.style.top  = y + 'px';
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

function formatNames(names) {
  if (!names || names.length === 0) return 'Unknown';
  if (names.length === 1) return names[0];
  if (names.length <= 3) return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
  return `${names[0]}, ${names[1]} +${names.length - 2} more`;
}

function getAvatarText(name) {
  const text = String(name || '').trim();
  if (!text) return '?';
  const first = getFirstGrapheme(text);
  return isEmojiGrapheme(first) ? first : first.toUpperCase();
}

function getFirstGrapheme(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    for (const part of seg.segment(text)) return part.segment;
  }
  return Array.from(text)[0] || '?';
}

function isEmojiGrapheme(ch) {
  return /\p{Extended_Pictographic}/u.test(ch);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Safari: crossOrigin on data:/blob: can break loads or canvas export; http(s) needs CORS for cutPiece().
    try {
      const abs = new URL(src, location.href);
      if (abs.protocol === 'http:' || abs.protocol === 'https:') {
        img.crossOrigin = 'anonymous';
      }
    } catch (_) {
      /* leave unset */
    }
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
}

function getOrCreatePlayerId() {
  try {
    let id = sessionStorage.getItem('playerId');
    if (!id) {
      id = generateUUID();
      sessionStorage.setItem('playerId', id);
    }
    return id;
  } catch (_) {
    if (!fallbackPlayerId) fallbackPlayerId = generateUUID();
    return fallbackPlayerId;
  }
}

window.addEventListener('beforeunload', () => {
  if (unsubscribe) unsubscribe();
  if (unsubPlayers) unsubPlayers();
  if (dragging?.locked) unlockGroup(puzzleId, dragging.indices);
  if (hand.length) unlockGroup(puzzleId, hand);
  removePlayer(puzzleId, playerId);
});
