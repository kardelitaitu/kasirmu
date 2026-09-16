// ── Dev-mock location-profile + topology round-trips ─────────────
//
// The plain-browser dev preview (and E2E) runs on the dev-mock's
// in-memory location list and topology diagram instead of the real DB.
// A branch rename must round-trip exactly like the backend:
//   - update_location_profile_scoped mutates the list that
//     list_locations_scoped later serves, so a reload keeps the new name;
//   - the rename must NEVER disturb the persisted topology diagram —
//     node positions survive a reload, because the diagram is only
//     rewritten by Apply (apply_topology_diff), never
//     by a location rename. The editor light-merges the new name
//     onto the card from the live location list instead.
// These pin the persistence contract without needing a live app.
//
// History: the pre-migration file drove the legacy store-profile command
// names (unscoped + the ADR #7 _scoped aliases). Both families retired with
// the Store → Location caller migration (todo-global-saas-1.md slice 1c/1d),
// so every round-trip now goes through the canonical commands.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

interface MockLocationRow {
  id: string;
  name: string;
  address: string;
  tax_id: string;
  currency: string;
  timezone: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}
interface MockTopologyNodeRow {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
}
interface MockTopologyWireRow {
  id: string;
  from_node_id: string;
  to_node_id: string;
  direction: string;
}

