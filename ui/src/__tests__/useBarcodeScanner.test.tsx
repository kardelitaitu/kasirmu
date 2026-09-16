import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderHookInAct } from '@/test-utils/renderInAct';
import { useBarcodeScanner } from '@/features/sales/useBarcodeScanner';

const mocks = vi.hoisted(() => ({
  onBarcodeScanned: vi.fn(),
  onBarcodeError: vi.fn(),
  lookupByBarcode: vi.fn(),
  // The scoped twins, added by 403030ad ("migrate remaining frontend components to scoped
  // APIs"), which did not touch this file: without these keys the mocked module had no such
  // export, so any test that passed a sessionToken called undefined and threw "xScoped is not
  // a function" -- all four scoped branches were unrenderable, not merely uncovered. Same
  // defect as WeightScaleWidget.test.tsx, fixed in 65971d0f. T21 (b2) then deleted the three
  // unscoped scanner exports this hook used to fall back to: `list_scanners`, `start_scanner`
  // and `stop_scanner` are registered in neither shell, so the fallback could only answer
  // "command not found" in a build. `lookupByBarcode` stays for the same reason it is not
  // migrated here -- it belongs to the products api, and its arm is still there to test.
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
  // T21 (b2) moved this whole group onto a session token. It used to render with `makeOpts()`
  // and no token, which drove the hook's `: plainWrapper` arm -- a call to a command neither
  // shell registers. Every case below asserts the same behaviour as before, through the path a
  // real POS screen takes.
  const TOKEN = 'tok-1';

  describe('scanner lifecycle', () => {
    it('auto-detects and starts the first available scanner on mount', async () => {
      await renderHookInAct(() => useBarcodeScanner(makeOpts({ sessionToken: TOKEN })));

      expect(mocks.listScannersScoped).toHaveBeenCalledWith(TOKEN);
      expect(mocks.startScannerScoped).toHaveBeenCalledWith(TOKEN, 'scanner-1');
    });

    it('uses the provided scannerId instead of auto-detecting', async () => {
      await renderHookInAct(() =>
        useBarcodeScanner(makeOpts({ sessionToken: TOKEN, scannerId: 'my-scanner' })));

      expect(mocks.listScannersScoped).not.toHaveBeenCalled();
      expect(mocks.startScannerScoped).toHaveBeenCalledWith(TOKEN, 'my-scanner');
    });

    it('does not start scanner when auto-detect returns no scanners', async () => {
      mocks.listScannersScoped.mockResolvedValue([]);

      await renderHookInAct(() => useBarcodeScanner(makeOpts({ sessionToken: TOKEN })));

      expect(mocks.startScannerScoped).not.toHaveBeenCalled();
    });

    it('does not start scanner when auto-detect throws', async () => {
      mocks.listScannersScoped.mockRejectedValue(new Error('no backend'));

      await renderHookInAct(() => useBarcodeScanner(makeOpts({ sessionToken: TOKEN })));

      expect(mocks.startScannerScoped).not.toHaveBeenCalled();
    });

    it('stops the scanner on unmount when it was started', async () => {
      const { unmount } = await renderHookInAct(() =>
        useBarcodeScanner(makeOpts({ sessionToken: TOKEN })));

      unmount();

      expect(mocks.stopScannerScoped).toHaveBeenCalledWith(TOKEN);
    });

    it('does not stop the scanner on unmount when it was never started', async () => {
      mocks.listScannersScoped.mockResolvedValue([]);
      const { unmount } = await renderHookInAct(() =>
        useBarcodeScanner(makeOpts({ sessionToken: TOKEN })));

      unmount();

      expect(mocks.stopScannerScoped).not.toHaveBeenCalled();
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
      mocks.startScannerScoped.mockClear();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { rerender } = await (renderHookInAct as any)(
        ({ scannerId }: { scannerId?: string }) => useBarcodeScanner(makeOpts({ scannerId, sessionToken: 'tok-1' })),
        { initialProps: { scannerId: 'scanner-1' } },
      );

      mocks.startScannerScoped.mockClear();
      rerender({ scannerId: 'scanner-2' });

      expect(mocks.startScannerScoped).toHaveBeenCalledWith('tok-1', 'scanner-2');
      await vi.waitFor(() => {});
    });
  });

  // ── Scoped vs unscoped API selection ───────────────────────────
  //
  // This block used to grade four ternaries: start, stop, lookup, listScanners. T21 (b2)
  // deleted three of them -- `list_scanners`, `start_scanner` and `stop_scanner` are
  // registered in neither shell, so the no-token half was a lookup that could only fail.
  // What is left to choose is the lookup arm (:83), which still has both halves because
  // `lookup_by_barcode` sits in the products api and is not part of this slice.

  describe('scoped vs unscoped API selection', () => {
    it('starts and lists through the scoped API when a session token is given', async () => {
      await renderHookInAct(() => useBarcodeScanner(makeOpts({ sessionToken: 'tok-1' })));

      // The token has to reach the command or the backend cannot resolve a store.
      expect(mocks.listScannersScoped).toHaveBeenCalledWith('tok-1');
      expect(mocks.startScannerScoped).toHaveBeenCalledWith('tok-1', 'scanner-1');
      // The matching negatives here used to read `expect(mocks.listScanners).not...`, which
      // after the deletion would have been an assertion about an export that no longer exists:
      // always true, so not a test. The case at the end of this block ("does not touch the
      // scanner when no session token is given") is the half of that intent that can still fail.
    });

    it('stops through the scoped API on unmount when a token was given', async () => {
      const { unmount } = await renderHookInAct(
        () => useBarcodeScanner(makeOpts({ sessionToken: 'tok-1' })));

      unmount();

      expect(mocks.stopScannerScoped).toHaveBeenCalledWith('tok-1');
    });

    // handleScan is a useCallback whose body reads `sessionToken` (:83) but whose dependency
    // array is empty, with the comment "stable -- reads latest callbacks via refs". That is
    // true of the callbacks and false of the token: sessionToken is a plain prop, not a ref.
    // Every test above passes a token at mount and never changes one, which is exactly the
    // case a stale closure gets right. useWarehouseScanner had the identical defect and is
    // fixed in 8693e081; this is the twin.
    //
    // Reachable because FastPINOverlay performs the cashier hot-swap ON TOP of the mounted
    // screen, and WorkspaceContext.swapSessionToken calls destroySession on the old token
    // (:273) before setting the new one -- so a stale handleScan looks up barcodes with a
    // session that no longer exists.
    it('uses the CURRENT session token after a hot-swap, not the one captured on mount', async () => {
      const { rerender } = await renderHookInAct<ReturnType<typeof makeOpts>>(
        (props) => useBarcodeScanner(props!),
        { initialProps: makeOpts({ sessionToken: 'tok-1' }) },
      );

      await act(async () => {
        rerender(makeOpts({ sessionToken: 'tok-2' }));
      });

      // The latest registered handler: a correct implementation re-subscribes when the token
      // changes, so the stale one is calls[0] and the live one is calls.at(-1).
      const scanHandler = mocks.onBarcodeScanned.mock.calls.at(-1)![0];
      // Inline literal, matching :333 and :343 in this describe block. The `payload` const the
      // handleScan tests use is declared per-test inside that block, not at module scope.
      await scanHandler({ code: '4901234567890', scannerId: 'scanner-1' });

      expect(mocks.lookupByBarcodeScoped).toHaveBeenCalledWith('tok-2', '4901234567890');
      expect(mocks.lookupByBarcodeScoped.mock.calls.every((c) => c[0] !== 'tok-1')).toBe(true);
    });

    // This case used to REQUIRE the dead call: no token meant `list_scanners` then
    // `start_scanner`. It is inverted now, and it is the only pin on the guard itself --
    // T11(a) shipped a no-session guard in useTerminalHardware with nothing to hold it, which
    // I disclosed in the plan rather than papering over. Here the guard is pinned: the hook
    // must not reach for the scanner at all without a session.
    it('does not touch the scanner when no session token is given', async () => {
      await renderHookInAct(() => useBarcodeScanner(makeOpts()));

      expect(mocks.listScannersScoped).not.toHaveBeenCalled();
      expect(mocks.startScannerScoped).not.toHaveBeenCalled();
      expect(mocks.stopScannerScoped).not.toHaveBeenCalled();
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
