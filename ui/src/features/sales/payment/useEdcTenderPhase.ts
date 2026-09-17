/**
 * EDC tender phase - the card-present terminal atom of the payment modal.
 *
 * Slice B1 of the PaymentModal extraction campaign: the `edc` phase atom, its
 * `preflight -> waiting -> declined` writer `handleTerminalPay`, and
 * `handleTerminalDismiss`, moved verbatim out of PaymentModal.tsx - same names,
 * same body order, same control flow, same three localized strings, same
 * dependency values. No JSX moved: the overlay at {edc && (...)} and the
 * `terminalPending={edc !== null}` read stay in the shell, so the CSS
 * registrations for .payment-edc-* are untouched.
 *
 * WHY THIS SEAM IS ACYCLIC where the split-state cut was not: every writer of
 * this atom sat below BOTH money hooks (the multi-currency destructure and the
 * useTenderMath destructure), and so does every reader. Nothing here feeds a
 * value back UP across the boundary that defeated autoSplitEvenly, so the atom
 * can move whole and the shell only has to receive it. The shape is the one
 * ./useGatewayQr.ts and ./useAutoQr.ts already established: the shared gateway
 * front/tail (`buildGatewaySale`, `settleGatewaySale`) are defined ONCE in the
 * shell and passed DOWN, because they write `done` and `receiptArgs` there;
 * owning them here would make this hook own three tenders' completion.
 *
 * THE DEPENDENCY-LIST DELTA, the only non-verbatim line in this file: inside the
 * shell, `setProcessing` and `l10nRef` were a useState dispatcher and a useRef
 * object, so exhaustive-deps did not ask for them. Received as parameters they
 * are reactive values and the rule does. Both are listed now, appended after the
 * six original entries with their order kept; both are referentially stable for
 * the life of the modal (one is a dispatcher, the other a ref object assigned
 * once), so the callback's identity changes on exactly the renders it changed
 * before. Same resolution useGatewayQr and useAutoQr documented and shipped.
 *
 * WHAT DELIBERATELY DID NOT COME, because tidiness is not the brief:
 *  - an open-reset. The modal's `if (open)` effect clears method, tendered,
 *    splits and the rest, and it does NOT touch edc - on purpose. A terminal tap
 *    can land at any moment during `waiting`, so a modal closed while the
 *    terminal holds captured money must still show its phase on re-open. Moving
 *    the atom does not change that: this hook holds the state and no reset
 *    reaches it, which is byte-for-byte the behaviour the shell had.
 *  - any change to `voidOnFinalizeFailure = false` at the settle call below.
 *    The terminal holds captured money, so a local finalize fault must leave the
 *    sale pending for reconciliation rather than void a PAID sale. It is passed
 *    exactly as it was passed.
 *  - any retyping of the amount handed to the terminal. `edcSale` receives
 *    `Number(effectiveTotalInCartCurrency)` - the same conversion, at the same
 *    place, with the same non-assertion of exactness at that IPC boundary. It is
 *    reported as unpinned, not fixed, in this slice.
 *
 * MONEY: nothing is computed here. The total arrives as the integer minor-unit
 * number the shell's money hook already returns; the only arithmetic is the
 * `Number(...)` conversion above, moved unchanged. No float was introduced,
 * removed or reordered, and no amount is parsed or summed in this file.
 */
import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { requiredLocalized } from '@/components';
import type { useToast } from '@/components/Toast';
import { edcSale, edcTerminalStatusScoped } from '@/api/edc';
import type { CompleteSaleResult } from '@/api/sales';
import { plainErrorMessage } from '@/utils/app-error';

/** Exact addToast signature, taken from the Toast provider's own hook. */
type AddToast = ReturnType<typeof useToast>['addToast'];
/** Bundle ref, threaded in so the localized terminal copy keeps its dep chain. */
type L10nRef = { current: Parameters<typeof requiredLocalized>[0] };
/** buildGatewaySale's own split argument, restated as the narrow read-only shape. */
type GatewaySaleSplit = {
  method: string;
  gatewayReference: string;
  gatewayStatus: string;
  gatewayResponse: string;
};

