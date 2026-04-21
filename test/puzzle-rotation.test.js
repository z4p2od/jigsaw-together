import { describe, expect, it } from 'vitest';
import {
  normalizeRotationDeg,
  rotateGroupQuarterTurnCW,
} from '../js/puzzle-rotation.js';

describe('rotateGroupQuarterTurnCW', () => {
  it('rotates each member from its own rotation state', () => {
    const pieceStates = [
      { x: 0, y: 0, rotation: 0 },
      { x: 100, y: 0, rotation: 270 },
    ];

    const rotated = rotateGroupQuarterTurnCW(pieceStates, [0, 1], 100, 100);

    expect(rotated).toHaveLength(2);
    const byIndex = Object.fromEntries(rotated.map((p) => [p.index, p]));

    // Positions become vertical around centroid after quarter-turn.
    expect(byIndex[0].x).toBeCloseTo(50, 6);
    expect(byIndex[0].y).toBeCloseTo(-50, 6);
    expect(byIndex[1].x).toBeCloseTo(50, 6);
    expect(byIndex[1].y).toBeCloseTo(50, 6);

    // Critical regression assertion: do not force one shared absolute rotation.
    expect(byIndex[0].rotation).toBe(90);
    expect(byIndex[1].rotation).toBe(0);
  });

  it('normalizes rotation values', () => {
    expect(normalizeRotationDeg(-90)).toBe(270);
    expect(normalizeRotationDeg(450)).toBe(90);
    expect(normalizeRotationDeg('bad')).toBe(0);
  });
});
