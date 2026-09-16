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
  onBarcodeScanned: vi.fn(),
  onBarcodeError: vi.fn(),
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
  onBarcodeScanned: (...args: unknown[]) => mocks.onBarcodeScanned(...args),
  onBarcodeError: (...args: unknown[]) => mocks.onBarcodeError(...args),
  startScannerScoped: (...args: unknown[]) => mocks.startScannerScoped(...args),
  stopScannerScoped: (...args: unknown[]) => mocks.stopScannerScoped(...args),
  listScannersScoped: (...args: unknown[]) => mocks.listScannersScoped(...args),
}));

vi.mock('@/api/products', () => ({
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
  mocks.onBarcodeScanned.mockResolvedValue(() => {});
  mocks.onBarcodeError.mockResolvedValue(() => {});
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
  // T21 (b2), and this group is the reason the fallback survived this long: it rendered with
  // no token, so all five cases asserted the arm that calls `list_scanners` / `start_scanner`
  // -- commands registered in neither shell's generate_handler. Same behaviours, real path.
  const TOKEN = 'tok-1';

  describe('scanner lifecycle', () => {
    it('auto-detects and starts the first available scanner on mount', async () => {
      await renderHookInAct(() => useWarehouseScanner(makeOpts({ sessionToken: TOKEN })));

      expect(mocks.listScannersScoped).toHaveBeenCalledWith(TOKEN);
      expect(mocks.startScannerScoped).toHaveBeenCalledWith(TOKEN, 'scanner-1');
    });

    it('uses the provided scannerId instead of auto-detecting', async () => {
      await renderHookInAct(() =>
        useWarehouseScanner(makeOpts({ sessionToken: TOKEN, scannerId: 'wh-9' })));

      expect(mocks.listScannersScoped).not.toHaveBeenCalled();
      expect(mocks.startScannerScoped).toHaveBeenCalledWith(TOKEN, 'wh-9');
    });

    it('does not start when auto-detect returns no scanners', async () => {
      mocks.listScannersScoped.mockResolvedValue([]);

      await renderHookInAct(() => useWarehouseScanner(makeOpts({ sessionToken: TOKEN })));

      expect(mocks.startScannerScoped).not.toHaveBeenCalled();
    });

    it('does not start when auto-detect throws', async () => {
      mocks.listScannersScoped.mockRejectedValue(new Error('no backend'));

      await renderHookInAct(() => useWarehouseScanner(makeOpts({ sessionToken: TOKEN })));

      expect(mocks.startScannerScoped).not.toHaveBeenCalled();
    });

    it('stops the scanner on unmount when it was started', async () => {
      const { unmount } = await renderHookInAct(
        () => useWarehouseScanner(makeOpts({ sessionToken: TOKEN })));

      unmount();
      await act(async () => { await Promise.resolve(); });

      expect(mocks.stopScannerScoped).toHaveBeenCalledWith(TOKEN);
    });
  });

  describe('scan handling', () => {
    it('reports a matched product through onProductFound with the PAYLOAD', async () => {
      // This hook passes `payload`, not the looked-up product (useWarehouseScanner.ts:80).
      // Asserted explicitly because the barcode twin differs here, and a copied test would
      // have asserted the wrong object.
      const onProductFound = vi.fn();
      await renderHookInAct(() =>
        useWarehouseScanner(makeOpts({ onProductFound, sessionToken: 'tok-1' })));
      const scanHandler = mocks.onBarcodeScanned.mock.calls.at(-1)![0];

      await scanHandler(payload);

      expect(onProductFound).toHaveBeenCalledWith(payload);
    });

    it('reports an unmatched code through onProductNotFound', async () => {
      mocks.lookupByBarcodeScoped.mockResolvedValue(null);
      const onProductNotFound = vi.fn();

      await renderHookInAct(() =>
        useWarehouseScanner(makeOpts({ onProductNotFound, sessionToken: 'tok-1' })));
      const scanHandler = mocks.onBarcodeScanned.mock.calls.at(-1)![0];

      await scanHandler(payload);

      expect(onProductNotFound).toHaveBeenCalledWith('WH-001');
    });

    it('treats a lookup that throws as not-found rather than surfacing an error', async () => {
      mocks.lookupByBarcodeScoped.mockRejectedValue(new Error('db down'));
      const onProductNotFound = vi.fn();
      const onError = vi.fn();

      await renderHookInAct(() =>
        useWarehouseScanner(makeOpts({ onProductNotFound, onError, sessionToken: 'tok-1' })));
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
      // Its two unscoped negatives went with the exports: asserting `not.toHaveBeenCalled()`
      // about a name the module no longer has is a tautology, not a test. The no-token case at
      // the end of this block holds the intent and can still fail.
    });

    it('stops through the scoped API on unmount when a token was given', async () => {
      const { unmount } = await renderHookInAct(
        () => useWarehouseScanner(makeOpts({ sessionToken: 'tok-1' })));

      unmount();
      await act(async () => { await Promise.resolve(); });

      expect(mocks.stopScannerScoped).toHaveBeenCalledWith('tok-1');
    });

    it('looks up through the scoped API when a token is given', async () => {
      await renderHookInAct(() => useWarehouseScanner(makeOpts({ sessionToken: 'tok-1' })));
      const scanHandler = mocks.onBarcodeScanned.mock.calls.at(-1)![0];

      await scanHandler(payload);

      expect(mocks.lookupByBarcodeScoped).toHaveBeenCalledWith('tok-1', 'WH-001');
      // Its former second line named the unscoped export to prove the arm chosen was the scoped
      // one; that export is gone, so the pair would have contradicted itself.
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

    // Round 40 split this case in two because the lookup arm was still live; round 41 deleted
    // that arm as well, so the whole thing is now the guard's pin -- no session means no scanner
    // call, no lookup call, and the code reported as not-found rather than looked up against no
    // store.
    it('without a session token touches neither the scanner nor the lookup', async () => {
      await renderHookInAct(() => useWarehouseScanner(makeOpts()));
      const scanHandler = mocks.onBarcodeScanned.mock.calls.at(-1)![0];
      await scanHandler(payload);

      expect(mocks.listScannersScoped).not.toHaveBeenCalled();
      expect(mocks.startScannerScoped).not.toHaveBeenCalled();
      expect(mocks.stopScannerScoped).not.toHaveBeenCalled();
      // Round 40 left the lookup half of this case live (the arm still existed and answered
      // unscoped); round 41 deleted that arm, so the guard now covers the lookup as well.
      expect(mocks.lookupByBarcodeScoped).not.toHaveBeenCalled();
    });
  });
});
