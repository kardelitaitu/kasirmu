import type { ReactNode } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import { CheckIcon } from './NodeTopologyIcons';

/**
 * Topology editor header — extracted from `NodeTopologyEditor.tsx`
 * (Phase 2 split). Presentational: every action is a prop so the parent
 * keeps all canvas state and save logic. The header renders the sr-only
 * builder heading, the parent's branch toolbar slot, the view-only note,
 * the tier badge, and the Apply button.
 */

export interface TopologyHeaderProps {
  /** Localizer for permission tooltip. */
  l10n: ReturnType<typeof useLocalization>['l10n'];
  /** Optional toolbar content rendered inside the header (branch selector). */
  branchToolbar?: ReactNode;
  /** False renders the view-only notice and disables Apply. */
  canSave: boolean;
  /** Whether the parent supplied an onSave handler (gates Apply + tooltip). */
  onSaveAvailable: boolean;
  currentTier: string;
  saving: boolean;
  /** Runs the full Apply gate: validate → diff preview → PIN confirm. */
  onApply: () => void;
}

export function TopologyHeader({
  l10n,
  branchToolbar,
  canSave,
  onSaveAvailable,
  currentTier,
  saving,
  onApply,
}: TopologyHeaderProps) {
  return (
    <div className="node-topology-header">
      {/* Visually-hidden heading keeps the topology screen's heading
          hierarchy (h2 → h3 Palette Tools) intact for assistive tech
          without occupying header space. */}
      <Localized id="topology-builder-title">
        <h2 className="sr-only">Visual Store & Workspace Topology Builder</h2>
      </Localized>
      {branchToolbar}
      {!canSave && (
        <div className="topology-readonly-note" role="status">
          <Localized id="topology-readonly-note">
            <span>View-only — only managers and owners can save topology changes.</span>
          </Localized>
        </div>
      )}
      <span className={`topology-tier-badge tier-${currentTier}`}>
        <Localized id="topology-tier-suffix" vars={{ tier: currentTier.toUpperCase() }}>
          <span>{currentTier.toUpperCase()} TIER</span>
        </Localized>
      </span>

      <div className="node-topology-header-actions">
        <Button
          variant="primary"
          disabled={!canSave || saving || !onSaveAvailable}
          title={canSave && onSaveAvailable ? undefined : l10n.getString('topology-apply-permission-tooltip')}
          onClick={onApply}
          icon={<CheckIcon size={16} />}
        >
          <Localized id="topology-apply-changes">Apply Topology</Localized>
        </Button>
      </div>
    </div>
  );
}
