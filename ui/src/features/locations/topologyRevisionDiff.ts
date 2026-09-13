// ── Topology revision-to-revision diff ──────────────────────────────
//
// ADR #46 §10: the version browser needs to say what changed between two
// DEPLOYED revisions. `topologyDiff.ts` does not do this and cannot be reused
// for it — `planTopologyDiff(nodes, workspaceInstances)` and
// `computeTopologyDiff` compare the CANVAS against LIVE BACKEND INSTANCES to
// build the create/update/archive vectors. That is graph-vs-world. This module
// is graph-vs-graph, which is a different question with a different answer:
// nothing here produces a mutation, and nothing here reads the backend.
//
// Pure, total, and free of React — the same discipline `topologyDiff.ts`
// states for its preview path ("total, never throwing"), because a history
// panel that throws on a malformed old revision is worse than one that says it
// cannot compare. ADR #46 §7 guarantees such revisions exist: the contract went
// 1 -> 2, and old rows are shown, never migrated.
//
// ── Three classes of field, deliberately ────────────────────────────
//
// SEMANTIC — the merchant's business configuration. Listed field by field.
// GEOMETRY — where a node sits and how a wire routes. COUNTED, never listed:
//   dragging three nodes is not three business changes, and a history panel
//   that itemises it buries the one rename that mattered. The repo already
//   draws this exact line in `TopologyWireData`: `from_port_id` is "semantic
//   source port" while `from_port` is "geometry [that] remains
//   presentation-only" (NodeTopologyEditor.tsx:193-194).
// VOLATILE — runtime status the merchant never authored. EXCLUDED entirely,
//   not even counted. `telemetry_status` and `telemetry_badge` are persisted
//   (`topologyApply.ts:205-206`), so a terminal that went offline between two
//   Applies would otherwise show up as a change nobody made. Counting it would
//   be nearly as bad as listing it: it would tell the merchant the graph
//   differed when the business logic did not.

/** One side of a comparison. Accepts the editor's camelCase model as well as a
 *  parsed stored envelope, which is snake_case — see `GRAPH_FIELD_CLASSES`. */
export interface TopologyGraphInput {
  nodes: readonly unknown[];
  wires: readonly unknown[];
}

export type TopologyGraphChangeKind =
  | 'node-added'
  | 'node-removed'
  | 'wire-added'
  | 'wire-removed'
  | 'node-changed'
  | 'wire-changed';

export interface TopologyFieldChange {
  /** The persisted field name, e.g. `type` or `from_node_id`. */
  field: string;
  from: unknown;
  to: unknown;
}

export interface TopologyGraphChange {
  kind: TopologyGraphChangeKind;
  /** Node id, or the wire id. Stable across both sides for a change. */
  id: string;
  /** Human label: the node's name, or `Source → Target` for a wire. */
  label: string;
  /** Node/wire `type` where known, so the UI can badge it.
   *
   *  `| undefined` is required, not decoration: this repo compiles with
   *  `exactOptionalPropertyTypes`, under which `?: string` means "absent, or
   *  present and a string" — so a wire, whose payload has no `type` field at
   *  all, could not assign `undefined` to a bare `?: string`. */
  subjectType?: string | undefined;
  /** Non-empty only for the `*-changed` kinds. */
  fields: TopologyFieldChange[];
}

export interface TopologyGraphDiff {
  /** Semantic changes only, in a stable order: removals, additions, changes. */
  changes: TopologyGraphChange[];
  /** Nodes whose only difference is position. Reported, never itemised. */
  movedNodes: number;
  /** Wires whose only difference is routing geometry. */
  reroutedWires: number;
  /** True when no semantic difference exists — the two graphs are the same
   *  business configuration even if nodes were dragged around. */
  semanticallyIdentical: boolean;
}

/**
 * Persisted field names by class. A field absent from all three sets is
 * ignored: an unknown key is more likely to be a new presentation detail than
 * a business change, and guessing wrong in the noisy direction would make
 * history unreadable.
 */
