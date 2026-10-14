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
// ── revenueTotals helper tests (REP-02) ──────────────────────────
import { describe, it, expect } from 'vitest';
import { sumRevenueByCurrency } from '@/features/reports/revenueTotals';

describe('sumRevenueByCurrency', () => {
  it('sums rows within each currency and preserves first-seen order', () => {
    const totals = sumRevenueByCurrency([
      { total_minor: 10000, currency: 'USD' },
      { total_minor: 20000, currency: 'USD' },
      { total_minor: 500000, currency: 'IDR' },
    ]);
    expect(totals).toEqual([
      { currency: 'USD', total_minor: 30000 },
      { currency: 'IDR', total_minor: 500000 },
    ]);
  });

  it('returns a single total for a single-currency period', () => {
    const totals = sumRevenueByCurrency([
      { total_minor: 100, currency: 'USD' },
      { total_minor: 200, currency: 'USD' },
    ]);
    expect(totals).toEqual([{ currency: 'USD', total_minor: 300 }]);
  });

  it('returns an empty array for an empty period', () => {
    expect(sumRevenueByCurrency([])).toEqual([]);
  });
});

// ── REP-04: refund netting totals ────────────────────────────────
import { sumNetRevenueByCurrency } from '@/features/reports/revenueTotals';

describe('sumNetRevenueByCurrency', () => {
  it('sums refunds and net per currency without crossing currencies', () => {
    const totals = sumNetRevenueByCurrency([
      { currency: 'USD', refund_minor: 300, net_revenue_minor: 700 },
      { currency: 'USD', refund_minor: 100, net_revenue_minor: 400 },
      { currency: 'IDR', refund_minor: 50000, net_revenue_minor: 115000 },
    ]);
    expect(totals).toEqual([
      { currency: 'USD', refund_minor: 400, net_revenue_minor: 1100 },
      { currency: 'IDR', refund_minor: 50000, net_revenue_minor: 115000 },
    ]);
  });

  it('keeps negative net visible (refund-only period)', () => {
    const totals = sumNetRevenueByCurrency([
      { currency: 'USD', refund_minor: 400, net_revenue_minor: -400 },
    ]);
    expect(totals[0]).toEqual({ currency: 'USD', refund_minor: 400, net_revenue_minor: -400 });
  });

  it('treats rows without the REP-04 fields as zero', () => {
    const totals = sumNetRevenueByCurrency([{ currency: 'USD' }]);
    expect(totals).toEqual([{ currency: 'USD', refund_minor: 0, net_revenue_minor: 0 }]);
  });
});
