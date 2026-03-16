// Pure functions — no DOM side effects on import

/**
 * Generate tab/slot edge descriptors for every piece.
 * Each edge value: 0 = flat (border), 1 = tab out, -1 = slot in.
 * Adjacent pieces always have complementary edges.
 */
export function generateEdges(cols, rows) {
  let nextId = 1; // unique ID counter for each shared internal edge

  const hEdges = Array.from({ length: rows + 1 }, (_, r) =>
    Array.from({ length: cols }, () =>
      r === 0 || r === rows
        ? { dir: 0, seed: 0, id: 0 }
        : { dir: Math.random() < 0.5 ? 1 : -1, seed: Math.random() * 1000, id: nextId++ }
    )
  );
  const vEdges = Array.from({ length: rows }, () =>
    Array.from({ length: cols + 1 }, (_, c) =>
      c === 0 || c === cols
        ? { dir: 0, seed: 0, id: 0 }
        : { dir: Math.random() < 0.5 ? 1 : -1, seed: Math.random() * 1000, id: nextId++ }
    )
  );

  const edges = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = hEdges[row][col];
      const b = hEdges[row + 1][col];
      const l = vEdges[row][col];
      const r = vEdges[row][col + 1];
      edges.push({
        top:        t.dir,  bottom:     b.dir,
        left:       l.dir,  right:      r.dir,
        seedTop:    t.seed, seedBottom: b.seed,
        seedLeft:   l.seed, seedRight:  r.seed,
        idTop:      t.id,   idBottom:   b.id,
        idLeft:     l.id,   idRight:    r.id,
      });
    }
  }
  return edges;
}

/**
 * Render one jigsaw edge using 4 cubic bezier curves, inspired by piecemaker.
 *
 * The edge goes from (0,0) to (len,0) in local space.
 * A positive `dir` means the tab protrudes in the +Y direction in local space.
 * After computing the path in local space we transform to world space.
 *
 * @param ctx     Canvas 2D context (current path must already be started)
 * @param x1,y1   Start point in world space
 * @param x2,y2   End point in world space
 * @param dir     +1 = tab protrudes outward, -1 = slot, 0 = flat
 */
// Seeded random — deterministic per edge so both sides match
function seededRand(seed) {
  const x = Math.sin(seed + 1) * 43758.5453;
  return x - Math.floor(x);
}

function drawEdge(ctx, x1, y1, x2, y2, dir, seed) {
  if (dir === 0) {
    ctx.lineTo(x2, y2);
    return;
  }

  const len = Math.hypot(x2 - x1, y2 - y1);
  const ex  = (x2 - x1) / len;
  const ey  = (y2 - y1) / len;
  const nx  = -ey * dir;
  const ny  =  ex * dir;

  function pt(a, p) {
    return [x1 + ex * a + nx * p, y1 + ey * a + ny * p];
  }

  // Randomise proportions using seed so both sides of an edge always match
  const r0 = seededRand(seed);
  const r1 = seededRand(seed + 1);
  const r2 = seededRand(seed + 2);

  // Neck centre offset: ±8% of edge length from centre
  const neckCentre = len * (0.50 + (r0 - 0.5) * 0.16);
  // Neck width: 18–28% of edge length
  const halfNeck   = len * (0.09 + r1 * 0.05);
  const neckL      = neckCentre - halfNeck;
  const neckR      = neckCentre + halfNeck;
  // Tab height: 24–34% of edge length
  const tabH       = len * (0.24 + r2 * 0.10);
  const tabW       = neckR - neckL;
  const r          = tabW / 2;
  const neckH      = len * 0.08;

  const pNL  = pt(neckL, 0);
  const pNLt = pt(neckL, tabH - r);
  const pNRt = pt(neckR, tabH - r);
  const pNR  = pt(neckR, 0);
  const mid  = pt(neckCentre, tabH);

  ctx.lineTo(...pNL);
  ctx.bezierCurveTo(...pt(neckL, neckH), ...pt(neckL, tabH - r), ...pNLt);

  const k = 0.5523;
  ctx.bezierCurveTo(
    ...pt(neckL,             tabH - r + r * k),
    ...pt(neckCentre - r * k, tabH),
    ...mid
  );
  ctx.bezierCurveTo(
    ...pt(neckCentre + r * k, tabH),
    ...pt(neckR,             tabH - r + r * k),
    ...pNRt
  );
  ctx.bezierCurveTo(...pt(neckR, tabH - r), ...pt(neckR, neckH), ...pNR);
  ctx.lineTo(x2, y2);
}

/**
 * Draw a complete jigsaw piece outline as a canvas path.
 * The inner rect of the piece sits at (pad, pad) with size (w × h).
 *
 * Edge sign convention (per piece):
 *   top:    +1 = tab protrudes upward   (outward), -1 = slot inward
 *   bottom: stored value from hEdges; we flip sign because bottom outward = downward
 *   left:   +1 = tab protrudes left,   -1 = slot inward
 *   right:  stored value; we flip sign because right outward = rightward
 */
export function drawJigsawPath(ctx, w, h, edges, pad) {
  const x0 = pad, y0 = pad;
  const x1 = pad + w, y1 = pad + h;

  ctx.beginPath();
  ctx.moveTo(x0, y0);

  drawEdge(ctx, x0, y0, x1, y0,  edges.top,     edges.seedTop);
  drawEdge(ctx, x1, y0, x1, y1, -edges.right,   edges.seedRight);
  drawEdge(ctx, x1, y1, x0, y1, -edges.bottom,  edges.seedBottom);
  drawEdge(ctx, x0, y1, x0, y0,  edges.left,    edges.seedLeft);

  ctx.closePath();
}

/**
 * Cut a single piece from the source image with jigsaw tab shapes.
 * Returns a base64 PNG data URL.
 *
 * The key fix for tab content: we draw the image with a source rect that is
 * LARGER than the piece's own grid cell — it extends by `pad` pixels in each
 * direction (in source image space). This means the tab protrusions, which
 * extend into the pad area, show real image pixels from the neighbouring cells
 * rather than transparent holes.
 */
export function getPad(displayW, displayH) {
  return Math.round(Math.min(displayW, displayH) * 0.38) + 2;
}

export function cutPiece(img, col, row, pieceW, pieceH, displayW, displayH, edges) {
  const pad  = getPad(displayW, displayH);

  const canvasW = displayW + pad * 2;
  const canvasH = displayH + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width  = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  // Source rect in the original image — expanded by pad on all sides
  // so that the tab areas have real image content behind them
  const padSrcX = pad * (pieceW / displayW);  // pad converted back to source pixels
  const padSrcY = pad * (pieceH / displayH);
  const srcX = col * pieceW - padSrcX;
  const srcY = row * pieceH - padSrcY;
  const srcW = pieceW + padSrcX * 2;
  const srcH = pieceH + padSrcY * 2;

  // Clip to jigsaw shape first
  drawJigsawPath(ctx, displayW, displayH, edges, pad);
  ctx.save();
  ctx.clip();

  // Draw the expanded image region — fills the full canvas including tab areas
  ctx.drawImage(
    img,
    srcX, srcY, srcW, srcH,    // source: expanded rect (may go outside image bounds — OK, canvas clips)
    0, 0, canvasW, canvasH     // dest: full canvas
  );

  ctx.restore();

  // Draw border on top
  drawJigsawPath(ctx, displayW, displayH, edges, pad);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  return canvas.toDataURL('image/png');
}
