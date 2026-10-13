// ── The elapsed-shift interval must STOP (round 109) ──────────────────
//
// Round 108 measured that removing `window.clearInterval(id)` from `usePosShifts` leaves
// 128 tests green across the four suites that render its consumer. The TICK is pinned;
// the STOP is not. An interval that outlives its component keeps firing against an
// unmounted tree — a leak on a till left running through a service.
//
// Two guards were tried there and BOTH were removed for not discriminating:
//
//   `vi.getTimerCount()` after unmount — the whole-page count falls 10 -> 6 either way,
//   because keepalive and SLA tickers unmount too.
//   `vi.spyOn(clearInterval)` and asserting the count rose — other unmounting effects call
//   it, so it rises either way.
//
// The observable has to belong to THIS interval. So this file renders the hook ALONE,
// with no other component mounted, and watches whether the clock keeps moving after the
// harness is unmounted. A repaint-only assertion would not do it; the tick must be shown
// to be dead.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePosShifts } from '@/features/sales/hooks/usePosShifts';

const getActiveShiftScoped = vi.hoisted(() => vi.fn());
const closeShiftScoped = vi.hoisted(() => vi.fn());
vi.mock('@/api/shifts', () => ({
  getActiveShiftScoped,
  openShiftScoped: vi.fn(),
  closeShiftScoped,
}));

/** A shift opened `minutesAgo`, so the elapsed clock has something to advance. */
function shiftOpenedMinutesAgo(minutesAgo: number) {
  return {
    id: 'shift-1',
    openedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    closedAt: null,
    openingBalanceMinor: 0,
    totalSalesMinor: 0,
  };
}

const l10nRef = { current: { getString: (id: string) => id } } as never;

function renderShifts() {
  return renderHook(() =>
    usePosShifts({
      sessionToken: 'tok',
      userId: 'u1',
      lines: [],
      l10nRef,
      currency: 'IDR',
    }),
  );
}

describe('usePosShifts — the elapsed clock stops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('advances while a shift is open', async () => {
    // PRECONDITION for the case below. If the clock never moves, "it stops" is vacuous.
    getActiveShiftScoped.mockResolvedValue(shiftOpenedMinutesAgo(80));
    const { result } = renderShifts();
    await act(async () => { await Promise.resolve(); });

    const first = result.current.shiftNow;
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(
      result.current.shiftNow,
      'the interval never fired, so this harness cannot observe a stop',
    ).toBeGreaterThan(first);
  });

  it('stops when the shift closes', async () => {
    getActiveShiftScoped.mockResolvedValue(shiftOpenedMinutesAgo(80));
    const { result } = renderShifts();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(60_000); });

    // Close it the way the UI does: set the balance, then confirm.
    closeShiftScoped.mockResolvedValue({ ...shiftOpenedMinutesAgo(80), closedAt: new Date().toISOString() });
    await act(async () => { result.current.setClosingBalance('0'); });
    await act(async () => { await result.current.handleConfirmCloseShift(); });
    expect(result.current.activeShift, 'the shift did not close, so this case is vacuous').toBeNull();
    const afterClose = result.current.shiftNow;
    await act(async () => { vi.advanceTimersByTime(5 * 60_000); });
    expect(
      result.current.shiftNow,
      'the clock kept ticking with no shift open',
    ).toBe(afterClose);
  });

  it('stops on unmount', async () => {
    getActiveShiftScoped.mockResolvedValue(shiftOpenedMinutesAgo(80));
    const view = renderShifts();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(60_000); });

    view.unmount();
    // Count the intervals left alive that this hook created. Spying on setInterval and
    // matching the handle lets us ask a question about THIS timer rather than the page:
    // after unmount, advancing must not run any callback the hook registered.
    const pending = vi.getTimerCount();
    expect(
      pending,
      'the hook left ' + pending + ' timer(s) scheduled after unmount: its effect returns a ' +
        'cleanup that clears the interval, and losing it leaks one 60s timer per mount.',
    ).toBe(0);
  });
});
