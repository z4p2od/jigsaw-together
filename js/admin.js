import { generateEdges, drawJigsawPath } from './jigsaw.js';
import {
  TARGET_PIECE_COUNTS,
  calculateGrid,
  clampGrid,
  defaultTargetPieces,
  resolveGrid,
  describePieceShape,
  formatPuzzleDifficulty,
} from './puzzle-grid.js';

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
const colsInput = document.getElementById('admin-cols');
const rowsInput = document.getElementById('admin-rows');
const gridHint = document.getElementById('admin-grid-hint');

/** @type {{ url: string, width: number, height: number, publicId?: string } | null} */
let selectedImage = null;
/** @type {string | null} */
let editingId = null;
/** @type {Array<Record<string, unknown>>} */
let catalogPuzzles = [];
let previewTimer = 0;
let previewGen = 0;

async function adminFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function selectedHard() {
  return document.querySelector('input[name="admin-mode"]:checked')?.value === 'hard';
}

function selectedGrid(commit = false) {
  const grid = clampGrid(colsInput.value, rowsInput.value);
  if (commit) {
    colsInput.value = String(grid.cols);
    rowsInput.value = String(grid.rows);
  }
  return grid;
}

function applySuggestedGrid(pieceCount) {
  if (!selectedImage) return;
  const grid = calculateGrid(pieceCount, selectedImage.width, selectedImage.height);
  colsInput.value = String(grid.cols);
  rowsInput.value = String(grid.rows);
  highlightTarget(pieceCount);
  schedulePreview();
}

function highlightTarget(pieceCount) {
  document.querySelectorAll('#admin-targets [data-target]').forEach((btn) => {
    btn.classList.toggle('is-active', Number(btn.getAttribute('data-target')) === pieceCount);
  });
}

function setStatus(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
}

function findCatalogForImage(img) {
  const url = img.url || img.imageUrl;
  const publicId = img.publicId;
  return catalogPuzzles.find((p) =>
    (publicId && p.publicId === publicId) || (url && p.imageUrl === url)
  ) || null;
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
    card.addEventListener('click', () => {
      const existing = findCatalogForImage(img);
      selectImage(img, existing?.id || null, existing);
    });
    imageGrid.appendChild(card);
  });
}

async function loadLibrary() {
  imagesStatus.textContent = 'Loading…';
  try {
    const images = await fetch('/api/room-images').then((r) => r.json());
    renderLibrary(Array.isArray(images) ? images : []);
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
    setStatus(saveStatus, 'Uploaded. Check the cut preview, then save.');
  } catch (err) {
    setStatus(saveStatus, err.message || 'Upload failed', true);
  }
});

function selectImage(img, catalogId, saved) {
  selectedImage = {
    url: img.url || img.fullUrl || img.imageUrl,
    width: img.width,
    height: img.height,
    publicId: img.publicId,
  };
  editingId = catalogId || null;
  document.querySelectorAll('#admin-image-grid .play-image-card').forEach((c) => {
    const src = c.querySelector('img')?.src;
    c.classList.toggle('selected', !!src && src === selectedImage.url);
  });
  if (saved) {
    const grid = resolveGrid({
      cols: saved.cols,
      rows: saved.rows,
      pieces: saved.pieces,
      width: selectedImage.width,
      height: selectedImage.height,
    });
    colsInput.value = String(grid.cols);
    rowsInput.value = String(grid.rows);
    document.querySelector(`input[name="admin-mode"][value="${saved.hardMode ? 'hard' : 'normal'}"]`).checked = true;
    highlightTarget(null);
  } else {
    const target = defaultTargetPieces(selectedImage.publicId);
    applySuggestedGrid(target);
    document.querySelector('input[name="admin-mode"][value="normal"]').checked = true;
    return;
  }
  schedulePreview();
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 40);
}

