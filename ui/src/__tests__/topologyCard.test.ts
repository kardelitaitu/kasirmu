import { describe, expect, it } from 'vitest';
import type { TopologyNodeData } from '@/features/locations/NodeTopologyEditor';
import {
  isKdsNode,
  leftPortVariants,
  visiblePortsForNode,
  leftPortLabelId,
  portLabelId,
  portAriaLabelId,
  semanticPortId,
  gatingSemanticId,
  socketSemanticIds,
  canSemanticPortsConnect,
  isSemanticWireCompatible,
  nodeKindOf,
  nodeKindToken,
  pairingAdmitsKinds,
  wireRelationshipOptions,
  legacyWireResolutionOptions,
  settingsCardForTypeKey,
  topologyUiString,
  workspaceTypeLabel,
  sanitizeCopiedNode,
} from '@/features/locations/topologyCard';

const node = (overrides: Partial<TopologyNodeData>): TopologyNodeData => ({
  id: 'n-1',
  type: 'workspace',
  name: 'N',
  x: 0,
  y: 0,
  ...overrides,
});

/** identity-l10n: returns the key itself, exercising fallbacks. */
const identityL10n = {
  getString: (id: string, _vars?: unknown, fallback?: string) => fallback ?? id,
};

describe('topologyCard registry — per-node-type behavior', () => {
  it('detects KDS workspace variants by typeKey', () => {
    expect(isKdsNode(node({ metadata: { typeKey: 'kds' } }))).toBe(true);
    expect(isKdsNode(node({ metadata: { typeKey: 'store-pos' } }))).toBe(false);
    expect(isKdsNode(node({ type: 'store' }))).toBe(false);
  });

  it('exposes only an output on stores, left+right on KDS and others', () => {
    expect(visiblePortsForNode(node({ type: 'store' }))).toEqual(['right']);
    expect(visiblePortsForNode(node({ type: 'workspace', metadata: { typeKey: 'kds' } }))).toEqual(['left', 'right']);
    expect(visiblePortsForNode(node({ type: 'workspace', metadata: { typeKey: 'store-pos' } }))).toEqual(['left', 'right']);
    expect(visiblePortsForNode(node({ type: 'warehouse' }))).toEqual(['left', 'right']);
    expect(visiblePortsForNode(node({ type: 'hardware' }))).toEqual(['left', 'right']);
  });

  it('resolves left-input semantic variants per type', () => {
    expect(leftPortVariants(node({ type: 'store' }))).toEqual([]);
    expect(leftPortVariants(node({ metadata: { typeKey: 'kds' } }))).toEqual(['operation-in']);
    expect(leftPortVariants(node({ metadata: { typeKey: 'store-pos' } }))).toEqual(['location-in']);
  });

  it('maps a store output to location-out and a KDS input to operation-in', () => {
    expect(semanticPortId(node({ type: 'store' }), 'right')).toBe('location-out');
    expect(semanticPortId(node({ metadata: { typeKey: 'kds' } }), 'left')).toBe('operation-in');
    expect(semanticPortId(node({ metadata: { typeKey: 'store-pos' } }), 'left')).toBe('location-in');
  });

  it('treats a legacy Inventory workspace like a plain workspace — no flexible input', () => {
    // Inventory Management was removed from the topology (round 67); an
    // inventory node left over in a saved diagram degrades to the generic
    // workspace card: fixed Location input, store-pos settings card, and
    // ordinary workspace semantics.
    const legacy = node({ metadata: { typeKey: 'inventory' } });
    expect(leftPortLabelId(legacy, 0)).toBe('topology-port-location-in');
    // A wire never changes the label — the flexible Input/Operation
    // behavior is gone with the inventory card.
    expect(leftPortLabelId(legacy, 0, 'operation-in')).toBe('topology-port-location-in');
    expect(settingsCardForTypeKey('inventory')).toBe(settingsCardForTypeKey('store-pos'));
    expect(gatingSemanticId(legacy, 'right')).toBe('stock-out');
    expect(socketSemanticIds(legacy, 'right')).toEqual(['stock-out', 'transfer-out']);
  });

  it('labels right ports by node type', () => {
    expect(portLabelId(node({ type: 'store' }), 'right')).toBe('topology-port-location-out');
    expect(portLabelId(node({ type: 'workspace' }), 'right')).toBe('topology-port-workspace-out');
    expect(portLabelId(node({ type: 'warehouse' }), 'right')).toBe('topology-port-stock-out');
    expect(portLabelId(node({ type: 'hardware' }), 'right')).toBe('topology-port-device-out');
    expect(portAriaLabelId(node({ type: 'store' }), 'right')).toBe('topology-port-location-out-aria');
  });

  it('falls back to friendly text when the bundle is missing a key', () => {
    expect(topologyUiString(identityL10n, 'topology-port-location-in')).toBe('Location');
    expect(topologyUiString(identityL10n, 'topology-field-name')).toBe('Name');
    // Unknown keys fall back to the key itself.
    expect(topologyUiString(identityL10n, 'no-such-key')).toBe('no-such-key');
  });

  it('resolves workspace type labels and settings cards by typeKey', () => {
    expect(workspaceTypeLabel('kds', identityL10n.getString.bind(identityL10n))).toBe('topology-ws-type-kds');
    expect(workspaceTypeLabel('unknown', identityL10n.getString.bind(identityL10n))).toBe('unknown');
    // Every remaining workspace card type resolves to a concrete component.
    for (const key of ['store-pos', 'restaurant-pos', 'kds']) {
      expect(typeof settingsCardForTypeKey(key)).toBe('function');
    }
    // Unknown typeKeys fall back to the store-pos card.
    expect(settingsCardForTypeKey('mystery')).toBe(settingsCardForTypeKey('store-pos'));
  });
});

