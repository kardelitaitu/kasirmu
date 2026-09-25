import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// The shifts API is mocked per-test so the load can be made to REJECT, which is
// what a shell that does not register the shift commands looks like from the UI:
// `get_active_shift_scoped` does not exist, so the invoke rejects.
const getActiveShiftScoped = vi.fn();
vi.mock('@/api/shifts', () => ({
  getActiveShiftScoped: (...a: unknown[]) => getActiveShiftScoped(...a),
  openShiftScoped: vi.fn(),
  closeShiftScoped: vi.fn(),
}));

import { usePosShifts } from '@/features/sales/hooks/usePosShifts';

const params = () => ({
  sessionToken: 'tok',
  userId: 'user-1',
  lines: [],
  l10nRef: { current: { getString: (id: string) => id } } as never,
});

describe('usePosShifts — shift-service availability', () => {
  beforeEach(() => {
    getActiveShiftScoped.mockReset();
  });

  it('flags the service UNAVAILABLE when the load rejects, instead of silently reading as no-shift-open', async () => {
    // This is the tablet's shape: the command is not registered, so it rejects.
    getActiveShiftScoped.mockRejectedValue(new Error('Command get_active_shift_scoped not found'));
    const { result } = renderHook(() => usePosShifts(params()));
    await waitFor(() => expect(result.current.shiftLoading).toBe(false));
    // Without the fix this was false and indistinguishable from an empty store,
    // which is what let an informational feature gate every sale.
    expect(result.current.shiftUnavailable).toBe(true);
    expect(result.current.shiftUnavailableRef.current).toBe(true);
    expect(result.current.activeShift).toBeNull();
  });

  it('stays AVAILABLE when a store simply has no shift open', async () => {
    // The no-shift-open store must keep the original behaviour: the guard applies.
    getActiveShiftScoped.mockResolvedValue(null);
    const { result } = renderHook(() => usePosShifts(params()));
    await waitFor(() => expect(result.current.shiftLoading).toBe(false));
    expect(result.current.shiftUnavailable).toBe(false);
    expect(result.current.activeShift).toBeNull();
  });

  it('leaves the flag set until a later load succeeds', async () => {
    getActiveShiftScoped.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => usePosShifts(params()));
    await waitFor(() => expect(result.current.shiftUnavailable).toBe(true));
    getActiveShiftScoped.mockResolvedValue(null);
    expect(result.current.shiftUnavailable).toBe(true);
  });
});
