import type { ReactNode } from 'react';
import { Button } from './Button';

/** Layout region the empty state appears in (EMPTY-08). */
export type EmptyStateRegion = 'full' | 'table' | 'grid' | 'modal';

/** Props for the EmptyState placeholder component. */
export interface EmptyStateProps {
  /** Optional icon/illustration displayed above the title. */
  icon?: ReactNode;
  /** Heading text. */
  title: string;
  /** Heading level — use 1/2/3 matching the page hierarchy. Default 3 for backward compat. */
  headingLevel?: 1 | 2 | 3;
  /** Supporting description. */
  description?: string;
  /** Optional primary action button. */
  action?: {
    label: string;
    onClick: () => void;
    /** `data-testid` for the button, for a consumer's own tests. */
    testId?: string;
  };
  /**
   * Layout region — applies the matching tokenized spacing variant
   * (full-page, table, grid, or modal). Defaults to the base padding.
   */
  region?: EmptyStateRegion;
  /** Additional content (e.g. custom CTA, tips). */
  children?: ReactNode;
}

/**
 * Placeholder screen shown when a list or view has no data.
 * Renders an optional icon, title, description, action button,
 * and additional children.
 */
export function EmptyState({
  icon,
  title,
  headingLevel = 3,
  description,
  action,
  region,
  children,
}: EmptyStateProps) {
  const regionClass = region ? ` empty-state--region-${region}` : '';
  return (
    <div className={`empty-state${regionClass}`} role="status">
      {icon && (
        <div className="empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      {headingLevel === 1 ? (
        <h1 className="empty-state__title">{title}</h1>
      ) : headingLevel === 2 ? (
        <h2 className="empty-state__title">{title}</h2>
      ) : (
        <h3 className="empty-state__title">{title}</h3>
      )}
      {description && <p className="empty-state__desc">{description}</p>}
      {action && (
        <div className="empty-state__action">
          <Button variant="primary" onClick={action.onClick} data-testid={action.testId}>
            {action.label}
          </Button>
        </div>
      )}
      {children}
    </div>
  );
}
