import { loggedInvoke } from '@/utils/logged-invoke';

/** A table in the floor plan with position, capacity, and status. */
export interface Table {
  id: string;
  name: string;
  capacity: number;
  pos_x: number;
  pos_y: number;
  shape: string;
  width: number;
  height: number;
  status: string;
  active_sale_id: string | null;
  section: string;
  active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

/** List all tables, optionally filtered by section (session-scoped — ADR #7). */
export const listTables = (sessionToken: string, section?: string) =>
  loggedInvoke<Table[]>('list_tables_scoped', { sessionToken, section: section ?? null });

/** List tables (scoped — ADR #7). */
export const listTablesScoped = (sessionToken: string, section?: string) =>
  loggedInvoke<Table[]>('list_tables_scoped', { sessionToken, section: section ?? null });

/** Get a single table by its identifier (session-scoped — ADR #7). */
export const getTable = (sessionToken: string, id: string) =>
  loggedInvoke<Table | null>('get_table_scoped', { sessionToken, id });

/** Get a table (scoped — ADR #7). */
export const getTableScoped = (sessionToken: string, id: string) =>
  loggedInvoke<Table | null>('get_table_scoped', { sessionToken, id });

/** Create a new table in the floor plan (session-scoped — ADR #7). */
export const createTable = (sessionToken: string, table: Table) =>
  loggedInvoke<Table>('create_table_scoped', { sessionToken, table });

/** Create a table (scoped — ADR #7). */
export const createTableScoped = (sessionToken: string, table: Table) =>
  loggedInvoke<Table>('create_table_scoped', { sessionToken, table });

/** Update an existing table (session-scoped — ADR #7). */
export const updateTable = (sessionToken: string, table: Table) =>
  loggedInvoke<Table>('update_table_scoped', { sessionToken, table });

/** Update a table (scoped — ADR #7). */
export const updateTableScoped = (sessionToken: string, table: Table) =>
  loggedInvoke<Table>('update_table_scoped', { sessionToken, table });

/** Delete a table from the floor plan (session-scoped — ADR #7). */
export const deleteTable = (sessionToken: string, id: string) =>
  loggedInvoke<void>('delete_table_scoped', { sessionToken, id });

/** Delete a table (scoped — ADR #7). */
export const deleteTableScoped = (sessionToken: string, id: string) =>
  loggedInvoke<void>('delete_table_scoped', { sessionToken, id });

/** Update a table's status (e.g. free, occupied, reserved) (session-scoped — ADR #7). */
export const updateTableStatus = (sessionToken: string, id: string, status: string) =>
  loggedInvoke<Table>('update_table_status_scoped', { sessionToken, id, status });

/** Update table status (scoped — ADR #7). */
export const updateTableStatusScoped = (sessionToken: string, id: string, status: string) =>
  loggedInvoke<Table>('update_table_status_scoped', { sessionToken, id, status });

/** Assign an active sale (order) to a table (session-scoped — ADR #7). */
export const assignTableOrder = (sessionToken: string, tableId: string, saleId: string) =>
  loggedInvoke<Table>('assign_table_order_scoped', { sessionToken, tableId, saleId });

/** Assign order to table (scoped — ADR #7). */
export const assignTableOrderScoped = (sessionToken: string, tableId: string, saleId: string) =>
  loggedInvoke<Table>('assign_table_order_scoped', { sessionToken, tableId, saleId });

/** Release a table, clearing its active order assignment (session-scoped — ADR #7). */
export const releaseTable = (sessionToken: string, tableId: string) =>
  loggedInvoke<Table>('release_table_scoped', { sessionToken, tableId });

/** Release a table (scoped — ADR #7). */
export const releaseTableScoped = (sessionToken: string, tableId: string) =>
  loggedInvoke<Table>('release_table_scoped', { sessionToken, tableId });

/** List all table sections (session-scoped — ADR #7). */
export const listSections = (sessionToken: string) =>
  loggedInvoke<string[]>('list_sections_scoped', { sessionToken });

/** List sections (scoped — ADR #7). */
export const listSectionsScoped = (sessionToken: string) =>
  loggedInvoke<string[]>('list_sections_scoped', { sessionToken });
