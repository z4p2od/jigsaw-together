import { createPuzzle } from './firebase.js';
import { generateEdges } from './jigsaw.js';

const fileInput   = document.getElementById('file-input');
const uploadZone  = document.getElementById('upload-zone');
const placeholder = document.getElementById('upload-placeholder');
const preview     = document.getElementById('preview');
const createBtn   = document.getElementById('create-btn');
const statusEl    = document.getElementById('status');

const MAX_BYTES = 10 * 1024 * 1024;

let imageBase64 = null;

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

    // Compute display size once here — stored in Firebase so every client
    // uses the exact same pixel values for rendering and snap alignment.
    const boardW = 900, boardH = 650;
    const scale    = Math.min((boardW * 0.55) / img.naturalWidth, (boardH * 0.55) / img.naturalHeight, 1);
    const displayW = Math.floor(pieceW * scale);
    const displayH = Math.floor(pieceH * scale);

    const hardMode = document.querySelector('input[name="mode"]:checked').value === 'hard';
    const edges    = generateEdges(cols, rows);
    const pieces   = scatterPieces(actualCount, displayW, displayH, hardMode);

    const meta = { imageData: imageBase64, cols, rows, pieceW, pieceH, displayW, displayH, edges, hardMode };

    setStatus(`Creating ${actualCount}-piece puzzle...`);
    const puzzleId = await createPuzzle(meta, pieces);
    window.location.href = `/puzzle.html?id=${puzzleId}`;
  } catch (err) {
    console.error(err);
    setStatus('Something went wrong. Please try again.', true);
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
