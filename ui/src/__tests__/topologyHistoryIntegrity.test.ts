import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDevLog, getDevLog } from '../utils/devLog';
import { historyEntry, validWiresForNodes } from '../features/locations/topologyHistoryIntegrity';

/**
 * The history-integrity guards drop a wire when its endpoints are missing
 * from the same node set (push-time in historyEntry, restore-time in
 * popUndo/popRedo). Legitimate snapshots never drop anything, so a drop is
 * a corruption signal — these pin that the diagnostic fires loudly through
 * the shared dev-log bus (see @/utils/devLog) and names the offending
 * wire, and that clean snapshots stay silent.
 */

const node = (id: string) => ({ id, type: 'workspace', name: id });
const wire = (id: string, fromNodeId: string, toNodeId: string) => ({ id, fromNodeId, toNodeId });

describe('topology history-integrity guards', () => {
  beforeEach(() => clearDevLog());
  afterEach(() => clearDevLog());

  it('drops a dangling wire at the restore boundary and records a warn with its id and endpoints', () => {
    const wires = [wire('w-1', 'a', 'b'), wire('w-2', 'a', 'ghost')];

    const kept = validWiresForNodes([node('a'), node('b')], wires, 'restore');

    expect(kept).toEqual([wires[0]]);
    expect(getDevLog()).toEqual([
      {
        level: 'warn',
        source: 'topology',
        message:
          'restore-time guard dropped 1 dangling wire(s) whose endpoints are absent from the same entry: w-2 (a -> ghost)',
      },
    ]);
  });

  it('records a warn at the push boundary when entry creation absorbs the drop', () => {
    // Both wires dangle: one endpoint is absent, the other wire is fully ghost.
    const entry = historyEntry([node('a')], [wire('w-1', 'a', 'b'), wire('w-2', 'b', 'a')]);

    expect(entry.wires).toEqual([]);
    expect(getDevLog()).toEqual([
      {
        level: 'warn',
        source: 'topology',
        message:
          'push-time guard dropped 2 dangling wire(s) whose endpoints are absent from the same entry: w-1 (a -> b), w-2 (b -> a)',
      },
    ]);
  });

  it('is silent and identity-preserving for a consistent snapshot', () => {
    const nodes = [node('a'), node('b')];
    const wires = [wire('w-1', 'a', 'b')];

    expect(validWiresForNodes(nodes, wires, 'restore')).toEqual(wires);
    expect(historyEntry(nodes, wires).wires).toEqual(wires);
    expect(getDevLog()).toEqual([]);
  });
});
