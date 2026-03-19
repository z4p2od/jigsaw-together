import assert from 'node:assert/strict';
import { getLobbySlotPids } from './vs-lobby-slots.js';

// When the opponent joins, Firebase/object key ordering can change.
// The UI must keep the current user pinned to slot 0 (left).

function testPinnedToLeftEvenIfOppInsertedFirst() {
  const me = 'me';
  const opp = 'opp';

  const players = {};
  // Opponent "inserted" first (object property insertion order).
  players[opp] = { name: 'Opponent', ready: false, color: '#000' };
  players[me] = { name: 'Me', ready: false, color: '#fff' };

  assert.deepEqual(getLobbySlotPids(players, me), [me, opp]);
}

function testFallbackDeterministicWhenMeNotPresent() {
  const players = {};
  players['b'] = { name: 'B' };
  players['a'] = { name: 'A' };

  assert.deepEqual(getLobbySlotPids(players, 'me-missing'), ['a', 'b']);
}

function testOnlyMe() {
  const me = 'me';
  const players = { [me]: { name: 'Me', ready: true, color: '#fff' } };
  assert.deepEqual(getLobbySlotPids(players, me), [me, null]);
}

testPinnedToLeftEvenIfOppInsertedFirst();
testFallbackDeterministicWhenMeNotPresent();
testOnlyMe();

console.log('vs-lobby-slots: all tests passed');

