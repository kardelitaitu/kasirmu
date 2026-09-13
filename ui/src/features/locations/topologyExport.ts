/**
 * Pure topology export/import + diagram templates.
 *
 * The canvas (nodes + wires + authored bends) serializes to a versioned JSON
 * envelope so a layout can be copied to the clipboard, pasted back, or saved
 * under a name as a reusable template. `deserializeTopology` is STRICT: any
 * malformed entry rejects the whole payload, so a drifted or hand-edited
 * document can never half-load a broken diagram.
 */

import type { TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';

export const TOPOLOGY_EXPORT_FORMAT = 'oz-topology';
export const TOPOLOGY_EXPORT_VERSION = 1;
/** localStorage prefix for saved diagram templates. */
export const TOPOLOGY_TEMPLATE_PREFIX = 'oz-topology-template:';

export interface TopologyExportPayload {
  format: typeof TOPOLOGY_EXPORT_FORMAT;
  version: typeof TOPOLOGY_EXPORT_VERSION;
  nodes: TopologyNodeData[];
  wires: TopologyWireData[];
}

const NODE_TYPES = new Set(['store', 'workspace', 'warehouse', 'hardware']);
const WIRE_DIRECTIONS = new Set(['one-way', 'reverse', 'two-way']);
/** Canonical wire ports. The geometry reads them RAW (PORT_OFFSET[port]),
 *  so a hand-edited value outside this set would crash the canvas with an
 *  undefined offset dereference — the strict contract rejects it here. */
const PORT_NAMES = new Set(['top', 'right', 'bottom', 'left']);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Strict metadata check: the warehouse stock trio (rounds 70-72) must be
 *  finite numbers when present. A string value would otherwise pass the
 *  shape check and silently drop through readNumber/metadataNumber — the
 *  strict contract exists precisely to reject documents that cannot
 *  half-load cleanly. Unknown keys are allowed (forward compatibility). */
function isValidNodeMetadata(meta: unknown): boolean {
  if (meta === undefined || meta === null) return true;
  if (typeof meta !== 'object' || Array.isArray(meta)) return false;
  const m = meta as Record<string, unknown>;
  for (const key of ['stock', 'capacity', 'lowStockThreshold']) {
    if (m[key] !== undefined && !isFiniteNumber(m[key])) return false;
  }
  return true;
}

function isValidNode(n: unknown): n is TopologyNodeData {
  if (!n || typeof n !== 'object') return false;
  const node = n as Record<string, unknown>;
  return (
    typeof node['id'] === 'string' && node['id'].length > 0
    && typeof node['type'] === 'string' && NODE_TYPES.has(node['type'])
    && typeof node['name'] === 'string'
    && isFiniteNumber(node['x']) && isFiniteNumber(node['y'])
    && isValidNodeMetadata(node['metadata'])
  );
}

/** Strict authored-bend check: `bends` must be an array of objects with
 *  FINITE numeric x/y when present. The geometry maps them RAW
 *  (`wire.bends.map(...)` and `b.x`/`b.y` straight into path points) — a
 *  non-array would throw in the render and a missing/non-finite coordinate
 *  produces a NaN degenerate path. The strict contract refuses the whole
 *  payload instead of half-loading a wire that cannot draw. An empty array
 *  is canonical (the editor treats length 0 as unbent); extra keys on a
 *  bend entry are allowed (forward compatibility). */
function isValidBends(bends: unknown): boolean {
  if (bends === undefined) return true;
  if (!Array.isArray(bends)) return false;
  return bends.every((b) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
    const bend = b as Record<string, unknown>;
    return isFiniteNumber(bend['x']) && isFiniteNumber(bend['y']);
  });
}

function isValidWire(w: unknown): w is TopologyWireData {
  if (!w || typeof w !== 'object') return false;
  const wire = w as Record<string, unknown>;
  return (
    typeof wire['id'] === 'string' && wire['id'].length > 0
    && typeof wire['fromNodeId'] === 'string'
    && typeof wire['toNodeId'] === 'string'
    && typeof wire['direction'] === 'string' && WIRE_DIRECTIONS.has(wire['direction'])
    && (wire['fromPort'] === undefined || (typeof wire['fromPort'] === 'string' && PORT_NAMES.has(wire['fromPort'])))
    && (wire['toPort'] === undefined || (typeof wire['toPort'] === 'string' && PORT_NAMES.has(wire['toPort'])))
    && isValidBends(wire['bends'])
  );
}

/** Serialize the canvas into the versioned JSON envelope (pretty-printed for
 *  human inspection / diffing). */
export function serializeTopology(nodes: TopologyNodeData[], wires: TopologyWireData[]): string {
  return JSON.stringify(
    {
      format: TOPOLOGY_EXPORT_FORMAT,
      version: TOPOLOGY_EXPORT_VERSION,
      nodes,
      wires,
    } satisfies TopologyExportPayload,
    null,
    2,
  );
}

