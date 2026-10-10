import { describe, expect, it } from 'vitest';
import { bareTableNumber, heldCartLabel, matchesTableBill } from '@/features/sales/utils/tableLabel';

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

describe('heldCartLabel', () => {
  it('does not double the word for a stored name that already carries it', () => {
    // The persisted label is what the open-bill list shows, so this is the one
    // that outlives the screen: it was saved as "Table Table 12".
    expect(heldCartLabel('Table 12', null)).toBe('Table 12');
    expect(heldCartLabel('Table 12', 'Ana')).toBe('Table 12 (Ana)');
  });

  it('still prefixes a table that never carried the word', () => {
    expect(heldCartLabel('A5', null)).toBe('Table A5');
    expect(heldCartLabel('A5', 'Ana')).toBe('Table A5 (Ana)');
  });

  it('falls back to the customer, then to null (the Open Bill #<ts> branch)', () => {
    expect(heldCartLabel(null, 'Ana')).toBe('Ana');
    expect(heldCartLabel('', 'Ana')).toBe('Ana');
    expect(heldCartLabel(null, null)).toBeNull();
    expect(heldCartLabel(undefined, '   ')).toBeNull();
  });

  it('trims the customer name it embeds', () => {
    expect(heldCartLabel('Table 3', '  Ana  ')).toBe('Table 3 (Ana)');
  });
});

describe('matchesTableBill', () => {
  it('matches open bill labels with stored table names', () => {
    expect(matchesTableBill({ label: 'Table 2 (Bapak Budi)' }, 'Table 2')).toBe(true);
    expect(matchesTableBill({ label: 'Table 2' }, 'Table 2')).toBe(true);
    expect(matchesTableBill({ label: 'Table 2 (Bapak Budi)' }, '2')).toBe(true);
  });

  it('prevents substring collisions between similar table numbers', () => {
    expect(matchesTableBill({ label: 'Table 20 (Bapak Budi)' }, 'Table 2')).toBe(false);
    expect(matchesTableBill({ label: 'Table 2 (Bapak Budi)' }, 'Table 20')).toBe(false);
  });

  it('matches customer_name if tab label is custom but customer is table-tagged', () => {
    expect(matchesTableBill({ label: 'Bill #101', customer_name: 'Table 2' }, 'Table 2')).toBe(true);
  });

  it('matches custom table names like VIP 1 or Patio 5', () => {
    expect(matchesTableBill({ label: 'Table VIP 1 (Ana)' }, 'VIP 1')).toBe(true);
    expect(matchesTableBill({ label: 'VIP 1' }, 'VIP 1')).toBe(true);
  });

  it('returns false for falsy or empty inputs', () => {
    expect(matchesTableBill(null, 'Table 2')).toBe(false);
    expect(matchesTableBill({ label: 'Table 2' }, '')).toBe(false);
    expect(matchesTableBill({}, 'Table 2')).toBe(false);
  });
});

