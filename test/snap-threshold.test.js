import { describe, expect, it } from 'vitest';
import { getSnapThreshold } from '../js/snap-threshold.js';

describe('getSnapThreshold', () => {
  it('keeps the 40px floor for typical large pieces', () => {
    expect(getSnapThreshold(100, 100)).toBe(40);
    expect(getSnapThreshold(80, 80)).toBe(40);
  });

  it('scales with piece size when 40% exceeds the floor', () => {
    expect(getSnapThreshold(200, 200)).toBe(80);
  });

  it('never exceeds half a piece on tiny high-count displays', () => {
    // Live puzzle 8ff95ff6-… uses displayW/H = 26 for a 16×16 hard grid.
    expect(getSnapThreshold(26, 26)).toBeCloseTo(13, 6);
    expect(getSnapThreshold(26, 26)).toBeLessThan(26);
  });

  it('uses the smaller side when displayW/H differ', () => {
    expect(getSnapThreshold(26, 40)).toBeCloseTo(13, 6);
  });

  it('falls back safely for invalid sizes', () => {
    expect(getSnapThreshold(0, 0)).toBe(40);
    expect(getSnapThreshold(NaN, 50)).toBe(40);
  });
});
