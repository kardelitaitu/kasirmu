import type { ComponentType } from 'react';
import type { ReactLocalization } from '@fluent/react';
import type { FluentVariable } from '@fluent/bundle';
import type { PortName, SemanticRelationshipType, TopologyNodeData } from './NodeTopologyEditor';
import {
  WorkspaceStorePosSettings,
  WorkspaceRestaurantPosSettings,
  WorkspaceKdsSettings,
} from '@/features/settings/workspace-cards';
import {
  StoreIcon,
  PosIcon,
  WarehouseIcon,
  PrinterIcon,
  CartIcon,
  UtensilsIcon,
  NodesIcon,
} from './NodeTopologyIcons';
import topologySemantics from './topologySemantics.json';

// ── Registry contract ─────────────────────────────────────────────
//
// Every node type behaves differently on canvas: which ports it exposes,
// what those ports are called, which settings card its inspector opens,
// and which icon heads the card. This module is the single home for that
// per-type knowledge. Adding a new node type (a new workspace typeKey or a
// whole new NodeType) should be a one-entry change here — not a touch in a
// dozen switch statements across the editor.

/** Semantic wire-port identifiers. These are the contract surface the
 *  backend round-trips (from_port_id / to_port_id); presentation (socket
 *  placement, arrow direction) is decoupled from them. */
export type SemanticPortId =
  | 'location-out'
  | 'location-in'
  | 'operation-out'
  | 'operation-in'
  | 'stock-out'
  | 'stock-in'
  | 'transfer-out'
  | 'transfer-in'
  | 'ticket-out'
  | 'ticket-in'
  | 'device-out'
  | 'generic-in'
  | 'generic-out';

/** True for Kitchen Display workspace instances (metadata typeKey 'kds'). */
export function isKdsNode(node: TopologyNodeData): boolean {
  return node.type === 'workspace' && node.metadata?.['typeKey'] === 'kds';
}

/** True for Restaurant POS workspace instances. Restaurant POS emits an
 * operational feed consumed by the KDS operation input. */
export function isRestaurantPosNode(node: TopologyNodeData): boolean {
  return node.type === 'workspace' && node.metadata?.['typeKey'] === 'restaurant-pos';
}

/** The workspace settings card the inspector renders for a typeKey. The
 *  default (store-pos) is the baseline card; per-type cards are the
 *  exception list, so adding a workspace type with its own card is a
 *  one-line change here. */
export const WORKSPACE_SETTINGS_CARD: Readonly<Record<string, ComponentType<Record<string, unknown>>>> = {
  'store-pos': WorkspaceStorePosSettings,
  'restaurant-pos': WorkspaceRestaurantPosSettings,
  'kds': WorkspaceKdsSettings,
};

/** The settings card for a workspace node, keyed by its typeKey.
 *
 *  ADR #45 §3: the `?? store-pos` that used to sit here made an unregistered
 *  typeKey silently impersonate a Retail POS. The fallback is now DATA — the
 *  `workspace:*` registry row declares the Store POS card on the record — so
 *  changing what an unknown type gets is a visible table edit. The assertions
 *  below are on module constants this file controls, not on incoming data. */
export function settingsCardForTypeKey(
  typeKey: string,
): ComponentType<Record<string, unknown>> {
  const entry = NODE_KIND_REGISTRY[`workspace:${typeKey}`] ?? NODE_KIND_REGISTRY['workspace:*'];
  return entry!.settingsCard!;
}

/** A node prepared for canvas duplication/paste. A Branch Location copy must
 *  NOT carry the original's canonical store identity: the graph keeps exactly
 *  one branch, so the copy is a diagram-only card (the same model as a
 *  palette-spawned store) instead of a second card impersonating the real
 *  branch. Every duplicate path (Ctrl+D, Ctrl+V, Alt+drag, the mid-drag
 *  conversion) routes through this. Non-store nodes pass through untouched. */
export function sanitizeCopiedNode(node: TopologyNodeData): TopologyNodeData {
  if (node.type !== 'store') return node;
  const { storeProfileId: _stripped, ...rest } = node;
  return rest;
}

/** Type label resolver for the workspace type selector. Pure — the caller
 *  supplies the l10n string resolver so this module stays i18n-framework
 *  agnostic and trivially testable. */
export function workspaceTypeLabel(
  key: string,
  getString: (id: string, vars?: Record<string, string> | null, fallback?: string) => string,
): string {
  // ADR #45 §3: the selector's names come from the same registry row that
  // decides the card's sockets, so a type cannot be listed in one place and
  // misshapen in another. A key with no row has no registered name and is
  // shown as-is.
  const id = NODE_KIND_REGISTRY[`workspace:${key}`]?.typeLabelId;
  return id ? getString(id, null, id) : key;
}

// ── Port model ────────────────────────────────────────────────────

/** Semantic variant for the left input connector of a node. Every node
 *  exposes exactly ONE left input slot. Returns plain strings because
 *  callers index it against wire.toPortId (a free-form string). */
