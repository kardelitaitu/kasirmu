//! SyncStatusScreen — Settings → Sync Status.
//!
//! The read-only STATUS half of the sync family. Its scaffold provenance called
//! this a "planned tab of DataSyncScreen, fed by the sync-status half of
//! `sections/SyncSection.tsx`" — the tab plan is obsolete (the sidebar registers
//! `sync-status` as its own `subpage: true` entry, so a tab would duplicate the
//! route), but the second half of that sentence is exactly right, and this screen
//! is that half.
//!
//! WHAT IT SHOWS. The three read-only blocks SyncSection rendered between its
//! config form and its actions: the status indicator (dot + text), the tenant
//! plan row (ADR sync-plan-gating), and the detailed queue summary grid with its
//! last-synced / oldest-pending times. Plus the three ACTIONS that produce the
//! state being reported — Test Connection, Sync Now, and the destructive Pull —
//! because a status page with no way to re-run is a dead end.
//!
//! WHAT IT DOES NOT SHOW. The configuration itself (server URL, API key, enabled
//! toggle). Those are Settings → Data Sync, the parent page; editing credentials
//! is not a status concern.
//!
//! It shares `hooks/useDataSyncDraft.ts` with Data Sync rather than reading the
//! queue independently: the draft hook already owns the queue-summary and plan
//! reads, and a second reader would be a second poll with its own drift.
//!
//! Requires Plus+ — the sidebar entry carries `minimumTier: 'plus'`, so the gate
//! is enforced before this component mounts.

import { Localized, useLocalization } from '@fluent/react';
import { useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { requiredLocalized } from '@/components';
import { useToast } from '@/components/Toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { PingResult, PullResult, SyncAttemptResult } from '@/api/offline';
import { useDataSyncDraft } from '../hooks/useDataSyncDraft';
import './screens-placeholder.css';
import './SyncStatusScreen.css';

/** Relative-time label, moved verbatim from SyncSection so the wording matches. */
function formatRelativeTime(iso: string | null): { fluentKey: string; fluentArgs: Record<string, number | string> } | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  // Future timestamps (clock skew) count as "just now".
  const diffMs = Math.max(0, Date.now() - ts);
  if (diffMs < 60_000) return { fluentKey: 'settings-sync-time-just-now', fluentArgs: {} };
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 1) return { fluentKey: 'settings-sync-time-days-ago', fluentArgs: { count: days } };
  if (hours >= 1) return { fluentKey: 'settings-sync-time-hours-ago', fluentArgs: { count: hours } };
  return { fluentKey: 'settings-sync-time-minutes-ago', fluentArgs: { count: mins } };
}

