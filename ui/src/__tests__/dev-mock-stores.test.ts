// ── Dev-mock store-profile + topology round-trips ────────────────
//
// The plain-browser dev preview (and E2E) runs on the dev-mock's
// in-memory store list and topology diagram instead of the real DB.
// A branch rename must round-trip exactly like the backend:
//   - update_store_profile mutates the list that list_store_profiles
//     later serves, so a reload keeps the new name;
//   - the rename must NEVER disturb the persisted topology diagram —
//     node positions survive a reload, because the diagram is only
//     rewritten by Apply (apply_topology_diff), never
//     by a store-profile rename. The editor light-merges the new name
//     onto the card from the live store list instead.
// These pin the persistence contract without needing a live app.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { invoke } from '@/dev-mock/tauri-api';

interface MockStoreRow {
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

describe('dev-mock store + topology round-trip', () => {
  it('persists a renamed branch across list calls like the real DB', async () => {
    const created = await invoke('create_store_profile', {
      args: { id: 'store-rt-1', name: 'RT Branch' },
    }) as MockStoreRow;
    expect(created.name).toBe('RT Branch');

    const renamed = await invoke('update_store_profile', {
      args: {
        id: created.id,
        name: 'RT Renamed',
        address: created.address,
        tax_id: created.tax_id,
        currency: created.currency,
        timezone: created.timezone,
      },
    }) as MockStoreRow;
    expect(renamed.name).toBe('RT Renamed');

    // A fresh list call (what a reload would show) serves the renamed row.
    const list = await invoke('list_store_profiles') as MockStoreRow[];
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
    const created = await invoke('create_store_profile', {
      args: { id: 'store-rt-2', name: 'RT Diagram Branch' },
    }) as MockStoreRow;
    expect(created.name).toBe('RT Diagram Branch');

    // 2. Persist a diagram that includes the new branch node at a
    //    distinctive position — Apply (apply_topology_diff) is the path
    //    the editor uses, and it writes the diagram unconditionally.
    const diagramNodes: MockTopologyNodeRow[] = [
      ...initial.nodes,
      { id: 'store-rt-2', type: 'store', name: 'RT Diagram Branch', x: 380, y: 500 },
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
    const renamed = await invoke('update_store_profile', {
      args: {
        id: created.id,
        name: 'RT Diagram Renamed',
        address: created.address,
        tax_id: created.tax_id,
        currency: created.currency,
        timezone: created.timezone,
      },
    }) as MockStoreRow;
    expect(renamed.name).toBe('RT Diagram Renamed');

    // 4. Reload-simulating list: the store list serves the renamed row.
    const list = await invoke('list_store_profiles') as MockStoreRow[];
    expect(list.find((s) => s.id === created.id)?.name).toBe('RT Diagram Renamed');

    // 5. …and the topology diagram keeps the node with its position
    //    intact — the rename must not disturb the persisted layout.
    const reloaded = await invoke<{ nodes: MockTopologyNodeRow[]; wires: MockTopologyWireRow[] }>('load_topology');
    const node = reloaded.nodes.find((n) => n.id === 'store-rt-2');
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
    // served by the store list and light-merged onto the card by the editor.
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

  it('delete_store_profile removes the branch from subsequent list calls', async () => {
    const created = await invoke('create_store_profile', {
      args: { id: 'store-rt-3', name: 'RT Delete Me' },
    }) as MockStoreRow;

    await invoke('delete_store_profile', { args: { id: created.id } });

    // A fresh list call (what a reload would show) no longer serves the row.
    const list = await invoke('list_store_profiles') as MockStoreRow[];
    expect(list.find((s) => s.id === created.id)).toBeUndefined();
    // Deletion is targeted — the seed branch survives.
    expect(list.some((s) => s.id === 'store-1')).toBe(true);
  });

  it('answers the scoped store commands the API layer now invokes (ADR #7 aliases)', async () => {
    // The TS API migrated to *_scoped (listStoresScoped etc. → the
    // list_store_profiles_scoped family). The dev-mock must serve those
    // names so the browser preview does not see `null` stores — which would
    // gate the topology editor's Apply off and empty StoreSwitcher. Call
    // shapes mirror the real wrappers in @/api/stores (sessionToken for
    // read/write-by-id, sessionToken + nested args for create/update).
    const list = await invoke('list_store_profiles_scoped', {
      sessionToken: 'test-session-token',
    }) as MockStoreRow[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((s) => s.id === 'store-1')).toBe(true);

    const one = await invoke('get_store_profile_scoped', {
      sessionToken: 'test-session-token',
      id: 'store-1',
    }) as MockStoreRow | null;
    expect(one?.id).toBe('store-1');

    const primary = await invoke('get_primary_store_scoped', {
      sessionToken: 'test-session-token',
    }) as MockStoreRow | null;
    expect(primary).toBeDefined();

    // Mutations resolve through the same alias and persist to the list.
    const created = await invoke('create_store_profile_scoped', {
      sessionToken: 'test-session-token',
      args: { id: 'store-sc-1', name: 'Scoped Branch' },
    }) as MockStoreRow;
    expect(created.name).toBe('Scoped Branch');

    const renamed = await invoke('update_store_profile_scoped', {
      sessionToken: 'test-session-token',
      args: {
        id: 'store-sc-1',
        name: 'Scoped Renamed',
        address: '',
        tax_id: '',
        currency: 'USD',
        timezone: 'UTC',
      },
    }) as MockStoreRow;
    expect(renamed.name).toBe('Scoped Renamed');

    await invoke('set_primary_store_scoped', {
      sessionToken: 'test-session-token',
      id: 'store-sc-1',
    });
    const afterSet = await invoke('list_store_profiles') as MockStoreRow[];
    expect(afterSet.find((s) => s.id === 'store-sc-1')?.is_primary).toBe(true);

    await invoke('delete_store_profile_scoped', {
      sessionToken: 'test-session-token',
      id: 'store-sc-1',
    });
    const afterDelete = await invoke('list_store_profiles') as MockStoreRow[];
    expect(afterDelete.find((s) => s.id === 'store-sc-1')).toBeUndefined();
  });

  it('answers canonical location commands with the same stateful contract', async () => {
    const sessionToken = 'test-location-session';
    const list = await invoke('list_locations_scoped', { sessionToken }) as MockStoreRow[];
    expect(list.some((location) => location.id === 'store-1')).toBe(true);

    const created = await invoke('create_location_profile_scoped', {
      sessionToken,
      args: { id: 'location-sc-1', name: 'Canonical Location' },
    }) as MockStoreRow;
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
    }) as MockStoreRow;
    expect(renamed.name).toBe('Canonical Renamed');

    const primary = await invoke('set_primary_location_scoped', {
      sessionToken,
      id: 'location-sc-1',
    }) as MockStoreRow;
    expect(primary.id).toBe('location-sc-1');
    expect((await invoke('get_primary_location_scoped', { sessionToken }) as MockStoreRow).id)
      .toBe('location-sc-1');

    await invoke('delete_location_profile_scoped', {
      sessionToken,
      id: 'location-sc-1',
    });
    const afterDelete = await invoke('list_locations_scoped', { sessionToken }) as MockStoreRow[];
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
