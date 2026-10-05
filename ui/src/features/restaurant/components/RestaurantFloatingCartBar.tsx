import { useMemo } from 'react';
import { useLocalization } from '@fluent/react';
import { formatMoney, type CartLine, type Money } from '@/types/domain';
import './RestaurantFloatingCartBar.css';

export interface RestaurantFloatingCartBarProps {
  lines: CartLine[];
  total: Money | null;
  tableNumber?: string;
  onOpenCart: () => void;
}

/**
 * Floating Cart Bar for Restaurant POS in portrait orientation.
 *
 * Sits elevated at the bottom of the viewport so waitstaff can easily
 * glance at item count, assigned table, and running total, and tap to
 * slide up the full CartPanel bottom sheet.
 */
export function RestaurantFloatingCartBar({
  lines,
  total,
  tableNumber,
  onOpenCart,
}: RestaurantFloatingCartBarProps) {
  const { l10n } = useLocalization();

  const totalQty = useMemo(
    () => lines.reduce((sum, line) => sum + line.qty, 0),
    [lines],
  );

  const formattedTotal = total
    ? formatMoney(total)
    : formatMoney({ minor_units: 0, currency: 'IDR' });

  return (
    <aside
      className="restaurant-floating-cart-bar"
      aria-label={l10n.getString('restaurant-cart-sheet-title')}
    >
      <button
        type="button"
        className="restaurant-floating-cart-trigger"
        onClick={onOpenCart}
        aria-label={l10n.getString('restaurant-cart-view-order')}
      >
        <div className="restaurant-floating-cart-left">
          <div className="restaurant-floating-cart-bag-wrap">
            <svg
              className="restaurant-floating-cart-bag-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 2 4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6l-2-4H6z" />
              <path d="M4 6h16" />
              <path d="M9 10V8a3 3 0 0 1 6 0v2" />
            </svg>
            <span
              className="restaurant-floating-cart-badge"
              data-testid="restaurant-floating-cart-badge"
            >
              {totalQty}
            </span>
          </div>

          <div className="restaurant-floating-cart-info">
            <span className="restaurant-floating-cart-count">
              {totalQty === 0
                ? l10n.getString('restaurant-cart-empty')
                : l10n.getString('restaurant-cart-items-count', { count: totalQty })}
            </span>
            {tableNumber && (
              <span
                className="restaurant-floating-cart-table-pill"
                data-testid="restaurant-floating-cart-table"
              >
                {l10n.getString('restaurant-cart-table-badge', { table: tableNumber })}
              </span>
            )}
          </div>
        </div>

        <div className="restaurant-floating-cart-right">
          <span
            className="restaurant-floating-cart-total"
            data-testid="restaurant-floating-cart-total"
          >
            {formattedTotal}
          </span>
          <span className="restaurant-floating-cart-action-btn">
            <span>{l10n.getString('restaurant-cart-view-order')}</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="16"
              height="16"
              aria-hidden="true"
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </span>
        </div>
      </button>
    </aside>
  );
}
