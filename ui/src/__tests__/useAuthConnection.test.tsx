// ── useAuthConnection tests ──────────────────────────────────────
//
// Covers: initial 'checking' state, connected/disconnected mapping,
// thrown-error handling, the two-tier polling cadence (60 s while
// connected, 5 s retry while disconnected), recovery to connected,
// and unmount stopping the poll loop.
//
// Mocks: @/api/license (testAuthConnection). Fake timers control the
// polling schedule deterministically.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthConnection } from '@/hooks/useAuthConnection';
import { testAuthConnection } from '@/api/license';
import { toneForHealth } from '@/hooks/connectionHealth';
import { isUnaskableCommandError } from '@/utils/app-error';

vi.mock('@/api/license', () => ({
  testAuthConnection: vi.fn(),
}));

/** Flush pending microtasks so the in-flight async check() settles. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useAuthConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(testAuthConnection).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Initial state ─────────────────────────────────────────────

  it('starts in the checking state with unknown latency', () => {
    vi.mocked(testAuthConnection).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAuthConnection());
    expect(result.current.state).toBe('checking');
    expect(result.current.latencyMs).toBeNull();
  });

  // ── Connected path ────────────────────────────────────────────

  it('becomes connected with latency when the ping succeeds', async () => {
    vi.mocked(testAuthConnection).mockResolvedValue({ ok: true, status: 'healthy', latencyMs: 42 });

    const { result } = renderHook(() => useAuthConnection());
    await flush();

    expect(result.current.state).toBe('connected');
    expect(result.current.latencyMs).toBe(42);
  });

  // ── Disconnected paths ────────────────────────────────────────

  it('becomes disconnected when the ping returns ok:false', async () => {
    vi.mocked(testAuthConnection).mockResolvedValue({ ok: false, status: 'error', latencyMs: null });

    const { result } = renderHook(() => useAuthConnection());
    await flush();

    expect(result.current.state).toBe('disconnected');
    expect(result.current.latencyMs).toBeNull();
  });

  it('becomes disconnected when the ping throws', async () => {
    vi.mocked(testAuthConnection).mockRejectedValue(new Error('invoke failed'));

    const { result } = renderHook(() => useAuthConnection());
    await flush();

    expect(result.current.state).toBe('disconnected');
    expect(result.current.latencyMs).toBeNull();
  });

  // ── Degraded path ───────────────────────────────────────────

  it('reports degraded, not disconnected, when the server answers 503 with a payload', async () => {
    // The exact case the old probe collapsed: ok:false is reachability, and
    // here the server IS reachable and reporting a broken database.
    vi.mocked(testAuthConnection).mockResolvedValue({
      ok: false,
      status: 'Degraded: database (12ms)',
      latencyMs: 12,
      state: 'degraded',
      cause: 'database',
    });

    const { result } = renderHook(() => useAuthConnection());
    await flush();

    expect(result.current.state).toBe('degraded');
    expect(result.current.cause).toBe('database');
  });

  it('keeps the latency reading for a degraded server', async () => {
    // It answered, so the round-trip figure is real and worth showing.
    vi.mocked(testAuthConnection).mockResolvedValue({
      ok: false,
      status: 'Degraded',
      latencyMs: 44,
      state: 'degraded',
      cause: 'database',
    });

    const { result } = renderHook(() => useAuthConnection());
    await flush();

    expect(result.current.latencyMs).toBe(44);
  });

  it('polls a degraded server at the normal interval rather than hammering it', async () => {
    // Degraded is reachable. Dropping to the 5 s retry loop would have the
    // client polling every five seconds a server that is already talking to
    // us and simply needs its database fixed.
    vi.mocked(testAuthConnection).mockResolvedValue({
      ok: false,
      status: 'Degraded',
      latencyMs: 12,
      state: 'degraded',
      cause: 'database',
    });
    renderHook(() => useAuthConnection());
    await flush();
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    // Must not fall into the 5 s retry band.
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(55_001); });
    expect(testAuthConnection).toHaveBeenCalledTimes(2);
  });

  it('clears the cause once the server recovers', async () => {
    vi.mocked(testAuthConnection)
      .mockResolvedValueOnce({
        ok: false,
        status: 'Degraded',
        latencyMs: 12,
        state: 'degraded',
        cause: 'database',
      })
      .mockResolvedValue({ ok: true, status: 'healthy', latencyMs: 9, state: 'operational' });

    const { result } = renderHook(() => useAuthConnection());
    await flush();
    expect(result.current.cause).toBe('database');

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await flush();
    expect(result.current.state).toBe('connected');
    expect(result.current.cause).toBeNull();
  });

  it('leaves cause null when the payload carries none', async () => {
    vi.mocked(testAuthConnection).mockResolvedValue({
      ok: true,
      status: 'healthy',
      latencyMs: 9,
    });
    const { result } = renderHook(() => useAuthConnection());
    await flush();
    expect(result.current.cause).toBeNull();
  });

  // ── Polling cadence ───────────────────────────────────────────

  it('re-polls after 60 s while connected', async () => {
    vi.mocked(testAuthConnection).mockResolvedValue({ ok: true, status: 'healthy', latencyMs: 10 });
    renderHook(() => useAuthConnection());
    await flush();
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    // Just under the 60 s poll interval — no new call yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    // The 60 s mark fires the next poll.
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(testAuthConnection).toHaveBeenCalledTimes(2);
  });

  it('retries after 5 s while disconnected', async () => {
    vi.mocked(testAuthConnection).mockRejectedValue(new Error('down'));
    renderHook(() => useAuthConnection());
    await flush();
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(testAuthConnection).toHaveBeenCalledTimes(2);
  });

  it('recovers to connected when a retry succeeds', async () => {
    vi.mocked(testAuthConnection)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ ok: true, status: 'healthy', latencyMs: 33 });

    const { result } = renderHook(() => useAuthConnection());
    await flush();
    expect(result.current.state).toBe('disconnected');

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await flush();

    expect(result.current.state).toBe('connected');
    expect(result.current.latencyMs).toBe(33);
  });

  // ── Unmount ───────────────────────────────────────────────────

  it('stops polling after unmount', async () => {
    vi.mocked(testAuthConnection).mockResolvedValue({ ok: true, status: 'healthy', latencyMs: 10 });
    const { unmount } = renderHook(() => useAuthConnection());
    await flush();
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });

    expect(testAuthConnection).toHaveBeenCalledTimes(1);
  });

  it('ignores a late ping resolution after unmount', async () => {
    vi.mocked(testAuthConnection).mockReturnValue(new Promise(() => {}));
    const { result, unmount } = renderHook(() => useAuthConnection());

    unmount();

    // Resolve the pending ping after unmount — must not setState.
    vi.mocked(testAuthConnection).mockResolvedValue({ ok: true, status: 'healthy', latencyMs: 10 });
    await flush();

    expect(result.current.state).toBe('checking');
    expect(result.current.latencyMs).toBeNull();
  });
});

// ── "Cannot ask" is not the same fact as "asked and nothing answered" ────────
//
// The tablet shell registers no license commands, so `test_auth_connection` is
// not a slow or refused call there - it is a call that CANNOT run: the IPC
// boundary rejects with a command-not-found error before any request exists
// (ui/src/api/license.ts -> loggedInvoke -> invoke). The old catch treated
// that rejection exactly like a dead server: `disconnected`, which
// `connectionHealth.toneForHealth` paints bad and the pill draws as a
// permanently red "Auth: offline" - while the 5 s retry band re-issued the
// identical impossible call forever, each cycle costing a real failed invoke,
// one emitIpcError and one recordIpcTiming sample for a call that never ran.
//
// `classifyRetry` (ui/src/utils/app-error.ts) already holds the verdict that
// separates the two worlds: a message naming `not found` is NON-retryable,
// because re-issuing the same call cannot change the answer. That verdict was
// never consulted here. These cases pin BOTH halves: the unaskable probe
// lands on the union's own UNKNOWN (non-red, never re-polled), while every
// genuine reading keeps its behaviour - including the 5 s band that lets a
// real outage recover by itself.

describe('useAuthConnection - an unaskable probe is unknown, not offline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(testAuthConnection).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** The rejection an unregistered command produces at the IPC boundary. */
  const UNREGISTERED = () => Promise.reject(new Error(
    "Error invoking remote method 'test_auth_connection': Error: command test_auth_connection not found",
  ));

  it('command-not-found rejection -> non-red UNKNOWN, never the red offline pill', async () => {
    vi.mocked(testAuthConnection).mockImplementation(UNREGISTERED);

    const { result } = renderHook(() => useAuthConnection());
    await flush();

    // 'disconnected' IS the red claim. 'checking' is the unknown this union
    // already carries - fromWireHealth maps the wire's `unknown` onto it - so
    // "we could not ask" answers like a question never put, not like a
    // question that went unanswered.
    expect(result.current.state).toBe('checking');
    expect(result.current.latencyMs).toBeNull();
    expect(result.current.cause).toBeNull();
    // The claim the pill draws, through the mapper the StatusBar itself uses,
    // so this cannot drift from the rendering.
    expect(toneForHealth(result.current.state, result.current.latencyMs)).not.toBe('bad');
  });

  it('command-not-found rejection -> the probe is never re-armed, at any interval', async () => {
    vi.mocked(testAuthConnection).mockImplementation(UNREGISTERED);

    renderHook(() => useAuthConnection());
    await flush();
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    // The 5 s retry band, the 60 s poll band, and an hour of wall clock: a
    // call that cannot run must not be issued again by the hook. Each extra
    // call is one failed invoke + one emitIpcError + one timing sample, for
    // a probe whose answer was settled before it started.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(55_000); });
    expect(testAuthConnection).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); });
    expect(testAuthConnection).toHaveBeenCalledTimes(1);
  });

  it('genuine offline over a real round trip stays disconnected and keeps its 5 s retry', async () => {
    // Desktop's real outage: the call RAN and the answer was ok:false (wire
    // `unavailable`). Red is correct here, and so is hammering - the server
    // may come back. This is the case the fix above must not cost us.
    vi.mocked(testAuthConnection).mockResolvedValue({
      ok: false, status: 'error', latencyMs: null, state: 'unavailable',
    });

    const { result } = renderHook(() => useAuthConnection());
    await flush();

    expect(result.current.state).toBe('disconnected');
    expect(toneForHealth(result.current.state, result.current.latencyMs)).toBe('bad');

    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(testAuthConnection).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(testAuthConnection).toHaveBeenCalledTimes(2);
  });

  it('a transport failure that THROWS is still offline, and still retried', async () => {
    // Narrowness guard: reaching the catch is not the same as being
    // unaskable. A connection-refused rejection is a genuine outage -
    // `classifyRetry` calls it retryable - so it keeps the red pill AND the
    // 5 s band. Without this case "stop the loop on any throw" would pass.
    vi.mocked(testAuthConnection).mockRejectedValue(new Error('connection refused: econnrefused'));

    const { result } = renderHook(() => useAuthConnection());
    await flush();

    expect(result.current.state).toBe('disconnected');

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await flush();
    expect(testAuthConnection).toHaveBeenCalledTimes(2);
  });

  it('a degraded answer over a real round trip stays degraded, not unknown', async () => {
    vi.mocked(testAuthConnection).mockResolvedValue({
      ok: false, status: 'Degraded', latencyMs: 12, state: 'degraded', cause: 'database',
    });

    const { result } = renderHook(() => useAuthConnection());
    await flush();

    expect(result.current.state).toBe('degraded');
    expect(result.current.cause).toBe('database');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(testAuthConnection).toHaveBeenCalledTimes(2);
  });
});

