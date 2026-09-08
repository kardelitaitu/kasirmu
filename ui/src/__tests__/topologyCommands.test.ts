import { describe, expect, it } from 'vitest';
import {
  bendLandedAtStart,
  cancelBendDecision,
  deletableNodeIds,
  disconnectNode,
  moveLandedAtStart,
  nodesWithoutIds,
  restoreNodesToStart,
  stockRoutingWires,
  wireConnectRefusal,
  WIRE_CONNECT_REFUSAL_TOAST,
  wiresWithoutEndpoints,
} from '../features/locations/topologyCommands';
import type {
  TopologyNodeData,
  TopologyWireData,
} from '../features/locations/NodeTopologyEditor';
import type { WireRelationshipOption } from '../features/locations/topologyCard';

const node = (id: string, type: TopologyNodeData['type']): TopologyNodeData => ({
  id,
  type,
  name: id,
  x: 0,
  y: 0,
});

const wire = (id: string, fromNodeId: string, toNodeId: string): TopologyWireData => ({
  id,
  fromNodeId,
  toNodeId,
  direction: 'one-way',
  fromPort: 'right',
  toPort: 'left',
});

describe('deletableNodeIds', () => {
  it('excludes Branch Location nodes — they are permanent anchors', () => {
    const nodes = [node('store-1', 'store'), node('ws-1', 'workspace'), node('hw-1', 'hardware')];
    expect(deletableNodeIds(nodes, ['store-1', 'ws-1', 'hw-1'])).toEqual(['ws-1', 'hw-1']);
  });

  it('detects Branch Locations by type, not by id spelling', () => {
    const nodes = [node('store-named-workspace', 'workspace'), node('ws-1', 'workspace')];
    expect(deletableNodeIds(nodes, ['store-named-workspace', 'ws-1'])).toEqual([
      'store-named-workspace',
      'ws-1',
    ]);
  });

  it('preserves input order and deduplicates', () => {
    const nodes = [node('a', 'workspace'), node('b', 'workspace')];
    expect(deletableNodeIds(nodes, ['b', 'a', 'b', 'a'])).toEqual(['b', 'a']);
  });

  it('treats unknown ids as deletable, matching the inline filter it replaced', () => {
    const nodes = [node('store-1', 'store')];
    expect(deletableNodeIds(nodes, ['ghost-id'])).toEqual(['ghost-id']);
  });

  it('returns empty for an all-branch request or an empty request', () => {
    const nodes = [node('store-1', 'store'), node('ws-1', 'workspace')];
    expect(deletableNodeIds(nodes, ['store-1'])).toEqual([]);
    expect(deletableNodeIds(nodes, [])).toEqual([]);
  });
});

describe('nodesWithoutIds', () => {
  it('removes only the doomed ids and preserves the rest in order', () => {
    const nodes = [node('store-1', 'store'), node('a', 'workspace'), node('b', 'workspace')];
    const result = nodesWithoutIds(nodes, new Set(['b']));
    expect(result.map((n) => n.id)).toEqual(['store-1', 'a']);
  });

  it('returns a new array and mutates nothing', () => {
    const nodes = [node('a', 'workspace'), node('b', 'workspace')];
    const snapshot = [...nodes];
    const result = nodesWithoutIds(nodes, new Set(['b']));
    expect(result).not.toBe(nodes);
    expect(nodes).toEqual(snapshot);
  });

  it('keeps everything when the doomed set is empty', () => {
    const nodes = [node('a', 'workspace'), node('b', 'workspace')];
    expect(nodesWithoutIds(nodes, new Set()).map((n) => n.id)).toEqual(['a', 'b']);
  });
});

const wsNode = { id: 'ws-1', type: 'workspace' } as Pick<TopologyNodeData, 'id' | 'type'>;
const whNode = { id: 'wh-1', type: 'warehouse' } as Pick<TopologyNodeData, 'id' | 'type'>;
const kdsNode = { id: 'kds-1', type: 'workspace' } as Pick<TopologyNodeData, 'id' | 'type'>;
const printerNode = { id: 'printer-1', type: 'hardware' } as Pick<TopologyNodeData, 'id' | 'type'>;

const directed = (
  id: string,
  fromNodeId: string,
  toNodeId: string,
  extra: Partial<TopologyWireData> = {},
): TopologyWireData => ({
  id,
  fromNodeId,
  toNodeId,
  direction: 'one-way',
  fromPort: 'right',
  toPort: 'left',
  ...extra,
});

