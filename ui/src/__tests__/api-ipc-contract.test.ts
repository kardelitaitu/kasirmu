// ── IPC contract tests for the Tauri API layer ─────────────────────
//
// These tests verify the contract between the TypeScript API wrappers
// (ui/src/api/*.ts) and the Rust Tauri commands: the correct command
// name is invoked with the correct argument shape (camelCase keys).
// A mismatch in command name or argument key causes a silent runtime
// failure (undefined arg, command not found) that the type system
// cannot catch.
//
// The `loggedInvoke` wrapper delegates to `@tauri-apps/api/core`'s
// `invoke`, so we mock that and assert the (command, args) pair.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CartId } from '@/types/domain';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

// ── sales.ts ───────────────────────────────────────────────────────

import {
  startSaleScoped,
  addLineScoped,
  completeSaleScoped,
  voidSaleScoped,
  holdCartScoped,
  listSalesScoped,
  getSaleScoped,
  overrideLinePriceScoped,
  finalizeSale,
  voidPendingSale,
  setCartDiscountScoped,
  getProductTrackSerialBatchScoped,
} from '@/api/sales';

describe('sales.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('startSaleScoped invokes "start_sale_scoped" with sessionToken + args', async () => {
    mockInvoke.mockResolvedValue({ cartId: 'cart-1' as CartId });
    await startSaleScoped('tok', { currency: 'IDR' });
    expect(mockInvoke).toHaveBeenCalledWith('start_sale_scoped', {
      sessionToken: 'tok',
      args: { currency: 'IDR' },
    });
  });

  it('addLineScoped invokes "add_line_scoped" with sessionToken + args', async () => {
    mockInvoke.mockResolvedValue({ lineId: 'l1', lineTotal: null });
    await addLineScoped('tok', { cartId: 'c1' as CartId, sku: 'SKU-1', qty: 1, unitPriceMinor: 100 });
    expect(mockInvoke).toHaveBeenCalledWith('add_line_scoped', {
      sessionToken: 'tok',
      args: { cartId: 'c1' as CartId, sku: 'SKU-1', qty: 1, unitPriceMinor: 100 },
    });
  });

  it('completeSaleScoped invokes "complete_sale_scoped" with sessionToken + args', async () => {
    mockInvoke.mockResolvedValue({ saleId: 's1', total: null, lineCount: 1 });
    await completeSaleScoped('tok', {
      cartId: 'c1' as CartId,
      paymentMethod: 'card',
      tenderedMinor: null,
    });
    expect(mockInvoke).toHaveBeenCalledWith('complete_sale_scoped', {
      sessionToken: 'tok',
      args: { cartId: 'c1' as CartId, paymentMethod: 'card', tenderedMinor: null },
    });
  });

  it('voidSaleScoped invokes "void_sale_scoped" with sessionToken + args(saleId, reason)', async () => {
    mockInvoke.mockResolvedValue({ id: 's1' });
    await voidSaleScoped('tok', 'sale-1', 'customer cancel');
    expect(mockInvoke).toHaveBeenCalledWith('void_sale_scoped', {
      sessionToken: 'tok',
      args: { saleId: 'sale-1', reason: 'customer cancel' },
    });
  });

  it('holdCartScoped invokes "hold_cart_scoped" with sessionToken + args', async () => {
    mockInvoke.mockResolvedValue({ id: 'held-1' });
    await holdCartScoped('tok', {
      label: 'Order #5',
      cart_data: '{}',
      item_count: 2,
      total_minor: 1500, currency: 'USD',
    });
    expect(mockInvoke).toHaveBeenCalledWith('hold_cart_scoped', {
      sessionToken: 'tok',
      args: {
        label: 'Order #5',
        cart_data: '{}',
        item_count: 2,
        total_minor: 1500, currency: 'USD',
      },
    });
  });

  it('listSalesScoped invokes "list_sales_scoped" with sessionToken', async () => {
    mockInvoke.mockResolvedValue([]);
    await listSalesScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_sales_scoped', {
      sessionToken: 'tok',
    });
  });

  it('getSaleScoped invokes "get_sale_scoped" with sessionToken + id', async () => {
    mockInvoke.mockResolvedValue(null);
    await getSaleScoped('tok', 'sale-42');
    expect(mockInvoke).toHaveBeenCalledWith('get_sale_scoped', {
      sessionToken: 'tok',
      id: 'sale-42',
    });
  });

  it('overrideLinePriceScoped invokes "override_line_price_scoped" with args(cartId, lineId, newPriceMinor)', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await overrideLinePriceScoped('tok', 'c1', 'l1', 750);
    expect(mockInvoke).toHaveBeenCalledWith('override_line_price_scoped', {
      sessionToken: 'tok',
      args: { cartId: 'c1' as CartId, lineId: 'l1', newPriceMinor: 750 },
    });
  });

  it('finalizeSale invokes "finalize_sale" with sessionToken + saleId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await finalizeSale('tok', 'sale-1');
    expect(mockInvoke).toHaveBeenCalledWith('finalize_sale', {
      sessionToken: 'tok',
      saleId: 'sale-1',
    });
  });

  it('voidPendingSale invokes "void_pending_sale" with sessionToken + saleId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await voidPendingSale('tok', 'sale-pending');
    expect(mockInvoke).toHaveBeenCalledWith('void_pending_sale', {
      sessionToken: 'tok',
      saleId: 'sale-pending',
    });
  });

  it('setCartDiscountScoped invokes "set_cart_discount_scoped" with sessionToken + args', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await setCartDiscountScoped('tok', {
      cartId: 'c1' as CartId,
      percent: 10,
      label: 'Senior',
    });
    expect(mockInvoke).toHaveBeenCalledWith('set_cart_discount_scoped', {
      sessionToken: 'tok',
      args: { cartId: 'c1' as CartId, percent: 10, label: 'Senior' },
    });
  });

  // Moved off the unscoped `getProductTrackSerialBatch` on 2026-09-16 (T25) rather than
  // deleted with it, because it was the ONLY wire-shape pin on either form of this call and it
  // carries the load-bearing detail: the response rows are snake_case (`track_serial`), not the
  // camelCase the DTO name suggests -- `SerialTrackRow` declares the wire spelling, so a
  // "helpful" rename here would silently read `undefined` for every SKU and the cart would
  // treat every tracked product as untracked. The door graded is now the one the retail cart
  // actually invokes (RetailPosScreen.tsx:191).
  it('getProductTrackSerialBatchScoped invokes "get_product_track_serial_batch_scoped" with sessionToken + skus (PERF-03)', async () => {
    mockInvoke.mockResolvedValue([
      { sku: 'TRACKED', track_serial: true },
      { sku: 'PLAIN', track_serial: false },
    ]);
    const rows = await getProductTrackSerialBatchScoped('tok', ['TRACKED', 'PLAIN']);
    expect(mockInvoke).toHaveBeenCalledWith('get_product_track_serial_batch_scoped', {
      sessionToken: 'tok',
      skus: ['TRACKED', 'PLAIN'],
    });
    expect(rows).toEqual([
      { sku: 'TRACKED', track_serial: true },
      { sku: 'PLAIN', track_serial: false },
    ]);
  });

  it('propagates errors from the backend (does not swallow)', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('DB locked'));
    await expect(startSaleScoped('tok', { currency: 'USD' })).rejects.toThrow('DB locked');
  });
});

