import { useState, useCallback } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useStorageHealth } from '@/hooks/useStorageHealth';
import './StorageBanner.css';

/**
 * Storage warning banner: alerts when disk space drops below 500 MB.
 */
export default function StorageBanner() {
  const { l10n } = useLocalization();
  const { health, isLowSpace } = useStorageHealth();
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  if (!isLowSpace || dismissed) {
    return null;
  }

  const freeMb = Math.max(0, Math.round((health?.availableBytes ?? 0) / (1024 * 1024)));

  return (
    <div
      className="storage-banner storage-banner--warning"
      role="alert"
      aria-live="polite"
      data-testid="storage-health-banner"
    >
      <div className="storage-banner-content">
        <svg
          className="storage-banner-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span className="storage-banner-text">
          <Localized id="storage-low-banner-title">
            <strong>Low Storage Space:</strong>
          </Localized>{' '}
          <Localized id="storage-low-banner-desc" vars={{ freeMb }}>
            <span>Available disk space is below 500 MB ({freeMb} MB remaining). Free up space to prevent transaction errors or database lock.</span>
          </Localized>
        </span>
      </div>
      <div className="storage-banner-actions">
        <button
          type="button"
          className="storage-banner-btn storage-banner-btn--dismiss"
          onClick={handleDismiss}
          aria-label={l10n.getString('storage-low-banner-dismiss-aria')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
