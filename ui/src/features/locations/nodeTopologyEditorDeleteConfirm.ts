//! Delete-confirmation flow for the topology editor (Phase 5 slice P5-B/S5).
//!
//! Owns the whole pre-dialog-to-committed-removal seam: the two confirmation
//! states (single-node `confirmDelete`, batch `confirmDeleteMany`), the
//! Branch-Location anchor guard, the shared delete commit (one history entry,
//! every touching wire goes with the nodes — the rule itself lives in
//! topologyCommands.deletableNodeIds so no creation path can sidestep it), and
//! executeDelete, the ConfirmDialog's onConfirm for both dialogs, which also
//! resolves the wire-delete case: a single wire must NOT cancel a connection
//! in flight, yet must cancel it when the wire being removed is the exact
//! duplicate pair the pending connection would recreate.
//!
//! Bodies, comments and dep arrays are BYTE-IDENTICAL to the inline originals,
//! including the pre-existing comment placement above isBranchLocation (it
//! describes deleteNodes and sat there already — re-flowing it is out of
//! contract). ZERO deviations: every name the moved callbacks read arrives as a
//! deps field that its own dep array already lists, so react-hooks 7.1.1
//! demands nothing new and no suppression comment was added.
//!
//! The states moved with the callbacks, so this hook is state-owning; its call
//! site is the slot isBranchLocation/deleteNodes occupied, which is ABOVE the
//! keyboard controller that consumes confirmDelete/confirmDeleteMany/the two
//! setters/isBranchLocation/deleteNodes as arguments, and BELOW the unmount
//! sweep and every producer it reads. Nothing above that slot read either
//! state, so no TDZ was introduced and no parent effect crossed another.

import { useCallback, useState, type SetStateAction } from 'react';
import { deletableNodeIds, nodesWithoutIds, wiresWithoutEndpoints } from './topologyCommands';
import type { PortName, TopologyNodeData, TopologyWireData } from './nodeTopologyEditorTypes';

export interface TopologyDeleteConfirmDeps {
  /** Live node list — the anchor guard and the delete commit both read it. */
  nodes: TopologyNodeData[];
  /** Live wire list, for the duplicate-pair cancellation test. */
  wires: TopologyWireData[];
  /** Selected wire — a bare '' / id routes the single-wire delete branch. */
  selectedWireId: string | null;
  /** In-flight connection source, read only by the duplicate-pair test. */
  connectingFromNodeId: string | null;
  connectingFromPort: PortName | null;
  /** History push, shared with every other mutation path (declared above the
   *  call site, so no deferred wrapper arrow is needed here). */
  pushHistory: (snapshot?: { nodes: TopologyNodeData[]; wires: TopologyWireData[] }) => void;
  /** Graph setters: the node delete writes both lists. */
  setNodes: (value: SetStateAction<TopologyNodeData[]>) => void;
  setWires: (value: SetStateAction<TopologyWireData[]>) => void;
  /** Selection reset after a node delete. */
  clearSelection: () => void;
  /** Wire selection reset after a wire delete. */
  clearWire: () => void;
  /** Connection reducer dismissal, used only by the duplicate-pair case. */
  cancelConnection: () => void;
}

/**
 * The confirmation states and the two delete commits, with the same
 * per-render identities the inline originals had.
 */
export function useTopologyEditorDeleteConfirm(deps: TopologyDeleteConfirmDeps): {
  confirmDelete: string | null;
  setConfirmDelete: (value: SetStateAction<string | null>) => void;
  confirmDeleteMany: string[] | null;
  setConfirmDeleteMany: (value: SetStateAction<string[] | null>) => void;
  isBranchLocation: (nodeId: string) => boolean;
  deleteNodes: (ids: string[]) => void;
  executeDelete: () => void;
} {
  const {
    nodes,
    wires,
    selectedWireId,
    connectingFromNodeId,
    connectingFromPort,
    pushHistory,
    setNodes,
    setWires,
    clearSelection,
    clearWire,
    cancelConnection,
  } = deps;

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** Batch delete confirmation (2+ nodes). Single nodes keep confirmDelete
   *  so the established single-node dialog text stays untouched. */
  const [confirmDeleteMany, setConfirmDeleteMany] = useState<string[] | null>(null);

  /** Delete a set of nodes in one history entry — every wire touching any
   *  of them goes too. Single-node and batch deletes share this path. */
  /** Branch Location nodes (type === 'store') are the topology anchor
   *  and must never be deleted — every workspace, warehouse, and hardware
   *  node is organized under them. */
  const isBranchLocation = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    return node?.type === 'store';
  }, [nodes]);

  const deleteNodes = useCallback((ids: string[]) => {
    // Filter out Branch Location nodes — they are permanent anchors. The
    // rule lives in the shared command module (Phase 3.2); the keydown and
    // context-menu pre-dialog pre-filters still use isBranchLocation above.
    const doomed = new Set(deletableNodeIds(nodes, ids));
    if (doomed.size === 0) return;
    pushHistory();
    setNodes((prev) => nodesWithoutIds(prev, doomed));
    setWires((prev) => wiresWithoutEndpoints(prev, doomed));
    clearSelection();
  }, [pushHistory, setNodes, setWires, clearSelection, nodes]);

  const executeDelete = useCallback(() => {
    if (confirmDeleteMany) {
      deleteNodes(confirmDeleteMany);
      setConfirmDeleteMany(null);
      return;
    }
    if (confirmDelete === '') {
      if (selectedWireId) {
        // Deleting a wire is a single-wire mutation — it must NOT cancel a
        // connection in flight (mirrors the direction-toggle rule). The one
        // exception: if the deleted wire is the EXACT duplicate pair the
        // pending connection would create, cancel the pending state —
        // otherwise completing the connection after the delete would
        // silently recreate the wire the user just removed, bypassing the
        // duplicate detector in handlePortClick. The target node is unknown
        // until the connection completes, so the source endpoint is the only
        // match signal — conservative by design: a same-source, different-
        // target wire delete also cancels (ghost preview vanishing signals
        // it), which is the safer failure than silently recreating the
        // deleted wire.
        const deleted = wires.find((w) => w.id === selectedWireId);
        if (
          connectingFromNodeId
          && connectingFromPort
          && deleted
          && ((deleted.fromNodeId === connectingFromNodeId
            && (deleted.fromPort ?? 'right') === connectingFromPort)
            || (deleted.toNodeId === connectingFromNodeId
              && (deleted.toPort ?? 'left') === connectingFromPort))
        ) {
          cancelConnection();
        }
        pushHistory();
        setWires((prev) => prev.filter((w) => w.id !== selectedWireId));
        clearWire();
      }
    } else if (confirmDelete) {
      deleteNodes([confirmDelete]);
    }
    setConfirmDelete(null);
  }, [confirmDelete, confirmDeleteMany, selectedWireId, connectingFromNodeId, connectingFromPort, wires, pushHistory, deleteNodes, setWires, cancelConnection, clearWire]);

  return {
    confirmDelete,
    setConfirmDelete,
    confirmDeleteMany,
    setConfirmDeleteMany,
    isBranchLocation,
    deleteNodes,
    executeDelete,
  };
}
