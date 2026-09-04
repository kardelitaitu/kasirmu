// ── ui/src/features/warehouse/useWarehouseScanner.ts ─────────────────────
// Barcode scanner integration for the warehouse console.
// Self-contained copy of sales/useBarcodeScanner.ts — same mechanics,
// no shared imports. The warehouse resolves barcodes against products
// and feeds them into the warehouse session.

import { useEffect, useRef, useCallback } from 'react';
import {
  startScanner,
  stopScanner,
  startScannerScoped,
  stopScannerScoped,
  onBarcodeScanned,
  onBarcodeError,
  listScanners,
  listScannersScoped,
  type BarcodeScannedPayload,
} from '@/api/hardware';
import { lookupByBarcode, lookupByBarcodeScoped } from '@/api/products';

export interface UseWarehouseScannerOptions {
  /** Session token for scoped API calls. */
  sessionToken?: string;
  /** Scanner device id. Defaults to auto-select first available. */
  scannerId?: string;
  /** Called when a barcode is decoded and the product is found. */
  onProductFound: (payload: BarcodeScannedPayload) => void;
  /** Called when a barcode is decoded but no product matches. */
  onProductNotFound?: (code: string) => void;
  /** Called on scanner errors. */
  onError?: (error: string) => void;
}

/**
 * Subscribe to `barcode:scanned` events from the Tauri backend and
 * auto-lookup the product by barcode. Starts on mount, stops on unmount.
 */
export function useWarehouseScanner({
  sessionToken,
  scannerId: preferredId,
  onProductFound,
  onProductNotFound,
  onError,
}: UseWarehouseScannerOptions) {
  const startedRef = useRef(false);

  const onProductFoundRef = useRef(onProductFound);
  onProductFoundRef.current = onProductFound;
  const onProductNotFoundRef = useRef(onProductNotFound);
  onProductNotFoundRef.current = onProductNotFound;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const scannerId = preferredId ?? (await autoDetectScanner(sessionToken));
      if (!scannerId || cancelled) return;
      const start = sessionToken ? (id: string) => startScannerScoped(sessionToken, id) : startScanner;
      await start(scannerId);
      startedRef.current = true;
    })();

    return () => {
      cancelled = true;
      if (startedRef.current) {
        const stop = sessionToken ? () => stopScannerScoped(sessionToken) : stopScanner;
        stop().catch(() => {});
        startedRef.current = false;
      }
    };
  }, [preferredId, sessionToken]);

  const handleScan = useCallback(async (payload: BarcodeScannedPayload) => {
    try {
      const lookup = sessionToken ? (code: string) => lookupByBarcodeScoped(sessionToken, code) : lookupByBarcode;
      const product = await lookup(payload.code);
      if (product) {
        onProductFoundRef.current(payload);
      } else {
        onProductNotFoundRef.current?.(payload.code);
      }
    } catch {
      onProductNotFoundRef.current?.(payload.code);
    }
    // sessionToken is read in the body (:77) to choose the scoped lookup, so it has to be a
    // dependency. The callbacks are all behind refs precisely so this array can stay small and
    // stable -- but a plain prop is not a ref, and with [] here the closure kept the token from
    // the first render forever. A screen mounted before login, or kept alive across a store
    // switch, scanned against the previous session. Adding it re-runs the subscription effect
    // at :93, which is what that effect's [handleScan, handleError] deps were already for.
  }, [sessionToken]);

  const handleError = useCallback((error: string) => {
    onErrorRef.current?.(error);
  }, []);

  useEffect(() => {
    const unsubScan = onBarcodeScanned(handleScan);
    const unsubErr = onBarcodeError(handleError);
    return () => {
      unsubScan.then((fn) => fn());
      unsubErr.then((fn) => fn());
    };
  }, [handleScan, handleError]);
}

async function autoDetectScanner(sessionToken?: string): Promise<string | null> {
  try {
    const fetchScanners = sessionToken ? () => listScannersScoped(sessionToken) : listScanners;
    const scanners = await fetchScanners();
    return scanners[0]?.id ?? null;
  } catch {
    return null;
  }
}