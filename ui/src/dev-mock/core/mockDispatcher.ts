/**
 * Dev-mock IPC dispatcher.
 *
 * Owns the command registry and the routing that stands in for the Rust
 * backend while the UI runs in a browser. `tauri-api.ts` registers its handler
 * map into `handlers` and calls `applyScopedAliases()` once, after every
 * registration in the file has run; this module does the rest.
 *
 * The registry is exported as a mutable object rather than being passed in,
 * because that is what the callers already assume: the entry file assigns
 * roughly 460 handlers through the literal, and then patches individual ones
 * with `handlers['name'] = …` further down. Replacing that with a registration
 * function would be a rewrite of every call site, which is the sibling work
 * orders' job, not this one's.
 *
 * This module must not import from `tauri-api.ts`. The entry file imports the
 * dispatcher, so a reverse import would close a cycle and leave `handlers`
 * partially initialised during module evaluation.
 */

/** A mock command implementation. Receives the unwrapped payload. */
export type MockHandler = (args: unknown) => unknown;

/** The command registry. Keyed by the command name the UI invokes. */
export const handlers: Record<string, MockHandler> = {};

/**
 * Merge a handler map into the registry.
 *
 * Takes a typed map rather than letting callers `Object.assign` straight onto
 * `handlers`, because `Object.assign` gives the source literal no contextual
 * type — every `(args) => …` inside a 460-entry literal would fall back to an
 * implicit `any` and stop being checked against the handler signature.
 */
export function registerHandlers(map: Record<string, MockHandler>): void {
  Object.assign(handlers, map);
}

/**
 * True when running inside a real Tauri webview (packaged app or `tauri dev`).
 *
 * The mock is aliased in for the dev server, but a real webview provides
 * `window.__TAURI_INTERNALS__` — in that case we MUST delegate to the actual
 * Rust backend instead of serving mock data (the Jul 2026 regression where
 * the unconditional alias shipped mock IPC into production builds).
 */
export function hasTauriInternals(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } })
        .__TAURI_INTERNALS__?.invoke === 'function'
    );
  } catch {
    return false;
  }
}

/**
 * Mirror every registered command onto its `_scoped` twin.
 *
 * This replaces SCOPED_ALIASES, a hand-maintained list that had fallen 115
 * entries behind: the ADR #7 migration moved the api layer to the `_scoped`
 * spelling of commands while the mock kept registering the unscoped names, so
 * every scoped name outside the curated list fell through to `return null` in
 * `invoke()` below. That fails silently, not loudly — the component swallows
 * the null and the test still passes while asserting against the failure path,
 * which is the exact defect invokeCoverage.ts documents for hand-written mock
 * chains (R36-02). Measured on the tree: 217 calls across 4 commands were
 * landing there, including get_hardware_settings_scoped since 1fbcc8a0, so ~78
 * terminal-hardware test invocations were exercising the catch-and-default
 * branch while reading as if the DTO had loaded.
 *
 * So alias by rule instead of by list: any registered command whose name does
 * not already end in `_scoped` gets a `_scoped` alias unless one is genuinely
 * registered. Call this AFTER every registration in the entry file, so it sees
 * the complete registry — a curated loop that runs earlier cannot.
 *
 * It deliberately does NOT invent handlers for names with no base: an unknown
 * command must still warn, because keeping the truly-unknown case loud is the
 * whole point.
 */
export function applyScopedAliases(): void {
  for (const base of Object.keys(handlers)) {
    if (base.endsWith('_scoped')) continue;
    const scoped = `${base}_scoped`;
    // Bound to a local: `handlers[base]` is `T | undefined` under
    // noUncheckedIndexedAccess, and the guard below narrows `handlers[scoped]`,
    // not this.
    const twin = handlers[base];
    if (twin !== undefined && handlers[scoped] === undefined) {
      handlers[scoped] = twin;
    }
  }
}

/**
 * Failure injection for the dev-mock — browser/E2E only.
 *
 * Some states the UI must survive cannot be reached through the mock's DATA:
 * `shiftUnavailable` (usePosShifts.ts:44-55) is set when
 * `get_active_shift_scoped` REJECTS, and the mock answers that command from a
 * hardcoded object (`handlers/shifts.ts:124`), so no seed and no fixture can
 * make it fail. Without a way to force a rejection, the guard that keeps the
 * till selling while the shift service is down is unreachable from a browser
 * test — it can only ever be covered by a unit test, which is exactly the
 * coverage gap this hook exists to close.
 *
 * Usage from a Playwright spec, before navigating:
 *
 *   await page.addInitScript(() => {
 *     window.__MOCK_FAIL = ['get_active_shift_scoped'];
 *   });
 *
 * The list is re-read on every `invoke`, so a spec may set or clear it at
 * runtime too. It is deliberately a plain array of command NAMES: every caller
 * that cares about a rejection discards the message (usePosShifts.ts:167-168
 * catches and ignores it), so a richer shape would be surface nothing asserts.
 *
 * Dev-only by construction, not by a runtime check: this module is aliased in
 * place of `@tauri-apps/api/core` only under `command === 'serve'`
 * (vite.config.ts:35-49), so a packaged build never contains it.
 */
export const MOCK_FAIL_KEY = '__MOCK_FAIL';

/** The error an injected failure throws, or null when `cmd` is not listed. */
function injectedFailure(cmd: string): Error | null {
  if (typeof window === 'undefined') return null;
  const list = (window as unknown as { [MOCK_FAIL_KEY]?: unknown })[MOCK_FAIL_KEY];
  if (!Array.isArray(list) || !list.includes(cmd)) return null;
  return new Error(
    `[TAURI MOCK] injected failure for '${cmd}' (window.${MOCK_FAIL_KEY})`,
  );
}

/** Mock Tauri invoke — delegates to real IPC in a webview, else mock data. */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options?: unknown,
): Promise<T> {
  if (hasTauriInternals()) {
    // Real Tauri webview — pass straight through to the Rust backend.
    // Default args to {} like the real invoke(cmd, args = {}, options).
    return (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: Record<string, unknown>, o?: unknown) => Promise<T> };
    }).__TAURI_INTERNALS__.invoke(cmd, args ?? {}, options);
  }

  console.log('[TAURI MOCK] invoke:', cmd, args);

  // Checked BEFORE the handler so an injected failure beats the mock's data,
  // and before the simulated latency so a failing command stays fast.
  const injected = injectedFailure(cmd);
  if (injected) {
    console.warn('[TAURI MOCK] injected failure:', cmd);
    throw injected;
  }

  // Small delay to simulate async IPC
  await new Promise((r) => setTimeout(r, 50));

  const handler = handlers[cmd];
  if (handler) {
    return handler(args?.['args'] ?? args) as T;
  }

  console.warn('[TAURI MOCK] Unhandled command:', cmd);
  return null as T;
}

/** Mock convertFileSrc — delegates to real IPC in a webview, else path as-is. */
export function convertFileSrc(path: string, protocol = 'asset'): string {
  if (hasTauriInternals()) {
    return (window as unknown as {
      __TAURI_INTERNALS__: { convertFileSrc: (p: string, pr: string) => string };
    }).__TAURI_INTERNALS__.convertFileSrc(path, protocol);
  }
  return path;
}

/** True when the real Tauri backend is reachable from this page. */
export function isTauri(): boolean {
  return hasTauriInternals();
}
