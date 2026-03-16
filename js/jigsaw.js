// Pure functions — no DOM side effects on import

/**
 * Generate tab/slot edge descriptors for every piece.
 * Each edge value: 0 = flat (border), 1 = tab (protrudes), -1 = slot (indent).
 * Adjacent pieces always have complementary edges.
 */
export function generateEdges(cols, rows) {
  // hEdges[r][c] = shared horizontal edge between row r-1 bottom and row r top
  const hEdges = Array.from({ length: rows + 1 }, (_, r) =>
    Array.from({ length: cols }, () =>
      r === 0 || r === rows ? 0 : (Math.random() < 0.5 ? 1 : -1)
    )
  );
  // vEdges[r][c] = shared vertical edge between col c-1 right and col c left
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
        bottom:  hEdges[row + 1][col],  // same value; neighbour uses opposite sign
        left:   vEdges[row][col],
        right:   vEdges[row][col + 1],  // same value; neighbour uses opposite sign
      });
    }
  }
  return edges;
}

/**
 * Draw a jigsaw piece outline as a clip path.
 *
 * Coordinate system: piece inner rect is at (pad, pad) with size (w x h).
 * Tabs protrude outward into the pad area; slots indent inward.
 *
 * edge direction convention:
 *   top/bottom edges: +1 means tab points UP (out of piece top), -1 means slot dips DOWN (into piece)
 *   BUT we store the raw shared value and apply the correct sign per-side below.
 *
 * For each piece at (col, row):
 *   top edge    sign = +hEdges[row][col]     → positive = tab outward (upward)
 *   bottom edge sign = -hEdges[row+1][col]   → flip: neighbour below has same raw value but we want opposite direction
 *   left edge   sign = +vEdges[row][col]     → positive = tab outward (leftward)
 *   right edge  sign = -vEdges[row][col+1]   → flip
 *
 * Tab shape: two cubic bezier curves forming a smooth rounded bump.
 * The bump is centred on the edge midpoint and extends `t` pixels outward.
 * The neck width is ~40% of the edge length.
 */
export function drawJigsawPath(ctx, w, h, edges, t, pad) {
  // Draw one edge from (x1,y1) to (x2,y2).
  // sign: +1 = tab protrudes in the "outward" direction, -1 = slot, 0 = flat
  // The outward normal direction is given by (nx, ny) (unit vector, already pointing outward)
  function edge(x1, y1, x2, y2, sign, nx, ny) {
    if (sign === 0) {
      ctx.lineTo(x2, y2);
      return;
    }

    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;

    // Edge direction unit vector
    const ex = x2 - x1;
    const ey = y2 - y1;
    const len = Math.hypot(ex, ey);
    const edx = ex / len;
    const edy = ey / len;

    // Neck half-width: how wide the base of the tab is
    const neck = len * 0.18;

    // The 4 key points of the tab shape along the edge
    const p1x = mx - edx * neck;   // left base
    const p1y = my - edy * neck;
    const p2x = mx + edx * neck;   // right base
    const p2y = my + edy * neck;

    // Tab tip — protrudes outward by t * sign
    const tipX = mx + nx * t * sign;
    const tipY = my + ny * t * sign;

    // Control points for smooth bezier curves
    // Curve goes: edge → p1 → (control) → tip → (control) → p2 → edge
    const ctrl1x = p1x + nx * t * sign * 0.8;
    const ctrl1y = p1y + ny * t * sign * 0.8;
    const ctrl2x = p2x + nx * t * sign * 0.8;
    const ctrl2y = p2y + ny * t * sign * 0.8;

    ctx.lineTo(p1x, p1y);
    ctx.bezierCurveTo(ctrl1x, ctrl1y, tipX - edx * neck, tipY - edy * neck, tipX, tipY);
    ctx.bezierCurveTo(tipX + edx * neck, tipY + edy * neck, ctrl2x, ctrl2y, p2x, p2y);
    ctx.lineTo(x2, y2);
  }

  const x0 = pad;
  const y0 = pad;
  const x1 = pad + w;
  const y1 = pad + h;

  ctx.beginPath();
  ctx.moveTo(x0, y0);

  // Top: left→right, outward normal is (0, -1) upward
  // tab when edges.top > 0 means protrude upward
  edge(x0, y0, x1, y0,  edges.top,    0, -1);

  // Right: top→bottom, outward normal is (1, 0) rightward
  // edges.right raw value: positive = protrude right, but we flip for the right side
  edge(x1, y0, x1, y1, -edges.right,  1,  0);

  // Bottom: right→left, outward normal is (0, 1) downward
  // flip bottom
  edge(x1, y1, x0, y1, -edges.bottom, 0,  1);

  // Left: bottom→top, outward normal is (-1, 0) leftward
  edge(x0, y1, x0, y0,  edges.left,  -1,  0);

  ctx.closePath();
}

/**
 * Cut a single piece from the source image with jigsaw tab shapes.
 * Returns a base64 PNG data URL.
 */
export function cutPiece(img, col, row, pieceW, pieceH, displayW, displayH, edges) {
  const t      = Math.round(Math.min(displayW, displayH) * 0.22);
  const pad    = t + 2; // a little extra so the stroke isn't clipped
  const canvas = document.createElement('canvas');
  canvas.width  = displayW + pad * 2;
  canvas.height = displayH + pad * 2;
  const ctx    = canvas.getContext('2d');

  // Clip to jigsaw shape and draw image
  drawJigsawPath(ctx, displayW, displayH, edges, t, pad);
  ctx.save();
  ctx.clip();
  ctx.drawImage(
    img,
    col * pieceW, row * pieceH, pieceW, pieceH,
    pad, pad, displayW, displayH
  );
  ctx.restore();

  // Draw border on top
  drawJigsawPath(ctx, displayW, displayH, edges, t, pad);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  return canvas.toDataURL('image/png');
}
