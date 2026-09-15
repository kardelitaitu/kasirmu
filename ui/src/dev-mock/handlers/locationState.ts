/**
 * Dev-mock shared state — location profiles, ticket prefixes, and the
 * `unwrapArgs` envelope helper.
 *
 * Moved verbatim out of `tauri-api.ts` (the block that was :58-158 at the
 * Phase 5.1 baseline) by todo-refactor-devmock-router-consolidation.md
 * Phase 5.1. This is the state the retired `-4:190` called the real blocker:
 * location CRUD, the ticket-prefix pair, and the regional/receipt/workspace
 * read paths all shared one module-private `let mockStores` inside the router
 * file itself. It is no longer module-private to the router — it is module-
 * private HERE, and the router consumes it through these exports until
 * Phases 5.1b-5.4 finish converting the remaining literal entries into
 * factories that receive this state injected (the precedent being
 * createCatalogHandlers / createSalesHandlers / createLocationsHandlers).
 *
 * Behaviour note: the internal `mockStores` reassignments are NOT observable
 * through the accessor by reference — callers get fresh arrays or copies, as
 * before; the accessor exists so no importer depends on ESM live-binding
 * subtleties after the move.
 */
import { MOCK_STORE } from '../core/mockSeedData';
import type { MockHandler } from '../core/mockDispatcher';

/** Unwrap the `{ args }` envelope the API wrappers send, tolerating a
 *  bare payload for direct calls. The real commands take a named `args`
 *  argument, so the envelope is the wire shape. */
export function unwrapArgs<T extends Record<string, unknown> = Record<string, unknown>>(args: unknown): T {
  const boxed = (args ?? {}) as { args?: T };
  return boxed.args ?? ((args as T | undefined) ?? ({} as T));
}

/** Mutable store-profile list backing the mock — renames/creates persist
 *  for the session exactly like the real DB (dev preview parity). */
let mockStores: Array<typeof MOCK_STORE> = [{ ...MOCK_STORE }];

/** Read the current location rows. The regional / receipt / workspace read
 *  paths that outlive this phase consume the list only through this accessor. */
export function getMockStores(): Array<typeof MOCK_STORE> {
  return mockStores;
}

/** List the mutable location-profile rows served by the dev mock. */
export function listMockLocations(): Array<typeof MOCK_STORE> {
  return mockStores.map((location) => ({ ...location }));
}

/** Resolve one location profile using the mock's historical fallback behavior. */
export function getMockLocation(args: unknown): typeof MOCK_STORE {
  const { id } = unwrapArgs<{ id?: string }>(args);
  return mockStores.find((location) => location.id === id) ?? MOCK_STORE;
}

/** Resolve the primary location profile from the mutable mock list. */
export function getMockPrimaryLocation(): typeof MOCK_STORE {
  return mockStores.find((location) => location.is_primary) ?? mockStores[0] ?? MOCK_STORE;
}

/** Create a location profile and persist it in the session-local mock list. */
export function createMockLocation(args: unknown): typeof MOCK_STORE {
  const payload = unwrapArgs<Partial<typeof MOCK_STORE>>(args);
  const created = {
    ...MOCK_STORE,
    ...payload,
    id: (payload.id as string | undefined) ?? `store-${Date.now()}`,
    is_primary: mockStores.length === 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  mockStores.push(created);
  return { ...created };
}

/** Update a location profile and persist it in the session-local mock list. */
export function updateMockLocation(args: unknown): typeof MOCK_STORE {
  const { id, ...rest } = unwrapArgs<Partial<typeof MOCK_STORE> & { id?: string }>(args);
  // id-mismatch falls back to the first profile (mock laxness — the real
  // backend returns an error for unknown ids).
  const existing = mockStores.find((location) => location.id === id) ?? mockStores[0] ?? MOCK_STORE;
  const updated = { ...existing, ...rest, id: existing.id, updated_at: new Date().toISOString() };
  mockStores = mockStores.map((location) => (location.id === updated.id ? updated : location));
  if (!mockStores.some((location) => location.id === updated.id)) mockStores.push(updated);
  return { ...updated };
}

/** Make a location primary and persist the choice in the mock list. */
export function setMockPrimaryLocation(args: unknown): typeof MOCK_STORE {
  const { id } = unwrapArgs<{ id?: string }>(args);
  mockStores = mockStores.map((location) => ({ ...location, is_primary: location.id === id }));
  return { ...getMockLocation({ id }) };
}

/** Delete a location profile from the session-local mock list. */
export function deleteMockLocation(args: unknown): null {
  const { id } = unwrapArgs<{ id?: string }>(args);
  mockStores = mockStores.filter((location) => location.id !== id);
  return null;
}

/**
 * Session-local KDS ticket prefixes, keyed by location id. The mock profile
 * type is deliberately not widened (ui/src/api still exposes no such field);
 * an absent entry means '' — the core's no-prefix sentinel.
 */
const mockTicketPrefixes = new Map<string, string>();

/** Normalize exactly as oz_core's ticket-prefix setter does: trim + upper. */
function normalizeMockTicketPrefix(raw: string | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

/** Read a location's mock ticket prefix; '' resolves to null, as core does. */
export function getMockLocationTicketPrefix(args: unknown): string | null {
  const { id } = unwrapArgs<{ id?: string }>(args);
  return normalizeMockTicketPrefix(mockTicketPrefixes.get(id ?? '')) || null;
}

/**
 * Set a location's mock ticket prefix and echo the normalized value back,
 * mirroring the real command so the UI sees post-normalization text, not
 * what was typed. Unknown ids throw — the real IPC returns NotFound.
 */
export function setMockLocationTicketPrefix(args: unknown): string | null {
  const { id, prefix } = unwrapArgs<{ id?: string; prefix?: string }>(args);
  const key = id ?? '';
  if (!mockStores.some((location) => location.id === key)) {
    throw new Error(`location ${key} not found`);
  }
  const normalized = normalizeMockTicketPrefix(prefix);
  mockTicketPrefixes.set(key, normalized);
  return normalized || null;
}

/**
 * The nine location/prefix commands as `entryHandlers` held them (Phase 5.1
 * conversion, todo-refactor-devmock-router-consolidation.md). Key names and
 * handler identities are unchanged — only the registration site moved out of
 * the router's literal, so the file now registers this state's own commands
 * instead of naming them one by one.
 */
export function createLocationProfileHandlers(): Record<string, MockHandler> {
  return {
    'list_locations_scoped': listMockLocations,
    'get_location_profile_scoped': getMockLocation,
    'get_primary_location_scoped': getMockPrimaryLocation,
    'create_location_profile_scoped': createMockLocation,
    'update_location_profile_scoped': updateMockLocation,
    'set_primary_location_scoped': setMockPrimaryLocation,
    'delete_location_profile_scoped': deleteMockLocation,
    'get_location_ticket_prefix_scoped': getMockLocationTicketPrefix,
    'set_location_ticket_prefix_scoped': setMockLocationTicketPrefix,
  };
}
