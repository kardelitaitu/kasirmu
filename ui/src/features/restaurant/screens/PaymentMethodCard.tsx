import { useState, useEffect, type ReactNode } from 'react';
import { Card } from '@/components/Card';
import './RestaurantSettingsScreens.css';

export interface PaymentMethodCardProps {
  id: string;
  title: string;
  description?: string | undefined;
  code: string;
  icon?: ReactNode | undefined;
  badge?: string | undefined;
  badgeVariant?: ('default' | 'primary' | 'success' | 'warning') | undefined;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  isCore?: boolean | undefined;
  onRemove?: (() => void) | undefined;
  removeAriaLabel?: string | undefined;
  mountBodyWhenCollapsed?: boolean | undefined;
  children?: ReactNode | undefined;
}

/**
 * Standard reusable card template for Restaurant Payment Methods.
 * Sized and styled matching the Receipt Settings cards.
 * When enabled, smoothly expands to reveal configuration properties.
 * When disabled, displays as a clean collapsed card row.
 * Users can also click the header to collapse/expand manually.
 */
export function PaymentMethodCard({
  id,
  title,
  code,
  enabled,
  onToggle,
  isCore = true,
  onRemove,
  removeAriaLabel,
  mountBodyWhenCollapsed = false,
  children,
}: PaymentMethodCardProps) {
  const [isExpanded, setIsExpanded] = useState(enabled);

  // Sync expanded state whenever enabled toggle changes
  useEffect(() => {
    setIsExpanded(enabled);
  }, [enabled]);

  const shouldMountBody = isExpanded || mountBodyWhenCollapsed;

  return (
    <div
      className={`resto-payment-card-wrapper ${isExpanded ? 'resto-payment-card-wrapper--expanded' : 'resto-payment-card-wrapper--collapsed'}`}
      data-testid={`payment-card-${id}`}
    >
      <Card
        padding="none"
        shadow="sm"
        className={`resto-payment-card ${isExpanded ? 'resto-payment-card--expanded' : 'resto-payment-card--collapsed'}`}
        header={
          <div className="restaurant-settings-card-header resto-payment-card-header restaurant-rail-row">
            <div className="resto-payment-card-title-group">
              <button
                type="button"
                className="resto-card-expand-btn"
                onClick={() => setIsExpanded((prev) => !prev)}
                aria-expanded={isExpanded}
                aria-controls={`payment-card-body-${id}`}
                aria-label={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
              >
                <span
                  className={`resto-card-chevron ${isExpanded ? 'resto-card-chevron--expanded' : ''}`}
                  aria-hidden="true"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
                <span className="resto-payment-card-title">{title}</span>
              </button>
              <span className="restaurant-rail-code sr-only">{code}</span>
            </div>

            <div className="resto-payment-card-header-actions restaurant-rail-actions">
              {!isCore && onRemove && (
                <button
                  type="button"
                  className="restaurant-rail-remove"
                  onClick={onRemove}
                  aria-label={removeAriaLabel || `Remove ${title}`}
                >
                  &times;
                </button>
              )}
              <label className="settings-toggle-switch" htmlFor={`rail-toggle-${code}`}>
                <input
                  id={`rail-toggle-${code}`}
                  type="checkbox"
                  role="switch"
                  checked={enabled}
                  aria-checked={enabled}
                  aria-label={title}
                  onChange={(e) => {
                    onToggle(e.target.checked);
                    setIsExpanded(e.target.checked);
                  }}
                />
                <span className="settings-toggle-slider" aria-hidden="true" />
              </label>
            </div>
          </div>
        }
      >
        {shouldMountBody && children && (
          <div
            id={`payment-card-body-${id}`}
            className={`resto-payment-card-body settings-form ${!isExpanded ? 'resto-payment-card-body--hidden' : ''}`}
          >
            {children}
          </div>
        )}
      </Card>
    </div>
  );
}

export default PaymentMethodCard;
