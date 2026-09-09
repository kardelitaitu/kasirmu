//! Wire-commit controller for the topology editor (Phase 5 slice P5-B/S3).
//!
//! Owns the three callbacks that turn a completed port gesture into a wire:
//! commitWire (the single ADR #34 creation path — duplicate, one-input-per-
//! warehouse, ticket-cardinality and Pro-tier stock-routing gates, then the
//! insert), commitPickerOption (resolve the open picker's endpoints and hand
//! them to commitWire), and handlePortClick (arm a connection from an output
//! port, cancel on the same node, refuse an incompatible target, open the
//! picker when a pair maps to several relationships, otherwise commit).
//!
//! Bodies, comments and dep arrays are byte-identical to the inline originals.
//! ONE documented deviation: commitWire now also lists `wiresRef` and
//! `pushHistoryRef`. Both were parent-declared useRef objects read through the
//! component closure (exempt from exhaustive-deps in that scope); arriving here
//! as deps-object fields, react-hooks 7.1.1 no longer treats them as known
//! stable, so the rule demands them. They are refs — an identity that never
//! changes across renders — so listing them cannot churn commitWire, and it
//! beats a suppression comment (precedent 68a29a1e7).
//!
//! commitWire is INTERNAL: nothing outside this cluster called it (JSX consumes
//! only commitPickerOption and handlePortClick), so the parent no longer names
//! it — same shape as pointer's commitDuplicateDrag in 3.4c-2. The port pair
//! (portDirection / isPortCompatible) moved in with rider slice P5-B/r:
//! portDirection now has no reader outside this module and stays INTERNAL,
//! while isPortCompatible is returned, under the same name, for the node-card
//! JSX. Both came over byte-identical and needed NO new dependency — every name
//! they read is a deps field their own array already lists, or (isPortCompatible
//! reading portDirection) a same-scope const. Measured, not assumed: the
//! wiresRef / pushHistoryRef listings above STAY — the parent still reads both
//! refs outside this cluster, so folding the pair cannot retire them.
//! The call site sits at the exact position the three callbacks occupied, so
//! hook order — and therefore effect order — is unchanged.

import { useCallback, type MutableRefObject, type SetStateAction } from 'react';
import type { useLocalization } from '@fluent/react';
import type { ToastType } from '@/frontend/shared/Toast';
import { rowRelationshipOptions, type WireRelationshipOption } from './topologyCard';
import {
  stockRoutingWires,
  wireConnectRefusal,
  WIRE_CONNECT_REFUSAL_TOAST,
} from './topologyCommands';
import type { TopologyPickerState } from './nodeTopologyEditorConnectionState';
import type { PortName, TopologyNodeData, TopologyWireData } from './nodeTopologyEditorTypes';

export interface TopologyWireCommitDeps {
  /** Live wire mirror: the duplicate/cardinality/stock-routing gates read the
   *  CURRENT canvas, never the render closure. */
  wiresRef: MutableRefObject<TopologyWireData[]>;
  /** Parent-owned history-push mirror: a wire is committed on top of one pushed
   *  entry, and the mirror keeps this callback referentially stable. */
  pushHistoryRef: MutableRefObject<
    (snapshot?: { nodes: TopologyNodeData[]; wires: TopologyWireData[] }) => void
  >;
  /** id -> node, for endpoint lookups and the warehouse side of the gates. */
  nodeMap: Map<string, TopologyNodeData>;
  /** Tier gate: the stock-routing fallback limit applies below Pro. */
  isProAllowed: boolean;
  /** Refusal / info toasts. */
  addToast: (toast: { message: string; type: ToastType }) => unknown;
  /** Only `getString` is needed — for the refusal and hint copy. */
  l10n: { getString: ReturnType<typeof useLocalization>['l10n']['getString'] };
  /** Every terminal path of the gesture closes the picker + armed connection. */
  cancelRelationshipPicker: () => void;
  /** Wire graph setter — the insert itself. */
  setWires: (value: SetStateAction<TopologyWireData[]>) => void;
  /** Open picker payload (endpoints captured when the picker opened). */
  relationshipPicker: TopologyPickerState | null;
  /** In-flight connection source (reducer field aliases). */
  connectingFromNodeId: string | null;
  connectingFromPort: PortName | null;
  connectingFromVariantIndex: number;
  /** Connection reducer: arm a source port, or drop the whole gesture. */
  beginConnection: (fromNodeId: string, fromPort: PortName, fromVariantIndex?: number) => void;
  cancelConnection: () => void;
  /** Connection reducer: open the multi-relationship picker. */
  openPicker: (picker: TopologyPickerState) => void;
  /** Ghost-preview cursor: arming a fresh connection clears any stale point. */
  setPreviewCursor: (value: SetStateAction<{ x: number; y: number } | null>) => void;
}

