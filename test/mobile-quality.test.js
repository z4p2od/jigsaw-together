import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeIsMobileLike,
  shouldAutoEnableHQ,
  getTextureScale,
  initHighQualityPreference,
  snapBoardScaleToDevicePixels,
} from '../js/mobile-quality.js';

function installBrowserLikeGlobals(overrides = {}) {
  const matchMediaImpl = vi.fn((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    ...overrides.matchMedia?.(query),
  }));

  const win = {
    devicePixelRatio: 2,
    matchMedia: matchMediaImpl,
    ...overrides.window,
  };
  const nav = {
    userAgent: 'Mozilla/5.0 (Macintosh)',
    deviceMemory: 8,
    hardwareConcurrency: 8,
    ...overrides.navigator,
  };

  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', nav);
}

describe('computeIsMobileLike', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true when pointer is coarse', () => {
    installBrowserLikeGlobals({
      matchMedia: (query) =>
        query.includes('pointer: coarse') ? { matches: true } : {},
    });
    expect(computeIsMobileLike()).toBe(true);
  });

  it('is true for typical mobile UA when pointer not coarse', () => {
    installBrowserLikeGlobals({
      navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', deviceMemory: 8, hardwareConcurrency: 6 },
    });
    expect(computeIsMobileLike()).toBe(true);
  });

  it('is false for desktop UA and fine pointer', () => {
    installBrowserLikeGlobals({});
    expect(computeIsMobileLike()).toBe(false);
  });
});

describe('shouldAutoEnableHQ', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when reduced motion is preferred', () => {
    installBrowserLikeGlobals({
      matchMedia: (query) =>
        query.includes('prefers-reduced-motion') ? { matches: true } : {},
    });
    expect(shouldAutoEnableHQ()).toBe(false);
  });

  it('returns false when DPR < 2', () => {
    installBrowserLikeGlobals({ window: { devicePixelRatio: 1.5 } });
    expect(shouldAutoEnableHQ()).toBe(false);
  });

  it('returns false when cores < 4', () => {
    installBrowserLikeGlobals({ navigator: { hardwareConcurrency: 2, deviceMemory: 8 } });
    expect(shouldAutoEnableHQ()).toBe(false);
  });

  it('returns false when memory < 4 GB reported', () => {
    installBrowserLikeGlobals({ navigator: { deviceMemory: 2, hardwareConcurrency: 8 } });
    expect(shouldAutoEnableHQ()).toBe(false);
  });

  it('returns true for strong desktop-like signals', () => {
    installBrowserLikeGlobals({
      window: { devicePixelRatio: 2 },
      navigator: { deviceMemory: 8, hardwareConcurrency: 8 },
    });
    expect(shouldAutoEnableHQ()).toBe(true);
  });
});

describe('initHighQualityPreference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when not mobile-like', () => {
    expect(initHighQualityPreference(false, () => null)).toBe(true);
  });

  it('respects saved 0/1', () => {
    expect(initHighQualityPreference(true, () => '0')).toBe(false);
    expect(initHighQualityPreference(true, () => '1')).toBe(true);
  });

  it('falls back to shouldAutoEnableHQ when unset', () => {
    installBrowserLikeGlobals({
      window: { devicePixelRatio: 2 },
      navigator: { deviceMemory: 8, hardwareConcurrency: 8 },
    });
    expect(initHighQualityPreference(true, () => null)).toBe(true);
  });
});

describe('getTextureScale', () => {
  beforeEach(() => {
    installBrowserLikeGlobals({ window: { devicePixelRatio: 2 } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('desktop path scales with DPR cap', () => {
    const s = getTextureScale(30, false, true);
    expect(s).toBeGreaterThanOrEqual(1.35);
    expect(s).toBeLessThanOrEqual(2.5);
  });

  it('mobile HQ large puzzle can tighten scale', () => {
    const loose = getTextureScale(250, true, true);
    installBrowserLikeGlobals({
      window: { devicePixelRatio: 2 },
      navigator: { deviceMemory: 2, hardwareConcurrency: 2 },
    });
    const tight = getTextureScale(250, true, true);
    expect(tight).toBeLessThanOrEqual(loose);
  });
});

describe('snapBoardScaleToDevicePixels', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns input when not mobile-like', () => {
    expect(snapBoardScaleToDevicePixels(1.23, false, 800, 600, 0.5, 3, false)).toBe(1.23);
  });

  it('returns input when DPR < 2', () => {
    installBrowserLikeGlobals({ window: { devicePixelRatio: 1 } });
    expect(snapBoardScaleToDevicePixels(1.1, false, 800, 600, 0.5, 3, true)).toBe(1.1);
  });

  it('snaps to near-integer device pixels on mobile high DPR', () => {
    installBrowserLikeGlobals({ window: { devicePixelRatio: 2 } });
    const boardW = 400;
    const s = 1.037;
    const out = snapBoardScaleToDevicePixels(s, false, boardW, 300, 0.5, 3, true);
    const deviceLen = boardW * out * 2;
    expect(Math.abs(deviceLen - Math.round(deviceLen))).toBeLessThan(1e-9);
    expect(out).toBeGreaterThanOrEqual(0.5);
    expect(out).toBeLessThanOrEqual(3);
  });
});
