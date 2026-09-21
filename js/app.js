import { getPOTD, getPuzzleImageUrl, onPOTDLeaderboard } from './firebase.js';

const statusEl    = document.getElementById('shell-status');
const shellPlayBtn = document.getElementById('shell-play-btn');
const welcomeScreen = document.getElementById('welcome-screen');
const welcomeNameInput = document.getElementById('welcome-name-input');
const welcomeStartBtn = document.getElementById('welcome-start-btn');
const welcomeStatus = document.getElementById('welcome-status');

/** @type {'potd' | 'play'} */
let shellMode = 'potd';
let shellPlayImagesLoaded = false;
let playSelectedImage = null;
let prefetchedPuzzleId = null;
let prefetchPromise = null;

// ── POTD ──────────────────────────────────────────────────────────────────────

const DIFFICULTIES = [
  { key: 'easy',   label: 'Easy',   emoji: '🟢', pieces: 25  },
  { key: 'medium', label: 'Medium', emoji: '🟡', pieces: 100 },
  { key: 'hard',   label: 'Hard',   emoji: '🔴', pieces: 100, hard: true },
];

const potdSection   = document.getElementById('potd-section');
const potdLb        = document.getElementById('potd-lb');
const potdDesc      = document.getElementById('potd-desc');
const potdPreview   = document.getElementById('potd-preview');
const potdPreviewImg = document.getElementById('potd-preview-img');

let selectedPotdKey = 'easy';
let availablePotdKeys = [];
const leaderboardCache = Object.create(null);
/** @type {Record<string, string|null>} */
const potdImageByKey = Object.create(null);
let potdLeaderboardsAttached = false;

const POTD_CACHE_KEY = 'jt-potd-today-v1';

function getPotdTodayDate() {
  return new Date().toLocaleDateString('sv', { timeZone: 'Europe/Athens' });
}

