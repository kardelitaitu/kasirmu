// ── kdsCardColors tests ───────────────────────────────────────────
//
// Covers: DEFAULT_COLORS_DARK/LIGHT structure, contrastText()
// luminance calculation, edge-case hex values, and colour-key
// completeness across both theme palettes.
//
// Pure functions — no React or DOM required.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLORS_DARK,
  DEFAULT_COLORS_LIGHT,
  contrastText,
  type KdsCardColors,
} from '@/features/kds/kdsCardColors';

// ── Helpers ─────────────────────────────────────────────────────────

/** All keys that must exist in a KdsCardColors object. */
const EXPECTED_KEYS: (keyof KdsCardColors)[] = [
  'dinein', 'takeaway', 'rush', 'processing', 'prepared', 'pause', 'resume', 'complete',
];

// ── Structure tests ─────────────────────────────────────────────────

describe('DEFAULT_COLORS_DARK', () => {
  it('contains all required colour keys', () => {
    for (const key of EXPECTED_KEYS) {
      expect(DEFAULT_COLORS_DARK).toHaveProperty(key);
    }
  });

  it('every value is a valid hex colour (#rrggbb)', () => {
    for (const key of EXPECTED_KEYS) {
      expect(DEFAULT_COLORS_DARK[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('DEFAULT_COLORS_LIGHT', () => {
  it('contains all required colour keys', () => {
    for (const key of EXPECTED_KEYS) {
      expect(DEFAULT_COLORS_LIGHT).toHaveProperty(key);
    }
  });

  it('every value is a valid hex colour (#rrggbb)', () => {
    for (const key of EXPECTED_KEYS) {
      expect(DEFAULT_COLORS_LIGHT[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('dark vs light palettes differ', () => {
  it('at least some colours differ between themes', () => {
    const diffs = EXPECTED_KEYS.filter(
      (k) => DEFAULT_COLORS_DARK[k] !== DEFAULT_COLORS_LIGHT[k],
    );
    expect(diffs.length).toBeGreaterThan(0);
  });
});

// ── contrastText() tests ────────────────────────────────────────────

describe('contrastText', () => {
  it('returns dark text for white background', () => {
    expect(contrastText('#ffffff')).toBe('#1a1a1a');
  });

  it('returns light text for black background', () => {
    expect(contrastText('#000000')).toBe('#e6e6e6');
  });

  it('returns light text for green (#22c55e — dark theme dinein)', () => {
    // #22c55e → luminance ≈ 0.535 < 0.55 → dark background → light text
    expect(contrastText('#22c55e')).toBe('#e6e6e6');
  });

  it('returns light text for dark blue (#147EFB — dark theme takeaway)', () => {
    // #147EFB → luminance ≈ 0.40 → dark background → light text
    expect(contrastText('#147EFB')).toBe('#e6e6e6');
  });

  it('returns dark text for 50% grey just above threshold', () => {
    // #999999 → r=g=b=153/255=0.6 → lum=0.6 > 0.55 → dark text
    expect(contrastText('#999999')).toBe('#1a1a1a');
  });

  it('returns light text for dark grey just below threshold', () => {
    // #808080 → r=g=b=128/255≈0.502 → lum≈0.502 < 0.55 → light text
    expect(contrastText('#808080')).toBe('#e6e6e6');
  });

  it('handles hex without # prefix', () => {
    expect(contrastText('ffffff')).toBe('#1a1a1a');
    expect(contrastText('000000')).toBe('#e6e6e6');
  });

  it('handles pure red, green, blue', () => {
    // Red: lum = 0.299 → dark bg → light text
    expect(contrastText('#ff0000')).toBe('#e6e6e6');
    // Green: lum = 0.587 → light bg → dark text
    expect(contrastText('#00ff00')).toBe('#1a1a1a');
    // Blue: lum = 0.114 → dark bg → light text
    expect(contrastText('#0000ff')).toBe('#e6e6e6');
  });
});
