import { type ReactNode } from 'react';
import { Card } from '@/components/Card';
import './RestaurantSettingsScreens.css';

export interface PaymentMethodCardProps {
  id: string;
  title: string;
  description: string;
  code: string;
  icon: ReactNode;
  badge?: string | undefined;
  badgeVariant?: ('default' | 'primary' | 'success' | 'warning') | undefined;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  isCore?: boolean | undefined;
  onRemove?: (() => void) | undefined;
  removeAriaLabel?: string | undefined;
  mountBodyWhenCollapsed?: boolean | undefined;
  children?: ReactNode;
}

/**
 * Standard reusable card template for Restaurant Payment Methods.
 * Sized and styled matching the Receipt Settings cards.
 * When enabled, smoothly expands to reveal configuration properties.
 * When disabled, displays as a clean collapsed card row.
 */
export function PaymentMethodCard({
  id,
  title,
  description,
  code,
  icon,
  badge,
  badgeVariant = 'default',
  enabled,
  onToggle,
  isCore = true,
  onRemove,
  removeAriaLabel,
  mountBodyWhenCollapsed = false,
  children,
}: PaymentMethodCardProps) {
  const shouldRenderBody = enabled || mountBodyWhenCollapsed;

  return (
    <div
      className={`resto-payment-card-wrapper ${enabled ? 'resto-payment-card-wrapper--expanded' : 'resto-payment-card-wrapper--collapsed'}`}
      data-testid={`payment-card-${id}`}
    >
      <Card
        shadow="sm"
        className="resto-payment-card"
        header={
          <div className="restaurant-settings-card-header resto-payment-card-header restaurant-rail-row">
            <div className="resto-payment-card-title-group">
              <div className="resto-payment-card-icon-wrap" aria-hidden="true">
                {icon}
              </div>
              <div className="resto-payment-card-info">
                <div className="resto-payment-card-title-row">
                  <label
                    htmlFor={`rail-toggle-${code}`}
                    className="settings-section-title resto-payment-card-title"
                  >
                    {title}
                  </label>
                  <span className="restaurant-rail-code">{code}</span>
                  {badge && (
                    <span className={`resto-payment-card-badge resto-payment-card-badge--${badgeVariant}`}>
                      {badge}
                    </span>
                  )}
                </div>
                <p className="resto-payment-card-desc">{description}</p>
              </div>
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
              <span className="settings-toggle">
                <span className="sr-only">Toggle {title}</span>
                <span className="settings-toggle-switch">
                  <input
                    id={`rail-toggle-${code}`}
                    type="checkbox"
                    role="switch"
                    checked={enabled}
                    aria-checked={enabled}
                    aria-label={title}
                    onChange={(e) => onToggle(e.target.checked)}
                  />
                  <span className="settings-toggle-slider" />
                </span>
              </span>
            </div>
          </div>
        }
      >
        {shouldRenderBody && children && (
          <div className={`resto-payment-card-body settings-form ${!enabled ? 'resto-payment-card-body--collapsed' : ''}`}>
            {children}
          </div>
        )}
      </Card>
    </div>
  );
}

export default PaymentMethodCard;