// ── topology.ts ───────────────────────────────────────────────────

import {
  loadTopology,
  applyTopologyDiff,
  canSaveTopology,
  saveTopologyTemplate,
  loadTopologyTemplate,
  listTopologyTemplates,
  deleteTopologyTemplate,
} from '@/api/topology';

describe('topology.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('loadTopology invokes "load_topology" with the session only', async () => {
    mockInvoke.mockResolvedValue(null);
    await loadTopology('tok');
    // R1 (2026-09-16): sessioned read; no branch means the session's scope.
    expect(mockInvoke).toHaveBeenCalledWith('load_topology', {
      sessionToken: 'tok',
      branchId: undefined,
    });
  });

  it('loadTopology invokes "load_topology" with a session and a branch id', async () => {
    mockInvoke.mockResolvedValue(null);
    await loadTopology('tok', 'branch-a');
    expect(mockInvoke).toHaveBeenCalledWith('load_topology', {
      sessionToken: 'tok',
      branchId: 'branch-a',
    });
  });

  it('applyTopologyDiff invokes "apply_topology_diff" with full diff payload', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const nodes = [{ id: 'n1', type: 'store', name: 'S', x: 0, y: 0 }];
    const wires = [{ id: 'w1', from_node_id: 'n1', to_node_id: 'n2', direction: 'one-way' }];
    const creations = [{ id: 'ws-1', type_key: 'restaurant-pos', store_id: 's1', name: 'POS' }];
    const updates = [{ id: 'ws-2', name: 'Renamed' }];
    const archives = ['ws-old'];
    await applyTopologyDiff('tok', creations, updates, archives, nodes, wires, undefined, 7, '00000000-0000-4000-8000-000000000001');
    expect(mockInvoke).toHaveBeenCalledWith('apply_topology_diff', {
      sessionToken: 'tok',
      workspaceCreations: creations,
      workspaceUpdates: updates,
      workspaceArchives: archives,
      diagramNodes: nodes,
      diagramWires: wires,
      baseRevision: 7,
      requestId: '00000000-0000-4000-8000-000000000001',
      resolvedIssueKeys: [],
    });
  });

  it('applyTopologyDiff persists branch-scoped resolved issue keys', async () => {
    mockInvoke.mockResolvedValue({ revision: 8 });
    await applyTopologyDiff(
      'tok', [], [], [], [], [], 'branch-a', 7, '00000000-0000-4000-8000-000000000003',
      ['node:wh-1:topology-validation-warehouse-missing-stock-routing'],
    );
    expect(mockInvoke).toHaveBeenCalledWith('apply_topology_diff', expect.objectContaining({
      resolvedIssueKeys: ['node:wh-1:topology-validation-warehouse-missing-stock-routing'],
    }));
  });

  it('applyTopologyDiff sends changeNote only when the merchant wrote one', async () => {
    // ADR #46 §6: the note is the commit-message equivalent, so it must reach
    // the backend — and it must be ABSENT rather than `changeNote: undefined`
    // when unwritten, which is what the exact-payload assertions above rely on.
    mockInvoke.mockResolvedValue({ revision: 9 });
    await applyTopologyDiff(
      'tok', [], [], [], [], [], 'branch-a', 8, '00000000-0000-4000-8000-000000000004',
      [], 'opened the second register',
    );
    expect(mockInvoke).toHaveBeenCalledWith('apply_topology_diff', expect.objectContaining({
      changeNote: 'opened the second register',
    }));

    await applyTopologyDiff(
      'tok', [], [], [], [], [], 'branch-a', 9, '00000000-0000-4000-8000-000000000005',
    );
    const payload = mockInvoke.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect('changeNote' in payload).toBe(false);
  });

  it('applyTopologyDiff includes the active branch id and revision controls', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await applyTopologyDiff('tok', [], [], [], [], [], 'branch-a', 3, '00000000-0000-4000-8000-000000000002');
    expect(mockInvoke).toHaveBeenCalledWith('apply_topology_diff', {
      sessionToken: 'tok',
      workspaceCreations: [],
      workspaceUpdates: [],
      workspaceArchives: [],
      diagramNodes: [],
      diagramWires: [],
      branchId: 'branch-a',
      baseRevision: 3,
      requestId: '00000000-0000-4000-8000-000000000002',
      resolvedIssueKeys: [],
    });
  });

  it('canSaveTopology invokes the backend capability probe', async () => {
    mockInvoke.mockResolvedValue(true);
    await expect(canSaveTopology('tok')).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('can_save_topology', { sessionToken: 'tok' });
  });

  it('loadTopology returns null when no topology saved', async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await loadTopology('tok');
    expect(result).toBeNull();
  });

  // ── Diagram templates (ADR #45 §4.2) ──────────────────────────────
  //
  // The backend resolves a MISSING branchId to the unscoped legacy key and a
  // PRESENT one to a branch-scoped key. Sending `branchId: undefined` is not the
  // same as omitting it across the IPC boundary, so these pin the shaping rule
  // rather than trusting it: a template saved for one branch must never land in
  // every branch's list.

  it('saveTopologyTemplate omits branchId entirely when the caller has no branch', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await saveTopologyTemplate('tok', 'Opening', { nodes: [], wires: [] });
    const args = mockInvoke.mock.calls[0]![1] as Record<string, unknown>;
    expect(mockInvoke.mock.calls[0]![0]).toBe('save_topology_template');
    expect('branchId' in args).toBe(false);
    expect(args).toEqual({ sessionToken: 'tok', name: 'Opening', payload: { nodes: [], wires: [] } });
  });

  it('saveTopologyTemplate scopes to the branch when one is given', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await saveTopologyTemplate('tok', 'Opening', { nodes: [] }, 'branch-a');
    expect(mockInvoke).toHaveBeenCalledWith('save_topology_template', {
      sessionToken: 'tok',
      name: 'Opening',
      payload: { nodes: [] },
      branchId: 'branch-a',
    });
  });

  it('listTopologyTemplates returns the backend order untouched', async () => {
    // Sorting is the backend's job (case-insensitive, stable). Re-sorting here
    // would silently disagree with the persisted order for non-ASCII names.
    mockInvoke.mockResolvedValue(['Alpha', 'café', 'mike']);
    await expect(listTopologyTemplates('tok', 'branch-a')).resolves.toEqual(['Alpha', 'café', 'mike']);
    expect(mockInvoke).toHaveBeenCalledWith('list_topology_templates', {
      sessionToken: 'tok',
      branchId: 'branch-a',
    });
  });

  it('listTopologyTemplates omits branchId when unscoped', async () => {
    mockInvoke.mockResolvedValue([]);
    await listTopologyTemplates('tok');
    const args = mockInvoke.mock.calls[0]![1] as Record<string, unknown>;
    expect('branchId' in args).toBe(false);
  });

  it('loadTopologyTemplate passes the name through without trimming', async () => {
    // Trimming is a backend rule (normalize_template_name). Trimming here too
    // would mean two definitions of "the same" template name.
    mockInvoke.mockResolvedValue({ nodes: [] });
    await loadTopologyTemplate('tok', '  Opening  ', 'branch-a');
    expect(mockInvoke).toHaveBeenCalledWith('load_topology_template', {
      sessionToken: 'tok',
      name: '  Opening  ',
      branchId: 'branch-a',
    });
  });

  it('deleteTopologyTemplate reports whether anything was deleted', async () => {
    mockInvoke.mockResolvedValue(false);
    await expect(deleteTopologyTemplate('tok', 'Gone', 'branch-a')).resolves.toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('delete_topology_template', {
      sessionToken: 'tok',
      name: 'Gone',
      branchId: 'branch-a',
    });
  });

});

