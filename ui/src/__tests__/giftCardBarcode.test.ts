/**
 * @vitest-environment node
 *
 * This file's entire import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
import { describe, expect, it } from 'vitest';
import { isGiftCardBarcode, generateGiftCardNumber } from '@/utils/giftCardBarcode';

describe('isGiftCardBarcode', () => {
  it('accepts valid GC- prefix with 8 chars', () => {
    expect(isGiftCardBarcode('GC-1234ABCD')).toBe(true);
  });

  it('accepts valid GC- prefix with 16 chars', () => {
    expect(isGiftCardBarcode('GC-1234567890ABCDEF')).toBe(true);
  });

  it('accepts 12-char middle segment', () => {
    expect(isGiftCardBarcode('GC-A1B2C3D4E5F6')).toBe(true);
  });

  it('accepts lowercase gc- prefix', () => {
    expect(isGiftCardBarcode('gc-1234abcd')).toBe(true);
  });

  it('trims whitespace before validating', () => {
    expect(isGiftCardBarcode('  GC-1234ABCD  ')).toBe(true);
  });

  it('rejects without GC- prefix', () => {
    expect(isGiftCardBarcode('12345678')).toBe(false);
  });

  it('rejects too-short code (less than 8 chars after GC-)', () => {
    expect(isGiftCardBarcode('GC-1234567')).toBe(false);
  });

  it('rejects too-long code (more than 16 chars after GC-)', () => {
    expect(isGiftCardBarcode('GC-1234567890ABCDEFG')).toBe(false);
  });

  it('rejects special characters inside the code', () => {
    expect(isGiftCardBarcode('GC-1234-5678')).toBe(false);
    expect(isGiftCardBarcode('GC-1234@#$%')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isGiftCardBarcode('')).toBe(false);
  });

  it('rejects whitespace-only', () => {
    expect(isGiftCardBarcode('   ')).toBe(false);
  });
});

describe('generateGiftCardNumber', () => {
  it('generates a valid gift card barcode', () => {
    const code = generateGiftCardNumber();
    expect(isGiftCardBarcode(code)).toBe(true);
  });

  it('generates code with GC- prefix', () => {
    const code = generateGiftCardNumber();
    expect(code.startsWith('GC-')).toBe(true);
  });

  it('generates code of length 15 (GC- + 12 chars)', () => {
    const code = generateGiftCardNumber();
    expect(code.length).toBe(15);
  });

  it('generates unique codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      codes.add(generateGiftCardNumber());
    }
    // All 20 should be unique (extremely unlikely collision with 36^12 space).
    expect(codes.size).toBe(20);
  });

  it('generates only alphanumeric characters after prefix', () => {
    const code = generateGiftCardNumber();
    const body = code.slice(3); // Remove 'GC-'
    expect(/^[A-Z0-9]+$/.test(body)).toBe(true);
  });
});
