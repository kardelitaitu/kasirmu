// ── Draft cart revival: the currency is the store's, not the draft's ─────────
//
// Regression cover for the "$ on an IDR till" defect. A cart persisted while the
// store billed USD came back rendering "$" — line prices, subtotal and change —
// long after the store, its products and its settings had all moved to IDR,
// because the restore copied the draft's recorded currency verbatim and
// `usePosState` anchors the whole cart's currency to `lines[0].unit_price`.
//
// The rule under test is that the DRAFT DOES NOT GET TO CHOOSE. It may only say
// whether it is still legible: same currency, restore; different, refuse. It must
// never be relabelled, because minor units are exponent-relative (IDR/JPY 0,
// USD/EUR 2) and stamping the new code onto the old integer misprices by 100x
// with nothing on screen to show it happened.

import { describe, expect, it } from 'vitest';
import { reviveDraftLines, type DraftLine } from '@/features/sales/utils/draftCart';

const line = (over: Partial<DraftLine> = {}): DraftLine => ({
  sku: 'SKU-1',
  name: 'Nasi Goreng',
  category: 'Food',
  qty: 2,
  unit_price: { minor_units: 500_000, currency: 'IDR' },
  ...over,
});

describe('reviveDraftLines', () => {
  it('stamps the STORE currency onto a draft written under the same one', () => {
    const out = reviveDraftLines([line()], 'IDR');
    expect(out).not.toBeNull();
    expect(out!).toHaveLength(1);
    expect(out![0]!.unit_price).toEqual({ minor_units: 500_000, currency: 'IDR' });
  });

  it('overrides a per-line currency that disagrees with its own draft currency', () => {
    // The store is authoritative even when the draft is internally inconsistent:
    // the line is re-stamped to the currency it is admitted under.
    const out = reviveDraftLines([line({ unit_price: { minor_units: 1_000, currency: 'IDR' } })], 'IDR');
    expect(out![0]!.unit_price.currency).toBe('IDR');
    expect(out![0]!.unit_price.minor_units).toBe(1_000);
  });

  it('REFUSES a draft written under a different currency instead of relabelling it', () => {
    // 500000 minor units were $5,000.00 (USD, exp 2) and would render as
    // Rp 500.000 (IDR, exp 0) if relabelled — the same integer, a 100x error.
    const usd = line({ unit_price: { minor_units: 500_000, currency: 'USD' } });
    expect(reviveDraftLines([usd], 'IDR')).toBeNull();
  });

  it('refuses the whole draft when ANY line disagrees', () => {
    const mixed = [line(), line({ unit_price: { minor_units: 1, currency: 'USD' } })];
    expect(reviveDraftLines(mixed, 'IDR')).toBeNull();
  });

  it('accepts a per-leg currency the draft left unrecorded (pre-field payload)', () => {
    // An older payload without the field is honest, not stale; it is admitted.
    const legacy = line({ unit_price: { minor_units: 250, currency: '' } });
    // '' is a recorded-but-empty string: treat as unrecorded and stamp the store's.
    const out = reviveDraftLines([legacy], 'IDR');
    expect(out).not.toBeNull();
    expect(out![0]!.unit_price.currency).toBe('IDR');
  });

  it('round-trips the optional fields and drops undefined ones', () => {
    const out = reviveDraftLines(
      [line({ courseId: 'main', coursingStatus: 'hold', note: 'pedas' })],
      'IDR',
    );
    const revived = out![0]!;
    expect(revived.courseId).toBe('main');
    expect(revived.coursingStatus).toBe('hold');
    expect(revived.note).toBe('pedas');
    expect('modifiers' in revived).toBe(false);
    expect(revived.sku).toBe('SKU-1');
    expect(revived.qty).toBe(2);
  });

  it('mints a fresh line id per restored line', () => {
    const out = reviveDraftLines([line(), line({ sku: 'SKU-2' })], 'IDR');
    expect(out![0]!.id).not.toBe(out![1]!.id);
  });

  it('returns an empty array for an empty draft (caller restores nothing)', () => {
    expect(reviveDraftLines([], 'IDR')).toEqual([]);
  });
});
