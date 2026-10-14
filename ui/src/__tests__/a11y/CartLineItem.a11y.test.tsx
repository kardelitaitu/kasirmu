//! A11y regression tests for CartLineItem.
//!
//! The cart row is where a restaurant cashier edits a live order — quantity,
//! price override, course, and the "Special Request" note modal. It had no axe
//! coverage. The note textarea in particular was named only by its placeholder,
//! which disappears as soon as the cashier types; this file is what found and
//! now pins that.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders, checkA11y } from './axe-helper';
import { CartLineItem } from '@/features/sales/components/CartLineItem';
import type { CartLine, LineId, Sku } from '@/types/domain';

vi.mock('@/utils/interaction', () => ({
  triggerInteraction: vi.fn(),
}));

const PRICE = { minor_units: 15000, currency: 'IDR' };

function makeLine(): CartLine {
  return {
    id: 'line-1' as LineId,
    sku: 'SKU-1' as Sku,
    name: 'Nasi Goreng',
    qty: 2,
    unit_price: PRICE,
  };
}

function renderItem() {
  return renderWithProviders(
    <CartLineItem
      line={makeLine()}
      onRemove={vi.fn()}
      onDecreaseQty={vi.fn()}
      onIncreaseQty={vi.fn()}
      onUpdateNote={vi.fn()}
    />,
  );
}

describe('CartLineItem a11y', () => {
  it('has no axe violations on the cart row', async () => {
    const { container } = renderItem();
    await checkA11y(container);
    // Vacuity guard: the row's own controls mounted. The modifier button is
    // gated on an `onEditModifiers` prop this harness does not pass, so it is
    // asserted in the note-modal case's sibling coverage rather than here.
    // The row is a labelled group carrying its qty, note and remove controls.
    expect(container.querySelector('[data-testid="cart-line-note-btn"]')).toBeTruthy();
    expect(container.querySelectorAll('[aria-label]').length).toBeGreaterThanOrEqual(5);
  });

  it('has no axe violations with the note modal open', async () => {
    const { container } = renderItem();

    fireEvent.click(container.querySelector('[data-testid="cart-line-note-btn"]')!);
    expect(container.querySelector('[data-testid="cart-line-note-input"]')).toBeTruthy();

    await checkA11y(document.body);

    // Vacuity guard: the textarea is the control this case exists for, and it
    // must carry a real accessible name — not just a placeholder, which vanishes
    // on the first keystroke.
    const note = container.querySelector('[data-testid="cart-line-note-input"]') as HTMLTextAreaElement;
    expect(note.getAttribute('aria-label')).toBeTruthy();
  });
});
