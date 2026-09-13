import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TopologyNodeData, TopologyWireData } from '@/features/locations/NodeTopologyEditor';
import {
  TOPOLOGY_SCHEMA_VERSION,
  WAREHOUSE_PRIMARY_INPUT_PORTS,
  WAREHOUSE_OPERATIONAL_INPUT_PORTS,
  isWarehousePrimaryInputPort,
  isWarehouseOperationalInputPort,
  normalizeTopologyGraph,
  normalizeWireDirection,
  validateTopologyGraph,
  firstTopologyValidationError,
  orderTopologyValidationErrors,
  topologyIssueKey,
  topologyGraphIssueKey,
  type TopologyValidationError,
} from '@/features/locations/topologyContract';

const branch = (id = 'branch-1'): TopologyNodeData => ({
  id,
  type: 'store',
  name: 'Downtown Branch',
  storeProfileId: id,
  x: 0,
  y: 0,
});

const workspace = (id: string): TopologyNodeData => ({
  id,
  type: 'workspace',
  name: id,
  x: 100,
  y: 100,
});

const warehouse = (id: string): TopologyNodeData => ({
  id,
  type: 'warehouse',
  name: id,
  x: 200,
  y: 200,
});

const warehouseWith = (id: string, metadata: Record<string, unknown>): TopologyNodeData => ({
  id,
  type: 'warehouse',
  name: id,
  x: 200,
  y: 200,
  metadata,
});

const stockWire = (id: string, workspaceId: string, warehouseId: string): TopologyWireData => ({
  id,
  fromNodeId: workspaceId,
  fromPort: 'right',
  fromPortId: 'stock-out',
  toNodeId: warehouseId,
  toPort: 'left',
  toPortId: 'stock-in',
  relationshipType: 'stock-routing',
  direction: 'one-way',
});

const transferWire = (id: string, fromWarehouseId: string, toWarehouseId: string): TopologyWireData => ({
  id,
  fromNodeId: fromWarehouseId,
  fromPort: 'right',
  fromPortId: 'transfer-out',
  toNodeId: toWarehouseId,
  toPort: 'left',
  toPortId: 'transfer-in',
  relationshipType: 'inventory-transfer',
  direction: 'one-way',
});

const ownershipWire = (id: string, workspaceId: string): TopologyWireData => ({
  id,
  fromNodeId: 'branch-1',
  fromPort: 'right',
  fromPortId: 'location-out',
  toNodeId: workspaceId,
  toPort: 'left',
  toPortId: 'location-in',
  relationshipType: 'location',
  direction: 'one-way',
});

const warehouseScopeWire = (id: string, warehouseId: string): TopologyWireData => ({
  id,
  fromNodeId: 'branch-1',
  fromPort: 'right',
  fromPortId: 'location-out',
  toNodeId: warehouseId,
  toPort: 'left',
  toPortId: 'location-in',
  relationshipType: 'location',
  direction: 'one-way',
});

function graph(
  nodes: TopologyNodeData[],
  wires: TopologyWireData[],
  options: { addWarehouseScope?: boolean } = {},
) {
  const addWarehouseScope = options.addWarehouseScope ?? true;
  const existingPrimary = new Set(
    wires
      .filter((wire) => wire.toPortId === 'location-in' || wire.toPortId === 'operation-in')
      .map((wire) => wire.toNodeId),
  );
  const scopeWires = addWarehouseScope
    ? nodes
      .filter((node) => node.type === 'warehouse' && !existingPrimary.has(node.id))
      .map((node, index) => warehouseScopeWire(`warehouse-scope-${index}`, node.id))
    : [];
  return normalizeTopologyGraph(nodes, [...wires, ...scopeWires]);
}

