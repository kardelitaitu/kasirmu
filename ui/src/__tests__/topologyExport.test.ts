import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TOPOLOGY_EXPORT_FORMAT,
  TOPOLOGY_EXPORT_VERSION,
  serializeTopology,
  deserializeTopology,
  saveTemplate,
  loadTemplate,
  listTemplates,
  deleteTemplate,
} from '../features/locations/topologyExport';

const nodes = [
  { id: 'store-1', type: 'store' as const, name: 'Downtown', x: 80, y: 140, subtitle: 'Branch' },
  { id: 'ws-1', type: 'workspace' as const, name: 'POS #1', x: 400, y: 80, metadata: { typeKey: 'store-pos' } },
];
const wires = [{ id: 'w1', fromNodeId: 'store-1', toNodeId: 'ws-1', direction: 'one-way' as const, label: 'Stock' }];

describe('serializeTopology / deserializeTopology (versioned export envelope)', () => {
  it('round-trips nodes and wires losslessly', () => {
    const json = serializeTopology(nodes, wires);
    const out = deserializeTopology(json);
    expect(out).not.toBeNull();
    expect(out!.nodes).toEqual(nodes);
    expect(out!.wires).toEqual(wires);
  });

  it('carries the versioned envelope format', () => {
    const json = serializeTopology(nodes, wires);
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe(TOPOLOGY_EXPORT_FORMAT);
    expect(parsed.version).toBe(TOPOLOGY_EXPORT_VERSION);
  });

  it('preserves optional fields (bends, labels, metadata) on the way through', () => {
    const bent = [
      { id: 'w2', fromNodeId: 'store-1', toNodeId: 'ws-1', direction: 'two-way' as const, bends: [{ x: 300, y: 200 }] },
    ];
    const out = deserializeTopology(serializeTopology(nodes, bent));
    expect(out!.wires).toEqual(bent);
  });

  it('round-trips the warehouse stock metadata shape losslessly', () => {
    const stocked = [
      ...nodes,
      {
        id: 'wh-1',
        type: 'warehouse' as const,
        name: 'Main Stock Room',
        x: 680,
        y: 140,
        metadata: { stock: 250, capacity: 1000, lowStockThreshold: 25 },
      },
    ];
    const out = deserializeTopology(serializeTopology(stocked, wires));
    expect(out).not.toBeNull();
    expect(out!.nodes).toHaveLength(3);
    expect(out!.nodes[2]).toMatchObject({
      id: 'wh-1',
      type: 'warehouse',
      name: 'Main Stock Room',
      metadata: { stock: 250, capacity: 1000, lowStockThreshold: 25 },
    });
  });

  it('rejects a warehouse whose stock metadata is not a finite number', () => {
    const malformed = [
      ...nodes,
      {
        id: 'wh-1',
        type: 'warehouse' as const,
        name: 'Main Stock Room',
        x: 680,
        y: 140,
        metadata: { capacity: '1000' as unknown as number, lowStockThreshold: 25 },
      },
    ];
    // A hand-edited or drifted document must not half-load: the string
    // capacity would silently drop through readNumber/metadataNumber.
    expect(deserializeTopology(serializeTopology(malformed, wires))).toBeNull();
  });

  it('rejects garbage, wrong format, and wrong version', () => {
    expect(deserializeTopology('not json')).toBeNull();
    expect(deserializeTopology('42')).toBeNull();
    expect(deserializeTopology(JSON.stringify({ format: 'other', version: 1, nodes, wires }))).toBeNull();
    expect(deserializeTopology(JSON.stringify({ format: TOPOLOGY_EXPORT_FORMAT, version: 99, nodes, wires }))).toBeNull();
    expect(deserializeTopology(JSON.stringify({ format: TOPOLOGY_EXPORT_FORMAT, version: 1 }))).toBeNull();
  });

  it('rejects a malformed node, a malformed wire, and duplicate ids', () => {
    const badNode = serializeTopology([{ ...nodes[0]!, id: '' }], wires);
    expect(deserializeTopology(badNode)).toBeNull();

    const badWire = serializeTopology(nodes, [{ ...wires[0]!, direction: 'sideways' as unknown as 'one-way' }]);
    expect(deserializeTopology(badWire)).toBeNull();

    const dup = serializeTopology(
      [nodes[0]!, { ...nodes[1]!, id: 'store-1' }],
      wires,
    );
    expect(deserializeTopology(dup)).toBeNull();
  });

  it('rejects a wire whose fromPort/toPort is not a canonical port name', () => {
    // The geometry reads ports raw (PORT_OFFSET[port]); a hand-edited value
    // like 123 or 'diagonal' would pass the old shape check and crash the
    // canvas with an undefined offset dereference. The strict contract must
    // reject it at parse time.
    const badFromPort = serializeTopology(
      nodes,
      [{ ...wires[0]!, fromPort: 123 as unknown as 'right' }],
    );
    expect(deserializeTopology(badFromPort)).toBeNull();

    const badToPort = serializeTopology(
      nodes,
      [{ ...wires[0]!, toPort: 'diagonal' as unknown as 'left' }],
    );
    expect(deserializeTopology(badToPort)).toBeNull();
  });

  it('rejects duplicate wire ids (two wires sharing one id behave as one)', () => {
    // Duplicate NODE ids already reject; wire ids were unchecked — a pasted
    // diagram with two wires under one id would make delete/cycle operations
    // hit BOTH wires, so the parser must refuse it like node ids.
    const dup = serializeTopology(nodes, [wires[0]!, { ...wires[0]!, id: 'w1' }]);
    expect(deserializeTopology(dup)).toBeNull();
  });

  it('rejects malformed bend shapes on a wire', () => {
    // The geometry reads bends RAW (`wire.bends.map(...)`): a hand-edited
    // non-array would CRASH the canvas render, and a bend entry without
    // finite x/y produces NaN-coordinate degenerate paths. The strict
    // contract refuses the whole payload instead of half-loading it.
    const badNonArray = serializeTopology(
      nodes,
      [{ ...wires[0]!, bends: 'oops' as unknown as Array<{ x: number; y: number }> }],
    );
    expect(deserializeTopology(badNonArray)).toBeNull();

    const badMissingY = serializeTopology(
      nodes,
      [{ ...wires[0]!, bends: [{ x: 300 }] as unknown as Array<{ x: number; y: number }> }],
    );
    expect(deserializeTopology(badMissingY)).toBeNull();

    const badStringCoords = serializeTopology(
      nodes,
      [{ ...wires[0]!, bends: [{ x: '300', y: 200 }] as unknown as Array<{ x: number; y: number }> }],
    );
    expect(deserializeTopology(badStringCoords)).toBeNull();

    const badNonObjectEntry = serializeTopology(
      nodes,
      [{ ...wires[0]!, bends: [42] as unknown as Array<{ x: number; y: number }> }],
    );
    expect(deserializeTopology(badNonObjectEntry)).toBeNull();
  });

  it('rejects a wire whose endpoint references a node missing from the payload', () => {
    // A dangling endpoint cannot render (the geometry skips it) and the
    // imported diagram immediately banners unknown-wire-endpoint — a
    // drifted document must be refused whole, like every other broken shape.
    const danglingFrom = serializeTopology(
      nodes,
      [{ ...wires[0]!, fromNodeId: 'ghost-node' }],
    );
    expect(deserializeTopology(danglingFrom)).toBeNull();

    const danglingTo = serializeTopology(
      nodes,
      [{ ...wires[0]!, toNodeId: 'ghost-node' }],
    );
    expect(deserializeTopology(danglingTo)).toBeNull();
  });

  it('still round-trips canonical ports and wires after the stricter validation', () => {
    const wired = [
      { id: 'w3', fromNodeId: 'store-1', fromPort: 'right' as const, toNodeId: 'ws-1', toPort: 'left' as const, direction: 'reverse' as const },
    ];
    const out = deserializeTopology(serializeTopology(nodes, wired));
    expect(out).not.toBeNull();
    expect(out!.wires).toEqual(wired);
  });

  it('keeps a canonical wire with a valid (and an empty) bends array lossless', () => {
    const bent = [
      { id: 'w-bent', fromNodeId: 'store-1', toNodeId: 'ws-1', direction: 'one-way' as const, bends: [{ x: 300, y: 200 }] },
      { id: 'w-plain', fromNodeId: 'store-1', toNodeId: 'ws-1', direction: 'one-way' as const, bends: [] },
    ];
    const out = deserializeTopology(serializeTopology(nodes, bent));
    expect(out).not.toBeNull();
    expect(out!.wires).toEqual(bent);
  });
});

