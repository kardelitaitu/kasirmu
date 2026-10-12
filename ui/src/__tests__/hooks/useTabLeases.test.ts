import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useTabLeases,
  resetMemoryLeasesForTest,
  TAB_LEASE_DURATION_MS,
  type TabLease,
} from '@/features/sales/hooks/useTabLeases';

describe('useTabLeases hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMemoryLeasesForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetMemoryLeasesForTest();
  });

  it('claims and stores a local lease for a tab', async () => {
    const { result } = renderHook(() => useTabLeases());

    await act(async () => {
      await result.current.claimLease('tab-123', 'Table 4');
    });

    expect(result.current.leases['tab-123']).toBeDefined();
    expect(result.current.leases['tab-123']?.tabId).toBe('tab-123');
    expect(result.current.leases['tab-123']?.tableNumber).toBe('Table 4');
    expect(result.current.leases['tab-123']?.terminalId).toBe('local-terminal');
    // Local lease should not be flagged as a conflict for own terminal
    expect(result.current.getConflict('tab-123')).toBeNull();
  });

  it('detects foreign terminal lease as conflict', async () => {
    const { result } = renderHook(() => useTabLeases());

    const foreignLease: TabLease = {
      tabId: 'tab-456',
      tableNumber: 'Table 10',
      terminalId: 'terminal-ipad-waiter',
      terminalName: 'Waiter iPad 1',
      timestamp: Date.now(),
      expiresAt: Date.now() + TAB_LEASE_DURATION_MS,
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent('kasirmu:tabs:lease-acquired', { detail: foreignLease }),
      );
    });

    expect(result.current.leases['tab-456']).toBeDefined();
    const conflict = result.current.getConflict('tab-456');
    expect(conflict).not.toBeNull();
    expect(conflict?.terminalId).toBe('terminal-ipad-waiter');
    expect(conflict?.terminalName).toBe('Waiter iPad 1');
  });

  it('expires lease after TAB_LEASE_DURATION_MS', async () => {
    const { result } = renderHook(() => useTabLeases());

    const foreignLease: TabLease = {
      tabId: 'tab-exp',
      tableNumber: 'Table 2',
      terminalId: 'terminal-bar',
      terminalName: 'Bar Terminal',
      timestamp: Date.now(),
      expiresAt: Date.now() + 10_000, // 10s expiry
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent('kasirmu:tabs:lease-acquired', { detail: foreignLease }),
      );
    });

    expect(result.current.getConflict('tab-exp')).not.toBeNull();

    // Advance clock past expiration
    act(() => {
      vi.advanceTimersByTime(11_000);
    });

    expect(result.current.getConflict('tab-exp')).toBeNull();
  });

  it('releases lease on request and cleans up via event', async () => {
    const { result } = renderHook(() => useTabLeases());

    await act(async () => {
      await result.current.claimLease('tab-rel', 'Table 1');
    });
    expect(result.current.leases['tab-rel']).toBeDefined();

    await act(async () => {
      await result.current.releaseLease('tab-rel');
    });
    expect(result.current.leases['tab-rel']).toBeUndefined();
  });

  it('allows forceTakeover to override a foreign lease', async () => {
    const { result } = renderHook(() => useTabLeases());

    const foreignLease: TabLease = {
      tabId: 'tab-contested',
      tableNumber: 'Table 8',
      terminalId: 'foreign-terminal-pos2',
      terminalName: 'POS 2',
      timestamp: Date.now(),
      expiresAt: Date.now() + TAB_LEASE_DURATION_MS,
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent('kasirmu:tabs:lease-acquired', { detail: foreignLease }),
      );
    });

    expect(result.current.getConflict('tab-contested')?.terminalId).toBe('foreign-terminal-pos2');

    // Force takeover
    await act(async () => {
      await result.current.forceTakeover('tab-contested', 'Table 8');
    });

    // Now current terminal holds it
    expect(result.current.leases['tab-contested']?.terminalId).toBe('local-terminal');
    // Conflict cleared for local terminal
    expect(result.current.getConflict('tab-contested')).toBeNull();
  });
});
