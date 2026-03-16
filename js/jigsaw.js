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
  // Must exceed max tab protrusion: tab is 30% of edge, pad needs to be > that
  return Math.ceil(Math.min(displayW, displayH) * 0.35);
}

/**
 * Draw one jigsaw edge — classic single round-head tab shape.
 *
 * The tab has a narrow neck that widens into a circular head, exactly like
 * a real jigsaw puzzle piece. No double-bumps.
 *
 * dir: +1 = tab protrudes in normal direction, -1 = slot, 0 = flat
 * seed: 0–1, varies the tab size slightly per edge
 */
function drawEdge(ctx, x1, y1, x2, y2, dir, seed) {
  if (dir === 0) {
    ctx.lineTo(x2, y2);
    return;
  }

  const len = Math.hypot(x2 - x1, y2 - y1);
  const ex  = (x2 - x1) / len;
  const ey  = (y2 - y1) / len;
  // Normal points outward when dir=+1 (after caller negates edge dir)
  const nx  = -ey * dir;
  const ny  =  ex * dir;

  function pt(along, perp) {
    return [x1 + ex * along + nx * perp, y1 + ey * along + ny * perp];
  }

  // Tab geometry — all proportional to edge length, varied slightly by seed
  const neckPos    = len * 0.50;                       // neck centre along edge (always centred)
  const neckHalfW  = len * (0.10 + seed * 0.04);      // half-width of neck: 10–14% of len
  const neckH      = len * 0.10;                       // how far neck rises before head
  const headR      = len * (0.14 + seed * 0.04);      // radius of round head: 14–18% of len

  const nL = neckPos - neckHalfW;   // neck left edge along
  const nR = neckPos + neckHalfW;   // neck right edge along
  const headCY = neckH + headR;     // head centre perp distance from base

  // Bezier constant for approximating a circle (4/3 * tan(π/8) ≈ 0.5523)
  const k = 0.5523;

  // Path: straight to neck left, up neck, around circular head, down neck, back to edge
  ctx.lineTo(...pt(nL, 0));
  // Up left side of neck
  ctx.bezierCurveTo(...pt(nL, 0), ...pt(nL, neckH), ...pt(nL, neckH));
  // Around left half of circle
  ctx.bezierCurveTo(
    ...pt(nL,               neckH + headR * k),
    ...pt(neckPos - headR,  headCY),
    ...pt(neckPos - headR,  headCY)
  );
  ctx.bezierCurveTo(
    ...pt(neckPos - headR,  headCY + headR * k),
    ...pt(neckPos - headR * k, headCY + headR),
    ...pt(neckPos,          headCY + headR)
  );
  // Around right half of circle
  ctx.bezierCurveTo(
    ...pt(neckPos + headR * k, headCY + headR),
    ...pt(neckPos + headR,  headCY + headR * k),
    ...pt(neckPos + headR,  headCY)
  );
  ctx.bezierCurveTo(
    ...pt(neckPos + headR,  neckH + headR * k),
    ...pt(nR,               neckH),
    ...pt(nR,               neckH)
  );
  // Down right side of neck
  ctx.bezierCurveTo(...pt(nR, neckH), ...pt(nR, 0), ...pt(nR, 0));
  ctx.lineTo(x2, y2);
}

/**
 * Trace the full jigsaw piece outline.
 * Inner rect sits at (pad, pad), size w×h.
 *
 * All edge dirs are negated because drawEdge's normal (-ey*dir, ex*dir)
 * points inward for a CW path. Negating flips to outward so +1 = tab out.
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
