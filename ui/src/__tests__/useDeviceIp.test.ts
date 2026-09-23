import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────

const mockGetLocalIp = vi.fn();
vi.mock('@/api/system', () => ({
  getLocalIp: (...args: unknown[]) => mockGetLocalIp(...args),
}));

import { useDeviceIp } from '@/hooks/useDeviceIp';

// ── Tests ──────────────────────────────────────────────────────────────

describe('useDeviceIp', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGetLocalIp.mockReset();
    // Prevent real network calls. The default rejection makes a test that
    // forgets to arm the lookup an offline terminal, not a DNS timeout.
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('returns public IP when ipify succeeds', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ip: '203.0.113.42' }),
    } as Response);
    mockGetLocalIp.mockResolvedValue('192.168.1.50');

    const { result } = renderHook(() => useDeviceIp());

    await waitFor(() => {
      expect(result.current.ip).toBe('203.0.113.42');
    });

    expect(result.current.local).toBe('192.168.1.50');
    expect(result.current.public).toBe('203.0.113.42');
    expect(result.current.source).toBe('public');
  });

  it('still reports the LAN address when the public lookup fails', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network error'));
    mockGetLocalIp.mockResolvedValue('192.168.1.50');

    const { result } = renderHook(() => useDeviceIp());

    await waitFor(() => {
      expect(result.current.local).toBe('192.168.1.50');
    });

    expect(result.current.public).toBeNull();
  });

  it('still reports the public address when getLocalIp fails', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ip: '203.0.113.42' }),
    } as Response);
    mockGetLocalIp.mockRejectedValue(new Error('no ip'));

    const { result } = renderHook(() => useDeviceIp());

    await waitFor(() => {
      expect(result.current.public).toBe('203.0.113.42');
    });

    expect(result.current.local).toBeNull();
  });

  it('falls back to local IP when ipify fails', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network error'));
    mockGetLocalIp.mockResolvedValue('192.168.1.50');

    const { result } = renderHook(() => useDeviceIp());

    await waitFor(() => {
      expect(result.current.ip).toBe('192.168.1.50');
    });

    expect(result.current.source).toBe('local');
  });

  it('returns null when both public and local fail', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network error'));
    mockGetLocalIp.mockRejectedValue(new Error('no ip'));

    const { result } = renderHook(() => useDeviceIp());

    await waitFor(() => {
      expect(result.current.ip).toBeNull();
    });

    expect(result.current.source).toBeNull();
  });

  it('returns null when ipify returns non-ok', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    } as Response);
    mockGetLocalIp.mockResolvedValue('10.0.0.1');

    const { result } = renderHook(() => useDeviceIp());

    await waitFor(() => {
      expect(result.current.ip).toBe('10.0.0.1');
    });

    expect(result.current.public).toBeNull();
    expect(result.current.source).toBe('local');
  });

  it('returns null when ipify returns empty ip', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ip: '' }),
    } as Response);
    mockGetLocalIp.mockResolvedValue('10.0.0.1');

    const { result } = renderHook(() => useDeviceIp());

    await waitFor(() => {
      expect(result.current.ip).toBe('10.0.0.1');
    });

    expect(result.current.source).toBe('local');
  });

  it('starts with null values before resolution', () => {
    fetchSpy.mockReturnValue(new Promise(() => {})); // never resolves
    mockGetLocalIp.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDeviceIp());

    expect(result.current.ip).toBeNull();
    expect(result.current.source).toBeNull();
  });
});
