/**
 * @file useGatewayStatus.test.ts
 * @description Stripe status-bar probe — reads the booleans the backend
 * computes (`gateway_status`), never the credential.
 *
 * Covers: configured→true, not-configured→false, a neighbouring gateway's
 * credential NOT lighting the Stripe pill, a failed read keeping the previous
 * reading, and the tripwire that lets this hook never go back to asking the
 * ungated `get_setting` surface for a deny-listed key.
 *
 * WHY THE SHAPE IS THIS: the bug this file exists to catch is a probe that
 * read `false` on a device with a LIVE key — because the old data source was
 * `get_setting('stripe.api_key')` and the Rust read door answers that name with
 * `Ok(None)`. The old test mocked `@tauri-apps/api/core` and answered ANY
 * command with `'sk_test_12345'`, so it asserted configured:true against a stub
 * that lied: it could not have caught a refusal it never modelled. Every case
 * here goes through the api wrapper instead, and the wrapper's fixtures are
 * shaped exactly like what `gateway_status` really returns — an array of
 * `{ name, configured, online }` — so the only way this suite can go green on a
 * false indicator is if the hook ignores the answer it was given.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGatewayStatus } from '@/hooks/useGatewayStatus';
import { getGatewayStatus } from '@/api/gateway';

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('@/api/gateway', () => ({ getGatewayStatus: vi.fn() }));
// Stands in for the raw IPC surface, and it answers the way the REAL read door
// answers: `get_setting` for a key on SECRET_KEY_DENY_LIST is refused before
// the table is touched and comes back `Ok(None)` — null, not an error. The
// hook has no business reaching it at all, but the difference between this
// stub and a plain `vi.fn()` is the whole post-mortem: a bare `vi.fn()` returns
// `undefined`, and `key !== null` read that as CONFIGURED, which is how the
// previous suite got a green configured:true for a probe that could only ever
// be false in production. Model the refusal, and the lie cannot pass.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => {
    mockInvoke(cmd, args);
    if (cmd === 'get_setting') {
      return Promise.resolve(null);
    }
    return Promise.reject(new Error(`unexpected IPC command from this hook: ${cmd}`));
  },
}));

/** Flush pending microtasks so the in-flight async check() settles. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useGatewayStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockReset();
    vi.mocked(getGatewayStatus).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts unconfigured before the first probe resolves', () => {
    vi.mocked(getGatewayStatus).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useGatewayStatus());
    expect(result.current).toEqual({ name: 'Stripe', configured: false, online: false });
  });

  it('reports configured and online TRUE when a Stripe credential exists', async () => {
    // THE regression pin, in the direction that catches the class of bug: a
    // device that HAS a live key must read true. Asserting only the false case
    // is what let the indicator sit false for months — a probe that can only
    // ever answer false passes every such assertion.
    vi.mocked(getGatewayStatus).mockResolvedValue([
      { name: 'Stripe', configured: true, online: true },
      { name: 'Square', configured: false, online: false },
    ]);
    const { result } = renderHook(() => useGatewayStatus());
    await flush();
    expect(result.current.name).toBe('Stripe');
    expect(result.current.configured).toBe(true);
    expect(result.current.online).toBe(true);
  });

  it('reports configured and online FALSE when Stripe has no credential', async () => {
    vi.mocked(getGatewayStatus).mockResolvedValue([
      { name: 'Stripe', configured: false, online: false },
    ]);
    const { result } = renderHook(() => useGatewayStatus());
    await flush();
    expect(result.current.configured).toBe(false);
    expect(result.current.online).toBe(false);
  });

  it('does not light the Stripe pill from another gateway', async () => {
    vi.mocked(getGatewayStatus).mockResolvedValue([
      { name: 'Stripe', configured: false, online: false },
      { name: 'Square', configured: true, online: true },
      { name: 'QRIS (Midtrans)', configured: true, online: true },
    ]);
    const { result } = renderHook(() => useGatewayStatus());
    await flush();
    expect(result.current.configured).toBe(false);
    expect(result.current.online).toBe(false);
  });

  it('reads unconfigured when the device has no gateway at all', async () => {
    vi.mocked(getGatewayStatus).mockResolvedValue([]);
    const { result } = renderHook(() => useGatewayStatus());
    await flush();
    expect(result.current.configured).toBe(false);
  });

  it('asks the computed-status command and never the raw settings surface', async () => {
    // Tripwire for the deleted dead call. `get_setting` with a deny-listed
    // credential name is refused at the read door, so any probe that goes back
    // to it will read null and lie again. The hook must go through the api
    // wrapper and touch no IPC command of its own.
    vi.mocked(getGatewayStatus).mockResolvedValue([
      { name: 'Stripe', configured: true, online: true },
    ]);
    const { result } = renderHook(() => useGatewayStatus());
    await flush();
    expect(getGatewayStatus).toHaveBeenCalledTimes(1);
    expect(result.current.configured).toBe(true);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('keeps the previous reading when the probe fails', async () => {
    vi.mocked(getGatewayStatus)
      .mockResolvedValueOnce([{ name: 'Stripe', configured: true, online: true }])
      .mockRejectedValueOnce(new Error('ipc down'));
    const { result } = renderHook(() => useGatewayStatus());
    await flush();
    expect(result.current.configured).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.configured).toBe(true);
    expect(result.current.online).toBe(true);
  });

  it('recovers on the next poll after a failed read', async () => {
    vi.mocked(getGatewayStatus)
      .mockResolvedValueOnce([{ name: 'Stripe', configured: true, online: true }])
      .mockRejectedValueOnce(new Error('ipc down'))
      .mockResolvedValueOnce([{ name: 'Stripe', configured: false, online: false }]);
    const { result } = renderHook(() => useGatewayStatus());
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.configured).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.configured).toBe(false);
  });

  it('does not update state after unmount', async () => {
    let release: (v: { name: string; configured: boolean; online: boolean }[]) => void = () => {};
    vi.mocked(getGatewayStatus).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useGatewayStatus());
    unmount();
    await act(async () => {
      release([{ name: 'Stripe', configured: true, online: true }]);
    });
    expect(result.current.configured).toBe(false);
  });
});
