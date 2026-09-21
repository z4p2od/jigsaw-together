import { getPOTD, getPuzzleImageUrl, onPOTDLeaderboard } from './firebase.js';
import { formatPuzzleDifficulty } from './puzzle-grid.js';

const statusEl    = document.getElementById('shell-status');
const shellPlayBtn = document.getElementById('shell-play-btn');
const welcomeScreen = document.getElementById('welcome-screen');
const welcomeNameInput = document.getElementById('welcome-name-input');
const welcomeStartBtn = document.getElementById('welcome-start-btn');
const welcomeStatus = document.getElementById('welcome-status');

/** @type {'potd' | 'play'} */
let shellMode = 'potd';
let shellPlayImagesLoaded = false;
let playSelectedCatalog = null;
let prefetchedPuzzleId = null;
let prefetchPromise = null;

// ── POTD ──────────────────────────────────────────────────────────────────────

const DAILY_KEY = 'daily';
const POTD_CACHE_KEY = 'jt-potd-today-v2';

const potdSection   = document.getElementById('potd-section');
const potdLb        = document.getElementById('potd-lb');
const potdDesc      = document.getElementById('potd-desc');
const potdPreview   = document.getElementById('potd-preview');
const potdPreviewImg = document.getElementById('potd-preview-img');

let todayPotd = null;
let potdReady = false;
const leaderboardCache = Object.create(null);
let potdLeaderboardsAttached = false;

function getPotdTodayDate() {
  return new Date().toLocaleDateString('sv', { timeZone: 'Europe/Athens' });
}

