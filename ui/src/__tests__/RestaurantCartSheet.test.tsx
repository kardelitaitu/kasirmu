import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withFluent } from '@/i18n/test-utils';
import productsFtl from '@/locales/products.ftl?raw';
import { RestaurantCartSheet } from '@/features/restaurant/components/RestaurantCartSheet';

// Collapse the exit fade so requestClose runs synchronously;
// the animation itself is covered by useExitAnimation's own tests.
vi.mock('@/hooks/useExitAnimation', () => ({
  useExitAnimation: (open: boolean, onClose: () => void) => ({
    shouldRender: open,
    exiting: false,
    requestClose: () => onClose(),
  }),
}));

describe('RestaurantCartSheet', () => {
  it('renders children, title, and table chip when open', () => {
    const onClose = vi.fn();

    render(
      withFluent(
        <RestaurantCartSheet open={true} onClose={onClose} tableNumber="12">
          <div data-testid="cart-contents">Inner Cart Contents</div>
        </RestaurantCartSheet>,
        productsFtl,
      ),
    );

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByTestId('cart-contents')).toBeDefined();
    expect(screen.getByTestId('restaurant-cart-sheet-table-chip').textContent).toContain('12');

    // Click close button
    const closeBtn = screen.getByTestId('restaurant-cart-sheet-close-btn');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('hides the table chip on a NON-dine-in order, even with a table number set', () => {
    // Same rule as the floating bar beside it, and the same tenth-consumer reason:
    // the chip renders from `tableNumber` alone, and the Table field renders on
    // restaurant POS unconditionally (CartPanel.tsx:898), so a takeaway with a
    // stray number showed a table on the sheet that holds the whole sale.
    render(
      withFluent(
        <RestaurantCartSheet open={true} onClose={vi.fn()} tableNumber="99" orderType="takeaway">
          <div data-testid="cart-contents">Inner Cart Contents</div>
        </RestaurantCartSheet>,
        productsFtl,
      ),
    );
    expect(
      screen.queryByTestId('restaurant-cart-sheet-table-chip'),
      'a takeaway must not show a table chip; it has no table.',
    ).toBeNull();
  });

  it('still shows the chip on a dine-in order', () => {
    render(
      withFluent(
        <RestaurantCartSheet open={true} onClose={vi.fn()} tableNumber="7" orderType="dine_in">
          <div data-testid="cart-contents">Inner Cart Contents</div>
        </RestaurantCartSheet>,
        productsFtl,
      ),
    );
    expect(
      screen.getByTestId('restaurant-cart-sheet-table-chip').textContent?.trim(),
    ).toBe('Table 7');
  });

  it('closes on Escape key press', async () => {
    const onClose = vi.fn();

    render(
      withFluent(
        <RestaurantCartSheet open={true} onClose={onClose}>
          <div>Cart</div>
        </RestaurantCartSheet>,
        productsFtl,
      ),
    );

    // userEvent, not `fireEvent.keyDown(window, ...)`. The sheet used to attach its
    // own listener to `window`; it now delegates Escape to useFocusTrap, which
    // listens on `document` like every other dialog. A window-targeted synthetic
    // event never reaches a document listener, so the old form asserted the OLD
    // implementation's listener target rather than the behaviour. A real key press
    // goes to the focused element and bubbles to document — measured: userEvent
    // gives 1 call, fireEvent-on-window gives 0.
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  // ── Focus management ─────────────────────────────────────────────
  //
  // The sheet declares aria-modal="true", and it is the restaurant POS tablet's
  // whole cart surface. It handled Escape but had no trap and no autofocus, so on
  // a keyboarded tablet focus stayed on the page behind it and Tab walked into the
  // menu that the sheet is covering. Every sibling sales dialog installs
  // useFocusTrap (ItemModifierModal:253, SplitBillModal:37, PromotionsModal:66,
  // RefundModal:176, PriceOverrideModal:176, StockShortfallDialog:115).

  it('moves focus into the sheet when it opens', () => {
    render(
      withFluent(
        <RestaurantCartSheet open={true} onClose={vi.fn()}>
          <button type="button">Inside</button>
        </RestaurantCartSheet>,
        productsFtl,
      ),
    );
    const panel = screen.getByTestId('restaurant-cart-sheet-panel');
    expect(
      panel.contains(document.activeElement),
      'focus must land inside the sheet on open, not stay on the page behind it',
    ).toBe(true);
  });

  it('keeps Tab inside the sheet rather than reaching the menu behind it', async () => {
    const behind = document.createElement('button');
    behind.textContent = 'menu-behind';
    document.body.appendChild(behind);

    render(
      withFluent(
        <RestaurantCartSheet open={true} onClose={vi.fn()}>
          <button type="button">Inside</button>
        </RestaurantCartSheet>,
        productsFtl,
      ),
    );

    for (let i = 0; i < 8; i += 1) {
      await userEvent.tab();
      expect(
        document.activeElement,
        'Tab escaped the sheet and reached the menu it is covering',
      ).not.toBe(behind);
    }
    document.body.removeChild(behind);
  });

  it('does not render when open is false', () => {
    const onClose = vi.fn();

    render(
      withFluent(
        <RestaurantCartSheet open={false} onClose={onClose}>
          <div data-testid="cart-contents">Cart</div>
        </RestaurantCartSheet>,
        productsFtl,
      ),
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('cart-contents')).toBeNull();
  });

  it('normalizes Table/Meja prefix to prevent Table Table doubling', () => {
    const onClose = vi.fn();

    render(
      withFluent(
        <RestaurantCartSheet open={true} onClose={onClose} tableNumber="Table 12">
          <div data-testid="cart-contents">Cart</div>
        </RestaurantCartSheet>,
        productsFtl,
      ),
    );

    const tableChip = screen.getByTestId('restaurant-cart-sheet-table-chip');
    // Fluent produces "Table 12", not "Table Table 12"
    expect(tableChip.textContent?.trim()).toBe('Table 12');
  });
});

