import { createPuzzle, getPOTD, getPuzzleImageUrl, onPOTDLeaderboard } from './firebase.js';
import { generateEdges } from './jigsaw.js';
import { getImageDimensions, withTimeout } from './image-utils.js';
import { scatterPieces } from './scatter-pieces.js';

const fileInput   = document.getElementById('file-input');
const uploadZone  = document.getElementById('upload-zone');
const placeholder = document.getElementById('upload-placeholder');
const preview     = document.getElementById('preview');
const statusEl    = document.getElementById('shell-status');
const modeHint    = document.getElementById('mode-hint');
const shellPlayBtn = document.getElementById('shell-play-btn');

/** @type {'potd' | 'play' | 'vs' | 'upload'} */
let shellMode = 'potd';
let shellPlayImagesLoaded = false;
let playSelectedImage = null;

const MAX_BYTES = 10 * 1024 * 1024;

function jtDbgLog(payload) {
  const line = { sessionId: 'c7426d', timestamp: Date.now(), ...payload };
  try {
    window.__JT_DEBUG_LOGS = window.__JT_DEBUG_LOGS || [];
    window.__JT_DEBUG_LOGS.push(line);
    if (window.__JT_DEBUG_LOGS.length > 120) window.__JT_DEBUG_LOGS.shift();
  } catch (_) { /* ignore */ }
  fetch('http://127.0.0.1:7319/ingest/be2f6902-b67c-428c-8ee3-1dabde1e3930', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'c7426d' },
    body: JSON.stringify(line),
  }).catch(() => {});
}

let selectedFile = null;
let selectedDims = null;

function isLikelyInAppBrowser() {
  const ua = navigator.userAgent || '';
  return /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|Snapchat|Messenger|LinkedInApp|TikTok/i.test(ua);
}

function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// Show hard mode explainer when Hard is selected
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    modeHint.style.display = radio.value === 'hard' && radio.checked ? '' : 'none';
  });
});

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
    if (btn.hidden) return;
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
    const tab = document.querySelector(`.potd-tab[data-diff="${p.difficulty}"]`);
    if (tab) tab.hidden = false;
  }

  if (available.length === 0) return [];

  const tabsRow = document.getElementById('potd-tabs');
  if (tabsRow) tabsRow.style.display = available.length <= 1 ? 'none' : '';

  potdSection.style.display = '';
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

loadPOTD().then(async () => {
  const existingId = new URLSearchParams(location.search).get('id');
  if (!existingId && potdSection?.style.display !== 'none') {
    await autoLoadPotdEasy();
  }
});

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

async function autoLoadPotdEasy() {
  try {
    setShellStatus('Loading today\'s easy puzzle…');
    await waitForPuzzleBoot();
    const id = await fetchPotdPuzzleId('easy');
    await window.__JT_bootPuzzle(id);
    setShellStatus('');
  } catch (err) {
    console.error(err);
    setShellStatus(err.message || 'No puzzle of the day available.', true);
  }
}

async function startSelectedPotd() {
  setShellStatus('Starting puzzle…');
  shellPlayBtn.disabled = true;
  try {
    const id = await fetchPotdPuzzleId(selectedPotdKey);
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

// ── VS Mode create ────────────────────────────────────────────────────────────

let vsPickedImage = null; // { url, width, height }

// Show/hide image picker when radio changes
document.querySelectorAll('input[name="vs-image"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const pickerEl = document.getElementById('vs-image-picker');
    if (radio.value === 'pick' && radio.checked) {
      pickerEl.style.display = '';
      loadVSImagePicker();
    } else {
      pickerEl.style.display = 'none';
      vsPickedImage = null;
    }
  });
});

async function loadVSImagePicker() {
  const grid     = document.getElementById('vs-image-grid');
  const statusEl = document.getElementById('vs-image-status');
  if (grid.dataset.loaded) return; // already loaded
  statusEl.textContent = 'Loading…';
  try {
    const res  = await fetch('/api/room-images');
    const imgs = await res.json();
    grid.innerHTML = '';
    if (!imgs.length) { statusEl.textContent = 'No images found.'; return; }
    imgs.forEach(img => {
      const el = document.createElement('div');
      el.className = 'vs-img-thumb';
      el.style.backgroundImage = `url(${img.url})`;
      el.title = `${img.width}×${img.height}`;
      el.addEventListener('click', () => {
        grid.querySelectorAll('.vs-img-thumb').forEach(t => t.classList.remove('selected'));
        el.classList.add('selected');
        vsPickedImage = img;
        statusEl.textContent = '✓ Image selected';
      });
      grid.appendChild(el);
    });
    statusEl.textContent = `${imgs.length} images — click one to select`;
    grid.dataset.loaded = '1';
  } catch {
    statusEl.textContent = 'Failed to load images.';
  }
}

