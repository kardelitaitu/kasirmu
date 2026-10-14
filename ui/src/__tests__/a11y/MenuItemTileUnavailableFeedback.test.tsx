// ── An 86'd card must SAY why the tap did nothing ───────────────────────────
//
// MenuItemTile is the card a cashier taps to build an order. For an item the
// kitchen has 86'd, the tile:
//
//   * renders an "86 / Unavailable" badge, so the information EXISTS;
//   * carries aria-disabled but is NOT a disabled button — it stays focusable and
//     clickable on purpose, because the long-press context menu must still offer
//     pin/colour actions;
//   * and its handleClick begins `if (!product.inStock) return;`.
//
// So the tap is deliberately refused and deliberately silent. On a busy service
// that is a DEAD TAP: nothing moves, nothing is announced, nothing is added, and
// the cashier cannot tell an out-of-stock item from a frozen tablet or a missed
// press. The card is also excluded from every :hover/:active rule
// (RestaurantMenu.css:788,795 — `:not(.restaurant-card--disabled)`), so even the
// press feedback a working card gives is absent.
//
// The fix keeps the refusal — an 86'd item must never enter the sale — and adds
// the missing signal: a transient rejected state on the card plus a role="status"
// line, so the cashier learns WHY nothing happened.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from './axe-helper';
import { MenuItemTile } from '@/features/restaurant/components/MenuItemTile';
import productsFtl from '@/locales/products.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { Product } from '@/types/domain';

const FTL = [sharedFtl, productsFtl];

function product(inStock: boolean): Product {
  return {
    sku: 'SKU-1', name: 'Nasi Goreng', category: 'Makanan',
    price: { minor_units: 50000, currency: 'IDR' },
    barcode: null, inStock, stockQty: 0, productType: 'restaurant',
  } as unknown as Product;
}

function renderTile(inStock: boolean, onAdd = vi.fn()) {
  const out = renderWithProviders(
    <MenuItemTile
      product={product(inStock)}
      sourceInStock={inStock}
      pinned={false}
      color={undefined}
      onAdd={onAdd}
      onContextMenu={() => {}}
    />,
    ...FTL,
  );
  const card = out.container.querySelector('.restaurant-card') as HTMLElement;
  return { card, onAdd, out };
}

describe('MenuItemTile unavailable feedback', () => {
  it("still refuses to add an 86'd item", () => {
    const { card, onAdd } = renderTile(false);
    fireEvent.click(card);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('marks the card rejected so the tap is not silent', () => {
    const { card } = renderTile(false);
    expect(card.className).not.toContain('restaurant-card--rejected');
    fireEvent.click(card);
    expect(
      card.className,
      'a refused tap must change the card, or the cashier cannot tell it apart ' +
        'from a frozen tablet. The card is excluded from every hover/active rule, ' +
        'so nothing else would move.',
    ).toContain('restaurant-card--rejected');
  });

  it('announces why the tap was refused', () => {
    const { out } = renderTile(false);
    fireEvent.click(out.container.querySelector('.restaurant-card') as HTMLElement);
    const status = out.container.querySelector('[role="status"]');
    expect(status, 'the reason must be announced, not only drawn').not.toBeNull();
    expect(status?.textContent ?? '').toMatch(/unavailable|out of stock|86/i);
  });

  it('does not mark an available card rejected', () => {
    const { card, onAdd } = renderTile(true);
    fireEvent.click(card);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(card.className).not.toContain('restaurant-card--rejected');
  });
});
