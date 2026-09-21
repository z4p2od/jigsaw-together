import { generateEdges, drawJigsawPath } from './jigsaw.js';
import { ALLOWED_PIECES, calculateGrid, formatPuzzleDifficulty } from './puzzle-grid.js';

const TOKEN_KEY = 'jt-admin-token';

const deniedEl = document.getElementById('admin-denied');
const appEl = document.getElementById('admin-app');
const imageGrid = document.getElementById('admin-image-grid');
const imagesStatus = document.getElementById('admin-images-status');
const fileInput = document.getElementById('admin-file');
const previewCanvas = document.getElementById('admin-preview');
const previewMeta = document.getElementById('admin-preview-meta');
const saveBtn = document.getElementById('admin-save');
const saveStatus = document.getElementById('admin-save-status');
const catalogList = document.getElementById('admin-catalog-list');
const catalogEmpty = document.getElementById('admin-catalog-empty');

let token = '';
/** @type {{ url: string, width: number, height: number, publicId?: string } | null} */
let selectedImage = null;
/** @type {string | null} */
let editingId = null;
let previewTimer = 0;

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

async function adminFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function selectedPieces() {
  const raw = parseInt(document.querySelector('input[name="admin-pieces"]:checked')?.value, 10);
  return ALLOWED_PIECES.includes(raw) ? raw : 100;
}

function selectedHard() {
  return document.querySelector('input[name="admin-mode"]:checked')?.value === 'hard';
}

function setStatus(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
}

async function unlock(nextToken) {
  token = String(nextToken || '').trim();
  if (!token) throw new Error('Missing token');
  try {
    await adminFetch('/api/admin?action=catalog');
  } catch (err) {
    token = '';
    throw err;
  }
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch { /* private mode */ }
  stripSecretFromUrl();
  if (deniedEl) deniedEl.hidden = true;
  appEl.hidden = false;
  document.title = 'Puzzle catalog';
  await Promise.all([loadLibrary(), loadCatalog()]);
}

function readSecretFromUrl() {
  const params = new URLSearchParams(location.search);
  const fromQuery = (params.get('k') || params.get('token') || '').trim();
  if (fromQuery) return fromQuery;
  const hash = (location.hash || '').replace(/^#/, '').trim();
  if (!hash) return '';
  if (hash.startsWith('k=')) return decodeURIComponent(hash.slice(2));
  return decodeURIComponent(hash);
}

function stripSecretFromUrl() {
  try {
    history.replaceState(null, '', location.pathname);
  } catch { /* ignore */ }
}

function showDenied() {
  appEl.hidden = true;
  if (deniedEl) deniedEl.hidden = false;
  document.title = 'Not found';
}

function renderLibrary(images) {
  imageGrid.innerHTML = '';
  if (!images.length) {
    imagesStatus.textContent = 'No images in puzzle-library.';
    return;
  }
  imagesStatus.textContent = `${images.length} images`;
  images.forEach((img) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'play-image-card';
    const el = document.createElement('img');
    el.src = img.url;
    el.alt = '';
    el.loading = 'lazy';
    card.appendChild(el);
    card.addEventListener('click', () => selectImage(img, null));
    imageGrid.appendChild(card);
  });
}

