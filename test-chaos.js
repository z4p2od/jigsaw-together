// ── Pieces setup ──────────────────────────────────────────────────────────────

const COLORS = ['#e94560','#f5a623','#4ecdc4','#a78bfa','#34d399','#60a5fa',
                 '#f472b6','#fb923c','#86efac','#fde68a','#c4b5fd','#67e8f9'];
const EMOJIS = ['🌟','🎯','🚀','💎','🌈','🔥','⚡','🎪','🦋','🌺','🎭','🎨'];
const BOARD_W = 500, BOARD_H = 380, PIECE_W = 80, PIECE_H = 80;

const myBoard   = document.getElementById('my-board');
const oppBoard  = document.getElementById('opp-board');
const myWrap    = document.getElementById('my-wrap');
const oppWrap   = document.getElementById('opp-wrap');
const fakeCursor = document.getElementById('fake-cursor');

// Make board divs fill their wrap
myBoard.style.cssText  = 'position:absolute;inset:0';
oppBoard.style.cssText = 'position:absolute;inset:0';

const myPieces  = [];  // {el, ox, oy} original positions
const oppPieces = [];

function randomPos() {
  return {
    x: 10 + Math.random() * (BOARD_W - PIECE_W - 20),
    y: 10 + Math.random() * (BOARD_H - PIECE_H - 20),
  };
}

function createPiece(board, index, x, y) {
  const el = document.createElement('div');
  el.className = 'piece';
  el.dataset.index = index;
  el.style.background = COLORS[index % COLORS.length];
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  el.textContent = EMOJIS[index % EMOJIS.length];
  board.appendChild(el);
  return el;
}

function initBoards() {
  myBoard.innerHTML  = '';
  oppBoard.innerHTML = '';
  myPieces.length    = 0;
  oppPieces.length   = 0;
  for (let i = 0; i < 12; i++) {
    const mp = randomPos();
    const op = randomPos();
    myPieces.push({ el: createPiece(myBoard, i, mp.x, mp.y), ox: mp.x, oy: mp.y });
    oppPieces.push({ el: createPiece(oppBoard, i, op.x, op.y), ox: op.x, oy: op.y });
  }
}

initBoards();

// ── Drag ──────────────────────────────────────────────────────────────────────

let dragging = null;
let invertActive = false;

function mirrorCoords(clientX, clientY) {
  if (!invertActive) return { clientX, clientY };
  const rect = myWrap.getBoundingClientRect();
  return {
    clientX: 2 * (rect.left + rect.width  / 2) - clientX,
    clientY: 2 * (rect.top  + rect.height / 2) - clientY,
  };
}

function syncCursor() {
  if (invertActive) {
    myWrap.style.cursor = 'none';
    fakeCursor.style.display = 'block';
  } else {
    myWrap.style.cursor = '';
    fakeCursor.style.display = 'none';
  }
}

myBoard.addEventListener('mousedown', e => {
  const el = e.target.closest('.piece');
  if (!el) return;
  // Face-down flip
  if (el.classList.contains('face-down')) { el.classList.remove('face-down'); return; }
  const { clientX, clientY } = mirrorCoords(e.clientX, e.clientY);
  const rect = myWrap.getBoundingClientRect();
  const offX = clientX - rect.left - parseInt(el.style.left);
  const offY = clientY - rect.top  - parseInt(el.style.top);
  dragging = { el, offX, offY, board: myWrap };
  el.style.zIndex = 1000;
  e.preventDefault();
});

oppBoard.addEventListener('mousedown', e => {
  const el = e.target.closest('.piece');
  if (!el) return;
  if (el.classList.contains('face-down')) { el.classList.remove('face-down'); return; }
  const rect = oppWrap.getBoundingClientRect();
  const offX = e.clientX - rect.left - parseInt(el.style.left);
  const offY = e.clientY - rect.top  - parseInt(el.style.top);
  dragging = { el, offX, offY, board: oppWrap };
  el.style.zIndex = 1000;
  e.preventDefault();
});

window.addEventListener('mousemove', e => {
  // Update fake cursor position
  if (invertActive) {
    const { clientX: mx, clientY: my } = mirrorCoords(e.clientX, e.clientY);
    fakeCursor.style.left = (mx - 2) + 'px';
    fakeCursor.style.top  = (my - 2) + 'px';
  }
  if (!dragging) return;
  let clientX = e.clientX, clientY = e.clientY;
  if (dragging.board === myWrap && invertActive) {
    ({ clientX, clientY } = mirrorCoords(e.clientX, e.clientY));
  }
  const rect = dragging.board.getBoundingClientRect();
  const x = Math.max(0, Math.min(BOARD_W - PIECE_W, clientX - rect.left - dragging.offX));
  const y = Math.max(0, Math.min(BOARD_H - PIECE_H, clientY - rect.top  - dragging.offY));
  dragging.el.style.left = x + 'px';
  dragging.el.style.top  = y + 'px';
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging.el.style.zIndex = '';
  dragging = null;
});

