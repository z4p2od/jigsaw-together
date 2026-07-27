import { describe, expect, it } from 'vitest';
import {
  areGridConnected,
  gridOffsetForRotation,
  isConsistentPieceGroup,
  sanitizePieceGroupIds,
} from '../js/puzzle-groups.js';

describe('gridOffsetForRotation', () => {
  it('matches 0° grid steps', () => {
    expect(gridOffsetForRotation(1, 0, 0, 25, 25)).toEqual({ ox: 25, oy: 0 });
    expect(gridOffsetForRotation(0, 1, 0, 25, 30)).toEqual({ ox: 0, oy: 30 });
  });

  it('rotates offsets 90° CW in screen coords', () => {
    // right neighbour (1,0) → visually below at 90°
    const off = gridOffsetForRotation(1, 0, 90, 25, 25);
    expect(off.ox).toBeCloseTo(0, 10);
    expect(off.oy).toBeCloseTo(25, 10);
  });
});

describe('areGridConnected', () => {
  it('accepts a contiguous pair and rejects a diagonal-only pair', () => {
    expect(areGridConnected([0, 1], 3)).toBe(true);
    expect(areGridConnected([0, 4], 3)).toBe(false);
  });
});

describe('isConsistentPieceGroup', () => {
  const cols = 15;
  const dW = 25;
  const dH = 25;

  it('rejects mixed rotations (live bug shape)', () => {
    const pieceStates = [];
    pieceStates[82] = { x: 447.78, y: 336.92, rotation: 180, groupId: 'g' };
    pieceStates[83] = { x: 411.36, y: 413.82, rotation: 0, groupId: 'g' };
    expect(isConsistentPieceGroup(pieceStates, [82, 83], cols, dW, dH)).toBe(false);
  });

  it('accepts aligned same-rotation neighbours', () => {
    const pieceStates = [
      { x: 100, y: 200, rotation: 0, groupId: 'g' },
      { x: 125, y: 200, rotation: 0, groupId: 'g' },
    ];
    expect(isConsistentPieceGroup(pieceStates, [0, 1], cols, dW, dH)).toBe(true);
  });

  it('rejects same rotation but stacked / mis-aligned positions', () => {
    const pieceStates = [
      { x: 100, y: 200, rotation: 0, groupId: 'g' },
      { x: 100, y: 200, rotation: 0, groupId: 'g' },
    ];
    expect(isConsistentPieceGroup(pieceStates, [0, 1], cols, dW, dH)).toBe(false);
  });
});

describe('sanitizePieceGroupIds', () => {
  it('clears groupId on inconsistent members and keeps good groups', () => {
    const cols = 15;
    const pieceStates = Array.from({ length: 100 }, () => ({ x: 0, y: 0, rotation: 0 }));
    pieceStates[0] = { x: 10, y: 10, rotation: 0, groupId: 'good' };
    pieceStates[1] = { x: 35, y: 10, rotation: 0, groupId: 'good' };
    pieceStates[82] = { x: 447, y: 336, rotation: 180, groupId: 'bad' };
    pieceStates[83] = { x: 411, y: 413, rotation: 0, groupId: 'bad' };

    const cleared = sanitizePieceGroupIds(pieceStates, cols, 25, 25);
    expect(cleared.sort((a, b) => a - b)).toEqual([82, 83]);
    expect(pieceStates[0].groupId).toBe('good');
    expect(pieceStates[1].groupId).toBe('good');
    expect(pieceStates[82].groupId).toBeNull();
    expect(pieceStates[83].groupId).toBeNull();
  });

  it('clears orphan single-piece groupIds by default', () => {
    const pieceStates = [{ x: 0, y: 0, rotation: 0, groupId: 'lonely' }];
    const cleared = sanitizePieceGroupIds(pieceStates, 3, 25, 25);
    expect(cleared).toEqual([0]);
    expect(pieceStates[0].groupId).toBeNull();
  });
});
