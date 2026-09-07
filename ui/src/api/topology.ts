// ── Topology Persistence ───────────────────────────────────────────
// Save / load the node topology graph via Tauri IPC. The backend
// serialises nodes + wires as JSON and stores each branch under a
// branch-specific settings key derived from `oz-pos/topology`.

import { loggedInvoke } from '@/utils/logged-invoke';

/** A single node in the topology graph. */
export interface TopologyNodePayload {
  id: string;
  type: string;
  name: string;
  subtitle?: string;
  x: number;
  y: number;
  tier_requirement?: string;
  telemetry_badge?: string;
  telemetry_status?: string;
  metadata?: Record<string, unknown>;
  /** Canonical store_profiles.id for a Branch Location node. */
  store_profile_id?: string;
}

/** A wire connecting two port sockets. */
export interface TopologyWirePayload {
  id: string;
  from_node_id: string;
  to_node_id: string;
  direction: string;
  label?: string;
  /** Orthogonal bend points the wire routes through (canvas coords). */
  bends?: Array<{ x: number; y: number }>;
  from_port?: string;
  to_port?: string;
  /** Semantic source port ID; geometric anchors remain presentation data. */
  from_port_id?: string;
  /** Semantic target port ID; geometric anchors remain presentation data. */
  to_port_id?: string;
  /** Closed semantic relationship type. */
  relationship_type?: string;
}

/** Complete topology graph persisted to the backend. */
export interface TopologyData {
  /** Version of the semantic graph envelope. Legacy payloads omit this. */
  schema_version?: number;
  /** Optimistic-concurrency revision assigned by the backend. */
  revision?: number;
  /** Branch-scoped business-rule dismissals persisted with the diagram. */
  resolved_issue_keys?: string[];
  nodes: TopologyNodePayload[];
  wires: TopologyWirePayload[];
}

/** Probe the backend capability used to gate topology editing UI. */
export const canSaveTopology = (sessionToken: string): Promise<boolean> =>
  loggedInvoke<boolean>('can_save_topology', { sessionToken });

/** Load the persisted topology graph for a branch, or `null` if none saved yet. */
export const loadTopology = (branchId?: string): Promise<TopologyData | null> =>
  loggedInvoke<TopologyData | null>(
    'load_topology',
    branchId !== undefined ? { branchId } : undefined,
  );

// ── Diagram templates (ADR #45 §4.2) ─────────────────────────────

/** Save a diagram template for a branch, replacing any template of that name.
 *  The payload is the serialized canvas; the backend stores it without running
 *  the Apply validation gates, because a template is a starting point rather
 *  than a claim about live configuration. */
export const saveTopologyTemplate = (
  sessionToken: string,
  name: string,
  payload: unknown,
  branchId?: string,
): Promise<void> =>
  loggedInvoke<void>('save_topology_template', {
    sessionToken,
    name,
    payload,
    ...(branchId !== undefined ? { branchId } : {}),
  });

/** Load one diagram template, or `null` when it never existed or is unreadable. */
export const loadTopologyTemplate = (
  sessionToken: string,
  name: string,
  branchId?: string,
): Promise<unknown | null> =>
  loggedInvoke<unknown | null>('load_topology_template', {
    sessionToken,
    name,
    ...(branchId !== undefined ? { branchId } : {}),
  });

/** Names of a branch's saved templates, sorted for display. */
export const listTopologyTemplates = (
  sessionToken: string,
  branchId?: string,
): Promise<string[]> =>
  loggedInvoke<string[]>('list_topology_templates', {
    sessionToken,
    ...(branchId !== undefined ? { branchId } : {}),
  });

/** Delete one template. Resolves `false` when there was nothing to delete. */
export const deleteTopologyTemplate = (
  sessionToken: string,
  name: string,
  branchId?: string,
): Promise<boolean> =>
  loggedInvoke<boolean>('delete_topology_template', {
    sessionToken,
    name,
    ...(branchId !== undefined ? { branchId } : {}),
  });

// ── Atomic topology diff (Critical #4) ───────────────────────────

/**
 * Request body for creating a workspace instance in a topology diff.
 *
 * Mirrors `CreateInstanceRequest` from `@/api/workspaces` — kept here
 * because the topology module is the canonical owner of the diff
 * contract. Both types must stay in sync.
 */
export interface CreateInstanceRequest {
  id: string;
  type_key: string;
  store_id: string;
  name: string;
  /** Controlled business purpose; independent from type and display label. */
  purpose_key?: string;
  description?: string;
  colour?: string;
}

/** Request body for updating a workspace instance in a topology diff. */
export interface UpdateInstanceRequest {
  id: string;
  name: string;
  purpose_key?: string;
}

/** Result returned after the backend commits a topology Apply. */
export interface TopologyApplyResult {
  revision: number;
}

/**
 * Apply a full topology diff atomically.
 *
 * `baseRevision` prevents stale editors from overwriting a newer branch
 * diagram. `requestId` makes retries and accidental double-submits safe to
 * deduplicate on the backend.
 *
 * `changeNote` (ADR #46 §6) is recorded on the immutable revision row and the
 * audit entry. Optional; the backend trims it and rejects it above 500
 * characters before touching anything.
 */
export const applyTopologyDiff = (
  sessionToken: string,
  workspaceCreations: CreateInstanceRequest[],
  workspaceUpdates: UpdateInstanceRequest[],
  workspaceArchives: string[],
  diagramNodes: TopologyNodePayload[],
  diagramWires: TopologyWirePayload[],
  branchId?: string,
  baseRevision = 0,
  requestId: `${string}-${string}-${string}-${string}-${string}` = crypto.randomUUID(),
  resolvedIssueKeys: string[] = [],
  changeNote?: string,
): Promise<TopologyApplyResult> =>
  loggedInvoke<TopologyApplyResult>('apply_topology_diff', {
    sessionToken,
    workspaceCreations,
    workspaceUpdates,
    workspaceArchives,
    diagramNodes,
    diagramWires,
    ...(branchId !== undefined ? { branchId } : {}),
    baseRevision,
    requestId,
    // Always send the field, including an empty array: clearing the last
    // dismissal must overwrite the branch document instead of leaving a
    // previously persisted key behind on the backend.
    resolvedIssueKeys,
    // Omitted when absent, unlike resolvedIssueKeys: an empty note and no
    // note mean the same thing to the backend, so there is nothing to clear
    // and no stale value a subsequent Apply could inherit.
    ...(changeNote !== undefined ? { changeNote } : {}),
  });