function readPotdCache(today) {
  try {
    const raw = sessionStorage.getItem(POTD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.date !== today || !parsed.puzzle) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePotdCache(payload) {
  try {
    sessionStorage.setItem(POTD_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

async function fetchPotdTodayPayload() {
  if (window.__potdTodayFetch) {
    const data = await window.__potdTodayFetch;
    window.__potdTodayFetch = null;
    if (data?.puzzle || data?.puzzles?.length) return data;
  }
  const res = await fetch('/api/potd-today');
  if (!res.ok) return null;
  return res.json();
}

function normalizePotdPayload(payload, today) {
  if (!payload || payload.date !== today) return null;
  if (payload.puzzle?.puzzleId) {
    return {
      date: today,
      puzzle: {
        puzzleId: payload.puzzle.puzzleId,
        imageUrl: payload.puzzle.imageUrl || null,
        pieces: payload.puzzle.pieces || null,
        cols: payload.puzzle.cols || null,
        rows: payload.puzzle.rows || null,
        hardMode: !!payload.puzzle.hardMode,
      },
    };
  }
  const first = (payload.puzzles || []).find((p) => p?.puzzleId);
  if (!first) return null;
  return {
    date: today,
    puzzle: {
      puzzleId: first.puzzleId,
      imageUrl: first.imageUrl || null,
      pieces: first.pieces || null,
      cols: first.cols || null,
      rows: first.rows || null,
      hardMode: !!first.hardMode,
    },
  };
}

function paintTodayPotd() {
  if (!potdDesc) return;
  if (!todayPotd) {
    potdReady = false;
    potdDesc.textContent = 'No puzzle of the day right now.';
    if (potdPreview) potdPreview.hidden = true;
    updateShellPlayButton();
    return;
  }
  potdReady = true;
  potdDesc.textContent = formatPuzzleDifficulty(todayPotd.pieces, todayPotd.hardMode, todayPotd.cols, todayPotd.rows);
  if (potdPreview && potdPreviewImg && todayPotd.imageUrl) {
    potdPreviewImg.src = todayPotd.imageUrl;
    potdPreviewImg.alt = 'Puzzle of the day';
    potdPreview.hidden = false;
  }
  paintPotdLeaderboard();
  updateShellPlayButton();
}

function renderLeaderboardList(el, entries) {
  const sorted = Object.values(entries || {})
    .sort((a, b) => a.secs - b.secs)
    .slice(0, 5);

  if (sorted.length === 0) {
    el.innerHTML = '<li class="lb-empty">No completions yet — be the first!</li>';
    return;
  }

  el.innerHTML = sorted.map((e, i) => {
    const names = formatNames(e.names || []);
    const time  = formatTime(e.secs);
    return `<li><span class="lb-rank">${i + 1}</span><span class="lb-names">${names}</span><span class="lb-time">${time}</span></li>`;
  }).join('');
}

function paintPotdLeaderboard() {
  if (!potdLb) return;
  renderLeaderboardList(potdLb, leaderboardCache[DAILY_KEY]);
}

function applyPotdPayload(payload) {
  if (!potdSection || !potdLb || !potdDesc || !payload) return false;
  const today = getPotdTodayDate();
  const normalized = normalizePotdPayload(payload, today);
  if (!normalized) {
    todayPotd = null;
    paintTodayPotd();
    return false;
  }
  todayPotd = normalized.puzzle;
  paintTodayPotd();

  if (!potdLeaderboardsAttached) {
    potdLeaderboardsAttached = true;
    onPOTDLeaderboard(DAILY_KEY, today, (entries) => {
      leaderboardCache[DAILY_KEY] = entries;
      paintPotdLeaderboard();
    });
  }
  return true;
}

async function loadPOTDFromFirebase(today) {
  try {
    const data = await getPOTD(DAILY_KEY) || await getPOTD('easy');
    if (!data || data.date !== today || !data.puzzleId) return null;
    let imageUrl = data.imageUrl || null;
    if (!imageUrl) {
      try {
        imageUrl = await getPuzzleImageUrl(data.puzzleId);
      } catch {
        imageUrl = null;
      }
    }
    return {
      date: today,
      puzzle: {
        puzzleId: data.puzzleId,
        imageUrl,
        pieces: data.pieces || null,
        cols: data.cols || null,
        rows: data.rows || null,
        hardMode: !!data.hardMode,
      },
    };
  } catch {
    return null;
  }
}

async function loadPOTD() {
  if (!potdSection || !potdLb || !potdDesc) return;

  const today = getPotdTodayDate();
  const cached = readPotdCache(today);
  if (cached) applyPotdPayload(cached);

  let payload = null;
  try {
    payload = await fetchPotdTodayPayload();
  } catch {
    payload = null;
  }

  if (!normalizePotdPayload(payload, today)) {
    payload = await loadPOTDFromFirebase(today);
  }

  if (!normalizePotdPayload(payload, today)) return;

  writePotdCache(payload);
  applyPotdPayload(payload);
  if (todayPotd?.imageUrl) {
    const img = new Image();
    img.decoding = 'async';
    img.src = todayPotd.imageUrl;
  }
}


function formatNames(names) {
  if (names.length === 0) return 'Anonymous';
  if (names.length === 1) return names[0];
  if (names.length <= 3)  return names.join(' & ');
  return `${names[0]}, ${names[1]} +${names.length - 2} more`;
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}


function readStoredName() {
  try {
    return (sessionStorage.getItem('playerName') || '').trim();
  } catch {
    return '';
  }
}

function showWelcome() {
  if (!welcomeScreen) return;
  welcomeScreen.hidden = false;
  welcomeNameInput?.focus();
}

function hideWelcome() {
  if (!welcomeScreen) return;
  welcomeScreen.hidden = true;
  document.documentElement.classList.add('jt-skip-welcome');
}

function dismissLoadingOverlay() {
  if (typeof window.__JT_hidePlayLoading === 'function') {
    window.__JT_hidePlayLoading();
    return;
  }
  const el = document.getElementById('loading-overlay');
  if (el) {
    el.hidden = true;
    el.style.display = 'none';
  }
}

async function fetchPotdPuzzleId() {
  const res = await fetch('/api/potd-play?json=1');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not start puzzle of the day');
  }
  const data = await res.json();
  if (!data?.puzzleId) throw new Error('Could not start puzzle of the day');
  return data.puzzleId;
}

async function waitForPuzzleBoot() {
  const deadline = Date.now() + 10000;
  while (typeof window.__JT_bootPuzzle !== 'function') {
    if (Date.now() > deadline) throw new Error('Puzzle failed to load');
    await new Promise((r) => setTimeout(r, 40));
  }
}

async function prefetchPotdToday() {
  await loadPOTD();
  await waitForPuzzleBoot();
  prefetchedPuzzleId = await fetchPotdPuzzleId();
  window.__JT_prefetchPuzzle?.(prefetchedPuzzleId);
  return prefetchedPuzzleId;
}

async function prefetchPuzzleById(id) {
  if (!id) throw new Error('Missing puzzle id');
  await waitForPuzzleBoot();
  prefetchedPuzzleId = id;
  window.__JT_prefetchPuzzle?.(id);
  return id;
}

async function bootPrefetchedPuzzle() {
  if (!prefetchedPuzzleId) {
    if (prefetchPromise) await prefetchPromise;
  }
  if (!prefetchedPuzzleId) throw new Error('No puzzle ready yet');
  await window.__JT_bootPuzzle(prefetchedPuzzleId);
}

async function submitWelcome() {
  const name = welcomeNameInput?.value.trim() || 'Anonymous';
  try {
    sessionStorage.setItem('playerName', name);
  } catch { /* private mode */ }
  window.__JT_setPlayerName?.(name);
  if (welcomeStartBtn) welcomeStartBtn.disabled = true;
  if (welcomeStatus) welcomeStatus.textContent = 'Loading puzzle…';
  hideWelcome();
  try {
    await bootPrefetchedPuzzle();
    if (welcomeStatus) welcomeStatus.textContent = '';
  } catch (err) {
    console.error(err);
    setShellStatus(err.message || 'Could not load puzzle.', true);
    showWelcome();
    if (welcomeStartBtn) welcomeStartBtn.disabled = false;
    if (welcomeStatus) welcomeStatus.textContent = err.message || 'Could not load puzzle.';
  }
}

async function initWelcomeFlow() {
  const existingId = new URLSearchParams(location.search).get('id');
  const storedName = readStoredName();

  prefetchPromise = existingId
    ? prefetchPuzzleById(existingId)
    : prefetchPotdToday();

  prefetchPromise.catch((err) => {
    console.error(err);
    if (welcomeStatus && !welcomeScreen?.hidden) {
      welcomeStatus.textContent = err.message || 'Puzzle of the day unavailable';
    }
  });

  if (storedName) {
    window.__JT_setPlayerName?.(storedName);
    hideWelcome();
    try {
      await bootPrefetchedPuzzle();
    } catch (err) {
      console.error(err);
      setShellStatus(err.message || 'Could not load puzzle.', true);
      dismissLoadingOverlay();
    }
    return;
  }

  showWelcome();
  if (storedName && welcomeNameInput) welcomeNameInput.value = storedName;

  welcomeStartBtn?.addEventListener('click', () => submitWelcome());
  welcomeNameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitWelcome();
  });
}

initWelcomeFlow();

async function startSelectedPotd() {
  setShellStatus('Starting puzzle…');
  shellPlayBtn.disabled = true;
  try {
    const id = await fetchPotdPuzzleId();
    prefetchedPuzzleId = id;
    window.__JT_prefetchPuzzle?.(id);
    if (typeof window.__JT_bootPuzzle === 'function') {
      await window.__JT_bootPuzzle(id);
    } else {
      location.href = `/?id=${encodeURIComponent(id)}`;
    }
    setShellStatus('');
  } catch (err) {
    console.error(err);
    setShellStatus(err.message || 'Could not start puzzle.', true);
  } finally {
    shellPlayBtn.disabled = false;
  }
}

// ── Shell sidebar ─────────────────────────────────────────────────────────────

function setShellStatus(msg, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = 'status' + (isError ? ' error' : '');
}

function updateShellPlayButton() {
  if (!shellPlayBtn) return;
  if (shellMode === 'play') {
    shellPlayBtn.textContent = 'Play Puzzle';
    shellPlayBtn.disabled = !playSelectedCatalog;
    return;
  }
  shellPlayBtn.textContent = 'Play Puzzle';
  shellPlayBtn.disabled = shellMode === 'potd' && !potdReady;
}

function openDrawer(name) {
  document.querySelectorAll('.sidebar-drawer-head').forEach((head) => {
    const key = head.dataset.drawer;
    const panel = document.getElementById(`drawer-${key}`);
    const open = key === name;
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    head.classList.toggle('is-open', open);
    panel?.classList.toggle('is-open', open);
  });
  shellMode = name;
  updateShellPlayButton();
  if (name === 'play' && !shellPlayImagesLoaded) loadShellPlayImages();
}

document.querySelectorAll('.sidebar-drawer-head').forEach((head) => {
  head.addEventListener('click', () => {
    const key = head.dataset.drawer;
    const panel = document.getElementById(`drawer-${key}`);
    const isOpen = panel?.classList.contains('is-open');
    if (isOpen) {
      panel.classList.remove('is-open');
      head.classList.remove('is-open');
      head.setAttribute('aria-expanded', 'false');
      shellMode = 'potd';
      updateShellPlayButton();
      return;
    }
    openDrawer(key);
  });
});

async function loadShellPlayImages() {
  const grid = document.getElementById('play-image-grid');
  const loading = document.getElementById('play-images-loading');
  if (!grid || !loading) return;
  try {
    const res = await fetch('/api/catalog');
    const data = await res.json();
    const puzzles = data.puzzles || [];
    if (!puzzles.length) {
      loading.textContent = 'No puzzles in the catalog yet.';
      return;
    }
    loading.style.display = 'none';
    grid.style.display = '';
    grid.innerHTML = '';
    puzzles.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'play-image-card';
      const el = document.createElement('img');
      el.src = p.imageUrl;
      el.alt = formatPuzzleDifficulty(p.pieces, p.hardMode, p.cols, p.rows);
      el.loading = 'lazy';
      card.appendChild(el);
      const badge = document.createElement('span');
      badge.className = 'catalog-badge';
      badge.textContent = formatPuzzleDifficulty(p.pieces, p.hardMode, p.cols, p.rows);
      card.appendChild(badge);
      card.addEventListener('click', () => {
        document.querySelectorAll('#play-image-grid .play-image-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        playSelectedCatalog = p;
        shellMode = 'play';
        updateShellPlayButton();
      });
      grid.appendChild(card);
    });
    shellPlayImagesLoaded = true;
  } catch {
    loading.textContent = 'Failed to load puzzles.';
  }
}

async function startPlayTogether() {
  if (!playSelectedCatalog) {
    setShellStatus('Pick a puzzle first.', true);
    return;
  }
  shellPlayBtn.disabled = true;
  setShellStatus('Creating puzzle…');
  const isPublic = document.querySelector('input[name="play-visibility"]:checked').value === 'public';
  const params = new URLSearchParams({
    catalog: playSelectedCatalog.id,
    public: isPublic,
  });
  try {
    const res = await fetch(`/api/room-create?${params}`);
    const data = await res.json();
    if (!res.ok || !data.puzzleId) throw new Error(data.error || 'Failed to create puzzle');
    if (typeof window.__JT_bootPuzzle === 'function') {
      await window.__JT_bootPuzzle(data.puzzleId);
    } else {
      location.href = `/?id=${encodeURIComponent(data.puzzleId)}`;
    }
    setShellStatus('');
  } catch (err) {
    setShellStatus(err.message || 'Failed to create puzzle.', true);
  } finally {
    shellPlayBtn.disabled = false;
    updateShellPlayButton();
  }
}

shellPlayBtn?.addEventListener('click', async () => {
  if (shellMode === 'potd') return startSelectedPotd();
  if (shellMode === 'play') return startPlayTogether();
});

document.getElementById('celebration-new-btn')?.addEventListener('click', () => {
  document.getElementById('celebration').style.display = 'none';
  shellMode = 'potd';
  updateShellPlayButton();
});

updateShellPlayButton();
