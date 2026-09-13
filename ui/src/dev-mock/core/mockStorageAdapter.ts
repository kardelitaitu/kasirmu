/**
 * Dev-mock storage adapter.
 *
 * The single place in the browser preview that touches Web Storage. Every read
 * and write is wrapped so a locked-down, disabled, or full storage area cannot
 * throw into a handler — the mock's contract is "the preview keeps working" —
 * and the original file repeated that same try/catch eleven times, once per
 * persisted slice.
 *
 * This module is deliberately key-agnostic. The key literals live in
 * `mockDatabase.ts`, because `ui/src/__tests__/storageKeyPins.test.ts` scans
 * production source for standalone `const <NAME>_KEY = '<literal>'`
 * declarations and pins each one to the module that declares it. Deriving a key
 * from a shared prefix would hide it from that scanner and silently drop the
 * pin — which is the one change the pin exists to make deliberate.
 *
 * Behaviour is intentionally identical to the inlined try/catch it replaces,
 * including the absence of an in-memory fallback: when Web Storage is
 * unavailable a read reports "nothing stored" and a write is discarded, so the
 * caller keeps using its own module-level copy for the session, exactly as
 * before.
 */

/** True when a usable Web Storage implementation is reachable. */
export function hasWebStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** Read a raw string, or null when the key is absent or storage throws. */
export function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a raw string. A storage failure is swallowed by design. */
export function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable or over quota — the caller keeps its in-memory copy.
  }
}

/** Remove a key. A storage failure is swallowed by design. */
export function removeRaw(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable — there is nothing to remove.
  }
}

/**
 * Parse a stored JSON value.
 *
 * Returns null when nothing is stored, when the payload is not valid JSON, or
 * when an optional `validate` guard rejects it. A rejected payload is treated
 * as absent rather than as an error, matching every loader in the original
 * file: a corrupt or half-written slice fell back to the seed instead of
 * breaking the page.
 */
export function readJson<T>(
  key: string,
  validate?: (value: unknown) => value is T,
): T | null {
  const raw = readRaw(key);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (validate !== undefined && !validate(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/** Serialise and store a value. A serialisation or storage failure is swallowed. */
export function writeJson(key: string, value: unknown): void {
  try {
    writeRaw(key, JSON.stringify(value));
  } catch {
    // Circular structure or storage unavailable — keep the in-memory copy.
  }
}

/** Remove every supplied key. Used by the reset path, never at module load. */
export function clearKeys(keys: readonly string[]): void {
  for (const key of keys) removeRaw(key);
}
