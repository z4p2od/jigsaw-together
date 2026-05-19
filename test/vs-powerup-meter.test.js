import { describe, expect, it } from 'vitest';
import {
  applyCharge,
  buildFastSnapSequence,
  buildSlowSnapSequence,
  computeMergeFill,
  isPuzzleComplete,
  nextComboLevel,
  PER_MERGE_CAP,
  pickRandomPowerup,
  simulateGame,
  POWERUP_TYPES,
} from '../js/vs-powerup-meter.js';

describe('computeMergeFill', () => {
  it('scales with merge size and respects per-merge cap', () => {
    const fill = computeMergeFill(2, 100, 1);
    expect(fill).toBeCloseTo(4, 5);
    expect(computeMergeFill(50, 100, 1)).toBe(PER_MERGE_CAP);
  });

  it('applies combo multiplier', () => {
    const base = computeMergeFill(3, 100, 1);
    expect(computeMergeFill(3, 100, 3)).toBeCloseTo(base * 3, 5);
  });
});

describe('nextComboLevel', () => {
  it('resets after combo window', () => {
    expect(nextComboLevel(null, 1000, 3)).toBe(1);
    expect(nextComboLevel(1000, 7000, 3)).toBe(1);
    expect(nextComboLevel(1000, 3000, 1)).toBe(2);
    expect(nextComboLevel(3000, 5000, 2)).toBe(3);
    expect(nextComboLevel(5000, 9000, 3)).toBe(4);
    expect(nextComboLevel(9000, 12000, 4)).toBe(4);
  });
});

describe('applyCharge', () => {
  it('awards when crossing 100 and keeps remainder', () => {
    expect(applyCharge(90, 15)).toEqual({ charge: 5, awards: 1 });
    expect(applyCharge(0, 250)).toEqual({ charge: 50, awards: 2 });
    expect(applyCharge(99, 0)).toEqual({ charge: 99, awards: 0 });
  });

  it('does not award below 100 total charge', () => {
    expect(applyCharge(99, 0.9)).toEqual({ charge: 99.9, awards: 0 });
    expect(applyCharge(99.5, 0.4)).toEqual({ charge: 99.9, awards: 0 });
  });
});

describe('isPuzzleComplete', () => {
  it('detects solved count or single full group', () => {
    expect(isPuzzleComplete({
      solvedCount: 10,
      totalPieces: 10,
      pieceGroup: [],
      groups: {},
    })).toBe(true);

    const fullGroup = { g1: new Set([0, 1, 2]) };
    expect(isPuzzleComplete({
      solvedCount: 0,
      totalPieces: 3,
      pieceGroup: ['g1', 'g1', 'g1'],
      groups: fullGroup,
    })).toBe(true);

    const partialGroup = { g1: new Set([0, 1]) };
    expect(isPuzzleComplete({
      solvedCount: 0,
      totalPieces: 3,
      pieceGroup: ['g1', 'g1', null],
      groups: partialGroup,
    })).toBe(false);
  });
});

describe('pickRandomPowerup', () => {
  it('returns a known type', () => {
    expect(POWERUP_TYPES).toContain(pickRandomPowerup(() => 0.99));
  });
});

describe('pacing simulations', () => {
  it('slow profile earns about 5 powerups', () => {
    const snaps = buildSlowSnapSequence();
    const { totalAwards } = simulateGame(snaps);
    expect(totalAwards).toBeGreaterThanOrEqual(4);
    expect(totalAwards).toBeLessThanOrEqual(6);
  });

  it('fast combo profile earns more than slow', () => {
    const slow = simulateGame(buildSlowSnapSequence()).totalAwards;
    const fast = simulateGame(buildFastSnapSequence()).totalAwards;
    expect(fast).toBeGreaterThanOrEqual(7);
    expect(fast).toBeGreaterThan(slow);
  });

  it('single large merge cannot fill the bar alone at 1× combo', () => {
    expect(computeMergeFill(40, 100, 1)).toBe(PER_MERGE_CAP);
    expect(computeMergeFill(40, 100, 1)).toBeLessThan(100);
    expect(applyCharge(0, computeMergeFill(40, 100, 1)).awards).toBe(0);
  });

  it('skipping finish snap does not add awards', () => {
    const snaps = buildSlowSnapSequence();
    snaps.push({ now: snaps[snaps.length - 1].now + 8000, draggedCount: 5, skipFill: true });
    const withSkip = simulateGame(snaps).totalAwards;
    const without = simulateGame(buildSlowSnapSequence()).totalAwards;
    expect(withSkip).toBe(without);
  });
});