// ── settings.ts ───────────────────────────────────────────────────

import {
  getHardwareSettings,
  setHardwareSettings,
  getEnabledFeatures,
  completeSetup,
  dismissSetupWizard,
  getSetupStatus,
} from '@/api/settings';

describe('settings.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('getHardwareSettings invokes "get_hardware_settings" with no args', async () => {
    mockInvoke.mockResolvedValue({
      printerConnection: 'auto',
      printerDevicePath: '',
      printerPaperSize: '80',
      scannerDeviceId: '',
      scannerInputMode: 'auto',
      scaleConnection: 'none',
      scaleDevicePath: '',
      scaleBaudRate: 9600,
      scaleZeroOnBoot: false,
      kitchenPrinterConnection: 'disabled',
      kitchenPrinterDevicePath: '',
      schemaVersion: 1,
      soundVolume: 80,
      darkMode: false,
      scaleAutoZero: true,
    });
    await getHardwareSettings();
    expect(mockInvoke).toHaveBeenCalledWith('get_hardware_settings', undefined);
  });

  it('setHardwareSettings invokes "set_hardware_settings" with args + userId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const args = {
      printerConnection: 'usb',
      printerDevicePath: '/dev/usb0',
      printerPaperSize: '58',
      scannerDeviceId: 'scanner-1',
      scannerInputMode: 'keyboard',
      scaleConnection: 'serial',
      scaleDevicePath: 'COM3',
      scaleBaudRate: 115200,
      scaleZeroOnBoot: true,
      kitchenPrinterConnection: 'disabled',
      kitchenPrinterDevicePath: '',
      schemaVersion: 1,
      soundVolume: 60,
      darkMode: true,
      scaleAutoZero: false,
    };
    await setHardwareSettings(args, 'u1');
    expect(mockInvoke).toHaveBeenCalledWith('set_hardware_settings', { args, userId: 'u1' });
  });

  it('getEnabledFeatures invokes "get_enabled_features" with no args', async () => {
    mockInvoke.mockResolvedValue({ features: {} });
    await getEnabledFeatures();
    expect(mockInvoke).toHaveBeenCalledWith('get_enabled_features', undefined);
  });

  it('completeSetup invokes "complete_setup" with args', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const args = { preset: 'retail', features: ['cloud_sync'], default_currency: 'USD' };
    await completeSetup(args);
    expect(mockInvoke).toHaveBeenCalledWith('complete_setup', { args });
  });

  it('dismissSetupWizard invokes "dismiss_setup_wizard" with no args', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await dismissSetupWizard();
    expect(mockInvoke).toHaveBeenCalledWith('dismiss_setup_wizard', undefined);
  });

  it('getSetupStatus invokes "get_setup_status" with no args', async () => {
    mockInvoke.mockResolvedValue({ completed: true });
    await getSetupStatus();
    expect(mockInvoke).toHaveBeenCalledWith('get_setup_status', undefined);
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('permission denied'));
    await expect(getHardwareSettings()).rejects.toThrow('permission denied');
  });
});