export function leftPortVariants(node: TopologyNodeData): readonly string[] {
  return nodeKindEntry(node).leftVariants;
}

/** Ports exposed by the frontend-only UX. Top/bottom remain load-compatible. */
export function visiblePortsForNode(node: TopologyNodeData): PortName[] {
  return [...nodeKindEntry(node).visiblePorts];
}

/** Fluent id for the label of a node's left input. `connectedPortId` is the
 *  wire's recorded toPortId — a warehouse input shows Stock or Transfer
 *  based on what is attached; every other node keeps its fixed label. */
export function leftPortLabelId(node: TopologyNodeData, variantIndex: number, connectedPortId?: string): string {
  const entry = nodeKindEntry(node);
  const byConnected = entry.leftLabelByConnected
    ? entry.leftLabelByConnected[connectedPortId ?? 'default'] ?? entry.leftLabelByConnected['default']
    : undefined;
  const byVariant = LEFT_VARIANT_LABEL[entry.leftVariants[variantIndex] ?? ''];
  // A warehouse's label follows what is plugged in, even though its primary
  // variant also has a label; a hardware input's variant has none, so the
  // attached wire decides there by default.
  return entry.connectedLabelWins
    ? byConnected ?? byVariant ?? GENERIC_IN_LABEL
    : byVariant ?? byConnected ?? GENERIC_IN_LABEL;
}

export function portLabelId(node: TopologyNodeData, port: PortName): string {
  if (port === 'left') return leftPortLabelId(node, 0);
  return nodeKindEntry(node).rightLabelId;
}

/** Fluent id for the label of ONE stacked semantic port row (round 174).
 *  Every semantic a socket exposes gets its own labeled row in the card
 *  footer; this resolves that row's label from the semantic id — the single
 *  mapping used by the row renderer, the relationship picker options, and
 *  the wire-endpoint row resolution. Falls back to the legacy per-side
 *  label for unknown semantics so nothing renders a raw id. */
export function semanticPortLabelId(
  node: TopologyNodeData,
  port: PortName,
  semanticId: SemanticPortId,
): string {
  const map: Record<SemanticPortId, string> = {
    'location-out': 'topology-port-location-out',
    'location-in': 'topology-port-location-in',
    'operation-out': 'topology-port-operation-out',
    'operation-in': 'topology-port-operation-in',
    'stock-out': 'topology-port-stock-out',
    'stock-in': 'topology-port-stock-in',
    'transfer-out': 'topology-port-transfer-out',
    'transfer-in': 'topology-port-transfer-in',
    'ticket-out': 'topology-port-ticket-out',
    'ticket-in': 'topology-port-ticket-in',
    'device-out': 'topology-port-device-out',
    'generic-in': 'topology-port-generic-in',
    'generic-out': 'topology-port-generic-out',
  };
  return map[semanticId] ?? portLabelId(node, port);
}

export function portAriaLabelId(node: TopologyNodeData, port: PortName, variantIndex = 0): string {
  const entry = nodeKindEntry(node);
  if (port === 'left') {
    return LEFT_VARIANT_ARIA[entry.leftVariants[variantIndex] ?? ''] ?? NEUTRAL_ARIA;
  }
  return entry.rightAriaLabelId;
}

/** Canonical semantic port id for a socket — the only bridge from a
 *  rendered socket to the semantic wire contract. Returns undefined for
 *  ports that carry no semantic (presentation-only sockets). */
export function semanticPortId(node: TopologyNodeData, port: PortName, _variantIndex = 0): SemanticPortId | undefined {
  // top/bottom are load-compatible presentation ports and record nothing.
  const { records } = nodeKindEntry(node);
  if (port === 'left') return records.left;
  if (port === 'right') return records.right;
  return undefined;
}

/** ALL semantic ids a socket can represent, in canonical order. The first
 *  entry is the socket's PRIMARY semantic (what gatingSemanticId resolves);
 *  extra entries exist when one socket admits multiple relationships — a
 *  Restaurant POS output admits an operational feed in addition to its
 *  stock/transfer feeds, while a warehouse input receives stock or transfer.
 *  The relationship picker (ADR #34) disambiguates multi-entry sockets at
 *  drop time. */
export function socketSemanticIds(
  node: TopologyNodeData,
  port: PortName,
  _variantIndex = 0,
): SemanticPortId[] {
  const entry = nodeKindEntry(node);
  return [...(port === 'left' ? entry.leftSemantics : entry.rightSemantics)];
}

/** The full typed socket map used by connection gating (ADR #34). Unlike
 *  the recording-side semanticPortId (which deliberately stays minimal so
 *  persisted wire semantics and duplicate detection are stable), this
 *  resolves EVERY socket's semantic — outputs (POS/warehouse stock-out,
 *  KDS ticket-out, hardware device-out) and non-workspace inputs
 *  (warehouse stock-in, hardware generic-in) included — so a drag in
 *  progress can tell compatible targets from incompatible ones before any
 *  wire is drawn. Name chosen to avoid colliding with semanticPortId.
 *  Defined as the socket's PRIMARY semantic so it can never disagree with
 *  the multi-semantic resolution used by the picker. */
