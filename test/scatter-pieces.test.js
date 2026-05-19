import { describe, expect, it } from 'vitest';
import {
  pickFaceDownIndices,
  scatterPieces,
  scatterFromSeed,
  seededRandom,
  FACE_DOWN_FRACTION,
} from '../js/scatter-pieces.js';

describe('pickFaceDownIndices', () => {
  it('picks about 30% of pieces deterministically', () => {
    const rng = seededRandom(42);
    const set = pickFaceDownIndices(100, rng);
    expect(set.size).toBe(Math.ceil(100 * FACE_DOWN_FRACTION));
    const set2 = pickFaceDownIndices(100, seededRandom(42));
    expect([...set].sort()).toEqual([...set2].sort());
  });
});

describe('scatterPieces', () => {
  it('face-down pieces have arbitrary rotation; others follow hardMode', () => {
    const rng = seededRandom(99);
    const pieces = scatterPieces({
      count: 20,
      dispW: 50,
      dispH: 50,
      hardMode: true,
      rng,
    });
    const faceDown = pieces.filter(p => p.faceDown);
    const faceUp = pieces.filter(p => !p.faceDown);
    expect(faceDown.length).toBe(Math.ceil(20 * FACE_DOWN_FRACTION));
    faceDown.forEach(p => {
      expect(p.rotation).toBeGreaterThanOrEqual(0);
      expect(p.rotation).toBeLessThan(360);
    });
    faceUp.forEach(p => {
      expect([0, 90, 180, 270]).toContain(p.rotation);
    });
  });

  it('scatterFromSeed is stable for the same seed', () => {
    const a = scatterFromSeed(12345, 50, 40, 40, false);
    const b = scatterFromSeed(12345, 50, 40, 40, false);
    expect(a).toEqual(b);
  });
});
