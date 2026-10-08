import { useEffect } from 'react';
import { useLocalization } from '@fluent/react';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import './RestaurantCartSheet.css';

export interface RestaurantCartSheetProps {
  open: boolean;
  onClose: () => void;
  tableNumber?: string;
  children: React.ReactNode;
}

/**
 * Bottom Sheet Drawer hosting CartPanel in Restaurant POS portrait mode.
 *
 * Slides up smoothly from the bottom, presenting the full CartPanel
 * interface (quantities, courses, notes, discounts, payment trigger)
 * without squishing the menu in portrait tablet layouts.
 */
export function RestaurantCartSheet({
  open,
  onClose,
  tableNumber,
  children,
}: RestaurantCartSheetProps) {
  const { l10n } = useLocalization();

  const { shouldRender, exiting, requestClose } = useExitAnimation(open, onClose, 200);

  // Close on Escape key press
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, requestClose]);

  if (!shouldRender) return null;

  return (
    <>
      <button
        type="button"
        className={`restaurant-cart-sheet-backdrop${exiting ? ' restaurant-cart-sheet-backdrop--exiting' : ''}`}
        onClick={requestClose}
        aria-label={l10n.getString('restaurant-cart-sheet-close')}
        tabIndex={-1}
        data-testid="restaurant-cart-sheet-backdrop"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={l10n.getString('restaurant-cart-sheet-title')}
        className={`restaurant-cart-sheet-panel noise-dither${exiting ? ' restaurant-cart-sheet-panel--exiting' : ''}`}
        data-testid="restaurant-cart-sheet-panel"
      >
        {/* Drag handle / top affordance */}
        <div className="restaurant-cart-sheet-handle-wrap" aria-hidden="true">
          <span className="restaurant-cart-sheet-handle" />
        </div>

        {/* Header */}
        <div className="restaurant-cart-sheet-header">
          <div className="restaurant-cart-sheet-title-group">
            <h2 className="restaurant-cart-sheet-title">
              {l10n.getString('restaurant-cart-sheet-title')}
            </h2>
            {tableNumber && (
              <span
                className="restaurant-cart-sheet-table-chip"
                data-testid="restaurant-cart-sheet-table-chip"
              >
                {l10n.getString('restaurant-cart-table-badge', { table: tableNumber })}
              </span>
            )}
          </div>

          <button
            type="button"
            className="restaurant-cart-sheet-close-btn"
            onClick={requestClose}
            aria-label={l10n.getString('restaurant-cart-sheet-close')}
            data-testid="restaurant-cart-sheet-close-btn"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="20"
              height="20"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body (hosts CartPanel) */}
        <div className="restaurant-cart-sheet-body">
          {children}
        </div>
      </section>
    </>
  );
}