describe('semantic topology contract', () => {
  it('keeps warehouse ownership scope separate from operational routing', () => {
    expect(WAREHOUSE_PRIMARY_INPUT_PORTS).toEqual(['location-in', 'operation-in']);
    expect(WAREHOUSE_OPERATIONAL_INPUT_PORTS).toEqual(['stock-in', 'transfer-in']);
    expect(isWarehousePrimaryInputPort('operation-in')).toBe(true);
    expect(isWarehousePrimaryInputPort('stock-in')).toBe(false);
    expect(isWarehouseOperationalInputPort('transfer-in')).toBe(true);
    expect(isWarehouseOperationalInputPort('location-in')).toBe(false);
  });

  it('normalizes legacy Store → Workspace geometry into semantic ownership ports', () => {
    const normalized = graph(
      [branch(), workspace('ws-1')],
      [{ id: 'wire-1', fromNodeId: 'branch-1', toNodeId: 'ws-1', direction: 'one-way', fromPort: 'right', toPort: 'left' }],
    );

    expect(normalized.schemaVersion).toBe(TOPOLOGY_SCHEMA_VERSION);
    expect(normalized.wires[0]).toMatchObject({
      fromPortId: 'location-out',
      toPortId: 'location-in',
      relationshipType: 'location',
      legacyInferred: true,
    });
    expect(validateTopologyGraph(normalized)).toEqual([]);
  });

  it('rejects ambiguous legacy workspace-to-workspace wires with a repairable error', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), workspace('ws-2')],
      [
        { id: 'wire-owner', fromNodeId: 'branch-1', toNodeId: 'ws-1', fromPort: 'right', toPort: 'left', direction: 'one-way' },
        { id: 'wire-ambiguous', fromNodeId: 'ws-1', toNodeId: 'ws-2', fromPort: 'right', toPort: 'left', direction: 'one-way' },
      ],
    );

    expect(validateTopologyGraph(normalized)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'ambiguous-legacy-wire',
        wireId: 'wire-ambiguous',
      }),
    ]));
  });

  it('normalizes corrupt or missing wire directions to one-way', () => {
    // Direction is presentation-only, but a corrupt/undefined value must
    // still normalize to a legal value at the contract boundary — the
    // editor renderer and location validation both assume a well-formed
    // direction, and a garbage value would flow straight through
    // otherwise (undefined survives JSON round-trips in legacy data).
    const normalized = graph(
      [branch(), workspace('ws-1'), workspace('ws-2')],
      [
        { id: 'wire-bad', fromNodeId: 'branch-1', toNodeId: 'ws-1', fromPort: 'right', toPort: 'left', direction: 'backwards' as never },
        // Legacy payloads may omit `direction` entirely (type-level cast
        // simulates pre-normalization data).
        { id: 'wire-missing', fromNodeId: 'branch-1', toNodeId: 'ws-2', fromPort: 'right', toPort: 'left', direction: undefined as never },
      ],
    );

    expect(normalized.wires[0]!.direction).toBe('one-way');
    expect(normalized.wires[1]!.direction).toBe('one-way');
    // And the graph validates cleanly — corrupt direction is not a
    // validation error, it is a normalization concern.
    expect(validateTopologyGraph(normalized)).toEqual([]);
  });

  it('re-derives a legal relationship type when the stored value is corrupt', () => {
    // relationshipType is a closed union (SemanticRelationshipType) and
    // every consumer — locationWires() filtering, the renderer's label
    // priority, the Apply boundary — assumes a well-formed value. The
    // early-return path of inferredWire accepted any truthy value, so a
    // garbage string (manual edit, stale JSON) flowed into the semantic
    // graph un-normalized. Corrupt values must be treated like missing
    // ones: fall through to legacy inference, which re-derives the legal
    // type from node identity (branch → workspace = location, else
    // generic) instead of trusting the stored value.
    const normalized = graph(
      [branch(), workspace('ws-1'), workspace('ws-2')],
      [
        // Corrupt type on a Store → Workspace wire with location ports:
        // identity re-derives 'location', the ownership is preserved.
        { id: 'wire-bad', fromNodeId: 'branch-1', toNodeId: 'ws-1', fromPort: 'right', toPort: 'left', fromPortId: 'location-out', toPortId: 'location-in', relationshipType: 'banana' as never, direction: 'one-way' },
        // Corrupt type on a workspace → workspace wire (no identity rule):
        // falls to the last-resort generic default.
        { id: 'wire-generic', fromNodeId: 'ws-1', toNodeId: 'ws-2', fromPort: 'right', toPort: 'left', fromPortId: 'legacy-out', toPortId: 'legacy-in', relationshipType: 'banana' as never, direction: 'one-way' },
      ],
    );

    expect(normalized.wires[0]!.relationshipType).toBe('location');
    expect(normalized.wires[0]!.legacyInferred).toBe(true);
    expect(normalized.wires[1]!.relationshipType).toBe('generic');
    expect(normalized.wires[1]!.legacyInferred).toBe(true);
  });

  it('re-derives legal port ids and types when stored wire fields are corrupt', () => {
    // The early-return of inferredWire guards only relationshipType —
    // fromPortId/toPortId pass through verbatim when truthy, and the
    // workspace → warehouse branch still uses ?? for the type. Port ids
    // are a closed union too (SemanticPortId), so corrupt values must
    // fall through to identity inference just like types do.
    const normalized = graph(
      [branch(), workspace('ws-1'), workspace('ws-2'), warehouse('wh-1')],
      [
        // Corrupt ports on a Store → Workspace wire with location ports:
        // identity re-derives location-out/location-in, ownership kept.
        { id: 'wire-bad', fromNodeId: 'branch-1', toNodeId: 'ws-1', fromPort: 'right', toPort: 'left', fromPortId: 'banana' as never, toPortId: 'cabbage' as never, relationshipType: 'location', direction: 'one-way' },
        // Corrupt ports + corrupt type on a workspace → warehouse wire:
        // identity re-derives stock-out/stock-in/stock-routing.
        { id: 'wire-wh', fromNodeId: 'ws-1', toNodeId: 'wh-1', fromPort: 'right', toPort: 'left', fromPortId: 'banana' as never, toPortId: 'cabbage' as never, relationshipType: 'banana' as never, direction: 'one-way' },
        // Corrupt ports on a workspace → workspace wire (no identity rule):
        // falls to the last-resort legacy placeholders + generic type.
        { id: 'wire-generic', fromNodeId: 'ws-1', toNodeId: 'ws-2', fromPort: 'right', toPort: 'left', fromPortId: 'banana' as never, toPortId: 'cabbage' as never, relationshipType: 'banana' as never, direction: 'one-way' },
      ],
    );

    expect(normalized.wires[0]).toMatchObject({
      fromPortId: 'location-out',
      toPortId: 'location-in',
      relationshipType: 'location',
      legacyInferred: true,
    });
    expect(normalized.wires[1]).toMatchObject({
      fromPortId: 'stock-out',
      toPortId: 'stock-in',
      relationshipType: 'stock-routing',
      legacyInferred: true,
    });
    expect(normalized.wires[2]).toMatchObject({
      fromPortId: 'legacy-out',
      toPortId: 'legacy-in',
      relationshipType: 'generic',
      legacyInferred: true,
    });
  });

  it('keeps legal non-stock ports on a workspace → warehouse wire (no over-fold)', () => {
    // The warehouse branch folds corrupt ports to stock, but a LEGAL
    // port (ticket-out/ticket-in, device-out, …) must survive unchanged —
    // the whitelist is the SemanticPortId union, not a stock-only list.
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouse('wh-1')],
      [
        { id: 'wire-ticket', fromNodeId: 'ws-1', toNodeId: 'wh-1', fromPort: 'right', toPort: 'left', fromPortId: 'ticket-out', toPortId: 'ticket-in', relationshipType: 'ticket-routing', direction: 'one-way' },
      ],
    );

    expect(normalized.wires[0]).toMatchObject({
      fromPortId: 'ticket-out',
      toPortId: 'ticket-in',
      relationshipType: 'ticket-routing',
      legacyInferred: false,
    });
  });

  it('normalizeWireDirection keeps only the three legal flow states', () => {
    expect(normalizeWireDirection('one-way')).toBe('one-way');
    expect(normalizeWireDirection('reverse')).toBe('reverse');
    expect(normalizeWireDirection('two-way')).toBe('two-way');
    // Corrupt / legacy / missing values fold to the historical default.
    expect(normalizeWireDirection('bidirectional')).toBe('one-way');
    expect(normalizeWireDirection('banana')).toBe('one-way');
    expect(normalizeWireDirection(undefined)).toBe('one-way');
  });

  it('normalizes an unknown node kind to a legal value instead of passing it through', () => {
    // SEMANTIC_NODE_DEFINITIONS documents "unknown node kinds are not
    // accepted", but nodeKind returned node.type verbatim — a corrupt
    // type (manual edit, stale JSON) flowed into the semantic graph as an
    // opaque kind that validateTopologyGraph never sees (it filters only
    // branch-location and workspace), so the node silently passed
    // validation AND could round-trip to Apply. Fold it to a legal kind
    // so the ownership checks surface it (missing-location-input).
    const normalized = graph(
      [{ id: 'kiosk-1', type: 'kiosk' as never, name: 'Kiosk', x: 0, y: 0 }],
      [],
    );

    expect(normalized.nodes[0]!.kind).toBe('workspace');
    // The unknown-kind node is now a workspace with no Location In — the
    // corrupt data surfaces as a real validation error instead of passing.
    const errors = validateTopologyGraph(normalized);
    expect(errors.some((e) => e.code === 'missing-location-input' && e.nodeId === 'kiosk-1')).toBe(true);
  });

  it('rejects duplicate wire ids across the whole graph (mirrors duplicate-node)', () => {
    // Node ids are guarded (seenNodeIds → duplicate-node) but wire ids
    // were never checked: the existing duplicate-wire error only fires
    // for location-ownership tuples sharing the same 4-tuple. Two wires
    // with the SAME id (UUID collision from a manual edit or a stale JSON
    // merge) pass validation silently even when their endpoints differ —
    // breaking the editor's React keys, click-cycle-by-id, and
    // delete-by-id, and round-tripping to Apply.
    const errors = validateTopologyGraph(graph(
      [branch(), workspace('ws-1'), workspace('ws-2')],
      [
        ownershipWire('wire-x', 'ws-1'),
        // Same id, DIFFERENT endpoints — no 4-tuple clash, only an id clash.
        ownershipWire('wire-x', 'ws-2'),
      ],
    ));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate-wire', wireId: 'wire-x' }),
    ]));
  });

  it('rejects a non-location wire that references a node missing from the graph', () => {
    // Endpoint existence is only enforced for LOCATION wires (via
    // invalid-location-connection). A stock-routing / ticket-routing /
    // generic wire pointing at a ghost node id passed validation
    // silently — inferredWire saw undefined nodes, fell to the last-resort
    // legacy branch, and the wire round-tripped to Apply referencing a
    // node that does not exist. Every wire endpoint must resolve.
    const errors = validateTopologyGraph(graph(
      [branch(), workspace('ws-1')],
      [
        { id: 'wire-ghost', fromNodeId: 'ghost-1', toNodeId: 'ws-1', fromPort: 'right', toPort: 'left', fromPortId: 'stock-out', toPortId: 'stock-in', relationshipType: 'stock-routing', direction: 'one-way' },
      ],
    ));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unknown-wire-endpoint', wireId: 'wire-ghost' }),
    ]));
  });

  it('allows one Branch Location output to fan out to many workspaces', () => {
    const normalized = graph(
      [branch(), workspace('ws-a'), workspace('ws-b')],
      [ownershipWire('wire-a', 'ws-a'), ownershipWire('wire-b', 'ws-b')],
    );

    expect(validateTopologyGraph(normalized)).toEqual([]);
  });

  it('rejects a non-location wire whose semantic ports and relationship disagree', () => {
    const storePos = { ...workspace('store-pos'), metadata: { typeKey: 'store-pos' } };
    const warehouseNode = warehouse('warehouse-1');
    const normalized = graph(
      [branch(), storePos, warehouseNode],
      [
        ownershipWire('wire-store-location', 'store-pos'),
        {
          id: 'wire-invalid-pair',
          fromNodeId: 'store-pos',
          fromPortId: 'stock-out',
          toNodeId: 'warehouse-1',
          toPortId: 'location-in',
          relationshipType: 'stock-routing',
          direction: 'one-way',
        },
      ],
    );

    expect(validateTopologyGraph(normalized)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'invalid-semantic-connection',
        wireId: 'wire-invalid-pair',
      }),
    ]));
  });

  it('accepts a valid stock-routing wire alongside the warehouse primary scope', () => {
    const storePos = { ...workspace('store-pos'), metadata: { typeKey: 'store-pos' } };
    const warehouseNode = warehouse('warehouse-1');
    const normalized = graph(
      [branch(), storePos, warehouseNode],
      [
        ownershipWire('wire-store-location', 'store-pos'),
        {
          id: 'wire-stock',
          fromNodeId: 'store-pos',
          fromPortId: 'stock-out',
          toNodeId: 'warehouse-1',
          toPortId: 'stock-in',
          relationshipType: 'stock-routing',
          direction: 'one-way',
        },
      ],
    );

    expect(validateTopologyGraph(normalized)).toEqual([]);
  });

  it('rejects a paired ticket wire when the endpoints are not KDS and hardware', () => {
    const storePos = { ...workspace('store-pos'), metadata: { typeKey: 'store-pos' } };
    const printer = { id: 'printer-1', type: 'hardware' as const, name: 'Printer', x: 200, y: 200 };
    const normalized = graph(
      [branch(), storePos, printer],
      [
        ownershipWire('wire-store-location', 'store-pos'),
        {
          id: 'wire-invalid-ticket-source',
          fromNodeId: 'store-pos',
          fromPortId: 'ticket-out',
          toNodeId: 'printer-1',
          toPortId: 'ticket-in',
          relationshipType: 'ticket-routing',
          direction: 'one-way',
        },
      ],
    );

    expect(validateTopologyGraph(normalized)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'invalid-semantic-connection',
        wireId: 'wire-invalid-ticket-source',
      }),
    ]));
  });

  it('accepts a single KDS → printer ticket-routing wire', () => {
    const resto = { ...workspace('resto-pos'), metadata: { typeKey: 'restaurant-pos' } };
    const kds = { ...workspace('kds'), metadata: { typeKey: 'kds' } };
    const printer = { id: 'printer-1', type: 'hardware' as const, name: 'Printer', x: 300, y: 300 };
    const errors = validateTopologyGraph(graph(
      [branch(), resto, kds, printer],
      [
        ownershipWire('wire-resto-location', 'resto-pos'),
        {
          id: 'wire-resto-kds',
          fromNodeId: 'resto-pos',
          fromPortId: 'operation-out',
          toNodeId: 'kds',
          toPortId: 'operation-in',
          relationshipType: 'generic',
          direction: 'one-way',
        },
        {
          id: 'wire-ticket',
          fromNodeId: 'kds',
          fromPortId: 'ticket-out',
          toNodeId: 'printer-1',
          toPortId: 'ticket-in',
          relationshipType: 'ticket-routing',
          direction: 'one-way',
        },
      ],
    ));

    expect(errors).toEqual([]);
  });

  it('allows a KDS to fan out tickets to multiple printers', () => {
    // Ticket-routing cardinality decision (ADR #34): the OUTPUT side is
    // many — one KDS may drive a main printer plus remote/expo stations,
    // mirroring location-out fan-out. Only the input side is capped.
    const resto = { ...workspace('resto-pos'), metadata: { typeKey: 'restaurant-pos' } };
    const kds = { ...workspace('kds'), metadata: { typeKey: 'kds' } };
    const printerA = { id: 'printer-a', type: 'hardware' as const, name: 'Main Printer', x: 300, y: 300 };
    const printerB = { id: 'printer-b', type: 'hardware' as const, name: 'Expo Printer', x: 300, y: 500 };
    const errors = validateTopologyGraph(graph(
      [branch(), resto, kds, printerA, printerB],
      [
        ownershipWire('wire-resto-location', 'resto-pos'),
        {
          id: 'wire-resto-kds',
          fromNodeId: 'resto-pos',
          fromPortId: 'operation-out',
          toNodeId: 'kds',
          toPortId: 'operation-in',
          relationshipType: 'generic',
          direction: 'one-way',
        },
        {
          id: 'wire-ticket-a',
          fromNodeId: 'kds',
          fromPortId: 'ticket-out',
          toNodeId: 'printer-a',
          toPortId: 'ticket-in',
          relationshipType: 'ticket-routing',
          direction: 'one-way',
        },
        {
          id: 'wire-ticket-b',
          fromNodeId: 'kds',
          fromPortId: 'ticket-out',
          toNodeId: 'printer-b',
          toPortId: 'ticket-in',
          relationshipType: 'ticket-routing',
          direction: 'one-way',
        },
      ],
    ));

    expect(errors).toEqual([]);
  });

  it('rejects a second ticket-routing source feeding the same printer', () => {
    // Ticket-routing cardinality decision (ADR #34): the INPUT side is
    // exactly one — a ticket device accepts tickets from a single source.
    // Two KDS feeding one printer interleave tickets with no source
    // identity, the same ambiguity class the exactly-one ownership rules
    // already eliminate. Scoped to the offending device, one error.
    const restoA = { ...workspace('resto-a'), metadata: { typeKey: 'restaurant-pos' } };
    const restoB = { ...workspace('resto-b'), metadata: { typeKey: 'restaurant-pos' } };
    const kdsA = { ...workspace('kds-a'), metadata: { typeKey: 'kds' } };
    const kdsB = { ...workspace('kds-b'), metadata: { typeKey: 'kds' } };
    const printer = { id: 'printer-1', type: 'hardware' as const, name: 'Printer', x: 300, y: 300 };
    const errors = validateTopologyGraph(graph(
      [branch(), restoA, restoB, kdsA, kdsB, printer],
      [
        ownershipWire('wire-a-location', 'resto-a'),
        ownershipWire('wire-b-location', 'resto-b'),
        {
          id: 'wire-a-kds',
          fromNodeId: 'resto-a',
          fromPortId: 'operation-out',
          toNodeId: 'kds-a',
          toPortId: 'operation-in',
          relationshipType: 'generic',
          direction: 'one-way',
        },
        {
          id: 'wire-b-kds',
          fromNodeId: 'resto-b',
          fromPortId: 'operation-out',
          toNodeId: 'kds-b',
          toPortId: 'operation-in',
          relationshipType: 'generic',
          direction: 'one-way',
        },
        {
          id: 'wire-ticket-a',
          fromNodeId: 'kds-a',
          fromPortId: 'ticket-out',
          toNodeId: 'printer-1',
          toPortId: 'ticket-in',
          relationshipType: 'ticket-routing',
          direction: 'one-way',
        },
        {
          id: 'wire-ticket-b',
          fromNodeId: 'kds-b',
          fromPortId: 'ticket-out',
          toNodeId: 'printer-1',
          toPortId: 'ticket-in',
          relationshipType: 'ticket-routing',
          direction: 'one-way',
        },
      ],
    ));

    expect(errors).toEqual([
      expect.objectContaining({
        code: 'multiple-ticket-inputs',
        nodeId: 'printer-1',
        portId: 'ticket-in',
      }),
    ]);
  });

  it('accepts a KDS operationally connected to Restaurant POS', () => {
    const resto = { ...workspace('resto-pos'), metadata: { typeKey: 'restaurant-pos' } };
    const kds = { ...workspace('kds'), metadata: { typeKey: 'kds' } };
    const errors = validateTopologyGraph(graph(
      [branch(), resto, kds],
      [
        ownershipWire('wire-resto-location', 'resto-pos'),
        {
          id: 'wire-resto-kds',
          fromNodeId: 'resto-pos',
          fromPortId: 'operation-out',
          toNodeId: 'kds',
          toPortId: 'operation-in',
          relationshipType: 'generic',
          direction: 'one-way',
        },
      ],
    ));

    expect(errors).toEqual([]);
  });

  it('rejects an operation feed into KDS when the source is not Restaurant POS', () => {
    const storePos = { ...workspace('store-pos'), metadata: { typeKey: 'store-pos' } };
    const kds = { ...workspace('kds'), metadata: { typeKey: 'kds' } };
    const errors = validateTopologyGraph(graph(
      [branch(), storePos, kds],
      [
        ownershipWire('wire-pos-location', 'store-pos'),
        {
          id: 'wire-invalid-operation-source',
          fromNodeId: 'store-pos',
          fromPortId: 'operation-out',
          toNodeId: 'kds',
          toPortId: 'operation-in',
          relationshipType: 'generic',
          direction: 'one-way',
        },
      ],
    ));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'invalid-operation-source',
        nodeId: 'kds',
        wireId: 'wire-invalid-operation-source',
      }),
    ]));
  });

  it('infers a legacy Restaurant POS → KDS wire as the required operation feed', () => {
    const resto = { ...workspace('resto-pos'), metadata: { typeKey: 'restaurant-pos' } };
    const kds = { ...workspace('kds'), metadata: { typeKey: 'kds' } };
    const normalized = graph(
      [branch(), resto, kds],
      [
        ownershipWire('wire-resto-location', 'resto-pos'),
        {
          id: 'wire-resto-kds-legacy',
          fromNodeId: 'resto-pos',
          toNodeId: 'kds',
          fromPort: 'right',
          toPort: 'left',
          direction: 'one-way',
        },
      ],
    );

    expect(normalized.wires[1]).toMatchObject({
      fromPortId: 'operation-out',
      toPortId: 'operation-in',
      relationshipType: 'generic',
      legacyInferred: true,
    });
    expect(validateTopologyGraph(normalized)).toEqual([]);
  });

  it('rejects a workspace without the required Location In connection', () => {
    const errors = validateTopologyGraph(graph([branch(), workspace('ws-unowned')], []));

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'missing-location-input',
        nodeId: 'ws-unowned',
        portId: 'location-in',
      }),
    ]));
  });

  it('rejects multiple parents and duplicate semantic wires', () => {
    const errors = validateTopologyGraph(graph(
      [branch(), branch('branch-2'), workspace('ws-1')],
      [ownershipWire('wire-a', 'ws-1'), ownershipWire('wire-a-duplicate', 'ws-1')],
    ));

    expect(errors).toEqual(expect.arrayContaining([
      // Round 108: the extra-branch error is scoped to the SECOND branch —
      // the node that pushes the count past the required single root — so
      // the editor renders it as a node-scoped card note with a jump
      // target instead of a dead-end banner (same class as the round-103
      // tier-limit scoping).
      expect.objectContaining({ code: 'multiple-branch-locations', nodeId: 'branch-2' }),
      expect.objectContaining({ code: 'multiple-location-inputs', nodeId: 'ws-1' }),
      expect.objectContaining({ code: 'duplicate-wire', wireId: 'wire-a-duplicate' }),
    ]));
  });

  it('rejects a location wire that targets a non-workspace or uses the wrong ports', () => {
    const normalized = graph(
      [branch(), { ...workspace('warehouse-1'), type: 'warehouse' }],
      [
        {
          id: 'wire-invalid',
          fromNodeId: 'branch-1',
          fromPortId: 'location-in',
          toNodeId: 'warehouse-1',
          toPortId: 'location-out',
          relationshipType: 'location',
          direction: 'one-way',
        },
      ],
    );

    expect(validateTopologyGraph(normalized)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid-location-connection', wireId: 'wire-invalid' }),
    ]));
  });

  it('rejects a Branch Location without a canonical store identity', () => {
    const normalized = graph(
      [{ ...branch(), storeProfileId: '' }, workspace('ws-1')],
      [ownershipWire('wire-1', 'ws-1')],
    );

    expect(validateTopologyGraph(normalized)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'branch-location-missing-identity', nodeId: 'branch-1' }),
    ]));
  });

  it('rejects directed operational cycles', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), workspace('ws-2')],
      [
        ownershipWire('wire-owner-1', 'ws-1'),
        ownershipWire('wire-owner-2', 'ws-2'),
        {
          id: 'wire-cycle-a',
          fromNodeId: 'ws-1',
          fromPortId: 'generic-out',
          toNodeId: 'ws-2',
          toPortId: 'generic-in',
          relationshipType: 'generic',
          direction: 'one-way',
        },
        {
          id: 'wire-cycle-b',
          fromNodeId: 'ws-2',
          fromPortId: 'generic-out',
          toNodeId: 'ws-1',
          toPortId: 'generic-in',
          relationshipType: 'generic',
          direction: 'one-way',
        },
      ],
    );

    expect(validateTopologyGraph(normalized)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'cycle-detected' }),
    ]));
  });

  it('rejects duplicate node IDs', () => {
    const normalized = graph([branch(), branch(), workspace('ws-1')], []);

    expect(validateTopologyGraph(normalized)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate-node', nodeId: 'branch-1' }),
    ]));
  });

  it('rejects an unsupported schema version before validating graph contents', () => {
    const normalized = graph([branch(), workspace('ws-1')], []);
    normalized.schemaVersion = TOPOLOGY_SCHEMA_VERSION + 1;

    expect(validateTopologyGraph(normalized)).toEqual([
      expect.objectContaining({ code: 'unsupported-schema-version' }),
    ]);
  });

  it('flags a stock-deduct wire when the target warehouse is at or over capacity', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouseWith('wh-1', { stock: 1000, capacity: 1000 })],
      [ownershipWire('w-owner', 'ws-1'), stockWire('w-stock', 'ws-1', 'wh-1')],
    );

    expect(validateTopologyGraph(normalized)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'warehouse-at-capacity',
        nodeId: 'wh-1',
        wireId: 'w-stock',
      }),
    ]));
  });

  it('flags an inventory-transfer into a full satellite warehouse at capacity (round 82 follow-up)', () => {
    const normalized = graph(
      [
        branch(),
        workspace('ws-1'),
        warehouseWith('wh-hub', { stock: 500, capacity: 1000 }),
        warehouseWith('wh-sat', { stock: 500, capacity: 500 }),
      ],
      [
        ownershipWire('w-owner', 'ws-1'),
        stockWire('w-stock', 'ws-1', 'wh-hub'),
        transferWire('w-transfer', 'wh-hub', 'wh-sat'),
      ],
    );

    expect(validateTopologyGraph(normalized, 'pro')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'warehouse-at-capacity',
        nodeId: 'wh-sat',
        wireId: 'w-transfer',
      }),
    ]));
  });

  it('reports a full warehouse once even with two inbound stock-bearing wires', () => {
    // Round 89: the at-capacity error is a property of the TARGET warehouse,
    // not of each inbound wire — a full satellite fed by BOTH a stock-routing
    // wire and an inventory-transfer wire must produce exactly ONE
    // warehouse-at-capacity error, keyed to the first inbound wire (the
    // marker renders on that wire only).
    const normalized = graph(
      [
        branch(),
        workspace('ws-1'),
        warehouseWith('wh-hub', { stock: 500, capacity: 1000 }),
        warehouseWith('wh-sat', { stock: 500, capacity: 500 }),
      ],
      [
        ownershipWire('w-owner', 'ws-1'),
        stockWire('w-stock', 'ws-1', 'wh-hub'),
        stockWire('w-stock-sat', 'ws-1', 'wh-sat'),
        transferWire('w-transfer', 'wh-hub', 'wh-sat'),
      ],
    );

    const errors = validateTopologyGraph(normalized, 'pro');
    const capacityErrors = errors.filter((e) => e.code === 'warehouse-at-capacity');
    expect(capacityErrors).toHaveLength(1);
    expect(capacityErrors[0]).toEqual(expect.objectContaining({
      nodeId: 'wh-sat',
      wireId: 'w-stock-sat',
    }));
  });

  it('does not flag warehouse-at-capacity for a stock wire on a non-operational port', () => {
    // Round 135: the backend capacity guard only counts wires landing on
    // the shared operational input ports (stock-in/transfer-in) — a
    // stock-routing wire on the ownership port (location-in) is an invalid
    // connection, not a capacity event, so the backend surfaces
    // invalid-semantic-connection and never warehouse-at-capacity. The
    // frontend contract must agree, or a direct-IPC payload reports a
    // different error set than the backend accepts.
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouseWith('wh-1', { stock: 1000, capacity: 1000 })],
      [
        warehouseScopeWire('w-scope', 'wh-1'),
        { ...stockWire('w-badport', 'ws-1', 'wh-1'), toPortId: 'location-in' },
      ],
      { addWarehouseScope: false },
    );

    const errors = validateTopologyGraph(normalized, 'pro');
    expect(errors.filter((e) => e.code === 'warehouse-at-capacity')).toEqual([]);
  });

  it('flags warehouse-missing-stock-routing when the only inbound stock wire is on a non-operational port', () => {
    // Round 135 reverse guard: the backend servicing rule requires the
    // inbound stock-bearing wire on an operational input port; a stock
    // wire on the ownership port does NOT service the room, so the backend
    // rejects with warehouse-missing-stock-routing. The frontend must
    // agree, or it blesses a diagram the backend rejects.
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouseWith('wh-1', { stock: 100, capacity: 1000 })],
      [
        warehouseScopeWire('w-scope', 'wh-1'),
        { ...stockWire('w-badport', 'ws-1', 'wh-1'), toPortId: 'location-in' },
      ],
      { addWarehouseScope: false },
    );

    const errors = validateTopologyGraph(normalized, 'pro');
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'warehouse-missing-stock-routing', nodeId: 'wh-1' }),
    ]));
  });

  it('keeps a three-warehouse transfer chain clean end to end (deep hub-and-spoke)', () => {
    // Round 85: hub ← workspace (stock), mid ← hub (transfer), leaf ← mid
    // (transfer). Every warehouse has an inbound stock-bearing wire and
    // room — the chain must validate fully clean, proving deeper trees
    // don't trip the missing-wire or capacity guards.
    const normalized = graph(
      [
        branch(),
        workspace('ws-1'),
        warehouseWith('wh-hub', { stock: 300, capacity: 1000 }),
        warehouseWith('wh-mid', { stock: 200, capacity: 800 }),
        warehouseWith('wh-leaf', { stock: 100, capacity: 500 }),
      ],
      [
        ownershipWire('w-owner', 'ws-1'),
        stockWire('w-stock', 'ws-1', 'wh-hub'),
        transferWire('w-hub-mid', 'wh-hub', 'wh-mid'),
        transferWire('w-mid-leaf', 'wh-mid', 'wh-leaf'),
      ],
    );

    expect(validateTopologyGraph(normalized, 'pro')).toEqual([]);
  });

  it('rejects a circular transfer chain with exactly cycle-detected', () => {
    // Round 86: a hub → mid → leaf → hub transfer loop is a directed
    // cycle over stock-bearing wires — it must be rejected, not silently
    // accepted (the servicing guard alone would bless every warehouse
    // since each has an inbound transfer).
    const normalized = graph(
      [
        branch(),
        workspace('ws-1'),
        warehouseWith('wh-hub', { stock: 300, capacity: 1000 }),
        warehouseWith('wh-mid', { stock: 200, capacity: 800 }),
        warehouseWith('wh-leaf', { stock: 100, capacity: 500 }),
      ],
      [
        ownershipWire('w-owner', 'ws-1'),
        stockWire('w-stock', 'ws-1', 'wh-hub'),
        transferWire('w-hub-mid', 'wh-hub', 'wh-mid'),
        transferWire('w-mid-leaf', 'wh-mid', 'wh-leaf'),
        transferWire('w-leaf-hub', 'wh-leaf', 'wh-hub'),
      ],
    );

    expect(validateTopologyGraph(normalized, 'pro')).toEqual([
      expect.objectContaining({
        code: 'cycle-detected',
        nodeId: 'wh-hub',
      }),
    ]);
  });

  it('flags a mid-chain warehouse cut off from its feeder as unserviced', () => {
    // Removing the hub→mid transfer leaves wh-mid with NO inbound
    // stock-bearing wire (its own outbound transfer to leaf doesn't
    // service it) — the chain is broken mid-way and must be flagged.
    const normalized = graph(
      [
        branch(),
        workspace('ws-1'),
        warehouseWith('wh-hub', { stock: 300, capacity: 1000 }),
        warehouseWith('wh-mid', { stock: 200, capacity: 800 }),
        warehouseWith('wh-leaf', { stock: 100, capacity: 500 }),
      ],
      [
        ownershipWire('w-owner', 'ws-1'),
        stockWire('w-stock', 'ws-1', 'wh-hub'),
        transferWire('w-mid-leaf', 'wh-mid', 'wh-leaf'),
      ],
    );

    const errors = validateTopologyGraph(normalized, 'pro');
    expect(errors.filter((e) => e.code === 'warehouse-missing-stock-routing')).toEqual([
      expect.objectContaining({ nodeId: 'wh-mid' }),
    ]);
  });

  it('keeps a roomy satellite clean despite its transfer wire', () => {
    const normalized = graph(
      [
        branch(),
        workspace('ws-1'),
        warehouseWith('wh-hub', { stock: 500, capacity: 1000 }),
        warehouseWith('wh-sat', { stock: 200, capacity: 500 }),
      ],
      [
        ownershipWire('w-owner', 'ws-1'),
        stockWire('w-stock', 'ws-1', 'wh-hub'),
        transferWire('w-transfer', 'wh-hub', 'wh-sat'),
      ],
    );

    const errors = validateTopologyGraph(normalized, 'pro');
    expect(errors.filter((e) => e.code === 'warehouse-at-capacity')).toHaveLength(0);
  });

  it('flags a stock-deduct wire when stock is over capacity', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouseWith('wh-1', { stock: 1200, capacity: 1000 })],
      [ownershipWire('w-owner', 'ws-1'), stockWire('w-stock', 'ws-1', 'wh-1')],
    );

    expect(validateTopologyGraph(normalized)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'warehouse-at-capacity' }),
    ]));
  });

  it('keeps the graph clean while warehouse stock is below capacity', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouseWith('wh-1', { stock: 500, capacity: 1000 })],
      [ownershipWire('w-owner', 'ws-1'), stockWire('w-stock', 'ws-1', 'wh-1')],
    );

    expect(validateTopologyGraph(normalized)).toEqual([]);
  });

  it('skips the capacity guard when the warehouse has no capacity metadata', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouse('wh-1')],
      [ownershipWire('w-owner', 'ws-1'), stockWire('w-stock', 'ws-1', 'wh-1')],
    );

    expect(validateTopologyGraph(normalized)).toEqual([]);
  });

  it('flags a warehouse with room but no stock-routing wire, prompting the user to route stock in', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouseWith('wh-1', { stock: 500, capacity: 1000 })],
      [ownershipWire('w-owner', 'ws-1')],
    );

    expect(validateTopologyGraph(normalized)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'warehouse-missing-stock-routing',
        nodeId: 'wh-1',
      }),
    ]));
  });

  it('requires exactly one warehouse primary input', () => {
    const noPrimary = validateTopologyGraph(graph(
      [branch(), warehouse('wh-1')],
      [],
      { addWarehouseScope: false },
    ));
    expect(noPrimary).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing-warehouse-input', nodeId: 'wh-1' }),
    ]));

    const retailPos = { ...workspace('retail-pos'), metadata: { typeKey: 'store-pos' } };
    const duplicate = validateTopologyGraph(graph(
      [branch(), retailPos, warehouse('wh-1')],
      [
        ownershipWire('w-retail-location', 'retail-pos'),
        warehouseScopeWire('w-location', 'wh-1'),
        {
          id: 'w-operation',
          fromNodeId: 'retail-pos',
          fromPortId: 'operation-out',
          toNodeId: 'wh-1',
          toPortId: 'operation-in',
          relationshipType: 'generic',
          direction: 'one-way',
        },
      ],
    ));
    expect(duplicate).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'multiple-warehouse-inputs', nodeId: 'wh-1' }),
    ]));
  });

  it('accepts a Retail POS Operation as the warehouse primary input', () => {
    const retailPos = { ...workspace('retail-pos'), metadata: { typeKey: 'store-pos' } };
    const normalized = graph(
      [branch(), retailPos, warehouse('wh-1')],
      [
        ownershipWire('w-owner', 'retail-pos'),
        {
          id: 'w-operation',
          fromNodeId: 'retail-pos',
          fromPortId: 'operation-out',
          toNodeId: 'wh-1',
          toPortId: 'operation-in',
          relationshipType: 'generic',
          direction: 'one-way',
        },
      ],
    );
    expect(validateTopologyGraph(normalized)).toEqual([]);
  });

  it('skips the missing-wire guard when the warehouse is at or over capacity', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouseWith('wh-1', { stock: 1000, capacity: 1000 })],
      [ownershipWire('w-owner', 'ws-1')],
    );

    const errors = validateTopologyGraph(normalized);
    expect(errors.filter((e) => e.code === 'warehouse-missing-stock-routing')).toHaveLength(0);
  });

  it('skips the missing-wire guard when the warehouse has no capacity metadata', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouse('wh-1')],
      [ownershipWire('w-owner', 'ws-1')],
    );

    const errors = validateTopologyGraph(normalized);
    expect(errors.filter((e) => e.code === 'warehouse-missing-stock-routing')).toHaveLength(0);
  });

  it('lets an inventory-transfer wire into a warehouse satisfy the stock-in prompt (hub-and-spoke)', () => {
    // Round 82: a satellite Stock Room fed by inventory-transfer from a
    // hub validates clean — any inbound stock-bearing wire (stock-routing
    // OR warehouse-to-warehouse transfer) services the prompt.
    const normalized = graph(
      [
        branch(),
        workspace('ws-1'),
        warehouseWith('wh-hub', { stock: 500, capacity: 1000 }),
        warehouseWith('wh-sat', { stock: 200, capacity: 500 }),
      ],
      [
        ownershipWire('w-owner', 'ws-1'),
        stockWire('w-stock', 'ws-1', 'wh-hub'),
        transferWire('w-transfer', 'wh-hub', 'wh-sat'),
      ],
    );

    expect(validateTopologyGraph(normalized, 'pro')).toEqual([]);
  });

  it('still flags a warehouse with room that receives neither stock nor transfer', () => {
    // The hub-and-spoke rule is not an escape hatch: a warehouse with NO
    // inbound stock-bearing wire at all is still unserviced.
    const normalized = graph(
      [
        branch(),
        workspace('ws-1'),
        warehouseWith('wh-hub', { stock: 500, capacity: 1000 }),
        warehouseWith('wh-sat', { stock: 200, capacity: 500 }),
      ],
      [
        ownershipWire('w-owner', 'ws-1'),
        stockWire('w-stock', 'ws-1', 'wh-hub'),
      ],
    );

    const errors = validateTopologyGraph(normalized);
    expect(errors.filter((e) => e.code === 'warehouse-missing-stock-routing')).toEqual([
      expect.objectContaining({ nodeId: 'wh-sat' }),
    ]);
  });

  it('enforces the capacity guards on Pro tier', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouseWith('wh-1', { stock: 1000, capacity: 1000 })],
      [ownershipWire('w-owner', 'ws-1'), stockWire('w-stock', 'ws-1', 'wh-1')],
    );

    expect(validateTopologyGraph(normalized, 'pro')).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'warehouse-at-capacity' }),
    ]));
  });

  it('flags two warehouses below Pro tier as a tier-limit violation', () => {
    // Round 87: the multi-warehouse cap is an Apply-gate invariant the
    // contract must own — the editor and the parent screen gate both pass
    // their tier, so this single check keeps them in lockstep. The
    // transfer chain is semantically clean; the license cap is the only
    // thing that makes it illegal on standard.
    const normalized = graph(
      [
        branch(),
        workspace('ws-1'),
        warehouseWith('wh-hub', { stock: 300, capacity: 1000 }),
        warehouseWith('wh-sat', { stock: 200, capacity: 500 }),
      ],
      [
        ownershipWire('w-owner', 'ws-1'),
        stockWire('w-stock', 'ws-1', 'wh-hub'),
        transferWire('w-transfer', 'wh-hub', 'wh-sat'),
      ],
    );

    const tierErrors = validateTopologyGraph(normalized, 'plus').filter(
      (e) => e.code === 'warehouse-tier-limit',
    );
    // Exactly ONE excess Stock Room for two warehouses — the second node is
    // the one that pushes the count past the allowed single Stock Room, so
    // the editor renders it as a node-scoped card note with a jump target
    // instead of a banner with nowhere to go (round 87 follow-up).
    expect(tierErrors).toEqual([expect.objectContaining({ nodeId: 'wh-sat' })]);
  });

  it('flags every warehouse beyond the first below Pro tier', () => {
    // Multi-excess shape (round 103 follow-up): the cap flags the FIRST
    // allowed Stock Room plus every warehouse after it — with three Stock
    // Rooms the second and third are each flagged, one jumpable error per
    // excess node, so a user downgraded with several Stock Rooms can fix
    // them one by one.
    const normalized = graph(
      [
        branch(),
        workspace('ws-1'),
        warehouseWith('wh-hub', { stock: 300, capacity: 1000 }),
        warehouseWith('wh-mid', { stock: 200, capacity: 500 }),
        warehouseWith('wh-leaf', { stock: 100, capacity: 400 }),
      ],
      [
        ownershipWire('w-owner', 'ws-1'),
        stockWire('w-stock', 'ws-1', 'wh-hub'),
        transferWire('w-x1', 'wh-hub', 'wh-mid'),
        transferWire('w-x2', 'wh-mid', 'wh-leaf'),
      ],
    );

    const tierErrors = validateTopologyGraph(normalized, 'plus').filter(
      (e) => e.code === 'warehouse-tier-limit',
    );
    expect(tierErrors.map((e) => e.nodeId)).toEqual(['wh-mid', 'wh-leaf']);
  });

  it('allows two warehouses on Pro tier', () => {
    const normalized = graph(
      [
        branch(),
        workspace('ws-1'),
        warehouseWith('wh-hub', { stock: 300, capacity: 1000 }),
        warehouseWith('wh-sat', { stock: 200, capacity: 500 }),
      ],
      [
        ownershipWire('w-owner', 'ws-1'),
        stockWire('w-stock', 'ws-1', 'wh-hub'),
        transferWire('w-transfer', 'wh-hub', 'wh-sat'),
      ],
    );

    expect(validateTopologyGraph(normalized, 'pro')).toEqual([]);
  });

  it('skips the at-capacity guard below Pro tier', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouseWith('wh-1', { stock: 1000, capacity: 1000 })],
      [ownershipWire('w-owner', 'ws-1'), stockWire('w-stock', 'ws-1', 'wh-1')],
    );

    const errors = validateTopologyGraph(normalized, 'plus');
    expect(errors.filter((e) => e.code === 'warehouse-at-capacity')).toHaveLength(0);
  });

  it('skips the missing-wire prompt below Pro tier', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouseWith('wh-1', { stock: 500, capacity: 1000 })],
      [ownershipWire('w-owner', 'ws-1')],
    );

    const errors = validateTopologyGraph(normalized, 'plus');
    expect(errors.filter((e) => e.code === 'warehouse-missing-stock-routing')).toHaveLength(0);
  });

  it('allows two warehouses on Premium tier (Pro-equivalent, mirrors the backend)', () => {
    // Regression: the TS contract's Pro set was ['pro', 'enterprise'], but
    // the backend treats Premium as Pro-equivalent (max_warehouses None,
    // capacity enforced). On Premium the contract therefore flagged the
    // second Stock Room as warehouse-tier-limit and blocked Apply, while
    // the backend would have accepted it — a live-badge/Apply disagreement.
    const normalized = graph(
      [
        branch(),
        workspace('ws-1'),
        warehouseWith('wh-hub', { stock: 300, capacity: 1000 }),
        warehouseWith('wh-sat', { stock: 200, capacity: 500 }),
      ],
      [
        ownershipWire('w-owner', 'ws-1'),
        stockWire('w-stock', 'ws-1', 'wh-hub'),
        transferWire('w-transfer', 'wh-hub', 'wh-sat'),
      ],
    );

    const tierErrors = validateTopologyGraph(normalized, 'premium').filter(
      (e) => e.code === 'warehouse-tier-limit',
    );
    expect(tierErrors).toEqual([]);
  });

  it('enforces the at-capacity guard on Premium tier (Pro-equivalent)', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouseWith('wh-1', { stock: 1000, capacity: 1000 })],
      [ownershipWire('w-owner', 'ws-1'), stockWire('w-stock', 'ws-1', 'wh-1')],
    );

    expect(validateTopologyGraph(normalized, 'premium')).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'warehouse-at-capacity' }),
    ]));
  });

  it('enforces the missing-stock-routing prompt on Premium tier (Pro-equivalent)', () => {
    const normalized = graph(
      [branch(), workspace('ws-1'), warehouseWith('wh-1', { stock: 500, capacity: 1000 })],
      [ownershipWire('w-owner', 'ws-1')],
    );

    expect(validateTopologyGraph(normalized, 'premium')).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'warehouse-missing-stock-routing' }),
    ]));
  });
});

