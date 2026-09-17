/**
 * QRIS Auto — the dynamic Midtrans charge cluster of the payment modal.
 *
 * Slice W3-a of the PaymentModal extraction campaign (phase 3.1/3.2): the
 * `autoQr` state plus the five handlers that drive it (start / re-issue /
 * cancel / confirm / poll) and the `issueAutoQr` charge wrapper, moved verbatim
 * out of PaymentModal.tsx — same names, same logic, same body order, same memo
 * dependencies. The only mechanical difference is that values the hook now
 * RECEIVES (`setProcessing`, `setPaymentError`, `l10nRef`, `attemptIdRef`) are
 * reactively visible to its callbacks, so exhaustive-deps lists them; every one
 * of them is a useState dispatcher or a useRef object created once by the
 * shell, i.e. referentially stable, so no handler's identity changes.
 *
 * What stays in the shell, deliberately:
 * - `processing`, `paymentError` (and everything else in that atom group). The
 *   hook RECEIVES their setters; it never owns them. That is what keeps this
 *   slice independently revertible from the other five.
 * - `buildGatewaySale` / `settleGatewaySale` — shared with manual QRIS and EDC,
 *   so they are arguments, not duplicates. Same for `attemptIdRef` (one id per
 *   checkout attempt, re-minted by the shell's open-reset effect) and
 *   `effectiveTotalInCartCurrency` (money math owned by the shell; the charge
 *   amount is passed in, never re-derived here — i64 minor units end to end).
 * - the JSX. `QrisQrDisplay` for the auto QR renders in the modal's parked
 *   render span and is untouched; the shell reads the returned `autoQr`.
 *
 * The phase story this cluster owns (unchanged from the original comment): the
 * sale completes as PENDING before the charge exists, the QR is rendered from
 * the gateway payload, and settlement is observed by the display's real poll
 * (cloud ledger via the webhook). The tail is the same `settleGatewaySale` the
 * manual flow uses — finalize's idempotent `WHERE status = 'pending'` means the
 * queued finalize_sale racing in over sync and this UI call cannot double-apply
 * or double-award.
 */
import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { requiredLocalized } from '@/components';
import type { useToast } from '@/components/Toast';
import { voidPendingSale, type CompleteSaleResult } from '@/api/sales';
import { qrisAutoChargeScoped, qrisAutoStatusScoped } from '@/api/qris-auto';
import { plainErrorMessage } from '@/utils/app-error';

/** Exact addToast signature, taken from the Toast provider's own hook. */
type AddToast = ReturnType<typeof useToast>['addToast'];
/** Structural twin of the caller's useRef(l10n) result — non-null current. */
type L10nRef = { current: Parameters<typeof requiredLocalized>[0] };
/** The banner shape the shell's paymentError atom holds. */
type PaymentErrorState = { message: string; retryable: boolean };
/** buildGatewaySale's own split argument, restated as the narrow read-only shape. */
type GatewaySaleSplit = {
  method: string;
  gatewayReference: string;
  gatewayStatus: string;
  gatewayResponse: string;
};

/** The issued dynamic QR plus the PENDING sale it is bound to. */
export interface AutoQrState {
  orderId: string;
  qrString: string;
  expiresIn: number;
  saleResult: CompleteSaleResult;
}

export interface UseAutoQrParams {
  /** ADR #7 session token; the cluster is inert without it (guard kept verbatim). */
  sessionToken: string | undefined;
  /** The charge total in cart currency — the shell's money math, received. */
  effectiveTotalInCartCurrency: number;
  /** One id per checkout attempt, minted and re-minted by the shell. */
  attemptIdRef: { current: string | null };
  /** Bundle ref, threaded in so the localized failure copy keeps its dep chain. */
  l10nRef: L10nRef;
  /** Shared gateway-tender front half (manual QRIS + Auto + EDC), shell-owned. */
  buildGatewaySale: (split: GatewaySaleSplit) => Promise<CompleteSaleResult>;
  /** Shared QRIS tail (manual + Auto), shell-owned. */
  settleGatewaySale: (saleResult: CompleteSaleResult, voidOnFinalizeFailure: boolean) => Promise<void>;
  /** The shell's IPC-error → banner adapter. */
  classifyError: (err: unknown) => PaymentErrorState;
  setProcessing: Dispatch<SetStateAction<boolean>>;
  setPaymentError: Dispatch<SetStateAction<PaymentErrorState | null>>;
  addToast: AddToast;
}

/**
 * The auto-QR phase: `autoQr` is null whenever no dynamic QR is on screen, and
 * the five handlers are what the tender buttons and the QR display call.
 */