describe('typed connection pairing (ADR #34 first slice)', () => {
  it('pairs only the legal semantic port combinations', () => {
    // Ownership: a Branch Location output feeds the Location input only.
    // KDS operation inputs require a Restaurant POS operation feed.
    expect(canSemanticPortsConnect('location-out', 'location-in')).toBe(true);
    expect(canSemanticPortsConnect('location-out', 'operation-in')).toBe(false);
    // Stock routing, ticket routing, operation feeds, hardware + generic.
    expect(canSemanticPortsConnect('stock-out', 'stock-in')).toBe(true);
    expect(canSemanticPortsConnect('ticket-out', 'ticket-in')).toBe(true);
    expect(canSemanticPortsConnect('operation-out', 'operation-in')).toBe(true);
    expect(canSemanticPortsConnect('device-out', 'generic-in')).toBe(true);
    expect(canSemanticPortsConnect('generic-out', 'generic-in')).toBe(true);
  });

  it('rejects mismatched and reversed pairings', () => {
    expect(canSemanticPortsConnect('location-out', 'stock-in')).toBe(false);
    expect(canSemanticPortsConnect('stock-out', 'location-in')).toBe(false);
    expect(canSemanticPortsConnect('ticket-out', 'stock-in')).toBe(false);
    expect(canSemanticPortsConnect('operation-out', 'stock-in')).toBe(false);
    expect(canSemanticPortsConnect('device-out', 'location-in')).toBe(false);
    // Inputs are never sources.
    expect(canSemanticPortsConnect('location-in', 'location-in')).toBe(false);
    expect(canSemanticPortsConnect('stock-in', 'stock-out')).toBe(false);
  });

  it('validates persisted semantic wires against the same pairing matrix', () => {
    expect(isSemanticWireCompatible('stock-out', 'stock-in', 'stock-routing')).toBe(true);
    expect(isSemanticWireCompatible('ticket-out', 'ticket-in', 'ticket-routing')).toBe(true);
    expect(isSemanticWireCompatible('device-out', 'generic-in', 'hardware-connection')).toBe(true);
    expect(isSemanticWireCompatible('stock-out', 'location-in', 'stock-routing')).toBe(false);
    expect(isSemanticWireCompatible('ticket-out', 'ticket-in', 'generic')).toBe(false);
  });

  // ADR #45 §1: the endpoint predicates live in the contract, not in code.
  // These assertions are mirrored one-for-one by the Rust tests in
  // crates/oz-core/src/topology_tests.rs, so the two evaluators are pinned to
  // the same verdicts. ADR #45 §2 replaces the mirroring with a corpus
  // generated from the contract itself.
  it('canonicalizes a node into its contract kind token', () => {
    expect(nodeKindOf(node({ type: 'store' }))).toBe('branch-location');
    expect(nodeKindOf(node({ type: 'warehouse' }))).toBe('warehouse');
    expect(nodeKindOf(node({ type: 'hardware' }))).toBe('hardware');
    expect(nodeKindOf(node({ metadata: { typeKey: 'kds' } }))).toBe('workspace:kds');
    // A workspace with no recorded typeKey is the Store POS baseline, matching
    // the Apply-boundary default in topologyContract.
    expect(nodeKindOf(node({ type: 'workspace' }))).toBe('workspace:store-pos');
    expect(nodeKindToken('workspace', undefined)).toBe('workspace:store-pos');
  });

  it('admits declared endpoint pairs and the family form of a token', () => {
    expect(pairingAdmitsKinds(
      'operation-out', 'operation-in', 'workspace:restaurant-pos', 'workspace:kds',
    )).toBe(true);
    // A token with no `:` suffix covers the family: the Location row means
    // "any workspace", not an enumeration of every type key.
    expect(pairingAdmitsKinds('location-out', 'location-in', '@branch-root', 'workspace:store-pos')).toBe(true);
    expect(pairingAdmitsKinds('location-out', 'location-in', '@branch-root', 'warehouse')).toBe(true);
    // The future-facing generic row carries the wildcard.
    expect(pairingAdmitsKinds('generic-out', 'generic-in', 'hardware', 'warehouse')).toBe(true);
  });

  it('refuses undeclared pairs, unregistered kinds, and unknown semantics', () => {
    // The operation row's two admitted pairs are deliberately NOT the cross
    // product of its endpoints — which is why the contract lists pairs.
    expect(pairingAdmitsKinds(
      'operation-out', 'operation-in', 'workspace:store-pos', 'workspace:kds',
    )).toBe(false);
    expect(pairingAdmitsKinds('ticket-out', 'ticket-in', 'workspace:store-pos', 'hardware')).toBe(false);
    expect(pairingAdmitsKinds('location-out', 'location-in', 'workspace:store-pos', 'warehouse')).toBe(false);
    // An unregistered workspace type is not authorable until the contract
    // declares it: adding a POS type is a contract edit both gates read.
    expect(pairingAdmitsKinds('stock-out', 'stock-in', 'workspace:pharmacy-pos', 'warehouse')).toBe(false);
    expect(pairingAdmitsKinds('made-up-out', 'stock-in', 'warehouse', 'warehouse')).toBe(false);
  });

  it('resolves the full typed socket map for gating (outputs + non-workspace inputs)', () => {
    // Outputs.
    expect(gatingSemanticId(node({ type: 'store' }), 'right')).toBe('location-out');
    expect(gatingSemanticId(node({ metadata: { typeKey: 'store-pos' } }), 'right')).toBe('stock-out');
    expect(gatingSemanticId(node({ metadata: { typeKey: 'restaurant-pos' } }), 'right')).toBe('operation-out');
    expect(gatingSemanticId(node({ metadata: { typeKey: 'kds' } }), 'right')).toBe('ticket-out');
    expect(gatingSemanticId(node({ type: 'warehouse' }), 'right')).toBe('stock-out');
    expect(gatingSemanticId(node({ type: 'hardware' }), 'right')).toBe('device-out');
    // Inputs: warehouses take a primary Location/Operation scope, hardware
    // takes generic, workspaces take location (KDS takes the operation feed).
    expect(gatingSemanticId(node({ type: 'warehouse' }), 'left')).toBe('location-in');
    expect(gatingSemanticId(node({ type: 'hardware' }), 'left')).toBe('generic-in');
    expect(gatingSemanticId(node({ metadata: { typeKey: 'store-pos' } }), 'left')).toBe('location-in');
    expect(gatingSemanticId(node({ metadata: { typeKey: 'kds' } }), 'left')).toBe('operation-in');
    // Sockets that carry no typed meaning stay untyped.
    expect(gatingSemanticId(node({ type: 'store' }), 'left')).toBeUndefined();
  });

  it('keeps the recording-side semanticPortId contract stable (wire creation unaffected)', () => {
    // semanticPortId (the wire-RECORDING resolver) is deliberately unchanged
    // by the gating map: outputs and non-workspace inputs that are not
    // recorded today stay undefined there, so persisted wire semantics and
    // the duplicate-detection fallbacks are untouched.
    expect(semanticPortId(node({ metadata: { typeKey: 'store-pos' } }), 'right')).toBeUndefined();
    expect(semanticPortId(node({ type: 'warehouse' }), 'left')).toBeUndefined();
    expect(semanticPortId(node({ type: 'hardware' }), 'left')).toBeUndefined();
    // The cases the recording side DOES resolve are unchanged.
    expect(semanticPortId(node({ type: 'store' }), 'right')).toBe('location-out');
    expect(semanticPortId(node({ metadata: { typeKey: 'kds' } }), 'left')).toBe('operation-in');
    expect(semanticPortId(node({ metadata: { typeKey: 'store-pos' } }), 'left')).toBe('location-in');
  });
});