const GRAPH_FIELD_CLASSES = {
  semantic: new Set([
    // nodes
    'type',
    'name',
    'subtitle',
    'store_profile_id',
    'storeProfileId',
    'tier_requirement',
    'tierRequirement',
    'metadata',
    // wires
    'from_node_id',
    'fromNodeId',
    'to_node_id',
    'toNodeId',
    'direction',
    'label',
    'relationship_type',
    'relationshipType',
    'from_port_id',
    'fromPortId',
    'to_port_id',
    'toPortId',
  ]),
  geometry: new Set([
    'x',
    'y',
    'bends',
    'from_port',
    'fromPort',
    'to_port',
    'toPort',
  ]),
  volatile: new Set([
    'telemetry_status',
    'telemetryStatus',
    'telemetry_badge',
    'telemetryBadge',
  ]),
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stable deep equality for JSON-ish values. Key order must not read as a
 *  change: `metadata` is re-serialised on every save, so an object that means
 *  the same thing often does not stringify the same way. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    // A missing key and an explicit `undefined` are one thing, not two: JSON
    // drops the latter on serialisation, and the editor model builds metadata
    // with conditional spreads (`...(x ? { k: v } : {})`) that leave keys
    // present-but-undefined. Treating them as different would report a change
    // that no merchant made and that vanishes on the next save.
    return [...keys].every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/** The `id` used to pair one entity across two revisions. Entities without a
 *  usable string id fall back to a positional key so they still participate in
 *  add/remove detection instead of vanishing from the comparison. */
function entityKey(value: unknown, index: number): string {
  if (isRecord(value)) {
    const id = value['id'];
    if (typeof id === 'string' && id.length > 0) return id;
    if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  }
  return `#position-${index}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function semanticFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): TopologyFieldChange[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: TopologyFieldChange[] = [];
  for (const field of [...names].sort()) {
    if (!GRAPH_FIELD_CLASSES.semantic.has(field)) continue;
    const from = before[field];
    const to = after[field];
    if (!deepEqual(from, to)) out.push({ field, from, to });
  }
  return out;
}

/** True when at least one geometry field differs. */
function geometryChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  for (const field of GRAPH_FIELD_CLASSES.geometry) {
    if (!deepEqual(before[field], after[field])) return true;
  }
  return false;
}

function nodeLabel(record: Record<string, unknown>, id: string): string {
  const name = record['name'];
  if (typeof name === 'string' && name.trim().length > 0) return name;
  return id;
}

function wireType(record: Record<string, unknown>): string | undefined {
  const type = record['type'];
  return typeof type === 'string' ? type : undefined;
}

/** A wire's label is its endpoints, because a wire has no merchant-facing name.
 *  Read from whichever side has it, preferring the newer one. */
/** id -> display name for every node in one graph, newest winning. */
function nodeNameMap(nodes: readonly unknown[]): Map<string, string> {
  const out = new Map<string, string>();
  nodes.forEach((item, i) => {
    const id = entityKey(item, i);
    out.set(id, nodeLabel(asRecord(item), id));
  });
  return out;
}

function mergeNodeNames(
  older: Map<string, string>,
  newer: Map<string, string>,
): Map<string, string> {
  return new Map([...older, ...newer]);
}

function wireLabel(
  record: Record<string, unknown>,
  nodesById: Map<string, string>,
  id: string,
): string {
  const from = record['from_node_id'] ?? record['fromNodeId'];
  const to = record['to_node_id'] ?? record['toNodeId'];
  const name = (end: unknown) =>
    typeof end === 'string' ? (nodesById.get(end) ?? end) : '?';
  if (from === undefined && to === undefined) return id;
  return `${name(from)} → ${name(to)}`;
}

/**
 * Compare two graph revisions. Total: never throws, whatever it is handed.
 *
 * `before` is the older revision and `after` the newer, and the direction is
 * load-bearing — `from`/`to` in every reported field follows that order, so
 * callers browsing history backwards must pass them in chronological order and
 * read the result accordingly.
 */
export function diffTopologyGraphs(
  before: TopologyGraphInput,
  after: TopologyGraphInput,
): TopologyGraphDiff {
  const changes: TopologyGraphChange[] = [];
  let movedNodes = 0;
  let reroutedWires = 0;

  // Built ONCE from both graphs' NODE arrays: a wire's endpoints are node ids,
  // so labelling a wire needs the nodes of whichever graph still has them.
  // Passing the wire arrays here would be wrong and silently so — every wire
  // would render as `from → to` ids, which is why this is a parameter and not
  // something derived inside `compare`.
  const nodeNames = mergeNodeNames(nodeNameMap(before.nodes), nodeNameMap(after.nodes));

  const compare = (
    left: readonly unknown[],
    right: readonly unknown[],
    kind: 'node' | 'wire',
  ) => {
    const leftMap = new Map<string, Record<string, unknown>>();
    left.forEach((item, i) => leftMap.set(entityKey(item, i), asRecord(item)));
    const rightMap = new Map<string, Record<string, unknown>>();
    right.forEach((item, i) => rightMap.set(entityKey(item, i), asRecord(item)));

    const labelOf = (rec: Record<string, unknown>, id: string) =>
      kind === 'node' ? nodeLabel(rec, id) : wireLabel(rec, nodeNames, id);

    // Removals first, then additions, then changes: a stable order the browser
    // can render without sorting, and the order a reader expects — what went
    // away, what arrived, what was altered.
    for (const [id, rec] of leftMap) {
      if (rightMap.has(id)) continue;
      changes.push({
        kind: kind === 'node' ? 'node-removed' : 'wire-removed',
        id,
        label: labelOf(rec, id),
        subjectType: wireType(rec),
        fields: [],
      });
    }
    for (const [id, rec] of rightMap) {
      if (leftMap.has(id)) continue;
      changes.push({
        kind: kind === 'node' ? 'node-added' : 'wire-added',
        id,
        label: labelOf(rec, id),
        subjectType: wireType(rec),
        fields: [],
      });
    }
    for (const [id, beforeRec] of leftMap) {
      const afterRec = rightMap.get(id);
      if (afterRec === undefined) continue;
      const fields = semanticFields(beforeRec, afterRec);
      if (fields.length > 0) {
        changes.push({
          kind: kind === 'node' ? 'node-changed' : 'wire-changed',
          id,
          // Prefer the newer label: history reads forward.
          label: labelOf(afterRec, id),
          subjectType: wireType(afterRec),
          fields,
        });
        continue;
      }
      // Only worth counting when nothing semantic changed, so a wire that was
      // both renamed and moved is not double-reported.
      if (geometryChanged(beforeRec, afterRec)) {
        if (kind === 'node') movedNodes += 1;
        else reroutedWires += 1;
      }
    }
  };

  compare(before.nodes, after.nodes, 'node');
  compare(before.wires, after.wires, 'wire');

  return {
    changes,
    movedNodes,
    reroutedWires,
    semanticallyIdentical: changes.length === 0,
  };
}
