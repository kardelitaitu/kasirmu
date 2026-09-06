/**
 * Memoized topology node card.
 *
 * Extracted from the editor's inline `nodes.map` render so a hover or
 * selection change re-renders ONLY the affected card instead of every card
 * on the canvas. For React.memo to pay off, every prop must be
 * referentially stable across unrelated renders — the editor satisfies that
 * by passing useCallback'd handlers and per-node derived values computed in
 * useMemo. The l10n object from @fluent/react is stable by construction.
 */

import { createElement, memo, type ReactNode, type RefObject, type SetStateAction, type Dispatch } from 'react';
import type { ReactLocalization } from '@fluent/react';
import type { TopologyNodeData, PortName } from './NodeTopologyEditor';
import type { TopologyValidationError } from './topologyContract';
import {
  iconForNode,
  socketSemanticIds,
  semanticPortLabelId,
  topologyUiString,
} from './topologyCard';
import { nodeHeight } from './topologyMetrics';
import Tooltip from '../../frontend/shell/Tooltip';

interface TelemetryBadge {
  badge: string;
  status: 'online' | 'warning' | 'offline';
}

export interface TopologyNodeCardProps {
  node: TopologyNodeData;
  isSelected: boolean;
  isConnectingSource: boolean;
  connectingFromNodeId: string | null;
  connectingFromPort: PortName | null;
  /** Semantic row index of the source socket (round 174 stacked ports). */
  connectingFromVariantIndex: number;
  /** The connection target currently hovered ON THIS CARD, or null. Derived
   *  in the parent's nodes.map so only the card whose target changed
   *  re-renders (null stays null for every unaffected card — memo-safe). */
  hoveredTarget: { port: PortName; variantIndex: number } | null;
  nodeErrors: TopologyValidationError[];
  /** Compact excess-count chip (round 113): "N Stock Rooms — 1 allowed"
   *  / "N Branch Locations — 1 allowed", rendered inside the validation
   *  note on nodes pinned by a tier-limit / extra-branch error. Null on
   *  every other card keeps the memo boundary clean. */
  countBadge?: string | null;
  /** Non-destructive overlap indicator (round 143): true when this card's
   *  box intersects another card's — a saved diagram can load stacked even
   *  though movement paths can no longer create overlaps. Renders a small
   *  badge; derived from live geometry, so it disappears when the user
   *  drags the card clear. A stable boolean keeps the memo boundary clean. */
  hasOverlap: boolean;
  /** One-click "add stock wire" guidance (round 80): set while the
   *  validation panel action is guiding the user to route stock into this
   *  warehouse — renders an info chip on the card. The editor clears it the
   *  moment the missing-stock-routing error resolves. */
  stockWireHint: boolean;
  /** Branch-diff overlay marker (round 158): 'only-here' tints the card red
   *  (the workspace exists in this branch's saved diagram only),
   *  'differing' amber (shared but wired/named/retyped differently). Null
   *  on every other card keeps the memo boundary clean. */
  overlayMarker?: 'only-here' | 'differing' | null;
  isFresh: boolean;
  isDimmed: boolean;
  isRenameable: boolean;
  renaming: boolean;
  renameDraft: string;
  l10n: Pick<ReactLocalization, 'getString'>;
  renameInputRef: RefObject<HTMLInputElement>;
  renameBaselineRef: { current: string | null };
  onSelect: (id: string) => void;
  onOpenNodeMenu: (e: React.MouseEvent, nodeId: string) => void;
  onCardMouseDown: (e: React.MouseEvent, nodeId: string) => void;
  onStartRename: (nodeId: string, currentName: string) => void;
  onCommitRename: (nodeId: string, fromKeyboard?: boolean) => void;
  onCancelRename: () => void;
  onRenameDraftChange: (draft: string) => void;
  onPersistRename: (nodeId: string, name: string) => void;
  onSetNodeName: (nodeId: string, name: string) => void;
  onSetNodeEnabled: (nodeId: string, enabled: boolean) => void;
  /** Dismiss the card's validation note (round 81). Only the
   *  missing-stock-routing prompt is semantically dismissable — the
   *  "intentionally empty" warehouse — so the affordance is gated on that
   *  error code alone. The editor persists the dismissal and the Apply
   *  gates (editor + screen) skip the resolved error. */
  onDismissNodeIssue?: (nodeId: string, messageId: string) => void;
  onPortClick: (e: React.MouseEvent, nodeId: string, port: PortName, variantIndex: number) => void;
  onHoverNode: Dispatch<SetStateAction<string | null>>;
  getTelemetry: (node: TopologyNodeData) => TelemetryBadge | null;
  isPortCompatible: (nodeId: string, port: PortName, variantIndex: number) => boolean;
}

