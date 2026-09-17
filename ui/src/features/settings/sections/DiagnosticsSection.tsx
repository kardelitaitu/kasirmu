import { useCallback, useEffect, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import {
  explainFeatureAvailability,
  type FeatureVerdict,
  type FeatureVerdictReason,
  type AvailabilityFeatureKey,
} from '@/api/subscription';
import { getDeploymentInfo, type DeploymentInfo } from '@/api/settings';
import './DiagnosticsSection.css';

/** The v1 verdict keys, in display order (the resolver's own feature set). */
const FEATURES: { key: AvailabilityFeatureKey; labelId: string }[] = [
  { key: 'supports_qris', labelId: 'settings-diagnostics-feature-supports-qris' },
  { key: 'supports_analytics', labelId: 'settings-diagnostics-feature-supports-analytics' },
  { key: 'supports_loyalty', labelId: 'settings-diagnostics-feature-supports-loyalty' },
  { key: 'supports_daily_dashboard', labelId: 'settings-diagnostics-feature-supports-daily-dashboard' },
  { key: 'supports_cloud_sync', labelId: 'settings-diagnostics-feature-supports-cloud-sync' },
  { key: 'sales_history_days', labelId: 'settings-diagnostics-feature-sales-history-days' },
  { key: 'locations', labelId: 'settings-diagnostics-feature-locations' },
  { key: 'staff_users', labelId: 'settings-diagnostics-feature-staff-users' },
  { key: 'pos_instances', labelId: 'settings-diagnostics-feature-pos-instances' },
  { key: 'warehouses', labelId: 'settings-diagnostics-feature-warehouses' },
];

/** Reason code → FTL label, referenced literally so bundle parity can see
 *  every key is live (no dynamic composition). */
const REASON_LABEL_IDS: Record<NonNullable<FeatureVerdictReason>, string> = {
  server_policy: 'settings-diagnostics-reason-server-policy',
  lifecycle: 'settings-diagnostics-reason-lifecycle',
  tier: 'settings-diagnostics-reason-tier',
  quota: 'settings-diagnostics-reason-quota',
  role: 'settings-diagnostics-reason-role',
  scope: 'settings-diagnostics-reason-scope',
};

/**
 * Settings → System → Diagnostics (todo-global-saas-3.md, feature-flag
 * observability): asks the verdict command why every v1 feature is or is
 * not available for the signed-in user, so support can see the actual
 * denial axis — server policy, lifecycle, tier, quota, role, or scope —
 * instead of re-deriving it from the caps payload. Read-only: nothing
 * here mutates state, and every row is one local verdict call (offline-
 * honest by construction, like the gates it explains).
 */
export default function DiagnosticsSection() {
  const { l10n } = useLocalization();
  const { sessionToken } = useWorkspace();
  const [verdicts, setVerdicts] = useState<Partial<Record<AvailabilityFeatureKey, FeatureVerdict>>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    setFailed(false);
    try {
      const next = await Promise.all(
        FEATURES.map(async ({ key }) => [key, await explainFeatureAvailability(sessionToken, key)] as const),
      );
      setVerdicts(Object.fromEntries(next));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sessionToken) return;
    getDeploymentInfo(sessionToken)
      .then(setDeployment)
      .catch(() => setDeployment(null));
  }, [sessionToken]);

  return (
    <Card
      shadow="sm"
      header={
        <Localized id="settings-diagnostics-title">
          <h2 className="settings-section-title">Diagnostics</h2>
        </Localized>
      }
    >
      <div className="settings-form" data-testid="diagnostics-section">
        <p className="settings-hint">
          <Localized id="settings-diagnostics-intro">
            <span>
              Why each feature is available or locked for you right now — the same
              gates the app enforces, with the reason named. Read-only.
            </span>
          </Localized>
        </p>

        <div className="settings-field settings-field--horizontal">
          <Button variant="ghost" loading={loading} onClick={() => void refresh()}>
            <Localized id="settings-diagnostics-refresh">
              <span>Refresh</span>
            </Localized>
          </Button>
          {failed && (
            <span className="settings-hint" role="alert" data-testid="diagnostics-failed">
              <Localized id="settings-diagnostics-load-failed">
                <span>Could not load the verdicts. Try again.</span>
              </Localized>
            </span>
          )}
        </div>

        <div className="settings-field settings-field--horizontal" data-testid="diagnostics-version">
          <Localized id="settings-diagnostics-deployment-version" vars={{ version: deployment?.appVersion ?? '' }}>
            <span>{'App version: { $version }'}</span>
          </Localized>
        </div>

        <ul className="settings-diagnostics-list" aria-label={requiredLocalized(l10n, 'settings-diagnostics-list-aria')}>
          {FEATURES.map(({ key, labelId }) => {
            const v = verdicts[key];
            const detail = v?.detail;
            return (
              <li key={key} className="settings-diagnostics-row" data-testid={'diagnostics-row-' + key}>
                <span className="settings-diagnostics-feature">
                  <Localized id={labelId}>
                    <span>{key}</span>
                  </Localized>
                </span>
                {!v ? (
                  <span className="settings-diagnostics-detail">
                    <Localized id="settings-diagnostics-loading">
                      <span>…</span>
                    </Localized>
                  </span>
                ) : (
                  <span className="settings-diagnostics-result">
                    <span
                      className={
                        'settings-diagnostics-badge' + (v.available ? ' settings-diagnostics-badge--ok' : '')
                      }
                    >
                      {v.available ? (
                        <Localized id="settings-diagnostics-status-available">
                          <span>Available</span>
                        </Localized>
                      ) : (
                        <Localized id={REASON_LABEL_IDS[v.reason ?? 'server_policy']}>
                          <span>{v.reason}</span>
                        </Localized>
                      )}
                    </span>
                    <span className="settings-diagnostics-detail">
                      <Localized id="settings-diagnostics-detail-tier" vars={{ tier: detail?.tier ?? '' }}>
                        <span>{'Tier: { $tier }'}</span>
                      </Localized>
                      {' · '}
                      <Localized id="settings-diagnostics-detail-state" vars={{ state: detail?.state ?? '' }}>
                        <span>{'State: { $state }'}</span>
                      </Localized>
                      {detail?.limit != null && detail.usage != null && (
                        <>
                          {' · '}
                          <Localized
                            id="settings-diagnostics-detail-quota"
                            vars={{ usage: detail.usage, limit: detail.limit }}
                          >
                            <span>{'Usage: { $usage } / { $limit }'}</span>
                          </Localized>
                        </>
                      )}
                      {detail?.permission && (
                        <>
                          {' · '}
                          <Localized id="settings-diagnostics-detail-permission" vars={{ permission: detail.permission }}>
                            <span>{'Permission: { $permission }'}</span>
                          </Localized>
                        </>
                      )}
                      {detail?.scopeGranted != null && (
                        <>
                          {' · '}
                          {detail.scopeGranted ? (
                            <Localized id="settings-diagnostics-detail-scope-covered">
                              <span>Covers this location</span>
                            </Localized>
                          ) : (
                            <Localized id="settings-diagnostics-detail-scope-not-covered">
                              <span>Does not cover this location</span>
                            </Localized>
                          )}
                        </>
                      )}
                      {detail?.expiresAt && (
                        <>
                          {' · '}
                          <Localized id="settings-diagnostics-detail-expires" vars={{ expiresAt: detail.expiresAt }}>
                            <span>{'Expires: { $expiresAt }'}</span>
                          </Localized>
                        </>
                      )}
                      {detail?.graceUntil && (
                        <>
                          {' · '}
                          <Localized id="settings-diagnostics-detail-grace" vars={{ graceUntil: detail.graceUntil }}>
                            <span>{'Grace until: { $graceUntil }'}</span>
                          </Localized>
                        </>
                      )}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
