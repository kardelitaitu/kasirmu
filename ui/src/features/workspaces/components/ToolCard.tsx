// ── ToolCard component (todo-tools-agents-2.md) ───────────────────────
//
// Renders an individual tool card in the home Tools grid.
// An entitled tool renders an interactive button with click navigation.
// A locked tool (insufficient tier, inactive subscription, or role restriction)
// renders an aria-disabled card displaying a lock icon and localized badge.
//
// A locked card separates two different facts, and states each exactly once:
//
//   THE REASON it is shut — tier / lifecycle / role — as a text pill in the
//   card body, carrying the lock glyph.
//
//   THE PLAN the tool needs, as the tier badge artwork pinned to the card's
//   bottom-right corner. A plan requirement is not a lock, so the badge
//   deliberately does NOT carry the glyph.
//
// Measured 2026-10-03 on a provisioned tablet with no subscription row: the
// lifecycle gate shut all 17 cards and every one carried the identical generic
// "Subscription inactive" caption, which left the plan a merchant must buy
// invisible on the very screen whose job is to sell it.
//
// The tier case is why the reason pill is now conditional. When the tier IS the
// reason, the badge already names the plan and a pill repeating it in words
// would say one thing twice — so `lock === 'tier'` renders the badge alone.
// That can never leave a card with no explanation at all: `toolLock` returns
// 'tier' only when `tierSatisfies` fails, and a `'free'` minimum always
// satisfies (tierLevel.ts:32), so a tier lock implies a paid minimum, which
// implies the badge. Symmetrically, the one tool carrying `lockBelowRole`
// (Settings) is `minimumTier: 'free'`, so a role-locked card never advertises a
// plan that buying it would not unlock.
//
// The card stays greyed out and non-clickable either way — this changes the
// caption, never the gate.

import type { ReactElement } from 'react';
import { Localized } from '@fluent/react';
import type { ToolItem } from '../tools';
import { TIER_BADGE } from '@/utils/tierBadge';

export type ToolLockReason = 'tier' | 'subscription' | 'role';

export interface ToolCardProps {
  tool: ToolItem;
  lock: ToolLockReason | 'none';
  onNavigate: (route: string) => void;
  ariaLabel: string;
}

export function ToolCard({
  tool,
  lock,
  onNavigate,
  ariaLabel,
}: ToolCardProps): ReactElement {
  if (lock === 'none') {
    return (
      <button
        type="button"
        className="workspace-tool-card"
        data-testid="workspace-tool-card"
        onClick={() => onNavigate(tool.route)}
        aria-label={ariaLabel}
      >
        <div className="workspace-tool-icon">{tool.icon}</div>
        <div className="workspace-tool-body">
          <h3 className="workspace-tool-name">
            <Localized id={tool.labelKey}>
              <span>{tool.id}</span>
            </Localized>
          </h3>
          <p className="workspace-tool-desc">
            <Localized id={tool.descKey}>
              <span></span>
            </Localized>
          </p>
        </div>
      </button>
    );
  }

  const badge = TIER_BADGE[tool.access.minimumTier];

  return (
    <div
      className="workspace-tool-card workspace-tool-card--locked"
      data-testid="workspace-tool-card-locked"
      aria-disabled="true"
    >
      <div className="workspace-tool-icon">{tool.icon}</div>
      <div className="workspace-tool-body">
        <h3 className="workspace-tool-name">
          <Localized id={tool.labelKey}>
            <span>{tool.id}</span>
          </Localized>
        </h3>
        <p className="workspace-tool-desc">
          <Localized id={tool.descKey}>
            <span></span>
          </Localized>
        </p>
        {/* The reason pill. `lock === 'tier'` is absent on purpose — the badge
            below is the statement of the plan, and the pill would repeat it. */}
        {lock !== 'tier' && (
          <span className="workspace-tool-lock-badge">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="11"
              height="11"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            {lock === 'subscription' && (
              <Localized id="workspace-home-tools-subscription-inactive">
                <span>Subscription inactive</span>
              </Localized>
            )}
            {lock === 'role' && (
              <Localized id="workspace-home-tools-requires-role">
                <span>Admin access required</span>
              </Localized>
            )}
          </span>
        )}
      </div>
      {/* The plan badge, pinned bottom-right. The artwork is decorative — the
          accessible statement of the plan is the hidden text beside it, which
          is the same Fluent message the reason pill used to carry. That is why
          the key keeps a reference and the orphan lint stays satisfied.
          `workspace-sr-only`, not the global `sr-only`: see WorkspaceHome.css. */}
      {tool.access.minimumTier !== 'free' && (
        <span className="workspace-tool-tier-badge">
          <img
            src={badge.src}
            width={badge.width}
            height={badge.height}
            alt=""
            aria-hidden="true"
          />
          <Localized id={`workspace-home-tools-requires-tier-${tool.access.minimumTier}`}>
            <span className="workspace-sr-only">Requires {tool.access.minimumTier} plan</span>
          </Localized>
        </span>
      )}
    </div>
  );
}