function TopologyNodeCardImpl({
  node,
  isSelected,
  isConnectingSource,
  connectingFromNodeId,
  connectingFromPort,
  nodeErrors,
  countBadge,
  hasOverlap,
  stockWireHint,
  overlayMarker,
  isFresh,
  isDimmed,
  isRenameable,
  renaming,
  renameDraft,
  l10n,
  renameInputRef,
  renameBaselineRef,
  onSelect,
  onOpenNodeMenu,
  onCardMouseDown,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRenameDraftChange,
  onPersistRename,
  onSetNodeName,
  onSetNodeEnabled,
  onDismissNodeIssue,
  onPortClick,
  onHoverNode,
  getTelemetry,
  isPortCompatible,
  connectingFromVariantIndex,
  hoveredTarget,
}: TopologyNodeCardProps): ReactNode {
  // ── Stacked per-semantic port rows (round 174) ─────────────────
  // Each semantic a socket exposes becomes its own labeled row. Left
  // (input) rows and right (output) rows are both top-aligned columns in
  // the adaptive footer; the taller column sets the footer height.
  const leftRows = socketSemanticIds(node, 'left');
  const rightRows = socketSemanticIds(node, 'right');
  const rowClass = (
    port: PortName,
    variantIndex: number,
    semantics: string[],
  ): string => {
    const isActive = connectingFromNodeId === node.id
      && connectingFromPort === port
      && connectingFromVariantIndex === variantIndex;
    const isHovered = hoveredTarget?.port === port && hoveredTarget.variantIndex === variantIndex;
    const compatible = isPortCompatible(node.id, port, variantIndex);
    const showHighlight = connectingFromNodeId && connectingFromNodeId !== node.id && isHovered && compatible;
    return [
      'node-port-row',
      `node-port-row--${port}`,
      semantics.length > 1 ? 'node-port-row--multi' : '',
      isActive ? 'port-active' : '',
      showHighlight ? 'port-highlight' : '',
      compatible ? 'port-compatible' : '',
      connectingFromNodeId && !compatible ? 'port-incompatible' : '',
    ].filter(Boolean).join(' ');
  };
  const rowAria = (port: PortName, variantIndex: number): string => {
    const semanticId = socketSemanticIds(node, port)[variantIndex];
    const label = semanticId
      ? topologyUiString(l10n, semanticPortLabelId(node, port, semanticId))
      : topologyUiString(l10n, 'topology-port-aria', { name: node.name || '', port });
    return `${node.name}: ${label}`;
  };
  const rowTitle = (port: PortName, variantIndex: number): string => {
    const semanticId = socketSemanticIds(node, port)[variantIndex];
    return semanticId
      ? topologyUiString(l10n, semanticPortLabelId(node, port, semanticId))
      : topologyUiString(l10n, 'topology-port-aria', { name: node.name || '', port });
  };
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the canvas card is an interactive unit: selectable, draggable, keyboard-selectable (Enter/Space) and context-menuable; these are its purpose, not incidental handlers
    <div
      onContextMenu={(e) => onOpenNodeMenu(e, node.id)}
      onDoubleClick={() => {
        if (isRenameable) onStartRename(node.id, node.name);
      }}
      data-node-id={node.id}
      className={`topology-node node-type-${node.type} ${isSelected ? 'node-selected' : ''} ${isConnectingSource ? 'node-connecting-source' : ''}${isFresh ? ' node-fresh' : ''}${isDimmed ? ' node-dimmed' : ''}${overlayMarker ? ` topology-node--overlay-${overlayMarker}` : ''}`}
      style={{ left: `${node.x}px`, top: `${node.y}px`, height: `${nodeHeight(node)}px` }}
      // role=group — NOT aria-selected: group supports no selection state
      // and axe flagged every card (critical aria-allowed-attr). The card
      // also contains real controls (rename, enabled, port sockets), which
      // no aria-selected role (option/treeitem/gridcell) allows nested.
      // Selection is announced through the canvas live region instead.
      role="group"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the selectable card is focusable so Enter/Space select it from the keyboard
      tabIndex={0}
      aria-label={node.name}
      onMouseEnter={() => onHoverNode(node.id)}
      onMouseLeave={() => onHoverNode((prev) => (prev === node.id ? null : prev))}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(node.id); } }}
      // Keep the body selectable/draggable for existing canvas
      // workflows, while nested controls explicitly opt out.
      onMouseDown={(e) => {
        const target = e.target as Element;
        if (target.closest('input, button, select, textarea, [data-no-node-drag]')) return;
        onCardMouseDown(e, node.id);
      }}
    >
      <div className="node-header node-titlebar">
        {/* Region 1: node type icon */}
        <span className="node-type-icon">
          {/* The icon is a module-level component resolved from the kind
              registry (ADR #45 §3), not a component defined here — so this is
              createElement of an existing type rather than JSX with a
              computed tag, which `react-hooks/static-components` cannot tell
              apart from a render-local component. */}
          {createElement(iconForNode(node), { size: 16 })}
        </span>

        {/* Region 2: node title (flexible — grows to fill) */}
        <div className="node-title-wrapper">
          {isRenameable && renaming ? (
            <input
              ref={renameInputRef}
              className="node-card-rename-input"
              value={renameDraft}
              onChange={(e) => onRenameDraftChange(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void onCommitRename(node.id, true); }
                if (e.key === 'Escape') { e.preventDefault(); onCancelRename(); }
              }}
              onBlur={() => void onCommitRename(node.id)}
              aria-label={topologyUiString(l10n, node.type === 'store' ? 'topology-branch-rename-placeholder' : 'topology-workspace-rename-placeholder')}
            />
          ) : (
            <span className="node-title">{node.name}</span>
          )}
        </div>

        {/* Region 3: status — validation notification, or a green dot when
            the node is properly set up (no blocking errors). */}
        <div className="node-header-status">
          {nodeErrors && nodeErrors.length > 0 ? (
            <>
              <Tooltip
                content={(
                  <span className="node-validation-tip">
                  <span className="node-validation-text">{l10n.getString(nodeErrors[0]!.messageId)}</span>
                  {countBadge && <span className="node-validation-count-badge">{countBadge}</span>}
                  {nodeErrors[0]!.code === 'warehouse-missing-stock-routing' && onDismissNodeIssue && (
                    <button
                      type="button"
                      className="node-validation-note-dismiss"
                      aria-label={topologyUiString(l10n, 'topology-validation-dismiss', null)}
                      title={topologyUiString(l10n, 'topology-validation-dismiss', null)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => onDismissNodeIssue(node.id, nodeErrors[0]!.messageId)}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  )}
                </span>
              )}
              position="bottom"
              portal
              showDelay={300}
            >
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
              <span
                className="node-validation-note node-validation-chip"
                role="status"
                title={nodeErrors.map((e) => l10n.getString(e.messageId)).join('\n')}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span className="node-validation-icon" aria-hidden="true">!</span>
              </span>
            </Tooltip>
            <span className="node-validation-sr">{l10n.getString(nodeErrors[0]!.messageId)}</span>
            </>
          ) : (
            <span
              className="node-status-ok"
              title={topologyUiString(l10n, 'topology-node-status-ok')}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <circle cx="5" cy="5" r="5" fill="currentColor" />
              </svg>
              <span className="node-status-ok-sr">{topologyUiString(l10n, 'topology-node-status-ok')}</span>
            </span>
          )}
        </div>
      </div>

      <div className="node-body">
        <div className="node-body-meta">
          <span className="node-type-accent node-body-accent" aria-hidden="true" />
          <span className="node-grip" aria-hidden="true" title={l10n.getString('topology-node-drag-hint')}>
            <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
              <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
            </svg>
          </span>
          <span className="node-subtitle">{node.subtitle}</span>
        </div>
        <div className="node-body-status">
          {(() => {
            const peerGroup = node.metadata?.['peerGroup'] as string | undefined;
            if (peerGroup) {
              return (
                <span className="node-peer-group-badge" aria-hidden="true" title={topologyUiString(l10n, 'topology-peer-group-badge', { group: peerGroup })}>
                  {peerGroup}
                </span>
              );
            }
            return null;
          })()}
          {(() => {
            const telemetry = getTelemetry(node);
            if (!telemetry) return null;
            return (
              <span className={`node-telemetry-badge telemetry-${telemetry.status}`} aria-hidden="true">
                {telemetry.badge}
              </span>
            );
          })()}
          {hasOverlap && (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- stopPropagation keeps a click on the badge from starting a node drag
            <span
              className="node-overlap-badge"
              role="status"
              title={topologyUiString(l10n, 'topology-overlap-badge', null)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {topologyUiString(l10n, 'topology-overlap-badge', null)}
            </span>
          )}
          {isRenameable && !renaming && (
            <button
              type="button"
              className="node-card-rename-btn"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onStartRename(node.id, node.name)}
              aria-label={topologyUiString(l10n, node.type === 'store' ? 'topology-branch-rename-label' : 'topology-workspace-rename-label')}
              title={topologyUiString(l10n, node.type === 'store' ? 'topology-branch-rename-label' : 'topology-workspace-rename-label')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
          )}
        </div>
        {node.type === 'workspace' && (
          <div className="node-config-row">
            <label htmlFor={`node-name-${node.id}`} className="node-config-label">
              {topologyUiString(l10n, 'topology-field-name')}
            </label>
            <input
              id={`node-name-${node.id}`}
              className="node-config-input"
              onMouseDown={(e) => e.stopPropagation()}
              type="text"
              value={node.name}
              aria-label={topologyUiString(l10n, 'topology-field-name-aria', { name: node.name })}
              onChange={(e) => onSetNodeName(node.id, e.target.value)}
              onFocus={() => { renameBaselineRef.current = node.name; }}
              onBlur={() => void onPersistRename(node.id, node.name)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void onPersistRename(node.id, node.name); } }}
            />
          </div>
        )}
        {node.type === 'workspace' && (
          <label className="node-config-row node-config-toggle">
            <span className="node-config-label">{topologyUiString(l10n, 'topology-field-enabled')}</span>
            <input
              type="checkbox"
              onMouseDown={(e) => e.stopPropagation()}
              checked={node.metadata?.['enabled'] !== false}
              aria-label={topologyUiString(l10n, 'topology-field-enabled-aria', { name: node.name })}
              onChange={(e) => onSetNodeEnabled(node.id, e.target.checked)}
            />
          </label>
        )}
      </div>

      {stockWireHint && (
        <div className="node-stock-wire-hint" role="status">
          <span className="node-stock-wire-hint-icon" aria-hidden="true">→</span>
          <span className="node-stock-wire-hint-text">
            {topologyUiString(l10n, 'topology-node-stock-wire-hint', null)}
          </span>
        </div>
      )}

      {/* ── Footer: stacked per-semantic port rows ──────────────── */}
<div className="node-footer" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
        <div className="node-port-column node-port-column--left">
          {leftRows.map((_semantic, variantIndex) => (
            <button
              key={`left-${variantIndex}`}
              type="button"
              className={rowClass('left', variantIndex, leftRows)}
              onClick={(e) => onPortClick(e, node.id, 'left', variantIndex)}
              aria-label={rowAria('left', variantIndex)}
              title={rowTitle('left', variantIndex)}
            >
              <span className="node-port-marker" aria-hidden="true" />
              <span className="node-port-label">{rowTitle('left', variantIndex)}</span>
            </button>
          ))}
        </div>
        <div className="node-port-column node-port-column--right">
          {rightRows.map((_semantic, variantIndex) => (
            <button
              key={`right-${variantIndex}`}
              type="button"
              className={rowClass('right', variantIndex, rightRows)}
              onClick={(e) => onPortClick(e, node.id, 'right', variantIndex)}
              aria-label={rowAria('right', variantIndex)}
              title={rowTitle('right', variantIndex)}
            >
              <span className="node-port-label">{rowTitle('right', variantIndex)}</span>
              <span className="node-port-marker" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export const TopologyNodeCard = memo(TopologyNodeCardImpl);
