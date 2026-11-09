import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAutoQr } from './useAutoQr';
import { qrisAutoChargeScoped } from '@/api/qris-auto';
import type { CompleteSaleResult } from '@/api/sales';
import type { requiredLocalized } from '@/components';

vi.mock('@/api/qris-auto', () => ({
  qrisAutoChargeScoped: vi.fn(),
  qrisAutoStatusScoped: vi.fn(),
}));

describe('useAutoQr — reissue re-entry', () => {
  const sale = { sale_id: 'sale-1' } as unknown as CompleteSaleResult;

  const makeL10n = () => ({
    getString: (key: string, args?: Record<string, unknown>) =>
      `${key}:${JSON.stringify(args ?? {})}`,
  });

  const params = () => ({
    sessionToken: 'test-session-token',
    effectiveTotalInCartCurrency: 700,
    attemptIdRef: { current: '11111111-1111-1111-1111-111111111111' },
    l10nRef: { current: makeL10n() as unknown as Parameters<typeof requiredLocalized>[0] },
    buildGatewaySale: vi.fn(async () => sale),
    settleGatewaySale: vi.fn(async () => {}),
    classifyError: vi.fn(() => ({ message: 'classified', retryable: false })),
    setProcessing: vi.fn(),
    setPaymentError: vi.fn(),
    addToast: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(qrisAutoChargeScoped).mockResolvedValue({
      orderId: 'ORDER-A1',
      qrString: 'DEVQRIS|ORDER-A1',
      status: 'qr_issued',
      amountMinor: 700,
      currency: 'USD',
      saleId: 'sale-1',
      expiresInSecs: 300,
    });
  });

  // ── A double-tap on 'Generate a new QR' must not mint two charges ──────────
  //
  // `handleAutoReissue` (useAutoQr.ts:171) has NO re-entry guard: no ref, no busy
  // flag, no cooldown. It increments `autoIssueSeq` and then awaits the charge, so
  // two calls landing inside one round-trip each increment and each call
  // `qrisAutoChargeScoped`. That is a SECOND Midtrans order on the SAME local
  // sale — and the idempotency key differs on each, because `autoIssueSeq` is what
  // builds it (`${base}-${autoIssueSeq.current}`, :114-115). The gateway cannot
  // dedupe two calls with different keys, so both stand.
  //
  // The button offers no help either: `onClick={onReissue}` at
  // QrisQrDisplay.tsx:329 carries no `disabled`, while the Cancel beside it does
  // (:341). React does not re-render between two clicks inside one await, so a DOM
  // `disabled` could not have saved it regardless.
  //
  // THE UNVERIFIED CLAIM THIS PINS: the `handleHold` re-entry guard comment in
  // RetailPosScreen.tsx — anchored by that function name, because every number this note
  // has carried (`:1425`, then `:1436`) has since moved — justifies itself by writing
  // 'The same guard shape `usePosHeldCarts` and `useAutoQr` already use.' Measured,
  // useAutoQr does not — its only ref is `autoIssueSeq`, a counter, not a guard. A reader
  // auditing that block is told the class is already handled where it is not.
  it('mints one charge when two reissues land in one round-trip', async () => {
    const p = params();
    const { result } = renderHook(() => useAutoQr(p));

    // First issue, so `autoQr` exists and reissue has a charge to replace.
    await act(async () => {
      await result.current.handleDynamicQrPay();
    });
    await waitFor(() => expect(result.current.autoQr).not.toBeNull());
    vi.mocked(qrisAutoChargeScoped).mockClear();

    // Both calls fire before either resolves — a charge held in flight.
    let release: ((v: unknown) => void) | undefined;
    const held = new Promise<unknown>((resolve) => { release = resolve; });
    vi.mocked(qrisAutoChargeScoped).mockImplementation(async () => held as never);

    await act(async () => {
      void result.current.handleAutoReissue();
      void result.current.handleAutoReissue();
    });

    expect(
      vi.mocked(qrisAutoChargeScoped).mock.calls.length,
      'two reissues in one round-trip minted two charges — a second Midtrans ' +
        'order on the same local sale, with a DIFFERENT idempotency key each ' +
        'time (autoIssueSeq builds it), so the gateway cannot dedupe either',
    ).toBe(1);

    // Unwind cleanly: release the held charge so the pending promise settles.
    await act(async () => {
      release?.({
        orderId: 'ORDER-A2',
        qrString: 'DEVQRIS|ORDER-A2',
        status: 'qr_issued',
        amountMinor: 700,
        currency: 'USD',
        saleId: 'sale-1',
        expiresInSecs: 300,
      });
    });
  });

  // The failed path must RELEASE the guard. The expired QR stays on screen with
  // its actions after a refused charge, so the cashier has to be able to retry —
  // a guard held across a failure would make the button dead for the rest of the
  // modal's life, which is the same lock-out class this file's sibling guards
  // avoid. One failure then a successful retry must both reach the charge.
  it('allows a retry after a failed reissue', async () => {
    const p = params();
    const { result } = renderHook(() => useAutoQr(p));

    await act(async () => {
      await result.current.handleDynamicQrPay();
    });
    await waitFor(() => expect(result.current.autoQr).not.toBeNull());
    vi.mocked(qrisAutoChargeScoped).mockClear();

    // First attempt fails.
    vi.mocked(qrisAutoChargeScoped).mockRejectedValueOnce(new Error('gateway down'));
    await act(async () => {
      await result.current.handleAutoReissue();
    });
    expect(vi.mocked(qrisAutoChargeScoped).mock.calls.length).toBe(1);

    // Retry must NOT be blocked by the guard the failed attempt held.
    await act(async () => {
      await result.current.handleAutoReissue();
    });
    expect(
      vi.mocked(qrisAutoChargeScoped).mock.calls.length,
      'a failed reissue held the guard, so the cashier could not retry — the ' +
        'expired panel would be dead for the rest of the session',
    ).toBe(2);
    expect(p.addToast).toHaveBeenCalled();
  });
});
