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
import { isSaleBarcode } from '@/utils/saleBarcode';

describe('isSaleBarcode', () => {
  it('accepts a valid UUID v4 format', () => {
    expect(isSaleBarcode('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts uppercase UUID', () => {
    expect(isSaleBarcode('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('accepts mixed-case UUID', () => {
    expect(isSaleBarcode('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
  });

  it('trims whitespace', () => {
    expect(isSaleBarcode('  550e8400-e29b-41d4-a716-446655440000  ')).toBe(true);
  });

  it('rejects missing hyphens', () => {
    expect(isSaleBarcode('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('rejects wrong segment lengths', () => {
    expect(isSaleBarcode('550e8400-e29b-41d4-a716-44665544000')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isSaleBarcode('550e8400-e29b-41d4-a716-44665544000g')).toBe(false);
    expect(isSaleBarcode('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toBe(false);
  });

  it('rejects extra segments', () => {
    expect(isSaleBarcode('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isSaleBarcode('')).toBe(false);
  });

  it('rejects whitespace-only', () => {
    expect(isSaleBarcode('   ')).toBe(false);
  });

  it('rejects random text', () => {
    expect(isSaleBarcode('not-a-barcode')).toBe(false);
    expect(isSaleBarcode('hello world')).toBe(false);
    expect(isSaleBarcode('12345')).toBe(false);
  });
});
