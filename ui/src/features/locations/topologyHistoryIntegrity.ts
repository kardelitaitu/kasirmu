import { devLog } from '@/utils/devLog';
import type { TopologyHistoryEntry } from './nodeTopologyEditorState';

/**
 * History-entry integrity for the topology editor's undo/redo stacks.
 *
 * The guarantee "every stored entry is endpoint-consistent" (every wire in
 * an entry references nodes present in the SAME entry) is enforced twice:
 * at PUSH time (historyEntry, used by every entry-creation site) and at
 * RESTORE time (popUndo/popRedo apply the filter before landing state).
 * Legitimate snapshots never trigger a drop, so any drop is a corruption
 * signal — the guards surface it through the shared dev-log bus (see
 * @/utils/devLog) as a `[topology]` diagnostic instead of absorbing it
 * silently, so a future creation-path regression is loud, not invisible.
 */

/**
 * Filter `wires` down to those whose endpoints exist in `nodes`, warning
 * with the id and endpoints of every wire dropped. `boundary` labels where
 * the drop happened ('push' = entry creation, 'restore' = undo/redo
 * application) so the log pinpoints which layer absorbed the corruption.
 * Identity for any consistent snapshot — the filter only ever fires on
 * corruption.
 */
export function validWiresForNodes<TNode extends { id: string }, TWire extends { id: string; fromNodeId: string; toNodeId: string }>(
  nodes: TNode[],
  wires: TWire[],
  boundary: 'push' | 'restore',
): TWire[] {
  const ids = new Set(nodes.map((n) => n.id));
  const dropped = wires.filter((w) => !ids.has(w.fromNodeId) || !ids.has(w.toNodeId));
  if (dropped.length > 0) {
    // Shared dev-log bus: console line stays `[topology] ...` and the entry
    // is recorded for tests via getDevLog() (see @/utils/devLog).
    devLog.warn(
      'topology',
      `${boundary}-time guard dropped ${dropped.length} dangling wire(s) ` +
        `whose endpoints are absent from the same entry: ` +
        dropped.map((w) => `${w.id} (${w.fromNodeId} -> ${w.toNodeId})`).join(', '),
    );
  }
  return wires.filter((w) => ids.has(w.fromNodeId) && ids.has(w.toNodeId));
}

/**
 * Build a history/redo entry that is endpoint-consistent at PUSH time (see
 * validWiresForNodes): shallow-copies nodes, runs wires through the guard,
 * and warns about any wire dropped. The restore boundary (popUndo/popRedo)
 * remains as defense-in-depth; sanitizing at push keeps the stacks
 * themselves clean, so a corrupt entry can never even be stored.
 */
export function historyEntry<TNode extends { id: string }, TWire extends { id: string; fromNodeId: string; toNodeId: string }>(
  nodes: TNode[],
  wires: TWire[],
): TopologyHistoryEntry<TNode, TWire> {
  return {
    nodes: nodes.map((n) => ({ ...n })),
    wires: validWiresForNodes(nodes, wires, 'push').map((w) => ({ ...w })),
  };
}
