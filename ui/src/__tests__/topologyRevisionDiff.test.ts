// ── diffTopologyGraphs unit tests ────────────────────────────────
//
// ADR #46 §10: the version browser needs graph-vs-graph comparison, which
// `topologyDiff.ts` does not provide (it compares the canvas against live
// backend instances). These tests pin the three-class field model the module
// argues for — semantic listed, geometry counted, volatile excluded — because
// each class is a claim about what a merchant should have to read, and a
// history panel that itemises dragged nodes or phantom telemetry changes is
// one that gets ignored.
//
// Inputs are the PERSISTED snake_case payloads, since that is what a stored
// revision actually contains; the camelCase editor model is covered separately.

import { describe, expect, it } from 'vitest';
import { diffTopologyGraphs } from '@/features/locations/topologyRevisionDiff';

const node = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  type: 'workspace',
  name: 'Front Register',
  x: 0,
  y: 0,
  ...over,
});

const wire = (over: Record<string, unknown> = {}) => ({
  id: 'w1',
  from_node_id: 'root',
  to_node_id: 'n1',
  direction: 'one-way',
  ...over,
});

const graph = (nodes: unknown[], wires: unknown[] = []) => ({ nodes, wires });

const kinds = (d: ReturnType<typeof diffTopologyGraphs>) =>
  d.changes.map((c) => `${c.kind}:${c.id}`);

describe('diffTopologyGraphs — identity', () => {
  it('reports two equal graphs as semantically identical', () => {
    const a = graph([node()], [wire()]);
    const d = diffTopologyGraphs(a, a);
    expect(d.semanticallyIdentical).toBe(true);
    expect(d.changes).toEqual([]);
    expect(d.movedNodes).toBe(0);
  });

  it('treats two empty graphs as identical rather than an error', () => {
    const d = diffTopologyGraphs(graph([]), graph([]));
    expect(d.semanticallyIdentical).toBe(true);
  });
});

describe('diffTopologyGraphs — nodes', () => {
  it('detects an added and a removed node', () => {
    const d = diffTopologyGraphs(
      graph([node({ id: 'gone', name: 'Closed Desk' })]),
      graph([node({ id: 'new', name: 'Grill Station' })]),
    );
    expect(kinds(d)).toEqual(['node-removed:gone', 'node-added:new']);
    expect(d.changes[0]!.label).toBe('Closed Desk');
    expect(d.changes[1]!.label).toBe('Grill Station');
  });

  it('reports a type change with its from and to', () => {
    // The one that matters most: POS -> KDS is a different device in the room.
    const d = diffTopologyGraphs(
      graph([node({ type: 'workspace' })]),
      graph([node({ type: 'warehouse' })]),
    );
    expect(kinds(d)).toEqual(['node-changed:n1']);
    expect(d.changes[0]!.fields).toEqual([
      { field: 'type', from: 'workspace', to: 'warehouse' },
    ]);
  });

  it('reports a rename', () => {
    const d = diffTopologyGraphs(
      graph([node({ name: 'Register 1' })]),
      graph([node({ name: 'Register 2' })]),
    );
    expect(d.changes[0]!.fields).toEqual([
      { field: 'name', from: 'Register 1', to: 'Register 2' },
    ]);
  });

  it('lists every changed semantic field on one node as one change', () => {
    const d = diffTopologyGraphs(
      graph([node({ type: 'workspace', name: 'A', tier_requirement: 'pro' })]),
      graph([node({ type: 'warehouse', name: 'B', tier_requirement: 'enterprise' })]),
    );
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0]!.fields.map((f) => f.field)).toEqual([
      'name',
      'tier_requirement',
      'type',
    ]);
  });
});