export function gatingSemanticId(
  node: TopologyNodeData,
  port: PortName,
  variantIndex = 0,
): SemanticPortId | undefined {
  return socketSemanticIds(node, port, variantIndex)[0];
}

/** One row of the ADR #34 pairing table: a source semantic that may feed a
 *  target semantic, the typed relationship that combination represents,
 *  and the Fluent id for its human-readable label. Kept as an ordered row
 *  list so (a) the gate and the relationship picker share ONE source of
 *  truth and (b) picker options render in the order the rows appear — the
 *  PRIMARY relationship of a pair always comes first.
 *
 *  Since ADR #45 the row also carries `endpoints`: the closed list of
 *  node-kind pairs that may sit on the ends of the row. Before that, the row
 *  table was the only shared part of the rule and the endpoint predicates
 *  were re-written by hand on each side. */
interface SemanticPairingRow {
  source: SemanticPortId;
  target: SemanticPortId;
  relationshipType: SemanticRelationshipType;
  labelId: string;
  endpoints: readonly TopologyEndpointPair[];
}

/** One admitted (source kind → target kind) pair for a row. Deliberately a
 *  flat tuple list rather than a boolean expression: the contract has to be
 *  evaluable identically by the TypeScript gate and the Rust gate, and an
 *  expression language would need two parsers — which is how the two drifted
 *  apart in the first place. Rows whose admitted pairs are NOT the cross
 *  product of their endpoints (the generic operation row) are written out
 *  pair by pair. See ADR #45 §1. */
export interface TopologyEndpointPair {
  from: string;
  to: string;
}

/** The pairing table: which source semantic may feed which target
 *  semantic, and what relationship that wire then represents. Inputs are
 *  never sources, and mismatched semantics (a Location feed into a stock
 *  rack, a stock feed into a Location input) gate closed.
 *
 *  Reachability note: `operation-out` is produced by Restaurant POS for its
 *  operational feed into KDS; `ticket-in` is admitted by hardware inputs so
 *  the Resto preset's loaded kds→printer wire (ticket-out/ticket-in) is also
 *  authorable. Other unused semantic members remain contract-level and
 *  future-facing rather than authorable today. */
const SEMANTIC_PORT_PAIRINGS = topologySemantics.semanticPairings as readonly SemanticPairingRow[];

/** Matches any node kind. Used only by the future-facing `generic-out` row,
 *  which has no registered producer yet. */
export const ANY_NODE_KIND = '*';

/** Matches the graph's Branch Location node. Whether the graph has exactly one
 *  such node is a separate rule both gates enforce before the wire loop
 *  (`multiple-branch-locations`), so at endpoint level this reduces to the
 *  node's kind. */
export const BRANCH_ROOT_KIND = '@branch-root';

/** Build the canonical kind token from a node's two identity halves. Both
 *  languages already carry `type`/`kind` plus a workspace `typeKey`;
 *  collapsing them into one string is what makes every endpoint predicate a set
 *  lookup instead of a hand-written condition. A workspace with no recorded
 *  typeKey is the Store POS baseline, matching the Apply-boundary default. */
export function nodeKindToken(kind: string, typeKey?: string | null): string {
  if (kind === 'workspace') return `workspace:${typeKey ?? 'store-pos'}`;
  // `store` is the serialized compatibility alias for `branch-location`
  // (ADR #34 §1); the contract speaks the canonical name.
  if (kind === 'store') return 'branch-location';
  return kind;
}

/** The kind token for a canvas node. */
export function nodeKindOf(node: TopologyNodeData): string {
  return nodeKindToken(node.type, node.metadata?.['typeKey'] as string | undefined);
}

/** True when a contract endpoint token admits a node's kind token.
 *
 *  Matching is exact, with one addition: a token written without a `:` suffix
 *  also covers that family. So `workspace` admits `workspace:store-pos` and
 *  `workspace:kds`, while `workspace:store-pos` admits only itself. The
 *  contract needs both — the Location row means "any workspace", the Operation
 *  row means "this one" — and a single prefix rule keeps the comparison to one
 *  line in each language rather than an expression language in JSON. */
function kindTokenAdmits(endpointToken: string, nodeKind: string): boolean {
  return endpointToken === nodeKind || nodeKind.startsWith(`${endpointToken}:`);
}

/** True when one endpoint pair admits this (source kind, target kind) tuple.
 *  Unknown kinds and unknown `@`-tokens fail closed — only `*` and
 *  `@branch-root` are special, everything else goes through
 *  {@link kindTokenAdmits}. This is THE endpoint predicate; the Rust gate
 *  implements the same function over the same JSON and ADR #45 §2 keeps them
 *  provably identical. */
function endpointPairAllows(pair: TopologyEndpointPair, fromKind: string, toKind: string): boolean {
  const sourceKind = fromKind === 'branch-location' ? BRANCH_ROOT_KIND : fromKind;
  const fromOk = pair.from === ANY_NODE_KIND || kindTokenAdmits(pair.from, sourceKind);
  const toOk = pair.to === ANY_NODE_KIND || kindTokenAdmits(pair.to, toKind);
  return fromOk && toOk;
}

