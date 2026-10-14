// ── Stale tax: what the cart shows vs what gets charged ───────────────
//
// RetailPosScreen computes the payable amount TWICE, with different rules:
//
//   RetailCartPanel.grandTotal()  : cartTaxExclusive && cartTax > 0      (the DISPLAY)
//   PaymentModal's `total` prop   : … && cartTaxFresh                   (the CHARGE)
//
// `cartTaxFresh` is `taxState.cacheFresh`. When the tax cache is stale the two disagree,
// so the cart shows subtotal+tax while the charge is subtotal alone. That is DELIBERATE:
// an unfresh figure is an estimate, and RetailPosScreen.tsx:1047-1050 threads it into
// sales.tax_estimate_note so the sale is flagged for recompute.
//
// What makes it safe rather than a silent undercharge is the ESTIMATE BANNER:
// RetailCartPanel.tsx:385-388 renders `retail-tax-estimate-banner` whenever
// taxSeverity !== 'ok'. These cases pin that pairing, because the two halves are 20
// files apart and the only thing joining them is this test.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(REPO, rel), 'utf-8');

const SCREEN = read('ui/src/features/retail/RetailPosScreen.tsx');
const PANEL = read('ui/src/features/retail/RetailCartPanel.tsx');

describe('stale tax is flagged, and the charge/display gap is deliberate', () => {
  it('the DISPLAY rule and the CHARGE rule differ exactly by cacheFresh', () => {
    // Pin the two spellings so a third one cannot appear quietly: the display adds
    // tax whenever it is exclusive and non-zero, and the charge requires freshness.
    expect(PANEL).toMatch(/if \(!totals\.cartTaxExclusive \|\| totals\.cartTax <= 0\) return base;/);
    expect(SCREEN).toMatch(/cartTaxExclusive && cartTax > 0 && cartTaxFresh/);
  });

  it('the estimate banner is the guard that makes the gap visible', () => {
    // Without this the cart would show a figure the charge does not honour, with
    // nothing on screen saying the tax figure was unverified.
    expect(PANEL).toMatch(/retail-tax-estimate-banner/);
    expect(PANEL).toMatch(/taxSeverity && taxSeverity !== 'ok'/);
    // And the banner must be announced, not decorative.
    expect(PANEL).toMatch(/retail-tax-estimate-banner[^>]*role="status"/s);
  });

  it('the stale-tax flag reaches the SALE, not just the banner', () => {
    // F2-6: an unfresh tax is written to sales.tax_estimate_note so the record can be
    // recomputed later. The charge/display gap is therefore recoverable after the fact.
    expect(SCREEN).toMatch(/taxEstimated/);
    expect(SCREEN).toMatch(/tax_estimate_note/);
  });
});
