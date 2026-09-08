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
import {
  suspendSurplusWorkspaceInstancesScoped,
  recoverWorkspaceInstancesScoped,
} from '@/api/workspaces';
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
 * guidance.
 *
 * It was read-only until B1. It now also offers the two workspace-instance
 * remediation actions (suspend the surplus / restore what a downgrade
 * suspended), because `suspend_surplus_workspace_instances_scoped` and
 * `recover_workspace_instances_scoped` had been registered, permission-checked
 * and allowlisted as orphans with no call site anywhere: an owner could see the
 * excess and nothing else. Register archiving still lives in the resource
 * screens, and the upgrade CTA still rides the pricing flow.
 *
 * Desktop-only: neither command is registered in the tablet shell (recorded
 * product choice, allowlisted under its `tablet` list).
 */
export default function OverQuotaCard() {
  const { l10n } = useLocalization();
  // The store this session is bound to. Named `resolvedStoreId` on this context
  // (`storeId` is the separate useWorkspaceScope() value) — passing it to the
  // remediation commands is what keeps the hint text and the action in agreement.
  const { sessionToken, resolvedStoreId } = useWorkspace();
  const [report, setReport] = useState<OverQuotaReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [remedyBusy, setRemedyBusy] = useState<'suspend' | 'recover' | null>(null);
  const [remedyNote, setRemedyNote] = useState<
    { kind: 'suspended' | 'recovered' | 'none' | 'failed'; count: number } | null
  >(null);

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

  /**
   * Run one §J remediation action, then re-read the assessment so the numbers
   * on screen are the ones the creation gates now enforce — the report is the
   * source of truth here, not the count the command returned.
   *
   * `resolvedStoreId` is passed explicitly instead of omitting it to mean "my
   * store".
   * The hint under these buttons names the store the action applies to, and
   * letting the backend infer a target from the session would leave the text
   * and the action each holding their own answer to "which store?". Passing it
   * makes the card say and do the same thing, and exercises the Some branch of
   * the new argument rather than leaving it as a code path nothing walks.
   */
  const remediate = useCallback(
    async (action: 'suspend' | 'recover') => {
      if (!sessionToken || !resolvedStoreId) return;
      setRemedyBusy(action);
      setRemedyNote(null);
      try {
        const count =
          action === 'suspend'
            ? await suspendSurplusWorkspaceInstancesScoped(sessionToken, resolvedStoreId)
            : await recoverWorkspaceInstancesScoped(sessionToken, resolvedStoreId);
        setRemedyNote({
          kind: count === 0 ? 'none' : action === 'suspend' ? 'suspended' : 'recovered',
          count,
        });
        await refresh();
      } catch {
        setRemedyNote({ kind: 'failed', count: 0 });
      } finally {
        setRemedyBusy(null);
      }
    },
    [sessionToken, resolvedStoreId, refresh],
  );

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

        {/* §J B1. Deliberately OUTSIDE the over-quota block above: restoring
            suspended registers matters most when the tenant is no longer over
            quota — you upgraded, the numbers are clean, and the instances a
            downgrade suspended are still suspended. Gating this on
            overRows.length would hide the recovery path in exactly the state it
            exists for. */}
        {!failed && report !== null && (
          <div
            className="settings-license-quota-remedy"
            role="region"
            aria-label={l10n.getString('settings-license-quota-remedy-aria')}
            data-testid="over-quota-remedy"
          >
            <p className="settings-hint settings-license-quota-remedy-heading">
              <Localized id="settings-license-quota-remedy-title">
                <span>Workspace registers</span>
              </Localized>
            </p>
            <p className="settings-hint">
              <Localized id="settings-license-quota-remedy-hint" vars={{ store: resolvedStoreId }}>
                <span>{'Suspend the surplus registers of { $store }, or restore the ones an earlier downgrade suspended. Only this store is affected.'}</span>
              </Localized>
            </p>
            <div className="settings-license-quota-remedy-actions">
              <Button
                variant="secondary"
                loading={remedyBusy === 'suspend'}
                disabled={remedyBusy !== null}
                onClick={() => void remediate('suspend')}
                data-testid="over-quota-remedy-suspend"
              >
                <Localized id="settings-license-quota-remedy-suspend">
                  <span>Suspend surplus</span>
                </Localized>
              </Button>
              <Button
                variant="secondary"
                loading={remedyBusy === 'recover'}
                disabled={remedyBusy !== null}
                onClick={() => void remediate('recover')}
                data-testid="over-quota-remedy-recover"
              >
                <Localized id="settings-license-quota-remedy-recover">
                  <span>Restore suspended</span>
                </Localized>
              </Button>
            </div>
            {remedyNote && (
              <p
                className="settings-hint"
                role="status"
                aria-live="polite"
                data-testid="over-quota-remedy-note"
              >
                {remedyNote.kind === 'suspended' && (
                  <Localized id="settings-license-quota-remedy-suspended" vars={{ count: remedyNote.count }}>
                    <span>{'{ $count } surplus register(s) suspended. They are disabled, not deleted.'}</span>
                  </Localized>
                )}
                {remedyNote.kind === 'recovered' && (
                  <Localized id="settings-license-quota-remedy-recovered" vars={{ count: remedyNote.count }}>
                    <span>{'{ $count } suspended register(s) restored.'}</span>
                  </Localized>
                )}
                {remedyNote.kind === 'none' && (
                  <Localized id="settings-license-quota-remedy-none">
                    <span>Nothing to change — no register of this store is over the limit or suspended.</span>
                  </Localized>
                )}
                {remedyNote.kind === 'failed' && (
                  <Localized id="settings-license-quota-remedy-failed">
                    <span>That action failed. The quota numbers above are unchanged.</span>
                  </Localized>
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
