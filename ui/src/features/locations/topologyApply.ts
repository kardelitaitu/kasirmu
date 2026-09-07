/**
 * topologyApply — Dedicated helper for the topology Apply operation.
 *
 * Encapsulates: session validation → graph normalization → validation →
 * diff computation → diagram remapping → atomic IPC apply → toast + refresh.
 *
 * Extracted from TopologyScreen.handleTopologySave for clarity, reuse, and
 * unit-testability.
 */
import { applyTopologyDiff, type TopologyApplyResult } from '@/api/topology';
import { listWorkspacesScoped, type WorkspaceDto } from '@/api/workspaces';

import { type LocationProfile } from '@/api/locations';
import {
  isTopologyInstance,
  normalizeTopologyGraph,
  topologyIssueKey,
  validateTopologyGraph,
} from './topologyContract';
import { computeTopologyDiff } from './topologyDiff';
import type { TopologyNodeData, TopologyWireData } from './NodeTopologyEditor';

// ── Types ─────────────────────────────────────────────────────────

export interface ApplyContext {
  /** Active session token for IPC calls. */
  sessionToken: string;
  /** Current workspace instances (loaded from backend). */
  workspaceInstances: WorkspaceDto[];
  /** Store profiles for type-change archive+recreate. */
  stores: LocationProfile[];
  /** License tier for validation gating. */
  licenseTier: string;
  /** Selected branch ID (for multi-branch topologies). */
  branchId: string | undefined;
  /** Base revision for optimistic concurrency. */
  baseRevision: number | undefined;
  /** Issue keys the user has dismissed (e.g. intentionally empty warehouse). */
  resolvedIssueKeys: string[];
  /**
   * ADR #46 §6: "what changed and why", recorded on the revision row and the
   * audit entry. Optional — an Apply is never blocked on writing a note.
   * Capped server-side at 500 characters, where an over-long note is
   * REJECTED before any mutation rather than silently truncated.
   *
   * `| undefined` is required by exactOptionalPropertyTypes: TopologyScreen
   * forwards the editor's optional `changeNote` parameter, which is genuinely
   * `string | undefined` rather than absent, and `?: string` alone would
   * refuse it.
   */
  changeNote?: string | undefined;
}

export interface ApplyResult extends TopologyApplyResult {
  /** Old node ID → new node ID map (only for type-changed nodes). */
  idMap?: Record<string, string>;
  /** Refreshed workspace instances after successful apply. */
  refreshedInstances?: WorkspaceDto[];
}

/** Thrown when topology validation fails. Caller should NOT re-toast. */
export class TopologyApplyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopologyApplyValidationError';
  }
}

export interface ApplyToast {
  (message: string, type: 'success' | 'error'): void;
}

export interface ApplyL10n {
  getString(key: string, vars?: Record<string, string | number>): string;
}

// ── Main helper ───────────────────────────────────────────────────

/**
 * Execute a topology Apply operation.
 *
 * 1. Normalize + validate the semantic graph.
 * 2. Filter out resolved (dismissed) issues.
 * 3. Compute workspace instance diff (creates/updates/archives/type-changes).
 * 4. Remap diagram node/wire IDs for type-changed nodes.
 * 5. Call `apply_topology_diff` atomically.
 * 6. Show success/error toast.
 * 7. Refresh workspace instances so subsequent saves diff against truth.
 *
 * @throws On validation errors or IPC failure (after showing error toast).
 */


/**
 * Full diagram-level apply: validates, diffs, remaps, and persists.
 *
 * This is the primary entry point for TopologyScreen's Apply handler.
 */
