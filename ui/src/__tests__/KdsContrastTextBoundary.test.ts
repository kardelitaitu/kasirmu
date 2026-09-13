// Unit tests for contrastText — edge cases around the 0.55 luminance
// boundary and unusual hex inputs.
//
// The copy below was byte-for-byte identical to kdsCardColors.ts:65, which is ALREADY
// `export function contrastText` -- so the correct import was available and unused. A
// faithful copy is the worst case for this pattern: it passes today and silently diverges
// on the first edit to the real function, with nothing left to tell the two apart.
// Detected by scripts/verify-test-shadow-copies.py at similarity 1.000.

import { describe, it, expect } from 'vitest';
import { contrastText } from '@/features/kds/kdsCardColors';

describe('contrastText boundaries', () => {
  // Luminance = 0.299*(r/255) + 0.587*(g/255) + 0.114*(b/255)
  // Threshold: lum > 0.55 → dark text, else light text

  it('pure white (#ffffff) → dark text', () => {
    expect(contrastText('#ffffff')).toBe('#1a1a1a');
  });

  it('pure black (#000000) → light text', () => {
    expect(contrastText('#000000')).toBe('#e6e6e6');
  });

  it('pure red (#ff0000) → light text (lum ≈ 0.30)', () => {
    expect(contrastText('#ff0000')).toBe('#e6e6e6');
  });

  it('pure green (#00ff00) → dark text (lum ≈ 0.59)', () => {
    expect(contrastText('#00ff00')).toBe('#1a1a1a');
  });

  it('pure blue (#0000ff) → light text (lum ≈ 0.11)', () => {
    expect(contrastText('#0000ff')).toBe('#e6e6e6');
  });

  it('mid-grey (#808080) → dark text (lum ≈ 0.50)', () => {
    expect(contrastText('#808080')).toBe('#e6e6e6');
  });

  it('light grey (#cccccc) → dark text', () => {
    expect(contrastText('#cccccc')).toBe('#1a1a1a');
  });

  it('dark grey (#333333) → light text', () => {
    expect(contrastText('#333333')).toBe('#e6e6e6');
  });

  it('works without # prefix', () => {
    expect(contrastText('ffffff')).toBe('#1a1a1a');
    expect(contrastText('000000')).toBe('#e6e6e6');
  });

  it('KDS default colors produce correct contrast', () => {
    expect(contrastText('#22c55e')).toBe('#e6e6e6'); // green → light text (lum≈0.53)
    expect(contrastText('#147EFB')).toBe('#e6e6e6'); // blue → light text (lum≈0.42)
    expect(contrastText('#ef4444')).toBe('#e6e6e6'); // red → light text (lum≈0.30)
    expect(contrastText('#f59e0b')).toBe('#1a1a1a'); // amber → dark text (lum≈0.66)
  });
});
