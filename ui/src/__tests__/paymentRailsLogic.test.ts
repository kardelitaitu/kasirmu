import { describe, it, expect } from 'vitest';
import {
  CORE_RAIL_CODES,
  isCoreRail,
  sanitizeRailCode,
  mergeCoreRails,
  computeRailsDirty,
  type RawRail,
  type DraftRail,
} from '@/features/restaurant/screens/paymentRailsLogic';

describe('CORE_RAIL_CODES / isCoreRail', () => {
  it('exposes the five core rail codes', () => {
    expect(CORE_RAIL_CODES).toEqual(['cash', 'card', 'qris', 'open_bill', 'credit']);
  });

  it('recognises core codes case-insensitively', () => {
    expect(isCoreRail('CASH')).toBe(true);
    expect(isCoreRail('qris')).toBe(true);
    expect(isCoreRail('Open_Bill')).toBe(true);
  });

  it('rejects non-core codes', () => {
    expect(isCoreRail('gopay')).toBe(false);
    expect(isCoreRail('')).toBe(false);
  });
});

describe('sanitizeRailCode', () => {
  it('trims and lowercases the code', () => {
    expect(sanitizeRailCode('  GoPay  ')).toBe('gopay');
    expect(sanitizeRailCode(' QRIS ')).toBe('qris');
  });

  it('replaces disallowed characters with hyphens', () => {
    expect(sanitizeRailCode('BCA VA')).toBe('bca-va');
    expect(sanitizeRailCode('Gopay!@#')).toBe('gopay---');
  });

  it('keeps alphanumerics, underscores and hyphens', () => {
    expect(sanitizeRailCode('a_b-c_1')).toBe('a_b-c_1');
    expect(sanitizeRailCode('ovo123')).toBe('ovo123');
  });

  it('produces an empty string for all-invalid input', () => {
    expect(sanitizeRailCode('!!!')).toBe('---');
    expect(sanitizeRailCode('')).toBe('');
  });
});

describe('mergeCoreRails', () => {
  const defaultCount = 5;

  it('returns the full core set when no existing rails are present', () => {
    const merged = mergeCoreRails(null);
    expect(merged).toHaveLength(defaultCount);
    expect(merged.map((r) => r.rail_code)).toEqual(['cash', 'card', 'qris', 'open_bill', 'credit']);
    // defaults start enabled with an empty parameters bag
    expect(merged.every((r) => r.is_enabled)).toBe(true);
    expect(merged.every((r) => r.parameters === '{}')).toBe(true);
  });

  it('uses an existing rail when present, keeping its label and state', () => {
    const raw: RawRail[] = [
      { rail_code: 'qris', label: 'My QRIS', is_enabled: false, parameters: '{"x":1}' },
    ];
    const merged = mergeCoreRails(raw);
    const qris = merged.find((r) => r.rail_code === 'qris');
    expect(qris).toEqual({ rail_code: 'qris', label: 'My QRIS', is_enabled: false, parameters: '{"x":1}' });
    // other cores still get defaults
    expect(merged).toHaveLength(defaultCount);
    expect(merged.find((r) => r.rail_code === 'cash')?.label).toBe('Cash');
  });

  it('matches existing rails case-insensitively', () => {
    const raw: RawRail[] = [{ rail_code: 'CARD', label: 'Cards', is_enabled: true, parameters: '{}' }];
    const merged = mergeCoreRails(raw);
    // the matched card keeps its original casing from the source
    expect(merged.find((r) => r.rail_code.toLowerCase() === 'card')?.label).toBe('Cards');
  });

  it('falls back to the core default label when an existing rail has an empty label', () => {
    const raw: RawRail[] = [{ rail_code: 'credit', label: '', is_enabled: true, parameters: '{}' }];
    const merged = mergeCoreRails(raw);
    expect(merged.find((r) => r.rail_code === 'credit')?.label).toBe('Customer Credit');
  });

  it('appends remaining custom rails after the core set, in source order', () => {
    const raw: RawRail[] = [
      { rail_code: 'gopay', label: 'GoPay', is_enabled: true, parameters: '{}' },
      { rail_code: 'ovo', label: 'OVO', is_enabled: false, parameters: '{"a":2}' },
    ];
    const merged = mergeCoreRails(raw);
    expect(merged).toHaveLength(defaultCount + 2);
    expect(merged[defaultCount]!.rail_code).toBe('gopay');
    expect(merged[defaultCount + 1]!.rail_code).toBe('ovo');
    expect(merged[defaultCount + 1]!.parameters).toBe('{"a":2}');
  });

  it('treats missing parameters as an empty bag', () => {
    const raw: RawRail[] = [{ rail_code: 'cash', label: 'Cash', is_enabled: true }];
    const merged = mergeCoreRails(raw);
    expect(merged.find((r) => r.rail_code === 'cash')?.parameters).toBe('{}');
  });

  it('falls back to an empty bag for falsy custom-rail parameters', () => {
    const raw: RawRail[] = [
      { rail_code: 'gopay', label: 'GoPay', is_enabled: true, parameters: '' },
      { rail_code: 'ovo', label: 'OVO', is_enabled: true },
    ];
    const merged = mergeCoreRails(raw);
    expect(merged.find((r) => r.rail_code === 'gopay')?.parameters).toBe('{}');
    expect(merged.find((r) => r.rail_code === 'ovo')?.parameters).toBe('{}');
  });
});

describe('computeRailsDirty', () => {
  const base: DraftRail[] = [
    { rail_code: 'cash', label: 'Cash', is_enabled: true, parameters: '{}' },
    { rail_code: 'qris', label: 'QRIS', is_enabled: true, parameters: '{}' },
  ];
  const copy = (r: DraftRail[]): DraftRail[] =>
    r.map((d) => ({ rail_code: d.rail_code, label: d.label, is_enabled: d.is_enabled, parameters: d.parameters }));

  it('returns false when nothing changed', () => {
    expect(computeRailsDirty(copy(base), copy(base), 'edc1', 'edc1')).toBe(false);
  });

  it('returns true when the default EDC terminal changes', () => {
    expect(computeRailsDirty(copy(base), copy(base), 'edc1', 'edc2')).toBe(true);
  });

  it('returns true when the rail count changes', () => {
    expect(computeRailsDirty(copy(base), copy(base).slice(0, 1), 'edc1', 'edc1')).toBe(true);
  });

  it('returns true when any field of a rail changes', () => {
    const changed = copy(base);
    changed[1] = { ...changed[1], is_enabled: false } as DraftRail;
    expect(computeRailsDirty(copy(base), changed, 'edc1', 'edc1')).toBe(true);

    const relabeled = copy(base);
    relabeled[0] = { ...relabeled[0], label: 'Cash!' } as DraftRail;
    expect(computeRailsDirty(copy(base), relabeled, 'edc1', 'edc1')).toBe(true);

    const reparams = copy(base);
    reparams[0] = { ...reparams[0], parameters: '{"p":1}' } as DraftRail;
    expect(computeRailsDirty(copy(base), reparams, 'edc1', 'edc1')).toBe(true);
  });

  it('returns true when originals are missing at a given index', () => {
    expect(computeRailsDirty([], copy(base), 'edc1', 'edc1')).toBe(true);
  });
});
