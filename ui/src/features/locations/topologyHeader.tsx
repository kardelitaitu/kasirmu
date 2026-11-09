import type { ReactNode } from 'react';
import { Localized } from '@fluent/react';
import type { useLocalization } from '@fluent/react';
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
  /** When true, authoring is managed centrally from web dashboard (ADR-66 D3). */
  webAuthoringManaged?: boolean;
}

export function TopologyHeader({
  l10n,
  branchToolbar,
  canSave,
  onSaveAvailable,
  currentTier,
  saving,
  onApply,
  webAuthoringManaged = false,
}: TopologyHeaderProps) {
  return (
    <div className="node-topology-header">
      {/* THE PAGE TITLE, and the root of the editor's heading outline.
          Visually hidden so the editor keeps its vertical space.
          This element was an <h2> until round 35, under a comment that claimed
          that kept "h2 → h3 Palette Tools" intact. The claim was true and the
          consequence was the bug: the screen had no <h1> at all, so the outline
          started at level two and a screen reader had no page name.
          It is an <h1> now because a page needs exactly one. Editor-internal
          groupings stay <h3> (rack panel, empty state) and remain correct ONLY
          because the screen supplies a level-two heading between this and them
          -- see TopologyScreen.tsx's "Editor sections" heading. Measured: with
          the <h1> and no level-two heading, axe reported three `heading-order`
          violations on `h3`. Promote this alone and you re-open that defect. */}
      <Localized id="topology-builder-title">
        <h1 className="sr-only">Visual Store & Workspace Topology Builder</h1>
      </Localized>
      {branchToolbar}
      {webAuthoringManaged ? (
        <div className="topology-web-managed-badge" role="status" data-testid="topology-web-managed-badge">
          <Localized id="topology-web-managed-notice">
            <span>Managed via Web Dashboard (Read-Only)</span>
          </Localized>
        </div>
      ) : !canSave ? (
        <div className="topology-readonly-note" role="status">
          <Localized id="topology-readonly-note">
            <span>View-only — saving topology changes requires the topology:write permission.</span>
          </Localized>
        </div>
      ) : null}
      <span className={`topology-tier-badge tier-${currentTier}`}>
        <Localized id="topology-tier-suffix" vars={{ tier: currentTier.toUpperCase() }}>
          <span>{currentTier.toUpperCase()} TIER</span>
        </Localized>
      </span>

      {!webAuthoringManaged && (
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
      )}
    </div>
  );
}
