import { createPuzzle, getPOTD, getPuzzleImageUrl, onPOTDLeaderboard } from './firebase.js';
import { generateEdges } from './jigsaw.js';
import { getImageDimensions, withTimeout } from './image-utils.js';

const fileInput   = document.getElementById('file-input');
const uploadZone  = document.getElementById('upload-zone');
const placeholder = document.getElementById('upload-placeholder');
const preview     = document.getElementById('preview');
const createBtn   = document.getElementById('create-btn');
const statusEl    = document.getElementById('status');
const modeHint    = document.getElementById('mode-hint');

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
const potdPlay      = document.getElementById('potd-play');
const potdDesc      = document.getElementById('potd-desc');
const potdPreview   = document.getElementById('potd-preview');
const potdPreviewImg = document.getElementById('potd-preview-img');

let selectedPotdKey = 'easy';
const leaderboardCache = Object.create(null);
/** @type {Record<string, string|null>} */
const potdImageByKey = Object.create(null);

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
  if (!potdPlay || !potdDesc) return;
  selectedPotdKey = key;
  document.querySelectorAll('.potd-tab').forEach((btn) => {
    if (btn.hidden) return;
    const on = btn.dataset.diff === key;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.tabIndex = on ? 0 : -1;
  });
  potdPlay.href = `/api/potd-play?difficulty=${key}`;
  const d = DIFFICULTIES.find((x) => x.key === key);
  potdDesc.textContent = d ? (d.hard ? `${d.pieces} pieces · rotated` : `${d.pieces} pieces`) : '';
  setPotdPreview(key);
  paintPotdLeaderboard();
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

document.querySelectorAll('.potd-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.hidden) return;
    setSelectedPotd(btn.dataset.diff);
  });
});

async function loadPOTD() {
  if (!potdSection || !potdLb || !potdPlay || !potdDesc) return;

  const today = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Athens' });
  const available = [];

  for (const diff of DIFFICULTIES) {
    try {
      const data = await getPOTD(diff.key);
      if (!data || data.date !== today) continue;
      available.push(diff.key);
      const tab = document.querySelector(`.potd-tab[data-diff="${diff.key}"]`);
      if (tab) tab.hidden = false;
      if (data.puzzleId) {
        try {
          const url = await getPuzzleImageUrl(data.puzzleId);
          potdImageByKey[diff.key] = url || null;
        } catch {
          potdImageByKey[diff.key] = null;
        }
      } else {
        potdImageByKey[diff.key] = null;
      }
    } catch { /* ignore */ }
  }

  if (available.length === 0) return;

  const tabsRow = document.getElementById('potd-tabs');
  if (tabsRow) tabsRow.style.display = available.length <= 1 ? 'none' : '';

  potdSection.style.display = '';
  setSelectedPotd(available[0]);

  for (const key of available) {
    onPOTDLeaderboard(key, today, (entries) => onPotdLeaderboardUpdate(key, entries));
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

loadPOTD();

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

document.getElementById('vs-create-btn').addEventListener('click', () => {
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
    document.getElementById('vs-image-status').textContent = '⚠️ Please select an image first.';
    return;
  }
  window.location.href = url;
});

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
  if (!file.type.startsWith('image/')) return setStatus('Please upload an image file.', true);
  if (file.size > MAX_BYTES) return setStatus('Image must be under 10MB.', true);

  // Preview using an object URL to avoid base64 memory spikes in iOS in-app browsers.
  selectedFile = file;
  selectedDims = null;
  createBtn.disabled = true;
  setStatus('Preparing image…');

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
      createBtn.disabled = false;
      setStatus('');
    })
    .catch(err => {
      console.error(err);
      selectedFile = null;
      selectedDims = null;
      createBtn.disabled = true;
      setStatus('Could not read that image. Please try a different photo.', true);
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

function scatterPieces(count, dispW, dispH, hardMode) {
  const boardW = 900;
  const boardH = 650;
  const ROTS   = [0, 90, 180, 270];
  return Array.from({ length: count }, () => ({
    x:        Math.random() * (boardW - dispW),
    y:        Math.random() * (boardH - dispH),
    rotation: hardMode ? ROTS[Math.floor(Math.random() * 4)] : 0,
  }));
}

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

createBtn.addEventListener('click', handleCreatePuzzle);

async function handleCreatePuzzle() {
  if (!selectedFile || !selectedDims) return;

  const pieceCount = Number(document.querySelector('input[name="pieces"]:checked').value);
  setStatus('Generating puzzle...');
  createBtn.disabled = true;

  try {
    const { cols, rows } = calculateGrid(pieceCount, selectedDims.width, selectedDims.height);
    const actualCount = cols * rows;

    const pieceW = Math.floor(selectedDims.width  / cols);
    const pieceH = Math.floor(selectedDims.height / rows);

    const boardW = 900, boardH = 650;
    const scale    = Math.min((boardW * 0.55) / selectedDims.width, (boardH * 0.55) / selectedDims.height, 1);
    const displayW = Math.floor(pieceW * scale);
    const displayH = Math.floor(pieceH * scale);

    const hardMode = document.querySelector('input[name="mode"]:checked').value === 'hard';
    const edges    = generateEdges(cols, rows);
    const pieces   = scatterPieces(actualCount, displayW, displayH, hardMode);
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

    setStatus('Uploading image...');
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

    setStatus(`Creating ${actualCount}-piece puzzle...`);
    const puzzleId = await withTimeout(createPuzzle(meta, pieces), 15000, 'puzzle creation');
    window.location.href = `/puzzle.html?id=${puzzleId}`;
  } catch (err) {
    console.error(err);
    let msg = err?.message || 'Something went wrong. Please try again.';
    if (err.name === 'AbortError' || /timed out/i.test(String(err?.message || ''))) {
      msg = 'Upload or setup timed out. In-app browsers (Instagram, Messenger, TikTok) often block image uploads.';
    }
    if (isLikelyInAppBrowser()) {
      msg += ' Open this page in Safari or Chrome: Share → Open in Browser.';
    }
    setStatus(msg, true);
    createBtn.disabled = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (isError ? ' error' : '');
}
