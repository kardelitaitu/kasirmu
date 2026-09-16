/**
 * Dev-mock handlers — Topology domain.
 *
 * The topology diagram (the node/wire canvas) and its ADR #46 revision
 * history: the save-permission gate, the current-graph read, the editor's
 * atomic diff apply, the revision listing, and the per-revision restore
 * read. Extracted from `tauri-api.ts` by the agent-3 work order
 * (`todo-refactor-devmock-agents-3.md`, phase 3.2); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * The revision STATE is not owned here: `mockTopologyRevisions` and the
 * keep/deflate bookkeeping live in `handlers/topology-state.ts` (Agent 4),
 * which `handlers/staff.ts` imports for the same reason. What this module
 * owns is the diagram slice, seeded and persisted the way
 * `handlers/workspaces.ts` owns its list — and, like that module, it
 * reaches for the SHARED workspace array: `apply_topology_diff` mutates the
 * very `mockWorkspaces` instance `handlers/workspaces.ts` exports, so one
 * rename and one diagram diff still act on one list.
 */

import type { MockHandler } from '../core/mockDispatcher';
import { MOCK_TOPOLOGY_KEY, readSlice, readSliceRaw, writeSlice } from '../core/mockDatabase';
import { mockWorkspaces, saveMockWorkspaces } from './workspaces';
import {
  type MockTopology,
  type MockTopologyNode,
  type MockTopologyWire,
  mockTopologyRevisions,
  recordMockTopologyRevision,
  summarizeMockTopologyRevision,
} from './topology-state';

// ── Topology diagram (stateful mock, BRANCH-KEYED) ─────────────────
// The real backend persists the node/wire diagram as JSON under
// `topology_setting_key(branch_id)` — one envelope, and therefore ONE
// revision counter, per branch. The mock previously kept a single global
// envelope (its history was branch-keyed but the live diagram was not:
// finding T-1, `todo-topology-editor.md` §"Follow-up"), so applying at
// branch A changed what branch B loaded, and a stale baseRevision for one
// branch conflicted against another branch's counter. Ruled FIXED
// 2026-09-16 by the owner. Slices now mirror the backend's key structure:
// `<MOCK_TOPOLOGY_KEY>/<branchId>` for named branches, the bare key for
// the legacy unscoped view — which is also the only slot that seeds the
// first-run canvas; a named branch with nothing saved answers `null`
// exactly like the real command, so the editor takes its documented
// built-in-preset fallback. The previous hardcoded-position behavior
// (wrong payload shape, discarding saves) is the older fixed bug, kept
// here so the seed's purpose is legible: previews round-trip positions.

/** First-run canvas: matches the current preview's starting topology.
 *  Cards are 240px wide/tall, so positions sit on a spread grid (rows 80/320,
 *  columns 80/380) that never overlaps on load. Wires carry labels so the
 *  first-run canvas demonstrates the labeled-wire UX instead of empty pills. */
const MOCK_TOPOLOGY_SEED: MockTopology = {
  revision: 0,
  resolved_issue_keys: [],
  nodes: [
    { id: 'store-1', type: 'store', name: 'TOKO TEST', subtitle: 'Primary Store', x: 80, y: 80 },
    { id: 'ws-1', type: 'workspace', name: 'Store POS', subtitle: 'Point of Sale', x: 380, y: 80, metadata: { typeKey: 'store-pos', persisted: true } },
    { id: 'ws-2', type: 'workspace', name: 'Restaurant', subtitle: 'Table service', x: 380, y: 320, metadata: { typeKey: 'restaurant-pos', persisted: true } },
  ],
  wires: [
    { id: 'wire-1', from_node_id: 'store-1', from_port: 'right', to_node_id: 'ws-1', to_port: 'left', direction: 'one-way', label: 'Binds Store' },
    { id: 'wire-2', from_node_id: 'store-1', from_port: 'right', to_node_id: 'ws-2', to_port: 'left', direction: 'one-way', label: 'Binds Store' },
  ],
};

