//! A11y regression tests for the restaurant cart presentation pair:
//! RestaurantFloatingCartBar (portrait glance bar) and RestaurantCartSheet
//! (the bottom-sheet drawer that hosts the cart in portrait).
//!
//! Both are restaurant-POS-only surfaces (restaurant/POS feature) and neither
//! had axe coverage. The sheet is a modal drawer, so its dialog semantics are
//! graded; the bar is an aside with a single trigger button.

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import { RestaurantFloatingCartBar } from '@/features/restaurant/components/RestaurantFloatingCartBar';
import { RestaurantCartSheet } from '@/features/restaurant/components/RestaurantCartSheet';
import productsFtl from '@/locales/products.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import salesFtl from '@/locales/sales.ftl?raw';
import type { CartLine, LineId, Sku } from '@/types/domain';

const FTL = [sharedFtl, productsFtl, salesFtl];

const LINES: CartLine[] = [
  {
    id: 'line-1' as LineId,
    sku: 'SKU-1' as Sku,
    name: 'Nasi Goreng',
    qty: 2,
    unit_price: { minor_units: 50000, currency: 'IDR' },
  },
];

describe('RestaurantFloatingCartBar a11y', () => {
  it('has no axe violations with items in the cart', async () => {
    const { container } = renderWithProviders(
      <RestaurantFloatingCartBar
        lines={LINES}
        total={{ minor_units: 100000, currency: 'IDR' }}
        tableNumber="12"
        onOpenCart={vi.fn()}
      />,
      ...FTL,
    );
    await checkA11y(container);

    // Vacuity guard + name pin. axe does NOT flag this button when its
    // aria-label is removed, because the visible child text still names it —
    // but the sheet title as a BAR label, not the trigger wording, is what the
    // markup intends, so the attribute is asserted rather than left to axe.
    const bar = container.querySelector('.restaurant-floating-cart-bar');
    expect(bar).toBeTruthy();
    expect(bar!.getAttribute('aria-label')).toBeTruthy();
    const trigger = container.querySelector('.restaurant-floating-cart-trigger') as HTMLElement | null;
    expect(trigger).toBeTruthy();
    expect(trigger!.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('RestaurantCartSheet a11y', () => {
  it('has no axe violations while open', async () => {
    const { container } = renderWithProviders(
      <RestaurantCartSheet open onClose={vi.fn()} tableNumber="12">
        <div>Cart contents</div>
      </RestaurantCartSheet>,
      ...FTL,
    );
    await checkA11y(container);

    // Vacuity guard: the dialog rendered and carries a name.
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute('aria-label')).toBeTruthy();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    expect(container.textContent).toContain('Cart contents');
  });

  it('renders nothing while closed', async () => {
    const { container } = renderWithProviders(
      <RestaurantCartSheet open={false} onClose={vi.fn()}>
        <div>Cart contents</div>
      </RestaurantCartSheet>,
      ...FTL,
    );
    // Not an axe case: the closed sheet must be absent entirely.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
