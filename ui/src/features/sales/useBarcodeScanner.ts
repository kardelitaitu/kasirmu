import { useEffect, useRef, useCallback } from 'react';
import {
  startScannerScoped,
  stopScannerScoped,
  onBarcodeScanned,
  onBarcodeError,
  listScannersScoped,
  type BarcodeScannedPayload,
} from '@/api/hardware';
import { lookupByBarcodeScoped } from '@/api/products';

export interface UseBarcodeScannerOptions {
  /** Whether the scanner integration is enabled. Defaults to true. */
  enabled?: boolean;
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
  enabled = true,
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

    // Do nothing if scanner is disabled or session token is missing.
    if (!enabled || !sessionToken) return;

    (async () => {
      // Auto-detect scanner if no id was given.
      const scannerId = preferredId ?? (await autoDetectScanner(sessionToken));

      if (!scannerId || cancelled) return;

      await startScannerScoped(sessionToken, scannerId);
      startedRef.current = true;
    })();

    return () => {
      cancelled = true;
      if (startedRef.current && sessionToken) {
        stopScannerScoped(sessionToken).catch(() => {
          // Cleanup on unmount — scanner may already be stopped.
        });
        startedRef.current = false;
      }
    };
  }, [enabled, preferredId, sessionToken]);

  const handleScan = useCallback(
    async (payload: BarcodeScannedPayload) => {
      if (!enabled) return;
      // T21 (b2): `lookup_by_barcode` is registered in neither shell -- the tablet has an
      // unregistered body and the desktop has no body at all -- so the fallback half could only
      // answer "command not found". PosScreen.tsx:290 and RetailPosScreen.tsx:842 already call the
      // scoped twin directly; this hook was the last production caller of the unscoped one.
      // A scan with no session has no store to look up against, so it reports not-found, which is
      // the same outcome the `catch` below already gave for a failed lookup.
      if (!sessionToken) {
        onProductNotFoundRef.current?.(payload.code);
        return;
      }
      try {
        const product = await lookupByBarcodeScoped(sessionToken, payload.code);
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
    [enabled, sessionToken],
  );

  const handleError = useCallback(
    (error: string) => {
      if (!enabled) return;
      onErrorRef.current?.(error);
    },
    [enabled], // stable — reads latest callback via ref
  );

  // Subscribe to barcode events once on mount / when enabled changes — stable callbacks.
  useEffect(() => {
    if (!enabled) return;
    const unsubScan = onBarcodeScanned(handleScan);
    const unsubErr = onBarcodeError(handleError);
    return () => {
      unsubScan.then((fn) => fn());
      unsubErr.then((fn) => fn());
    };
  }, [enabled, handleScan, handleError]);
}

async function autoDetectScanner(sessionToken: string): Promise<string | null> {
  try {
    const scanners = await listScannersScoped(sessionToken);
    return scanners[0]?.id ?? null;
  } catch {
    return null;
  }
}