// One envelope — and therefore one revision counter — per branch, mirroring
// the real `topology_setting_key(branch_id)`. The write-through cache keeps
// repeated loads from re-parsing localStorage; `readSliceRaw` answers the
// "never saved" question `readSlice` cannot, because its seed-on-missing
// collapses "absent" and "seeded" into one shape.
const topologySlices = new Map<string, MockTopology>();

function topologySliceKey(branchId?: string): string {
  return branchId ? `${MOCK_TOPOLOGY_KEY}/${branchId}` : MOCK_TOPOLOGY_KEY;
}

function branchTopology(branchId?: string): MockTopology {
  const key = topologySliceKey(branchId);
  const cached = topologySlices.get(key);
  if (cached) return cached;
  // Only the legacy unscoped slot seeds the first-run canvas; a named
  // branch starts as nothing-saved, exactly like a fresh store DB.
  const slice = readSlice(key, () =>
    branchId
      ? { revision: 0, resolved_issue_keys: [], nodes: [], wires: [] }
      : MOCK_TOPOLOGY_SEED,
  );
  topologySlices.set(key, slice);
  return slice;
}

function hasBranchTopology(branchId: string): boolean {
  const key = topologySliceKey(branchId);
  return readSliceRaw(key) !== null || topologySlices.has(key);
}

function saveBranchTopology(branchId: string | undefined, topology: MockTopology): void {
  topologySlices.set(topologySliceKey(branchId), topology);
  writeSlice(topologySliceKey(branchId), topology);
}

// ── Topology revision history (ADR #46) ───────────────────────
//
// The dev-mock mirrors the backend's append-only history so the version
// browser is reachable without a running desktop client. It also mirrors
// §4's DEFlation rule, not just the append — otherwise `restorable: false`
// is unreachable in the browser and the "record only — snapshot pruned"
// state the real sweep produces can never be exercised during development.

