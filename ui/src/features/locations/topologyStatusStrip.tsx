//! Status strip for the topology editor canvas (composition C2): the
//! validation banner, the tier-capacity notice, the warehouse quota chip and
//! the unsaved-changes chip, in the order the editor rendered them inline.
//!
//! All behavior arrives as props - the strip owns no state and registers no
//! hooks, so mounting it cannot move the parent's hook order. Classes, roles
//! and Fluent ids are byte-verbatim from the inline original; the editor
//! suite reaches them directly, so nothing here may rename a selector.
//!
//! Like every overlay above the canvas, the pieces catch mousedown so
//! clicks do not fall through and start a canvas marquee/pan. Those guards
//! were previously inside the editor's canvas a11y suppression region; the
//! strip carries only the targeted, rule-named suppressions the linter
//! demands for them (same disclosure form as topologyRelationshipPicker).

import { Localized } from '@fluent/react';
import type { SubscriptionCapabilities } from '@/api/subscription';
import { WarningIcon } from './NodeTopologyIcons';
import { WarehouseQuotaChip } from './WarehouseQuotaChip';
import type { TopologyValidationError } from './topologyContract';
import type { TopologyDiffSummary } from './topologyDiff';
import type { useLocalization } from '@fluent/react';

export interface TopologyStatusStripProps {
  /** Graph-level validation errors rendered as the alert banner. */
  bannerGraphLevel: TopologyValidationError[];
  /** Tier gate + capacity metadata availability (Pro downgrade notice). */
  isProAllowed: boolean;
  hasCapacityMetadata: boolean;
  /** Subscription capabilities; the quota chip renders only when present. */
  caps: SubscriptionCapabilities | null;
  /** Warehouse node count for the quota chip. */
  warehouseCount: number;
  /** Apply-panel diff preview; the unsaved chip renders only when dirty. */
  dirtySummary: TopologyDiffSummary | null;
  /** Revision the diff preview counts from. */
  topologyRevision: number;
  /** Only getString is needed - banner items and the diff summary. */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
}

/** The canvas status strip the editor previously rendered inline. */
export function TopologyStatusStrip({
  bannerGraphLevel,
  isProAllowed,
  hasCapacityMetadata,
  caps,
  warehouseCount,
  dirtySummary,
  topologyRevision,
  l10n,
}: TopologyStatusStripProps) {
  return (
    // Each piece catches mousedown so clicks do not fall through to the
    // canvas and start a marquee/pan. Interaction lives in the select and
    // footer controls, so the pieces themselves have no activation handler.
    // (Same pattern as topologyRelationshipPicker's container.)
    <>
      {bannerGraphLevel.length > 0 && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          className="topology-validation-banner"
          role="alert"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {bannerGraphLevel.map((err) => (
            <span key={err.messageId} className="topology-validation-banner-item">
              {l10n.getString(err.messageId)}
            </span>
          ))}
        </div>
      )}
      {!isProAllowed && hasCapacityMetadata && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div className="topology-tier-notice" role="status" onMouseDown={(e) => e.stopPropagation()}>
          <WarningIcon size={14} />
          <span>
            <Localized id="topology-tier-capacity-notice">
              Warehouse capacity numbers are saved but not enforced on your current plan — upgrade to Pro to use capacity limits.
            </Localized>
          </span>
        </div>
      )}
      {caps && warehouseCount > 0 && (
        <WarehouseQuotaChip count={warehouseCount} maxWarehouses={caps.maxWarehouses} />
      )}
      {dirtySummary && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <span className="topology-dirty-chip" role="status" onMouseDown={(e) => e.stopPropagation()}>
          <span className="topology-dirty-dot" aria-hidden="true" />
          <Localized id="topology-unsaved">Unsaved changes</Localized>
          <span className="topology-diff-summary">
            {l10n.getString('topology-apply-workspace-diff', {
              created: dirtySummary.created,
              updated: dirtySummary.updated,
              archived: dirtySummary.archived,
              typeChanged: dirtySummary.typeChanged,
              from: topologyRevision,
              to: topologyRevision + 1,
            })}
          </span>
        </span>
      )}
    </>
  );
}