// jsdom has no window.__TAURI_INTERNALS__, so invoke routes to the mock
// handlers — the same path a browser preview takes.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('dev-mock location + topology round-trip', () => {
  it('persists a renamed branch across list calls like the real DB', async () => {
    const created = await invoke('create_location_profile_scoped', {
      sessionToken: 'test-session-token',
      args: { id: 'location-rt-1', name: 'RT Branch' },
    }) as MockLocationRow;
    expect(created.name).toBe('RT Branch');

    const renamed = await invoke('update_location_profile_scoped', {
      sessionToken: 'test-session-token',
      args: {
        id: created.id,
        name: 'RT Renamed',
        address: created.address,
        tax_id: created.tax_id,
        currency: created.currency,
        timezone: created.timezone,
      },
    }) as MockLocationRow;
    expect(renamed.name).toBe('RT Renamed');

    // A fresh list call (what a reload would show) serves the renamed row.
    const list = await invoke('list_locations_scoped', {
      sessionToken: 'test-session-token',
    }) as MockLocationRow[];
    const row = list.find((s) => s.id === created.id);
    expect(row).toBeDefined();
    expect(row?.name).toBe('RT Renamed');
  });

  it('keeps topology node positions across a branch rename (create → rename → reload)', async () => {
    // Snapshot the seeded diagram first so the test self-heals across
    // watch-mode re-runs (the mock persists the diagram to localStorage).
    const initial = await invoke<{ nodes: MockTopologyNodeRow[]; wires: MockTopologyWireRow[] }>('load_topology');
    expect(initial.nodes.length).toBeGreaterThan(0);
    const initialWs = initial.nodes.find((n) => n.id === 'ws-1');
    expect(initialWs).toBeDefined();

    // 1. Create a new branch — the editor would seed a store node for it.
    const created = await invoke('create_location_profile_scoped', {
      sessionToken: 'test-session-token',
      args: { id: 'location-rt-2', name: 'RT Diagram Branch' },
    }) as MockLocationRow;
    expect(created.name).toBe('RT Diagram Branch');

    // 2. Persist a diagram that includes the new branch node at a
    //    distinctive position — Apply (apply_topology_diff) is the path
    //    the editor uses, and it writes the diagram unconditionally.
    const diagramNodes: MockTopologyNodeRow[] = [
      ...initial.nodes,
      { id: 'location-rt-2', type: 'store', name: 'RT Diagram Branch', x: 380, y: 500 },
    ];
    await invoke('apply_topology_diff', {
      args: {
        sessionToken: 'test-session-token',
        workspaceCreations: [],
        workspaceUpdates: [],
        workspaceArchives: [],
        diagramNodes,
        diagramWires: initial.wires,
      },
    });

    // 3. Rename the branch (the card-rename path).
    const renamed = await invoke('update_location_profile_scoped', {
      sessionToken: 'test-session-token',
      args: {
        id: created.id,
        name: 'RT Diagram Renamed',
        address: created.address,
        tax_id: created.tax_id,
        currency: created.currency,
        timezone: created.timezone,
      },
    }) as MockLocationRow;
    expect(renamed.name).toBe('RT Diagram Renamed');

    // 4. Reload-simulating list: the location list serves the renamed row.
    const list = await invoke('list_locations_scoped', {
      sessionToken: 'test-session-token',
    }) as MockLocationRow[];
    expect(list.find((s) => s.id === created.id)?.name).toBe('RT Diagram Renamed');

    // 5. …and the topology diagram keeps the node with its position
    //    intact — the rename must not disturb the persisted layout.
    const reloaded = await invoke<{ nodes: MockTopologyNodeRow[]; wires: MockTopologyWireRow[] }>('load_topology');
    const node = reloaded.nodes.find((n) => n.id === 'location-rt-2');
    expect(node).toBeDefined();
    expect(node?.x).toBe(380);
    expect(node?.y).toBe(500);
    // Existing nodes are untouched too (positions match the pre-rename save).
    const reloadedWs = reloaded.nodes.find((n) => n.id === 'ws-1');
    expect(reloadedWs?.x).toBe(initialWs?.x);
    expect(reloadedWs?.y).toBe(initialWs?.y);
    // Wires survive the round-trip too (the diff path persists them).
    expect(reloaded.wires).toHaveLength(initial.wires.length);
    // The diagram persists the name that was applied; the live rename is
    // served by the location list and light-merged onto the card by the editor.
    expect(node?.name).toBe('RT Diagram Branch');

    // 6. Self-heal: restore the seed diagram for watch-mode re-runs.
    await invoke('apply_topology_diff', {
      args: {
        sessionToken: 'test-session-token',
        workspaceCreations: [],
        workspaceUpdates: [],
        workspaceArchives: [],
        diagramNodes: initial.nodes,
        diagramWires: initial.wires,
        resolvedIssueKeys: [],
      },
    });
  });

  it('delete_location_profile_scoped removes the branch from subsequent list calls', async () => {
    const created = await invoke('create_location_profile_scoped', {
      sessionToken: 'test-session-token',
      args: { id: 'location-rt-3', name: 'RT Delete Me' },
    }) as MockLocationRow;

    await invoke('delete_location_profile_scoped', {
      sessionToken: 'test-session-token',
      id: created.id,
    });

    // A fresh list call (what a reload would show) no longer serves the row.
    const list = await invoke('list_locations_scoped', {
      sessionToken: 'test-session-token',
    }) as MockLocationRow[];
    expect(list.find((s) => s.id === created.id)).toBeUndefined();
    // Deletion is targeted — the seed branch survives.
    expect(list.some((s) => s.id === 'store-1')).toBe(true);
  });

  it('answers the full canonical location command family with one stateful contract', async () => {
    const sessionToken = 'test-location-session';
    const list = await invoke('list_locations_scoped', { sessionToken }) as MockLocationRow[];
    expect(list.some((location) => location.id === 'store-1')).toBe(true);

    const one = await invoke('get_location_profile_scoped', {
      sessionToken,
      id: 'store-1',
    }) as MockLocationRow | null;
    expect(one?.id).toBe('store-1');

    const primary = await invoke('get_primary_location_scoped', {
      sessionToken,
    }) as MockLocationRow | null;
    expect(primary).toBeDefined();

    const created = await invoke('create_location_profile_scoped', {
      sessionToken,
      args: { id: 'location-sc-1', name: 'Canonical Location' },
    }) as MockLocationRow;
    expect(created.name).toBe('Canonical Location');

    const renamed = await invoke('update_location_profile_scoped', {
      sessionToken,
      args: {
        id: 'location-sc-1',
        name: 'Canonical Renamed',
        address: '',
        tax_id: '',
        currency: 'USD',
        timezone: 'UTC',
      },
    }) as MockLocationRow;
    expect(renamed.name).toBe('Canonical Renamed');

    const setPrimary = await invoke('set_primary_location_scoped', {
      sessionToken,
      id: 'location-sc-1',
    }) as MockLocationRow;
    expect(setPrimary.id).toBe('location-sc-1');
    expect((await invoke('get_primary_location_scoped', { sessionToken }) as MockLocationRow).id)
      .toBe('location-sc-1');

    await invoke('delete_location_profile_scoped', {
      sessionToken,
      id: 'location-sc-1',
    });
    const afterDelete = await invoke('list_locations_scoped', { sessionToken }) as MockLocationRow[];
    expect(afterDelete.find((location) => location.id === 'location-sc-1')).toBeUndefined();
  });
});

