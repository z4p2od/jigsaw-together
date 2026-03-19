/**
 * Lobby slot assignment helper.
 *
 * The VS lobby UI has 2 fixed slots (left/right). Previously the code used
 * `Object.keys(players)` ordering, which can change when the second player
 * joins — causing "you" to flip sides.
 *
 * This helper keeps the current user ("playerId") pinned to slot 0 (left) so
 * the UI is stable across snapshots.
 */
export function getLobbySlotPids(players, playerId) {
  const ids = Object.keys(players || {});
  if (ids.length === 0) return [null, null];

  // If the current user is present, always render them in the left slot.
  if (Object.prototype.hasOwnProperty.call(players || {}, playerId)) {
    const oppId = ids.find(id => id !== playerId) ?? null;
    return [playerId, oppId];
  }

  // Fallback: deterministic ordering when playerId isn't in the snapshot.
  const sorted = ids.slice().sort();
  return [sorted[0] ?? null, sorted[1] ?? null];
}

