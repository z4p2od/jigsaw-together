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
  // Max tab protrusion is neckH + 2*headR ~= 0.36 * edge length (at seed max).
  // Use the larger piece side so wide/tall rectangular pieces never clip tabs.
  return Math.ceil(Math.max(displayW, displayH) * 0.42);
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

  // Classic jigsaw tab: narrow neck widening into a round head.
  // seed (0–1) varies proportions slightly — same seed = same shape on both sides.
  const tabW  = len * (0.15 + seed * 0.08);         // neck width: 15–23% of len
  const nL    = len * 0.50 - tabW / 2;
  const nR    = len * 0.50 + tabW / 2;
  const neckH = len * (0.06 + seed * 0.04);         // neck height: 6–10%
  const headR = len * (0.09 + seed * 0.04);         // head radius: 9–13%
  const headY = neckH + headR;

  const k = 0.5523; // bezier circle approximation constant

  // Ease into neck left with a curved shoulder
  ctx.bezierCurveTo(...pt(nL, 0),     ...pt(nL, neckH),  ...pt(nL, neckH));
  // Left side of circle
  ctx.bezierCurveTo(
    ...pt(nL,           neckH + headR * k),
    ...pt(len*0.5 - headR, headY),
    ...pt(len*0.5 - headR, headY)
  );
  // Top of circle (left half)
  ctx.bezierCurveTo(
    ...pt(len*0.5 - headR, headY + headR * k),
    ...pt(len*0.5 - headR * k, headY + headR),
    ...pt(len*0.5,         headY + headR)
  );
  // Top of circle (right half)
  ctx.bezierCurveTo(
    ...pt(len*0.5 + headR * k, headY + headR),
    ...pt(len*0.5 + headR, headY + headR * k),
    ...pt(len*0.5 + headR, headY)
  );
  // Right side of circle
  ctx.bezierCurveTo(
    ...pt(nR,           neckH + headR * k),
    ...pt(nR,           neckH),
    ...pt(nR,           neckH)
  );
  // Ease out of neck right with a curved shoulder
  ctx.bezierCurveTo(...pt(nR, neckH), ...pt(nR, 0), ...pt(len, 0));
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const srcPadX = pad * pieceW / displayW;
  const srcPadY = pad * pieceH / displayH;
  // Extra bleed on high-DPR displays — 1px was not always enough on 3× iOS after downscale.
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const bleedPx = dpr >= 2 ? 2 : 1;

  drawJigsawPath(ctx, displayW, displayH, edges, pad);
  ctx.save();
  ctx.clip();

  ctx.drawImage(
    img,
    col * pieceW - srcPadX - bleedPx,
    row * pieceH - srcPadY - bleedPx,
    pieceW + srcPadX * 2 + bleedPx * 2,
    pieceH + srcPadY * 2 + bleedPx * 2,
    -bleedPx, -bleedPx,
    canvas.width + bleedPx * 2, canvas.height + bleedPx * 2
  );
  ctx.restore();

  drawJigsawPath(ctx, displayW, displayH, edges, pad);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  const webpUrl = canvas.toDataURL('image/webp', 0.88);
  if (typeof webpUrl === 'string' && webpUrl.startsWith('data:image/webp')) return webpUrl;
  return canvas.toDataURL('image/jpeg', 0.9);
}
