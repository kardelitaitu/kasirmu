/**
 * @vitest-environment node
 *
 * This file's import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
// Unit tests for the POS promotions picker eligibility filter (PROMO-5,
// flipped by PROMO-3: every engine kind is selectable at checkout).
import { describe, expect, it } from 'vitest';
import { evaluatePromotionEligibility } from '../features/sales/promotionEligibility';
import type { Promotion } from '../api/promotions';

function promo(overrides: Partial<Promotion>): Promotion {
  return {
    id: 'p1',
    name: 'Test Promo',
    description: '',
    promo_type: 'percentage',
    value_minor: 10,
    min_qty: null,
    trigger_sku: null,
    reward_sku: null,
    reward_qty: null,
    starts_at: null,
    ends_at: null,
    min_order_minor: 0,
    category_id: null,
    active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('evaluatePromotionEligibility', () => {
  it('marks an in-scope percentage promotion eligible', () => {
    const result = evaluatePromotionEligibility([promo({})], 50_000);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'eligible' });
  });

  it('marks fixed_amount and buy_x_get_y eligible (PROMO-3 checkout integration)', () => {
    const result = evaluatePromotionEligibility(
      [promo({ promo_type: 'fixed_amount' }), promo({ promo_type: 'buy_x_get_y' })],
      50_000,
    );
    expect(result.map((r) => r.kind)).toEqual(['eligible', 'eligible']);
  });

  it('rejects percentage promotions whose minimum order exceeds the subtotal', () => {
    const result = evaluatePromotionEligibility([promo({ min_order_minor: 100_000 })], 50_000);
    expect(result[0]).toMatchObject({ kind: 'below-min-order' });
  });

  it('rejects fixed_amount promotions whose minimum order exceeds the subtotal', () => {
    const result = evaluatePromotionEligibility(
      [promo({ promo_type: 'fixed_amount', min_order_minor: 100_000 })],
      50_000,
    );
    expect(result[0]).toMatchObject({ kind: 'below-min-order' });
  });

  it('allows a percentage promotion exactly at its minimum order', () => {
    const result = evaluatePromotionEligibility([promo({ min_order_minor: 50_000 })], 50_000);
    expect(result[0]).toMatchObject({ kind: 'eligible' });
  });

  it('guards against out-of-range percentage values (PROMO-1 backstop)', () => {
    const result = evaluatePromotionEligibility(
      [promo({ value_minor: 0 }), promo({ value_minor: 150 })],
      50_000,
    );
    expect(result.map((r) => r.kind)).toEqual(['invalid-value', 'invalid-value']);
  });
});