myWrap.addEventListener('mouseleave', () => {
  if (!invertActive) fakeCursor.style.display = 'none';
});
myWrap.addEventListener('mouseenter', () => {
  if (invertActive) fakeCursor.style.display = 'block';
});

// ── Effects ───────────────────────────────────────────────────────────────────

const activeEffects = {};

function fireGrayscale() {
  const expiresAt = Math.max(Date.now() + 30000, activeEffects.bwExpiresAt ?? 0);
  activeEffects.bwExpiresAt = expiresAt;
  oppBoard.parentElement.classList.add('board-grayscale');
  clearTimeout(activeEffects.bwTimer);
  activeEffects.bwTimer = setTimeout(() => {
    oppBoard.parentElement.classList.remove('board-grayscale');
    activeEffects.bwExpiresAt = 0;
    updateEffectsUI();
  }, expiresAt - Date.now());
  showToast('👁 Grayscale applied to opponent!');
  updateEffectsUI();
}

function fireInvert() {
  const expiresAt = Math.max(Date.now() + 30000, activeEffects.invertExpiresAt ?? 0);
  activeEffects.invertExpiresAt = expiresAt;
  invertActive = true;
  syncCursor();
  clearTimeout(activeEffects.invertTimer);
  activeEffects.invertTimer = setTimeout(() => {
    invertActive = false;
    activeEffects.invertExpiresAt = 0;
    syncCursor();
    updateEffectsUI();
  }, expiresAt - Date.now());
  showToast('🔄 Inverted controls active on your board!');
  updateEffectsUI();
}

function fireScramble() {
  oppPieces.forEach(({ el }) => {
    if (el.classList.contains('face-down')) return;
    const p = randomPos();
    el.style.left = p.x + 'px';
    el.style.top  = p.y + 'px';
    el.classList.add('face-down');
  });
  showToast('💥 Opponent pieces scrambled!');
}

function resetAll() {
  // Clear effects
  clearTimeout(activeEffects.bwTimer);
  clearTimeout(activeEffects.invertTimer);
  activeEffects.bwExpiresAt = 0;
  activeEffects.invertExpiresAt = 0;
  invertActive = false;
  syncCursor();
  oppBoard.parentElement.classList.remove('board-grayscale');
  // Reset pieces
  myPieces.forEach(({ el, ox, oy }) => {
    el.style.left = ox + 'px';
    el.style.top  = oy + 'px';
    el.classList.remove('face-down');
  });
  oppPieces.forEach(({ el, ox, oy }) => {
    el.style.left = ox + 'px';
    el.style.top  = oy + 'px';
    el.classList.remove('face-down');
  });
  updateEffectsUI();
  showToast('↺ Reset!');
}

// ── Effects UI ─────────────────────────────────────────────────────────────────

const effectsList = document.getElementById('effects-list');
const noEffects   = document.getElementById('no-effects');

const EFFECT_DEFS = [
  { key: 'bw',     label: 'Grayscale',         color: '#6b7280', barColor: '#9ca3af' },
  { key: 'invert', label: 'Inverted Controls',  color: '#7c3aed', barColor: '#a78bfa' },
];

function updateEffectsUI() {
  const now = Date.now();
  const active = EFFECT_DEFS.filter(d => (activeEffects[d.key + 'ExpiresAt'] ?? 0) > now);
  noEffects.style.display = active.length ? 'none' : '';
  EFFECT_DEFS.forEach(d => {
    const existing = document.getElementById('effect-row-' + d.key);
    if (existing) existing.remove();
  });
  active.forEach(d => {
    const expiresAt = activeEffects[d.key + 'ExpiresAt'];
    const totalMs   = 30000;
    const row = document.createElement('div');
    row.className = 'effect-item';
    row.id = 'effect-row-' + d.key;
    row.innerHTML = `
      <div class="effect-dot" style="background:${d.color}"></div>
      <span style="min-width:140px">${d.label}</span>
      <div class="effect-bar-wrap">
        <div class="effect-bar" id="bar-${d.key}" style="background:${d.barColor};width:100%"></div>
      </div>
      <span class="effect-time" id="time-${d.key}"></span>
    `;
    effectsList.appendChild(row);
  });
}

// Live countdown ticker
setInterval(() => {
  const now = Date.now();
  EFFECT_DEFS.forEach(d => {
    const expiresAt = activeEffects[d.key + 'ExpiresAt'] ?? 0;
    const timeEl = document.getElementById('time-' + d.key);
    const barEl  = document.getElementById('bar-'  + d.key);
    if (!timeEl || !barEl) return;
    const ms  = Math.max(0, expiresAt - now);
    const pct = Math.min(100, (ms / 30000) * 100);
    timeEl.textContent = Math.ceil(ms / 1000) + 's';
    barEl.style.width  = pct + '%';
  });
}, 200);

// ── Toast ──────────────────────────────────────────────────────────────────────

const toastEl = document.getElementById('toast');
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 2000);
}
