import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderHookInAct } from '@/test-utils/renderInAct';
import { useBarcodeScanner } from '@/features/sales/useBarcodeScanner';

const mocks = vi.hoisted(() => ({
  startScanner: vi.fn(),
  stopScanner: vi.fn(),
  onBarcodeScanned: vi.fn(),
  onBarcodeError: vi.fn(),
  listScanners: vi.fn(),
  lookupByBarcode: vi.fn(),
  // The scoped twins. useBarcodeScanner picks its API per call with
  //   sessionToken ? () => xScoped(sessionToken, ...) : x
  // at :63, :71, :83 and :117 -- added by 403030ad ("migrate remaining frontend
  // components to scoped APIs"), which did not touch this file. Without these keys the
  // mocked module has no such export, so any test that passed a sessionToken would call
  // undefined and throw "xScoped is not a function": all four scoped branches were
  // unrenderable, not merely uncovered. Same defect as WeightScaleWidget.test.tsx, fixed
  // in 65971d0f, found by scanning for subjects that call a name their test omits.
  startScannerScoped: vi.fn(),
  stopScannerScoped: vi.fn(),
  listScannersScoped: vi.fn(),
  lookupByBarcodeScoped: vi.fn(),
}));

vi.mock('@/api/hardware', () => ({
  startScanner: (...args: unknown[]) => mocks.startScanner(...args),
  stopScanner: (...args: unknown[]) => mocks.stopScanner(...args),
  onBarcodeScanned: (...args: unknown[]) => mocks.onBarcodeScanned(...args),
  onBarcodeError: (...args: unknown[]) => mocks.onBarcodeError(...args),
  listScanners: (...args: unknown[]) => mocks.listScanners(...args),
  startScannerScoped: (...args: unknown[]) => mocks.startScannerScoped(...args),
  stopScannerScoped: (...args: unknown[]) => mocks.stopScannerScoped(...args),
  listScannersScoped: (...args: unknown[]) => mocks.listScannersScoped(...args),
}));

vi.mock('@/api/products', () => ({
  lookupByBarcode: (...args: unknown[]) => mocks.lookupByBarcode(...args),
  lookupByBarcodeScoped: (...args: unknown[]) => mocks.lookupByBarcodeScoped(...args),
}));

