import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { withFluent } from '@/i18n/test-utils';
import productsFtl from '@/locales/products.ftl?raw';
import { RestaurantFloatingCartBar } from '@/features/restaurant/components/RestaurantFloatingCartBar';
import type { CartLine, LineId, Money, Sku } from '@/types/domain';

const IDR: Money = { minor_units: 35000, currency: 'IDR' };

function makeLine(qty: number, name = 'Nasi Goreng'): CartLine {
  return {
    id: 'line-1' as LineId,
    sku: 'NASI-GORENG' as Sku,
    name,
    qty,
    unit_price: IDR,
  };
}

describe('RestaurantFloatingCartBar', () => {
  it('renders correctly with lines, table, and total', () => {
    const onOpenCart = vi.fn();
    const lines = [makeLine(2), makeLine(1, 'Es Teh')];
    const total: Money = { minor_units: 70000, currency: 'IDR' };

    render(
      withFluent(
        <RestaurantFloatingCartBar
          lines={lines}
          total={total}
          tableNumber="4A"
          onOpenCart={onOpenCart}
        />,
        productsFtl,
      ),
    );

    // Total quantity should be 3
    const badge = screen.getByTestId('restaurant-floating-cart-badge');
    expect(badge.textContent).toBe('3');

    // Table pill rendered
    const tableChip = screen.getByTestId('restaurant-floating-cart-table');
    expect(tableChip.textContent).toContain('4A');

    // Clicking trigger fires onOpenCart
    const trigger = screen.getByRole('button', { name: /view order/i });
    fireEvent.click(trigger);
    expect(onOpenCart).toHaveBeenCalledTimes(1);
  });

  it('renders empty cart state when no lines exist', () => {
    const onOpenCart = vi.fn();

    render(
      withFluent(
        <RestaurantFloatingCartBar
          lines={[]}
          total={null}
          onOpenCart={onOpenCart}
        />,
        productsFtl,
      ),
    );

    const badge = screen.getByTestId('restaurant-floating-cart-badge');
    expect(badge.textContent).toBe('0');

    // Should not render table pill
    expect(screen.queryByTestId('restaurant-floating-cart-table')).toBeNull();
  });
});
