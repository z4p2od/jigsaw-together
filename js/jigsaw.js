// Pure functions — no DOM side effects on import

/**
 * Generate edge descriptors for every piece.
 * Each shared internal edge gets: dir (+1 tab / -1 slot), seed (0–1), id (unique int).
 * Adjacent pieces always have complementary dirs (+1 on one side, -1 on the other).
 */
export function generateEdges(cols, rows) {
  let nextId = 1;

  const hEdges = Array.from({ length: rows + 1 }, (_, r) =>
    Array.from({ length: cols }, () =>
      r === 0 || r === rows
        ? { dir: 0, seed: 0, id: 0 }
        : { dir: Math.random() < 0.5 ? 1 : -1, seed: Math.random(), id: nextId++ }
    )
  );
  const vEdges = Array.from({ length: rows }, () =>
    Array.from({ length: cols + 1 }, (_, c) =>
      c === 0 || c === cols
        ? { dir: 0, seed: 0, id: 0 }
        : { dir: Math.random() < 0.5 ? 1 : -1, seed: Math.random(), id: nextId++ }
    )
  );

  const edges = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = hEdges[row][col];
      const b = hEdges[row + 1][col];
      const l = vEdges[row][col];
      const r = vEdges[row][col + 1];
      // Store dirs from THIS piece's outward perspective.
      // Shared edge: top piece stores b.dir as its bottom; bottom piece stores -b.dir as its top.
      // Similarly: left piece stores r.dir as its right; right piece stores -r.dir as its left.
      edges.push({
        top:        -t.dir,  bottom:      b.dir,
        left:       -l.dir,  right:       r.dir,
        seedTop:    t.seed,  seedBottom:  b.seed,
        seedLeft:   l.seed,  seedRight:   r.seed,
        idTop:      t.id,    idBottom:    b.id,
        idLeft:     l.id,    idRight:     r.id,
      });
    }
  }
  return edges;
}

export function getPad(displayW, displayH) {
  return Math.ceil(Math.min(displayW, displayH) * 0.32);
}

/**
 * Draw one jigsaw edge from (x1,y1) to (x2,y2).
 *
 * Uses the classic 4-bezier piecemaker approach.
 * dir: +1 = tab protrudes outward, -1 = slot, 0 = flat.
 * seed: 0–1, varies tab height slightly for organic feel.
 *
 * Normal convention: nx = -ey * dir, ny = ex * dir.
 * Caller must negate dir so that outward = away from piece centre.
 */
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

  // Tab height: 28–42% of edge length, varied by seed
  const h = len * (0.28 + seed * 0.14);

  function pt(along, perp) {
    return [x1 + ex * along + nx * perp, y1 + ey * along + ny * perp];
  }

  // 4-bezier classic jigsaw shape (piecemaker proportions)
  const aL  = pt(len * 0.37, 0);
  const aLt = pt(len * 0.37, h * 0.6);
  const aT  = pt(len * 0.50, h);
  const aRt = pt(len * 0.63, h * 0.6);
  const aR  = pt(len * 0.63, 0);

  const c1 = pt(len * 0.20, 0);
  const c2 = pt(len * 0.30, h * 0.6);
  const c3 = pt(len * 0.37, h * 1.1);
  const c4 = pt(len * 0.63, h * 1.1);
  const c5 = pt(len * 0.70, h * 0.6);
  const c6 = pt(len * 0.80, 0);

  ctx.lineTo(...aL);
  ctx.bezierCurveTo(...c1, ...c2, ...aLt);
  ctx.bezierCurveTo(...c3, ...c4, ...aT);
  ctx.bezierCurveTo(...c4, ...c5, ...aRt);
  ctx.bezierCurveTo(...c6, ...aR, ...aR);
  ctx.lineTo(x2, y2);
}

/**
 * Trace the full jigsaw piece outline.
 * Inner rect sits at (pad, pad), size w×h.
 *
 * All edges are negated because drawEdge's normal (-ey*dir, ex*dir) points
 * inward for a CW path. Negating makes +1 = tab protrudes outward:
 *   Top    (L→R): ex=1,ey=0  → normal=(0,+dir)  → negate → tab goes up   ✓
 *   Right  (T→B): ex=0,ey=1  → normal=(-dir,0)  → negate → tab goes right ✓
 *   Bottom (R→L): ex=-1,ey=0 → normal=(0,-dir)  → negate → tab goes down  ✓
 *   Left   (B→T): ex=0,ey=-1 → normal=(+dir,0)  → negate → tab goes left  ✓
 */
export function drawJigsawPath(ctx, w, h, edges, pad) {
  const x0 = pad, y0 = pad;
  const x1 = pad + w, y1 = pad + h;

  ctx.beginPath();
  ctx.moveTo(x0, y0);

  drawEdge(ctx, x0, y0, x1, y0, -edges.top,    edges.seedTop    ?? 0.5);
  drawEdge(ctx, x1, y0, x1, y1, -edges.right,  edges.seedRight  ?? 0.5);
  drawEdge(ctx, x1, y1, x0, y1, -edges.bottom, edges.seedBottom ?? 0.5);
  drawEdge(ctx, x0, y1, x0, y0, -edges.left,   edges.seedLeft   ?? 0.5);

  ctx.closePath();
}

/**
 * Cut a single piece from the source image.
 * The canvas is larger than the piece grid cell to accommodate tab protrusions.
 * The source rect is also expanded so tab areas show real neighbouring pixels.
 */
export function cutPiece(img, col, row, pieceW, pieceH, displayW, displayH, edges) {
  const pad    = getPad(displayW, displayH);
  const canvas = document.createElement('canvas');
  canvas.width  = displayW + pad * 2;
  canvas.height = displayH + pad * 2;
  const ctx    = canvas.getContext('2d');

  const srcPadX = pad * pieceW / displayW;
  const srcPadY = pad * pieceH / displayH;

  drawJigsawPath(ctx, displayW, displayH, edges, pad);
  ctx.save();
  ctx.clip();

  ctx.drawImage(
    img,
    col * pieceW - srcPadX,
    row * pieceH - srcPadY,
    pieceW + srcPadX * 2,
    pieceH + srcPadY * 2,
    0, 0,
    canvas.width, canvas.height
  );
  ctx.restore();

  drawJigsawPath(ctx, displayW, displayH, edges, pad);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  return canvas.toDataURL('image/png');
}
