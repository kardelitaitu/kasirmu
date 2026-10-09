// ── Dev-mock failure injection ─────────────────────────────────────
//
// The mock answers every command from its registry, so a component branch that
// only runs when a command REJECTS cannot be reached from a browser test. That
// is not hypothetical: `shiftUnavailable` is set by a rejected
// `get_active_shift_scoped` (usePosShifts.ts:167-168) and the mock answers that
// name from a hardcoded object (handlers/shifts.ts:124), so the guard that keeps
// the till selling while the shift service is down was unreachable end-to-end.
//
// `window.__MOCK_FAIL` closes that gap. These cases pin the hook's contract:
// it fails exactly the named commands, it fails them by REJECTING (not by
// answering null — a null resolves, which is a different code path in every
// caller), and it leaves every other command alone.
//
// The "working normally" control asserts the mock's real shift object rather
// than null: get_active_shift_scoped answers a seeded shift (handlers/shifts.ts:124),
// and an earlier draft of this file expected null and failed on unmodified code.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, MOCK_FAIL_KEY } from '@/dev-mock/core/mockDispatcher';

type WithFail = { [MOCK_FAIL_KEY]?: unknown };

function setFail(value: unknown): void {
  const w = window as unknown as WithFail;
  if (value === undefined) delete w[MOCK_FAIL_KEY];
  else w[MOCK_FAIL_KEY] = value;
}

// Silence the mock's own console traffic; the assertions below are about
// rejection, and the dispatcher logs on every invoke.
let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  setFail(undefined);
});

afterEach(() => {
  setFail(undefined);
  log.mockRestore();
  warn.mockRestore();
});

describe('dev-mock failure injection', () => {
  it('rejects a command named in window.__MOCK_FAIL', async () => {
    setFail(['get_active_shift_scoped']);
    await expect(invoke('get_active_shift_scoped', { sessionToken: 't' }))
      .rejects.toThrow(/injected failure for 'get_active_shift_scoped'/);
  });

  it('leaves commands NOT named in the list working normally', async () => {
    // The control, and it must use a DIFFERENT command from the one it fails:
    // an earlier draft listed get_active_shift_scoped and then invoked that same
    // name, so it asserted the failure path against itself and failed on
    // unmodified code. Without a real control, a hook that rejected everything
    // would satisfy the case above while breaking the whole suite.
    setFail(['get_active_shift_scoped']);
    const value = await invoke<{ id?: string } | null>('get_active_shift');
    expect(value).not.toBeNull();
    expect(value?.id).toBe('shift-1');
  }, 10_000);

  it('does not reject when the list is empty or absent', async () => {
    setFail([]);
    await expect(invoke('get_active_shift_scoped')).resolves.not.toBeNull();
    setFail(undefined);
    await expect(invoke('get_active_shift_scoped')).resolves.not.toBeNull();
  });

  it('ignores a non-array value rather than throwing', async () => {
    // page.addInitScript can only carry JSON-ish values; a spec that sets a
    // string by mistake must not turn every command in the app into a failure.
    setFail('get_active_shift_scoped');
    await expect(invoke('get_active_shift_scoped')).resolves.not.toBeNull();
  });

  it('re-reads the list on every invoke, so a spec can clear it at runtime', async () => {
    setFail(['get_active_shift_scoped']);
    await expect(invoke('get_active_shift_scoped')).rejects.toThrow();
    setFail([]);
    await expect(invoke('get_active_shift_scoped')).resolves.not.toBeNull();
  });
});
