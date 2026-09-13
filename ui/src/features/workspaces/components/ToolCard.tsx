// ── ToolCard component (todo-tools-agents-2.md) ───────────────────────
//
// Renders an individual tool card in the home Tools grid.
// An entitled tool renders an interactive button with click navigation.
// A locked tool (insufficient tier, inactive subscription, or role restriction)
// renders an aria-disabled card displaying a lock icon and localized badge.

import type { ReactElement } from 'react';
import { Localized } from '@fluent/react';
import type { ToolItem } from '../tools';

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
          {lock === 'tier' && (
            <Localized id={`workspace-home-tools-requires-tier-${tool.access.minimumTier}`}>
              <span>Requires {tool.access.minimumTier} plan</span>
            </Localized>
          )}
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
      </div>
    </div>
  );
}