document.getElementById('vs-create-btn')?.addEventListener('click', () => {
  startVsMatch();
});

function startVsMatch() {
  const pieces    = document.querySelector('input[name="vs-pieces"]:checked').value;
  const mode      = document.querySelector('input[name="vs-mode"]:checked').value;
  const hard      = mode === 'hard';
  const chaos     = mode === 'chaos';
  const teamEl    = document.querySelector('input[name="vs-type"]:checked');
  const teamMode  = teamEl ? teamEl.value === 'team' : false;
  const imageMode = document.querySelector('input[name="vs-image"]:checked')?.value ?? 'random';

  let url = `/api/vs-create?pieces=${pieces}&hard=${hard}&chaos=${chaos}&teamMode=${teamMode}`;
  if (imageMode === 'pick' && vsPickedImage) {
    url += `&imageUrl=${encodeURIComponent(vsPickedImage.url)}&imageW=${vsPickedImage.width}&imageH=${vsPickedImage.height}`;
  } else if (imageMode === 'pick' && !vsPickedImage) {
    setShellStatus('Please select an image first.', true);
    return;
  }
  window.location.href = url;
}

// ── Image upload ──────────────────────────────────────────────────────────────

fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return setShellStatus('Please upload an image file.', true);
  if (file.size > MAX_BYTES) return setShellStatus('Image must be under 10MB.', true);

  // Preview using an object URL to avoid base64 memory spikes in iOS in-app browsers.
  selectedFile = file;
  selectedDims = null;
  shellMode = 'upload';
  updateShellPlayButton();
  setShellStatus('Preparing image…');

  const objUrl = URL.createObjectURL(file);
  preview.onload = () => URL.revokeObjectURL(objUrl);
  preview.onerror = () => URL.revokeObjectURL(objUrl);
  preview.src = objUrl;
  preview.style.display = 'block';
  placeholder.style.display = 'none';

  // Resolve dimensions asynchronously (enables grid calc without re-encoding).
  getImageDimensions(file)
    .then(dims => {
      selectedDims = dims;
      updateShellPlayButton();
      setShellStatus('');
    })
    .catch(err => {
      console.error(err);
      selectedFile = null;
      selectedDims = null;
      updateShellPlayButton();
      setShellStatus('Could not read that image. Please try a different photo.', true);
    });
}

// ── Grid calculation ──────────────────────────────────────────────────────────

function calculateGrid(pieceCount, imgWidth, imgHeight) {
  const aspect = imgWidth / imgHeight;
  let bestCols = 1, bestRows = pieceCount, bestDiff = Infinity;
  for (let cols = 1; cols <= pieceCount; cols++) {
    const rows = Math.round(pieceCount / cols);
    if (cols * rows === 0) continue;
    const diff = Math.abs(cols / rows - aspect);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestCols = cols;
      bestRows = rows;
    }
  }
  return { cols: bestCols, rows: bestRows };
}

// ── Scatter pieces ────────────────────────────────────────────────────────────

// ── Cloudinary upload (direct from browser; in-app WebViews may block — see status copy) ──

let cloudinaryConfigCache = null;

async function uploadToCloudinary(file) {
  if (!(file instanceof Blob)) throw new Error('Expected a File/Blob');

  if (!cloudinaryConfigCache) {
    cloudinaryConfigCache = await withTimeout(
      (async () => {
        const r = await fetch('/api/cloudinary-config');
        if (!r.ok) throw new Error(`cloudinary config ${r.status}`);
        return r.json();
      })(),
      8000,
      'cloudinary config'
    );
  }
  const { cloudName, uploadPreset } = cloudinaryConfigCache || {};
  if (!cloudName || !uploadPreset) throw new Error('Missing Cloudinary config');

  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', uploadPreset);
  const res = await fetchWithTimeout(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: fd },
    120000
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || 'Cloudinary upload failed');
  return { imageUrl: data.secure_url, imagePublicId: data.public_id };
}

// ── Create puzzle ─────────────────────────────────────────────────────────────

