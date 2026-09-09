//! Node-map layer for the topology editor canvas (composition C6-e): the
//! one TopologyNodeCard per node, with the per-card hover-target pre-compute
//! that lets React.memo skip unaffected cards.
//!
//! All behavior arrives as props - the layer owns no state and registers no
//! hooks, and is NOT memoized (plain function renders 1:1 where the inline
//! block sat; the editor suite pins the node-card render identity and the
//! churn itself, so no wrapper may add memoization or new callbacks). The
//! inline original rendered the map unconditionally, so there is no guard
//! and no wrapper element: a zero-node graph renders zero cards. JSX is
//! byte-verbatim - class names, data-node-id and the .topology-node element
//! tree inside TopologyNodeCard are reached by the editor suite directly.
//! The per-item _htn pre-compute stays inside the map body. No css import.
//!
//! Parent memos (nodeErrorsByNode, excessBadgeByNode, overlappingNodeIds,
//! compareDimSet, overlayMarkerById, selectedNodeIds) arrive by reference
//! and are read directly - never copied or cloned. EMPTY_ERRORS stays the
//! editor's module-local constant and travels as the emptyErrors prop:
//! the layer must not export or re-declare it.

import type { Dispatch, MouseEvent as ReactMouseEvent, RefObject, SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import type { PortName, TopologyNodeData } from './nodeTopologyEditorTypes';
import type { TopologyValidationError } from './topologyContract';
import { TopologyNodeCard } from './topologyNodeCard';

export interface TopologyNodeMapLayerProps {
  /** The parent's nodes (full list; the map body stays verbatim). */
  nodes: TopologyNodeData[];
  /** Selection / per-node derived maps and sets, by reference. */
  selectedNodeIds: ReadonlySet<string>;
  nodeErrorsByNode: ReadonlyMap<string, TopologyValidationError[]>;
  excessBadgeByNode: ReadonlyMap<string, string>;
  overlappingNodeIds: ReadonlySet<string>;
  compareDimSet: ReadonlySet<string>;
  overlayMarkerById: ReadonlyMap<string, 'only-here' | 'differing'>;
  /** The editor's module-local EMPTY_ERRORS (passed, not moved). */
  emptyErrors: TopologyValidationError[];
  /** Hover + connection state. */
  hoveredTarget: { nodeId: string; port: PortName; variantIndex: number } | null;
  hoverConnections: Set<string> | null;
  connectingFromNodeId: string | null;
  connectingFromPort: PortName | null;
  connectingFromVariantIndex: number;
  /** Freshness + hint flags. */
  freshNodeIds: ReadonlySet<string>;
  addStockWireHintId: string | null;
  /** Node rename state (the rename hook's live values). */
  renamingNodeId: string | null;
  renameDraft: string;
  renameInputRef: RefObject<HTMLInputElement>;
  renameBaselineRef: { current: string | null };
  /** Only getString is needed (node card labels). */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
  /** Card handlers, passed through unwrapped with the card's own prop
   *  names (no new useCallback - the memo suite pins the churn itself). */
  onSelect: (id: string) => void;
  onOpenNodeMenu: (e: ReactMouseEvent, nodeId: string) => void;
  onCardMouseDown: (e: React.MouseEvent, nodeId: string) => void;
  onStartRename: (nodeId: string, currentName: string) => void;
  onCommitRename: (nodeId: string, fromKeyboard?: boolean) => void;
  onCancelRename: () => void;
  onRenameDraftChange: (draft: string) => void;
  onPersistRename: (nodeId: string, name: string) => void;
  onSetNodeName: (nodeId: string, name: string) => void;
  onSetNodeEnabled: (nodeId: string, enabled: boolean) => void;
  onPortClick: (e: React.MouseEvent, nodeId: string, port: PortName, variantIndex: number) => void;
  onHoverNode: Dispatch<SetStateAction<string | null>>;
  onDismissNodeIssue: (nodeId: string, messageId: string) => void;
  onDisconnect: (nodeId: string) => void;
  getTelemetry: (node: TopologyNodeData) => { badge: string; status: 'online' | 'warning' | 'offline' } | null;
  isPortCompatible: (nodeId: string, port: PortName, variantIndex: number) => boolean;
  /** Rename affordance gates (parent's editor-level props). */
  onRenameBranch: ((id: string, name: string) => Promise<boolean> | boolean | void) | undefined;
  onRenameWorkspace: ((id: string, name: string) => Promise<boolean> | boolean | void) | undefined;
}

/** The node map the editor previously rendered inline. */
export function TopologyNodeMapLayer({
  nodes,
  selectedNodeIds,
  nodeErrorsByNode,
  excessBadgeByNode,
  overlappingNodeIds,
  compareDimSet,
  overlayMarkerById,
  emptyErrors,
  hoveredTarget,
  hoverConnections,
  connectingFromNodeId,
  connectingFromPort,
  connectingFromVariantIndex,
  freshNodeIds,
  addStockWireHintId,
  renamingNodeId,
  renameDraft,
  renameInputRef,
  renameBaselineRef,
  l10n,
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
  onPortClick,
  onHoverNode,
  onDismissNodeIssue,
  onDisconnect,
  getTelemetry,
  isPortCompatible,
  onRenameBranch,
  onRenameWorkspace,
}: TopologyNodeMapLayerProps) {
  return (
    <>
      {nodes.map((node) => {
        // Pre-compute per-port hover booleans so React.memo can
        // skip re-rendering unaffected cards when the target moves.
        const _htn = hoveredTarget?.nodeId === node.id ? hoveredTarget : null;
        return (
        <TopologyNodeCard
          key={node.id}
          node={node}
          isSelected={selectedNodeIds.has(node.id)}
          isConnectingSource={connectingFromNodeId === node.id}
          connectingFromNodeId={connectingFromNodeId}
          connectingFromPort={connectingFromPort}
          connectingFromVariantIndex={connectingFromVariantIndex}
          hoveredTarget={_htn ? { port: _htn.port, variantIndex: _htn.variantIndex } : null}
          nodeErrors={nodeErrorsByNode.get(node.id) ?? emptyErrors}
          countBadge={excessBadgeByNode.get(node.id) ?? null}
          hasOverlap={overlappingNodeIds.has(node.id)}
          stockWireHint={addStockWireHintId === node.id}
          onDismissNodeIssue={onDismissNodeIssue}
          isFresh={freshNodeIds.has(node.id)}
          /* Hover focus is the transient, specific intent: while it is
             active it fully takes over, so the inspected card and its
             connections light up even when compare focus would dim
             them (round 163). Compare dimming applies outside hover. */
          isDimmed={(hoverConnections !== null && !hoverConnections.has(node.id))
            || (compareDimSet.has(node.id) && hoverConnections === null)}
          isRenameable={(node.type === 'store' && !!onRenameBranch) || (node.type === 'workspace' && !!onRenameWorkspace)}
          renaming={renamingNodeId === node.id}
          renameDraft={renameDraft}
          l10n={l10n}
          renameInputRef={renameInputRef}
          renameBaselineRef={renameBaselineRef}
          onSelect={onSelect}
          onOpenNodeMenu={onOpenNodeMenu}
          onCardMouseDown={onCardMouseDown}
          onStartRename={onStartRename}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          onRenameDraftChange={onRenameDraftChange}
          onPersistRename={onPersistRename}
          onSetNodeName={onSetNodeName}
          onSetNodeEnabled={onSetNodeEnabled}
          onPortClick={onPortClick}
          onHoverNode={onHoverNode}
          getTelemetry={getTelemetry}
          isPortCompatible={isPortCompatible}
          overlayMarker={overlayMarkerById.get(node.id) ?? null}
          onDisconnect={onDisconnect}
        />
        );
      })}
    </>
  );
}
