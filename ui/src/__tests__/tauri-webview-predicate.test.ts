/**
 * isTauriWebview() — the seam predicate itself.
 *
 * This is the one place that decides "are we in a real Tauri webview?" for
 * useFullscreen, useUnsavedChangesGuard and PosScreen. It exists because the
 * obvious test is wrong: `'__TAURI_INTERNALS__' in window` is TRUE in the
 * browser dev preview, where `ui/index.html` installs a partial stub
 * (`{ transformCallback }`) so the Tauri mocks lib can bootstrap. Every caller
 * that trusted key-presence went on to call `invoke`, which the stub does not
 * have, and the resulting TypeError was toasted as "Unexpected error".
 *
 * So the contract pinned here is deliberately narrow: only a CALLABLE `invoke`
 * counts. `invoke` present-but-not-a-function must not, because that is exactly
 * the shape that made the old test look right.
 *
 * The function reads `window` directly and has no other dependency, so these
 * cases need no module mocks — they install the internals object and assert.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { isTauriWebview, invoke, IPC_TIMEOUT_MS } from '@/api/tauri';

const KEY = '__TAURI_INTERNALS__';

/** Install (or clear) the internals object the way a host would. Bracket
 *  notation is required by the repo's noPropertyAccessFromIndexSignature rule. */
function setInternals(value: unknown): void {
  const w = window as unknown as Record<string, unknown>;
  if (value === undefined) delete w[KEY];
  else w[KEY] = value;
}

describe('isTauriWebview', () => {
  afterEach(() => {
    setInternals(undefined);
  });

  it('is false when the internals object is absent', () => {
    expect(isTauriWebview()).toBe(false);
  });

  it('is false for the dev preview partial stub ({ transformCallback } only)', () => {
    // Verbatim shape from ui/index.html — the case the whole predicate exists
    // for. Key-presence would answer true here.
    setInternals({ transformCallback: () => 1 });
    expect(isTauriWebview()).toBe(false);
  });

  it('is false when invoke is present but not callable', () => {
    setInternals({ invoke: 'not-a-function' });
    expect(isTauriWebview()).toBe(false);

    setInternals({ invoke: null });
    expect(isTauriWebview()).toBe(false);

    setInternals({ invoke: {} });
    expect(isTauriWebview()).toBe(false);
  });

  it('is false when the internals object is not an object', () => {
    setInternals('tauri');
    expect(isTauriWebview()).toBe(false);
  });

  it('is true when invoke is a function', () => {
    setInternals({ invoke: () => Promise.resolve() });
    expect(isTauriWebview()).toBe(true);
  });

  it('is true when invoke is a function alongside other internals keys', () => {
    // A live webview carries more than `invoke`; nothing else may change the
    // answer in either direction.
    setInternals({ transformCallback: () => 1, invoke: () => Promise.resolve(), metadata: {} });
    expect(isTauriWebview()).toBe(true);
  });
});

describe('invoke never leaves the caller with a pending promise (C23)', () => {
  /**
   * The defect: Tauri 2.11.3 compiles an async command onto a spawned task and
   * its IPC layer contains no `catch_unwind` (verified in the pinned source —
   * `src/ipc/mod.rs:329` spawns the command with no panic guard). A command body
   * that panics therefore never writes a response, and the webview's
   * `invoke()` promise never settles: no error, no rejection, no crash. A
   * cashier completes a sale and the spinner never ends, with no way to know
   * whether the sale persisted.
   *
   * The shell cannot be made to catch a panic it never sees, so this layer
   * bounds the wait instead: a call that has not settled by the deadline is
   * rejected with a typed error, which turns an unbounded hang into a
   * recoverable failure the UI can already render.
   */
  it('rejects rather than hanging forever when a command never responds', async () => {
    vi.useFakeTimers();
    // A command that panicked: the task died without ever settling the promise.
    setInternals({ invoke: () => new Promise<never>(() => {}) });
    try {
      let outcome: string | null = null;
      const p = invoke('some_command', {}).then(
        () => { outcome = 'resolved'; },
        (e: unknown) => { outcome = e instanceof Error ? e.message : String(e); },
      );

      // Still pending just before the deadline -- it has not been given up on early.
      await vi.advanceTimersByTimeAsync(IPC_TIMEOUT_MS - 1_000);
      expect(outcome, 'must not settle before the deadline').toBeNull();

      // Past the deadline it rejects, naming the command and the reason.
      await vi.advanceTimersByTimeAsync(2_000);
      await p;
      expect(outcome).not.toBeNull();
      expect(outcome).not.toBe('resolved');
      expect(String(outcome)).toContain('some_command');
      expect(String(outcome)).toMatch(/timeout/i);
    } finally {
      vi.useRealTimers();
      setInternals(undefined);
    }
  });

  it('still rejects promptly and unchanged when the command rejects normally', async () => {
    // The timeout must not mask a real error or delay it until the deadline.
    setInternals({
      invoke: () => Promise.reject(new Error('permission denied')),
    });
    await expect(invoke('some_command', {})).rejects.toThrow('permission denied');
  });

  it('resolves normally when the command answers inside the deadline', async () => {
    setInternals({ invoke: () => Promise.resolve({ ok: true }) });
    await expect(invoke<{ ok: boolean }>('some_command', {})).resolves.toEqual({ ok: true });
  });
});
