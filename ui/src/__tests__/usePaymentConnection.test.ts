/**
 * @file usePaymentConnection.test.ts
 * @description Payment-service probe hook (ServiceKind::Payment slice of the
 * service-health contracts, todo-global-saas-3.md).
 *
 * Covers: configured→connected, none-configured→disconnected, a failed read
 * keeping the previous reading (never inventing an outage), and the manual
 * retry contract shared with useAuthConnection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePaymentConnection } from '@/hooks/usePaymentConnection';
import { getGatewayStatus } from '@/api/gateway';

vi.mock('@/api/gateway', () => ({ getGatewayStatus: vi.fn() }));

/** Flush pending microtasks so the in-flight async check() settles. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('usePaymentConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getGatewayStatus).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts in the checking state before the first probe resolves', () => {
    vi.mocked(getGatewayStatus).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePaymentConnection());
    expect(result.current.state).toBe('checking');
    expect(result.current.gateways).toBe(0);
  });

  it('reads connected with the configured-gateway count', async () => {
    vi.mocked(getGatewayStatus).mockResolvedValue([
      { name: 'Stripe', configured: true, online: true },
      { name: 'Midtrans', configured: false, online: false },
    ]);
    const { result } = renderHook(() => usePaymentConnection());
    await flush();
    expect(result.current.state).toBe('connected');
    expect(result.current.gateways).toBe(1);
  });

  it('reads disconnected when no gateway is configured — green would lie', async () => {
    vi.mocked(getGatewayStatus).mockResolvedValue([
      { name: 'Stripe', configured: false, online: false },
    ]);
    const { result } = renderHook(() => usePaymentConnection());
    await flush();
    expect(result.current.state).toBe('disconnected');
  });

  it('keeps the previous reading when the probe fails', async () => {
    // A broken config lookup is not evidence the service is down; the pill
    // must not paint an outage it did not observe.
    vi.mocked(getGatewayStatus)
      .mockResolvedValueOnce([{ name: 'Stripe', configured: true, online: true }])
      .mockRejectedValueOnce(new Error('ipc down'));
    const { result } = renderHook(() => usePaymentConnection());
    await flush();
    expect(result.current.state).toBe('connected');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.state).toBe('connected');
  });

  it('re-probes immediately on manual retry, superseding the pending poll', async () => {
    vi.mocked(getGatewayStatus).mockResolvedValue([{ name: 'Stripe', configured: true, online: true }]);
    const { result } = renderHook(() => usePaymentConnection());
    await flush();
    expect(getGatewayStatus).toHaveBeenCalledTimes(1);

    // Click retry ~30s into the 60s poll window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    act(() => {
      result.current.retryNow();
    });
    await flush();
    expect(getGatewayStatus).toHaveBeenCalledTimes(2);

    // The old 60s poll must not fire on top of the retry's fresh schedule.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(getGatewayStatus).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getGatewayStatus).toHaveBeenCalledTimes(3);
  });
});
