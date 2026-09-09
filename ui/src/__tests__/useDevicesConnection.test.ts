/**
 * @file useDevicesConnection.test.ts
 * @description Device-connectivity probe hook (ServiceKind::DeviceConnectivity
 * slice of the service-health contracts, todo-global-saas-3.md).
 *
 * Covers: populated bus→connected, empty bus→disconnected (a real operator
 * problem), pre-session staying checking (ADR #7 scoped command), and the
 * manual retry contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDevicesConnection } from '@/hooks/useDevicesConnection';
import { discoverHardwareScoped } from '@/api/hardware';

vi.mock('@/api/hardware', () => ({ discoverHardwareScoped: vi.fn() }));

const { useWorkspaceMock } = vi.hoisted(() => ({ useWorkspaceMock: vi.fn() }));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => useWorkspaceMock(),
}));

/** Flush pending microtasks so the in-flight async check() settles. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useDevicesConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(discoverHardwareScoped).mockReset();
    useWorkspaceMock.mockReset();
    useWorkspaceMock.mockReturnValue({ sessionToken: 'tok-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts in the checking state before the first probe resolves', () => {
    vi.mocked(discoverHardwareScoped).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useDevicesConnection());
    expect(result.current.state).toBe('checking');
    expect(result.current.devices).toBe(0);
  });

  it('reads connected when the bus reports devices', async () => {
    vi.mocked(discoverHardwareScoped).mockResolvedValue([
      { vendor_id: 1, product_id: 2 },
    ] as never);
    const { result } = renderHook(() => useDevicesConnection());
    await flush();
    expect(result.current.state).toBe('connected');
    expect(result.current.devices).toBe(1);
  });

  it('reads disconnected when the bus answers empty — not idle-green', async () => {
    vi.mocked(discoverHardwareScoped).mockResolvedValue([] as never);
    const { result } = renderHook(() => useDevicesConnection());
    await flush();
    expect(result.current.state).toBe('disconnected');
  });

  it('stays checking without a session token (pre-login screens)', async () => {
    useWorkspaceMock.mockReturnValue({ sessionToken: null });
    const { result } = renderHook(() => useDevicesConnection());
    await flush();
    expect(discoverHardwareScoped).not.toHaveBeenCalled();
    expect(result.current.state).toBe('checking');
  });

  it('probes again once a session token appears', async () => {
    useWorkspaceMock.mockReturnValue({ sessionToken: null });
    const { result, rerender } = renderHook(() => useDevicesConnection());
    await flush();
    expect(discoverHardwareScoped).not.toHaveBeenCalled();

    useWorkspaceMock.mockReturnValue({ sessionToken: 'tok-1' });
    vi.mocked(discoverHardwareScoped).mockResolvedValue([
      { vendor_id: 1, product_id: 2 },
    ] as never);
    rerender();
    await flush();
    expect(discoverHardwareScoped).toHaveBeenCalledWith('tok-1');
    expect(result.current.state).toBe('connected');
  });

  it('re-probes immediately on manual retry', async () => {
    vi.mocked(discoverHardwareScoped).mockResolvedValue([] as never);
    const { result } = renderHook(() => useDevicesConnection());
    await flush();
    expect(discoverHardwareScoped).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    act(() => {
      result.current.retryNow();
    });
    await flush();
    expect(discoverHardwareScoped).toHaveBeenCalledTimes(2);

    // The superseded poll must not stack a second loop.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(discoverHardwareScoped).toHaveBeenCalledTimes(2);
  });
});
