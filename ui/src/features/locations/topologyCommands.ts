import type { TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';

/**
 * Pure graph-mutation commands for the topology editor (Phase 3.2).
 *
 * Every canvas mutation funnels through a small set of commands that
 * centralize two invariants the editor previously kept as inline knowledge
 * at each call site: Branch Location nodes (`type === 'store'`) are
 * permanent anchors and can never be deleted, and a node delete must take
 * every wire touching it with it (a dangling wire cannot render and would
 * immediately trip the push-time history integrity guard).
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
