import { describe, expect, it } from 'vitest';
import type { TopologyNodeData } from '@/features/locations/NodeTopologyEditor';
import {
  cardKindToken,
  gatingSemanticId,
  iconForNode,
  leftPortVariants,
  NODE_KIND_REGISTRY,
  nodeKindEntry,
  nodeKindToken,
  pairingAdmitsKinds,
  SELECTABLE_WORKSPACE_TYPE_KEYS,
  socketSemanticIds,
  visiblePortsForNode,
  workspaceTypeLabel,
} from '@/features/locations/topologyCard';
import {
  CartIcon,
  NodesIcon,
  PrinterIcon,
  StoreIcon,
  UtensilsIcon,
  WarehouseIcon,
} from '@/features/locations/NodeTopologyIcons';
import topologySemantics from '@/features/locations/topologySemantics.json';

// ADR #45 §3 — the kind registry, and the loop it closes with §1.
//
// The registry is the single answer to "what does this kind of node look like".
// These tests hold it to three promises:
//   1. it covers the vocabulary, so no node resolves by accident;
//   2. it did not change what the card renders (the behavior freeze proves the
//      how; these prove the invariants that make the table trustworthy);
//   3. it does not advertise a socket the §1 contract can never authorize —
//      the defect the registry exists to make visible.

function node(type: TopologyNodeData['type'], typeKey?: string): TopologyNodeData {
  return {
    id: 'n',
    type,
    name: 'N',
    x: 0,
    y: 0,
    ...(typeKey === undefined ? {} : { metadata: { typeKey } }),
  };
}

/** Every kind the registry can resolve, plus the kinds the contract declares
 *  but the registry has no row for. Both directions matter: a contract kind
 *  with no row is a card falling through, and a row with no contract kind is a
 *  shape nothing can wire to. */
const CARD_KINDS = [
  'branch-location',
  'warehouse',
  'hardware',
  'workspace:store-pos',
  'workspace:restaurant-pos',
  'workspace:kds',
  'workspace:warehouse',
  // An unregistered typeKey. It resolves through the `workspace:*` fallback
  // row, and the contract speaks it as-is — which is the whole point of
  // probing it here rather than probing the token `workspace:*`.
  'workspace:admin',
];

/** Kinds a wire could legitimately sit on the far end of. Includes kinds no
 *  card row exists for, because the contract speaks them. */
const FAR_END_KINDS = [
  ...CARD_KINDS,
  'workspace:admin',
  'workspace:general',
  'workspace:pharmacy-pos',
  'not-a-kind',
];

const ALL_SEMANTICS = new Set(
  topologySemantics.semanticPairings.flatMap((row) => [row.source, row.target]),
);

