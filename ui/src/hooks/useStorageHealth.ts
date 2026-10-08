import { useState, useEffect, useCallback } from 'react';
import { getStorageHealth, onAppReconnect, type StorageHealth } from '@/api/system';

const POLL_INTERVAL_MS = 60_000;

/**
 * Hook to monitor local storage capacity and detect low disk space (< 500 MB).
 */
export function useStorageHealth() {
  const [health, setHealth] = useState<StorageHealth | null>(null);

  const check = useCallback(async () => {
    try {
      const result = await getStorageHealth();
      setHealth(result);
    } catch {
      // Storage query failure is handled gracefully without throwing
    }
  }, []);

  useEffect(() => {
    void check();
    const interval = setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void onAppReconnect(() => {
      void check();
    }).then((cleanup) => {
      if (cancelled) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (unlisten) unlisten();
    };
  }, [check]);

  return {
    health,
    isLowSpace: health?.isLowSpace ?? false,
    refresh: check,
  };
}
