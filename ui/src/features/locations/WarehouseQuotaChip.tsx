import { useLocalization } from '@fluent/react';
import { WarningIcon } from './NodeTopologyIcons';

export type WarehouseQuotaState = 'ok' | 'at' | 'over' | 'unlimited';

/**
 * Maps an in-graph warehouse-node count against the tenant tier warehouse cap
 * (from SubscriptionCapabilities.maxWarehouses) to a display state.
 *
 * `maxWarehouses` is `null` for unlimited tiers (Premium / Enterprise), which
 * can never be over/at a numeric limit. Mirrors the downgrade over-quota
 * semantics (todo-global-saas-2.md S-J): `over` = current > limit (needs
 * remediation), `at` = current === limit (blocks new creation), `ok` = headroom
 * remains. No new IPC — the count comes from the editor's in-graph node state.
 */
export function warehouseQuotaStatus(
  count: number,
  maxWarehouses: number | null,
): WarehouseQuotaState {
  if (maxWarehouses === null) return 'unlimited';
  if (count > maxWarehouses) return 'over';
  if (count === maxWarehouses) return 'at';
  return 'ok';
}

export interface WarehouseQuotaChipProps {
  count: number;
  maxWarehouses: number | null;
}

/**
 * Compact readout shown inside the Topology Editor canvas when a store's
 * warehouse-node count approaches or exceeds the tenant tier cap. Driven by the
 * in-graph node count and SubscriptionCapabilities.maxWarehouses — no new IPC.
 * The editor only mounts this when the count is > 0 and caps have loaded.
 *
 * Each FTL key is passed as a literal to `getString` so the i18n / bundle-parity
 * / orphan gates can statically resolve the reference.
 */
export function WarehouseQuotaChip({ count, maxWarehouses }: WarehouseQuotaChipProps) {
  const { l10n } = useLocalization();
  const status = warehouseQuotaStatus(count, maxWarehouses);
  // 'at' reuses the neutral key but is visually distinguished by its class.
  const text =
    status === 'over'
      ? l10n.getString('topology-warehouse-quota-over', { count, limit: maxWarehouses ?? 0 })
      : status === 'unlimited'
        ? l10n.getString('topology-warehouse-quota-unlimited', { count, limit: maxWarehouses ?? 0 })
        : l10n.getString('topology-warehouse-quota', { count, limit: maxWarehouses ?? 0 });
  const warn = status === 'at' || status === 'over';
  return (
    <div
      className={`topology-warehouse-quota topology-warehouse-quota--${status}`}
      role="status"
    >
      {warn && <WarningIcon size={14} />}
      <span>{text}</span>
    </div>
  );
}

export default WarehouseQuotaChip;