const option = (
  overrides: Partial<Pick<WireRelationshipOption, 'toPortId' | 'relationshipType'>> = {},
): Pick<WireRelationshipOption, 'toPortId' | 'relationshipType'> => ({
  toPortId: 'location-in',
  relationshipType: 'location',
  ...overrides,
});

describe('stockRoutingWires', () => {
  it('counts typed, legacy-untyped, and generic-operation stock routes; excludes transfers and other orientations', () => {
    const wires = [
      directed('w1', 'ws-1', 'wh-1', { relationshipType: 'stock-routing' }),
      // Legacy untyped wire: the optional semantic keys are OMITTED
      // (exactOptionalPropertyTypes), which is exactly the legacy shape
      // the helpers must recognize.
      directed('w2', 'kds-1', 'wh-1', {}),
      directed('w3', 'ws-1', 'wh-1', { relationshipType: 'generic', toPortId: 'operation-in' }),
      directed('w4', 'ws-1', 'wh-1', { relationshipType: 'inventory-transfer' }),
      directed('w5', 'wh-1', 'ws-1', { relationshipType: 'stock-routing' }),
      directed('w6', 'ghost', 'wh-1', { relationshipType: 'stock-routing' }),
    ];
    const nodeTypes = new Map([wsNode, whNode, kdsNode].map((n) => [n.id, n]));
    expect(stockRoutingWires(wires, nodeTypes).map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
  });
});

describe('wireConnectRefusal', () => {
  const noContext = { isProAllowed: false, existingStockWires: [] };

  it('refuses a duplicate forward wire — legacy untyped existing wire matches by default ports', () => {
    const wires = [directed('w1', 'ws-1', 'wh-1', {})];
    expect(wireConnectRefusal(wires, wsNode, 'right', whNode, 'left', option(), noContext))
      .toEqual({ reason: 'duplicate' });
  });

  it('refuses a duplicate forward wire when a typed existing wire shares the option target port', () => {
    const wires = [directed('w1', 'ws-1', 'wh-1', { toPortId: 'location-in' })];
    expect(wireConnectRefusal(wires, wsNode, 'right', whNode, 'left', option({ toPortId: 'location-in' }), noContext))
      .toEqual({ reason: 'duplicate' });
  });

  it('escapes the DUPLICATE gate when a typed existing wire targets a different port', () => {
    // The duplicate match compares (w.toPortId ?? 'location-in') against the
    // option's target port — a different port id is a different wire.
    const wires = [directed('w1', 'ws-1', 'printer-1', { toPortId: 'ticket-in' })];
    expect(wireConnectRefusal(wires, wsNode, 'right', printerNode, 'left', option({ relationshipType: 'generic', toPortId: 'operation-in' }), noContext))
      .toBeNull();
  });

  it('still applies the single warehouse-input gate to a same-pair transfer option', () => {
    // The "transfer is always authorable" rule belongs to the stock-routing
    // TIER gate only — the one-input-per-warehouse gate fires first here.
    const wires = [directed('w1', 'ws-1', 'wh-1', { relationshipType: 'stock-routing', toPortId: 'location-in' })];
    expect(wireConnectRefusal(wires, wsNode, 'right', whNode, 'left', option({ toPortId: 'operation-in', relationshipType: 'inventory-transfer' }), { isProAllowed: true, existingStockWires: [] }))
      .toEqual({ reason: 'warehouse-input-taken' });
  });

  it('refuses a port-mirrored reversed wire and ignores relationship typing in that arm', () => {
    // The reversed arm matches ids + mirrored ports only (existing fromPort
    // === new targetPort, existing toPort === new sourcePort) — no typing
    // condition exists on that side.
    const wires = [directed('w1', 'wh-1', 'ws-1', { relationshipType: 'stock-routing', fromPort: 'left', toPort: 'right' })];
    expect(wireConnectRefusal(wires, wsNode, 'right', whNode, 'left', option(), noContext))
      .toEqual({ reason: 'duplicate' });
  });

  it('does not match a reversed wire whose ports are not mirrored', () => {
    const wires = [directed('w1', 'wh-1', 'ws-1', { relationshipType: 'stock-routing' })];
    expect(wireConnectRefusal(wires, wsNode, 'right', whNode, 'left', option(), noContext))
      .toBeNull();
  });

  it('refuses a second wire into a warehouse input port already occupied', () => {
    const wires = [directed('w1', 'ws-1', 'wh-1', { toPortId: 'location-in' })];
    expect(wireConnectRefusal(wires, kdsNode, 'right', whNode, 'left', option({ toPortId: 'location-in' }), noContext))
      .toEqual({ reason: 'warehouse-input-taken' });
  });

  it('does not count a legacy portless wire as occupying the warehouse input slot', () => {
    const wires = [directed('w1', 'ws-1', 'wh-1', { relationshipType: 'stock-routing' })];
    expect(wireConnectRefusal(wires, kdsNode, 'right', whNode, 'left', option({ toPortId: 'location-in' }), noContext))
      .toBeNull();
  });

  it('refuses a different ticket source onto an already-sourced ticket device (ADR #34)', () => {
    const wires = [directed('w1', 'kds-1', 'printer-1', { relationshipType: 'ticket-routing', toPortId: 'ticket-in' })];
    expect(wireConnectRefusal(wires, wsNode, 'right', printerNode, 'left', option({ relationshipType: 'ticket-routing', toPortId: 'ticket-in' }), noContext))
      .toEqual({ reason: 'ticket-input-taken' });
  });

  it('applies ticket cardinality only to ticket-routing options', () => {
    const wires = [directed('w1', 'kds-1', 'printer-1', { relationshipType: 'ticket-routing', toPortId: 'ticket-in' })];
    expect(wireConnectRefusal(wires, wsNode, 'right', printerNode, 'left', option({ relationshipType: 'generic', toPortId: 'operation-in' }), noContext))
      .toBeNull();
  });

  it('caps stock routes at one on non-Pro tiers, using the precomputed stock population', () => {
    const wires = [directed('w1', 'ws-1', 'wh-1', { relationshipType: 'stock-routing' })];
    const nodeTypes2 = new Map([wsNode, whNode].map((n) => [n.id, n]));
    const existing = stockRoutingWires(wires, nodeTypes2);
    expect(wireConnectRefusal(wires, kdsNode, 'right', whNode, 'left', option({ relationshipType: 'stock-routing', toPortId: 'operation-in' }), { isProAllowed: false, existingStockWires: existing }))
      .toEqual({ reason: 'stock-routing-limit' });
    expect(wireConnectRefusal(wires, kdsNode, 'right', whNode, 'left', option({ relationshipType: 'stock-routing', toPortId: 'operation-in' }), { isProAllowed: true, existingStockWires: existing }))
      .toBeNull();
  });

  it('enforces gates in order — duplicate wins over a taken warehouse input', () => {
    const wires = [directed('w1', 'ws-1', 'wh-1', { toPortId: 'location-in' })];
    expect(wireConnectRefusal(wires, wsNode, 'right', whNode, 'left', option({ toPortId: 'location-in' }), noContext))
      .toEqual({ reason: 'duplicate' });
  });

  it('maps every refusal reason to its toast id', () => {
    expect(WIRE_CONNECT_REFUSAL_TOAST.duplicate).toBe('topology-toast-wire-duplicate');
    expect(WIRE_CONNECT_REFUSAL_TOAST['warehouse-input-taken']).toBe('topology-validation-multiple-warehouse-inputs');
    expect(WIRE_CONNECT_REFUSAL_TOAST['ticket-input-taken']).toBe('topology-validation-multiple-ticket-inputs');
    expect(WIRE_CONNECT_REFUSAL_TOAST['stock-routing-limit']).toBe('topology-toast-fallback-warehouse');
  });
});

describe('disconnectNode', () => {
  it('removes every wire touching the node on either endpoint and reports changed', () => {
    const wires = [wire('w1', 'a', 'b'), wire('w2', 'b', 'a'), wire('w3', 'a', 'c'), wire('w4', 'c', 'd')];
    const result = disconnectNode(wires, 'a');
    expect(result.changed).toBe(true);
    expect(result.wires.map((w) => w.id)).toEqual(['w4']);
  });

  it('reports changed=false when no wire touches the node — no history entry may result', () => {
    const wires = [wire('w1', 'b', 'c')];
    const result = disconnectNode(wires, 'a');
    expect(result.changed).toBe(false);
    expect(result.wires.map((w) => w.id)).toEqual(['w1']);
  });

  it('does not mutate the input', () => {
    const wires = [wire('w1', 'a', 'b')];
    const snapshot = [...wires];
    disconnectNode(wires, 'a');
    expect(wires).toEqual(snapshot);
  });
});

describe('wiresWithoutEndpoints', () => {
  it('drops wires anchored to any deleted node — from or to side', () => {
    const wires = [wire('w1', 'a', 'b'), wire('w2', 'store-1', 'a'), wire('w3', 'b', 'store-1'), wire('w4', 'store-1', 'c')];
    // w1 loses its FROM endpoint, w2 its TO endpoint — both go. w3/w4
    // never touch the doomed node and survive.
    expect(wiresWithoutEndpoints(wires, new Set(['a'])).map((w) => w.id)).toEqual(['w3', 'w4']);
  });

  it('keeps every wire when nothing is doomed', () => {
    const wires = [wire('w1', 'a', 'b'), wire('w2', 'b', 'a')];
    expect(wiresWithoutEndpoints(wires, new Set())).toEqual(wires);
  });

  it('composes into the delete command shape the editor wires up', () => {
    // Documents the deleteNodes composition: deletable ids -> one Set ->
    // node and wire filters share it, so every touching wire leaves with
    // its node and Branch Locations are never doomed.
    const nodes = [node('store-1', 'store'), node('a', 'workspace'), node('b', 'workspace'), node('c', 'hardware')];
    const wires = [wire('w1', 'a', 'b'), wire('w2', 'store-1', 'a'), wire('w3', 'b', 'c'), wire('w4', 'store-1', 'c')];
    const doomed = new Set(deletableNodeIds(nodes, ['store-1', 'a', 'b', 'ghost']));
    expect([...doomed].sort()).toEqual(['a', 'b', 'ghost']);
    expect(nodesWithoutIds(nodes, doomed).map((n) => n.id)).toEqual(['store-1', 'c']);
    // Every wire touching a or b goes; only the store→c wire survives.
    expect(wiresWithoutEndpoints(wires, doomed).map((w) => w.id)).toEqual(['w4']);
  });
});

// ── Move command (Phase 3.2) ─────────────────────────────────────────

describe('moveLandedAtStart', () => {
  it('is true when every dragged node landed exactly at its pre-drag position', () => {
    const starts = new Map([['a', { x: 100, y: 50 }], ['b', { x: 0, y: 0 }]]);
    expect(
      moveLandedAtStart(['a', 'b'], starts, [
        { id: 'a', x: 100, y: 50 },
        { id: 'b', x: 0, y: 0 },
      ]),
    ).toBe(true);
  });

  it('is false when one dragged node moved — the entry stays', () => {
    const starts = new Map([['a', { x: 100, y: 50 }]]);
    expect(moveLandedAtStart(['a'], starts, [{ id: 'a', x: 100, y: 52 }])).toBe(false);
    expect(moveLandedAtStart(['a'], starts, [{ id: 'a', x: 98, y: 50 }])).toBe(false);
  });

  it('is false when a dragged node is missing from either map — never suppress on missing data', () => {
    const starts = new Map([['a', { x: 100, y: 50 }]]);
    expect(moveLandedAtStart(['ghost'], starts, [{ id: 'a', x: 100, y: 50 }])).toBe(false);
    expect(moveLandedAtStart(['a'], starts, [])).toBe(false);
  });

  it('reads the settle output when drop-overlap resolution ran as the final source', () => {
    // Finalize feeds settledPositions (when the settle pass ran) as the
    // final-position source: a settle that moved a dragged node means the
    // drop DID change the canvas and the entry must survive.
    const starts = new Map([['a', { x: 100, y: 50 }]]);
    expect(moveLandedAtStart(['a'], starts, [{ id: 'a', x: 120, y: 50 }])).toBe(false);
  });

  it('accepts any iterable of dragged ids (the editor passes a Set)', () => {
    const starts = new Map([['a', { x: 1, y: 2 }]]);
    expect(moveLandedAtStart(new Set(['a']), starts, [{ id: 'a', x: 1, y: 2 }])).toBe(true);
  });
});

describe('restoreNodesToStart', () => {
  it('merges only coordinates — type, name, and metadata survive', () => {
    const card = { ...node('a', 'workspace'), x: 40, y: 60, name: 'Assembly', metadata: { kept: true } };
    const restored = restoreNodesToStart([card], new Map([['a', { x: 10, y: 20 }]]));
    const restoredCard = restored[0];
    expect(restoredCard).toEqual({ ...card, x: 10, y: 20 });
    expect(restoredCard?.metadata).toEqual({ kept: true });
  });

  it('leaves untouched nodes referentially identical (same object out)', () => {
    const dragged = { ...node('a', 'workspace'), x: 40, y: 60 };
    const bystander = { ...node('b', 'workspace'), x: 5, y: 5 };
    const restored = restoreNodesToStart([dragged, bystander], new Map([['a', { x: 10, y: 20 }]]));
    expect(restored[1]).toBe(bystander);
    expect(restored[0]).not.toBe(dragged);
  });

  it('returns the same array when there is nothing to restore (empty start map)', () => {
    const nodes = [{ ...node('a', 'workspace'), x: 1, y: 1 }];
    expect(restoreNodesToStart(nodes, new Map())).toBe(nodes);
  });

  it('is pure — the input array and its cards are not mutated', () => {
    const dragged = { ...node('a', 'workspace'), x: 40, y: 60 };
    restoreNodesToStart([dragged], new Map([['a', { x: 10, y: 20 }]]));
    expect(dragged.x).toBe(40);
  });
});

// ── Bend command (Phase 3.2) ─────────────────────────────────────────

const bentWire = (id = 'w1', bends: Array<{ x: number; y: number }> = [{ x: 10, y: 20 }]): TopologyWireData => ({
  ...wire(id, 'a', 'b'),
  bends,
});

describe('cancelBendDecision', () => {
  it('a click without movement is a full no-op: no restore, no pop', () => {
    expect(
      cancelBendDecision({ wireId: 'w1', index: 0, moved: false, startX: 3, startY: 4, created: true, pendingInsert: true }),
    ).toEqual({ restore: 'none', popHistory: false });
  });

  it('a cancelled ghost that never inserted restores nothing but pops the entry', () => {
    // moved=true with pendingInsert still set cannot occur in the editor
    // (the flag flips before any further write); the decision stays total
    // for it anyway.
    expect(
      cancelBendDecision({ wireId: 'w1', index: 0, moved: true, startX: 3, startY: 4, created: true, pendingInsert: true }),
    ).toEqual({ restore: 'none', popHistory: true });
  });

  it('a cancelled created bend is removed and its entry popped', () => {
    expect(
      cancelBendDecision({ wireId: 'w1', index: 0, moved: true, startX: 3, startY: 4, created: true, pendingInsert: false }),
    ).toEqual({ restore: 'remove-bend', popHistory: true });
  });

  it('a cancelled existing bend returns to its start position with its entry popped', () => {
    expect(
      cancelBendDecision({ wireId: 'w1', index: 0, moved: true, startX: 3, startY: 4, created: false, pendingInsert: false }),
    ).toEqual({ restore: 'restore-position', popHistory: true });
  });
});

describe('bendLandedAtStart', () => {
  it('is true when an existing bend landed exactly where it started', () => {
    const wires = [bentWire('w1', [{ x: 30, y: 40 }])];
    expect(
      bendLandedAtStart(wires, { wireId: 'w1', index: 0, moved: true, startX: 30, startY: 40, created: false, pendingInsert: false }),
    ).toBe(true);
  });

  it('is false when the bend moved for real — the entry stays', () => {
    const wires = [bentWire('w1', [{ x: 31, y: 40 }])];
    expect(
      bendLandedAtStart(wires, { wireId: 'w1', index: 0, moved: true, startX: 30, startY: 40, created: false, pendingInsert: false }),
    ).toBe(false);
  });

  it('never suppresses a created bend — the bend itself is the edit', () => {
    // A ghost ending exactly at its ghost midpoint is still a creation.
    const wires = [bentWire('w1', [{ x: 30, y: 40 }])];
    expect(
      bendLandedAtStart(wires, { wireId: 'w1', index: 0, moved: true, startX: 30, startY: 40, created: true, pendingInsert: false }),
    ).toBe(false);
  });

  it('is false when the wire or bend is gone — never pop on missing data', () => {
    const gesture = { wireId: 'w1', index: 0, moved: true, startX: 30, startY: 40, created: false, pendingInsert: false };
    expect(bendLandedAtStart([], gesture)).toBe(false);
    expect(bendLandedAtStart([bentWire('w1', [])], gesture)).toBe(false);
  });
});