// ── products.ts ───────────────────────────────────────────────────

import {
  listProducts,
  adjustStock,
} from '@/api/products';

describe('products.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('listProducts invokes "list_products" with no args', async () => {
    mockInvoke.mockResolvedValue([]);
    await listProducts();
    expect(mockInvoke).toHaveBeenCalledWith('list_products', undefined);
  });




  it('adjustStock invokes "adjust_stock" with AdjustStockArgs(sku, delta, reason)', async () => {
    mockInvoke.mockResolvedValue(20);
    await adjustStock({ sku: 'SKU-1', delta: 10, reason: 'restock' });
    expect(mockInvoke).toHaveBeenCalledWith('adjust_stock', {
      args: { sku: 'SKU-1', delta: 10, reason: 'restock' },
    });
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('not found'));
    await expect(adjustStock({ sku: 'SKU-1', delta: 10, reason: 'restock' })).rejects.toThrow('not found');
  });
});

// ── workspaces.ts ─────────────────────────────────────────────────

import {
  listWorkspacesScoped,
  listWorkspaces,
  listWorkspacesForStoreScoped,
  listWorkspaceScreens,
  createWorkspaceInstanceScoped,
  updateWorkspaceInstanceScoped,
  archiveWorkspaceInstanceScoped,
  suspendSurplusWorkspaceInstancesScoped,
  recoverWorkspaceInstancesScoped,
} from '@/api/workspaces';
import { impersonateUserScoped } from '@/api/staff';

