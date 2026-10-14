/**
 * Concurrency lease for open bills / restaurant dining tabs.
 *
 * Implements optimistic conflict prevention across multi-terminal setups:
 * When a terminal resumes/edits a tab, it broadcasts a temporary lease.
 * Other terminals detect the active lease and warn waitstaff before they
 * accidentally overwrite or duplicate lines.
 */
import { useCallback, useEffect, useState } from 'react';
import { listen, emit, isTauriWebview } from '@/api/tauri';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';

export interface TabLease {
  tabId: string;
  tableNumber?: string;
  terminalId: string;
  terminalName: string;
  timestamp: number;
  expiresAt: number;
}

export const TAB_LEASE_DURATION_MS = 60_000; // 60 seconds auto-expiry

// Local in-memory registry shared across components in the same window
let memoryLeases: Record<string, TabLease> = {};
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

/** Test utility to reset in-memory leases between unit tests */
export function resetMemoryLeasesForTest() {
  memoryLeases = {};
  notifyListeners();
}

function useWorkspaceIfAvailable() {
  try {
    return useWorkspace();
  } catch {
    return null;
  }
}

function useAuthIfAvailable() {
  try {
    return useAuth();
  } catch {
    return null;
  }
}

export function useTabLeases() {
  const workspace = useWorkspaceIfAvailable();
  const auth = useAuthIfAvailable();
  const [leases, setLeases] = useState<Record<string, TabLease>>(memoryLeases);

  const currentTerminalId = workspace?.terminalId || 'local-terminal';
  const currentTerminalName =
    workspace?.activeInstance?.name || auth?.session?.display_name || 'Terminal';

  // Broadcast event across Tauri LAN and window custom events
  const broadcastEvent = useCallback(
    async (eventName: string, payload: unknown) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(`kasirmu:${eventName}`, { detail: payload }),
        );
      }
      if (isTauriWebview()) {
        try {
          await emit(eventName, payload);
        } catch {
          // Fallback or headless environment
        }
      }
    },
    [],
  );

  useEffect(() => {
    const handleUpdate = () => {
      // Purge expired leases
      const now = Date.now();
      const valid: Record<string, TabLease> = {};
      for (const [id, lease] of Object.entries(memoryLeases)) {
        if (lease.expiresAt > now) {
          valid[id] = lease;
        }
      }
      memoryLeases = valid;
      setLeases({ ...valid });
    };

    listeners.add(handleUpdate);

    // Tauri listener for lease acquired
    let unlistenAcquired: (() => void) | undefined;
    listen<TabLease>('tabs:lease-acquired', (event) => {
      if (event.payload && event.payload.tabId) {
        memoryLeases[event.payload.tabId] = event.payload;
        notifyListeners();
      }
    })
      .then((fn) => {
        unlistenAcquired = fn;
      })
      .catch(() => {});

    // Tauri listener for lease released
    let unlistenReleased: (() => void) | undefined;
    listen<{ tabId: string }>('tabs:lease-released', (event) => {
      if (event.payload && event.payload.tabId) {
        delete memoryLeases[event.payload.tabId];
        notifyListeners();
      }
    })
      .then((fn) => {
        unlistenReleased = fn;
      })
      .catch(() => {});

    // DOM event listener for in-window updates
    const domAcquired = (e: Event) => {
      const lease = (e as CustomEvent<TabLease>).detail;
      if (lease && lease.tabId) {
        memoryLeases[lease.tabId] = lease;
        notifyListeners();
      }
    };
    const domReleased = (e: Event) => {
      const detail = (e as CustomEvent<{ tabId: string }>).detail;
      if (detail && detail.tabId) {
        delete memoryLeases[detail.tabId];
        notifyListeners();
      }
    };

    window.addEventListener('kasirmu:tabs:lease-acquired', domAcquired);
    window.addEventListener('kasirmu:tabs:lease-released', domReleased);

    // Periodic cleanup of expired leases every 10s
    const interval = setInterval(handleUpdate, 10_000);

    return () => {
      listeners.delete(handleUpdate);
      unlistenAcquired?.();
      unlistenReleased?.();
      window.removeEventListener('kasirmu:tabs:lease-acquired', domAcquired);
      window.removeEventListener('kasirmu:tabs:lease-released', domReleased);
      clearInterval(interval);
    };
  }, []);

  const claimLease = useCallback(
    async (tabId: string, tableNumber?: string) => {
      if (!tabId) return;
      const now = Date.now();
      const lease: TabLease = {
        tabId,
        ...(tableNumber ? { tableNumber } : {}),
        terminalId: currentTerminalId,
        terminalName: currentTerminalName,
        timestamp: now,
        expiresAt: now + TAB_LEASE_DURATION_MS,
      };
      memoryLeases[tabId] = lease;
      notifyListeners();
      await broadcastEvent('tabs:lease-acquired', lease);
    },
    [currentTerminalId, currentTerminalName, broadcastEvent],
  );

  const releaseLease = useCallback(
    async (tabId: string) => {
      if (!tabId) return;
      delete memoryLeases[tabId];
      notifyListeners();
      await broadcastEvent('tabs:lease-released', { tabId });
    },
    [broadcastEvent],
  );

  const forceTakeover = useCallback(
    async (tabId: string, tableNumber?: string) => {
      await claimLease(tabId, tableNumber);
    },
    [claimLease],
  );

  const getConflict = useCallback(
    (tabId?: string | null): TabLease | null => {
      if (!tabId) return null;
      const lease = leases[tabId];
      if (!lease) return null;
      if (lease.expiresAt <= Date.now()) return null;
      if (lease.terminalId === currentTerminalId) return null;
      return lease;
    },
    [leases, currentTerminalId],
  );

  return {
    leases,
    currentTerminalId,
    currentTerminalName,
    claimLease,
    releaseLease,
    forceTakeover,
    getConflict,
  };
}
