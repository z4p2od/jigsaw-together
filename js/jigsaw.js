// Pure functions — no DOM side effects on import

/**
 * Generate edge descriptors for every piece.
 * Each shared internal edge gets: dir (+1 tab / -1 blank), seed (shape variation), id (unique).
 * Adjacent pieces share the same edge id and seed but opposite dir.
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
        // dir: +1=tab protrudes outward from this piece, -1=blank (inward)
        // Neighbours always have opposite dir for the shared edge
        top:    t.dir,  bottom:  -b.dir,   // bottom neighbour sees b.dir as its top = opposite
        left:   l.dir,  right:   -r.dir,
        seedTop:    t.seed, seedBottom: b.seed,
        seedLeft:   l.seed, seedRight:  r.seed,
        idTop:  t.id,   idBottom: b.id,
        idLeft: l.id,   idRight:  r.id,
      });
    }
  }
  return edges;
}

export function getPad(displayW, displayH) {
  // Pad must fit the largest possible tab protrusion (30% of min side)
  return Math.ceil(Math.min(displayW, displayH) * 0.32);
}

/**
 * Draw a single puzzle edge from (x1,y1) to (x2,y2).
 *
 * Uses Gemini's simpler 2-bezier approach:
 *   - tabSize = 20% of edge length
 *   - type: +1 = tab (protrudes outward), -1 = blank (inward), 0 = flat
 *
 * The "outward" direction is determined by the normal (nx,ny).
 * seed varies the tab size slightly (0.15–0.25 of length) for organic feel.
 */
function drawEdge(ctx, x1, y1, x2, y2, type, seed) {
  if (type === 0) {
    ctx.lineTo(x2, y2);
    return;
  }

  const len = Math.hypot(x2 - x1, y2 - y1);
  const ex  = (x2 - x1) / len;
  const ey  = (y2 - y1) / len;
  // Outward normal (perpendicular, pointing "out" of the piece for this edge)
  const nx  = -ey;
  const ny  =  ex;

  // Vary tab size per edge using seed for organic look (18%–28% of edge length)
  const tabSize = len * (0.18 + seed * 0.10) * type;  // negative for blank

  function p(along, perp) {
    return [x1 + ex * along + nx * perp, y1 + ey * along + ny * perp];
  }

  // Two cubic beziers — neck then head, matching Gemini's formula
  ctx.bezierCurveTo(
    ...p(len * 0.30, tabSize),
    ...p(len * 0.40, tabSize * 2.5),
    ...p(len * 0.50, tabSize * 2.5)
  );
  ctx.bezierCurveTo(
    ...p(len * 0.60, tabSize * 2.5),
    ...p(len * 0.70, tabSize),
    ...p(len, 0)
  );
}

/**
 * Trace the full jigsaw piece outline as a canvas path.
 * Inner rect sits at (pad, pad), size w×h.
 *
 * Edge direction convention:
 *   top:    +1 = tab protrudes upward (outward = -Y)
 *   right:  +1 = tab protrudes rightward (+X)
 *   bottom: +1 = tab protrudes downward (+Y)
 *   left:   +1 = tab protrudes leftward (-X)
 */
export function drawJigsawPath(ctx, w, h, edges, pad) {
  const x0 = pad, y0 = pad;
  const x1 = pad + w, y1 = pad + h;

  ctx.beginPath();
  ctx.moveTo(x0, y0);

  // Top: left→right, outward = up (-Y), normal already points up when we go left→right
  drawEdge(ctx, x0, y0, x1, y0,  edges.top,    edges.seedTop);
  // Right: top→bottom, outward = right (+X)
  drawEdge(ctx, x1, y0, x1, y1,  edges.right,  edges.seedRight);
  // Bottom: right→left, outward = down (+Y)
  drawEdge(ctx, x1, y1, x0, y1,  edges.bottom, edges.seedBottom);
  // Left: bottom→top, outward = left (-X)
  drawEdge(ctx, x0, y1, x0, y0,  edges.left,   edges.seedLeft);

  ctx.closePath();
}

/**
 * Cut a single piece from the source image.
 *
 * Key: we draw a padded region of the source image so that tab protrusions
 * (which extend beyond the piece's grid cell) contain real image pixels
 * from the neighbouring cells.
 */
export function cutPiece(img, col, row, pieceW, pieceH, displayW, displayH, edges) {
  const pad    = getPad(displayW, displayH);
  const canvas = document.createElement('canvas');
  canvas.width  = displayW + pad * 2;
  canvas.height = displayH + pad * 2;
  const ctx    = canvas.getContext('2d');

  // Draw the expanded source region (includes neighbouring pixels for tabs)
  // Convert pad from display pixels back to source image pixels
  const srcPadX = pad * pieceW / displayW;
  const srcPadY = pad * pieceH / displayH;

  ctx.drawImage(
    img,
    col * pieceW - srcPadX,              // srcX (may be negative — canvas handles it)
    row * pieceH - srcPadY,              // srcY
    pieceW + srcPadX * 2,               // srcW
    pieceH + srcPadY * 2,               // srcH
    0, 0,                                // destX, destY
    canvas.width, canvas.height          // destW, destH
  );

  // Clip to jigsaw shape
  drawJigsawPath(ctx, displayW, displayH, edges, pad);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fill();
  ctx.restore();

  // Subtle inner shadow for depth
  ctx.save();
  drawJigsawPath(ctx, displayW, displayH, edges, pad);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();
  ctx.restore();

  return canvas.toDataURL('image/png');
}
