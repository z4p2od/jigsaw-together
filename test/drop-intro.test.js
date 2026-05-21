import { describe, expect, it } from 'vitest';
import {
  getDropBoxLayout,
  getDropSpawnPosition,
  getDropTiming,
  MAX_DROP_INTRO_PIECES,
  pieceTransform,
  shouldPlayDropIntro,
} from '../js/drop-intro.js';

describe('shouldPlayDropIntro', () => {
  const freshPieces = [{ x: 1, y: 2 }, { x: 3, y: 4 }];

  it('plays on a fresh puzzle', () => {
    expect(shouldPlayDropIntro({
      meta: {},
      pieceStates: freshPieces,
      solvedCount: 0,
    })).toBe(true);
  });

  it('skips when timer already started or puzzle has progress', () => {
    expect(shouldPlayDropIntro({
      meta: { startedAt: Date.now() },
      pieceStates: freshPieces,
      solvedCount: 0,
    })).toBe(false);
    expect(shouldPlayDropIntro({
      meta: {},
      pieceStates: freshPieces,
      solvedCount: 1,
    })).toBe(false);
    expect(shouldPlayDropIntro({
      meta: {},
      pieceStates: [{ groupId: 'g1' }],
      solvedCount: 0,
    })).toBe(false);
  });

  it('skips reduced motion and very large puzzles', () => {
    expect(shouldPlayDropIntro({
      meta: {},
      pieceStates: freshPieces,
      prefersReducedMotion: true,
    })).toBe(false);
    expect(shouldPlayDropIntro({
      meta: {},
      pieceStates: Array.from({ length: MAX_DROP_INTRO_PIECES + 1 }, () => ({})),
      solvedCount: 0,
    })).toBe(false);
  });
});

describe('getDropBoxLayout', () => {
  it('places the box inside the board', () => {
    const layout = getDropBoxLayout({ cols: 5, rows: 5, displayW: 40, displayH: 40 }, 1080, 780);
    expect(layout.boxX).toBeGreaterThanOrEqual(0);
    expect(layout.boxY).toBeGreaterThanOrEqual(0);
    expect(layout.boxX + layout.boxW).toBeLessThanOrEqual(1080);
    expect(layout.mouthY).toBeGreaterThan(layout.boxY);
  });
});

describe('getDropSpawnPosition', () => {
  it('spawns near the box mouth', () => {
    const layout = getDropBoxLayout({ cols: 5, rows: 5, displayW: 40, displayH: 40 }, 1080, 780);
    const a = getDropSpawnPosition(0, layout);
    const b = getDropSpawnPosition(1, layout);
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(0);
    expect(a.y).toBeGreaterThanOrEqual(layout.boxY);
    expect(a.y).toBeLessThanOrEqual(layout.mouthY + layout.displayH);
  });
});

describe('getDropTiming', () => {
  it('keeps total intro under ~4.5s for 100 pieces', () => {
    const { duration, stagger } = getDropTiming(100);
    expect(duration + stagger * 99).toBeLessThanOrEqual(4500);
  });
});

describe('pieceTransform', () => {
  it('includes rotation when non-zero', () => {
    expect(pieceTransform(10, 20, 90, 4)).toContain('rotate(90deg)');
    expect(pieceTransform(10, 20, 0, 4)).not.toContain('rotate');
  });
});
