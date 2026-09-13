/**
 * Dev-mock handlers — floorplan domain.
 *
 * Table, section and floor-plan command surface. Extracted from `tauri-api.ts` by the agent-4 work order
 * (`todo-refactor-devmock-agents-4.md`, phase 4.1); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * This module is self-contained: it needs no injected dependencies and
 * exports a plain map rather than a factory.
 */

import type { MockHandler } from '../core/mockDispatcher';

/** Live floor-plan snapshot for the analytics occupancy card: 5 of 12
 *  active tables occupied (2 seated, 1 reserved, 4 free, 1 cleaning). */
function tablesSnapshot(): Array<{
  id: string; name: string; capacity: number; pos_x: number; pos_y: number;
  shape: string; width: number; height: number; status: string;
  active_sale_id: string | null; section: string; active: boolean;
  sort_order: number;
}> {
  const statuses = [
    'occupied', 'occupied', 'occupied', 'occupied', 'occupied',
    'available', 'available', 'available', 'available',
    'reserved', 'cleaning', 'available',
  ];
  return statuses.map((status, i) => ({
    id: `table-${String(i + 1).padStart(2, '0')}`,
    name: `Table ${i + 1}`,
    capacity: i % 3 === 0 ? 6 : 4,
    pos_x: 10 + (i % 4) * 22,
    pos_y: 15 + Math.floor(i / 4) * 30,
    shape: 'circle',
    width: 8,
    height: 8,
    status,
    active_sale_id: status === 'occupied' ? `sale-table-${i + 1}` : null,
    section: i < 6 ? 'Indoor' : 'Patio',
    active: true,
    sort_order: i + 1,
  }));
}

export const floorplanHandlers: Record<string, MockHandler> = {

  // ═══════════════════════════════════════════════════════════════
  // TABLES (restaurant floor plan)
  // ═══════════════════════════════════════════════════════════════

  // Live snapshot: 5 of 12 active tables occupied → ~42% occupancy for
  // the analytics occupancy card in browser mode.
  'list_tables': () => tablesSnapshot(),
  'list_tables_scoped': () => tablesSnapshot(),
  'get_table': () => null,
  'get_table_scoped': () => null,
  'create_table': () => null,
  'create_table_scoped': () => null,
  'update_table': () => null,
  'update_table_scoped': () => null,
  'delete_table': () => null,
  'delete_table_scoped': () => null,
  'update_table_status': () => null,
  'update_table_status_scoped': () => null,
  'assign_table_order': () => null,
  'assign_table_order_scoped': () => null,
  'release_table': () => null,
  'release_table_scoped': () => null,
  'list_sections': () => [],
  'list_sections_scoped': () => [],
};
