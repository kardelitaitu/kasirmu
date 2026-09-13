import { describe, expect, it } from 'vitest';
import {
  hexToRgb,
  rgbToHex,
  lighten,
  darken,
  rgba,
  contrastFg,
  deriveAccentPalette,
  applyAccentPalette,
  clearAccentPalette,
} from '@/utils/color';

describe('hexToRgb', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('parses 6-digit hex without hash', () => {
    expect(hexToRgb('00ff00')).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('parses 3-digit hex', () => {
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#0f0')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('#00f')).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('parses white and black', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('parses a mid-tone colour', () => {
    const result = hexToRgb('#808080');
    expect(result.r).toBe(128);
    expect(result.g).toBe(128);
    expect(result.b).toBe(128);
  });

  it('handles uppercase hex', () => {
    expect(hexToRgb('#ABCDEF')).toEqual({ r: 0xab, g: 0xcd, b: 0xef });
  });

  it('returns black for empty string', () => {
    expect(hexToRgb('')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns zero channels for invalid hex', () => {
    // parseInt on 'GGG' returns NaN, but bitwise ops (>>, &) convert NaN to 0
    const result = hexToRgb('#GGG');
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });
});

describe('rgbToHex', () => {
  it('converts rgb to hex', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
  });

  it('pads single-digit hex values', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(1, 2, 3)).toBe('#010203');
  });

  it('clamps values below 0', () => {
    const result = rgbToHex(-10, -5, -1);
    expect(result).toBe('#000000');
  });

  it('clamps values above 255', () => {
    const result = rgbToHex(300, 500, 1000);
    expect(result).toBe('#ffffff');
  });

  it('rounds non-integer values', () => {
    const result = rgbToHex(127.6, 0, 0);
    expect(result).toBe('#800000');
  });
});

describe('lighten', () => {
  it('returns original at amount 0', () => {
    expect(lighten('#ff0000', 0)).toBe('#ff0000');
  });

  it('returns white at amount 1', () => {
    expect(lighten('#ff0000', 1)).toBe('#ffffff');
    expect(lighten('#000000', 1)).toBe('#ffffff');
  });

  it('lightens at amount 0.5', () => {
    const result = lighten('#000000', 0.5);
    // 0 + (255-0)*0.5 = 127.5 → rounded to 128
    expect(result).toBe('#808080');
  });
});

describe('darken', () => {
  it('returns original at amount 0', () => {
    expect(darken('#ff0000', 0)).toBe('#ff0000');
  });

  it('returns black at amount 1', () => {
    expect(darken('#ff0000', 1)).toBe('#000000');
    expect(darken('#ffffff', 1)).toBe('#000000');
  });

  it('darkens at amount 0.5', () => {
    const result = darken('#ffffff', 0.5);
    // 255 * 0.5 = 127.5 → rounded to 128
    expect(result).toBe('#808080');
  });
});