export function useAutoQr({
  sessionToken,
  effectiveTotalInCartCurrency,
  attemptIdRef,
  l10nRef,
  buildGatewaySale,
  settleGatewaySale,
  classifyError,
  setProcessing,
  setPaymentError,
  addToast,
}: UseAutoQrParams) {
  const [autoQr, setAutoQr] = useState<AutoQrState | null>(null);
  const autoIssueSeq = useRef(0);

  const issueAutoQr = useCallback(
    async (saleResult: CompleteSaleResult) => {
      // First issue of this checkout attempt re-uses the attempt id itself
      // as the idempotency key (PAY-2: a retry after a lost response
      // returns the SAME live QR, not a second charge); every deliberate
      // re-issue after expiry bumps a suffix — a new Midtrans order on the
      // same local sale.
      const base = attemptIdRef.current ?? `qr-${Date.now()}`;
      const idempotencyKey =
        autoIssueSeq.current === 0 ? base : `${base}-${autoIssueSeq.current}`;
      return qrisAutoChargeScoped(sessionToken!, {
        saleId: saleResult.saleId,
        amountMinor: Number(effectiveTotalInCartCurrency),
        idempotencyKey,
      });
    },
    // Stable-by-construction (ref object / useState dispatcher) entries are
    // here only because they are now hook parameters; see the module doc.
    [sessionToken, effectiveTotalInCartCurrency, attemptIdRef],
  );

  const handleDynamicQrPay = useCallback(async () => {
    setProcessing(true);
    let createdSaleId: string | null = null;
    try {
      const saleResult = await buildGatewaySale({
        method: 'QRIS',
        gatewayReference: `qr-auto:${attemptIdRef.current ?? 'no-attempt'}`,
        gatewayStatus: 'pending',
        gatewayResponse: 'QRIS Auto — awaiting settlement webhook',
      });
      createdSaleId = saleResult.saleId;
      autoIssueSeq.current = 0;
      const charge = await issueAutoQr(saleResult);
      if (!charge.qrString) {
        throw new Error(requiredLocalized(l10nRef.current, 'payment-qris-auto-no-payload'));
      }
      setAutoQr({
        orderId: charge.orderId,
        qrString: charge.qrString,
        expiresIn: charge.expiresInSecs,
        saleResult,
      });
    } catch (err) {
      // Nothing was captured at the gateway (build or charge failed) — the
      // pending sale must not linger.
      if (createdSaleId) {
        try {
          await voidPendingSale(sessionToken!, createdSaleId);
        } catch (voidErr) {
          addToast({ message: `Void also failed: ${voidErr instanceof Error ? voidErr.message : String(voidErr)}`, type: 'error' });
        }
      }
      addToast({
        message: requiredLocalized(l10nRef.current, 'payment-qris-auto-charge-failed', {
          reason: plainErrorMessage(err),
        }),
        type: 'error',
      });
    } finally {
      setProcessing(false);
    }
  }, [sessionToken, buildGatewaySale, issueAutoQr, addToast, setProcessing, attemptIdRef, l10nRef]);

  const handleAutoReissue = useCallback(async () => {
    if (!autoQr || !sessionToken) return;
    try {
      autoIssueSeq.current += 1;
      const charge = await issueAutoQr(autoQr.saleResult);
      if (!charge.qrString) {
        throw new Error(requiredLocalized(l10nRef.current, 'payment-qris-auto-no-payload'));
      }
      setAutoQr({
        orderId: charge.orderId,
        qrString: charge.qrString,
        expiresIn: charge.expiresInSecs,
        saleResult: autoQr.saleResult,
      });
    } catch (err) {
      // The expired QR stays on screen with its actions — the money story
      // is unchanged, and the cashier can retry or cancel deliberately.
      addToast({
        message: requiredLocalized(l10nRef.current, 'payment-qris-auto-charge-failed', {
          reason: plainErrorMessage(err),
        }),
        type: 'error',
      });
    }
  }, [autoQr, sessionToken, issueAutoQr, addToast, l10nRef]);

  const handleAutoCancel = useCallback(() => {
    if (!autoQr || !sessionToken) return;
    const { saleResult } = autoQr;
    setAutoQr(null);
    voidPendingSale(sessionToken, saleResult.saleId)
      .then(() =>
        addToast({
          message: requiredLocalized(l10nRef.current, 'payment-qris-auto-cancelled'),
          type: 'info',
        }),
      )
      .catch((voidErr) =>
        addToast({ message: `Void also failed: ${voidErr instanceof Error ? voidErr.message : String(voidErr)}`, type: 'error' }),
      );
  }, [autoQr, sessionToken, addToast, l10nRef]);

  const handleAutoConfirmed = useCallback(async () => {
    if (!autoQr) return;
    const { saleResult } = autoQr;
    setAutoQr(null);
    setProcessing(true);
    try {
      // voidOnFinalizeFailure = false: the gateway has the customer's
      // money; a local finalize fault keeps the sale pending for the
      // queued finalize_sale instead of voiding a PAID sale.
      await settleGatewaySale(saleResult, false);
    } catch (err) {
      addToast({ message: `QR payment failed: ${plainErrorMessage(err)}`, type: 'error' });
      const classified = classifyError(err);
      setPaymentError(classified);
    } finally {
      setProcessing(false);
    }
  }, [autoQr, settleGatewaySale, classifyError, addToast, setProcessing, setPaymentError]);

  const handleAutoPoll = useCallback(async () => {
    if (!autoQr || !sessionToken) return false;
    const s = await qrisAutoStatusScoped(sessionToken, autoQr.orderId);
    return s.settled;
  }, [autoQr, sessionToken]);

  return {
    autoQr,
    handleDynamicQrPay,
    handleAutoReissue,
    handleAutoCancel,
    handleAutoConfirmed,
    handleAutoPoll,
  };
}
