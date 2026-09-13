// ── ToolsCategoryGrid component (todo-tools-agents-2.md) ─────────────
//
// Renders the categorized Tools grid in WorkspaceHome.
// Groups tools into Operations, Insights, and Configuration sections
// according to the declarative information architecture in tools.tsx.

import type { ReactElement } from 'react';
import { Localized } from '@fluent/react';
import type { ToolItem, ToolGroupId } from '../tools';
import { ToolCard, type ToolLockReason } from './ToolCard';

export interface CategorizedToolEntry {
  tool: ToolItem;
  lock: ToolLockReason | 'none';
}

export interface CategorizedToolGroup {
  id: ToolGroupId;
  tools: CategorizedToolEntry[];
}

export interface ToolsCategoryGridProps {
  groups: CategorizedToolGroup[];
  onNavigate: (route: string) => void;
  getAriaLabel: (key: string) => string;
}

export function ToolsCategoryGrid({
  groups,
  onNavigate,
  getAriaLabel,
}: ToolsCategoryGridProps): ReactElement | null {
  if (groups.length === 0) return null;

  return (
    <div className="workspace-section">
      <div className="workspace-section-header">
        <h2 className="workspace-section-title">
          <Localized id="workspace-home-tools-section">
            <span>Tools</span>
          </Localized>
        </h2>
      </div>
      {groups.map((group) => (
        <div key={group.id} className="workspace-tools-group">
          <h3 className="workspace-tools-group-title">
            <Localized id={`workspace-home-tools-group-${group.id}`}>
              <span>
                {group.id === 'operations'
                  ? 'Operations'
                  : group.id === 'insights'
                  ? 'Insights'
                  : 'Configuration'}
              </span>
            </Localized>
          </h3>
          <div className="workspace-tools-grid">
            {group.tools.map(({ tool, lock }) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                lock={lock}
                onNavigate={onNavigate}
                ariaLabel={getAriaLabel(tool.labelKey)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
