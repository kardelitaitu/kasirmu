// ── Untrusted IPC payload coercion ─────────────────────────────────
//
// Every `loggedInvoke<T>` call DECLARES its return type, but nothing at
// runtime enforces it. A transport that answers `undefined` (a command
// registered only on another platform, a mocked or partially-migrated IPC
// bridge, a legacy build) hands the caller a value the type says cannot
// happen — and the caller then reads a field off it.
//
// That failure mode is not cosmetic. Measured in this codebase before these
// helpers existed: `rates.length` and `for...of` on an `undefined` payload
// threw INSIDE a render or an effect, which React retries — so the symptom
// was a blank screen, an uncaught-render exception, or an unbounded retry
// loop, never a clean error. Three screens were fixed one at a time
// (ExchangeRateScreen, TaxConfigurationScreen, useBackupStatus) before the
// pattern was swept; these helpers exist so the next call site has one
// idiomatic thing to reach for instead of three competing spellings of
// `Array.isArray(x) ? x : []`.
//
// The rules:
//
//   - `asArray` guards an ARRAY payload. "No rows returned" and "the read
//     returned nothing usable" both mean zero rows, which is what the
//     screens' own empty states already render.
//   - `asObject` guards a STRUCT payload, and is deliberately NARROW. It
//     preserves fields the payload actually carries — including an explicit
//     `null` — because flattening a legitimate `null` ("read succeeded and
//     answered: none") into `undefined` ("never answered") ERASES a real
//     answer. That is the bug the useBackupStatus fix had to avoid: its
//     "Last backup: Never" state and its never-answered state are different
//     claims, and a blanket `??` collapsed them.
//
// Neither helper invents data: they only prevent a read of the wrong shape.

/**
 * Coerce an untrusted IPC payload to an array.
 *
 * Returns `fallback` (default `[]`) unless the value really is an array.
 * Use at the assignment boundary — `setRates(asArray(items))` — so no
 * later `.map`, `.filter`, `.length` or `for...of` can meet a non-array.
 */
export function asArray<T>(value: T[] | null | undefined): T[];
export function asArray<T>(value: unknown): T[];
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Coerce an untrusted IPC payload to a struct, or `null` when absent.
 *
 * Returns the payload UNCHANGED when it is a non-null object, so its own
 * `null` fields stay `null` rather than being flattened to `undefined`
 * (see the header: those are different claims). Only a missing or
 * non-object payload becomes `null`, which callers read as
 * "never answered" — the same state their `catch` arm already establishes.
 */
export function asObject<T extends object>(value: T | null | undefined): T | null;
export function asObject<T extends object>(value: unknown): T | null;
export function asObject<T extends object>(value: unknown): T | null {
  // `typeof [] === 'object'`, so the array check is load-bearing: without it a
  // caller would "successfully" read named fields off a list.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as T;
}