// ── ADR #45 §4.3 — validation ordering ─────────────────────────────

const err = (code: string, nodeId?: string): TopologyValidationError => ({
  code: code as TopologyValidationError['code'],
  messageId: `topology-validation-${code}`,
  ...(nodeId ? { nodeId } : {}),
});
const codes = (errors: TopologyValidationError[]): string[] => errors.map((e) => e.code);

describe('orderTopologyValidationErrors', () => {
  it('puts an unreadable graph ahead of everything else', () => {
    const ordered = orderTopologyValidationErrors([
      err('missing-location-input', 'ws-1'),
      err('unsupported-schema-version'),
      err('invalid-purpose', 'ws-1'),
    ]);
    expect(codes(ordered)[0]).toBe('unsupported-schema-version');
  });

  it('prefers a structurally impossible graph over a node with the wrong inputs', () => {
    const ordered = orderTopologyValidationErrors([
      err('missing-operation-input', 'kds-1'),
      err('cycle-detected'),
    ]);
    expect(codes(ordered)).toEqual(['cycle-detected', 'missing-operation-input']);
  });

  it('prefers an illegal wire over a legal one that exceeds a capacity limit', () => {
    const ordered = orderTopologyValidationErrors([
      err('warehouse-at-capacity', 'wh-1'),
      err('invalid-semantic-connection'),
    ]);
    expect(codes(ordered)).toEqual(['invalid-semantic-connection', 'warehouse-at-capacity']);
  });

  it('is stable within a tier, so insertion order is the tie-break', () => {
    const ordered = orderTopologyValidationErrors([
      err('missing-location-input', 'a'),
      err('missing-location-input', 'b'),
      err('missing-location-input', 'c'),
    ]);
    expect(ordered.map((e) => e.nodeId)).toEqual(['a', 'b', 'c']);
  });

  it('sorts an unlisted code last without reordering the listed ones', () => {
    // Guards the table: adding a code to the validator must not silently shuffle
    // the priority of codes that are already ranked.
    const ordered = orderTopologyValidationErrors([
      err('some-future-code' as TopologyValidationError['code']),
      err('missing-branch-location'),
      err('cycle-detected'),
    ]);
    expect(codes(ordered)).toEqual(['missing-branch-location', 'cycle-detected', 'some-future-code']);
  });

  it('does not mutate the caller array', () => {
    const input = [err('warehouse-tier-limit', 'wh-1'), err('duplicate-node')];
    const before = codes(input);
    orderTopologyValidationErrors(input);
    expect(codes(input)).toEqual(before);
  });

  it('returns an empty result for no errors', () => {
    expect(orderTopologyValidationErrors([])).toEqual([]);
  });
});

