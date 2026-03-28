import { createPuzzle, getPOTD, onPOTDLeaderboard } from './firebase.js';
import { generateEdges } from './jigsaw.js';
import { getImageDimensions, withTimeout, loadImage } from './image-utils.js';

const fileInput   = document.getElementById('file-input');
const uploadZone  = document.getElementById('upload-zone');
const placeholder = document.getElementById('upload-placeholder');
const preview     = document.getElementById('preview');
const createBtn   = document.getElementById('create-btn');
const statusEl    = document.getElementById('status');
const modeHint    = document.getElementById('mode-hint');

const MAX_BYTES = 10 * 1024 * 1024;
/** Stay under Vercel serverless body limits; server default max is 4MB unless PUZZLE_UPLOAD_MAX_BYTES is set. */
const MAX_PROXY_UPLOAD_BYTES = 3_600_000;

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

// ── Upload (same-origin → server → Cloudinary) ────────────────────────────────
// In-app browsers often block direct POSTs to api.cloudinary.com.

async function prepareBlobForServerUpload(file, maxBytes) {
  if (!(file instanceof Blob)) throw new Error('Expected a File/Blob');
  if (file.size <= maxBytes) return file;

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let maxEdge = 2048;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare image for upload');

    for (let iter = 0; iter < 14; iter++) {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const scale = Math.min(1, maxEdge / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      let q = 0.9;
      let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
      if (!blob) throw new Error('Could not encode image');
      while (blob.size > maxBytes && q > 0.45) {
        q -= 0.07;
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
        if (!blob) break;
      }
      if (blob && blob.size <= maxBytes) return blob;
      maxEdge = Math.floor(maxEdge * 0.8);
      if (maxEdge < 400) break;
    }
    throw new Error('Could not compress image enough. Try a smaller photo.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadPuzzleImageToServer(blob) {
  if (!(blob instanceof Blob)) throw new Error('Expected a Blob');
  const ct = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  const res = await fetchWithTimeout(
    '/api/upload-puzzle-image',
    { method: 'POST', headers: { 'Content-Type': ct }, body: blob },
    120000
  );
  const data = await res.json().catch(() => ({}));
  if (res.status === 413) throw new Error(data.error || 'Image too large for this server.');
  if (!res.ok) throw new Error(data.error || 'Upload failed');
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
    setStatus('Preparing image for upload…');
    const uploadBlob = await prepareBlobForServerUpload(selectedFile, MAX_PROXY_UPLOAD_BYTES);
    const dims = await getImageDimensions(uploadBlob);

    const { cols, rows } = calculateGrid(pieceCount, dims.width, dims.height);
    const actualCount = cols * rows;

    const pieceW = Math.floor(dims.width  / cols);
    const pieceH = Math.floor(dims.height / rows);

    const boardW = 900, boardH = 650;
    const scale    = Math.min((boardW * 0.55) / dims.width, (boardH * 0.55) / dims.height, 1);
    const displayW = Math.floor(pieceW * scale);
    const displayH = Math.floor(pieceH * scale);

    const hardMode = document.querySelector('input[name="mode"]:checked').value === 'hard';
    const edges    = generateEdges(cols, rows);
    const pieces   = scatterPieces(actualCount, displayW, displayH, hardMode);

    setStatus('Uploading image...');
    const { imageUrl, imagePublicId } = await withTimeout(
      uploadPuzzleImageToServer(uploadBlob),
      120000,
      'image upload'
    );

    const meta = { imageUrl, imagePublicId, cols, rows, pieceW, pieceH, displayW, displayH, edges, hardMode };

    setStatus(`Creating ${actualCount}-piece puzzle...`);
    const puzzleId = await withTimeout(createPuzzle(meta, pieces), 15000, 'puzzle creation');
    window.location.href = `/puzzle.html?id=${puzzleId}`;
  } catch (err) {
    console.error(err);
    let msg = err?.message || 'Something went wrong. Please try again.';
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

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (isError ? ' error' : '');
}