/**
 * The wire-creation trio, with the same per-render identities the inline
 * originals had.
 */
export function useTopologyEditorWireCommit(deps: TopologyWireCommitDeps): {
  commitPickerOption: (option: WireRelationshipOption) => void;
  handlePortClick: (e: React.MouseEvent, nodeId: string, port: PortName, variantIndex?: number) => void;
  /** The port pair moved in with rider slice P5-B/r: the node card still
   *  needs the compatibility predicate, portDirection has no external reader. */
  isPortCompatible: (nodeId: string, port: PortName, variantIndex?: number) => boolean;
} {
  const {
    wiresRef,
    pushHistoryRef,
    nodeMap,
    isProAllowed,
    addToast,
    l10n,
    cancelRelationshipPicker,
    setWires,
    relationshipPicker,
    connectingFromNodeId,
    connectingFromPort,
    connectingFromVariantIndex,
    beginConnection,
    cancelConnection,
    openPicker,
    setPreviewCursor,
  } = deps;

  const portDirection = useCallback((port: PortName): 'input' | 'output' => (
    port === 'left' ? 'input' : 'output'
  ), []);

  const isPortCompatible = useCallback((nodeId: string, port: PortName, variantIndex = 0): boolean => {
    if (!connectingFromNodeId || !connectingFromPort) return false;
    if (nodeId === connectingFromNodeId) return false;
    if (portDirection(port) !== 'input') return false;
    const source = nodeMap.get(connectingFromNodeId);
    const target = nodeMap.get(nodeId);
    if (!source || !target) return false;
    // Compatibility is decided by the semantic pairing table (ADR #34): a
    // drop is only completable into a target row that admits the source
    // row's semantic. With stacked per-semantic rows (round 174) the source
    // semantic is fixed by connectingFromVariantIndex, so the check resolves
    // that specific pair — the legacy socket-wide enumeration is only used
    // by the picker flow.
    return rowRelationshipOptions(
      source, connectingFromPort, connectingFromVariantIndex,
      target, port, variantIndex,
    ).length > 0;
  }, [connectingFromNodeId, connectingFromPort, connectingFromVariantIndex, nodeMap, portDirection]);

  /** Create one wire from an ADR #34 relationship option — the single path
   *  for both unambiguous drops (auto-commit) and picker choices.
   *  Duplicate detection compares the CHOSEN toPortId (two relationships
   *  may share a socket pair, and a fully-untyped legacy wire occupies the
   *  pair regardless), and the Pro-tier fallback limit applies only to
   *  stock-routing wires — a transfer is a different relationship. */
  const commitWire = useCallback((
    source: TopologyNodeData,
    sourcePort: PortName,
    target: TopologyNodeData,
    targetPort: PortName,
    option: WireRelationshipOption,
  ) => {
    const currentWires = wiresRef.current;
    // The Pro-tier fallback limit covers STOCK-ROUTING wires only — a
    // transfer wire on the same pair is a different relationship and is
    // always authorable. Legacy untyped workspace→warehouse wires count
    // as stock-routing (that is what the pair defaults to). The population
    // is computed once and shared with the stock-routing gate and the
    // priority/label math below (Phase 3.2 command module).
    const existingStockWires = stockRoutingWires(currentWires, nodeMap);
    // The four creation gates — duplicate, one-input-per-warehouse,
    // ADR #34 ticket cardinality, and the Pro-tier stock-routing limit —
    // run in that enforced order inside wireConnectRefusal; a refusal
    // toasts its mapped copy and draws nothing (explicit refusal, never
    // silent replacement).
    const refusal = wireConnectRefusal(
      currentWires,
      source,
      sourcePort,
      target,
      targetPort,
      option,
      { isProAllowed, existingStockWires },
    );
    if (refusal) {
      addToast({ message: l10n.getString(WIRE_CONNECT_REFUSAL_TOAST[refusal.reason]), type: 'warning' });
      cancelRelationshipPicker();
      return;
    }

    pushHistoryRef.current();

    const newWireId = `wire-${crypto.randomUUID()}`;
    const isWarehouseWire = source.type === 'workspace' && target.type === 'warehouse';
    const priority = existingStockWires.length === 0 ? 1 : existingStockWires.length + 1;
    const label = isWarehouseWire
      ? option.relationshipType === 'inventory-transfer'
        ? l10n.getString('topology-wire-label-transfer')
        : existingStockWires.length === 0
          ? l10n.getString('topology-wire-label-stock-deduct', { priority })
          : l10n.getString('topology-wire-label-fallback', { priority })
      : option.relationshipType === 'ticket-routing'
        ? l10n.getString('topology-wire-label-ticket')
        : l10n.getString('topology-wire-label-connected');

    setWires((prev) => [
      ...prev,
      {
        id: newWireId,
        fromNodeId: source.id,
        fromPort: sourcePort,
        toNodeId: target.id,
        toPort: targetPort,
        direction: 'one-way',
        label,
        fromPortId: option.fromPortId,
        toPortId: option.toPortId,
        relationshipType: option.relationshipType,
      },
    ]);
    cancelRelationshipPicker();
  }, [nodeMap, addToast, l10n, isProAllowed, cancelRelationshipPicker, setWires, wiresRef, pushHistoryRef]);

  /** Commit the relationship the user picked, looking up the endpoint nodes
   *  at click time — a node deleted mid-dialog cancels instead of crashing. */
  const commitPickerOption = useCallback((option: WireRelationshipOption) => {
    if (!relationshipPicker) return;
    const from = nodeMap.get(relationshipPicker.fromNodeId);
    const to = nodeMap.get(relationshipPicker.toNodeId);
    if (!from || !to) {
      cancelRelationshipPicker();
      return;
    }
    commitWire(from, relationshipPicker.fromPort, to, relationshipPicker.toPort, option);
  }, [relationshipPicker, nodeMap, cancelRelationshipPicker, commitWire]);

  const handlePortClick = useCallback((e: React.MouseEvent, nodeId: string, port: PortName, variantIndex = 0) => {
    e.stopPropagation();

    if (!connectingFromNodeId) {
      if (portDirection(port) !== 'output') {
        addToast({ message: l10n.getString('topology-port-input-only'), type: 'info' });
        return;
      }
      beginConnection(nodeId, port, variantIndex);
      setPreviewCursor(null);
      return;
    }

    if (connectingFromNodeId === nodeId) {
      cancelConnection();
      return;
    }

    if (!isPortCompatible(nodeId, port, variantIndex)) {
      addToast({ message: l10n.getString('topology-wire-incompatible'), type: 'warning' });
      cancelConnection();
      return;
    }

    const fromNode = nodeMap.get(connectingFromNodeId);
    const toNode = nodeMap.get(nodeId);
    if (!fromNode || !toNode) {
      cancelConnection();
      return;
    }

    // With stacked per-semantic port rows (round 174), both source and
    // target rows are known — resolve the specific pair. The picker is
    // only needed for the rare case where a single semantic pair maps to
    // multiple relationships (currently none in the pairing table).
    const options = rowRelationshipOptions(
      fromNode, connectingFromPort!, connectingFromVariantIndex,
      toNode, port, variantIndex,
    );
    if (options.length === 0) {
      addToast({ message: l10n.getString('topology-wire-incompatible'), type: 'warning' });
      cancelConnection();
      return;
    }

    if (options.length > 1) {
      openPicker({
        fromNodeId: connectingFromNodeId,
        fromPort: connectingFromPort!,
        fromVariantIndex: connectingFromVariantIndex,
        toNodeId: nodeId,
        toPort: port,
        toVariantIndex: variantIndex,
        options,
      });
      return;
    }

    commitWire(fromNode, connectingFromPort!, toNode, port, options[0]!);
  }, [connectingFromNodeId, connectingFromPort, connectingFromVariantIndex, nodeMap, isPortCompatible, commitWire, addToast, l10n, beginConnection, cancelConnection, openPicker, setPreviewCursor, portDirection]);

  return { commitPickerOption, handlePortClick, isPortCompatible };
}
