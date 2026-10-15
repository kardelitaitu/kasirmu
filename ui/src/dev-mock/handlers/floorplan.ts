/**
 * Dev-mock handlers — floorplan domain.
 *
 * Table, section and floor-plan command surface. Extracted from `tauri-api.ts` by the agent-4 work order
 * (`todo-refactor-devmock-agents-4.md`, phase 4.1); the code is moved
 * verbatim, comments included — only its location changes.
 *
 * This module is self-contained: it needs no injected dependencies and
 * exports a plain map rather than a factory.
 *
 * ⚠️ CORRECTION (2026-10-12): list_tables used to return a FROZEN snapshot while
 * every mutation answered null and changed nothing, so the floor plan could not
 * be edited in the preview at all — and worse, TableManagementScreen
 * dereferences the returned table (updated.id), so a null return threw and
 * surfaced as the generic error banner. The tables now live in a mutable array
 * and every mutation reads back through it. Pinned by
 * __tests__/dev-mock-floorplan-persistence.test.ts.
 */

import type { MockHandler } from '../core/mockDispatcher';

/** Live floor-plan snapshot for the analytics occupancy card: 5 of 12
 *  active tables occupied (2 seated, 1 reserved, 4 free, 1 cleaning). */
type MockTable = {
  id: string; name: string; capacity: number; pos_x: number; pos_y: number;
  shape: string; width: number; height: number; status: string;
  active_sale_id: string | null; section: string; active: boolean;
  sort_order: number;
};

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

// ── Live table state ────────────────────────────────────────────────────
// Mutable, seeded from the snapshot below. In-memory on purpose: this module
// has no writeSlice/readSlice seam, and a reload resetting the floor plan to
// its seed is what a fresh mock session should look like.

/**
 * True when the page was opened with `?plan=empty`.
 *
 * `TableManagementScreen` has TWO empty states on two branches (`:1026`, `:1045`). The filtered one
 * is reachable by emptying a section, which round 246's spec does. The PLAN-empty one needs every
 * table gone — and the seeded plan holds 13 tables of which 6 are occupied, so reaching it through
 * the UI costs ~13 lifecycle operations (release, close panel, delete) and timed out at the twelfth
 * (round 267).
 *
 * That is a seed problem, not a test problem, and this is the seam the dev-mock already uses for
 * exactly that shape — see `system.ts:29-56` for the convention: an explicit per-navigation opt-in,
 * read at CALL time, changing no default, guarded because these handlers also run under jsdom where
 * `window.location.search` is empty.
 *
 * Named `plan=empty` rather than `tables=0` so it reads as a description of the state an operator is
 * in, not as a count a caller has to construct.
 */
function emptyPlanRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('plan') === 'empty';
  } catch {
    return false;
  }
}

const mockTables: MockTable[] = emptyPlanRequested() ? [] : tablesSnapshot();

/** Sections present in the seed, plus any a created table introduces. */
const mockSections: string[] = Array.from(new Set(mockTables.map((t) => t.section)));

/** Unwrap the { args } envelope invoke() may or may not have already stripped. */
function unwrap(args: unknown): Record<string, unknown> {
  return (((args as { args?: unknown })?.args ?? args) ?? {}) as Record<string, unknown>;
}

function findMockTable(args: unknown): MockTable | null {
  const raw = unwrap(args);
  const id = String(raw['id'] ?? raw['tableId'] ?? '');
  return mockTables.find((t) => t.id === id) ?? null;
}

function createMockTable(args: unknown): MockTable | null {
  const raw = unwrap(args);
  // The command takes the table either boxed as `table` (api/tables.ts:41) or
  // flattened; both shapes appear across the call sites.
  const input = (raw['table'] ?? raw) as Partial<MockTable>;
  const id = `table-mock-${Date.now()}`;
  const table: MockTable = {
    id,
    name: input.name ?? 'New Table',
    capacity: input.capacity ?? 4,
    pos_x: input.pos_x ?? 10,
    pos_y: input.pos_y ?? 15,
    shape: input.shape ?? 'circle',
    width: input.width ?? 8,
    height: input.height ?? 8,
    status: input.status ?? 'available',
    active_sale_id: null,
    section: input.section ?? mockSections[0] ?? 'Indoor',
    active: true,
    sort_order: mockTables.length + 1,
  };
  mockTables.push(table);
  if (!mockSections.includes(table.section)) mockSections.push(table.section);
  return { ...table };
}

