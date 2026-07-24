import { describe, expect, it } from 'vitest';
import {
  isPuzzleComplete,
  resetCelebrationEl,
  showCelebrationEl,
  welcomeStartLabel,
} from '../js/puzzle-completion.js';

describe('isPuzzleComplete', () => {
  it('is true when every piece is marked solved', () => {
    expect(isPuzzleComplete({
      solvedCount: 256,
      totalPieces: 256,
      groupedPieceCount: 0,
      activeGroupCount: 0,
    })).toBe(true);
  });

  it('is true when all pieces are in a single group', () => {
    expect(isPuzzleComplete({
      solvedCount: 0,
      totalPieces: 16,
      groupedPieceCount: 16,
      activeGroupCount: 1,
    })).toBe(true);
  });

  it('is false for empty or in-progress boards', () => {
    expect(isPuzzleComplete({
      solvedCount: 0,
      totalPieces: 0,
    })).toBe(false);
    expect(isPuzzleComplete({
      solvedCount: 10,
      totalPieces: 16,
      groupedPieceCount: 10,
      activeGroupCount: 2,
    })).toBe(false);
  });
});

describe('welcomeStartLabel', () => {
  it('uses open-puzzle copy for shared /?id= links', () => {
    expect(welcomeStartLabel(true)).toBe('Open Puzzle');
    expect(welcomeStartLabel(false)).toBe("Play Today's Puzzle");
  });
});

describe('celebration show/hide', () => {
  it('clears inline display:none so .show can win later', () => {
    const celebration = {
      classList: {
        _c: new Set(),
        add(c) { this._c.add(c); },
        remove(c) { this._c.delete(c); },
        contains(c) { return this._c.has(c); },
      },
      style: { display: 'none' },
    };
    const timeEl = { textContent: 'Solved in 1:00' };
    const lbEl = { style: { display: '' } };
    const lbListEl = { innerHTML: '<li>x</li>' };

    resetCelebrationEl(celebration, { timeEl, lbEl, lbListEl });
    expect(celebration.classList.contains('show')).toBe(false);
    expect(celebration.style.display).toBe('');
    expect(timeEl.textContent).toBe('');
    expect(lbEl.style.display).toBe('none');
    expect(lbListEl.innerHTML).toBe('');

    showCelebrationEl(celebration);
    expect(celebration.style.display).toBe('');
    expect(celebration.classList.contains('show')).toBe(true);
  });
});
