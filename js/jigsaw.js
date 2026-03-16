// Pure functions — no DOM side effects on import

/**
 * Generate tab/slot edge descriptors for every piece.
 * Each edge value: 0 = flat (border), 1 = tab (protrudes), -1 = slot (indent).
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
        bottom: -hEdges[row + 1][col],
        left:   vEdges[row][col],
        right:  -vEdges[row][col + 1],
      });
    }
  }
  return edges;
}

/**
 * Draw a jigsaw clip path on ctx for a piece of size (w x h) with given edges.
 */
export function drawJigsawPath(ctx, w, h, edges, tabSize, pad) {
  const t = tabSize;

  function jigsawEdge(x1, y1, x2, y2, dir, flip) {
    const mx  = (x1 + x2) / 2;
    const my  = (y1 + y2) / 2;
    const nx  = -(y2 - y1);
    const ny  =  (x2 - x1);
    const len = Math.hypot(nx, ny);
    const unx = nx / len;
    const uny = ny / len;
    const sign = flip * dir;

    if (dir === 0) { ctx.lineTo(x2, y2); return; }

    const bx = mx + unx * t * sign;
    const by = my + uny * t * sign;
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
  jigsawEdge(pad,     pad,     pad + w, pad,     edges.top,    -1);
  jigsawEdge(pad + w, pad,     pad + w, pad + h, edges.right,   1);
  jigsawEdge(pad + w, pad + h, pad,     pad + h, edges.bottom,  1);
  jigsawEdge(pad,     pad + h, pad,     pad,     edges.left,   -1);
  ctx.closePath();
}

/**
 * Cut a single piece from the source image with jigsaw tab shapes.
 * Returns a base64 PNG data URL.
 */
export function cutPiece(img, col, row, pieceW, pieceH, displayW, displayH, edges) {
  const tabSize = Math.round(Math.min(displayW, displayH) * 0.22);
  const pad     = tabSize;
  const canvas  = document.createElement('canvas');
  canvas.width  = displayW + pad * 2;
  canvas.height = displayH + pad * 2;
  const ctx     = canvas.getContext('2d');

  drawJigsawPath(ctx, displayW, displayH, edges, tabSize, pad);
  ctx.save();
  ctx.clip();
  ctx.drawImage(img, col * pieceW, row * pieceH, pieceW, pieceH, pad, pad, displayW, displayH);
  ctx.restore();

  ctx.save();
  drawJigsawPath(ctx, displayW, displayH, edges, tabSize, pad);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();
  ctx.restore();

  return canvas.toDataURL('image/png');
}
