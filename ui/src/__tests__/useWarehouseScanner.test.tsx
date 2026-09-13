// ── useWarehouseScanner tests ──────────────────────────────────────
//
// First test file for this hook: it had four conditional-scoping branches
// (:60 start, :68 stop, :77 lookup, :105 autoDetect) and no test that could
// reach any of them. Written as the twin of useBarcodeScanner.test.tsx
// (0b7f9e18) after confirming the two hooks share the same API imports,
// callbacks, options shape and ternaries -- but asserting what THIS file
// does, not what the copy does (see "passes the payload, not the product").

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderHookInAct } from '@/test-utils/renderInAct';
import { useWarehouseScanner } from '@/features/warehouse/useWarehouseScanner';

const mocks = vi.hoisted(() => ({
  startScanner: vi.fn(),
  stopScanner: vi.fn(),
  onBarcodeScanned: vi.fn(),
  onBarcodeError: vi.fn(),
  listScanners: vi.fn(),
  lookupByBarcode: vi.fn(),
  // The scoped twins. useWarehouseScanner picks its API per call with
  //   sessionToken ? () => xScoped(sessionToken, ...) : x
  // at :60, :68, :77 and :105 -- added by 403030ad ("migrate remaining frontend
  // components to scoped APIs"). Without these the mocked module has no such export, so a
  // test passing a sessionToken would call undefined and throw "xScoped is not a
  // function": every scoped branch unrenderable, not merely uncovered. Same defect as
  // WeightScaleWidget (65971d0f), useBarcodeScanner (0b7f9e18) and ScaleIndicator
  // (29bb5586) -- this is the fourth and last file with it.
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

const payload = { code: 'WH-001', scannerId: 'scanner-1' };

beforeEach(() => {
  mocks.startScanner.mockResolvedValue(undefined);
  mocks.stopScanner.mockResolvedValue(undefined);
  mocks.listScanners.mockResolvedValue([{ id: 'scanner-1' }]);
  mocks.onBarcodeScanned.mockResolvedValue(() => {});
  mocks.onBarcodeError.mockResolvedValue(() => {});
  mocks.lookupByBarcode.mockResolvedValue({ sku: 'WH-001', name: 'Widget' });
  // Scoped twins mirror the unscoped defaults so a scoped-path test differs only in which
  // mock records the call.
  mocks.startScannerScoped.mockResolvedValue(undefined);
  mocks.stopScannerScoped.mockResolvedValue(undefined);
  mocks.listScannersScoped.mockResolvedValue([{ id: 'scanner-1' }]);
  mocks.lookupByBarcodeScoped.mockResolvedValue({ sku: 'WH-001', name: 'Widget' });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('useWarehouseScanner', () => {
  describe('scanner lifecycle', () => {
    it('auto-detects and starts the first available scanner on mount', async () => {
      await renderHookInAct(() => useWarehouseScanner(makeOpts()));

      expect(mocks.listScanners).toHaveBeenCalled();
      expect(mocks.startScanner).toHaveBeenCalledWith('scanner-1');
    });

    it('uses the provided scannerId instead of auto-detecting', async () => {
      await renderHookInAct(() => useWarehouseScanner(makeOpts({ scannerId: 'wh-9' })));

      expect(mocks.listScanners).not.toHaveBeenCalled();
      expect(mocks.startScanner).toHaveBeenCalledWith('wh-9');
    });

    it('does not start when auto-detect returns no scanners', async () => {
      mocks.listScanners.mockResolvedValue([]);

      await renderHookInAct(() => useWarehouseScanner(makeOpts()));

      expect(mocks.startScanner).not.toHaveBeenCalled();
    });

    it('does not start when auto-detect throws', async () => {
      mocks.listScanners.mockRejectedValue(new Error('no backend'));

      await renderHookInAct(() => useWarehouseScanner(makeOpts()));

      expect(mocks.startScanner).not.toHaveBeenCalled();
    });

    it('stops the scanner on unmount when it was started', async () => {
      const { unmount } = await renderHookInAct(
        () => useWarehouseScanner(makeOpts()));

      unmount();
      await act(async () => { await Promise.resolve(); });

      expect(mocks.stopScanner).toHaveBeenCalled();
    });
  });

  describe('scan handling', () => {
    it('reports a matched product through onProductFound with the PAYLOAD', async () => {
      // This hook passes `payload`, not the looked-up product (useWarehouseScanner.ts:80).
      // Asserted explicitly because the barcode twin differs here, and a copied test would
      // have asserted the wrong object.
      await renderHookInAct(() => useWarehouseScanner(makeOpts()));
      const onProductFound = vi.fn();
      await renderHookInAct(() => useWarehouseScanner(makeOpts({ onProductFound })));
      const scanHandler = mocks.onBarcodeScanned.mock.calls.at(-1)![0];

      await scanHandler(payload);

      expect(onProductFound).toHaveBeenCalledWith(payload);
    });

    it('reports an unmatched code through onProductNotFound', async () => {
      mocks.lookupByBarcode.mockResolvedValue(null);
      const onProductNotFound = vi.fn();

      await renderHookInAct(() => useWarehouseScanner(makeOpts({ onProductNotFound })));
      const scanHandler = mocks.onBarcodeScanned.mock.calls.at(-1)![0];

      await scanHandler(payload);

      expect(onProductNotFound).toHaveBeenCalledWith('WH-001');
    });

    it('treats a lookup that throws as not-found rather than surfacing an error', async () => {
      mocks.lookupByBarcode.mockRejectedValue(new Error('db down'));
      const onProductNotFound = vi.fn();
      const onError = vi.fn();

      await renderHookInAct(() =>
        useWarehouseScanner(makeOpts({ onProductNotFound, onError })));
      const scanHandler = mocks.onBarcodeScanned.mock.calls.at(-1)![0];

      await scanHandler(payload);

      expect(onProductNotFound).toHaveBeenCalledWith('WH-001');
      expect(onError).not.toHaveBeenCalled();
    });

    it('routes a scanner error to onError', async () => {
      const onError = vi.fn();
      await renderHookInAct(() => useWarehouseScanner(makeOpts({ onError })));
      const errorHandler = mocks.onBarcodeError.mock.calls.at(-1)![0];

      errorHandler('device unplugged');

      expect(onError).toHaveBeenCalledWith('device unplugged');
    });
  });

  // ── Scoped vs unscoped API selection ───────────────────────────
  //
  // The reason this file exists. Four branches, none reachable before it.

  describe('scoped vs unscoped API selection', () => {
    it('starts and lists through the scoped API when a session token is given', async () => {
      await renderHookInAct(() => useWarehouseScanner(makeOpts({ sessionToken: 'tok-1' })));

      // The token has to reach the command or the backend cannot resolve a store.
      expect(mocks.listScannersScoped).toHaveBeenCalledWith('tok-1');
      expect(mocks.startScannerScoped).toHaveBeenCalledWith('tok-1', 'scanner-1');
      // The unscoped pair reads the ambient store, which is exactly what the scoped
      // migration exists to prevent.
      expect(mocks.listScanners).not.toHaveBeenCalled();
      expect(mocks.startScanner).not.toHaveBeenCalled();
    });

    it('stops through the scoped API on unmount when a token was given', async () => {
      const { unmount } = await renderHookInAct(
        () => useWarehouseScanner(makeOpts({ sessionToken: 'tok-1' })));

      unmount();
      await act(async () => { await Promise.resolve(); });

      expect(mocks.stopScannerScoped).toHaveBeenCalledWith('tok-1');
      expect(mocks.stopScanner).not.toHaveBeenCalled();
    });

    it('looks up through the scoped API when a token is given', async () => {
      await renderHookInAct(() => useWarehouseScanner(makeOpts({ sessionToken: 'tok-1' })));
      const scanHandler = mocks.onBarcodeScanned.mock.calls.at(-1)![0];

      await scanHandler(payload);

      expect(mocks.lookupByBarcodeScoped).toHaveBeenCalledWith('tok-1', 'WH-001');
      expect(mocks.lookupByBarcode).not.toHaveBeenCalled();
    });

    // handleScan is a useCallback whose body reads `sessionToken` (useWarehouseScanner.ts:77)
    // but whose dependency array was empty, so it captured the token from the FIRST render and
    // never refreshed. Nothing above catches that: every scoped test passes its token at mount
    // and never changes it, which is precisely the case a stale closure gets right. A warehouse
    // screen that stays mounted across a login or a store switch would keep scanning against
    // the previous session's token -- a permission failure, or worse, lookups answered from the
    // wrong store.
    it('uses the CURRENT session token after it changes, not the one captured on mount', async () => {
      const { rerender } = await renderHookInAct<ReturnType<typeof makeOpts>>(
        (props) => useWarehouseScanner(props!),
        { initialProps: makeOpts({ sessionToken: 'tok-1' }) },
      );

      await act(async () => {
        rerender(makeOpts({ sessionToken: 'tok-2' }));
      });

      // The latest handler, because a correct implementation re-subscribes when the token
      // changes; the stale one is still registered first and would be [0].
      const scanHandler = mocks.onBarcodeScanned.mock.calls.at(-1)![0];
      await scanHandler(payload);

      expect(mocks.lookupByBarcodeScoped).toHaveBeenCalledWith('tok-2', 'WH-001');
      expect(mocks.lookupByBarcodeScoped.mock.calls.every((c) => c[0] !== 'tok-1')).toBe(true);
    });

    it('falls back to the unscoped API when no token is given', async () => {
      await renderHookInAct(() => useWarehouseScanner(makeOpts()));
      const scanHandler = mocks.onBarcodeScanned.mock.calls.at(-1)![0];
      await scanHandler(payload);

      expect(mocks.listScanners).toHaveBeenCalled();
      expect(mocks.startScanner).toHaveBeenCalledWith('scanner-1');
      expect(mocks.lookupByBarcode).toHaveBeenCalledWith('WH-001');
      expect(mocks.listScannersScoped).not.toHaveBeenCalled();
      expect(mocks.startScannerScoped).not.toHaveBeenCalled();
      expect(mocks.lookupByBarcodeScoped).not.toHaveBeenCalled();
    });
  });
});
