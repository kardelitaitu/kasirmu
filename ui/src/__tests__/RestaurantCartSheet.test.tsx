import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('closes on Escape key press', () => {
    const onClose = vi.fn();

    render(
      withFluent(
        <RestaurantCartSheet open={true} onClose={onClose}>
          <div>Cart</div>
        </RestaurantCartSheet>,
        productsFtl,
      ),
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
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
});