function applyMockTablePatch(args: unknown): MockTable | null {
  const raw = unwrap(args);
  const input = (raw['table'] ?? raw) as Partial<MockTable>;
  const id = String(raw['id'] ?? input.id ?? '');
  const table = mockTables.find((t) => t.id === id);
  if (!table) return null;
  Object.assign(table, input, { id: table.id });
  if (!mockSections.includes(table.section)) mockSections.push(table.section);
  return { ...table };
}

function deleteMockTable(args: unknown): boolean | null {
  const raw = unwrap(args);
  const id = String(raw['id'] ?? '');
  const idx = mockTables.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  mockTables.splice(idx, 1);
  return true;
}

function patchMockTableStatus(args: unknown): MockTable | null {
  const raw = unwrap(args);
  const id = String(raw['id'] ?? '');
  const status = String(raw['status'] ?? '');
  const table = mockTables.find((t) => t.id === id);
  if (!table) return null;
  table.status = status;
  // A table that is no longer occupied holds no sale.
  if (status !== 'occupied') table.active_sale_id = null;
  return { ...table };
}

function assignMockTableOrder(args: unknown): MockTable | null {
  const raw = unwrap(args);
  const id = String(raw['id'] ?? raw['tableId'] ?? '');
  const table = mockTables.find((t) => t.id === id);
  if (!table) return null;
  table.status = 'occupied';
  table.active_sale_id = String(raw['saleId'] ?? raw['sale_id'] ?? `sale-${table.id}`);
  return { ...table };
}

function releaseMockTable(args: unknown): MockTable | null {
  const raw = unwrap(args);
  const id = String(raw['id'] ?? raw['tableId'] ?? '');
  const table = mockTables.find((t) => t.id === id);
  if (!table) return null;
  // api/tables.ts:81 documents 'cleaning' as the post-release state a busier
  // then turns over to 'available'.
  table.status = 'cleaning';
  table.active_sale_id = null;
  return { ...table };
}

export const floorplanHandlers: Record<string, MockHandler> = {

  // ═══════════════════════════════════════════════════════════════
  // TABLES (restaurant floor plan)
  // ═══════════════════════════════════════════════════════════════

  // Live snapshot: 5 of 12 active tables occupied → ~42% occupancy for
  // the analytics occupancy card in browser mode.
  'list_tables': () => mockTables.map((t) => ({ ...t })),
  'list_tables_scoped': () => mockTables.map((t) => ({ ...t })),
  'get_table': (args) => findMockTable(args),
  'get_table_scoped': (args) => findMockTable(args),
  'create_table': (args) => createMockTable(args),
  'create_table_scoped': (args) => createMockTable(args),
  'update_table': (args) => applyMockTablePatch(args),
  'update_table_scoped': (args) => applyMockTablePatch(args),
  'delete_table': (args) => deleteMockTable(args),
  'delete_table_scoped': (args) => deleteMockTable(args),
  'update_table_status': (args) => patchMockTableStatus(args),
  'update_table_status_scoped': (args) => patchMockTableStatus(args),
  // Assigning an order OCCUPIES the table; releasing puts it into turnover. Both
  // return the table, because the screen patches its list from the return value.
  'assign_table_order': (args) => assignMockTableOrder(args),
  'assign_table_order_scoped': (args) => assignMockTableOrder(args),
  'release_table': (args) => releaseMockTable(args),
  'release_table_scoped': (args) => releaseMockTable(args),
  'list_sections': () => mockSections.slice(),
  'list_sections_scoped': () => mockSections.slice(),
};