/** True when a row's declared endpoints admit this node pair. An empty list
 *  admits nothing, so a payload that lost its endpoints degrades to "no wire
 *  may be authored" rather than to the looser row-only check. */
export function pairingAllowsEndpoints(
  row: SemanticPairingRow,
  fromKind: string,
  toKind: string,
): boolean {
  return row.endpoints.some((pair) => endpointPairAllows(pair, fromKind, toKind));
}

/** Kind-level form of the endpoint gate, for callers that hold a normalized
 *  graph node (`kind` + `typeKey`) rather than a canvas node. The Apply-boundary
 *  contract validator uses this so it evaluates the exact same endpoint list
 *  the canvas offered — previously it carried its own hand-written copy of the
 *  per-row predicates, which is how the two drifted. */
export function pairingAdmitsKinds(
  sourceSemantic: string,
  targetSemantic: string,
  fromKind: string,
  toKind: string,
): boolean {
  const row = SEMANTIC_PORT_PAIRINGS.find(
    (r) => r.source === sourceSemantic && r.target === targetSemantic,
  );
  return row ? pairingAllowsEndpoints(row, fromKind, toKind) : false;
}

/** The full authoring gate for one semantic pair between two specific nodes:
 *  the table must declare a row for the semantics AND that row must admit the
 *  node kinds. Returns the row so callers can build the relationship option
 *  without a second lookup. Every authoring surface — socket drop, stacked
 *  row, legacy migration — goes through this, so the canvas can never offer a
 *  wire the Apply gate would reject. */
export function pairingAllowsNodes(
  source: TopologyNodeData,
  target: TopologyNodeData,
  sourceSemantic: SemanticPortId,
  targetSemantic: SemanticPortId,
): SemanticPairingRow | undefined {
  const row = SEMANTIC_PORT_PAIRINGS.find(
    (r) => r.source === sourceSemantic && r.target === targetSemantic,
  );
  if (!row) return undefined;
  return pairingAllowsEndpoints(row, nodeKindOf(source), nodeKindOf(target)) ? row : undefined;
}

/** True when the source semantic may feed the target semantic under the
 *  typed pairing table. Unknown or input-side sources always return false
 *  — the gate fails closed. */
export function canSemanticPortsConnect(
  source: SemanticPortId,
  target: SemanticPortId,
): boolean {
  return SEMANTIC_PORT_PAIRINGS.some((r) => r.source === source && r.target === target);
}

/** Validate persisted semantic fields against the same pairing matrix used by
 *  drag gating and relationship selection. Unknown strings fail closed so
 *  hand-edited or stale payloads cannot bypass the contract. */
export function isSemanticWireCompatible(
  source: string,
  target: string,
  relationshipType: string,
): boolean {
  return SEMANTIC_PORT_PAIRINGS.some((row) =>
    row.source === source && row.target === target && row.relationshipType === relationshipType
  );
}

/** One admissible relationship for a specific socket pair — the semantic
 *  ids to RECORD on the wire (fromPortId/toPortId round-trip through the
 *  backend), the typed relationship, and its label. */
export interface WireRelationshipOption {
  fromPortId: SemanticPortId;
  toPortId: SemanticPortId;
  relationshipType: SemanticRelationshipType;
  labelId: string;
}

/** All relationships a drop between a source socket and a target socket
 *  may create, in pairing-table order (primary first). Zero options means
 *  the pair is incompatible; one option means the drop creates that wire
 *  directly; TWO OR MORE means the drop is ambiguous and the UI must ask
 *  the user which relationship they mean (the picker). */
export function wireRelationshipOptions(
  source: TopologyNodeData,
  sourcePort: PortName,
  target: TopologyNodeData,
  targetPort: PortName,
  targetVariantIndex = 0,
): WireRelationshipOption[] {
  const options: WireRelationshipOption[] = [];
  for (const src of socketSemanticIds(source, sourcePort)) {
    for (const tgt of socketSemanticIds(target, targetPort, targetVariantIndex)) {
      const row = pairingAllowsNodes(source, target, src, tgt);
      if (row) {
        options.push({
          fromPortId: src,
          toPortId: tgt,
          relationshipType: row.relationshipType,
          labelId: row.labelId,
        });
      }
    }
  }
  return options;
}

/** Resolve the SINGLE relationship between one source semantic ROW and one
 *  target semantic ROW (round 174 stacked ports). Each stacked row is one
 *  semantic, so the pair is fixed — zero options means incompatible, one
 *  means the drop commits directly. Kept separate from the socket-wide
 *  `wireRelationshipOptions` (which enumerates every source semantic for
 *  the legacy one-socket-per-side picker flow and for compatibility
 *  checks); the editor uses this when both endpoints are specific rows. */
