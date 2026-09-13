/**
 * Dev-mock database — the persisted-slice registry.
 *
 * The browser preview keeps its state in Web Storage so that a reload behaves
 * like restarting the real client against a store DB: a cart in progress, an
 * open shift, a workspace created from the topology editor, and an active
 * lockout all survive. This module owns the two things that make that work:
 * the key literals, and the seed-fallback read that every slice uses.
 *
 * WHY THE KEYS ARE STANDALONE CONSTANTS
 *
 * `ui/src/__tests__/storageKeyPins.test.ts` walks production source looking for
 * `const <NAME>_KEY = '<literal>'` declarations and pins each literal to the
 * module that declares it, so that renaming a key is a deliberate edit with a
 * decision attached about the data already on disk. Two consequences follow and
 * both are load-bearing:
 *
 *   1. The literals must not be derived from a shared prefix. `PREFIX + 'cart'`
 *      is invisible to that scanner, and an invisible key is an unpinned key.
 *   2. Moving a literal to a different module changes its recorded owner. The
 *      registry in that test has to be updated in the same commit as this move,
 *      which is what it asks for.
 *
 * Values are never renamed here — only relocated.
 */

import { clearKeys, readRaw, writeRaw } from './mockStorageAdapter';

// ── Key literals ──────────────────────────────────────────────────
//
// Every one of these is a browser-only fixture key. None of them is shipped
// data; the pin test includes them anyway so its completeness check has no
// exceptions to reason about.

export const MOCK_WORKSPACES_KEY = 'oz-dev-mock:workspaces';
export const MOCK_KDS_KEY = 'oz-dev-mock:kds';
export const MOCK_LOGIN_ATTEMPTS_KEY = 'oz-dev-mock:login-attempts';
export const MOCK_CART_KEY = 'oz-dev-mock:cart';
export const MOCK_HELD_CARTS_KEY = 'oz-dev-mock:held-carts';
export const MOCK_SALES_KEY = 'oz-dev-mock:sales';
export const MOCK_ACTIVE_SHIFT_KEY = 'oz-dev-mock:active-shift';
export const MOCK_SHIFT_HISTORY_KEY = 'oz-dev-mock:shift-history';
export const MOCK_USER_PREFS_KEY = 'oz-dev-mock:user-prefs';
export const MOCK_TOPOLOGY_KEY = 'oz-dev-mock:topology';
export const MOCK_TOPOLOGY_REVISIONS_KEY = 'oz-dev-mock:topology-revisions';

/**
 * Persisted marker for a shift that was explicitly closed.
 *
 * Without it, a reload after close would re-seed a fresh open shift — the
 * first-load convenience below applies only on the very first load — and
 * resurrect the clock the user just stopped. The real DB returns no open shift
 * after close, so the sentinel keeps the preview honest.
 */
export const MOCK_SHIFT_CLOSED_SENTINEL = '__closed__';

/** Every dev-mock key, for the reset path. */
export const MOCK_STORAGE_KEYS: readonly string[] = [
  MOCK_WORKSPACES_KEY,
  MOCK_KDS_KEY,
  MOCK_LOGIN_ATTEMPTS_KEY,
  MOCK_CART_KEY,
  MOCK_HELD_CARTS_KEY,
  MOCK_SALES_KEY,
  MOCK_ACTIVE_SHIFT_KEY,
  MOCK_SHIFT_HISTORY_KEY,
  MOCK_USER_PREFS_KEY,
  MOCK_TOPOLOGY_KEY,
  MOCK_TOPOLOGY_REVISIONS_KEY,
];

// ── Slice read/write ──────────────────────────────────────────────

/**
 * Read a persisted slice, falling back to `seed()` whenever the stored value is
 * absent, unparseable, or rejected by `map`.
 *
 * `seed` is a thunk, not a value, because two callers depend on getting a fresh
 * object each time: the KDS queue and the shift history both shallow-clone their
 * seed so that mutations never bleed into the module-level literal. Returning a
 * shared reference here would reintroduce exactly that bug.
 *
 * `map` is the escape hatch for a slice whose stored shape needs checking before
 * it can be trusted — it returns null to reject, and rejection falls back to the
 * seed rather than throwing. Domain-specific validation stays with the domain;
 * this module only knows how to persist.
 */
export function readSlice<T>(
  key: string,
  seed: () => T,
  map?: (value: unknown) => T | null,
): T {
  const raw = readRaw(key);
  if (raw === null) return seed();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (map === undefined) return parsed as T;
    const mapped = map(parsed);
    return mapped === null ? seed() : mapped;
  } catch {
    return seed();
  }
}

/** Persist a slice. A storage failure is swallowed — the caller keeps its copy. */
export function writeSlice(key: string, value: unknown): void {
  try {
    writeRaw(key, JSON.stringify(value));
  } catch {
    // Circular structure or storage unavailable — keep the in-memory copy.
  }
}

/** Read a raw string. Needed by the active-shift sentinel, which is not JSON. */
export { readRaw as readSliceRaw };

/** Write a raw string. Needed by the active-shift sentinel, which is not JSON. */
export { writeRaw as writeSliceRaw };

/**
 * Drop every persisted slice, returning the preview to its seed state.
 *
 * Not called at module load — a reload is supposed to resume. This exists for
 * the reset affordance and for tests that need a clean slate.
 */
export function resetMockDatabase(): void {
  clearKeys(MOCK_STORAGE_KEYS);
}