export interface UseEdcTenderPhaseParams {
  /** ADR #7 session token; both scoped edc commands take it (the `!` is verbatim). */
  sessionToken: string | undefined;
  /** The charge total in cart currency - the shell's money math, received. */
  effectiveTotalInCartCurrency: number;
  /** Charge currency, from the shell's multi-currency hook. */
  cartCurrency: string;
  /** Shared gateway-tender front half (manual QRIS + Auto + EDC), shell-owned. */
  buildGatewaySale: (split: GatewaySaleSplit) => Promise<CompleteSaleResult>;
  /** Shared gateway-tender tail, shell-owned; it writes done/receiptArgs there. */
  settleGatewaySale: (saleResult: CompleteSaleResult, voidOnFinalizeFailure: boolean) => Promise<void>;
  /** Bundle ref for the two failure toasts. */
  l10nRef: L10nRef;
  addToast: AddToast;
  /** The shell's processing flag - the button spinner is not this atom's to own. */
  setProcessing: Dispatch<SetStateAction<boolean>>;
}

/**
 * The card-present phase: null when no terminal attempt is live, otherwise
 * preflight (asking the device), waiting (the tap is the terminal's) or declined
 * (with the reason the device gave). Owned here, read by the shell's overlay.
 */
export function useEdcTenderPhase({
  sessionToken,
  effectiveTotalInCartCurrency,
  cartCurrency,
  buildGatewaySale,
  settleGatewaySale,
  l10nRef,
  addToast,
  setProcessing,
}: UseEdcTenderPhaseParams) {
  const [edc, setEdc] = useState<{
    phase: 'preflight' | 'waiting' | 'declined';
    reason?: string | undefined;
  } | null>(null);

  const handleTerminalPay = useCallback(async () => {
    setProcessing(true);
    try {
      // Preflight is `edc_terminal_status_scoped`: the never-shipped
      // `test_edc_connection_scoped` (agents-2 residual) is decided INTO this
      // call — same session enforcement, same answer. On the tablet (no edc
      // commands registered) the pre-flight simply rejects and the flow falls
      // back to manual card — desktop-only expressed as degradation, not
      // platform-sniffing.
      setEdc({ phase: 'preflight' });
      const status = await edcTerminalStatusScoped(sessionToken!);
      if (status.status !== 'ready') {
        setEdc(null);
        addToast({
          message: requiredLocalized(l10nRef.current, 'payment-edc-not-ready', {
            status: status.status,
          }),
          type: 'error',
        });
        return;
      }
      // The card-present wait is the terminal's, not ours: no client-side
      // cancel (a tap can land any moment — cancelling the promise would
      // abandon captured money), no invented progress. The overlay says
      // tap/insert/swipe and waits.
      setEdc({ phase: 'waiting' });
      const result = await edcSale(
        sessionToken!,
        Number(effectiveTotalInCartCurrency),
        cartCurrency,
      );
      if (!result.success) {
        setEdc({ phase: 'declined', reason: result.message });
        return;
      }
      const saleResult = await buildGatewaySale({
        method: 'CARD',
        gatewayReference: result.transactionId ?? '',
        gatewayStatus: 'captured',
        gatewayResponse: JSON.stringify({
          auth_code: result.authCode,
          card_scheme: result.cardScheme,
          card_last4: result.cardLast4,
          message: result.message,
        }),
      });
      // voidOnFinalizeFailure = false: the terminal holds captured money;
      // a local finalize fault keeps the sale pending for reconciliation,
      // it must not void a PAID sale.
      await settleGatewaySale(saleResult, false);
      setEdc(null);
    } catch (err) {
      // Back to tender selection with the reason (the capture, if any, is
      // the terminal's record; nothing local was created yet at this
      // point except a possibly-built sale — settleGatewaySale throws only
      // after its own surfacing, and its pending-on-failure branch applies).
      setEdc(null);
      addToast({
        message: requiredLocalized(l10nRef.current, 'payment-edc-failed', {
          reason: plainErrorMessage(err),
        }),
        type: 'error',
      });
    } finally {
      setProcessing(false);
    }
  // l10nRef and setProcessing are appended for the reason in the module doc:
  // received reactive values, referentially stable, so no identity change.
  }, [sessionToken, effectiveTotalInCartCurrency, cartCurrency, buildGatewaySale, settleGatewaySale, addToast, l10nRef, setProcessing]);

  const handleTerminalDismiss = useCallback(() => setEdc(null), []);

  return { edc, handleTerminalPay, handleTerminalDismiss };
}
