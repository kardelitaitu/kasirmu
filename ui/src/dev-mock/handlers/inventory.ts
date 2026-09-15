/**
 * Dev-mock handlers — inventory domain.
 *
 * Stock adjustments, inventory locations, stock alerts, inventory shifts,
 * stock thresholds, stock counts and stock transfers. Extracted from
 * `tauri-api.ts` by the agent-2 work order
 * (`todo-refactor-devmock-agents-2.md`, phase 2.2); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * This module is self-contained: its handlers read one seed fixture and
 * nothing else, so it needs no injected dependencies and exports a plain
 * map rather than a factory.
 *
 * The work order also names `list_stock_levels` for this phase. No such
 * command exists in the mock — the real stock surface is `adjust_stock`,
 * `get_product_stock` (catalog, phase 2.1) and the stock-count/transfer
 * commands below, which is what moved.
 */

import type { MockHandler } from '../core/mockDispatcher';
import { MOCK_INVENTORY_LOCATIONS } from '../core/mockSeedData';

export const inventoryHandlers: Record<string, MockHandler> = {
  'adjust_stock': () => 50,
  'adjust_stock_scoped': () => 50,


  // ═══════════════════════════════════════════════════════════════
  // INVENTORY
  // ═══════════════════════════════════════════════════════════════

  'create_inventory_location': () => 'loc-new',
  'list_inventory_locations': () => MOCK_INVENTORY_LOCATIONS,
  'update_inventory_location': () => null,
  'deactivate_inventory_location': () => null,

  'set_workspace_inventory_locations': () => null,
  'get_workspace_inventory_locations': () => [],
  'get_workspace_locations_scoped': () => [],
  'invalidate_location_cache_scoped': () => null,
  'get_low_stock_alerts_at_location_scoped': () => [],
  'active_stock_alerts_scoped': () => [],
  'acknowledge_stock_alert_scoped': () => null,

  'start_inventory_shift': () => ({
    id: 'inv-shift-1', user_id: 'user-1', location_id: 'loc-1', terminal_id: null,
    started_at: new Date().toISOString(), ended_at: null, status: 'active', notes: '',
  }),
  'end_inventory_shift': () => null,
  'get_active_inventory_shift': () => null,
  'list_inventory_shifts': () => [],

  'create_inventory_transaction': () => 'txn-new',
  'list_inventory_transactions': () => [],
  'list_inventory_transactions_for_shift': () => [],
  'get_inventory_transaction': () => null,

  'set_stock_threshold': () => null,
  'get_stock_thresholds': () => [],
  'delete_stock_threshold': () => null,


  // ═══════════════════════════════════════════════════════════════
  // INVENTORY COUNTS
  // ═══════════════════════════════════════════════════════════════

  'create_stock_count': () => ({ id: 'count-1', count_number: 'SC-001', status: 'draft', count_type: 'full', notes: '', counted_by: null, created_at: new Date().toISOString(), completed_at: null, updated_at: new Date().toISOString() }),
  'get_stock_count': () => null,
  'list_stock_counts': () => [],
  'get_count_lines': () => [],
  'add_count_line': () => null,
  'update_count_line': () => null,
  'remove_count_line': () => null,
  'complete_stock_count': () => [],
  'update_stock_count_status': () => null,
  'list_stock_adjustments': () => [
    { id: 'adj-1', sku: 'CPU-R7-7800X3D', product_name: 'AMD Ryzen 7 7800X3D', qty_change: 5, reason: 'restock', created_at: new Date().toISOString() },
  ],
  'list_stock_adjustments_scoped': () => [
    { id: 'adj-1', sku: 'CPU-R7-7800X3D', product_name: 'AMD Ryzen 7 7800X3D', qty_change: 5, reason: 'restock', created_at: new Date().toISOString() },
  ],

  // ═══════════════════════════════════════════════════════════════
  // STOCK TRANSFERS
  // ═══════════════════════════════════════════════════════════════

  'create_stock_transfer_scoped': () => ({
    id: `mock-trf-${Date.now()}`,
    transfer_number: `TRF-${Date.now().toString(36).toUpperCase()}`,
    status: 'draft',
    source_location: 'Warehouse A',
    destination_location: 'Store B',
    source_terminal_id: null,
    destination_terminal_id: null,
    notes: '',
    created_by: 'admin-1',
    received_by: null,
    created_at: new Date().toISOString(),
    sent_at: null,
    received_at: null,
    updated_at: new Date().toISOString(),
  }),
  'get_stock_transfer_scoped': () => null,
  'list_stock_transfers_scoped': () => [
    { id: 'st-1', transfer_number: 'ST-001', status: 'draft', source_location: 'Warehouse A', destination_location: 'Store B', source_terminal_id: null, destination_terminal_id: null, notes: '', created_by: 'admin-1', received_by: null, created_at: new Date().toISOString(), sent_at: null, received_at: null, updated_at: new Date().toISOString() },
  ],
  'get_stock_transfer_lines_scoped': () => [],
  'add_stock_transfer_line_scoped': () => null,
  'remove_stock_transfer_line_scoped': () => null,
  'send_stock_transfer_scoped': () => null,
  'receive_stock_transfer_scoped': () => null,
  'cancel_stock_transfer_scoped': () => null,
  // In-transit transfers — a stock-transfer read, so it lives with the transfer
  // commands above (not residue). Moved verbatim from `tauri-api.ts`
  // (Phase 5.5); single-defined (git grep). `() => []` matches the sibling
  // transfer stubs — the mock models no in-transit rows, so the list is empty.
  'list_in_transit_transfers_scoped': () => [],

  // Low-stock alerts — moved verbatim from `tauri-api.ts`'s entryHandlers
  // literal (Phase 5.5): a pure self-contained fixture array, single-defined
  // (git grep; the only other match was a prose note in sync.ts), so folding it
  // into this inventory map is a pure copy. Its natural home: it reports product
  // stock-vs-threshold, the same surface as the transfer/adjust commands above.
  'get_low_stock_alerts': () => [
    { product_id: 'RAM-D4-16GB-KF', sku: 'RAM-D4-16GB-KF', name: 'Kingston Fury Beast 16GB DDR4 3200', current_qty: 3, threshold: 10, currency: 'IDR', price_minor: 450000, cost_minor: 390000 },
    { product_id: 'MB-B650-ROG', sku: 'MB-B650-ROG', name: 'ASUS ROG Strix B650-A Gaming WiFi', current_qty: 5, threshold: 10, currency: 'IDR', price_minor: 2850000, cost_minor: 2500000 },
    { product_id: 'SSD-NV2-1TB', sku: 'SSD-NV2-1TB', name: 'Kingston NV2 1TB NVMe SSD', current_qty: 4, threshold: 8, currency: 'IDR', price_minor: 950000, cost_minor: 820000 },
    { product_id: 'PSU-RM750', sku: 'PSU-RM750', name: 'Corsair RM750e 80+ Gold PSU', current_qty: 6, threshold: 10, currency: 'IDR', price_minor: 1850000, cost_minor: 1650000 },
    { product_id: 'GPU-RTX4070', sku: 'GPU-RTX4070', name: 'MSI RTX 4070 Ventus 2X', current_qty: 2, threshold: 5, currency: 'IDR', price_minor: 8900000, cost_minor: 8100000 },
    { product_id: 'CPU-7800X3D', sku: 'CPU-7800X3D', name: 'AMD Ryzen 7 7800X3D', current_qty: 8, threshold: 10, currency: 'IDR', price_minor: 5400000, cost_minor: 4900000 },
  ],
};