export function rowRelationshipOptions(
  source: TopologyNodeData,
  sourcePort: PortName,
  sourceVariantIndex: number,
  target: TopologyNodeData,
  targetPort: PortName,
  targetVariantIndex: number,
): WireRelationshipOption[] {
  const src = socketSemanticIds(source, sourcePort)[sourceVariantIndex];
  const tgt = socketSemanticIds(target, targetPort, targetVariantIndex)[targetVariantIndex];
  if (!src || !tgt) return [];
  const row = pairingAllowsNodes(source, target, src, tgt);
  if (!row) return [];
  return [{
    fromPortId: src,
    toPortId: tgt,
    relationshipType: row.relationshipType,
    labelId: row.labelId,
  }];
}

/** Node-level legacy-wire migration: every legal relationship a legacy
 *  wire between these two nodes may mean, in pairing-table order. A
 *  fully-unknown legacy wire (folded to the legacy-out/legacy-in
 *  placeholders by normalizeTopologyGraph) carries no socket semantics,
 *  so the resolution enumerates the source node's OUTPUT semantics × the
 *  target node's INPUT semantics over the pairing table — the same
 *  contract the drag gate and relationship picker use, without a specific
 *  socket. Zero options means no legal relationship exists between the
 *  pair: the wire cannot be migrated and must be deleted and recreated
 *  with the labeled ports (never silently reinterpreted). */
export function legacyWireResolutionOptions(
  source: TopologyNodeData,
  target: TopologyNodeData,
): WireRelationshipOption[] {
  // Mirror wireRelationshipOptions' iteration exactly — socket-semantics
  // order (not raw pairing-row order), same first-row lookup — so the
  // migration UI offers options in the same order the relationship picker
  // shows for a live drop between the same nodes.
  const options: WireRelationshipOption[] = [];
  for (const src of socketSemanticIds(source, 'right')) {
    for (const tgt of socketSemanticIds(target, 'left')) {
      const row = pairingAllowsNodes(source, target, src, tgt);
      if (row) {
        options.push({
          fromPortId: src,
          toPortId: tgt,
          relationshipType: row.relationshipType,
          labelId: row.labelId,
        });
      }
    }
  }
  return options;
}

// ── Header chrome ─────────────────────────────────────────────────

/** Header icon component for each node type. */
export const NODE_TYPE_ICON: Readonly<Record<TopologyNodeData['type'], ComponentType<{ size?: number }>>> = {
  store: StoreIcon,
  workspace: PosIcon,
  warehouse: WarehouseIcon,
  hardware: PrinterIcon,
};

// ── Node kind registry (ADR #45 §3) ───────────────────────────────
//
// One row per node kind, holding everything the card needs to draw it: which
// ports it shows, what each socket means, how each socket is labelled, which
// icon identifies it, and which settings card edits it.
//
// Before this table that knowledge sat in eight functions, each re-deciding the
// same questions with its own if-chain. The answers drifted: `socketSemanticIds`
// handed an unregistered workspace type the stock/transfer outputs that the
// §1 contract refuses, so those cards advertised sockets no wire could ever
// legally occupy; and `NODE_TYPE_ICON`, keyed on `node.type`, could not tell a
// Kitchen Display from a Retail POS even though the tool rack offers each its
// own glyph.
//
// The registry is keyed on a CARD kind token, deliberately NOT the contract
// kind token from §1. The contract resolves a workspace with no recorded
// typeKey to `workspace:store-pos` — that default is what makes such a node
// authorable as a Store POS — while the card must keep treating it as
// unregistered so its sockets match what the settings UI can actually edit.
// Collapsing the two would silently promote every type-less workspace to a full
// POS. ui/src/__tests__/topologyKindBehavior.test.ts is what keeps that
// distinction honest: it probes both, and the refactor had to leave it
// byte-identical.