describe('workspaces.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('listWorkspacesScoped invokes "list_workspaces_scoped" with sessionToken', async () => {
    mockInvoke.mockResolvedValue([]);
    await listWorkspacesScoped('tok');
    expect(mockInvoke).toHaveBeenCalledWith('list_workspaces_scoped', { sessionToken: 'tok' });
  });

  it('listWorkspaces binds the picker ticket server-side (audit-open-findings)', async () => {
    mockInvoke.mockResolvedValue([]);
    await listWorkspaces('ticket-abc', 'store-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_workspaces', {
      ticket: 'ticket-abc',
      storeId: 'store-1',
    });
  });

  it('listWorkspacesForStoreScoped invokes "list_workspaces_for_store_scoped" with sessionToken + storeId', async () => {
    mockInvoke.mockResolvedValue([]);
    await listWorkspacesForStoreScoped('tok', 'store-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_workspaces_for_store_scoped', {
      sessionToken: 'tok',
      storeId: 'store-1',
    });
  });

  it('listWorkspaceScreens routes pre-session reads with ticket + typeKey + storeId (audit-open-findings)', async () => {
    mockInvoke.mockResolvedValue([]);
    await listWorkspaceScreens('ticket-abc', 'restaurant-pos', 'store-1');
    expect(mockInvoke).toHaveBeenCalledWith('list_workspace_screens', {
      ticket: 'ticket-abc',
      typeKey: 'restaurant-pos',
      storeId: 'store-1',
    });
  });

  it('createWorkspaceInstanceScoped invokes "create_workspace_instance_scoped" with sessionToken + req', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await createWorkspaceInstanceScoped('tok', {
      id: 'ws-1',
      type_key: 'restaurant-pos',
      store_id: 's1',
      name: 'POS 1',
    });
    expect(mockInvoke).toHaveBeenCalledWith('create_workspace_instance_scoped', {
      sessionToken: 'tok',
      req: { id: 'ws-1', type_key: 'restaurant-pos', store_id: 's1', name: 'POS 1' },
    });
  });

  it('updateWorkspaceInstanceScoped invokes "update_workspace_instance_scoped" with sessionToken + instanceId + spread fields', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await updateWorkspaceInstanceScoped('tok', 'ws-1', { name: 'Renamed' });
    expect(mockInvoke).toHaveBeenCalledWith('update_workspace_instance_scoped', {
      sessionToken: 'tok',
      instanceId: 'ws-1',
      name: 'Renamed',
      description: null,
      colour: null,
    });
  });

  it('archiveWorkspaceInstanceScoped invokes "archive_workspace_instance_scoped" with sessionToken + instanceId', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await archiveWorkspaceInstanceScoped('tok', 'ws-old');
    expect(mockInvoke).toHaveBeenCalledWith('archive_workspace_instance_scoped', {
      sessionToken: 'tok',
      instanceId: 'ws-old',
    });
  });

  // §J B1. The command signatures take Option<String> store_id, and the api
  // layer always sends the key (null when unspecified) rather than dropping it.
  // Pinned both ways because "omitted" and "null" are different payloads and
  // Tauri only accepts one of them as None — a call site that stops sending the
  // key would still typecheck.
  it('suspendSurplusWorkspaceInstancesScoped invokes "suspend_surplus_workspace_instances_scoped" with an explicit store', async () => {
    mockInvoke.mockResolvedValue(3);
    const n = await suspendSurplusWorkspaceInstancesScoped('tok', 'store-2');
    expect(n).toBe(3);
    expect(mockInvoke).toHaveBeenCalledWith('suspend_surplus_workspace_instances_scoped', {
      sessionToken: 'tok',
      storeId: 'store-2',
    });
  });

  it('suspendSurplusWorkspaceInstancesScoped sends storeId: null when the store is omitted', async () => {
    mockInvoke.mockResolvedValue(0);
    const n = await suspendSurplusWorkspaceInstancesScoped('tok');
    expect(n).toBe(0);
    expect(mockInvoke).toHaveBeenCalledWith('suspend_surplus_workspace_instances_scoped', {
      sessionToken: 'tok',
      storeId: null,
    });
  });

  it('recoverWorkspaceInstancesScoped invokes "recover_workspace_instances_scoped" and returns the restored count', async () => {
    mockInvoke.mockResolvedValue(2);
    const n = await recoverWorkspaceInstancesScoped('tok', 'store-1');
    expect(n).toBe(2);
    expect(mockInvoke).toHaveBeenCalledWith('recover_workspace_instances_scoped', {
      sessionToken: 'tok',
      storeId: 'store-1',
    });
  });

  it('both remediation commands propagate backend errors instead of swallowing them', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('unknown store: nope'));
    await expect(suspendSurplusWorkspaceInstancesScoped('tok', 'nope')).rejects.toThrow('unknown store');
    mockInvoke.mockRejectedValueOnce(new Error('not registered'));
    await expect(recoverWorkspaceInstancesScoped('tok')).rejects.toThrow('not registered');
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('conflict'));
    await expect(listWorkspacesScoped('tok')).rejects.toThrow('conflict');
  });
});

describe('staff.ts IPC contract', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('impersonateUserScoped invokes "impersonate_user_scoped" with sessionToken + targetUserId', async () => {
    mockInvoke.mockResolvedValue({
      session_token: 'tok-imp',
      context: {
        userId: 'u1',
        roleId: 'role-owner',
        storeId: 'store-1',
        instanceId: 'inst-1',
        typeKey: 'organization',
        terminalId: 'term-1',
      },
    });
    const res = await impersonateUserScoped('tok', 'u1');
    expect(mockInvoke).toHaveBeenCalledWith('impersonate_user_scoped', {
      sessionToken: 'tok',
      targetUserId: 'u1',
    });
    expect(res.session_token).toBe('tok-imp');
  });

  it('propagates backend errors', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('denied'));
    await expect(impersonateUserScoped('tok', 'u1')).rejects.toThrow('denied');
  });
});