describe('relationship options (ADR #34 multi-semantic slice)', () => {
  it('resolves the multi-semantic socket map: workspaces output stock OR transfer', () => {
    // Workspaces can emit either a stock-routing feed or a transfer feed.
    // Restaurant POS additionally emits an operational feed for KDS on the
    // same output socket.
    expect(socketSemanticIds(node({ type: 'workspace', metadata: { typeKey: 'store-pos' } }), 'right')).toEqual(['stock-out', 'transfer-out', 'operation-out']);
    expect(socketSemanticIds(node({ metadata: { typeKey: 'restaurant-pos' } }), 'right')).toEqual(['operation-out', 'stock-out', 'transfer-out']);
    // A warehouse INPUT accepts one primary scope (Location or Operation),
    // while retaining stock/transfer semantics for legacy runtime wires.
    expect(socketSemanticIds(node({ type: 'warehouse' }), 'left')).toEqual(['location-in', 'operation-in', 'stock-in', 'transfer-in']);
    // Every other socket keeps its single semantic.
    expect(socketSemanticIds(node({ type: 'store' }), 'right')).toEqual(['location-out']);
    expect(socketSemanticIds(node({ type: 'warehouse' }), 'right')).toEqual(['stock-out']);
    expect(socketSemanticIds(node({ type: 'hardware' }), 'right')).toEqual(['device-out']);
    expect(socketSemanticIds(node({ metadata: { typeKey: 'kds' } }), 'right')).toEqual(['ticket-out']);
    expect(socketSemanticIds(node({ type: 'hardware' }), 'left')).toEqual(['generic-in', 'ticket-in']);
    expect(socketSemanticIds(node({ metadata: { typeKey: 'store-pos' } }), 'left')).toEqual(['location-in']);
    expect(socketSemanticIds(node({ metadata: { typeKey: 'kds' } }), 'left')).toEqual(['operation-in']);
    expect(socketSemanticIds(node({ type: 'store' }), 'left')).toEqual([]);
  });

  it('gatingSemanticId stays the PRIMARY semantic of each socket', () => {
    expect(gatingSemanticId(node({ metadata: { typeKey: 'store-pos' } }), 'right')).toBe('stock-out');
    expect(gatingSemanticId(node({ type: 'warehouse' }), 'left')).toBe('location-in');
    expect(gatingSemanticId(node({ type: 'store' }), 'right')).toBe('location-out');
  });

  it('extends the pairing table with the transfer relationship', () => {
    expect(canSemanticPortsConnect('transfer-out', 'transfer-in')).toBe(true);
    // Cross-pairing between stock and transfer is still rejected.
    expect(canSemanticPortsConnect('transfer-out', 'stock-in')).toBe(false);
    expect(canSemanticPortsConnect('stock-out', 'transfer-in')).toBe(false);
  });

  it('admits BOTH relationships for a workspace→warehouse drop, stock first', () => {
    const ws = node({ type: 'workspace', metadata: { typeKey: 'store-pos' } });
    const wh = node({ type: 'warehouse' });
    expect(wireRelationshipOptions(ws, 'right', wh, 'left')).toEqual([
      {
        fromPortId: 'stock-out',
        toPortId: 'stock-in',
        relationshipType: 'stock-routing',
        labelId: 'topology-relationship-stock-routing',
      },
      {
        fromPortId: 'transfer-out',
        toPortId: 'transfer-in',
        relationshipType: 'inventory-transfer',
        labelId: 'topology-relationship-inventory-transfer',
      },
      {
        fromPortId: 'operation-out',
        toPortId: 'operation-in',
        relationshipType: 'generic',
        labelId: 'topology-relationship-operation',
      },
    ]);
  });

  it('allows Restaurant POS to route operational tickets into a KDS', () => {
    const resto = node({ type: 'workspace', metadata: { typeKey: 'restaurant-pos' } });
    const kds = node({ type: 'workspace', metadata: { typeKey: 'kds' } });

    expect(wireRelationshipOptions(resto, 'right', kds, 'left')).toEqual([
      {
        fromPortId: 'operation-out',
        toPortId: 'operation-in',
        relationshipType: 'generic',
        labelId: 'topology-relationship-operation',
      },
    ]);
  });

  it('yields exactly one option for single-semantic drops', () => {
    const store = node({ type: 'store' });
    const ws = node({ type: 'workspace', metadata: { typeKey: 'store-pos' } });
    const wh = node({ type: 'warehouse' });
    expect(wireRelationshipOptions(store, 'right', ws, 'left')).toEqual([
      {
        fromPortId: 'location-out',
        toPortId: 'location-in',
        relationshipType: 'location',
        labelId: 'topology-relationship-location',
      },
    ]);
    expect(wireRelationshipOptions(wh, 'right', wh, 'left')).toEqual([
      {
        fromPortId: 'stock-out',
        toPortId: 'stock-in',
        relationshipType: 'stock-routing',
        labelId: 'topology-relationship-stock-routing',
      },
    ]);
  });

  describe('legacyWireResolutionOptions — the migration UI option set', () => {
    it('resolves a legacy Store → workspace wire to exactly Location', () => {
      const store = node({ type: 'store' });
      const ws = node({ type: 'workspace', metadata: { typeKey: 'store-pos' } });
      expect(legacyWireResolutionOptions(store, ws)).toEqual([
        {
          fromPortId: 'location-out',
          toPortId: 'location-in',
          relationshipType: 'location',
          labelId: 'topology-relationship-location',
        },
      ]);
    });

    it('offers Stock routing, Transfer, and Operation for a Store POS → warehouse wire', () => {
      const ws = node({ type: 'workspace', metadata: { typeKey: 'store-pos' } });
      const wh = node({ type: 'warehouse' });
      // Same option set as the socket-level drop — the migration UI must
      // never offer a relationship the drag gate would reject.
      expect(legacyWireResolutionOptions(ws, wh)).toEqual(wireRelationshipOptions(ws, 'right', wh, 'left'));
    });

    it('offers Ticket routing for a legacy KDS → hardware wire', () => {
      const kds = node({ type: 'workspace', metadata: { typeKey: 'kds' } });
      const hw = node({ type: 'hardware' });
      expect(legacyWireResolutionOptions(kds, hw)).toEqual([
        {
          fromPortId: 'ticket-out',
          toPortId: 'ticket-in',
          relationshipType: 'ticket-routing',
          labelId: 'topology-relationship-ticket-routing',
        },
      ]);
    });

    it('offers Device connection for a legacy hardware → hardware wire', () => {
      const hw = node({ type: 'hardware' });
      expect(legacyWireResolutionOptions(hw, hw)).toEqual([
        {
          fromPortId: 'device-out',
          toPortId: 'generic-in',
          relationshipType: 'hardware-connection',
          labelId: 'topology-relationship-hardware-connection',
        },
      ]);
    });

    it('yields ZERO options for a legacy workspace → workspace wire (delete-only)', () => {
      // A plain Store POS feeding another Store POS has no legal pairing
      // row — this is the classic "cannot be identified safely" case the
      // migration UI must offer as delete-only, never a silent guess.
      const ws = node({ type: 'workspace', metadata: { typeKey: 'store-pos' } });
      expect(legacyWireResolutionOptions(ws, ws)).toEqual([]);
    });

    it('offers Operation for Restaurant POS → KDS and blocks the Store POS → KDS feed', () => {
      const resto = node({ type: 'workspace', metadata: { typeKey: 'restaurant-pos' } });
      const kds = node({ type: 'workspace', metadata: { typeKey: 'kds' } });
      const storePos = node({ type: 'workspace', metadata: { typeKey: 'store-pos' } });
      expect(legacyWireResolutionOptions(resto, kds)).toEqual(wireRelationshipOptions(resto, 'right', kds, 'left'));
      // The generic operation row exists but is not authorable from a
      // Store POS — the migration UI must not offer it either.
      expect(legacyWireResolutionOptions(storePos, kds)).toEqual([]);
    });

    it('yields ZERO options for an unregistered workspace type → warehouse (ADR #45)', () => {
      // 'general' is a purpose_key, not a workspace type_key: this is a
      // workspace whose type the contract has no row for. Before ADR #45 the
      // canvas offered Stock routing and Transfer here while the Rust Apply
      // gate refused the same wire (its arm required store-pos or
      // restaurant-pos), so the merchant was invited to draw a wire that could
      // never persist. The endpoints list is now the single rule: an
      // unregistered type is not authorable until the contract says so, which
      // is also how a new POS type gets added — by declaring its rows.
      const ws = node({ type: 'workspace', metadata: { typeKey: 'general' } });
      const wh = node({ type: 'warehouse' });
      expect(legacyWireResolutionOptions(ws, wh)).toEqual([]);
      expect(wireRelationshipOptions(ws, 'right', wh, 'left')).toEqual([]);
    });

    it('offers Stock routing, Transfer, and Operation for a Store POS → warehouse', () => {
      const ws = node({ type: 'workspace', metadata: { typeKey: 'store-pos' } });
      const wh = node({ type: 'warehouse' });
      expect(legacyWireResolutionOptions(ws, wh)).toEqual([
        {
          fromPortId: 'stock-out',
          toPortId: 'stock-in',
          relationshipType: 'stock-routing',
          labelId: 'topology-relationship-stock-routing',
        },
        {
          fromPortId: 'transfer-out',
          toPortId: 'transfer-in',
          relationshipType: 'inventory-transfer',
          labelId: 'topology-relationship-inventory-transfer',
        },
        {
          fromPortId: 'operation-out',
          toPortId: 'operation-in',
          relationshipType: 'generic',
          labelId: 'topology-relationship-operation',
        },
      ]);
    });
  });

  it('labels a warehouse input by its attached relationship (Stock In / Transfer In)', () => {
    const wh = node({ type: 'warehouse' });
    expect(leftPortVariants(wh)).toEqual(['location-in', 'operation-in']);
    // Unwired: Location. Primary Operation and legacy stock/transfer wires
    // retain their corresponding labels.
    expect(leftPortLabelId(wh, 0)).toBe('topology-port-location-in');
    expect(leftPortLabelId(wh, 0, 'operation-in')).toBe('topology-port-operation-in');
    expect(leftPortLabelId(wh, 0, 'stock-in')).toBe('topology-port-stock-in');
    expect(leftPortLabelId(wh, 0, 'transfer-in')).toBe('topology-port-transfer-in');
  });

  it('yields zero options for pairs outside the pairing table', () => {
    const ws = node({ type: 'workspace', metadata: { typeKey: 'store-pos' } });
    const wh = node({ type: 'warehouse' });
    const hw = node({ type: 'hardware' });
    // Workspace → workspace (no matching target), and a workspace →
    // hardware all have no admissible pairing. Branch Location → Warehouse
    // is now a valid primary scope connection.
    expect(wireRelationshipOptions(ws, 'right', ws, 'left')).toEqual([]);
    expect(wireRelationshipOptions(node({ type: 'store' }), 'right', wh, 'left')).toEqual([
      {
        fromPortId: 'location-out',
        toPortId: 'location-in',
        relationshipType: 'location',
        labelId: 'topology-relationship-location',
      },
    ]);
    expect(wireRelationshipOptions(ws, 'right', hw, 'left')).toEqual([]);
  });

  it('authorizes a KDS ticket-out to a hardware ticket-in feed (load-only gap closed)', () => {
    // The Resto preset's kds→printer wire records ticket-out/ticket-in.
    // Hardware inputs now admit the ticket-in semantic alongside
    // generic-in, so the pair resolves to exactly one ticket-routing
    // option — authorable without a picker, and recorded in the exact
    // format the preset persists.
    const kds = node({ metadata: { typeKey: 'kds' } });
    const hw = node({ type: 'hardware' });
    expect(wireRelationshipOptions(kds, 'right', hw, 'left')).toEqual([
      {
        fromPortId: 'ticket-out',
        toPortId: 'ticket-in',
        relationshipType: 'ticket-routing',
        labelId: 'topology-relationship-ticket-routing',
      },
    ]);
    expect(canSemanticPortsConnect('ticket-out', 'ticket-in')).toBe(true);
    // A workspace stock/transfer feed must NOT leak into a hardware input
    // — only the ticket semantic is admissible there.
    expect(wireRelationshipOptions(node({ metadata: { typeKey: 'store-pos' } }), 'right', hw, 'left')).toEqual([]);
  });

  it('labels a KDS right socket as Ticket Out with a dedicated aria', () => {
    const kds = node({ metadata: { typeKey: 'kds' } });
    expect(portLabelId(kds, 'right')).toBe('topology-port-ticket-out');
    expect(portAriaLabelId(kds, 'right')).toBe('topology-port-ticket-out-aria');
  });

  it('labels a hardware left input by its attached wire: Ticket In for a ticket feed, Input otherwise', () => {
    const hw = node({ type: 'hardware' });
    // A ticket wire attached → the input reads Ticket In (matching the
    // preset format); unwired / generic feeds keep the neutral Input. The
    // aria is the generic port aria — never a Location label (a hardware
    // input is not a branch location).
    expect(leftPortLabelId(hw, 0, 'ticket-in')).toBe('topology-port-ticket-in');
    expect(leftPortLabelId(hw, 0)).toBe('topology-port-generic-in');
    expect(leftPortVariants(hw)).toEqual(['generic-in']);
    expect(portAriaLabelId(hw, 'left')).toBe('topology-port-aria');
  });
});