interface NodeKindEntry {
  /** Ports the card renders. Top/bottom stay load-compatible. */
  visiblePorts: readonly PortName[];
  /** Left-input variants — one rendered row each, in order. */
  leftVariants: readonly string[];
  /** Every semantic the left socket can represent, canonical order. The first
   *  entry is the PRIMARY semantic that connection gating uses. */
  leftSemantics: readonly SemanticPortId[];
  /** Every semantic the right socket can represent, canonical order. */
  rightSemantics: readonly SemanticPortId[];
  /** The semantic a wire RECORDS on this side. Deliberately narrower than the
   *  gating lists: ADR #34 keeps persisted wire semantics and duplicate
   *  detection stable, so most sockets record nothing at all. */
  records: { readonly left?: SemanticPortId; readonly right?: SemanticPortId };
  /** Right-socket Fluent label. Left labels derive from the variant.
   *
   *  REQUIRED even on a row that renders no right port, and that is deliberate
   *  rather than an oversight: `portLabelId` and `portAriaLabelId` are total
   *  functions today, and making these optional would push an undefined case
   *  into every caller plus need a fallback message key that means nothing for
   *  half the kinds. `records` above IS optional for the same reason in reverse —
   *  its consumers already handle absence.
   *
   *  So `workspace:admin` and `workspace:warehouse` carry two fields each that
   *  can never render. That is the accepted cost of keeping the accessors
   *  branch-free; ADR #45 §3 follow-up #1 raised it and closed it here rather
   *  than leaving it looking unfinished. */
  rightLabelId: string;
  /** Right-socket Fluent aria label. */
  rightAriaLabelId: string;
  /** Left label chosen from the attached wire's port id, consulted BEFORE the
   *  variant. A warehouse shows Stock, Transfer or Operation according to what
   *  is actually plugged in; `default` covers the rest. */
  leftLabelByConnected?: Readonly<Record<string, string>>;
  /** True when `leftLabelByConnected` outranks the variant label. A warehouse
   *  has a labelled primary variant yet must still name what is plugged in; a
   *  hardware input's variant carries no label, so ordering is moot there. */
  connectedLabelWins?: boolean;
  /** Glyph for this kind. Today every workspace kind still resolves to the
   *  same POS glyph — see `iconForNode` for why that is a known defect and not
   *  an accident of this table. */
  icon: ComponentType<{ size?: number }>;
  /** Settings card, for workspace kinds only. */
  settingsCard?: ComponentType<Record<string, unknown>>;
  /** Fluent id for this kind's name in the workspace type selector. */
  typeLabelId?: string;
  /** True when the inspector may switch a node TO this type. Owned by the
   *  registry rather than by the editor: the list that used to live in
   *  `NodeTopologyEditor.tsx` carried a fourth member whose only consumer
   *  filtered it straight back out. */
  typeSelectable?: boolean;
}

/** Left variant → its own label. `stock-in` has no variant that uses it today;
 *  the arm is kept because the pre-registry code carried it and legacy wires
 *  still record that port id. */
const LEFT_VARIANT_LABEL: Readonly<Record<string, string>> = {
  'operation-in': 'topology-port-operation-in',
  'location-in': 'topology-port-location-in',
  'stock-in': 'topology-port-stock-in',
};

const LEFT_VARIANT_ARIA: Readonly<Record<string, string>> = {
  'operation-in': 'topology-port-operation-in-aria',
  'location-in': 'topology-port-location-in-aria',
};

const GENERIC_IN_LABEL = 'topology-port-generic-in';
const NEUTRAL_ARIA = 'topology-port-aria';