// The class is the registry miss ALONE, so its discriminator is pinned
// directly: a domain miss inside the same wrapper is an ANSWER to a call that
// ran, and a transport throw is an outage. Both keep the red pill and the
// 5 s band.
describe('isUnaskableCommandError', () => {
  const UNREGISTERED =
    "Error invoking remote method 'test_auth_connection': Error: command test_auth_connection not found";

  it('names a missing command as unaskable', () => {
    expect(isUnaskableCommandError(new Error(UNREGISTERED))).toBe(true);
    expect(isUnaskableCommandError('command test_auth_connection not found')).toBe(true);
  });

  it('leaves a domain miss inside the same wrapper alone', () => {
    expect(isUnaskableCommandError(new Error(
      "Error invoking remote method 'get_product': Error: product not found",
    ))).toBe(false);
    expect(isUnaskableCommandError(new Error('tax rate 7 not found'))).toBe(false);
    expect(isUnaskableCommandError({ kind: 'core', subKind: 'notfound', message: 'role 3 not found' })).toBe(false);
  });

  it('leaves a real transport failure alone', () => {
    expect(isUnaskableCommandError(new Error('connection refused: econnrefused'))).toBe(false);
    expect(isUnaskableCommandError(new Error('request timed out'))).toBe(false);
    expect(isUnaskableCommandError(new Error('invoke failed'))).toBe(false);
  });

  // Measured boundary, asserted rather than wished away: a message naming no
  // terminal word is judged by `classifyRetry`'s SUBSTRING search, and the
  // transport word inside the command's own NAME (`..._connection`) makes it
  // retryable, so the predicate's first gate refuses it and it stays a red,
  // retried outage. Every message this boundary actually prints for a missing
  // command names `not found`, which is why the tablet case is caught. The
  // bias is deliberate: a false UNKNOWN would silence a real outage, a false
  // RED only keeps today's behaviour.
  it('does not claim a registry miss it cannot tell from an outage', () => {
    expect(isUnaskableCommandError(new Error(
      "Error invoking remote method 'test_auth_connection': Error: No handler registered for 'test_auth_connection'",
    ))).toBe(false);
  });
});

