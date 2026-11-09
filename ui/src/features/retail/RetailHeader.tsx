import { useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components';
import { formatMoney } from '@/types/domain';
import type { StoreSettingsDto } from '@/api/settings';
import type { ShiftDto } from '@/api/shifts';

interface RetailHeaderProps {
  /** Display variant: 'full' (default) shows store info + shift + cashier + clock; 'minimal' shows title + back button. */
  variant?: 'full' | 'minimal';

  // ── Full-variant props ──────────────
  storeSettings?: StoreSettingsDto;
  shiftLoading?: boolean;
  /** The active-shift read THREW — distinct from "read fine, no shift open". */
  shiftLoadFailed?: boolean;
  activeShift?: ShiftDto | null;
  displayName?: string;
  dateStr?: string;
  timeStr?: string;
  shiftDuration?: string | null;
  onWorkspacePicker?: () => void;

  // ── Minimal-variant props ────────────
  /** Title displayed in place of the store name when variant is 'minimal'. */
  title?: string;
  /** Back button handler. When provided (and variant is 'minimal'), renders a back button. */
  onBack?: () => void;
  /** Skip-to-content target ID. When provided, renders a visually-hidden skip link before the header (keyboard-accessible on focus). */
  skipTarget?: string;
}

/** Retail POS header — full variant with store info/shift/cashier/clock, or minimal variant with title + back button for sub-views. */
export default function RetailHeader({
  variant = 'full',
  storeSettings,
  shiftLoading,
  shiftLoadFailed,
  activeShift,
  displayName,
  dateStr,
  timeStr,
  shiftDuration,
  onWorkspacePicker,
  title,
  onBack,
  skipTarget,
}: RetailHeaderProps) {
  const { l10n } = useLocalization();

  if (variant === 'minimal') {
    return (
      <>
        {skipTarget && (
          <a href={`#${skipTarget}`} className="retail-skip-link">
            {requiredLocalized(l10n, 'retail-skip-to-main')}
          </a>
        )}
        <header className="retail-header">
          <div className="retail-header-store">
            {/* The page title. This sub-view IS the whole screen, and the title was
                a <span> -- so a screen reader arriving here had no heading root at
                all. Same element and class, now a heading. */}
            <h1 className="retail-header-name">{title}</h1>
          </div>
          {onBack && (
            <button
              type="button"
              className="retail-options-tab retail-options-tab--danger"
              onClick={onBack}
              aria-label={requiredLocalized(l10n, 'back')}
            >
              &larr; {l10n.getString('back')}
            </button>
          )}
        </header>
      </>
    );
  }

  return (
    <header className="retail-header">
      <div className="retail-header-store">
        {storeSettings?.logo && (
          <img
            src={`data:image/png;base64,${storeSettings.logo}`}
            alt={storeSettings.name || requiredLocalized(l10n, 'retail-store-logo-alt')}
            className="retail-header-logo"
          />
        )}
        <div>
          {/* The page title, for the same reason as the minimal variant above. The
              retail POS is a full-screen workspace with no other heading, and the
              store name is what names the page. */}
          <h1 className="retail-header-name">{storeSettings?.name || l10n.getString('retail-store-name-fallback')}</h1>
          {storeSettings?.branch && <span className="retail-header-branch"> &middot; {storeSettings.branch}</span>}
          <span className="retail-header-address">{storeSettings?.address || ''}</span>
        </div>
      </div>
      <div className="retail-header-right">
        {shiftLoading ? (
          <span className="retail-shift-badge">{l10n.getString('loading')}</span>
        ) : shiftLoadFailed ? (
          <span className="retail-shift-badge retail-shift-badge--idle">
            {l10n.getString('retail-shift-unknown')}
          </span>
        ) : activeShift ? (
          <span className="retail-shift-badge">
            {l10n.getString('retail-shift-label')} &middot; {formatMoney({ minor_units: activeShift.totalSalesMinor, currency: storeSettings?.currency ?? 'IDR' })}
          </span>
        ) : (
          <span className="retail-shift-badge retail-shift-badge--idle">{l10n.getString('retail-no-shift')}</span>
        )}
        {onWorkspacePicker && (
          <button
            type="button"
            className="retail-header-nav-btn"
            onClick={onWorkspacePicker}
            title={requiredLocalized(l10n, 'retail-header-workspaces-title')}
            aria-label={requiredLocalized(l10n, 'retail-header-workspaces-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
              <rect x="2" y="3" width="22" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>
        )}
        {displayName && (
          <div className="retail-header-cashier">
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
              <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 1114 0H3z" />
            </svg>
            <span>{displayName}</span>
          </div>
        )}
        {dateStr && (
          <span className="retail-header-clock">
            <span className="retail-header-date">{dateStr}</span>
            {timeStr && <span>{timeStr}</span>}
            {shiftDuration && <span className="retail-header-duration">{shiftDuration}</span>}
          </span>
        )}
      </div>
    </header>
  );
}
