/**
 * Single sanctioned re-export surface for the raw Tauri API modules
 * (core/event/app/window).
 *
 * UI-2 convention fix: project rules require front-end Tauri access to
 * go through `ui/src/api/` — components and hooks must not import
 * `@tauri-apps/api/*` directly. Routing these four primitives through
 * here keeps that rule enforceable and gives the dev-mock/test seams a
 * single place to alias.
 *
 * That rule is a convention, not a lint, so do NOT read this header as
 * proof the tree is clean. Two files outside `src/api/` still import the
 * package directly — `src/utils/logged-invoke.ts` (`core`) and
 * `src/__tests__/api-cache-contract.test.ts` (`path`) — and three files
 * inside `src/api/` bypass this surface for `listen` from `event`:
 * `api/hardware.ts`, `api/sales.ts`, `api/settings.ts`.
 *
 * `invoke` specifically should use `loggedInvoke` from
 * `@/utils/logged-invoke`, which adds timing/telemetry logging around the
 * call. It currently imports `invoke` from `@tauri-apps/api/core` itself
 * rather than from this module; routing it through here is an open
 * follow-up, not an existing property.
 */
export { convertFileSrc, invoke } from '@tauri-apps/api/core';
export { listen } from '@tauri-apps/api/event';
export { getVersion } from '@tauri-apps/api/app';
export { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * True only when a REAL Tauri webview is reachable — i.e. `__TAURI_INTERNALS__.invoke`
 * is a callable, not merely a present key.
 *
 * A key-presence test (`'__TAURI_INTERNALS__' in window`) is NOT enough, and that is
 * the trap this function exists to close. The dev preview's `index.html` deliberately
 * installs a PARTIAL stub —
 *   Object.defineProperty(window, '__TAURI_INTERNALS__', { value: { transformCallback } })
 * — so the Tauri mocks lib (`mockWindows` / `mockConvertFileSrc`) can bootstrap in a
 * plain browser. That stub has no `invoke`. A key-presence test therefore answers
 * "Tauri" in the browser preview and sends callers down the REAL path:
 * `getCurrentWindow().onCloseRequested()` → `Window.listen` → `invoke` → throws
 * `window.__TAURI_INTERNALS__.invoke is not a function`, which `GlobalErrorReporter`
 * toasts as "Unexpected error" (two toasts, one per StrictMode effect pass). Three
 * copies of that wrong test had accumulated — `useUnsavedChangesGuard`, `useFullscreen`
 * and `PosScreen` — each commented as "mirrors" the others, so the mistake was
 * consistent rather than caught. All three now call this function.
 *
 * Consequence for tests: a fixture that fakes Tauri with
 * `window.__TAURI_INTERNALS__ = {}` now correctly reads as "not Tauri". Stub
 * `{ invoke: () => Promise.resolve() }` (or use the real mocks lib) to stand in
 * for a live webview; stub `{ transformCallback }` alone to reproduce the dev
 * preview's partial stub.
 *
 * This predicate matches the dev-mock's own `hasTauriInternals()`
 * (`dev-mock/core/mockDispatcher.ts`), so the mock seam and the production seam finally
 * agree on what "in Tauri" means. The mock cannot be imported here: it must never be
 * bundled into a production build.
 */
export function isTauriWebview(): boolean {
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
