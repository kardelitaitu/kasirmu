//! Revoked-tenant screen — shown when the tenant's subscription has been
//! revoked server-side and `create_session` now refuses new sessions.
//!
//! ## Why this screen exists (ADR #58 §2.6 / §4a Q-A option 3)
//!
//! §2.5 refuses all new sessions and invalidates live ones when a tenant is
//! revoked. §2.6 promises that a revoked merchant can still VIEW and EXPORT
//! their own data. The ordinary export path (`export_data`) resolves a session
//! and requires `SETTINGS_EDIT` — so once §2.5 holds, no export is reachable
//! through the normal UI.
//!
//! The solution is the ungated twin `export_data_without_session`, which shares
//! the same body as `export_data` but skips session resolution. This screen is
//! the ONLY caller of that twin in the UI. It satisfies §2.6's promise: the
//! merchant can retrieve their data even while fully locked out of selling.
//!
//! **Sequencing note (ADR §4a Q-A):** this screen MUST ship WITH §2.5's
//! enforcement, never after. §2.5 is already enforced at
//! `crates/kasirmu-bridge/src/auth.rs:645`. This screen closes the gap.

import { useState } from 'react';
import { useLocalization, Localized } from '@fluent/react';
import { exportDataWithoutSession, pickExportPath } from '@/api/data';
import { plainErrorMessage } from '@/utils/app-error';
import { useToast } from '@/components/Toast';
import StatusBar from '@/components/StatusBar';
import './LicenseActivationScreen.css'; // reuse the auth-screen layout tokens

/**
 * Full-screen gate rendered when `state === 'revoked'`.
 *
 * The merchant can:
 *  - Export their data (read-only, local-only — no session required)
 *  - Contact support
 *
 * The merchant cannot:
 *  - Log in
 *  - Sell, sync, or mutate data
 */
export default function RevokedScreen() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const outputPath = await pickExportPath();
      if (!outputPath) {
        setExporting(false);
        return;
      }

      await exportDataWithoutSession({
        types: ['sales', 'products', 'customers', 'inventory', 'settings'],
        password: '',
        outputPath,
      });

      addToast({
        type: 'success',
        message: l10n.getString('auth-revoked-export-success'),
      });
    } catch (err) {
      // plainErrorMessage, never err.message: raw backend text must not reach a
      // user-facing toast (ERR-10). The FTL message keeps its substitution, so
      // this still reads "Export failed: <user-safe reason>".
      addToast({
        type: 'error',
        message: l10n.getString('auth-revoked-export-error', {
          message: plainErrorMessage(err),
        }),
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="license-activation-container" data-testid="revoked-screen">
      <div className="license-activation-layout" style={{ flexDirection: 'column', maxWidth: '36rem' }}>
        <section
          className="license-activation-form"
          aria-labelledby="revoked-title"
          style={{ width: '100%' }}
        >
          <h1 id="revoked-title" className="license-form-title">
            <Localized id="auth-revoked-title">Account suspended</Localized>
          </h1>

          <p style={{ marginBottom: 'var(--space-4)', color: 'var(--color-fg-muted)' }}>
            <Localized id="auth-revoked-message">
              Your kasir.mu account has been suspended. You cannot log in or process
              new sales. Your existing data is safe and can be exported below.
            </Localized>
          </p>

          <p style={{ marginBottom: 'var(--space-6)', color: 'var(--color-fg-muted)', fontSize: 'var(--text-sm)' }}>
            <Localized id="auth-revoked-contact">
              If you believe this is an error, please contact our support team.
            </Localized>
          </p>

          <button
            type="button"
            className="license-submit-button"
            onClick={handleExport}
            disabled={exporting}
            aria-label={l10n.getString('auth-revoked-export-aria')}
          >
            {exporting
              ? <Localized id="auth-revoked-exporting">Exporting…</Localized>
              : <Localized id="auth-revoked-export-button">Export my data</Localized>
            }
          </button>
        </section>
      </div>
      <StatusBar />
    </div>
  );
}
