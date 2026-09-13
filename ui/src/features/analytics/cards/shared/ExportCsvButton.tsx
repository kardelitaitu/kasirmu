//! Small CSV export action — the one card primitive the SCREEN still
//! imports by name from `AnalyticsCardContent` (constraint 2), so the
//! content file re-exports this implementation rather than owning it:
//! cards import it from here, the content file keeps the public path.

import { useLocalization } from '@fluent/react';

/** Small CSV export action — aria label describes what the card exports. */
export function ExportCsvButton({ onClick, ariaLabel }: { onClick: () => void; ariaLabel: string }) {
  const { l10n } = useLocalization();
  return (
    <button
      type="button"
      className="analytics-export-btn"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span>{l10n.getString('analytics-export-csv')}</span>
    </button>
  );
}