function readPotdCache(today) {
  try {
    const raw = sessionStorage.getItem(POTD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.date !== today || !Array.isArray(parsed.puzzles)) return null;
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

function preloadPotdImages() {
  for (const key of DIFFICULTIES.map((d) => d.key)) {
    const url = potdImageByKey[key];
    if (!url) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}

async function fetchPotdTodayPayload() {
  if (window.__potdTodayFetch) {
    const data = await window.__potdTodayFetch;
    window.__potdTodayFetch = null;
    if (data?.puzzles?.length) return data;
  }
  const res = await fetch('/api/potd-today');
  if (!res.ok) return null;
  return res.json();
}

function setPotdPreview(key) {
  if (!potdPreview || !potdPreviewImg) return;
  const url = potdImageByKey[key];
  if (url) {
    potdPreviewImg.src = url;
    potdPreviewImg.alt = `Preview: ${DIFFICULTIES.find((d) => d.key === key)?.label ?? ''} puzzle of the day`;
    potdPreview.hidden = false;
  } else {
    potdPreview.hidden = true;
    potdPreviewImg.removeAttribute('src');
    potdPreviewImg.alt = '';
  }
}

function setSelectedPotd(key) {
  if (!potdDesc) return;
  selectedPotdKey = key;
  shellMode = 'potd';
  document.querySelectorAll('.potd-tab').forEach((btn) => {
    const on = btn.dataset.diff === key;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.tabIndex = on ? 0 : -1;
  });
  const d = DIFFICULTIES.find((x) => x.key === key);
  potdDesc.textContent = d ? (d.hard ? `${d.pieces} pieces · rotated` : `${d.pieces} pieces`) : '';
  setPotdPreview(key);
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
  renderLeaderboardList(potdLb, leaderboardCache[selectedPotdKey]);
}

function onPotdLeaderboardUpdate(diffKey, entries) {
  leaderboardCache[diffKey] = entries;
  if (diffKey === selectedPotdKey) paintPotdLeaderboard();
}


function applyPotdPayload(payload) {
  if (!potdSection || !potdLb || !potdDesc || !payload) return [];

  const today = getPotdTodayDate();
  if (payload.date !== today) return [];

  const available = [];
  for (const p of payload.puzzles) {
    if (!p?.difficulty || p.date !== today) continue;
    available.push(p.difficulty);
    potdImageByKey[p.difficulty] = p.imageUrl || null;
  }

  availablePotdKeys = available;
  document.querySelectorAll('.potd-tab').forEach((tab) => {
    const has = available.includes(tab.dataset.diff);
    tab.disabled = !has;
    tab.setAttribute('aria-disabled', has ? 'false' : 'true');
  });

  if (available.length === 0) {
    if (potdDesc) potdDesc.textContent = 'No puzzle of the day right now.';
    if (potdPreview) potdPreview.hidden = true;
    return [];
  }

  if (!available.includes(selectedPotdKey)) {
    setSelectedPotd(available[0]);
  } else {
    setSelectedPotd(selectedPotdKey);
  }

  if (!potdLeaderboardsAttached) {
    potdLeaderboardsAttached = true;
    for (const key of available) {
      onPOTDLeaderboard(key, today, (entries) => onPotdLeaderboardUpdate(key, entries));
    }
  }

  return available;
}

async function loadPOTDFromFirebase(today) {
  const rows = await Promise.all(
    DIFFICULTIES.map(async (diff) => {
      try {
        const data = await getPOTD(diff.key);
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
          difficulty: diff.key,
          puzzleId: data.puzzleId,
          date: data.date,
          imageUrl,
        };
      } catch {
        return null;
      }
    }),
  );

  return { date: today, puzzles: rows.filter(Boolean) };
}

async function loadPOTD() {
  if (!potdSection || !potdLb || !potdDesc) return;

  const today = getPotdTodayDate();

  const cached = readPotdCache(today);
  if (cached) {
    applyPotdPayload(cached);
    preloadPotdImages();
  }

  let payload = null;
  try {
    payload = await fetchPotdTodayPayload();
  } catch {
    payload = null;
  }

  if (!payload?.puzzles?.length) {
    try {
      payload = await loadPOTDFromFirebase(today);
    } catch {
      payload = null;
    }
  }

  if (!payload?.puzzles?.length) return;

  writePotdCache(payload);
  applyPotdPayload(payload);
  preloadPotdImages();
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

async function fetchPotdPuzzleId(difficulty) {
  const res = await fetch(`/api/potd-play?difficulty=${encodeURIComponent(difficulty)}&json=1`);
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

async function prefetchPotdEasy() {
  await loadPOTD();
  await waitForPuzzleBoot();
  prefetchedPuzzleId = await fetchPotdPuzzleId('easy');
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
    : prefetchPotdEasy();

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
    const id = await fetchPotdPuzzleId(selectedPotdKey);
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
    shellPlayBtn.disabled = !playSelectedImage;
    return;
  }
  shellPlayBtn.textContent = 'Play Puzzle';
  shellPlayBtn.disabled = shellMode === 'potd' && !availablePotdKeys.includes(selectedPotdKey);
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

document.querySelectorAll('.potd-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    shellMode = 'potd';
    setSelectedPotd(btn.dataset.diff);
  });
});

async function loadShellPlayImages() {
  const grid = document.getElementById('play-image-grid');
  const loading = document.getElementById('play-images-loading');
  if (!grid || !loading) return;
  try {
    const res = await fetch('/api/room-images');
    const images = await res.json();
    if (!images.length) {
      loading.textContent = 'No images available.';
      return;
    }
    loading.style.display = 'none';
    grid.style.display = '';
    grid.innerHTML = '';
    images.forEach((img) => {
      const card = document.createElement('div');
      card.className = 'play-image-card';
      const el = document.createElement('img');
      el.src = img.url;
      el.alt = '';
      el.loading = 'lazy';
      card.appendChild(el);
      card.addEventListener('click', () => {
        document.querySelectorAll('#play-image-grid .play-image-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        playSelectedImage = img;
        shellMode = 'play';
        updateShellPlayButton();
      });
      grid.appendChild(card);
    });
    shellPlayImagesLoaded = true;
  } catch {
    loading.textContent = 'Failed to load images.';
  }
}

async function startPlayTogether() {
  if (!playSelectedImage) {
    setShellStatus('Pick an image first.', true);
    return;
  }
  shellPlayBtn.disabled = true;
  setShellStatus('Creating puzzle…');
  const pieces = document.querySelector('input[name="play-pieces"]:checked').value;
  const hard = document.querySelector('input[name="play-mode"]:checked').value === 'hard';
  const isPublic = document.querySelector('input[name="play-visibility"]:checked').value === 'public';
  const params = new URLSearchParams({
    pieces,
    hard,
    public: isPublic,
    image: playSelectedImage.url,
    w: playSelectedImage.width,
    h: playSelectedImage.height,
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
