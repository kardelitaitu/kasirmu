import type { PortName, TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';
import type { WireRelationshipOption } from './topologyCard';

/**
 * Pure graph-mutation commands for the topology editor (Phase 3.2).
 *
 * Every canvas mutation funnels through a small set of commands that
 * centralize the invariants the editor previously kept as inline knowledge
 * at each call site: Branch Location nodes (`type === 'store'`) are
 * permanent anchors and can never be deleted; a node delete must take
 * every wire touching it with it (a dangling wire cannot render and would
 * immediately trip the push-time history integrity guard); wire creation
 * is gated by the duplicate/cardinality rules below; and a node
 * disconnect that removes no wire must not produce a history entry.
 *
 * The functions are pure and side-effect free: they compute the result of
 * a command against the current graph, and the editor's React setters own
 * applying it through the same updater functions the inline code used, so
 * batching, ordering, and identity semantics are unchanged.
 */

/**
 * Return the subset of `ids` that may be deleted: everything except
 * Branch Location nodes. Preserves the input order and deduplicates.
 */
export function deletableNodeIds(
  nodes: TopologyNodeData[],
  ids: readonly string[],
): string[] {
  const branchIds = new Set(
    nodes.filter((n) => n.type === 'store').map((n) => n.id),
  );
  const seen = new Set<string>();
  const deletable: string[] = [];
  for (const id of ids) {
    if (branchIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    deletable.push(id);
  }
  return deletable;
}

/**
 * Nodes for the post-delete canvas: every node except the doomed ids.
 * Returns a new array; the input is not mutated.
 */
export function nodesWithoutIds(
  nodes: TopologyNodeData[],
  doomedIds: ReadonlySet<string>,
): TopologyNodeData[] {
  return nodes.filter((n) => !doomedIds.has(n.id));
}

/**
 * Wires for the post-delete canvas: every wire whose endpoints both
 * survive the deletion — a wire touching any deleted node goes with it.
 */
export function wiresWithoutEndpoints(
  wires: TopologyWireData[],
  doomedIds: ReadonlySet<string>,
): TopologyWireData[] {
  return wires.filter(
    (w) => !doomedIds.has(w.fromNodeId) && !doomedIds.has(w.toNodeId),
  );
}

// ── Wire connect gates (Phase 3.2) ───────────────────────────────────

/**
 * Why a wire-creation attempt was refused. The editor maps each reason to
 * its warning toast via {@link WIRE_CONNECT_REFUSAL_TOAST}, cancels the
 * relationship picker, and draws nothing — explicit refusal, never silent
 * replacement.
 */
export type WireConnectRefusal =
  | { reason: 'duplicate' }
  | { reason: 'warehouse-input-taken' }
  | { reason: 'ticket-input-taken' }
  | { reason: 'stock-routing-limit' };

/** Localized message id per connect refusal — one lookup so the copy
 *  stays attached to the gate that produces it. */
export const WIRE_CONNECT_REFUSAL_TOAST: Record<WireConnectRefusal['reason'], string> = {
  duplicate: 'topology-toast-wire-duplicate',
  'warehouse-input-taken': 'topology-validation-multiple-warehouse-inputs',
  'ticket-input-taken': 'topology-validation-multiple-ticket-inputs',
  'stock-routing-limit': 'topology-toast-fallback-warehouse',
};

/**
 * The existing workspace→warehouse stock-routing wires — the population
 * the Pro-tier fallback limit and the wire priority/label math consume.
 * Legacy untyped workspace→warehouse wires count as stock-routing (that
 * is what the pair defaults to), and a typed Retail POS → Warehouse
 * Operation edge occupies the same fallback slot for tier gating.
 */
export function stockRoutingWires(
  wires: TopologyWireData[],
  nodeTypes: ReadonlyMap<string, Pick<TopologyNodeData, 'type'>>,
): TopologyWireData[] {
  return wires.filter((w) => {
    const fn = nodeTypes.get(w.fromNodeId);
    const tn = nodeTypes.get(w.toNodeId);
    return fn?.type === 'workspace' && tn?.type === 'warehouse'
      && (w.relationshipType === 'stock-routing'
        || w.relationshipType === undefined
        || (w.relationshipType === 'generic' && w.toPortId === 'operation-in'));
  });
}

/**
 * Evaluate the wire-creation gates in enforced order and return the first
 * refusal, or null when the connect may proceed:
 *
 * 1. duplicate — the same (source, port, target, port) pair already
 *    exists, forward or reversed. A legacy untyped wire (no relationship,
 *    no port ids) matches by default ports alone; a typed wire matches
 *    when its target port id equals the option's (defaulting to
 *    `location-in`).
 * 2. warehouse-input-taken — a warehouse accepts ONE ownership/operational
 *    input (`location-in` / `operation-in`); a second wire targeting that
 *    warehouse's input ports is refused. Legacy wires with no target port
 *    id do not occupy the slot.
 * 3. ticket-input-taken — ADR #34 ticket-routing cardinality: a ticket
 *    device accepts exactly ONE ticket source, so a DIFFERENT KDS
 *    dropping onto an already-sourced printer is refused.
 * 4. stock-routing-limit — on non-Pro tiers only one stock-routing wire
 *    may exist; `existingStockWires` (from {@link stockRoutingWires}) is
 *    passed in so the population is computed once and shared with the
 *    editor's priority/label math.
 */
export function wireConnectRefusal(
  wires: readonly TopologyWireData[],
  source: Pick<TopologyNodeData, 'id'>,
  sourcePort: PortName,
  target: Pick<TopologyNodeData, 'id' | 'type'>,
  targetPort: PortName,
  option: Pick<WireRelationshipOption, 'toPortId' | 'relationshipType'>,
  context: { isProAllowed: boolean; existingStockWires: readonly TopologyWireData[] },
): WireConnectRefusal | null {
  const duplicate = wires.some(
    (w) =>
      (w.fromNodeId === source.id && w.toNodeId === target.id
        && (w.fromPort ?? 'right') === sourcePort && (w.toPort ?? 'left') === targetPort
        && ((w.relationshipType === undefined && w.fromPortId === undefined && w.toPortId === undefined)
          || (w.toPortId ?? 'location-in') === option.toPortId))
      || (w.fromNodeId === target.id && w.toNodeId === source.id
        && (w.fromPort ?? 'right') === targetPort && (w.toPort ?? 'left') === sourcePort),
  );
  if (duplicate) {
    return { reason: 'duplicate' };
  }
  if (
    target.type === 'warehouse'
    && (option.toPortId === 'location-in' || option.toPortId === 'operation-in')
    && wires.some(
      (w) => w.toNodeId === target.id
        && (w.toPortId === 'location-in' || w.toPortId === 'operation-in'),
    )
  ) {
    return { reason: 'warehouse-input-taken' };
  }
  if (
    option.relationshipType === 'ticket-routing'
    && wires.some((w) => w.toNodeId === target.id && w.toPortId === 'ticket-in')
  ) {
    return { reason: 'ticket-input-taken' };
  }
  if (
    option.relationshipType === 'stock-routing'
    && context.existingStockWires.length >= 1
    && !context.isProAllowed
  ) {
    return { reason: 'stock-routing-limit' };
  }
  return null;
}

// ── Disconnect command (Phase 3.2) ───────────────────────────────────

/**
 * Disconnect every wire touching `nodeId` (either endpoint). Returns the
 * remaining wires plus whether anything was removed — the editor pushes a
 * history entry ONLY when `changed` is true, so a disconnect on a node
 * without wires must never produce an undo entry (no-op suppression).
 */
export function disconnectNode(
  wires: TopologyWireData[],
  nodeId: string,
): { wires: TopologyWireData[]; changed: boolean } {
  const remaining = wires.filter((w) => w.fromNodeId !== nodeId && w.toNodeId !== nodeId);
  return { wires: remaining, changed: remaining.length !== wires.length };
}
