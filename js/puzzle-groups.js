/**
 * Pure helpers for connected-piece group integrity.
 * Used to detect/repair groups that were parented despite mismatched rotation
 * or non-grid-aligned positions (pieces that "don't match").
 */

/** Grid offset of (dc, dr) under a shared piece rotation (screen y-down). */
export function gridOffsetForRotation(dc, dr, rot, displayW, displayH) {
  const dW = displayW;
  const dH = displayH;
  if (rot === 90) return { ox: -dr * dH, oy: dc * dW };
  if (rot === 180) return { ox: -dc * dW, oy: -dr * dH };
  if (rot === 270) return { ox: dr * dH, oy: -dc * dW };
  return { ox: dc * dW, oy: dr * dH };
}

export function areGridConnected(indices, cols) {
  if (!indices?.length) return true;
  const set = new Set(indices);
  const start = indices[0];
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const i = queue.pop();
    const col = i % cols;
    const row = Math.floor(i / cols);
    const neighbours = [];
    if (col > 0) neighbours.push(i - 1);
    if (col < cols - 1) neighbours.push(i + 1);
    if (row > 0) neighbours.push(i - cols);
    neighbours.push(i + cols); // may be outside set; filtered below
    for (const n of neighbours) {
      if (!set.has(n) || seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen.size === set.size;
}

/**
 * A multi-piece group is consistent when every member shares the same rotation,
 * forms one grid-connected component, and sits on the expected relative grid
 * for that rotation (within tolerance px).
 */
export function isConsistentPieceGroup(
  pieceStates,
  indices,
  cols,
  displayW,
  displayH,
  tolerance = 3,
) {
  if (!Array.isArray(indices) || indices.length <= 1) return true;
  if (!(displayW > 0) || !(displayH > 0) || !(cols > 0)) return false;

  const rot0 = Number(pieceStates[indices[0]]?.rotation) || 0;
  for (const i of indices) {
    const rot = Number(pieceStates[i]?.rotation) || 0;
    if (rot !== rot0) return false;
  }

  if (!areGridConnected(indices, cols)) return false;

  const anchor = indices[0];
  const ax = Number(pieceStates[anchor]?.x);
  const ay = Number(pieceStates[anchor]?.y);
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return false;
  const ac = anchor % cols;
  const ar = Math.floor(anchor / cols);

  for (const i of indices) {
    const x = Number(pieceStates[i]?.x);
    const y = Number(pieceStates[i]?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const ic = i % cols;
    const ir = Math.floor(i / cols);
    const { ox, oy } = gridOffsetForRotation(ic - ac, ir - ar, rot0, displayW, displayH);
    if (Math.abs(x - (ax + ox)) > tolerance || Math.abs(y - (ay + oy)) > tolerance) {
      return false;
    }
  }
  return true;
}

/**
 * Clear groupId on members of inconsistent (or orphan size-1) groups.
 * Mutates pieceStates in place; returns indices whose groupId was cleared.
 */
export function sanitizePieceGroupIds(
  pieceStates,
  cols,
  displayW,
  displayH,
  { tolerance = 3, clearOrphans = true } = {},
) {
  const byGroup = new Map();
  pieceStates.forEach((p, i) => {
    if (!p?.groupId) return;
    if (!byGroup.has(p.groupId)) byGroup.set(p.groupId, []);
    byGroup.get(p.groupId).push(i);
  });

  const cleared = [];
  for (const members of byGroup.values()) {
    const inconsistent =
      members.length <= 1
        ? clearOrphans
        : !isConsistentPieceGroup(pieceStates, members, cols, displayW, displayH, tolerance);
    if (!inconsistent) continue;
    for (const i of members) {
      pieceStates[i] = { ...pieceStates[i], groupId: null };
      cleared.push(i);
    }
  }
  return cleared;
}
