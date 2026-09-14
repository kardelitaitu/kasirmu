/**
 * Dev-mock handlers — Workspaces domain.
 *
 * Workspace instances (read/create/rename), workspace screens, the
 * workspace-type picker, the multi-store workspace listing, and the boot
 * resolution that names the store/instance pair a preview starts in.
 * Extracted from `tauri-api.ts` by the agent-3 work order
 * (`todo-refactor-devmock-agents-3.md`, phase 3.1); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * `mockWorkspaces` and `saveMockWorkspaces` are exported because the topology
 * handlers still in the router (`apply_topology_diff`, phase 3.2) mutate the SAME
 * array: the rename below and the diagram diff share one instance list, so the
 * state keeps exactly one owner and one identity. `handlers/kds.ts` uses the same
 * shape (state + save + plain map) for the same reason.
 *
 * The device-binding entries that sat under this banner in the router stay there:
 * `get/set/clear_device_binding` is a separate command family
 * (`ui/src/api/terminals.ts`) that this work order does not claim.
 */

import type { MockHandler } from '../core/mockDispatcher';
import { MOCK_WORKSPACES_KEY, readSlice, writeSlice } from '../core/mockDatabase';
import { MOCK_WORKSPACES_SEED } from '../core/mockSeedData';

function loadMockWorkspaces(): typeof MOCK_WORKSPACES_SEED {
  return readSlice(MOCK_WORKSPACES_KEY, () => MOCK_WORKSPACES_SEED);
}
export function saveMockWorkspaces(): void {
  writeSlice(MOCK_WORKSPACES_KEY, mockWorkspaces);
}
export const mockWorkspaces: typeof MOCK_WORKSPACES_SEED = loadMockWorkspaces();

export const workspaceHandlers: Record<string, MockHandler> = {

  // ═══════════════════════════════════════════════════════════════
  // BOOT / SETUP
  // ═══════════════════════════════════════════════════════════════

  'resolve_boot_store': () => ({
    is_bound: true,
    store_id: 'store-1',
    instance_id: 'ws-1',
  }),

  // ═════════════════════════════════════════════════════════
  // WORKSPACES (ADR #4 / #7)
  // ═══════════════════════════════════════════════════════════════

  'list_workspaces': () => mockWorkspaces,
  'list_workspaces_scoped': () => mockWorkspaces,
  'list_workspace_screens': () => [],
  'list_workspace_screens_scoped': () => [],
  'get_workspace_instance_scoped': (args) => {
    const { instanceId } = args as { instanceId: string };
    return mockWorkspaces.find(w => w.instance_id === instanceId) ?? mockWorkspaces[0];
  },
  'create_workspace_instance_scoped': (args) => {
    const req = (args as { req: Record<string, unknown> }).req;
    return { instance_id: `ws-${Date.now()}`, ...req };
  },
  // Renames mutate the stateful workspace list so a reload keeps the new
  // name — same persistence contract as the real workspace_instances row.
  'update_workspace_instance_scoped': (args) => {
    const { instanceId, name } = (args ?? {}) as { instanceId?: string; name?: string };
    const existing = mockWorkspaces.find((w) => w.instance_id === instanceId) ?? mockWorkspaces[0];
    if (existing && name !== undefined) existing.name = name;
    return existing ?? null;
  },
  'delete_workspace_instance_scoped': () => null,
  'archive_workspace_instance_scoped': () => null,
  'set_default_instance_scoped': () => null,
  'list_all_workspaces_scoped': () => [
    { key: 'store-pos', name: 'Store POS', description: 'Point of Sale', icon: 'shopping-cart' },
    { key: 'restaurant-pos', name: 'Restaurant POS', description: 'Table service', icon: 'restaurant' },
    { key: 'kds', name: 'Kitchen Display', description: 'Order display', icon: 'utensils' },
    { key: 'warehouse', name: 'Warehouse', description: 'Product and stock management', icon: 'package' },
    { key: 'admin', name: 'Admin', description: 'Settings & management', icon: 'settings' },
  ],

  // Workspace store listing (multi-store picker)
  'list_workspaces_for_store_scoped': () => [],
};