document.querySelectorAll('input[name="admin-mode"]').forEach((el) => {
  el.addEventListener('change', schedulePreview);
});
[colsInput, rowsInput].forEach((el) => {
  el.addEventListener('input', () => {
    highlightTarget(null);
    schedulePreview();
  });
  el.addEventListener('change', () => {
    selectedGrid(true);
    highlightTarget(null);
    schedulePreview();
  });
});
document.querySelectorAll('#admin-targets [data-target]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const n = parseInt(btn.getAttribute('data-target'), 10);
    if (TARGET_PIECE_COUNTS.includes(n)) applySuggestedGrid(n);
  });
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

function drawCutOverlay(ctx, cols, rows, w, h) {
  const edges = generateEdges(cols, rows);
  const cellW = w / cols;
  const cellH = h / rows;
  const count = cols * rows;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.save();
      ctx.translate(col * cellW, row * cellH);
      drawJigsawPath(ctx, cellW, cellH, edges[row * cols + col], 0);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = count > 80 ? 2.2 : 3;
      ctx.stroke();
      drawJigsawPath(ctx, cellW, cellH, edges[row * cols + col], 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = count > 80 ? 1 : 1.4;
      ctx.stroke();
      ctx.restore();
    }
  }
}

async function renderPreview() {
  if (!selectedImage) {
    previewMeta.textContent = 'Select an image';
    const ctx = previewCanvas.getContext('2d');
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    return;
  }

  const { cols, rows } = selectedGrid();
  const hardMode = selectedHard();
  const actual = cols * rows;
  if (gridHint) gridHint.textContent = describePieceShape(cols, rows, selectedImage.width, selectedImage.height);
  previewMeta.textContent = `${formatPuzzleDifficulty(actual, hardMode, cols, rows)} — live cut`;

  const gen = ++previewGen;
  try {
    const img = await loadImage(selectedImage.url);
    if (gen !== previewGen) return;
    const maxW = Math.min(720, previewCanvas.parentElement?.clientWidth || 720);
    const scale = Math.min(maxW / img.naturalWidth, 560 / img.naturalHeight, 1);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    previewCanvas.width = w;
    previewCanvas.height = h;
    const ctx = previewCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, w, h);
    drawCutOverlay(ctx, cols, rows, w, h);
  } catch (err) {
    if (gen !== previewGen) return;
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
    const { cols, rows } = selectedGrid(true);
    const saved = await adminFetch('/api/admin?action=catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingId || undefined,
        imageUrl: selectedImage.url,
        publicId: selectedImage.publicId || null,
        width: selectedImage.width,
        height: selectedImage.height,
        pieces: cols * rows,
        cols,
        rows,
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
        <strong>${formatPuzzleDifficulty(p.pieces, p.hardMode, p.cols, p.rows)}</strong>
        <div class="potd-desc">${p.width}×${p.height}</div>
      </div>
      <button type="button" class="btn btn-sm" data-edit>Edit</button>
      <button type="button" class="btn btn-sm" data-del>Delete</button>
    `;
    row.querySelector('[data-edit]').addEventListener('click', () => {
      selectImage({ url: p.imageUrl, width: p.width, height: p.height, publicId: p.publicId }, p.id, p);
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
  catalogPuzzles = data.puzzles || [];
  renderCatalog(catalogPuzzles);
}

async function bootOpen() {
  if (deniedEl) deniedEl.hidden = true;
  appEl.hidden = false;
  document.title = 'Puzzle catalog';
  await loadLibrary();
  try {
    const seeded = await adminFetch('/api/admin?action=seed', { method: 'POST' });
    if (seeded.created) {
      setStatus(saveStatus, `Filled ${seeded.created} library puzzles (~25 / ~50 / ~100). Edit any of them and save.`);
    }
  } catch (err) {
    setStatus(saveStatus, err.message || 'Could not fill defaults', true);
  }
  await loadCatalog();
}

bootOpen();

/*
Restore secret-link auth later:
- Require Bearer ADMIN_TOKEN / FEEDBACK_ADMIN_TOKEN in api/admin.js
- Read /admin#TOKEN here, sessionStorage, showDenied() if missing
*/