describe('node kind registry (ADR #45 §3)', () => {
  it('has a row for every node type the canvas can hold', () => {
    for (const type of ['store', 'workspace', 'warehouse', 'hardware'] as const) {
      expect(nodeKindEntry(node(type))).toBe(NODE_KIND_REGISTRY[cardKindToken(node(type))]);
    }
  });

  it('has a row for every workspace type the semantic contract declares', () => {
    // A declared type that resolves through the fallback is the bug this
    // registry exists to prevent: the contract says the type is authorable
    // while the card draws it as an unknown shape.
    for (const key of topologySemantics.endpointWorkspaceTypeKeys) {
      expect(NODE_KIND_REGISTRY[`workspace:${key}`], `workspace:${key} has no registry row`)
        .toBeDefined();
    }
  });

  it('resolves an unregistered workspace type to the declared fallback row', () => {
    // ADR #45 §3 follow-up #1 moved `admin` out of here: it is a real seeded type
    // with no contract endpoints, so it now has its own row with no output
    // socket. What still falls back is a type the registry has never heard of,
    // and a legacy node carrying no type key at all.
    expect(nodeKindEntry(node('workspace'))).toBe(NODE_KIND_REGISTRY['workspace:*']);
    expect(nodeKindEntry(node('workspace', 'pharmacy-pos'))).toBe(NODE_KIND_REGISTRY['workspace:*']);
    expect(NODE_KIND_REGISTRY['workspace:admin']).toBeDefined();
  });

  it('keeps the card token and the contract token deliberately different', () => {
    // The contract resolves a type-less workspace to `workspace:store-pos` so
    // it stays authorable as a Store POS; the card must NOT, or every legacy
    // node silently gains POS sockets. This one assertion is the whole reason
    // two tokens exist.
    const untyped = node('workspace');
    expect(nodeKindToken('workspace', undefined)).toBe('workspace:store-pos');
    expect(cardKindToken(untyped)).toBe('workspace:*');
    // Registered kinds agree, which is what makes the split safe.
    expect(nodeKindToken('workspace', 'kds')).toBe(cardKindToken(node('workspace', 'kds')));
    expect(nodeKindToken('store', undefined)).toBe(cardKindToken(node('store')));
  });

  it('gives each workspace kind the glyph the tool rack offers it', () => {
    // ADR #45 §3: the rack was already choosing per-kind glyphs — a cart for
    // retail, a fork for restaurant, a node cluster for the kitchen display —
    // while the canvas drew all three as `PosIcon`, because the old icon map
    // was keyed on node.type and could not express the difference. A merchant
    // clicked a fork and got a till. The registry keys on kind, so the two
    // surfaces can finally agree.
    expect(iconForNode(node('workspace', 'store-pos'))).toBe(CartIcon);
    expect(iconForNode(node('workspace', 'restaurant-pos'))).toBe(UtensilsIcon);
    expect(iconForNode(node('workspace', 'kds'))).toBe(NodesIcon);
    // Distinctness is the actual property being protected: three names, three
    // glyphs. A regression that re-unifies them fails here.
    const glyphs = new Set([
      iconForNode(node('workspace', 'store-pos')),
      iconForNode(node('workspace', 'restaurant-pos')),
      iconForNode(node('workspace', 'kds')),
    ]);
    expect(glyphs.size).toBe(3);
  });

  it('keeps the non-workspace glyphs and always resolves one', () => {
    expect(iconForNode(node('store'))).toBe(StoreIcon);
    expect(iconForNode(node('warehouse'))).toBe(WarehouseIcon);
    expect(iconForNode(node('hardware'))).toBe(PrinterIcon);
    // An unregistered type falls back to a real glyph, never undefined — the
    // card renders the icon without a null check.
    expect(iconForNode(node('workspace', 'pharmacy-pos'))).toBeDefined();
    expect(iconForNode(node('workspace'))).toBeDefined();
  });

  it('derives gating from the socket list rather than restating it', () => {
    for (const kind of CARD_KINDS) {
      const probe = kindToNode(kind);
      for (const port of ['left', 'right'] as const) {
        expect(gatingSemanticId(probe, port)).toBe(socketSemanticIds(probe, port)[0]);
      }
    }
  });

  it('names only semantics the contract knows', () => {
    for (const [token, entry] of Object.entries(NODE_KIND_REGISTRY)) {
      for (const semantic of [...entry.leftSemantics, ...entry.rightSemantics]) {
        expect(ALL_SEMANTICS, `${token} advertises unknown semantic ${semantic}`).toContain(semantic);
      }
      if (entry.records.left !== undefined) expect(ALL_SEMANTICS).toContain(entry.records.left);
      if (entry.records.right !== undefined) expect(ALL_SEMANTICS).toContain(entry.records.right);
    }
  });

  it('shows a left socket exactly when it has a variant to render', () => {
    for (const token of Object.keys(NODE_KIND_REGISTRY)) {
      const probe = kindToNode(token);
      expect(visiblePortsForNode(probe).includes('left'), token)
        .toBe(leftPortVariants(probe).length > 0);
    }
  });

  it('owns the inspector type list, including what is NOT selectable', () => {
    // The editor used to keep its own list whose fourth member ('warehouse')
    // was filtered straight back out by its only consumer. Selectability is
    // now a property of the row, so the list cannot contain a type the
    // selector would then have to hide.
    expect(SELECTABLE_WORKSPACE_TYPE_KEYS).toEqual(['store-pos', 'restaurant-pos', 'kds']);
    // `warehouse` is a real workspace shape a legacy graph can hold — it has a
    // row and a name — but the palette creates a warehouse NODE instead, so it
    // must not appear as a type a node can be switched to.
    expect(NODE_KIND_REGISTRY['workspace:warehouse']).toBeDefined();
    expect(NODE_KIND_REGISTRY['workspace:warehouse']?.typeLabelId).toBe('topology-ws-type-warehouse');
    expect(SELECTABLE_WORKSPACE_TYPE_KEYS).not.toContain('warehouse');
  });

  it('names every selectable type, so the selector never renders a bare key', () => {
    for (const key of SELECTABLE_WORKSPACE_TYPE_KEYS) {
      const seen: string[] = [];
      const label = workspaceTypeLabel(key, (id) => { seen.push(id); return `«${id}»`; });
      expect(seen, `workspace:${key} has no typeLabelId`).toHaveLength(1);
      expect(label).toBe(`«topology-ws-type-${key}»`);
    }
    // An unregistered key has no name and is shown as-is rather than as a
    // missing-translation placeholder.
    expect(workspaceTypeLabel('pharmacy-pos', () => 'SHOULD-NOT-CALL')).toBe('pharmacy-pos');
  });

  it('advertises no socket the contract cannot authorize — except the recorded debt', () => {
    // The §1↔§3 loop. A socket a card draws is a promise to the merchant that
    // a wire can be attached to it. When the contract admits no endpoint pair
    // for that semantic and kind, the promise is false: the picker offers a
    // relationship that Apply will refuse, which is the exact failure ADR #45
    // was written to end.
    //
    // The unauthorable set is asserted EXACTLY, as a ledger. Adding a kind with
    // an illegal socket fails the test; fixing one shrinks the ledger, which
    // also fails until the entry is removed — so the debt can neither grow
    // quietly nor be forgotten.
    const found: string[] = [];
    for (const kind of CARD_KINDS) {
      const probe = kindToNode(kind);
      for (const [port, semantics] of [
        ['right', socketSemanticIds(probe, 'right')] as const,
        ['left', socketSemanticIds(probe, 'left')] as const,
      ]) {
        for (const semantic of semantics) {
          const rows = topologySemantics.semanticPairings.filter((row) => (
            port === 'right' ? row.source === semantic : row.target === semantic
          ));
          const authorable = rows.some((row) => (
            port === 'right'
              ? FAR_END_KINDS.some((far) => pairingAdmitsKinds(row.source, row.target, kind, far))
              : FAR_END_KINDS.some((far) => pairingAdmitsKinds(row.source, row.target, far, kind))
          ));
          if (!authorable) found.push(`${kind}:${port}:${semantic}`);
        }
      }
    }
    expect(found.sort()).toEqual(UNAUTHORABLE_SOCKET_DEBT.slice().sort());
  });
});