describe('sanitizeCopiedNode — Branch Location identity strip', () => {
  // The graph keeps EXACTLY one Branch Location, so a duplicated store card
  // must not carry the original's canonical store identity: the copy is a
  // diagram-only card (same model as a palette-spawned store) instead of a
  // second card impersonating the real branch. Every duplicate path
  // (Ctrl+D / Ctrl+V / Alt+drag / mid-drag conversion) routes through this.
  it('strips storeProfileId from a duplicated Branch Location copy', () => {
    const branch = node({ type: 'store', storeProfileId: 'loc-1' });

    const copy = sanitizeCopiedNode(branch);

    expect(copy.storeProfileId).toBeUndefined();
    expect(copy.id).toBe('n-1');
    expect(copy.type).toBe('store');
    expect(copy.name).toBe('N');
    expect(copy.x).toBe(0);
    expect(copy.y).toBe(0);
  });

  it('leaves a store with no canonical identity untouched', () => {
    const store = node({ type: 'store' });
    expect(sanitizeCopiedNode(store)).toEqual(store);
  });

  it('leaves non-store node copies untouched (same reference)', () => {
    const ws = node({ type: 'workspace', metadata: { typeKey: 'store-pos' } });
    const copy = sanitizeCopiedNode(ws);
    expect(copy).toBe(ws);
    expect(copy.metadata).toEqual({ typeKey: 'store-pos' });
  });
});