describe('diffTopologyGraphs — metadata', () => {
  it('detects a nested metadata change', () => {
    const d = diffTopologyGraphs(
      graph([node({ metadata: { typeKey: 'store-pos', persisted: false } })]),
      graph([node({ metadata: { typeKey: 'store-pos', persisted: true } })]),
    );
    expect(d.changes[0]!.fields).toHaveLength(1);
    expect(d.changes[0]!.fields[0]).toEqual({
      field: 'metadata',
      from: { typeKey: 'store-pos', persisted: false },
      to: { typeKey: 'store-pos', persisted: true },
    });
  });

  it('does NOT treat metadata key ORDER as a change', () => {
    // The payload is re-serialised on every Apply, so an object that means the
    // same thing frequently does not stringify the same way. Comparing
    // serialisations would make every save look edited.
    const d = diffTopologyGraphs(
      graph([node({ metadata: { a: 1, b: 2 } })]),
      graph([node({ metadata: { b: 2, a: 1 } })]),
    );
    expect(d.semanticallyIdentical).toBe(true);
  });

  it('treats a present-but-undefined metadata key as absent, not as a change', () => {
    const d = diffTopologyGraphs(
      graph([node({ metadata: { a: 1 } })]),
      graph([node({ metadata: { a: 1, b: undefined } })]),
    );
    // `b` present-but-undefined vs absent is a serialisation artefact, not a
    // merchant decision.
    expect(d.semanticallyIdentical).toBe(true);
  });
});

describe('diffTopologyGraphs — wires', () => {
  it('detects an added and a removed wire', () => {
    const d = diffTopologyGraphs(graph([node()], [wire()]), graph([node()]));
    expect(kinds(d)).toEqual(['wire-removed:w1']);
  });

  it('reports a re-termination, which is a different business relationship', () => {
    const d = diffTopologyGraphs(
      graph([node()], [wire({ to_node_id: 'n1' })]),
      graph([node()], [wire({ to_node_id: 'other' })]),
    );
    expect(d.changes[0]!.fields).toEqual([
      { field: 'to_node_id', from: 'n1', to: 'other' },
    ]);
  });

  it('reports a direction change', () => {
    const d = diffTopologyGraphs(
      graph([], [wire({ direction: 'one-way' })]),
      graph([], [wire({ direction: 'two-way' })]),
    );
    expect(kinds(d)).toEqual(['wire-changed:w1']);
  });

  it('labels a wire by its endpoints\' names, not their ids', () => {
    const nodes = [
      node({ id: 'root', name: 'Main Street' }),
      node({ id: 'n1', name: 'Kitchen' }),
    ];
    const d = diffTopologyGraphs(
      graph(nodes, [wire({ direction: 'one-way' })]),
      graph(nodes, [wire({ direction: 'two-way' })]),
    );
    expect(d.changes[0]!.label).toBe('Main Street → Kitchen');
  });

  it('still labels a removed wire when both its endpoints are gone too', () => {
    // The whole branch torn down: the wire must still say what it used to
    // join, which is why the name map is built from BOTH graphs' node arrays.
    const nodes = [
      node({ id: 'root', name: 'Main Street' }),
      node({ id: 'n1', name: 'Kitchen' }),
    ];
    const d = diffTopologyGraphs(graph(nodes, [wire()]), graph([], []));
    const removedWire = d.changes.find((c) => c.kind === 'wire-removed')!;
    expect(removedWire.label).toBe('Main Street → Kitchen');
  });

  it('falls back to the id when an endpoint is unknown', () => {
    const d = diffTopologyGraphs(
      graph([], [wire({ from_node_id: 'ghost', to_node_id: 'n2' })]),
      graph([], [wire({ from_node_id: 'ghost', to_node_id: 'n3' })]),
    );
    expect(d.changes[0]!.label).toBe('ghost → n3');
  });
});

describe('diffTopologyGraphs — geometry is counted, not listed', () => {
  it('counts a moved node without reporting it as a change', () => {
    const d = diffTopologyGraphs(
      graph([node({ x: 0, y: 0 })]),
      graph([node({ x: 400, y: 220 })]),
    );
    expect(d.changes).toEqual([]);
    expect(d.movedNodes).toBe(1);
    // Dragging three nodes is not three business changes, so the graphs ARE
    // the same configuration — the count is context, not a diff entry.
    expect(d.semanticallyIdentical).toBe(true);
  });

  it('counts a re-routed wire separately from a moved node', () => {
    const d = diffTopologyGraphs(
      graph([], [wire({ bends: [{ x: 1, y: 1 }] })]),
      graph([], [wire({ bends: [{ x: 9, y: 9 }] })]),
    );
    expect(d.reroutedWires).toBe(1);
    expect(d.changes).toEqual([]);
  });

  it('treats from_port / to_port as geometry and from_port_id / to_port_id as semantic', () => {
    // The repo draws this exact line in TopologyWireData:193-194.
    const geom = diffTopologyGraphs(
      graph([], [wire({ from_port: 'right' })]),
      graph([], [wire({ from_port: 'bottom' })]),
    );
    expect(geom.changes).toEqual([]);
    expect(geom.reroutedWires).toBe(1);

    const sem = diffTopologyGraphs(
      graph([], [wire({ from_port_id: 'pos-output' })]),
      graph([], [wire({ from_port_id: 'kds-input' })]),
    );
    expect(kinds(sem)).toEqual(['wire-changed:w1']);
  });

  it('does not double-count a node that was both renamed and moved', () => {
    const d = diffTopologyGraphs(
      graph([node({ name: 'A', x: 0 })]),
      graph([node({ name: 'B', x: 500 })]),
    );
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0]!.fields.map((f) => f.field)).toEqual(['name']);
    expect(d.movedNodes).toBe(0);
  });
});