async function loadLibrary() {
  imagesStatus.textContent = 'Loading…';
  try {
    const images = await fetch('/api/room-images').then((r) => r.json());
    renderLibrary(images);
  } catch {
    imagesStatus.textContent = 'Failed to load library.';
  }
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  setStatus(saveStatus, 'Uploading…');
  try {
    const sign = await adminFetch('/api/admin?action=sign');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('api_key', sign.apiKey);
    fd.append('timestamp', String(sign.timestamp));
    fd.append('folder', sign.folder);
    fd.append('signature', sign.signature);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/image/upload`, {
      method: 'POST',
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Upload failed');
    const img = {
      url: data.secure_url,
      width: data.width,
      height: data.height,
      publicId: data.public_id,
    };
    await loadLibrary();
    selectImage(img, null);
    setStatus(saveStatus, 'Uploaded. Set difficulty and save to catalog.');
  } catch (err) {
    setStatus(saveStatus, err.message || 'Upload failed', true);
  }
});

function selectImage(img, catalogId) {
  selectedImage = {
    url: img.url || img.fullUrl || img.imageUrl,
    width: img.width,
    height: img.height,
    publicId: img.publicId,
  };
  editingId = catalogId;
  document.querySelectorAll('#admin-image-grid .play-image-card').forEach((c) => {
    const src = c.querySelector('img')?.src;
    c.classList.toggle('selected', !!src && src === selectedImage.url);
  });
  schedulePreview();
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 40);
}

document.querySelectorAll('input[name="admin-pieces"], input[name="admin-mode"]').forEach((el) => {
  el.addEventListener('change', schedulePreview);
});

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

async function renderPreview() {
  if (!selectedImage) {
    previewMeta.textContent = 'Select an image';
    const ctx = previewCanvas.getContext('2d');
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    return;
  }

  const pieces = selectedPieces();
  const hardMode = selectedHard();
  const { cols, rows } = calculateGrid(pieces, selectedImage.width, selectedImage.height);
  const actual = cols * rows;
  previewMeta.textContent = `${formatPuzzleDifficulty(actual, hardMode)} · ${cols}×${rows} grid`;

  try {
    const img = await loadImage(selectedImage.url);
    const maxW = Math.min(720, previewCanvas.parentElement?.clientWidth || 720);
    const scale = Math.min(maxW / img.naturalWidth, 520 / img.naturalHeight, 1);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    previewCanvas.width = w;
    previewCanvas.height = h;
    const ctx = previewCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, w, h);

    const edges = generateEdges(cols, rows);
    const cellW = w / cols;
    const cellH = h / rows;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = actual > 200 ? 0.8 : 1.2;
    ctx.lineJoin = 'round';

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        ctx.save();
        ctx.translate(col * cellW, row * cellH);
        if (hardMode) {
          ctx.translate(cellW / 2, cellH / 2);
          ctx.rotate((Math.PI / 2) * ((row + col) % 4));
          ctx.translate(-cellW / 2, -cellH / 2);
        }
        drawJigsawPath(ctx, cellW, cellH, edges[row * cols + col], 0);
        ctx.stroke();
        ctx.restore();
      }
    }
  } catch (err) {
    previewMeta.textContent = err.message || 'Preview failed';
  }
}

saveBtn.addEventListener('click', async () => {
  if (!selectedImage) {
    setStatus(saveStatus, 'Pick an image first.', true);
    return;
  }
  saveBtn.disabled = true;
  setStatus(saveStatus, 'Saving…');
  try {
    const saved = await adminFetch('/api/admin?action=catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingId || undefined,
        imageUrl: selectedImage.url,
        publicId: selectedImage.publicId || null,
        width: selectedImage.width,
        height: selectedImage.height,
        pieces: selectedPieces(),
        hardMode: selectedHard(),
      }),
    });
    editingId = saved.id;
    setStatus(saveStatus, 'Saved to catalog.');
    await loadCatalog();
  } catch (err) {
    setStatus(saveStatus, err.message || 'Save failed', true);
  } finally {
    saveBtn.disabled = false;
  }
});

function renderCatalog(puzzles) {
  catalogList.innerHTML = '';
  catalogEmpty.style.display = puzzles.length ? 'none' : '';
  puzzles.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'admin-catalog-row';
    row.innerHTML = `
      <img src="${p.imageUrl}" alt="" width="72" height="54" />
      <div>
        <strong>${formatPuzzleDifficulty(p.pieces, p.hardMode)}</strong>
        <div class="potd-desc">${p.width}×${p.height}</div>
      </div>
      <button type="button" class="btn btn-sm" data-edit>Edit</button>
      <button type="button" class="btn btn-sm" data-del>Delete</button>
    `;
    row.querySelector('[data-edit]').addEventListener('click', () => {
      const piecesRadio = document.querySelector(`input[name="admin-pieces"][value="${p.pieces}"]`);
      if (piecesRadio) piecesRadio.checked = true;
      document.querySelector(`input[name="admin-mode"][value="${p.hardMode ? 'hard' : 'normal'}"]`).checked = true;
      selectImage({ url: p.imageUrl, width: p.width, height: p.height, publicId: p.publicId }, p.id);
    });
    row.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm('Remove this puzzle from the catalog? The Cloudinary image stays.')) return;
      try {
        await adminFetch(`/api/admin?action=catalog&id=${encodeURIComponent(p.id)}`, { method: 'DELETE' });
        if (editingId === p.id) editingId = null;
        await loadCatalog();
      } catch (err) {
        setStatus(saveStatus, err.message || 'Delete failed', true);
      }
    });
    catalogList.appendChild(row);
  });
}

async function loadCatalog() {
  const data = await adminFetch('/api/admin?action=catalog');
  renderCatalog(data.puzzles || []);
}

(async function boot() {
  let candidate = readSecretFromUrl();
  if (!candidate) {
    try {
      candidate = sessionStorage.getItem(TOKEN_KEY) || '';
    } catch { /* private mode */ }
  }
  if (candidate) {
    try {
      await unlock(candidate);
      return;
    } catch {
      try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    }
  }
  showDenied();
})();
