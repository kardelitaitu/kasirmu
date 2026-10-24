// ── The discount row's two fields must not render as twins ──────────────
//
// `.pos-cart-discount-pct` (a number input holding a percentage) and
// `.pos-cart-discount-name` (a free-text optional label) sit side by side in
// `.pos-cart-discount-input-row` and are visually identical:
//
//   pct  : width 3.5rem; padding sm/md; border 1px --color-border; radius md; center
//   name : flex 1; min-width 5rem; padding sm/md; border 1px --color-border; radius md
//
// Same border, same radius, same padding, same `--color-*` tokens -- only the
// width differs. Two DIFFERENT KINDS of field render as twins, so the string a
// cashier types has no cue which box takes a number.
//
// WHY THIS IS A RENDER TEST AND NOT A CSS GREP
//
// Every other stylesheet gate under ui/src/__tests__ reads CSS TEXT: the class
// is declared, the token resolves, the selector is present. None of them can see
// that two classes DECLARE THE SAME THING, because sameness is a comparison, not
// a property of either file's text. This one mounts the real component and
// compares the two elements' className, aria-label and input type.
//
// WHAT THE ASSERTION DISCRIMINATES
//
// Swapping the two className props on the JSX is invisible to a test that only
// asserts `querySelector('.pos-cart-discount-pct')` is truthy -- both still
// mount. Pinning EACH class to its own input type is what makes the swap red.

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/__tests__/a11y/axe-helper';
import { CartFooterTotals } from '@/features/sales/components/CartFooterTotals';
import salesFtl from '@/locales/sales.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { CartLine, LineId, Money, Sku } from '@/types/domain';
import type { CartTaxCacheState } from '@/hooks/useCartTax';

const FTL = [sharedFtl, salesFtl];

const money = (minor: number): Money => ({ minor_units: minor, currency: 'IDR' });

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

function props() {
  return {
    lines: [LINE],
    subtotal: money(50000),
    discountPercent: 0,
    discountLabel: '',
    discountAmount: null,
    showOptions: true,
    setShowOptions: vi.fn(),
    showDiscountInput: true,
    setShowDiscountInput: vi.fn(),
    setShowPromotions: vi.fn(),
    appliedPromotions: [],
    setAppliedPromotions: vi.fn(),
    discountInput: '10',
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
  } as React.ComponentProps<typeof CartFooterTotals>;
}

describe('discount row field distinctness', () => {
  it('mounts both fields, so the assertions below cannot pass vacuously', () => {
    const { container } = renderWithProviders(<CartFooterTotals {...props()} />, ...FTL);
    expect(container.querySelector('.pos-cart-discount-pct')).toBeTruthy();
    expect(container.querySelector('.pos-cart-discount-name')).toBeTruthy();
  });

  // THE GUARD. Each class belongs to ONE input, identified by type -- so a swap
  // of the two className props fails here even though both nodes still mount.
  it('binds the percentage class to the numeric input and the name class to the text input', () => {
    const { container } = renderWithProviders(<CartFooterTotals {...props()} />, ...FTL);
    const pct = container.querySelector<HTMLInputElement>('.pos-cart-discount-pct');
    const name = container.querySelector<HTMLInputElement>('.pos-cart-discount-name');
    expect(pct?.type).toBe('number');
    expect(name?.type).toBe('text');
  });

  it('gives the two fields different accessible names', () => {
    const { container } = renderWithProviders(<CartFooterTotals {...props()} />, ...FTL);
    const pct = container.querySelector('.pos-cart-discount-pct');
    const name = container.querySelector('.pos-cart-discount-name');
    const pctLabel = pct?.getAttribute('aria-label');
    const nameLabel = name?.getAttribute('aria-label');
    // Non-empty, because two empty strings are also 'different is false'
    // but prove nothing.
    expect(pctLabel).toBeTruthy();
    expect(nameLabel).toBeTruthy();
    expect(pctLabel).not.toBe(nameLabel);
  });

  // The finding this file records, as a live assertion: the percentage field
  // carries a hard width while the label field flexes. If both were sized the
  // same, the defect would be back and this case says so by name.
  it('sizes the percentage field fixed and lets the label field take the rest', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/features/sales/CartPanelFooterTotals.css'),
      'utf8',
    );
    const rule = (sel: string) => {
      const i = css.indexOf(`${sel} {`);
      expect(i, `${sel} has no rule in CartPanelFooterTotals.css`).toBeGreaterThan(-1);
      return css.slice(i, css.indexOf('}', i));
    };
    expect(rule('.pos-cart-discount-pct')).toMatch(/width:\s*3\.5rem/);
    expect(rule('.pos-cart-discount-name')).toMatch(/flex:\s*1/);
  });
});
