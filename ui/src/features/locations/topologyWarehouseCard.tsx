/**
 * Warehouse (Stock Room) settings card for the node inspector.
 *
 * The warehouse is diagram-level — unlike the workspace settings cards,
 * which read and write live backend settings, this card edits per-node
 * properties (capacity and low-stock threshold) that persist in the
 * diagram's node metadata. The editor writes them through the stable
 * handleSetNodeMetadata callback so edits flow through beginInspectorEdit
 * and the normal dirty/save cycle (canvasStateEqual projects the keys).
 */

import { Localized } from '@fluent/react';
import { LockIcon } from './NodeTopologyIcons';
import type { TopologyNodeData } from './NodeTopologyEditor';

export interface WarehouseSettingsCardProps {
  node: TopologyNodeData;
  onChange: (nodeId: string, patch: Record<string, unknown>) => void;
  /** Pro-tier gate (round 78): capacity + low-stock are the enforced
   *  numbers (rounds 72/75/76), so on non-Pro tiers the inputs are
   *  disabled with a lock badge — mirroring the tool-card lock. Current
   *  Stock stays editable everywhere: it drives the display-only badge. */
  capacityLocked?: boolean;
}

function readNumber(node: TopologyNodeData, key: string): number | undefined {
  const v = node.metadata?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function WarehouseSettingsCard({ node, onChange, capacityLocked = false }: WarehouseSettingsCardProps) {
  const capacity = readNumber(node, 'capacity');
  const lowStockThreshold = readNumber(node, 'lowStockThreshold');
  const stock = readNumber(node, 'stock');

  return (
    <div className="inspector-section" data-testid="warehouse-inspector">
      <h4>
        <Localized id="topology-warehouse-settings-title">Warehouse Settings</Localized>
      </h4>
      <label className="inspector-field">
        <span>
          <Localized id="topology-warehouse-capacity">Capacity</Localized>
          {capacityLocked && (
            <span className="inspector-lock-badge"><LockIcon size={12} /> <Localized id="topology-lock-pro">Pro</Localized></span>
          )}
        </span>
        <input
          type="number"
          min={0}
          disabled={capacityLocked}
          value={capacity ?? ''}
          onChange={(e) => {
            // Whole number only — ignore fractional in-progress input
            // instead of silently truncating it via parseInt.
            const v = Number(e.target.value);
            if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
              onChange(node.id, { capacity: e.target.value === '' ? 0 : v });
            }
          }}
        />
        <span className="inspector-hint">
          {capacityLocked ? (
            <Localized id="topology-warehouse-capacity-locked-hint">Upgrade to Pro to set capacity limits.</Localized>
          ) : (
            <Localized id="topology-warehouse-capacity-desc">Max items this Warehouse can hold</Localized>
          )}
        </span>
      </label>
      <label className="inspector-field">
        <span>
          <Localized id="topology-warehouse-low-stock-threshold">Low-Stock Threshold</Localized>
          {capacityLocked && (
            <span className="inspector-lock-badge"><LockIcon size={12} /> <Localized id="topology-lock-pro">Pro</Localized></span>
          )}
        </span>
        <input
          type="number"
          min={0}
          disabled={capacityLocked}
          value={lowStockThreshold ?? ''}
          onChange={(e) => {
            // Whole number only — ignore fractional in-progress input
            // instead of silently truncating it via parseInt.
            const v = Number(e.target.value);
            if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
              onChange(node.id, { lowStockThreshold: e.target.value === '' ? 0 : v });
            }
          }}
        />
        <span className="inspector-hint">
          {capacityLocked ? (
            <Localized id="topology-warehouse-capacity-locked-hint">Upgrade to Pro to set capacity limits.</Localized>
          ) : (
            <Localized id="topology-warehouse-low-stock-desc">Alert when stored stock drops to or below this count</Localized>
          )}
        </span>
      </label>
      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- text is provided by <Localized> child */}
      <label className="inspector-field">
        <span><Localized id="topology-warehouse-stock">Current Stock</Localized></span>
        <input
          type="number"
          min={0}
          value={stock ?? ''}
          onChange={(e) => {
            // Whole number only — ignore fractional in-progress input
            // instead of silently truncating it via parseInt.
            const v = Number(e.target.value);
            if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
              onChange(node.id, { stock: e.target.value === '' ? 0 : v });
            }
          }}
        />
        <span className="inspector-hint">
          <Localized id="topology-warehouse-stock-desc">Items currently stored in this Warehouse</Localized>
        </span>
      </label>
    </div>
  );
}
