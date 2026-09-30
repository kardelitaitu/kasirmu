import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useStoreTimezone } from '@/hooks/useStoreTimezone';
import { getPrimaryLocationScoped } from '@/api/locations';
import { HARNESS_SESSION_TOKEN } from '@/__tests__/test-utils/harnessDefaults';

vi.mock('@/api/locations', () => ({
  getPrimaryLocationScoped: vi.fn(),
}));

const mockPrimary = vi.mocked(getPrimaryLocationScoped);
const profile = (timezone: string) => ({ timezone }) as unknown as Awaited<ReturnType<typeof getPrimaryLocationScoped>>;

describe('useStoreTimezone', () => {
  beforeEach(() => {
    mockPrimary.mockReset();
  });

  it('hands back the store offset, not a device-derived guess', async () => {
    mockPrimary.mockResolvedValue(profile('+07:00'));
    const { result } = renderHook(() => useStoreTimezone());
    // null until the answer lands: the hook must not fall back to the host.
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe('+07:00'));
    expect(mockPrimary).toHaveBeenCalledWith(HARNESS_SESSION_TOKEN);
  });

  it('reports no zone rather than guessing when the store has none', async () => {
    mockPrimary.mockResolvedValue(profile(undefined as unknown as string));
    const { result } = renderHook(() => useStoreTimezone());
    await waitFor(() => expect(mockPrimary).toHaveBeenCalledTimes(1));
    // A null answer is a settled answer: the caller applies FALLBACK_STORE_TZ.
    expect(result.current).toBeNull();
  });

  it('survives a failed lookup by leaving the zone unknown', async () => {
    mockPrimary.mockRejectedValue(new Error('bridge down'));
    const { result } = renderHook(() => useStoreTimezone());
    await waitFor(() => expect(mockPrimary).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it('serves two callers mounted together from one request', async () => {
    mockPrimary.mockResolvedValue(profile('+09:00'));
    const a = renderHook(() => useStoreTimezone());
    const b = renderHook(() => useStoreTimezone());
    await waitFor(() => {
      expect(a.result.current).toBe('+09:00');
      expect(b.result.current).toBe('+09:00');
    });
    // The regression this hook exists for: three tiles used to ask three times.
    expect(mockPrimary).toHaveBeenCalledTimes(1);
  });

  it('re-asks on a later mount rather than serving a cached store zone', async () => {
    mockPrimary.mockResolvedValue(profile('+07:00'));
    const first = renderHook(() => useStoreTimezone());
    await waitFor(() => expect(first.result.current).toBe('+07:00'));
    first.unmount();
    // The old store's offset must not survive the switch, so the entry is
    // dropped on settle instead of kept as a value cache.
    mockPrimary.mockResolvedValue(profile('-10:00'));
    const second = renderHook(() => useStoreTimezone());
    await waitFor(() => expect(second.result.current).toBe('-10:00'));
    expect(mockPrimary).toHaveBeenCalledTimes(2);
  });

  it('does not touch the network when handed an explicit null token', async () => {
    const { result } = renderHook(() => useStoreTimezone(null));
    await waitFor(() => expect(result.current).toBeNull());
    expect(mockPrimary).not.toHaveBeenCalled();
  });

  it('asks for the token it was given, not the workspace one', async () => {
    mockPrimary.mockResolvedValue(profile('+07:00'));
    const { result } = renderHook(() => useStoreTimezone('other-session'));
    await waitFor(() => expect(result.current).toBe('+07:00'));
    expect(mockPrimary).toHaveBeenCalledWith('other-session');
  });
});
