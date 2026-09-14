/**
 * Manual QRIS — the static/QR-reference dialog half of the gateway tender path.
 *
 * Slice W3-c of the PaymentModal extraction campaign: the `showQr` +
 * `qrReference` pair and the two handlers that open and close it
 * (`handleQrPay`, `handleQrConfirmed`), moved verbatim out of
 * PaymentModal.tsx — same names, same logic, same body order, same memo
 * dependencies. The only mechanical delta is that the two setters the hook now
 * RECEIVES (`setProcessing`, `setPaymentError`) are reactively visible to its
 * callbacks, so exhaustive-deps lists them; both are shell useState dispatchers,
 * i.e. referentially stable, so no handler's identity changes.
 *
 * What deliberately stayed in the shell, and why this seam is where it is:
 * `buildGatewaySale` and `settleGatewaySale` are the shared gateway front/tail
 * used by THREE tenders — manual QRIS (here), QRIS Auto (useAutoQr) and EDC —
 * and they are defined ONCE, in PaymentModal, and passed DOWN into both hooks.
 * They are not duplicated here and not moved here: the tail is what writes
 * `receiptArgs` and `done`, two of the five atoms the campaign keeps in the
 * shell precisely because there is no state machine between them. A hook that
 * owned them would own three tenders' completion, and the slices would stop
 * being independently revertible. So this hook's `handleQrConfirmed` calls them
 * as received arguments — the same shape useAutoQr already has.
 *
 * `manualQrString` (the rail's static payload) stays with the rails call too:
 * this hook decides only WHETHER the dialog is open and WHICH reference was
 * asserted, never which QR is painted. Same for the money: nothing here is
 * recomputed — the confirmed sale is built by the shell's own cart -> discount
 * -> lines -> complete half, against the shell's own charge total.
 *
 * The JSX (`QrisQrDisplay`) stays in the shell as well; this hook owns no
 * render output, only the state and the two ends of the dialog.
 */
import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { useToast } from '@/frontend/shared/Toast';
import type { CompleteSaleResult } from '@/api/sales';
import { plainErrorMessage } from '@/utils/app-error';

/** Exact addToast signature, taken from the Toast provider's own hook. */
type AddToast = ReturnType<typeof useToast>['addToast'];
/** The banner shape the shell's paymentError atom holds. */
type PaymentErrorState = { message: string; retryable: boolean };
/** buildGatewaySale's own split argument, restated as the narrow read-only shape. */
type GatewaySaleSplit = {
  method: string;
  gatewayReference: string;
  gatewayStatus: string;
  gatewayResponse: string;
};

export interface UseGatewayQrParams {
  /** Shared gateway-tender front half — shell-owned, passed to every tender. */
  buildGatewaySale: (split: GatewaySaleSplit) => Promise<CompleteSaleResult>;
  /** Shared gateway-tender tail — shell-owned; it writes done/receiptArgs there. */
  settleGatewaySale: (saleResult: CompleteSaleResult, voidOnFinalizeFailure: boolean) => Promise<void>;
  /** The shell's IPC-error → banner adapter. */
  classifyError: (err: unknown) => PaymentErrorState;
  setProcessing: Dispatch<SetStateAction<boolean>>;
  setPaymentError: Dispatch<SetStateAction<PaymentErrorState | null>>;
  addToast: AddToast;
}

/**
 * The manual-QRIS dialog: the cashier-asserted reference, its open flag, the
 * tap that opens it and the confirm that settles through the shared tail.
 */
export function useGatewayQr({
  buildGatewaySale,
  settleGatewaySale,
  classifyError,
  setProcessing,
  setPaymentError,
  addToast,
}: UseGatewayQrParams) {
  const [showQr, setShowQr] = useState(false);
  const [qrReference, setQrReference] = useState('');

  const handleQrPay = useCallback(() => {
    const ref = `QR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    setQrReference(ref);
    setShowQr(true);
  }, []);

  const handleQrConfirmed = useCallback(async () => {
    setShowQr(false);
    setProcessing(true);
    try {
      const saleResult = await buildGatewaySale({
        method: 'QRIS',
        gatewayReference: qrReference,
        gatewayStatus: 'completed',
        gatewayResponse: 'QRIS payment confirmed',
      });
      await settleGatewaySale(saleResult, true);
    } catch (err) {
      addToast({ message: `QR payment failed: ${plainErrorMessage(err)}`, type: 'error' });
      const classified = classifyError(err);
      setPaymentError(classified);
    } finally {
      setProcessing(false);
    }
    // setProcessing / setPaymentError are shell useState dispatchers listed here
    // only because they are now hook parameters; see the module doc.
  }, [buildGatewaySale, settleGatewaySale, qrReference, classifyError, addToast, setProcessing, setPaymentError]);

  // The two dispatchers travel back up because their call sites predate this
  // slice and stay untouched: the shell's open-reset effect clears both, and
  // the manual QRIS dialog's own onClose still calls setShowQr(false). They are
  // useState dispatchers - stable for the modal's lifetime - so nothing above
  // gains a new re-render or re-arm.
  return { showQr, qrReference, handleQrPay, handleQrConfirmed, setShowQr, setQrReference };
}