/** Settings → Sync Status: the read-only sync report plus its three actions. */
export function SyncStatusScreen() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const draft = useDataSyncDraft();

  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncAttemptResult | null>(null);
  const [pullResult, setPullResult] = useState<PullResult | null>(null);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [confirmPullOpen, setConfirmPullOpen] = useState(false);

  // Availability is "configured at all": a server URL on the draft, or the
  // enabled flag. Mirrors SyncSection's own gate on these three blocks so the
  // status panel does not report on a sync that was never set up.
  const configured = draft.syncServerUrl !== '' || draft.sync.enabled;

  const handleTest = async () => {
    setTesting(true);
    setPingResult(null);
    try {
      const result = await draft.testSyncConnection();
      setPingResult(result);
      addToast({ message: result.status, type: result.ok ? 'success' : 'error' });
    } catch {
      setPingResult({ ok: false, status: l10n.getString('settings-sync-test-failed'), latencyMs: null });
      addToast({ message: l10n.getString('settings-sync-test-failed'), type: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await draft.syncRun();
      setSyncResult(result);
      if (result.error) {
        addToast({ message: result.error, type: 'error' });
      } else if (result.failed > 0) {
        addToast({
          message: l10n.getString('settings-sync-result', { synced: result.synced, failed: result.failed }),
          type: 'error',
        });
      } else {
        addToast({
          message: l10n.getString('settings-sync-success', { synced: result.synced, failed: result.failed }),
          type: 'success',
        });
      }
      await draft.refreshQueueSummary();
    } catch {
      const errMsg = l10n.getString('settings-sync-error');
      setSyncResult({ synced: 0, failed: 0, error: errMsg });
      addToast({ message: errMsg, type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const handlePull = async () => {
    setConfirmPullOpen(false);
    setPulling(true);
    setPullResult(null);
    try {
      const result = await draft.syncPull({ confirmDestructive: true });
      setPullResult(result);
      if (result.error) {
        addToast({ message: result.error, type: 'error' });
      } else if (result.productsPulled > 0 || result.taxRatesPulled > 0 || result.usersPulled > 0) {
        addToast({
          message: l10n.getString('settings-sync-pull-toast-success', {
            products: result.productsPulled,
            tax_rates: result.taxRatesPulled,
            users: result.usersPulled,
          }),
          type: 'success',
        });
      } else {
        addToast({ message: l10n.getString('settings-sync-pull-empty'), type: 'info' });
      }
    } catch {
      const errMsg = l10n.getString('settings-sync-error');
      setPullResult({ productsPulled: 0, taxRatesPulled: 0, usersPulled: 0, error: errMsg });
      addToast({ message: errMsg, type: 'error' });
    } finally {
      setPulling(false);
    }
  };

  const summary = draft.queueSummary;
  const plan = draft.syncPlan;

  return (
    <section className="settings-screen-placeholder">
      <h1 className="settings-screen-placeholder-title">
        <Localized id="settings-nav-sync-status">Sync Status</Localized>
      </h1>
      {/* The migration note stays (SettingsPage.test.tsx asserts it on every
          screen, migrated ones included). */}
      <p className="settings-screen-placeholder-note">
        <Localized id="settings-screen-migrating">
          Existing settings content will move here selectively.
        </Localized>
      </p>

      <Card
        shadow="sm"
        header={<Localized id="settings-section-sync"><h2 className="settings-section-title">Cloud Sync</h2></Localized>}
      >
        {!configured ? (
          <div className="settings-sync-status">
            <Localized id="settings-sync-not-configured">
              {/* No `settings-sync-status-text` class here: it is used by
                  SyncSection but defined in NO stylesheet, so it styles nothing.
                  The parent `.settings-sync-status` already sets the font size
                  and colour. */} 
              <span>Cloud sync is not configured.</span>
            </Localized>
          </div>
        ) : (
          <>
            {/* ── Status indicator ──────────────────── */}
            <div className="settings-sync-status" data-testid="sync-status-indicator">
              <span
                className={`settings-sync-dot${syncResult && !syncResult.error ? ' settings-sync-dot--ok' : ''}${syncResult?.error ? ' settings-sync-dot--err' : ''}`}
                aria-hidden="true"
              />
              {/* No `settings-sync-status-text`: undefined in every sheet (see the
                  note on the not-configured arm above). */}
              <span>
                {syncResult === null
                  ? (pingResult ? pingResult.status : l10n.getString('settings-sync-status-idle'))
                  : syncResult.error
                    ? syncResult.error
                    : l10n.getString('settings-sync-status-ok')}
              </span>
              {summary && summary.pendingCount > 0 && (
                <span className="settings-sync-pending-badge">
                  {l10n.getString('settings-sync-pending-count', { count: summary.pendingCount })}
                </span>
              )}
            </div>

            {/* ── Tenant plan (ADR sync-plan-gating) ── */}
            {plan?.ok && plan.plan && (
              <div
                className={`settings-sync-plan-row${plan.plan === 'free' ? ' settings-sync-plan-row--free' : ''}`}
                data-testid="sync-status-plan-row"
              >
                <Localized id="settings-sync-plan-label"><span className="settings-sync-plan-label">Plan</span></Localized>
                {plan.plan === 'pro' ? (
                  <span className="settings-sync-plan-badge settings-sync-plan-badge--pro">
                    <Localized id="settings-sync-plan-pro"><span>Pro</span></Localized>
                  </span>
                ) : (
                  <span className="settings-sync-plan-badge settings-sync-plan-badge--free">
                    <Localized id="settings-sync-plan-free"><span>Free</span></Localized>
                  </span>
                )}
                {plan.plan === 'free' && (
                  <Localized id="settings-sync-plan-upgrade-hint">
                    <span className="settings-sync-plan-upgrade-hint">Upgrade to sync to the cloud</span>
                  </Localized>
                )}
              </div>
            )}

            {/* ── Detailed queue status ──────────────── */}
            {summary && (
              <div className="settings-sync-summary" data-testid="sync-status-queue-summary">
                <div className="settings-sync-summary-grid">
                  <span className="settings-sync-summary-item">
                    <strong>{summary.pendingCount}</strong>
                    <Localized id="settings-sync-summary-pending"><span>pending</span></Localized>
                  </span>
                  <span className="settings-sync-summary-item">
                    <strong>{summary.syncedCount}</strong>
                    <Localized id="settings-sync-summary-synced"><span>synced</span></Localized>
                  </span>
                  <span className="settings-sync-summary-item">
                    <strong>{summary.failedCount}</strong>
                    <Localized id="settings-sync-summary-failed"><span>failed</span></Localized>
                  </span>
                  <span className="settings-sync-summary-item">
                    <strong>{summary.conflictCount}</strong>
                    <Localized id="settings-sync-summary-conflicts"><span>conflicts</span></Localized>
                  </span>
                </div>
                <div className="settings-sync-summary-meta">
                  <span className="settings-sync-summary-time">
                    {(() => {
                      const rel = formatRelativeTime(summary.lastSyncedAt);
                      return rel
                        ? l10n.getString('settings-sync-last-synced', { time: l10n.getString(rel.fluentKey, rel.fluentArgs) })
                        : l10n.getString('settings-sync-last-synced-never');
                    })()}
                  </span>
                  <span className="settings-sync-summary-time">
                    {(() => {
                      const rel = formatRelativeTime(summary.oldestPendingAt);
                      return rel
                        ? l10n.getString('settings-sync-oldest-pending', { time: l10n.getString(rel.fluentKey, rel.fluentArgs) })
                        : l10n.getString('settings-sync-oldest-pending-none');
                    })()}
                  </span>
                </div>
              </div>
            )}

            {/* The last pull's counts. Kept off the status line above, which
                reports the RUN outcome; a pull is a different action with its
                own result, and folding them would let one overwrite the other. */}
            {pullResult && (
              <div className="settings-sync-result-block" data-testid="sync-pull-result">
                <p className="settings-hint">
                  <Localized
                    id="settings-sync-pull-result"
                    vars={{ products: pullResult.productsPulled, tax_rates: pullResult.taxRatesPulled, users: pullResult.usersPulled }}
                  >
                    <span>Last pull: {pullResult.productsPulled} products, {pullResult.taxRatesPulled} tax rates, {pullResult.usersPulled} users</span>
                  </Localized>
                </p>
                {pullResult.error && (
                  <p className="settings-hint settings-hint--error">{pullResult.error}</p>
                )}
              </div>
            )}

            <div className="settings-actions">
              <Button variant="ghost" loading={testing} onClick={handleTest}>
                <Localized id={testing ? 'settings-sync-testing' : 'settings-sync-test-connection'}>
                  <span>{testing ? 'Testing…' : 'Test Connection'}</span>
                </Localized>
              </Button>
              <Button variant="secondary" loading={syncing} onClick={handleSync}>
                <Localized id={syncing ? 'settings-sync-syncing' : 'settings-sync-sync-now'}>
                  <span>{syncing ? 'Syncing…' : 'Sync Now'}</span>
                </Localized>
              </Button>
              <Button variant="ghost" loading={pulling} onClick={() => setConfirmPullOpen(true)}>
                <Localized id={pulling ? 'settings-sync-pulling' : 'settings-sync-pull'}>
                  <span>{pulling ? 'Pulling…' : 'Pull from Server'}</span>
                </Localized>
              </Button>
            </div>

            {/* A pull overwrites local rows, so it needs explicit consent — the
                same designed ConfirmDialog SyncSection used, not window.confirm. */}
            <ConfirmDialog
              open={confirmPullOpen}
              onCancel={() => setConfirmPullOpen(false)}
              onConfirm={handlePull}
              title={requiredLocalized(l10n, 'settings-sync-confirm-pull-title')}
              message={requiredLocalized(l10n, 'settings-sync-confirm-overwrite')}
              variant="danger"
              loading={pulling}
              confirmLabel={requiredLocalized(l10n, 'settings-sync-pull')}
              cancelLabel={requiredLocalized(l10n, 'cancel')}
            />
          </>
        )}
      </Card>
    </section>
  );
}