export const NODE_KIND_REGISTRY: Readonly<Record<string, NodeKindEntry>> = {
  'branch-location': {
    visiblePorts: ['right'],
    leftVariants: [],
    leftSemantics: [],
    rightSemantics: ['location-out'],
    records: { right: 'location-out' },
    rightLabelId: 'topology-port-location-out',
    rightAriaLabelId: 'topology-port-location-out-aria',
    icon: StoreIcon,
  },
  'workspace:store-pos': {
    visiblePorts: ['left', 'right'],
    leftVariants: ['location-in'],
    leftSemantics: ['location-in'],
    // Stock and transfer first: the retail flow routes inventory before it
    // emits an operational feed. Socket order is picker order, so this is
    // meaningful UI, not a set.
    rightSemantics: ['stock-out', 'transfer-out', 'operation-out'],
    records: { left: 'location-in' },
    rightLabelId: 'topology-port-workspace-out',
    rightAriaLabelId: NEUTRAL_ARIA,
    icon: CartIcon,
    settingsCard: WorkspaceStorePosSettings,
    typeLabelId: 'topology-ws-type-store-pos',
    typeSelectable: true,
  },
  'workspace:restaurant-pos': {
    visiblePorts: ['left', 'right'],
    leftVariants: ['location-in'],
    leftSemantics: ['location-in'],
    // Operation leads: a kitchen's primary feed is the ticket stream, and the
    // relationship picker shows this first for a restaurant terminal.
    rightSemantics: ['operation-out', 'stock-out', 'transfer-out'],
    records: { left: 'location-in' },
    rightLabelId: 'topology-port-workspace-out',
    rightAriaLabelId: NEUTRAL_ARIA,
    icon: UtensilsIcon,
    settingsCard: WorkspaceRestaurantPosSettings,
    typeLabelId: 'topology-ws-type-restaurant-pos',
    typeSelectable: true,
  },
  'workspace:kds': {
    visiblePorts: ['left', 'right'],
    leftVariants: ['operation-in'],
    leftSemantics: ['operation-in'],
    rightSemantics: ['ticket-out'],
    records: { left: 'operation-in' },
    rightLabelId: 'topology-port-ticket-out',
    rightAriaLabelId: 'topology-port-ticket-out-aria',
    icon: NodesIcon,
    settingsCard: WorkspaceKdsSettings,
    typeLabelId: 'topology-ws-type-kds',
    typeSelectable: true,
  },
  'warehouse': {
    visiblePorts: ['left', 'right'],
    leftVariants: ['location-in', 'operation-in'],
    leftSemantics: ['location-in', 'operation-in', 'stock-in', 'transfer-in'],
    rightSemantics: ['stock-out'],
    // Records nothing: a warehouse wire keeps the port id it was drawn with,
    // so legacy stock-in and transfer-in wires stay load-compatible (ADR #34).
    records: {},
    rightLabelId: 'topology-port-stock-out',
    rightAriaLabelId: NEUTRAL_ARIA,
    leftLabelByConnected: {
      'operation-in': 'topology-port-operation-in',
      'stock-in': 'topology-port-stock-in',
      'transfer-in': 'topology-port-transfer-in',
      'default': 'topology-port-location-in',
    },
    connectedLabelWins: true,
    icon: WarehouseIcon,
  },
  'hardware': {
    visiblePorts: ['left', 'right'],
    leftVariants: ['generic-in'],
    leftSemantics: ['generic-in', 'ticket-in'],
    rightSemantics: ['device-out'],
    records: {},
    rightLabelId: 'topology-port-device-out',
    rightAriaLabelId: NEUTRAL_ARIA,
    // Consulted after the variant, which carries no label of its own: a
    // printer input shows Ticket In for a KDS feed and stays neutral for
    // anything else.
    leftLabelByConnected: {
      'ticket-in': 'topology-port-ticket-in',
      'default': GENERIC_IN_LABEL,
    },
    icon: PrinterIcon,
  },
  // A workspace carrying the `warehouse` typeKey. The palette creates a
  // `warehouse` NODE instead (see the `warehouse` row above), so this shape
  // exists only for graphs that recorded it historically — which is why it
  // keeps the fallback's sockets but still names itself in the type selector.
  // ADR #45 §3 follow-up #1, step 2. `admin` is a real seeded workspace type key
  // with no endpoints anywhere in the topology contract, so it used to fall
  // through to `workspace:*` and be drawn with the retail inventory feeds — two
  // sockets the Apply gate could never authorize. Giving it its own row pre-empts
  // that fallback without touching the fallback itself, which a legacy type-less
  // node still needs: the contract treats that node as `workspace:store-pos`,
  // whose stock feeds are legitimate. Emptying the shared row instead would have
  // paid the ledger by breaking legacy stores.
  'workspace:admin': {
    visiblePorts: ['left'],
    leftVariants: ['location-in'],
    leftSemantics: ['location-in'],
    rightSemantics: [],
    records: { left: 'location-in' },
    // Required by NodeKindEntry though no right port renders; see the note on
    // `workspace:warehouse` about making these conditional on visiblePorts.
    rightLabelId: 'topology-port-workspace-out',
    rightAriaLabelId: NEUTRAL_ARIA,
    icon: PosIcon,
    settingsCard: WorkspaceStorePosSettings,
    // No `typeLabelId`: there is no `topology-ws-type-admin` message in any
    // bundle, and inventing one here would need copy in every locale to pass the
    // bundle-parity gate. `workspaceTypeLabel` falls back to the raw type key,
    // which is the same treatment any other unregistered key already gets.
  },
  'workspace:warehouse': {
    // ADR #45 §3 follow-up #1. The topology contract declares no endpoints with
    // an `admin`-style workspace type on either side, so the stock and transfer
    // feeds this row used to advertise could never carry an authorizable wire —
    // the card offered two sockets the Apply gate would always refuse. Note this
    // is the WORKSPACE shape carrying typeKey `warehouse`, which the palette
    // never creates: the palette spawns a `warehouse` NODE, whose own row is
    // unaffected and does keep its feeds.
    visiblePorts: ['left'],
    leftVariants: ['location-in'],
    leftSemantics: ['location-in'],
    rightSemantics: [],
    records: { left: 'location-in' },
    // Required by NodeKindEntry even though no right port renders; see the
    // follow-up about making these conditional on visiblePorts.
    rightLabelId: 'topology-port-workspace-out',
    rightAriaLabelId: NEUTRAL_ARIA,
    icon: PosIcon,
    settingsCard: WorkspaceStorePosSettings,
    typeLabelId: 'topology-ws-type-warehouse',
  },
  // The declared-shape fallback. A workspace whose typeKey the contract does
  // not register — `admin`, a future `pharmacy-pos`, or none at all — is drawn
  // with POS-shaped chrome and the stock/transfer feeds, which is what the
  // pre-registry if-chains fell through to. It is a row here rather than an
  // implicit `return` at the end of eight functions so that the decision is
  // visible, reviewable, and changeable in one place: ADR #45 §3 follow-up #1
  // is about making this row honest, not about deleting it quietly.
  'workspace:*': {
    visiblePorts: ['left', 'right'],
    leftVariants: ['location-in'],
    leftSemantics: ['location-in'],
    rightSemantics: ['stock-out', 'transfer-out'],
    records: { left: 'location-in' },
    rightLabelId: 'topology-port-workspace-out',
    rightAriaLabelId: NEUTRAL_ARIA,
    icon: PosIcon,
    settingsCard: WorkspaceStorePosSettings,
  },
};

/** The registry key for a node, in the CARD's vocabulary. See the block above
 *  for why this is not `nodeKindToken`. */