/** Parse + validate an export envelope. Strict: a malformed node/wire,
 *  duplicate id, or a version/format mismatch rejects the whole payload
 *  (returns null) rather than half-loading a broken diagram. */
export function deserializeTopology(json: string): TopologyExportPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as Record<string, unknown>;
  if (payload['format'] !== TOPOLOGY_EXPORT_FORMAT || payload['version'] !== TOPOLOGY_EXPORT_VERSION) return null;
  if (!Array.isArray(payload['nodes']) || !Array.isArray(payload['wires'])) return null;
  if (!payload['nodes'].every(isValidNode)) return null;
  if (!payload['wires'].every(isValidWire)) return null;
  const ids = new Set<string>();
  for (const n of payload['nodes'] as TopologyNodeData[]) {
    if (ids.has(n.id)) return null;
    ids.add(n.id);
  }
  // A wire whose endpoint references a node missing from the payload is a
  // dangling edge: the geometry skips it (it cannot draw) and the imported
  // diagram immediately banners unknown-wire-endpoint — a drifted document
  // is refused whole like every other broken shape.
  for (const w of payload['wires'] as TopologyWireData[]) {
    if (!ids.has(w.fromNodeId) || !ids.has(w.toNodeId)) return null;
  }
  // Wire ids live in their own namespace (node ops never touch wires by
  // node id), but two wires under one id behave as a single wire — every
  // id-addressed operation (select, delete, cycle, bend) hits both. Same
  // rejection as duplicate node ids.
  const wireIds = new Set<string>();
  for (const w of payload['wires'] as TopologyWireData[]) {
    if (wireIds.has(w.id)) return null;
    wireIds.add(w.id);
  }
  return {
    format: TOPOLOGY_EXPORT_FORMAT,
    version: TOPOLOGY_EXPORT_VERSION,
    nodes: payload['nodes'] as TopologyNodeData[],
    wires: payload['wires'] as TopologyWireData[],
  };
}

/** Save the current canvas under `name` as a reusable template. Returns the
 *  storage key on success, null when storage is unavailable or the name is
 *  empty (caller toasts). */
export function saveTemplate(name: string, nodes: TopologyNodeData[], wires: TopologyWireData[]): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  try {
    const key = `${TOPOLOGY_TEMPLATE_PREFIX}${trimmed}`;
    localStorage.setItem(key, serializeTopology(nodes, wires));
    return key;
  } catch {
    return null;
  }
}

/** Load a saved template by name (null if missing, corrupt, or unavailable). */
export function loadTemplate(name: string): TopologyExportPayload | null {
  try {
    const json = localStorage.getItem(`${TOPOLOGY_TEMPLATE_PREFIX}${name}`);
    return json === null ? null : deserializeTopology(json);
  } catch {
    return null;
  }
}

/** Names of all saved templates, sorted for a stable list. */
export function listTemplates(): string[] {
  const names: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(TOPOLOGY_TEMPLATE_PREFIX)) {
        names.push(key.slice(TOPOLOGY_TEMPLATE_PREFIX.length));
      }
    }
  } catch {
    return [];
  }
  return names.sort((a, b) => a.localeCompare(b));
}

/** ADR #45 §4.2 — move browser-saved templates into per-branch storage.
 *
 *  Templates used to live only in `localStorage`, so a merchant's saved diagrams
 *  were bound to one device and vanished on a terminal reinstall. The backend now
 *  stores them per branch; this is the forward migration that keeps what was
 *  already saved.
 *
 *  The one property that matters: **a local copy is removed only after the
 *  backend has accepted it.** A failure leaves the template exactly where it was,
 *  so a half-finished migration cannot be worse than no migration. Callers should
 *  surface `failed` rather than swallow it.
 *
 *  `save` is injected rather than imported so this module keeps no dependency on
 *  the IPC layer, which also makes the ordering testable without a transport.
 *  It receives the parsed payload, so the backend stores a JSON object and not a
 *  string inside a string. */
export async function migrateLocalTemplates(
  save: (name: string, payload: TopologyExportPayload) => Promise<void>,
): Promise<{ migrated: string[]; failed: string[] }> {
  const migrated: string[] = [];
  const failed: string[] = [];
  for (const name of listTemplates()) {
    const key = `${TOPOLOGY_TEMPLATE_PREFIX}${name}`;
    let payload: TopologyExportPayload | null = null;
    try {
      payload = deserializeTopology(localStorage.getItem(key) ?? '');
    } catch {
      payload = null;
    }
    if (payload === null) {
      // Unreadable locally and therefore unsaveable remotely. Left in place: it
      // is already broken, and deleting a merchant's only copy of a thing we
      // could not read is not this function's call to make.
      failed.push(name);
      continue;
    }
    try {
      await save(name, payload);
      localStorage.removeItem(key);
      migrated.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { migrated, failed };
}

/** Delete a saved template by name. */
export function deleteTemplate(name: string): void {
  try {
    localStorage.removeItem(`${TOPOLOGY_TEMPLATE_PREFIX}${name}`);
  } catch {
    /* storage unavailable — nothing to do */
  }
}
