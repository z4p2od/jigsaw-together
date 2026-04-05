import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateEdges, getPad } from '../js/jigsaw.js';

describe('getPad', () => {
  it('uses 0.42 of the larger display dimension', () => {
    expect(getPad(100, 80)).toBe(Math.ceil(100 * 0.42));
    expect(getPad(50, 200)).toBe(Math.ceil(200 * 0.42));
    expect(getPad(10, 10)).toBe(Math.ceil(10 * 0.42));
  });
});

describe('generateEdges', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns one descriptor per piece', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    expect(generateEdges(3, 4)).toHaveLength(12);
    expect(generateEdges(1, 1)).toHaveLength(1);
  });

  it('has flat outer boundaries (dir 0 on perimeter)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const cols = 3;
    const rows = 4;
    const edges = generateEdges(cols, rows);
    for (let i = 0; i < edges.length; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const e = edges[i];
      if (row === 0) expect(Math.abs(e.top)).toBe(0);
      if (row === rows - 1) expect(Math.abs(e.bottom)).toBe(0);
      if (col === 0) expect(Math.abs(e.left)).toBe(0);
      if (col === cols - 1) expect(Math.abs(e.right)).toBe(0);
    }
  });

  it('pairs opposite faces between neighbours (horizontal)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const cols = 2;
    const rows = 1;
    const [a, b] = generateEdges(cols, rows);
    expect(a.right).toBe(-b.left);
    expect(a.seedRight).toBe(b.seedLeft);
    expect(a.idRight).toBe(b.idLeft);
  });

  it('pairs opposite faces between neighbours (vertical)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    const cols = 1;
    const rows = 2;
    const [topPiece, bottomPiece] = generateEdges(cols, rows);
    expect(topPiece.bottom).toBe(-bottomPiece.top);
    expect(topPiece.seedBottom).toBe(bottomPiece.seedTop);
    expect(topPiece.idBottom).toBe(bottomPiece.idTop);
  });
});
