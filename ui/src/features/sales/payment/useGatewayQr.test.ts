import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGatewayQr } from './useGatewayQr';
import type { CompleteSaleResult } from '@/api/sales';
import type { requiredLocalized } from '@/components';

describe('useGatewayQr — manual QRIS confirm', () => {
  const sale = { sale_id: 'sale-1' } as unknown as CompleteSaleResult;

  const params = () => ({
    buildGatewaySale: vi.fn(async () => sale),
    settleGatewaySale: vi.fn(async () => {}),
    classifyError: vi.fn(() => ({ message: 'classified', retryable: false })),
    setProcessing: vi.fn(),
    setPaymentError: vi.fn(),
    l10nRef: {
      current: {
        getString: (key: string, args?: Record<string, unknown>) =>
          `${key}:${JSON.stringify(args ?? {})}`,
      } as unknown as Parameters<typeof requiredLocalized>[0],
    },
    addToast: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Opening the dialog mints exactly one reference ─────────────────────
  it('mints a fresh reference each time the dialog opens', () => {
    const { result } = renderHook(() => useGatewayQr(params()));

    act(() => { result.current.handleQrPay(); });
    const first = result.current.qrReference;
    expect(first).toMatch(/^QR-/);
    expect(result.current.showQr).toBe(true);

    act(() => { result.current.handleQrPay(); });
    // A reference is what identifies ONE QRIS exchange, so re-opening must not
    // reuse the previous one.
    expect(result.current.qrReference).not.toBe(first);
  });

  // ── The confirm settles through the shared tail with the asserted ref ────
  it('settles with the asserted reference and the ADR-64 vocabulary', async () => {
    const p = params();
    const { result } = renderHook(() => useGatewayQr(p));

    act(() => { result.current.handleQrPay(); });
    const ref = result.current.qrReference;

    await act(async () => {
      await result.current.handleQrConfirmed();
    });

    expect(p.buildGatewaySale).toHaveBeenCalledTimes(1);
    expect(p.buildGatewaySale).toHaveBeenCalledWith({
      method: 'QRIS',
      gatewayReference: ref,
      // 'confirmed', not 'completed': the CHECK's vocabulary. This is the value
      // the whole hook's type alias exists to protect.
      gatewayStatus: 'confirmed',
      gatewayResponse: 'QRIS payment confirmed',
    });
    // Manual's payment was only ASSERTED, so a failed local finalize voids the
    // pending sale — the opposite of Auto, where the money is real at the gateway.
    expect(p.settleGatewaySale).toHaveBeenCalledWith(sale, true);
    expect(result.current.showQr).toBe(false);
  });

  // ── A failed confirm must report and not claim success ──────────────────
  it('reports a failed confirm and leaves the dialog closed', async () => {
    const p = params();
    p.buildGatewaySale.mockRejectedValueOnce(new Error('ipc down'));
    const { result } = renderHook(() => useGatewayQr(p));

    act(() => { result.current.handleQrPay(); });
    await act(async () => {
      await result.current.handleQrConfirmed();
    });

    expect(p.settleGatewaySale).not.toHaveBeenCalled();
    expect(p.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
    // The banner, not a swallow: the operator gets the classified cause.
    expect(p.setPaymentError).toHaveBeenCalled();
    expect(result.current.showQr).toBe(false);
  });


  // ── A refused confirm must leave the dialog reopenable ──────────────────
  //
  // Manual QRIS is the cashier-asserted tender: there is no polling feed, so the
  // cashier IS the settlement oracle. A refused confirm (IPC down, session
  // lapsed) therefore has to end with a usable screen — the toast and the
  // classified banner say what happened, and re-running the flow must actually
  // attempt the sale again.
  //
  // NOTE ON WHAT THIS DOES *NOT* PIN. `handleQrConfirmed` deliberately has no
  // in-flight guard, and that is the DESIGN, not an omission: the confirm callback
  // 'can legally fire MORE than once for one QR' (PaymentModal.tsx:902-909 — a
  // poll that returns pending and then succeeds twice), so every firing must run
  // and carry the SAME `attemptId`; the backend's replay guard answers the second
  // with the first receipt instead of ringing a second sale. That contract is
  // pinned by PaymentModalSaleFlow's 'QRIS attempt id' cases, which assert TWO
  // completions with an IDENTICAL attempt id for one scan. Adding a re-entry guard
  // here — the shape useAutoQr gained in round 124 — BREAKS them: measured,
  // 'expected 1 to be 2'. The other two gateway tenders differ because their
  // duplicate is a genuine duplicate (a second Midtrans order, a second charge),
  // whereas this one is the same settlement observed twice.
  it('lets the cashier confirm again after a failed confirm', async () => {
    const p = params();

    const { result } = renderHook(() => useGatewayQr(p));
    act(() => { result.current.handleQrPay(); });

    // First confirm fails.
    p.buildGatewaySale.mockRejectedValueOnce(new Error('ipc down'));
    await act(async () => {
      await result.current.handleQrConfirmed();
    });
    expect(p.buildGatewaySale.mock.calls.length).toBe(1);
    expect(p.addToast).toHaveBeenCalled();
    expect(p.setPaymentError).toHaveBeenCalled();

    // Reopen and confirm again — the manual flow must still work.
    act(() => { result.current.handleQrPay(); });
    await act(async () => {
      await result.current.handleQrConfirmed();
    });

    expect(
      p.buildGatewaySale.mock.calls.length,
      'a refused confirm left the manual QRIS flow unusable — it is the ONLY ' +
        'settlement surface this tender has, so the cashier would be stuck',
    ).toBe(2);
    expect(p.settleGatewaySale).toHaveBeenCalledTimes(1);
  });
});
