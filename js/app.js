import { createPuzzle } from './firebase.js';

const fileInput   = document.getElementById('file-input');
const uploadZone  = document.getElementById('upload-zone');
const placeholder = document.getElementById('upload-placeholder');
const preview     = document.getElementById('preview');
const createBtn   = document.getElementById('create-btn');
const statusEl    = document.getElementById('status');

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

let imageBase64 = null; // stored without data: prefix

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

// ── Edge map generation ───────────────────────────────────────────────────────

/**
 * Generate tab/slot edge descriptors for every piece.
 * Each edge value: 0 = flat (border), 1 = tab (protrudes), -1 = slot (indent).
 * Adjacent pieces always have complementary edges.
 *
 * Returns an array of length cols*rows, each entry: { top, right, bottom, left }
 */
function generateEdges(cols, rows) {
  // Store shared edge values: hEdges[row][col] = value between row-1 and row
  // vEdges[row][col] = value between col-1 and col
  const hEdges = Array.from({ length: rows + 1 }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      r === 0 || r === rows ? 0 : (Math.random() < 0.5 ? 1 : -1)
    )
  );
  const vEdges = Array.from({ length: rows }, () =>
    Array.from({ length: cols + 1 }, (_, c) =>
      c === 0 || c === cols ? 0 : (Math.random() < 0.5 ? 1 : -1)
    )
  );

  const edges = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      edges.push({
        top:    hEdges[row][col],
        bottom: -hEdges[row + 1][col],   // complement of the shared edge below
        left:   vEdges[row][col],
        right:  -vEdges[row][col + 1],   // complement of the shared edge to the right
      });
    }
  }
  return edges;
}

// ── Jigsaw path drawing ───────────────────────────────────────────────────────

/**
 * Draw a jigsaw clip path on ctx for a piece of size (w x h) with given edges.
 * tabSize controls how large the tabs/slots are.
 * The path is offset by (pad, pad) to leave room for outward tabs.
 */
function drawJigsawPath(ctx, w, h, edges, tabSize, pad) {
  const t = tabSize;

  // Helper: draw one edge with a tab (+1) or slot (-1) or flat (0)
  // from point (x1,y1) to (x2,y2), bulge perpendicular by direction * t
  function jigsawEdge(x1, y1, x2, y2, dir, flip) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const nx = -(y2 - y1); // normal
    const ny =  (x2 - x1);
    const len = Math.hypot(nx, ny);
    const unx = nx / len;
    const uny = ny / len;
    const sign = flip * dir;

    if (dir === 0) {
      ctx.lineTo(x2, y2);
      return;
    }

    // Tab/slot as a smooth bezier bump
    const bx = mx + unx * t * sign;
    const by = my + uny * t * sign;

    // Width of the tab neck
    const neckFrac = 0.3;
    const n1x = mx + (x1 - mx) * neckFrac * 2 + unx * t * sign * 0.4;
    const n1y = my + (y1 - my) * neckFrac * 2 + uny * t * sign * 0.4;
    const n2x = mx + (x2 - mx) * neckFrac * 2 + unx * t * sign * 0.4;
    const n2y = my + (y2 - my) * neckFrac * 2 + uny * t * sign * 0.4;

    const q1x = mx + (x1 - mx) * neckFrac;
    const q1y = my + (y1 - my) * neckFrac;
    const q2x = mx + (x2 - mx) * neckFrac;
    const q2y = my + (y2 - my) * neckFrac;

    ctx.lineTo(q1x, q1y);
    ctx.bezierCurveTo(n1x, n1y, bx + unx * t * sign * 0.5, by + uny * t * sign * 0.5, bx, by);
    ctx.bezierCurveTo(bx + unx * t * sign * 0.5, by + uny * t * sign * 0.5, n2x, n2y, q2x, q2y);
    ctx.lineTo(x2, y2);
  }

  ctx.beginPath();
  ctx.moveTo(pad, pad);

  // Top edge (left to right): outward = negative Y = flip -1
  jigsawEdge(pad, pad, pad + w, pad, edges.top, -1);
  // Right edge (top to bottom): outward = positive X = flip +1
  jigsawEdge(pad + w, pad, pad + w, pad + h, edges.right, 1);
  // Bottom edge (right to left): outward = positive Y = flip +1
  jigsawEdge(pad + w, pad + h, pad, pad + h, edges.bottom, 1);
  // Left edge (bottom to top): outward = negative X = flip -1
  jigsawEdge(pad, pad + h, pad, pad, edges.left, -1);

  ctx.closePath();
}

// ── Piece cutting ─────────────────────────────────────────────────────────────

/**
 * Cut a single piece from the source image with jigsaw tab shapes.
 * Returns a base64 data URL.
 */
function cutPiece(img, col, row, pieceW, pieceH, displayW, displayH, edges) {
  const tabSize = Math.round(Math.min(displayW, displayH) * 0.22);
  const pad     = tabSize;
  const canvasW = displayW + pad * 2;
  const canvasH = displayH + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width  = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  // Draw jigsaw clip path
  drawJigsawPath(ctx, displayW, displayH, edges, tabSize, pad);
  ctx.save();
  ctx.clip();

  // Draw the image slice (offset by pad so the image sits in the centre of the padded canvas)
  ctx.drawImage(
    img,
    col * pieceW, row * pieceH, pieceW, pieceH,   // source rect
    pad, pad, displayW, displayH                   // dest rect
  );

  ctx.restore();

  // Subtle piece border
  ctx.save();
  drawJigsawPath(ctx, displayW, displayH, edges, tabSize, pad);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  return canvas.toDataURL('image/png');
}

// ── Scatter pieces ────────────────────────────────────────────────────────────

function scatterPieces(count, pieceW, pieceH) {
  const boardW = 900;
  const boardH = 650;
  return Array.from({ length: count }, () => ({
    x: Math.random() * (boardW - pieceW),
    y: Math.random() * (boardH - pieceH),
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

    const edges = generateEdges(cols, rows);
    const pieces = scatterPieces(actualCount, pieceW, pieceH);

    const meta = {
      imageData: imageBase64,
      cols,
      rows,
      pieceW,
      pieceH,
      edges,
    };

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

// Export cutPiece and tabSize calculation for use in puzzle.js
export { cutPiece, generateEdges };