export async function applyTopologyWithDiagram(
  nodes: TopologyNodeData[],
  wires: TopologyWireData[],
  ctx: ApplyContext,
  toast: ApplyToast,
  l10n: ApplyL10n,
): Promise<ApplyResult> {
  // ── Step 1: Normalize + validate ──────────────────────────────────
  const semanticGraph = normalizeTopologyGraph(nodes, wires);
  const validationErrors = validateTopologyGraph(semanticGraph, ctx.licenseTier);

  // Filter out resolved (dismissed) issues — e.g. intentionally empty warehouse.
  // The key format is the contract's topologyIssueKey (`node:<id>:<messageId>`),
  // the SAME format the editor writes to resolved_issue_keys — a drift here
  // would silently break the dismissed-prompt bypass on Apply.
  const resolvedSet = new Set(ctx.resolvedIssueKeys);
  const blockingErrors = validationErrors.filter(
    (e) => !(e.code === 'warehouse-missing-stock-routing' && e.nodeId && resolvedSet.has(topologyIssueKey(e.nodeId, e.messageId))),
  );

  if (blockingErrors.length > 0) {
    const firstError = blockingErrors[0]!;
    const msg = l10n.getString(firstError.messageId);
    toast(msg, 'error');
    throw new TopologyApplyValidationError(msg);
  }

  // ── Step 2: Compute workspace instance diff ───────────────────────
  const diff = computeTopologyDiff({ nodes, wires, workspaceInstances: ctx.workspaceInstances, stores: ctx.stores });
  const { creations, updates, archives, typeChanges, idMap } = diff;

  // ── Step 3: Remap diagram for type-changed nodes ──────────────────
  const { diagramNodes, diagramWires } = buildDiagramPayloads(
    nodes, wires, typeChanges, semanticGraph,
  );

  // ── Step 4: Atomic apply ──────────────────────────────────────────
  const result = await applyTopologyDiff(
    ctx.sessionToken,
    creations,
    updates,
    archives,
    diagramNodes,
    diagramWires,
    ctx.branchId,
    ctx.baseRevision ?? 0,
    crypto.randomUUID(),
    ctx.resolvedIssueKeys ?? [],
    ctx.changeNote,
  );

  if (!result || !Number.isSafeInteger(result.revision) || result.revision < 0) {
    throw new Error('topology Apply returned no committed revision');
  }

  // ── Step 5: Success toast ─────────────────────────────────────
  // Net counts mirror summarizeTopologyPlan (the diff chip) so the toast can
  // never disagree with the header preview: a type change is a destructive
  // recreate — archive + create of a NEW instance — so it is surfaced as
  // type-changed and EXCLUDED from the plain created/archived counts (a
  // single node must never be counted three times).
  const typeChanged = typeChanges.size;
  const created = creations.length - typeChanged;
  const updated = updates.length;
  const archived = archives.length - typeChanged;
  toast(l10n.getString('topology-toast-saved', {
    created,
    updated,
    archived,
    typeChanged,
  }), 'success');

  // ── Step 6: Refresh instances ──────────────────────────────────
  try {
    const refreshed = (await listWorkspacesScoped(ctx.sessionToken)).filter(isTopologyInstance);
    return { ...result, refreshedInstances: refreshed, ...(Object.keys(idMap).length > 0 ? { idMap } : {}) };
  } catch {
    // Non-fatal: return result without refreshed instances.
    return { ...result, ...(Object.keys(idMap).length > 0 ? { idMap } : {}) };
  }
}

// ── Internal helpers ──────────────────────────────────────────────

type DiagramNodePayload = Parameters<typeof applyTopologyDiff>[4][number];
type DiagramWirePayload = Parameters<typeof applyTopologyDiff>[5][number];

/**
 * Build diagram payloads with ID remapping for type-changed nodes.
 * Type_key is immutable by backend contract, so a type change requires
 * archive + recreate with a new UUID.
 */
function buildDiagramPayloads(
  nodes: TopologyNodeData[],
  wires: TopologyWireData[],
  typeChanges: Map<string, { newId: string }>,
  semanticGraph: ReturnType<typeof normalizeTopologyGraph>,
) {
  const diagramNodes: DiagramNodePayload[] = nodes.map((n) => {
    const changedId = typeChanges.get(n.id)?.newId ?? n.id;
    const payload: DiagramNodePayload = {
      id: changedId,
      type: n.type,
      name: n.name,
      x: n.x,
      y: n.y,
    };
    if (n.storeProfileId !== undefined) payload.store_profile_id = n.storeProfileId;
    if (n.subtitle !== undefined) payload.subtitle = n.subtitle;
    if (n.tierRequirement !== undefined) payload.tier_requirement = n.tierRequirement;
    if (n.telemetryBadge !== undefined) payload.telemetry_badge = n.telemetryBadge;
    if (n.telemetryStatus !== undefined) payload.telemetry_status = n.telemetryStatus;
    if (n.metadata !== undefined || n.storeProfileId !== undefined) {
      const change = typeChanges.get(n.id);
      payload.metadata = {
        ...(n.metadata ?? {}),
        ...(n.storeProfileId !== undefined ? { storeProfileId: n.storeProfileId } : {}),
        ...(change ? { persisted: true } : {}),
      };
    }
    return payload;
  });

  const diagramWires: DiagramWirePayload[] = wires.map((w) => {
    const fromId = typeChanges.get(w.fromNodeId)?.newId ?? w.fromNodeId;
    const toId = typeChanges.get(w.toNodeId)?.newId ?? w.toNodeId;
    const payload: DiagramWirePayload = {
      id: w.id,
      from_node_id: fromId,
      to_node_id: toId,
      direction: w.direction,
    };
    if (w.label !== undefined) payload.label = w.label;
    if (w.bends !== undefined) payload.bends = w.bends;
    if (w.fromPort !== undefined) payload.from_port = w.fromPort;
    if (w.toPort !== undefined) payload.to_port = w.toPort;

    // Persist normalized semantic identity for legacy wire upgrades.
    const semanticWire = semanticGraph.wires.find((c) => c.id === w.id);
    if (semanticWire) {
      payload.from_port_id = semanticWire.fromPortId;
      payload.to_port_id = semanticWire.toPortId;
      payload.relationship_type = semanticWire.relationshipType;
    } else {
      if (w.fromPortId !== undefined) payload.from_port_id = w.fromPortId;
      if (w.toPortId !== undefined) payload.to_port_id = w.toPortId;
      if (w.relationshipType !== undefined) payload.relationship_type = w.relationshipType;
    }
    return payload;
  });

  return { diagramNodes, diagramWires };
}