export function cardKindToken(node: TopologyNodeData): string {
  if (node.type === 'store') return 'branch-location';
  if (node.type === 'workspace') {
    const typeKey = node.metadata?.['typeKey'];
    return typeof typeKey === 'string' && typeKey.length > 0
      ? `workspace:${typeKey}`
      : 'workspace:*';
  }
  return node.type;
}

/** Resolve a node's registry row. Unknown workspace types fall to the declared
 *  fallback; an unknown node type cannot occur — `NodeType` is a closed union
 *  and every member has a row — but the fallback keeps that a rendering
 *  decision rather than a crash. */
export function nodeKindEntry(node: TopologyNodeData): NodeKindEntry {
  return NODE_KIND_REGISTRY[cardKindToken(node)] ?? NODE_KIND_REGISTRY['workspace:*']!;
}

/** The workspace type keys the inspector may switch a node to, in registry
 *  order. Derived, so a type is selectable exactly when it has a row that says
 *  so — no second list to keep in step (ADR #45 §3). */
export const SELECTABLE_WORKSPACE_TYPE_KEYS: readonly string[] = Object.entries(NODE_KIND_REGISTRY)
  .filter(([, entry]) => entry.typeSelectable === true)
  .map(([token]) => token.replace('workspace:', ''));

/** The glyph for this node's KIND, not its type. Today every workspace kind
 *  resolves to `PosIcon`, so a Kitchen Display is indistinguishable from a
 *  Retail POS on the canvas even though the tool rack offers them different
 *  glyphs. That is a defect, and this is where it gets fixed — deliberately,
 *  with the behavior freeze showing the diff, rather than as a side effect of
 *  the refactor. */
export function iconForNode(node: TopologyNodeData): ComponentType<{ size?: number }> {
  return nodeKindEntry(node).icon;
}

// ── UI string fallbacks ───────────────────────────────────────────
/** Safe fallbacks for topology chrome so a stale or partial locale bundle
 *  never exposes a Fluent message id in the node canvas. */
export const TOPOLOGY_UI_FALLBACKS: Readonly<Record<string, string>> = {
  'topology-port-location-out': 'Location',
  'topology-port-location-in': 'Location',
  'topology-port-location-out-aria': 'Location port',
  'topology-port-location-in-aria': 'Location port',
  'topology-port-workspace-out': 'Operation',
  'topology-port-operation-in': 'Operation',
  'topology-port-operation-in-aria': 'Operation port',
  'topology-port-stock-in': 'Stock In',
  'topology-port-stock-out': 'Stock Out',
  'topology-port-transfer-in': 'Transfer In',
  'topology-port-transfer-out': 'Transfer Out',
  'topology-port-operation-out': 'Operation',
  'topology-port-ticket-in': 'Ticket In',
  'topology-port-ticket-out': 'Ticket Out',
  'topology-port-ticket-out-aria': 'Ticket port',
  'topology-port-device-out': 'Device Out',
  'topology-port-generic-in': 'Input',
  'topology-port-generic-out': 'Output',
  'topology-port-aria': 'Topology port',
  'topology-relationship-location': 'Location',
  'topology-relationship-stock-routing': 'Stock routing',
  'topology-relationship-inventory-transfer': 'Transfer',
  'topology-relationship-ticket-routing': 'Ticket routing',
  'topology-relationship-hardware-connection': 'Device connection',
  'topology-relationship-operation': 'Operation',
  'topology-relationship-generic': 'Generic',
  'topology-relationship-picker-title': 'Choose connection type',
  'topology-relationship-picker-cancel': 'Cancel',
  'topology-wire-label-transfer': 'Transfer',
  'topology-wire-label-ticket': 'Ticket Print',
  'topology-field-name': 'Name',
  'topology-field-name-aria': 'Edit name',
  'topology-field-enabled': 'Enabled',
  'topology-field-enabled-aria': 'Toggle enabled state',
  'topology-ws-type-store-pos': 'Store POS',
  'topology-ws-type-restaurant-pos': 'Restaurant POS',
  'topology-ws-type-kds': 'Kitchen Display (KDS)',
  'topology-ws-type-warehouse': 'Warehouse',
  'topology-node-type-store': 'Branch Location',
  'topology-node-type-workspace': 'Workspace',
  'topology-node-type-warehouse': 'Warehouse',
  'topology-node-type-hardware': 'Hardware Device',
  'topology-hardware-thermal-receipt': 'Thermal Receipt Printer',
  'topology-hardware-thermal-kitchen': 'Kitchen Printer',
  'topology-hardware-barcode-scanner': 'Barcode Scanner',
  'topology-hardware-cash-drawer': 'Cash Drawer',
  'topology-hardware-display-customer': 'Customer Display',
};

/** Resolve topology chrome with a safe fallback so a stale or partial
 *  locale bundle never exposes a Fluent message id in the node canvas. */
export function topologyUiString(
  l10n: Pick<ReactLocalization, 'getString'>,
  id: string,
  vars?: Record<string, FluentVariable> | null,
): string {
  return l10n.getString(id, vars ?? null, TOPOLOGY_UI_FALLBACKS[id] ?? id);
}