describe('diffTopologyGraphs — volatile runtime state is invisible', () => {
  it('ignores a telemetry change entirely, without even counting it', () => {
    // A terminal going offline between two Applies is not a change to the
    // business configuration. Counting it would be nearly as misleading as
    // listing it: it would tell the merchant the graphs differed.
    const d = diffTopologyGraphs(
      graph([node({ telemetry_status: 'online', telemetry_badge: '3' })]),
      graph([node({ telemetry_status: 'offline', telemetry_badge: '0' })]),
    );
    expect(d.changes).toEqual([]);
    expect(d.movedNodes).toBe(0);
    expect(d.reroutedWires).toBe(0);
    expect(d.semanticallyIdentical).toBe(true);
  });
});

describe('diffTopologyGraphs — totality', () => {
  it('never throws on the malformed input an old revision can contain', () => {
    // ADR #46 §7 guarantees such revisions exist: the contract moved 1 -> 2 and
    // old rows are shown, never migrated. A browser that throws here is worse
    // than one that says it cannot compare.
    expect(() =>
      diffTopologyGraphs(
        { nodes: [null, 42, 'x', [], {}] as unknown[], wires: [undefined] },
        { nodes: [{}], wires: [{ id: 'w' }] },
      ),
    ).not.toThrow();
  });

  it('pairs entities with no usable id positionally so they are not lost', () => {
    const d = diffTopologyGraphs(
      graph([{ name: 'A' }]),
      graph([{ name: 'B' }]),
    );
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0]!.id).toBe('#position-0');
    expect(d.changes[0]!.fields).toEqual([{ field: 'name', from: 'A', to: 'B' }]);
  });

  it('ignores an unrecognised field rather than guessing it is semantic', () => {
    // Guessing wrong in the noisy direction is what makes history unreadable.
    const d = diffTopologyGraphs(
      graph([node({ some_future_presentation_flag: true })]),
      graph([node({ some_future_presentation_flag: false })]),
    );
    expect(d.semanticallyIdentical).toBe(true);
    expect(d.movedNodes).toBe(0);
  });
});

describe('diffTopologyGraphs — camelCase editor model', () => {
  it('compares the editor model as well as stored envelopes', () => {
    // The browser shows "current canvas vs a past revision", so both shapes
    // must work; the persisted form is snake_case and the model is camelCase.
    const d = diffTopologyGraphs(
      { nodes: [{ id: 'n1', storeProfileId: 'store-a' }], wires: [] },
      { nodes: [{ id: 'n1', storeProfileId: 'store-b' }], wires: [] },
    );
    expect(kinds(d)).toEqual(['node-changed:n1']);

    const w = diffTopologyGraphs(
      { nodes: [], wires: [{ id: 'w1', fromNodeId: 'a', toNodeId: 'b' }] },
      { nodes: [], wires: [{ id: 'w1', fromNodeId: 'a', toNodeId: 'c' }] },
    );
    expect(w.changes[0]!.fields).toEqual([
      { field: 'toNodeId', from: 'b', to: 'c' },
    ]);
  });
});

describe('diffTopologyGraphs — ordering', () => {
  it('orders removals, then additions, then changes', () => {
    const d = diffTopologyGraphs(
      graph([node({ id: 'gone' }), node({ id: 'same', name: 'A' })]),
      graph([node({ id: 'new' }), node({ id: 'same', name: 'B' })]),
    );
    expect(kinds(d)).toEqual([
      'node-removed:gone',
      'node-added:new',
      'node-changed:same',
    ]);
  });
});