export const topologyHandlers: Record<string, MockHandler> = {

  'can_save_topology': () => true,
  'load_topology': (args) => {
    const { branchId } = (args as { branchId?: string }) ?? {};
    // Parity with the real command's `Ok(None)`: a named branch with nothing
    // saved answers null and the editor takes its built-in-preset fallback.
    // The legacy unscoped view keeps the seeded first-run canvas.
    if (branchId && !hasBranchTopology(branchId)) return null;
    const topo = branchTopology(branchId);
    return {
      revision: topo.revision ?? 0,
      resolved_issue_keys: [...(topo.resolved_issue_keys ?? [])],
      nodes: topo.nodes.map((n) => ({ ...n })),
      wires: topo.wires.map((w) => ({ ...w })),
    };
  },
  // The editor's Apply button saves through this command. Mirror the real
  // backend's atomic diff: apply instance creates/updates/archives AND
  // persist the diagram (node positions included) so reloads keep both the
  // node layout and the workspace instances.
  'apply_topology_diff': (args) => {
    const { workspaceCreations, workspaceUpdates, workspaceArchives, diagramNodes, diagramWires, resolvedIssueKeys, baseRevision, branchId, changeNote } = (args as {
      workspaceCreations?: Array<{ id: string; type_key: string; store_id: string; name: string; description?: string; colour?: string }>;
      workspaceUpdates?: Array<{ id: string; name: string }>;
      workspaceArchives?: string[];
      diagramNodes?: MockTopologyNode[];
      diagramWires?: MockTopologyWire[];
      resolvedIssueKeys?: string[];
      baseRevision?: number;
      branchId?: string;
      changeNote?: string;
    }) ?? {};
    // Mirror the backend's optimistic-concurrency gate (topology.rs, round
    // 133): a stale baseRevision can NEVER retry successfully, so reject
    // with the typed conflict the editor's recovery path detects (round
    // 137). Skipped when the field is absent — the real command requires
    // base_revision, so only callers that send it opt into the guard.
    const topo = branchTopology(branchId);
    const currentRevision = topo.revision ?? 0;
    if (baseRevision !== undefined && baseRevision !== currentRevision) {
      throw {
        kind: 'topologyValidation',
        code: 'topology-revision-conflict',
        nodeId: null,
        wireId: null,
        portId: null,
        message: `topology revision conflict: expected ${baseRevision}, current ${currentRevision}`,
      };
    }
    for (const c of workspaceCreations ?? []) {
      mockWorkspaces.push({
        instance_id: c.id,
        type_key: c.type_key,
        store_id: c.store_id,
        store_name: 'TOKO TEST',
        name: c.name,
        description: c.description ?? '',
        icon: 'shopping-cart',
        layout_mode: 'default',
        colour: c.colour ?? '#10b981',
        is_default: false,
      });
    }
    for (const u of workspaceUpdates ?? []) {
      const inst = mockWorkspaces.find((w) => w.instance_id === u.id);
      if (inst) inst.name = u.name;
    }
    for (const id of workspaceArchives ?? []) {
      const idx = mockWorkspaces.findIndex((w) => w.instance_id === id);
      if (idx >= 0) mockWorkspaces.splice(idx, 1);
    }
    if (workspaceCreations?.length || workspaceUpdates?.length || workspaceArchives?.length) {
      saveMockWorkspaces();
    }
    if (diagramNodes) topo.nodes = diagramNodes.map((n) => ({ ...n }));
    if (diagramWires) topo.wires = diagramWires.map((w) => ({ ...w }));
    if (resolvedIssueKeys) topo.resolved_issue_keys = [...resolvedIssueKeys];
    topo.revision = (topo.revision ?? 0) + 1;
    saveBranchTopology(branchId, topo);
    // ADR #46 §3: in the real backend this row is written INSIDE the same
    // transaction as the envelope, so a rejected Apply leaves no history. The
    // conflict throw above already mirrors that — control never reaches here
    // on a rejected Apply.
    recordMockTopologyRevision({
      branchId: branchId ?? '',
      revision: topo.revision,
      changeNote: changeNote ?? '',
      publishedAt: new Date().toISOString(),
      publishedBy: 'dev-mock',
      pinned: false,
      nodeCount: topo.nodes.length,
      wireCount: topo.wires.length,
      workspaceCreations: workspaceCreations?.length ?? 0,
      workspaceUpdates: workspaceUpdates?.length ?? 0,
      workspaceArchives: workspaceArchives?.length ?? 0,
      contractSchemaVersion: 2,
      diagram: JSON.parse(JSON.stringify(topo)) as MockTopology,
    });
    return { revision: topo.revision };
  },

  // ADR #46 §1/§8: metadata only, newest first — the diagram is fetched per
  // revision by `load_topology_revision`, mirroring the real payload bound.
  'list_topology_revisions': (args) => {
    const { limit, branchId } = (args as { limit?: number; branchId?: string }) ?? {};
    const budget = Math.min(Math.max(limit ?? 50, 1), 200);
    return mockTopologyRevisions
      .filter((r) => r.branchId === (branchId ?? ''))
      .slice()
      .sort((a, b) => b.revision - a.revision)
      .slice(0, budget)
      .map(summarizeMockTopologyRevision);
  },

  // `deflated` and `not-found` stay distinct (ADR #46 §4): a pruned deploy
  // still happened.
  'load_topology_revision': (args) => {
    const { revision, branchId } = (args as { revision?: number; branchId?: string }) ?? {};
    const row = mockTopologyRevisions.find(
      (r) => r.revision === revision && r.branchId === (branchId ?? ''),
    );
    if (!row) {
      return { status: 'not-found', revision: revision ?? 0, changeNote: '', publishedAt: '', publishedBy: '' };
    }
    if (row.diagram === undefined) {
      return {
        status: 'deflated',
        revision: row.revision,
        changeNote: row.changeNote,
        publishedAt: row.publishedAt,
        publishedBy: row.publishedBy,
      };
    }
    return {
      status: 'restorable',
      revision: row.revision,
      changeNote: row.changeNote,
      publishedAt: row.publishedAt,
      publishedBy: row.publishedBy,
      contractSchemaVersion: row.contractSchemaVersion,
      diagram: row.diagram,
    };
  },
};