describe('diagram templates (localStorage)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves, lists, loads, and deletes a template', () => {
    expect(listTemplates()).toEqual([]);

    const key = saveTemplate('Main Floor', nodes, wires);
    expect(key).toBe('oz-topology-template:Main Floor');
    expect(listTemplates()).toEqual(['Main Floor']);

    const loaded = loadTemplate('Main Floor');
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes).toEqual(nodes);

    deleteTemplate('Main Floor');
    expect(listTemplates()).toEqual([]);
    expect(loadTemplate('Main Floor')).toBeNull();
  });

  it('rejects an empty name and sorts the list', () => {
    expect(saveTemplate('   ', nodes, wires)).toBeNull();
    saveTemplate('B', nodes, wires);
    saveTemplate('A', nodes, wires);
    expect(listTemplates()).toEqual(['A', 'B']);
  });

  it('returns null for a corrupt stored template', () => {
    localStorage.setItem('oz-topology-template:broken', 'not json');
    expect(loadTemplate('broken')).toBeNull();
  });
});

// ADR #45 §4.2 — the forward migration. Its whole purpose is that nobody loses a
// template they had already saved, so the ordering is the contract: the local
// copy goes away only once the backend has taken it.
describe('migrateLocalTemplates', () => {
  beforeEach(() => localStorage.clear());

  const imported = async () =>
    (await import('@/features/locations/topologyExport')).migrateLocalTemplates;

  it('moves each template to the backend and clears it locally', async () => {
    saveTemplate('Main Floor', nodes, wires);
    saveTemplate('Patio', nodes, wires);
    const sent: string[] = [];
    const migrate = await imported();

    const result = await migrate(async (name) => { sent.push(name); });

    expect(sent.sort()).toEqual(['Main Floor', 'Patio']);
    expect(result.migrated.sort()).toEqual(['Main Floor', 'Patio']);
    expect(result.failed).toEqual([]);
    expect(listTemplates()).toEqual([]);
  });

  it('passes the parsed payload, not a JSON string inside a string', async () => {
    saveTemplate('Main Floor', nodes, wires);
    const migrate = await imported();
    let seen: unknown;

    await migrate(async (_name, payload) => { seen = payload; });

    expect(seen).not.toBeInstanceOf(String);
    expect((seen as { nodes: unknown }).nodes).toEqual(nodes);
  });

  it('keeps the local copy when the backend refuses it', async () => {
    // The property the rest of this file exists to protect. A migration that
    // clears storage before the write lands is worse than no migration at all.
    saveTemplate('Main Floor', nodes, wires);
    const migrate = await imported();

    const result = await migrate(async () => { throw new Error('storage full'); });

    expect(result.migrated).toEqual([]);
    expect(result.failed).toEqual(['Main Floor']);
    expect(listTemplates()).toEqual(['Main Floor']);
    expect(loadTemplate('Main Floor')).not.toBeNull();
  });

  it('clears only the templates that landed when one of several fails', async () => {
    saveTemplate('Good', nodes, wires);
    saveTemplate('Bad', nodes, wires);
    const migrate = await imported();

    const result = await migrate(async (name) => {
      if (name === 'Bad') throw new Error('rejected');
    });

    expect(result.migrated).toEqual(['Good']);
    expect(result.failed).toEqual(['Bad']);
    expect(listTemplates()).toEqual(['Bad']);
  });

  it('leaves a corrupt template in place without calling the backend', async () => {
    localStorage.setItem('oz-topology-template:broken', 'not json');
    const migrate = await imported();
    let calls = 0;

    const result = await migrate(async () => { calls += 1; });

    expect(calls).toBe(0);
    expect(result.failed).toEqual(['broken']);
    expect(localStorage.getItem('oz-topology-template:broken')).not.toBeNull();
  });

  it('is a no-op when there is nothing to migrate', async () => {
    const migrate = await imported();
    let calls = 0;

    const result = await migrate(async () => { calls += 1; });

    expect(calls).toBe(0);
    expect(result).toEqual({ migrated: [], failed: [] });
  });
});

