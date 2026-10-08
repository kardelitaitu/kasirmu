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
 *
 * **C23 update:** `invoke` is no longer a bare re-export. It is now a wrapper
 * that bounds each call with `IPC_TIMEOUT_MS`, because Tauri has no
 * `catch_unwind` on the command path and a panicking command leaves the
 * caller's promise pending forever. Behaviour is otherwise identical:
 * `rawInvoke` is called with the same three arguments and its result is
 * passed through untouched, so a normal rejection still rejects with the
 * original error and a normal resolution still resolves with the same value.
 */
import { invoke as rawInvoke, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core';

export { convertFileSrc } from '@tauri-apps/api/core';

/**
 * How long a single IPC call may stay unsettled before it is treated as dead
 * (C23).
 *
 * This is a **liveness bound, not a performance budget**. A command that
 * legitimately takes longer — a large export, a first-run migration, a plugin
 * load — must raise it rather than be silently cut off, which is why it is
 * exported and named rather than inlined.
 *
 * The value sits far above any normal command: the slowest real operation
 * measured today is a full backup/export in the low seconds, and the
 * transport's own HTTP ceiling is 30s. 120s therefore fires only on a call
 * that is never going to answer.
 */
export const IPC_TIMEOUT_MS = 120_000;

/**
 * `invoke`, with a deadline.
 *
 * # Why this exists (C23)
 *
 * Tauri 2.11.3 compiles an async command onto a spawned task, and its IPC
 * layer contains no `catch_unwind` — verified in the pinned source, where
 * `src/ipc/mod.rs:329` spawns the command with no panic guard and the crate
 * has no panic hook at all. A command body that panics therefore never writes
 * a response, and this promise **never settles**: no rejection, no error, no
 * crash. The caller waits forever. For a completed sale that means a spinner
 * that never ends and no way to learn whether the sale persisted.
 *
 * The shell cannot catch a panic it never observes, so this layer bounds the
 * wait instead: a call still outstanding at `IPC_TIMEOUT_MS` rejects with a
 * typed, retryable error. An unbounded hang becomes an ordinary failure the
 * UI already knows how to render.
 *
 * # What this is not
 *
 * It does **not** make a panicking command return `Err` from the Rust
 * side, which would be the better fix and needs either a wrapper around all
 * ~514 command bodies or an upstream Tauri seam, neither of which exists
 * today. It also does not cancel the command: the work is not resumed, so a
 * caller that retries must be able to do so safely. Every write path in this
 * codebase is idempotent by design — money moves are keyed by sale id,
 * sessions by token — so a retry is safe; the timeout only stops the UI from
 * lying about being busy.
 */
export interface InvokeCustomOptions extends Partial<InvokeOptions> {
  timeoutMs?: number;
}

export function invoke<T>(
  cmd: string,
  args?: InvokeArgs,
  options?: InvokeCustomOptions,
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? IPC_TIMEOUT_MS;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          "IPC timeout: '" + cmd + "' did not respond within " + timeoutMs + 'ms. ' +
            'The command may have panicked, which Tauri does not report to the ' +
            'caller. Retrying is safe; the operation is idempotent.',
        ),
      );
    }, timeoutMs);

    // The real Tauri call may throw synchronously when the webview lacks its
    // internals — that must reject, not escape.
    try {
      // Forward only the arguments the caller actually supplied. The upstream
      // signature is `invoke(cmd, args = {}, options)`, and a wrapper that
      // always passes three arguments changes the trace every IPC test sees
      // (observed: a mocked invoke asserted as called with two arguments
      // received three). Passing through conditionally keeps this wrapper
      // invisible to callers and to their spies.
      const rawOptions: InvokeOptions | undefined =
        options?.headers !== undefined ? { headers: options.headers } : undefined;
      const forwarded =
        rawOptions === undefined ? rawInvoke<T>(cmd, args) : rawInvoke<T>(cmd, args, rawOptions);
      Promise.resolve(forwarded).then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        },
      );
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    }
  });
}
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
