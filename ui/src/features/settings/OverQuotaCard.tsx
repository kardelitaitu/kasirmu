import { useCallback, useEffect, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import {
  getOverQuotaReport,
  isOverQuota,
  excessOf,
  type OverQuotaReport,
  type QuotaUsageRow,
} from '@/api/subscription';
import { useWorkspace } from '@/contexts/WorkspaceContext';

/** Dimension key → FTL label, referenced literally so bundle parity can
 *  see every key is live (no dynamic composition). */
const DIMENSION_LABEL_IDS: Record<string, string> = {
  locations: 'settings-license-quota-dim-locations',
  pos_registers: 'settings-license-quota-dim-pos-registers',
  warehouses: 'settings-license-quota-dim-warehouses',
  staff: 'settings-license-quota-dim-staff',
  products: 'settings-license-quota-dim-products',
};

/**
 * The §J downgrade remediation view (todo-global-saas-2.md): renders the
 * live over-quota assessment for the effective tier — the same numbers
 * the creation gates enforce. All-clear when nothing is over; otherwise
 * each over dimension names its excess with the archive-or-upgrade
 * guidance. Read-only: the actual archiving lives in the resource
 * screens; the upgrade CTA rides the pricing flow.
 */
export default function OverQuotaCard() {
  const { l10n } = useLocalization();
  const { sessionToken } = useWorkspace();
  const [report, setReport] = useState<OverQuotaReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    setFailed(false);
    try {
      setReport(await getOverQuotaReport(sessionToken));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const overRows: QuotaUsageRow[] = report
    ? report.usages.filter(isOverQuota)
    : [];

  return (
    <Card
      shadow="sm"
      header={
        <Localized id="settings-license-quota-title">
          <h2 className="settings-section-title">Quota status</h2>
        </Localized>
      }
    >
      <div className="settings-form" data-testid="over-quota-card">
        <p className="settings-hint">
          <Localized id="settings-license-quota-intro" vars={{ tier: report?.tierName ?? '' }}>
            <span>{'Resources measured against the { $tier } tier quotas — the same numbers the creation gates enforce.'}</span>
          </Localized>
        </p>

        {failed && (
          <div className="settings-error" role="alert" data-testid="over-quota-failed">
            <p>
              <Localized id="settings-license-quota-load-failed">
                <span>Could not load the quota assessment.</span>
              </Localized>
            </p>
            <Button variant="secondary" loading={loading} onClick={() => void refresh()}>
              <Localized id="settings-license-quota-refresh">
                <span>Refresh</span>
              </Localized>
            </Button>
          </div>
        )}

        {!failed && report !== null && overRows.length === 0 && (
          <p className="settings-hint" data-testid="over-quota-ok" aria-live="polite">
            <Localized id="settings-license-quota-ok">
              <span>Everything is within quota.</span>
            </Localized>
          </p>
        )}

        {!failed && overRows.length > 0 && (
          <div role="region" aria-label={l10n.getString('settings-license-quota-over-aria')} data-testid="over-quota-over">
            <p className="settings-hint settings-license-quota-over-heading">
              <Localized id="settings-license-quota-over-heading">
                <span>Over quota — archive or upgrade</span>
              </Localized>
            </p>
            <ul className="settings-license-quota-list">
              {overRows.map((row) => (
                <li key={row.dimension} className="settings-license-quota-row">
                  <span className="settings-license-quota-dim">
                    <Localized id={DIMENSION_LABEL_IDS[row.dimension] ?? 'settings-license-quota-dim-locations'}>
                      <span>{row.dimension}</span>
                    </Localized>
                  </span>
                  <span className="settings-license-quota-detail">
                    <Localized
                      id="settings-license-quota-over-line"
                      vars={{
                        current: row.current,
                        limit: row.limit ?? 0,
                        excess: excessOf(row),
                      }}
                    >
                      <span>{'{ $current } of { $limit } — { $excess } over'}</span>
                    </Localized>
                  </span>
                </li>
              ))}
            </ul>
            <p className="settings-hint">
              <Localized id="settings-license-quota-guidance">
                <span>Archive unused resources in the relevant screen, or upgrade the tier to raise the limits. Nothing was deleted automatically.</span>
              </Localized>
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
