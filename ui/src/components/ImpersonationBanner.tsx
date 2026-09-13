import { Localized, useLocalization } from '@fluent/react';
import { useImpersonation } from '@/contexts/ImpersonationContext';
import './ImpersonationBanner.css';

/**
 * Persistent banner shown while an operator is impersonating another user for
 * support. Driven by ImpersonationContext (not the Tauri updater plugin), so it
 * survives navigation until the operator presses Stop, which revokes the
 * impersonation session token.
 */
export function ImpersonationBanner() {
  const { active, stop } = useImpersonation();
  const { l10n } = useLocalization();

  if (!active) {
    return null;
  }

  return (
    <div className="impersonation-banner" role="status" aria-live="polite">
      <span className="impersonation-banner-text">
        <Localized id="staff-impersonating-banner" vars={{ name: active.targetDisplayName }}>
          <span>Impersonating {active.targetDisplayName}</span>
        </Localized>
      </span>
      <button
        type="button"
        className="impersonation-banner-stop"
        onClick={() => void stop()}
        aria-label={l10n.getString('staff-impersonating-stop-aria')}
      >
        <Localized id="staff-impersonating-stop">
          <span>Stop</span>
        </Localized>
      </button>
    </div>
  );
}

export default ImpersonationBanner;