/** The recorded debt, by name. Each entry is a socket the card draws that the
 *  §1 contract admits no wire for. Emptied by ADR #45 §3 follow-up #1.
 *
 *  Read the remaining hazard honestly: this list is empty because no KIND the
 *  corpus enumerates is left holding an unauthorizable socket, not because the
 *  fallback row is now safe to empty. `workspace:*` still advertises stock-out
 *  and transfer-out, and any type the registry has never heard of — a future
 *  `pharmacy-pos`, a typo, a type added to the DB before anyone adds a row —
 *  still resolves to it. That is deliberate: a legacy node with no type key
 *  renders through the same row, and the contract treats it as
 *  `workspace:store-pos`, whose stock feeds are legitimate. The two-population
 *  tests below pin that coupling.
 *
 *  The list is kept rather than deleted so a new entry appearing here means
 *  someone gave a card a socket the contract has no endpoints for. */
const UNAUTHORABLE_SOCKET_DEBT: readonly string[] = [];

/** Map a card kind back to the contract vocabulary the gate speaks. */
function kindToNode(kind: string): TopologyNodeData {
  if (kind === 'branch-location') return node('store');
  if (kind === 'warehouse') return node('warehouse');
  if (kind === 'hardware') return node('hardware');
  if (kind === 'workspace:*') return node('workspace');
  return node('workspace', kind.replace('workspace:', ''));
}

// ADR #45 §3 follow-up #1. The ledger above records that the fallback row
// advertises sockets the contract will never authorize. It does NOT say the row
// may be emptied, and that misreading is easy to reach from the ledger alone -
// round 13 nearly shipped it. These tests pin why: `workspace:*` is the
// rendering row for two populations whose contract answers differ, so one edit
// satisfies the ledger and regresses the first population at the same time.
describe('the workspace:* fallback row serves two populations', () => {
  it('renders a type-less legacy store from the fallback while the contract treats it as store-pos', () => {
    const legacy = node('workspace');
    expect(cardKindToken(legacy)).toBe('workspace:*');
    expect(nodeKindToken('workspace', undefined)).toBe('workspace:store-pos');
    // The two functions disagree on purpose. Under the identity the contract
    // gives this node, the stock feed the fallback row shows is legitimate.
    expect(
      pairingAdmitsKinds('stock-out', 'stock-in', 'workspace:store-pos', 'warehouse'),
    ).toBe(true);
  });

  it('gives an unregistered-but-known workspace type its own row, not the fallback', () => {
    const admin = node('workspace', 'admin');
    // cardKindToken distinguishes the two populations: an explicit type key stays
    // itself rather than collapsing to the wildcard. Step 2 of ADR #45 §3
    // follow-up #1 gave `admin` a row of its own, so nodeKindEntry no longer has
    // to reach the `??` fallback for it.
    expect(cardKindToken(admin)).toBe('workspace:admin');
    expect(NODE_KIND_REGISTRY['workspace:admin']).toBeDefined();
    expect(
      pairingAdmitsKinds('stock-out', 'stock-in', 'workspace:admin', 'warehouse'),
    ).toBe(false);
    // And the row now matches what the contract says: nothing to offer.
    expect(nodeKindEntry(admin).rightSemantics).toEqual([]);
  });

  it('no longer resolves the two populations to one row, which is what emptied the ledger', () => {
    // This assertion is the inverse of the one that stood here through step 1.
    // It failed the moment `admin` got its own row, which is exactly the signal
    // the ledger test was written to demand before anyone deletes a socket.
    expect(nodeKindEntry(node('workspace'))).not.toBe(nodeKindEntry(node('workspace', 'admin')));
  });
});