function makeOpts(overrides: Record<string, unknown> = {}) {
  return {
    onProductFound: vi.fn(),
    onProductNotFound: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.startScanner.mockResolvedValue(undefined);
  mocks.stopScanner.mockResolvedValue(undefined);
  mocks.listScanners.mockResolvedValue([{ id: 'scanner-1' }]);
  mocks.onBarcodeScanned.mockResolvedValue(() => {});
  mocks.onBarcodeError.mockResolvedValue(() => {});
  mocks.lookupByBarcode.mockResolvedValue({ sku: 'LATTE', name: 'Latte' });
  // Scoped twins default to the same shapes, so a scoped-path test differs from an
  // unscoped one only in which mock records the call.
  mocks.listScannersScoped.mockResolvedValue([{ id: 'scanner-1' }]);
  mocks.startScannerScoped.mockResolvedValue(undefined);
  mocks.stopScannerScoped.mockResolvedValue(undefined);
  mocks.lookupByBarcodeScoped.mockResolvedValue({ sku: 'LATTE', name: 'Latte' });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('useBarcodeScanner', () => {
  describe('scanner lifecycle', () => {
    it('auto-detects and starts the first available scanner on mount', async () => {
      await renderHookInAct(() => useBarcodeScanner(makeOpts()));

      expect(mocks.listScanners).toHaveBeenCalled();
      expect(mocks.startScanner).toHaveBeenCalledWith('scanner-1');
    });

    it('uses the provided scannerId instead of auto-detecting', async () => {
      await renderHookInAct(() => useBarcodeScanner(makeOpts({ scannerId: 'my-scanner' })));

      expect(mocks.listScanners).not.toHaveBeenCalled();
      expect(mocks.startScanner).toHaveBeenCalledWith('my-scanner');
    });

    it('does not start scanner when auto-detect returns no scanners', async () => {
      mocks.listScanners.mockResolvedValue([]);

      await renderHookInAct(() => useBarcodeScanner(makeOpts()));

      expect(mocks.startScanner).not.toHaveBeenCalled();
    });

    it('does not start scanner when auto-detect throws', async () => {
      mocks.listScanners.mockRejectedValue(new Error('no backend'));

      await renderHookInAct(() => useBarcodeScanner(makeOpts()));

      expect(mocks.startScanner).not.toHaveBeenCalled();
    });

    it('stops the scanner on unmount when it was started', async () => {
      const { unmount } = await renderHookInAct(() => useBarcodeScanner(makeOpts()));

      unmount();

      expect(mocks.stopScanner).toHaveBeenCalled();
    });

    it('does not stop the scanner on unmount when it was never started', async () => {
      mocks.listScanners.mockResolvedValue([]);
      const { unmount } = await renderHookInAct(() => useBarcodeScanner(makeOpts()));

      unmount();

      expect(mocks.stopScanner).not.toHaveBeenCalled();
    });
  });

  describe('event subscriptions', () => {
    it('subscribes to barcode:scanned on mount', async () => {
      await renderHookInAct(() => useBarcodeScanner(makeOpts()));

      expect(mocks.onBarcodeScanned).toHaveBeenCalled();
    });

    it('subscribes to barcode:error on mount', async () => {
      await renderHookInAct(() => useBarcodeScanner(makeOpts()));

      expect(mocks.onBarcodeError).toHaveBeenCalled();
    });

    it('unsubscribes from both events on unmount', async () => {
      const unsubScan = vi.fn<() => void>();
      const unsubErr = vi.fn<() => void>();
      mocks.onBarcodeScanned.mockResolvedValue(unsubScan);
      mocks.onBarcodeError.mockResolvedValue(unsubErr);

      const { unmount } = await renderHookInAct(() => useBarcodeScanner(makeOpts()));

      act(() => { unmount(); });

      // The cleanup effect resolves the unsubscribe promises as microtasks
      await vi.waitFor(() => {
        expect(unsubScan).toHaveBeenCalled();
        expect(unsubErr).toHaveBeenCalled();
      });
    });
  });

  describe('handleScan callback', () => {
    it('calls onProductFound when barcode matches a product', async () => {
      const onProductFound = vi.fn();
      const payload = { code: '4901234567890', symbology: 'ean13' };
      mocks.lookupByBarcode.mockResolvedValue({ sku: 'LATTE', name: 'Latte' });

      await renderHookInAct(() => useBarcodeScanner(makeOpts({ onProductFound })));

      const scanHandler = mocks.onBarcodeScanned.mock.calls[0]![0];
      await scanHandler(payload);

      expect(onProductFound).toHaveBeenCalledWith(payload);
    });

    it('calls onProductNotFound when barcode matches no product', async () => {
      const onProductNotFound = vi.fn();
      const payload = { code: '0000000000000', symbology: 'ean13' };
      mocks.lookupByBarcode.mockResolvedValue(null);

      await renderHookInAct(() => useBarcodeScanner(makeOpts({ onProductNotFound })));

      const scanHandler = mocks.onBarcodeScanned.mock.calls[0]![0];
      await scanHandler(payload);

      expect(onProductNotFound).toHaveBeenCalledWith('0000000000000');
    });

    it('calls onProductNotFound when lookup throws', async () => {
      const onProductNotFound = vi.fn();
      const payload = { code: '0000000000000', symbology: 'ean13' };
      mocks.lookupByBarcode.mockRejectedValue(new Error('db error'));

      await renderHookInAct(() => useBarcodeScanner(makeOpts({ onProductNotFound })));

      const scanHandler = mocks.onBarcodeScanned.mock.calls[0]![0];
      await scanHandler(payload);

      expect(onProductNotFound).toHaveBeenCalledWith('0000000000000');
    });

    it('calls onProductNotFound when lookup returns a dto with null sku', async () => {
      const onProductNotFound = vi.fn();
      const payload = { code: '0000000000000', symbology: 'ean13' };
      mocks.lookupByBarcode.mockResolvedValue(null);

      await renderHookInAct(() => useBarcodeScanner(makeOpts({ onProductNotFound })));

      const scanHandler = mocks.onBarcodeScanned.mock.calls[0]![0];
      await scanHandler(payload);

      expect(onProductNotFound).toHaveBeenCalledWith('0000000000000');
    });

    it('does not call onProductNotFound when handler is not provided', async () => {
      const payload = { code: '0000000000000', symbology: 'ean13' };
      mocks.lookupByBarcode.mockResolvedValue(null);

      await renderHookInAct(() => useBarcodeScanner(makeOpts({ onProductNotFound: undefined })));

      const scanHandler = mocks.onBarcodeScanned.mock.calls[0]![0];

      await expect(scanHandler(payload)).resolves.toBeUndefined();
    });
  });

  describe('handleError callback', () => {
    it('calls onError when a scanner error is received', async () => {
      const onError = vi.fn();

      await renderHookInAct(() => useBarcodeScanner(makeOpts({ onError })));

      const errorHandler = mocks.onBarcodeError.mock.calls[0]![0];
      errorHandler('scanner disconnected');

      expect(onError).toHaveBeenCalledWith('scanner disconnected');
    });

    it('does not throw when onError is not provided', async () => {
      await renderHookInAct(() => useBarcodeScanner(makeOpts({ onError: undefined })));

      const errorHandler = mocks.onBarcodeError.mock.calls[0]![0];

      expect(() => errorHandler('some error')).not.toThrow();
    });
  });

  describe('idempotency', () => {
    it('re-starts scanner when preferredId changes', async () => {
      mocks.startScanner.mockClear();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { rerender } = await (renderHookInAct as any)(
        ({ scannerId }: { scannerId?: string }) => useBarcodeScanner(makeOpts({ scannerId })),
        { initialProps: { scannerId: 'scanner-1' } },
      );

      mocks.startScanner.mockClear();
      rerender({ scannerId: 'scanner-2' });

      expect(mocks.startScanner).toHaveBeenCalledWith('scanner-2');
      await vi.waitFor(() => {});
    });
  });

  // ── Scoped vs unscoped API selection ───────────────────────────
  //
  // Four branches, one per operation, each choosing by the presence of sessionToken:
  //   :63  start   :71  stop   :83  lookup   :117  listScanners
  // None of them could be exercised before this block: the mock module did not export the
  // scoped names at all, so a test that passed a token threw "xScoped is not a function"
  // rather than failing an assertion.

  describe('scoped vs unscoped API selection', () => {
    it('starts and lists through the scoped API when a session token is given', async () => {
      await renderHookInAct(() => useBarcodeScanner(makeOpts({ sessionToken: 'tok-1' })));

      // The token has to reach the command or the backend cannot resolve a store.
      expect(mocks.listScannersScoped).toHaveBeenCalledWith('tok-1');
      expect(mocks.startScannerScoped).toHaveBeenCalledWith('tok-1', 'scanner-1');
      // And the unscoped pair must stay untouched: those read the ambient store, which is
      // precisely what the scoped migration exists to prevent.
      expect(mocks.listScanners).not.toHaveBeenCalled();
      expect(mocks.startScanner).not.toHaveBeenCalled();
    });

    it('stops through the scoped API on unmount when a token was given', async () => {
      const { unmount } = await renderHookInAct(
        () => useBarcodeScanner(makeOpts({ sessionToken: 'tok-1' })));

      unmount();

      expect(mocks.stopScannerScoped).toHaveBeenCalledWith('tok-1');
      expect(mocks.stopScanner).not.toHaveBeenCalled();
    });

    it('falls back to the unscoped API when no token is given', async () => {
      await renderHookInAct(() => useBarcodeScanner(makeOpts()));

      expect(mocks.listScanners).toHaveBeenCalled();
      expect(mocks.startScanner).toHaveBeenCalledWith('scanner-1');
      expect(mocks.listScannersScoped).not.toHaveBeenCalled();
      expect(mocks.startScannerScoped).not.toHaveBeenCalled();
    });

    it('looks up a scanned barcode through the scoped API when a token is given', async () => {
      // Added after per-branch sabotage: the first three tests here left :83 unguarded.
      // Flipping that one ternary to the unscoped path changed nothing, which a single
      // all-at-once sabotage would have hidden behind three passing assertions.
      await renderHookInAct(() => useBarcodeScanner(makeOpts({ sessionToken: 'tok-1' })));

      const scanHandler = mocks.onBarcodeScanned.mock.calls[0]![0];
      await scanHandler({ code: '1234567890', scannerId: 'scanner-1' });

      expect(mocks.lookupByBarcodeScoped).toHaveBeenCalledWith('tok-1', '1234567890');
      expect(mocks.lookupByBarcode).not.toHaveBeenCalled();
    });

    it('looks up through the unscoped API when no token is given', async () => {
      await renderHookInAct(() => useBarcodeScanner(makeOpts()));

      const scanHandler = mocks.onBarcodeScanned.mock.calls[0]![0];
      await scanHandler({ code: '1234567890', scannerId: 'scanner-1' });

      expect(mocks.lookupByBarcode).toHaveBeenCalledWith('1234567890');
      expect(mocks.lookupByBarcodeScoped).not.toHaveBeenCalled();
    });
  });
});