describe('firstTopologyValidationError', () => {
  it('reports the highest-priority failure, not the first pushed', () => {
    // The behaviour this replaces was `errors[0]`, which depended on Set
    // iteration and node insertion order — so the same graph could name a
    // different "next step" after the merchant dragged a card.
    const first = firstTopologyValidationError([
      err('missing-location-input', 'ws-1'),
      err('invalid-purpose', 'ws-2'),
      err('duplicate-wire'),
    ]);
    expect(first?.code).toBe('duplicate-wire');
  });

  it('is independent of the order the errors arrived in', () => {
    const a = [err('missing-operation-input'), err('cycle-detected')];
    const b = [err('cycle-detected'), err('missing-operation-input')];
    expect(firstTopologyValidationError(a)?.code).toBe(firstTopologyValidationError(b)?.code);
    expect(firstTopologyValidationError(a)?.code).toBe('cycle-detected');
  });

  it('is undefined for a valid graph', () => {
    expect(firstTopologyValidationError([])).toBeUndefined();
  });
});

// ── ADR #45 §4.3 — the priority table must stay complete ───────────
//
// `orderTopologyValidationErrors` sorts an unlisted code last, stably. That is
// the right behaviour for a code mid-addition, and it is also how a table goes
// quietly stale: a 25th code could ship, land in the last tier, and nothing would
// fail. So the completeness check reads the source rather than trusting a
// hand-maintained list — the same technique topologyThemeParity.test.ts uses for
// CSS tokens, and for the same reason: the thing being checked is a type, and a
// type is not enumerable at runtime.

