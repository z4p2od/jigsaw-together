// Pure functions — no DOM side effects on import

/**
 * Generate tab/slot edge descriptors for every piece.
 * Each edge value: 0 = flat (border), 1 = tab out, -1 = slot in.
 * Adjacent pieces always have complementary edges.
 */
export function generateEdges(cols, rows) {
  const hEdges = Array.from({ length: rows + 1 }, (_, r) =>
    Array.from({ length: cols }, () =>
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
        bottom: hEdges[row + 1][col],
        left:   vEdges[row][col],
        right:  vEdges[row][col + 1],
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
function drawEdge(ctx, x1, y1, x2, y2, dir) {
  if (dir === 0) {
    ctx.lineTo(x2, y2);
    return;
  }

  const len = Math.hypot(x2 - x1, y2 - y1);

  // Unit vectors along and perpendicular to the edge
  const ex = (x2 - x1) / len;   // along edge
  const ey = (y2 - y1) / len;
  const nx = -ey * dir;          // normal, pointing outward (sign = dir)
  const ny =  ex * dir;

  // Tab height as fraction of edge length — classic jigsaw proportions
  const h = len * 0.35;

  // Helper: convert local (along, perp) coords to world space
  function pt(along, perp) {
    return [
      x1 + ex * along + nx * perp,
      y1 + ey * along + ny * perp,
    ];
  }

  // Anchor points (along the edge path, based on piecemaker proportions)
  const aL  = pt(len * 0.37, 0);          // left base of tab
  const aLt = pt(len * 0.37, h * 0.6);   // left shoulder
  const aT  = pt(len * 0.50, h);          // tab tip
  const aRt = pt(len * 0.63, h * 0.6);   // right shoulder
  const aR  = pt(len * 0.63, 0);          // right base of tab

  // Control points
  const c1 = pt(len * 0.20, 0);           // ease into left base
  const c2 = pt(len * 0.30, h * 0.6);    // pull up to left shoulder
  const c3 = pt(len * 0.37, h * 1.1);    // overshoot to tip (rounded top)
  const c4 = pt(len * 0.63, h * 1.1);    // overshoot from tip
  const c5 = pt(len * 0.70, h * 0.6);    // pull down to right shoulder
  const c6 = pt(len * 0.80, 0);           // ease into right base

  ctx.lineTo(...aL);
  ctx.bezierCurveTo(...c1, ...c2, ...aLt);
  ctx.bezierCurveTo(...c3, ...c4, ...aT);
  ctx.bezierCurveTo(...c4, ...c5, ...aRt);
  ctx.bezierCurveTo(...c6, ...aR, ...aR);
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

  // Top: left → right, tab protrudes upward (−Y), so outward dir = edges.top
  drawEdge(ctx, x0, y0, x1, y0, edges.top);

  // Right: top → bottom, tab protrudes rightward (+X), flip sign
  drawEdge(ctx, x1, y0, x1, y1, -edges.right);

  // Bottom: right → left, tab protrudes downward (+Y), flip sign
  drawEdge(ctx, x1, y1, x0, y1, -edges.bottom);

  // Left: bottom → top, tab protrudes leftward (−X), dir = edges.left
  drawEdge(ctx, x0, y1, x0, y0, edges.left);

  ctx.closePath();
}

/**
 * Cut a single piece from the source image with jigsaw tab shapes.
 * Returns a base64 PNG data URL.
 */
export function cutPiece(img, col, row, pieceW, pieceH, displayW, displayH, edges) {
  // Tab height is ~35% of piece length, so pad needs to accommodate that
  const tabH = Math.round(Math.min(displayW, displayH) * 0.38);
  const pad  = tabH + 2;

  const canvas = document.createElement('canvas');
  canvas.width  = displayW + pad * 2;
  canvas.height = displayH + pad * 2;
  const ctx = canvas.getContext('2d');

  // Clip to jigsaw shape
  drawJigsawPath(ctx, displayW, displayH, edges, pad);
  ctx.save();
  ctx.clip();

  // Draw image slice
  ctx.drawImage(
    img,
    col * pieceW, row * pieceH, pieceW, pieceH,
    pad, pad, displayW, displayH
  );
  ctx.restore();

  // Draw border
  drawJigsawPath(ctx, displayW, displayH, edges, pad);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  return canvas.toDataURL('image/png');
}
