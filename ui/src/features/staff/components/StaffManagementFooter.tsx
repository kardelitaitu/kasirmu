/**
 * StaffManagementFooter — the global-tier status bar at the bottom of the Staff page.
 *
 * Staff and Roles register `fullscreen`, so AppShell renders them without
 * AppLayout — and AppLayout is what mounts the app's own StatusBar
 * (`app/StatusBar.tsx`, `AppLayout.tsx:324`).
 *
 * Adopts the Global-Tier SaaS Status Bar pattern:
 * - Left zone: System health pulse (Synced / Syncing / Offline) + active workspace scope.
 * - Center zone: Data freshness with interactive refresh micro-action (spin on in-flight).
 * - Right zone: Operator identity + application version token (hidden on small viewports).
 */
import { Localized, useLocalization } from '@fluent/react';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export interface StaffManagementFooterProps {
  /**
   * When the current lists landed, or null when no successful load has
   * completed (initial load in flight, or the load failed).
   */
  loadedAt: number | null;
  /** True while the primary staff or roles load is in flight. */
  loading?: boolean;
  /** Primary load error message, or null if healthy. */
  loadError?: string | null;
  /** Callback to trigger a manual data re-fetch. */
  onRefresh?: () => void;
}

/**
 * Literal class mapping for connection dot variants so static analysis
 * in screenExtraction.test.ts credits each rule without dead-class warnings.
 */
const STATUS_DOT_CLASS: Record<'connected' | 'checking' | 'disconnected', string> = {
  connected: 'staff-mgmt-footer-dot--connected',
  checking: 'staff-mgmt-footer-dot--checking',
  disconnected: 'staff-mgmt-footer-dot--disconnected',
};

export function StaffManagementFooter({
  loadedAt,
  loading = false,
  loadError = null,
  onRefresh,
}: StaffManagementFooterProps) {
  const { l10n } = useLocalization();
  const { activeInstance } = useWorkspace();
  const { session } = useAuth();
  const locale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';

  const updatedTime =
    loadedAt === null
      ? ''
      : new Date(loadedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  const workspaceName = activeInstance?.name ?? activeInstance?.store_name ?? '';
  const operatorName = session?.display_name ?? '';

  const statusTone: 'connected' | 'checking' | 'disconnected' = loadError
    ? 'disconnected'
    : loading
      ? 'checking'
      : 'connected';

  const statusLabel = loadError
    ? 'Offline'
    : loading
      ? 'Syncing…'
      : 'Synced';

  return (
    <footer className="staff-mgmt-footer" data-testid="staff-mgmt-footer" role="contentinfo">
      {/* ── Left Zone: System health & Scope ── */}
      <div className="staff-mgmt-footer-left">
        <span className="staff-mgmt-footer-pill" data-testid="staff-footer-sync">
          <span
            className={`staff-mgmt-footer-dot ${STATUS_DOT_CLASS[statusTone]}`}
            aria-hidden="true"
          />
          <span>{statusLabel}</span>
        </span>
        {workspaceName && (
          <>
            <span className="staff-mgmt-footer-sep" aria-hidden="true">|</span>
            <span className="staff-mgmt-footer-pill" data-testid="staff-footer-workspace">
              <svg
                className="staff-mgmt-footer-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <span>{workspaceName}</span>
            </span>
          </>
        )}
      </div>

      {/* ── Center Zone: Freshness & Background Tasks ── */}
      <div className="staff-mgmt-footer-center">
        {loading ? (
          <span className="staff-mgmt-footer-pill staff-mgmt-footer-pill--busy" data-testid="staff-footer-refresh-btn">
            <svg
              className="staff-mgmt-footer-icon staff-mgmt-footer-icon--spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>Refreshing…</span>
          </span>
        ) : loadedAt !== null ? (
          <button
            type="button"
            className="staff-mgmt-footer-btn"
            onClick={onRefresh}
            aria-label="Refresh staff data"
            data-testid="staff-footer-refresh-btn"
          >
            <svg
              className="staff-mgmt-footer-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <Localized id="staff-footer-updated" vars={{ time: updatedTime }}>
              <span>Updated {updatedTime}</span>
            </Localized>
          </button>
        ) : null}
      </div>

      {/* ── Right Zone: Operator & Version ── */}
      <div className="staff-mgmt-footer-right">
        {operatorName && (
          <>
            <span className="staff-mgmt-footer-pill" data-testid="staff-footer-operator">
              <svg
                className="staff-mgmt-footer-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>{operatorName}</span>
            </span>
            <span className="staff-mgmt-footer-sep" aria-hidden="true">|</span>
          </>
        )}
        <span className="staff-mgmt-footer-version" data-testid="staff-footer-version">
          v0.0.40
        </span>
      </div>
    </footer>
  );
}
