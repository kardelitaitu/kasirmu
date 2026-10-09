import { describe, expect, it } from 'vitest';
import { bareTableNumber } from '@/features/sales/utils/tableLabel';

/**
 * The regression these guard: the product stores table names that ALREADY read
 * "Table 12", and both render sites also prepend the word — so a real restaurant
 * order showed "Table Table 12". Measured on the tablet's store db, 2026-10-09:
 *   tbl-1 | Table 1 | 2 | Main Area
 *   tbl-12 | Table 12 | 6 | VIP Room
 */
describe('bareTableNumber', () => {
  it('strips a leading "Table" word, which is what the stored names carry', () => {
    expect(bareTableNumber('Table 12')).toBe('12');
    expect(bareTableNumber('Table 1')).toBe('1');
  });

  it('leaves an identifier that never carried the word alone', () => {
    expect(bareTableNumber('A5')).toBe('A5');
    expect(bareTableNumber('VIP 2')).toBe('VIP 2');
    expect(bareTableNumber('12')).toBe('12');
  });

  it('strips the word case-insensitively and with a separator', () => {
    expect(bareTableNumber('table 7')).toBe('7');
    expect(bareTableNumber('TABLE 7')).toBe('7');
    expect(bareTableNumber('Table: 7')).toBe('7');
    expect(bareTableNumber('Table-7')).toBe('7');
  });

  it('trims surrounding whitespace', () => {
    expect(bareTableNumber('  Table 12  ')).toBe('12');
  });

  it('does NOT mangle an identifier that merely starts with those letters', () => {
    // "Tabletop 3" is a table named Tabletop, not table 3.
    expect(bareTableNumber('Tabletop 3')).toBe('Tabletop 3');
  });

  it('never returns an empty label', () => {
    // A table literally named "Table" would strip to nothing; the badge must not
    // render blank, so the original is kept.
    expect(bareTableNumber('Table')).toBe('Table');
    expect(bareTableNumber('')).toBe('');
    expect(bareTableNumber('   ')).toBe('');
  });
});