// ── ADR #45 §4.2 — migration-wiring canary ───────────────────────────────
//
// Round 39 found that `migrateLocalTemplates` is defined and covered by six tests
// and called by NOTHING in production. That is fine on its own. What is not fine
// is the change it enables: once the editor lists templates from per-branch
// storage, any template still sitting in localStorage disappears from the only UI
// that can reach it. Every one of the 510 editor tests would pass that bug,
// because none of them simulate an upgraded install.
//
// So this pins the invariant instead. It reads the editor source the way
// topologyValidationParity.test.ts reads the validators, for the same reason: the
// thing being checked is "does this call site exist", and no runtime assertion in a
// unit test can see an absent call.
//
// When the swap lands, the FIRST test below fails. That is the canary firing, not a
// regression: rewrite it to assert the new state, and while you are there confirm
// the migration is invoked BEFORE the first listing, not after - the ordering is
// what decides whether anyone's templates survive the upgrade.

describe('template migration wiring (canary)', () => {
  const editorSource = readFileSync(
    join(process.cwd(), 'src/features/locations/NodeTopologyEditor.tsx'),
    'utf8',
  );
  const usesBackendTemplates = /\b(?:save|load|list|delete)TopologyTemplates?\s*\(/.test(editorSource);
  const invokesMigration = /\bmigrateLocalTemplates\s*\(/.test(editorSource);

  it('documents today: the editor still reads templates from localStorage only', () => {
    expect(usesBackendTemplates).toBe(false);
    expect(invokesMigration).toBe(false);
  });

  it('never lets the editor reach for backend templates without running the migration', () => {
    // The half-swap is the dangerous one: switching the listing while leaving the
    // migration uncalled is silent data loss, and this is the only test that
    // notices.
    if (usesBackendTemplates) {
      expect(invokesMigration, 'backend templates are in use but the migration is never invoked').toBe(true);
    }
    expect(usesBackendTemplates || !usesBackendTemplates).toBe(true);
  });
});