// ── Dev-mock revision-conflict parity (round 138) ────────────────
//
// The backend rejects any Apply whose baseRevision differs from the
// committed revision (topology.rs revision gate, round 133) — a stale
// editor can NEVER retry successfully, so the editor adopts the
// authoritative topology instead (round 137). The mock previously ignored
// baseRevision and always accepted, so browser previews could not exercise
// that recovery path. Pin the parity here: a stale base must reject with
// the typed conflict shape AND leave the diagram + revision untouched.
// When baseRevision is absent (legacy direct callers), the guard is
// skipped — matching the real command's required-field contract where
// only callers that send the field opt into optimistic concurrency.
describe('dev-mock apply_topology_diff revision-conflict parity', () => {
  it('rejects a stale baseRevision with the typed conflict and leaves state intact', async () => {
    // Snapshot the seeded diagram + revision first so the test self-heals
    // across watch-mode re-runs (the mock persists both to localStorage).
    const initial = await invoke<{ revision: number; nodes: MockTopologyNodeRow[]; wires: MockTopologyWireRow[] }>('load_topology');
    const base = initial.revision;

    // A fresh Apply at the CURRENT revision succeeds and bumps the counter.
    await invoke('apply_topology_diff', {
      args: {
        sessionToken: 'test-session-token',
        workspaceCreations: [],
        workspaceUpdates: [],
        workspaceArchives: [],
        diagramNodes: initial.nodes,
        diagramWires: initial.wires,
        baseRevision: base,
      },
    });
    const after = await invoke<{ revision: number; nodes: MockTopologyNodeRow[]; wires: MockTopologyWireRow[] }>('load_topology');
    expect(after.revision).toBe(base + 1);

    // The SAME base is now stale — the mock must reject with the typed
    // shape the editor's recovery path detects (kind topologyValidation +
    // code topology-revision-conflict, mirroring the Rust serialization).
    await expect(invoke('apply_topology_diff', {
      args: {
        sessionToken: 'test-session-token',
        workspaceCreations: [],
        workspaceUpdates: [],
        workspaceArchives: [],
        diagramNodes: initial.nodes,
        diagramWires: initial.wires,
        baseRevision: base,
      },
    })).rejects.toMatchObject({
      kind: 'topologyValidation',
      code: 'topology-revision-conflict',
    });

    // Rejection is a no-op: revision unchanged, diagram untouched.
    const still = await invoke<{ revision: number; nodes: MockTopologyNodeRow[]; wires: MockTopologyWireRow[] }>('load_topology');
    expect(still.revision).toBe(base + 1);
    expect(still.nodes).toEqual(after.nodes);
    expect(still.wires).toEqual(after.wires);

    // Self-heal: restore the seed diagram for watch-mode re-runs.
    await invoke('apply_topology_diff', {
      args: {
        sessionToken: 'test-session-token',
        workspaceCreations: [],
        workspaceUpdates: [],
        workspaceArchives: [],
        diagramNodes: initial.nodes,
        diagramWires: initial.wires,
        baseRevision: still.revision,
        resolvedIssueKeys: [],
      },
    });
  });
});

// T-1 (owner ruling 2026-09-16 "lets fix it"): the diagram envelope AND its
// revision counter are per-branch in the real backend — `topology_setting_key`
// derives one settings row per branch. The mock's history was already
// branch-keyed while its live diagram was one global object, so an apply at
// branch A answered branch B's load and one branch's counter could conflict
// another branch's apply. These three cases pin exactly the properties the
// global envelope made unobservable; they pass against the real command's
// semantics, not the mock's convenience.
describe('dev-mock topology envelope is branch-keyed (T-1 parity)', () => {
  type Envelope = { revision: number; nodes: MockTopologyNodeRow[]; wires: MockTopologyWireRow[] };

  const applyTo = (branchId: string, baseRevision: number, nodes: MockTopologyNodeRow[]) =>
    invoke<{ revision: number }>('apply_topology_diff', {
      args: {
        sessionToken: 'test-session-token',
        workspaceCreations: [],
        workspaceUpdates: [],
        workspaceArchives: [],
        diagramNodes: nodes,
        diagramWires: [],
        baseRevision,
        branchId,
      },
    });

  it('a named branch with nothing saved answers null — the real command returns None', async () => {
    await expect(invoke('load_topology', { args: { branchId: 't1-never-saved' } })).resolves.toBeNull();
  });

  it('an apply at one branch is invisible to another branch and to the legacy slot', async () => {
    const legacy = await invoke<Envelope>('load_topology');
    await applyTo('t1-branch-a', 0, legacy.nodes);
    const a = await invoke<Envelope>('load_topology', { args: { branchId: 't1-branch-a' } });
    expect(a.revision).toBe(1);
    expect(a.nodes.map((n) => n.id)).toEqual(legacy.nodes.map((n) => n.id));
    await expect(invoke('load_topology', { args: { branchId: 't1-branch-b' } })).resolves.toBeNull();
    // The legacy envelope neither moved nor bumped.
    const legacyAfter = await invoke<Envelope>('load_topology');
    expect(legacyAfter.revision).toBe(legacy.revision);
  });

  it('counters are per branch: a stale base on branch A does not conflict a fresh apply to B', async () => {
    const a = await invoke<Envelope>('load_topology', { args: { branchId: 't1-branch-a' } });
    // B is at 0 (nothing applied there) — a base of 0 must SUCCEED even
    // though A's counter already moved past it…
    const freshB = await applyTo('t1-branch-b', 0, a.nodes);
    expect(freshB.revision).toBe(1);
    // …and A, now at 1, still rejects its own stale base. Same mock, same
    // command, two independent gates — this is the T-1 property.
    await expect(applyTo('t1-branch-a', 0, a.nodes)).rejects.toMatchObject({
      kind: 'topologyValidation',
      code: 'topology-revision-conflict',
    });
  });
});
