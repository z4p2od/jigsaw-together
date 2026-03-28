import { createPuzzle, getPOTD, onPOTDLeaderboard } from './firebase.js';
import { generateEdges } from './jigsaw.js';

const fileInput   = document.getElementById('file-input');
const uploadZone  = document.getElementById('upload-zone');
const placeholder = document.getElementById('upload-placeholder');
const preview     = document.getElementById('preview');
const createBtn   = document.getElementById('create-btn');
const statusEl    = document.getElementById('status');
const modeHint    = document.getElementById('mode-hint');

const MAX_BYTES = 10 * 1024 * 1024;

let imageBase64 = null;

function isLikelyInAppBrowser() {
  const ua = navigator.userAgent || '';
  return /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|Snapchat|Messenger|LinkedInApp|TikTok/i.test(ua);
}

async function fetchJsonWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
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

async function loadPOTD() {
  const today = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Athens' });
  let anyShown = false;

  for (const diff of DIFFICULTIES) {
    try {
      const data = await getPOTD(diff.key);
      if (!data || data.date !== today) continue;

      const card = document.getElementById(`potd-${diff.key}`);
      if (!card) continue;
      card.querySelector('.potd-play').href = `/api/potd-play?difficulty=${diff.key}`;
      card.style.display = '';
      anyShown = true;

      // Subscribe to leaderboard updates
      onPOTDLeaderboard(diff.key, today, entries => renderLeaderboard(diff.key, entries));
    } catch {}
  }

  if (anyShown) document.getElementById('potd-section').style.display = '';
}

function renderLeaderboard(diffKey, entries) {
  const el = document.getElementById(`potd-lb-${diffKey}`);
  if (!el) return;

  // Sort by time ascending, take top 5
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

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    preview.src = dataUrl;
    preview.style.display = 'block';
    placeholder.style.display = 'none';

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const compressed = canvas.toDataURL('image/jpeg', 0.92);
      imageBase64 = compressed.replace(/^data:image\/\w+;base64,/, '');
      createBtn.disabled = false;
      setStatus('');
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
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

// ── Cloudinary upload ─────────────────────────────────────────────────────────

let cloudinaryConfigCache = null;

async function uploadToCloudinary(base64Data) {
  if (!cloudinaryConfigCache) {
    cloudinaryConfigCache = await fetchJsonWithTimeout('/api/cloudinary-config', 8000);
  }
  const { cloudName, uploadPreset } = cloudinaryConfigCache;
  const fd = new FormData();
  fd.append('file',          'data:image/jpeg;base64,' + base64Data);
  fd.append('upload_preset', uploadPreset);
  const res = await fetchWithTimeout(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: fd },
    120000
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Cloudinary upload failed');
  return { imageUrl: data.secure_url, imagePublicId: data.public_id };
}

// ── Create puzzle ─────────────────────────────────────────────────────────────

createBtn.addEventListener('click', handleCreatePuzzle);

async function handleCreatePuzzle() {
  if (!imageBase64) return;

  const pieceCount = Number(document.querySelector('input[name="pieces"]:checked').value);
  setStatus('Generating puzzle...');
  createBtn.disabled = true;

  try {
    const img = await loadImage('data:image/jpeg;base64,' + imageBase64);
    const { cols, rows } = calculateGrid(pieceCount, img.naturalWidth, img.naturalHeight);
    const actualCount = cols * rows;

    const pieceW = Math.floor(img.naturalWidth  / cols);
    const pieceH = Math.floor(img.naturalHeight / rows);

    const boardW = 900, boardH = 650;
    const scale    = Math.min((boardW * 0.55) / img.naturalWidth, (boardH * 0.55) / img.naturalHeight, 1);
    const displayW = Math.floor(pieceW * scale);
    const displayH = Math.floor(pieceH * scale);

    const hardMode = document.querySelector('input[name="mode"]:checked').value === 'hard';
    const edges    = generateEdges(cols, rows);
    const pieces   = scatterPieces(actualCount, displayW, displayH, hardMode);

    setStatus('Uploading image...');
    const { imageUrl, imagePublicId } = await uploadToCloudinary(imageBase64);

    const meta = { imageUrl, imagePublicId, cols, rows, pieceW, pieceH, displayW, displayH, edges, hardMode };

    setStatus(`Creating ${actualCount}-piece puzzle...`);
    const puzzleId = await createPuzzle(meta, pieces);
    window.location.href = `/puzzle.html?id=${puzzleId}`;
  } catch (err) {
    console.error(err);
    let msg = 'Something went wrong. Please try again.';
    if (err.name === 'AbortError') {
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (isError ? ' error' : '');
}