describe('validation error priority table', () => {
  const source = readFileSync(join(process.cwd(), 'src/features/locations/topologyContract.ts'), 'utf8');

  const unionBlock = /export type TopologyValidationCode\s*=\s*([\s\S]*?);/.exec(source)?.[1]
    ?? /code:\s*([\s\S]*?)\n\s*\}/.exec(source)?.[1]
    ?? '';
  const declaredCodes = [...unionBlock.matchAll(/'([a-z][a-z0-9-]*)'/g)]
    .map((m) => m[1] ?? '')
    .filter((c) => c.startsWith('invalid-') || c.startsWith('missing-') || c.startsWith('multiple-')
      || c.startsWith('duplicate-') || c.startsWith('unknown-') || c.startsWith('cycle-')
      || c.startsWith('warehouse-') || c.startsWith('branch-') || c.startsWith('ambiguous-')
      || c.startsWith('unsupported-'));

  const tierBlock = /const TOPOLOGY_ERROR_TIER[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? '';
  const rankedCodes = [...tierBlock.matchAll(/^\s*'([a-z][a-z0-9-]*)':\s*\d+/gm)].map((m) => m[1] ?? '');

  it('finds both lists, so the checks below cannot pass vacuously', () => {
    // Without this, a regex that stops matching would make every assertion
    // trivially true — the failure mode source-parsing tests are prone to.
    expect(declaredCodes.length).toBeGreaterThan(20);
    expect(rankedCodes.length).toBeGreaterThan(20);
  });

  it('ranks every declared validation code', () => {
    const unranked = declaredCodes.filter((c) => !rankedCodes.includes(c));
    expect(unranked, `codes with no tier: ${unranked.join(', ')}`).toEqual([]);
  });

  it('ranks no code that the validator cannot produce', () => {
    // A typo in a tier key is worse than a missing one: it looks handled, sorts
    // the real code last, and no test about that code's position would notice.
    const phantom = rankedCodes.filter((c) => !declaredCodes.includes(c));
    expect(phantom, `tier keys not in the code union: ${phantom.join(', ')}`).toEqual([]);
  });

  it('assigns each tier a contiguous number starting at 1', () => {
    const tiers = [...new Set(rankedCodes.map((c) => {
      const re = new RegExp(`'${c}':\\s*(\\d+)`);
      return Number(re.exec(tierBlock)?.[1]);
    }))].sort((a, b) => a - b);
    expect(tiers).toEqual(tiers.map((_, i) => i + 1));
  });
});

// ── Mark-issue-resolved key formats (ADR #34 / #45) ───────────────────────
// Both prefixes are persisted into resolved_issue_keys, so a rename would silently
// mis-resolve saved dismissals instead of failing; the node half is also pinned
// incidentally by NodeTopologyEditor.test.tsx:4933's fixture, the graph half only here.

describe('topology issue-key formats', () => {
  it('pins both formats the dismissal store persists', () => {
    expect(topologyIssueKey('n1', 'm2')).toBe('node:n1:m2');
    expect(topologyGraphIssueKey('m2')).toBe('graph:m2');
  });
});