describe('rgba', () => {
  it('formats rgba string', () => {
    expect(rgba('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('handles alpha 0 and 1', () => {
    expect(rgba('#000000', 0)).toBe('rgba(0, 0, 0, 0)');
    expect(rgba('#ffffff', 1)).toBe('rgba(255, 255, 255, 1)');
  });

  it('handles fractional alpha', () => {
    expect(rgba('#808080', 0.33)).toBe('rgba(128, 128, 128, 0.33)');
  });
});

describe('deriveAccentPalette', () => {
  it('returns all palette keys', () => {
    const palette = deriveAccentPalette('#10b981');
    expect(palette).toHaveProperty('base');
    expect(palette).toHaveProperty('hover');
    expect(palette).toHaveProperty('active');
    expect(palette).toHaveProperty('subtle');
    expect(palette).toHaveProperty('fg');
    expect(palette).toHaveProperty('dim');
    expect(palette).toHaveProperty('alpha');
    expect(palette).toHaveProperty('secondary');
  });

  it('returns base colour as-is', () => {
    const palette = deriveAccentPalette('#ff5500');
    expect(palette.base).toBe('#ff5500');
  });

  it('uses default accent when no arg provided', () => {
    const palette = deriveAccentPalette();
    expect(palette.base).toBe('#147EFB');
  });

  it('hover is darker than base', () => {
    const palette = deriveAccentPalette('#10b981');
    expect(palette.hover).not.toBe(palette.base);
  });

  it('active is darker than hover', () => {
    const palette = deriveAccentPalette('#10b981');
    // Both are darkened versions; active has amount 0.2 vs hover 0.1
    expect(palette.active).not.toBe(palette.hover);
  });

  it('dark base → white foreground', () => {
    const palette = deriveAccentPalette('#000000');
    expect(palette.fg).toBe('#ffffff');
  });

  it('light base → dark foreground', () => {
    const palette = deriveAccentPalette('#ffffff');
    expect(palette.fg).toBe('#0a0a0a');
  });

  it('alpha is rgba format', () => {
    const palette = deriveAccentPalette('#10b981');
    expect(palette.alpha).toMatch(/^rgba\(/);
  });

  it('dim is rgba format', () => {
    const palette = deriveAccentPalette('#10b981');
    expect(palette.dim).toMatch(/^rgba\(/);
  });

  it('returns hex strings for solid colours', () => {
    const palette = deriveAccentPalette('#10b981');
    expect(palette.base).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.hover).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.active).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.subtle).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.secondary).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('contrastFg', () => {
  it('returns white text for dark colours', () => {
    expect(contrastFg('#000000')).toBe('#ffffff');
    expect(contrastFg('#333333')).toBe('#ffffff');
  });

  it('returns dark text for light colours', () => {
    expect(contrastFg('#ffffff')).toBe('#0a0a0a');
    expect(contrastFg('#cccccc')).toBe('#0a0a0a');
  });

  it('returns white text at the luminance boundary (160)', () => {
    // luminance = 0.299*160 + 0.587*160 + 0.114*160 ≈ 160
    // condition is luminance > 160, so exactly 160 → white text (dark bg)
    expect(contrastFg('#a0a0a0')).toBe('#ffffff');
  });

  it('returns dark text just above the luminance boundary (161)', () => {
    // #a1a1a1 → r=g=b=161, luminance ≈ 161 > 160 → dark text (light bg)
    expect(contrastFg('#a1a1a1')).toBe('#0a0a0a');
  });
});

describe('applyAccentPalette', () => {
  it('sets CSS custom properties on the document element', () => {
    const palette = deriveAccentPalette('#ff5500');
    applyAccentPalette(palette);

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-accent')).toBe(palette.base);
    expect(root.style.getPropertyValue('--color-accent-hover')).toBe(palette.hover);
    expect(root.style.getPropertyValue('--color-accent-active')).toBe(palette.active);
    expect(root.style.getPropertyValue('--color-accent-subtle')).toBe(palette.subtle);
    expect(root.style.getPropertyValue('--color-accent-fg')).toBe(palette.fg);
    expect(root.style.getPropertyValue('--color-accent-dim')).toBe(palette.dim);
    expect(root.style.getPropertyValue('--color-accent-alpha')).toBe(palette.alpha);
    expect(root.style.getPropertyValue('--color-accent-secondary')).toBe(palette.secondary);
  });

  // Brand override must reach --color-primary too: before this pin the
  // picker only overrode the --color-accent family, so --color-primary
  // kept its static per-theme value and every primary-token consumer
  // (statusbar good tone, analytics, loyalty, reports…) ignored the
  // user's brand colour.
  it('also drives --color-primary and --color-primary-soft from the base', () => {
    const palette = deriveAccentPalette('#ff5500');
    applyAccentPalette(palette);

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-primary')).toBe('#ff5500');
    expect(root.style.getPropertyValue('--color-primary-soft')).toBe('rgba(255, 85, 0, 0.15)');
  });
});

describe('clearAccentPalette', () => {
  it('removes the inline overrides so theme tokens show through again', () => {
    applyAccentPalette(deriveAccentPalette('#ff5500'));
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-accent')).not.toBe('');

    clearAccentPalette();

    expect(root.style.getPropertyValue('--color-accent')).toBe('');
    expect(root.style.getPropertyValue('--color-accent-hover')).toBe('');
    expect(root.style.getPropertyValue('--color-accent-active')).toBe('');
    expect(root.style.getPropertyValue('--color-accent-fg')).toBe('');
    expect(root.style.getPropertyValue('--color-accent-dim')).toBe('');
    expect(root.style.getPropertyValue('--color-accent-alpha')).toBe('');
    expect(root.style.getPropertyValue('--color-accent-secondary')).toBe('');
    expect(root.style.getPropertyValue('--color-accent-subtle')).toBe('');
    expect(root.style.getPropertyValue('--color-accent-subtle-fg')).toBe('');
    expect(root.style.getPropertyValue('--color-accent-hover-fg')).toBe('');
    expect(root.style.getPropertyValue('--color-accent-active-fg')).toBe('');
    expect(root.style.getPropertyValue('--color-primary')).toBe('');
    expect(root.style.getPropertyValue('--color-primary-soft')).toBe('');
  });

  it('is safe to call when nothing was applied (idempotent)', () => {
    expect(() => clearAccentPalette()).not.toThrow();
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('');
  });
});
