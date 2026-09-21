import { describe, it, expect } from 'vitest';
import {
  calculateGrid,
  clampGrid,
  resolveGrid,
  describePieceShape,
  formatPuzzleDifficulty,
  defaultTargetPieces,
  MAX_PIECES,
} from '../js/puzzle-grid.js';

describe('calculateGrid', () => {
  it('picks a square grid for a square image', () => {
    expect(calculateGrid(100, 1000, 1000)).toEqual({ cols: 10, rows: 10 });
  });

  it('matches a wide image with more columns than rows', () => {
    const { cols, rows } = calculateGrid(100, 1600, 900);
    expect(cols).toBeGreaterThan(rows);
    expect(cols / rows).toBeCloseTo(1600 / 900, 0);
  });
});

describe('clampGrid', () => {
  it('caps total pieces', () => {
    const { cols, rows } = clampGrid(40, 40);
    expect(cols * rows).toBeLessThanOrEqual(MAX_PIECES);
  });
});

describe('resolveGrid', () => {
  it('uses stored cols×rows so play matches the admin preview', () => {
    expect(resolveGrid({ cols: 12, rows: 7, pieces: 100, width: 1000, height: 1000 }))
      .toEqual({ cols: 12, rows: 7 });
  });

  it('falls back to calculateGrid when axes are missing', () => {
    expect(resolveGrid({ pieces: 100, width: 1000, height: 1000 }))
      .toEqual({ cols: 10, rows: 10 });
  });
});

describe('describePieceShape', () => {
  it('calls out wide cells when there are few columns and many rows', () => {
    expect(describePieceShape(4, 20, 1000, 1000)).toMatch(/wide/i);
  });
});

describe('formatPuzzleDifficulty', () => {
  it('includes the grid when known', () => {
    expect(formatPuzzleDifficulty(84, false, 12, 7)).toBe('12×7 · 84 pieces');
    expect(formatPuzzleDifficulty(84, true, 12, 7)).toBe('12×7 · 84 pieces · rotated');
  });
});

describe('defaultTargetPieces', () => {
  it('assigns a stable ~25 / ~50 / ~100 target from a public id', () => {
    expect(defaultTargetPieces('puzzle-library/a')).toBe(defaultTargetPieces('puzzle-library/a'));
    expect([25, 50, 100]).toContain(defaultTargetPieces('puzzle-library/a'));
  });
});
