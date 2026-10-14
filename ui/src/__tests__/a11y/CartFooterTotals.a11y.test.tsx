//! A11y regression tests for CartFooterTotals.
//!
//! The cart footer carries the money controls a restaurant cashier touches on
//! every sale — the collapsible options section, discount entry, the tip
//! segments, the service-charge toggle and the tax preview — and it was the
//! last always-visible POS surface without axe coverage. Mounts with the REAL
//! sales bundle so every control is named from shipped copy.

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import { CartFooterTotals } from '@/features/sales/components/CartFooterTotals';
import salesFtl from '@/locales/sales.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { CartLine, LineId, Money, Sku } from '@/types/domain';
import type { CartTaxCacheState } from '@/hooks/useCartTax';

const FTL = [sharedFtl, salesFtl];

const money = (minor: number): Money => ({ minor_units: minor, currency: 'IDR' });

// The "nothing known yet" tax reading. Built from the real interface rather
// than a string, so a shape change breaks here instead of silently casting.
const IDLE_TAX: CartTaxCacheState = {
  severity: 'unknown',
  taxMinor: 0,
  hasExclusive: null,
  estimated: false,
  cacheFresh: false,
};

const LINE: CartLine = {
  id: 'line-1' as LineId,
  sku: 'SKU-1' as Sku,
  name: 'Nasi Goreng',
  qty: 1,
  unit_price: money(50000),
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    lines: [LINE],
    subtotal: money(50000),
    discountPercent: 0,
    discountLabel: '',
    discountAmount: null,
    showOptions: true,
    setShowOptions: vi.fn(),
    showDiscountInput: false,
    setShowDiscountInput: vi.fn(),
    setShowPromotions: vi.fn(),
    appliedPromotions: [],
    setAppliedPromotions: vi.fn(),
    discountInput: '',
    setDiscountInput: vi.fn(),
    discountName: '',
    setDiscountName: vi.fn(),
    handleApplyDiscount: vi.fn(),
    handleClearDiscount: vi.fn(),
    tipPercent: 0,
    setTipPercent: vi.fn(),
    tipAmount: null,
    serviceChargeEnabled: false,
    serviceChargePercent: 10,
    serviceChargeAmount: null,
    setServiceCharge: vi.fn(),
    cartTax: 0,
    taxEstimated: false,
    taxState: IDLE_TAX,
    retryTaxEstimate: vi.fn(),
    children: null,
    ...overrides,
  } as React.ComponentProps<typeof CartFooterTotals>;
}

describe('CartFooterTotals a11y', () => {
  it('has no axe violations with the totals row expanded', async () => {
    const { container } = renderWithProviders(<CartFooterTotals {...makeProps()} />, ...FTL);
    await checkA11y(container);

    // Vacuity guard: the tip segments and the service-charge switch mounted —
    // the controls this case exists to cover.
    expect(container.querySelectorAll('.pos-cart-tip-segment').length).toBe(4);
    expect(container.querySelector('.pos-cart-service-toggle')).toBeTruthy();
  });

  it('has no axe violations with the discount form open', async () => {
    const { container } = renderWithProviders(
      <CartFooterTotals {...makeProps({ showDiscountInput: true, discountInput: '10' })} />,
      ...FTL,
    );
    await checkA11y(container);

    // Vacuity guard: the discount form's fields and buttons mounted.
    expect(container.querySelector('.pos-cart-discount-pct')).toBeTruthy();
    expect(container.querySelector('.pos-cart-discount-name')).toBeTruthy();
    expect(container.querySelector('.pos-cart-discount-apply')).toBeTruthy();
  });
});