async function handleCreatePuzzle() {
  if (!selectedFile || !selectedDims) return;

  const pieceCount = Number(document.querySelector('input[name="pieces"]:checked').value);
  setShellStatus('Generating puzzle...');
  shellPlayBtn.disabled = true;

  try {
    const { cols, rows } = calculateGrid(pieceCount, selectedDims.width, selectedDims.height);
    const actualCount = cols * rows;

    const pieceW = Math.floor(selectedDims.width  / cols);
    const pieceH = Math.floor(selectedDims.height / rows);

    const boardW = 1080, boardH = 780;
    const scale    = Math.min((boardW * 0.55) / selectedDims.width, (boardH * 0.55) / selectedDims.height, 1);
    const displayW = Math.floor(pieceW * scale);
    const displayH = Math.floor(pieceH * scale);

    const hardMode = document.querySelector('input[name="mode"]:checked').value === 'hard';
    const edges    = generateEdges(cols, rows);
    const pieces   = scatterPieces({ count: actualCount, dispW: displayW, dispH: displayH, hardMode });
    // #region agent log
    {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pieces) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      jtDbgLog({
        runId: 'pre-fix-2',
        hypothesisId: 'H6',
        location: 'app.js:handleCreatePuzzle:scatter',
        message: 'pieces scattered on create',
        data: { pieceCount: actualCount, cols, rows, displayW, displayH, boardW, boardH, minX, minY, maxX, maxY },
      });
    }
    // #endregion

    setShellStatus('Uploading image...');
    const { imageUrl, imagePublicId } = await withTimeout(
      uploadToCloudinary(selectedFile),
      120000,
      'image upload'
    );

    const meta = { imageUrl, imagePublicId, cols, rows, pieceW, pieceH, displayW, displayH, edges, hardMode };
    // #region agent log
    jtDbgLog({
      runId: 'pre-fix-2',
      hypothesisId: 'H6-H1',
      location: 'app.js:handleCreatePuzzle:meta',
      message: 'createPuzzle request meta',
      data: {
        cols,
        rows,
        pieceW,
        pieceH,
        displayW,
        displayH,
        hardMode,
        imagePublicIdPrefix: String(imagePublicId || '').split('/').slice(0, 2).join('/'),
      },
    });
    // #endregion

    setShellStatus(`Creating ${actualCount}-piece puzzle...`);
    const newPuzzleId = await withTimeout(createPuzzle(meta, pieces), 15000, 'puzzle creation');
    if (typeof window.__JT_bootPuzzle === 'function') {
      await window.__JT_bootPuzzle(newPuzzleId);
    } else {
      window.location.href = `/?id=${encodeURIComponent(newPuzzleId)}`;
    }
    setShellStatus('');
  } catch (err) {
    console.error(err);
    let msg = err?.message || 'Something went wrong. Please try again.';
    if (err.name === 'AbortError' || /timed out/i.test(String(err?.message || ''))) {
      msg = 'Upload or setup timed out. In-app browsers (Instagram, Messenger, TikTok) often block image uploads.';
    }
    if (isLikelyInAppBrowser()) {
      msg += ' Open this page in Safari or Chrome: Share → Open in Browser.';
    }
    setShellStatus(msg, true);
  } finally {
    shellPlayBtn.disabled = false;
    updateShellPlayButton();
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
  if (shellMode === 'upload') {
    shellPlayBtn.textContent = 'Load Puzzle';
    shellPlayBtn.disabled = !selectedFile || !selectedDims;
    return;
  }
  if (shellMode === 'vs') {
    shellPlayBtn.textContent = 'Start Vs Match';
    shellPlayBtn.disabled = false;
    return;
  }
  if (shellMode === 'play') {
    shellPlayBtn.textContent = 'Play Puzzle';
    shellPlayBtn.disabled = !playSelectedImage;
    return;
  }
  shellPlayBtn.textContent = 'Play Puzzle';
  shellPlayBtn.disabled = potdSection?.style.display === 'none';
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
    if (btn.hidden) return;
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
  if (shellMode === 'vs') return startVsMatch();
  if (shellMode === 'upload') return handleCreatePuzzle();
});

document.getElementById('celebration-new-btn')?.addEventListener('click', () => {
  document.getElementById('celebration').style.display = 'none';
  shellMode = 'potd';
  updateShellPlayButton();
});

updateShellPlayButton();
