import { useCallback, useEffect, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import {
  getOverQuotaReport,
  isOverQuota,
  excessOf,
  perLocationMarkers,
  type OverQuotaMarkerRow,
  type OverQuotaReport,
  type QuotaUsageRow,
} from '@/api/subscription';
import { l10nErrorMessage } from '@/utils/app-error';
import {
  suspendSurplusWorkspaceInstancesScoped,
  recoverWorkspaceInstancesScoped,
} from '@/api/workspaces';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { isTabletShell } from '@/utils/shellKind';

/** Dimension key → FTL label, referenced literally so bundle parity can
 *  see every key is live (no dynamic composition). */
const DIMENSION_LABEL_IDS: Record<string, string> = {
  locations: 'settings-license-quota-dim-locations',
  pos_registers: 'settings-license-quota-dim-pos-registers',
  warehouses: 'settings-license-quota-dim-warehouses',
  staff: 'settings-license-quota-dim-staff',
  products: 'settings-license-quota-dim-products',
};

/** Per-location resource kind → FTL label (marker S4), same literal-reference
 *  rule as DIMENSION_LABEL_IDS. A map, not a conditional chain: the two-way
 *  ternary this replaced sent any THIRD kind to the warehouses label, so a
 *  new resource kind would have rendered mislabeled instead of unnamed. The
 *  fallback is unreachable through `perLocationMarkers` (it only passes kinds
 *  in the map) and names no other kind — it degrades to the tenant-global
 *  generic the same way the usage rows above do. */
const PER_LOCATION_LABEL_IDS: Record<string, string> = {
  kds_screen: 'settings-license-quota-dim-kds-screens',
  warehouse: 'settings-license-quota-dim-warehouses',
  topology_node: 'settings-license-quota-dim-topology-nodes',
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
  // Both remediation commands are registered on the desktop shell only, so the
  // tablet renders the assessment without the two actions. Read once, like the
  // other shell checks: a shell cannot become another shell.
  const actionsAvailable = !isTabletShell();
  // The store this session is bound to. Named `resolvedStoreId` on this context
  // (`storeId` is the separate useWorkspaceScope() value) — passing it to the
  // remediation commands is what keeps the hint text and the action in agreement.
  const { sessionToken, resolvedStoreId } = useWorkspace();
  const [report, setReport] = useState<OverQuotaReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Which action is in flight, and against which store — per-location rows and
   *  the store-level block share one busy state, so a click on one location must
   *  not put every other row's button into its loading shape. */
  const [remedyBusy, setRemedyBusy] = useState<
    { action: 'suspend' | 'recover'; store: string } | null
  >(null);
  const [remedyNote, setRemedyNote] = useState<
    | { kind: 'suspended' | 'recovered' | 'none'; count: number; store: string }
    | { kind: 'failed'; count: number; store: string; detail: string }
    | null
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
    async (action: 'suspend' | 'recover', store: string) => {
      if (!sessionToken || !store) return;
      setRemedyBusy({ action, store });
      setRemedyNote(null);
      try {
        // The store is always passed explicitly, including from the store-level
        // block below. `None` would let the backend pick the session store, which
        // is fine until a per-location row asks for a different one and the
        // fallback silently acts on the wrong database.
        const count =
          action === 'suspend'
            ? await suspendSurplusWorkspaceInstancesScoped(sessionToken, store)
            : await recoverWorkspaceInstancesScoped(sessionToken, store);
        setRemedyNote({
          kind: count === 0 ? 'none' : action === 'suspend' ? 'suspended' : 'recovered',
          count,
          store,
        });
        await refresh();
      } catch (err) {
        // Surface the refusal, not just that something failed. A per-location row
        // can legitimately be rejected — the backend validates the store id
        // against `locations` before opening anything, and a row that no longer
        // resolves (archived store, stale report) must say so. Swallowing that
        // into a generic failure is how a hidden no-op comes back to life.
        //
        // ERR-05/06 (ui/src/utils/app-error.ts): a screen must never render
        // `err.message` — raw backend text can carry SQL fragments, identifiers
        // and infrastructure detail. So the refusal is surfaced through the typed
        // kind mapping, and WHICH row it refused is carried by the store id the
        // note already prints. This first cut interpolated the raw message, which
        // reads as if it satisfies "show the refusal" while breaking the one rule
        // that decides how a refusal may be shown at all.
        setRemedyNote({
          kind: 'failed',
          count: 0,
          store,
          detail: l10nErrorMessage(err, l10n),
        });
      } finally {
        setRemedyBusy(null);
      }
    },
    // l10n is listed because the failure path now maps the error through
    // l10nErrorMessage; it is stable across renders, so the callback does not
    // re-create any more often than before.
    [sessionToken, refresh, l10n],
  );

  const overRows: QuotaUsageRow[] = report
    ? report.usages.filter(isOverQuota)
    : [];
  // Section J B3: computed per-location rows from the report's marker payload.
  const perLocationRows: OverQuotaMarkerRow[] = perLocationMarkers(report);

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
            {actionsAvailable && (
            <div className="settings-license-quota-remedy-actions">
              <Button
                variant="secondary"
                loading={remedyBusy?.action === 'suspend' && remedyBusy.store === resolvedStoreId}
                disabled={remedyBusy !== null}
                onClick={() => void remediate('suspend', resolvedStoreId)}
                data-testid="over-quota-remedy-suspend"
              >
                <Localized id="settings-license-quota-remedy-suspend">
                  <span>Suspend surplus</span>
                </Localized>
              </Button>
              <Button
                variant="secondary"
                loading={remedyBusy?.action === 'recover' && remedyBusy.store === resolvedStoreId}
                disabled={remedyBusy !== null}
                onClick={() => void remediate('recover', resolvedStoreId)}
                data-testid="over-quota-remedy-recover"
              >
                <Localized id="settings-license-quota-remedy-recover">
                  <span>Restore suspended</span>
                </Localized>
              </Button>
            </div>
            )}
            {remedyNote && (
              <p
                className="settings-hint"
                role="status"
                aria-live="polite"
                data-testid="over-quota-remedy-note"
              >
                {/* A store id, not prose: which location the sentence is about. */}
                <span className="settings-license-quota-remedy-store">{remedyNote.store}</span>
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
                  <Localized
                    id="settings-license-quota-remedy-failed-detail"
                    vars={{ reason: remedyNote.detail }}
                  >
                    <span>{'That action failed: { $reason }. The quota numbers above are unchanged.'}</span>
                  </Localized>
                )}
              </p>
            )}
          </div>
        )}

        {/* §J B3 — per-location caps. These rows exist because no tenant-global
            usages row CAN express them: KDS screens and warehouse instances are
            capped per location, so one tenant-wide number would either hide one
            store's excess or invent another's. Each row here is at or over its
            own cap, which is why the section is a short list rather than a full
            one: an absent location means it is fine, not that it was skipped
            (the fan-out visits every store database that exists).

            The row is also the picker. It carries the store id its own action
            needs, so acting on another location requires no selection UI — and
            that is safe only because the backend validates the id against
            locations before opening a store database (B1's choke point). If it
            refuses, the refusal renders above rather than being swallowed. */}
        {!failed && perLocationRows.length > 0 && (
          <div
            className="settings-license-quota-locations"
            role="region"
            aria-label={l10n.getString('settings-license-quota-loc-aria')}
            data-testid="over-quota-locations"
          >
            <p className="settings-hint settings-license-quota-loc-heading">
              <Localized id="settings-license-quota-loc-title">
                <span>Per-location limits</span>
              </Localized>
            </p>
            <ul className="settings-license-quota-list">
              {perLocationRows.map((row) => (
                <li
                  key={row.resourceType + ':' + row.resourceId}
                  className="settings-license-quota-row"
                  data-testid="over-quota-location-row"
                >
                  <span className="settings-license-quota-dim">{row.resourceId}</span>
                  <span className="settings-license-quota-dim">
                    <Localized
                      id={
                        PER_LOCATION_LABEL_IDS[row.resourceType] ??
                        'settings-license-quota-dim-locations'
                      }
                    >
                      <span>{row.resourceType}</span>
                    </Localized>
                  </span>
                  <span className="settings-license-quota-detail">
                    <Localized
                      id="settings-license-quota-over-line"
                      vars={{
                        current: row.current,
                        limit: row.limit ?? 0,
                        excess: Math.max(0, row.current - (row.limit ?? 0)),
                      }}
                    >
                      <span>{'{ $current } of { $limit } — { $excess } over'}</span>
                    </Localized>
                  </span>
                  {actionsAvailable && (
                    <Button
                      variant="secondary"
                      loading={remedyBusy?.action === 'suspend' && remedyBusy.store === row.resourceId}
                      disabled={remedyBusy !== null}
                      onClick={() => void remediate('suspend', row.resourceId)}
                    >
                      <Localized id="settings-license-quota-remedy-suspend">
                        <span>Suspend surplus</span>
                      </Localized>
                    </Button>
                  )}
                  {actionsAvailable && (
                    <Button
                      variant="secondary"
                      loading={remedyBusy?.action === 'recover' && remedyBusy.store === row.resourceId}
                      disabled={remedyBusy !== null}
                      onClick={() => void remediate('recover', row.resourceId)}
                    >
                      <Localized id="settings-license-quota-remedy-recover">
                        <span>Restore suspended</span>
                      </Localized>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
