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

export interface UseBarcodeScannerOptions {
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
 * auto-lookup the product by barcode.
 *
 * Starts the scanner on mount and stops it on unmount.
 */
export function useBarcodeScanner({
  sessionToken,
  scannerId: preferredId,
  onProductFound,
  onProductNotFound,
  onError,
}: UseBarcodeScannerOptions) {
  const startedRef = useRef(false);

  // Keep callbacks in refs so the event subscription doesn't re-register
  // every time the parent passes a fresh inline callback (e.g. on every
  // cart change in RetailPosScreen). Matches the ref pattern used by
  // useFocusTrap and useExitAnimation.
  const onProductFoundRef = useRef(onProductFound);
  onProductFoundRef.current = onProductFound;
  const onProductNotFoundRef = useRef(onProductNotFound);
  onProductNotFoundRef.current = onProductNotFound;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Auto-detect scanner if no id was given.
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
        stop().catch(() => {
          // Cleanup on unmount — scanner may already be stopped.
        });
        startedRef.current = false;
      }
    };
  }, [preferredId, sessionToken]);

  const handleScan = useCallback(
    async (payload: BarcodeScannedPayload) => {
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
    },
    // "stable -- reads latest callbacks via refs" was the original reasoning, and it is true
    // of the callbacks: onProductFound/onProductNotFound/onError all go through refs. It is
    // false of sessionToken, which is a plain prop read at :83 to choose the scoped lookup.
    // With [] the closure kept the mount-time token. Reachable because FastPINOverlay performs
    // the cashier hot-swap on top of the mounted screen and swapSessionToken destroys the old
    // token (WorkspaceContext.tsx:273) before setting the new one, so a stale handleScan looks
    // up barcodes against a session that no longer exists. The mount effect at :78 already
    // lists sessionToken; this array just omitted it.
    [sessionToken],
  );

  const handleError = useCallback(
    (error: string) => {
      onErrorRef.current?.(error);
    },
    [], // stable — reads latest callback via ref
  );

  // Subscribe to barcode events once on mount — stable callbacks.
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
