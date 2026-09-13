/**
 * QRIS Auto — dynamic Midtrans QRIS charge + settlement polling.
 *
 * Device-side mirror of the `qris_auto.rs` command modules in the app
 * clients (identical wire
 * shape on desktop and tablet). The charge resolves when the QR EXISTS —
 * `status: 'qr_issued'` is the two-phase contract (PAY-6): nobody has paid
 * yet. Settlement arrives asynchronously through the cloud webhook; the
 * UI observes it via `qrisAutoStatusScoped` and, on `settled`, triggers the
 * existing sync pull so the queued `finalize_sale` lands immediately.
 */
import { loggedInvoke } from '@/utils/logged-invoke';

/** Arguments for `qris_auto_charge_scoped`. */
export interface QrisAutoChargeArgs {
  /** Local sale id the issuance binds to (recorded in the cloud ledger). */
  saleId: string;
  /** Amount requested, minor units (IDR — exponent 0). */
  amountMinor: number;
  /**
   * Optional idempotency key. Retrying with the SAME key re-uses the
   * already-issued live QR (PAY-2) — the UI keeps the key it generated for
   * this checkout attempt and re-sends it on retry.
   */
  idempotencyKey?: string;
}

/** IPC view of the cloud `ChargeResponse` — ISSUED, not paid. */
export interface QrisAutoChargeResult {
  /** Midtrans order id — the status-poll handle. */
  orderId: string;
  /** The QR payload to render; null when the channel returned none. */
  qrString: string | null;
  /** `'qr_issued'` at issuance time. */
  status: string;
  /** Echo of the requested amount, minor units. */
  amountMinor: number;
  /** Echo of the currency (`IDR`). */
  currency: string;
  /** Echo of the sale the issuance is bound to. */
  saleId: string;
  /** QR validity window in seconds — countdown source (300, not 15 min). */
  expiresInSecs: number;
}

/** Arguments for `qris_auto_status_scoped` (wrapped as `{ orderId }`). */
export interface QrisAutoStatusArgs {
  orderId: string;
}

/** IPC view of the cloud status poll. */
export interface QrisAutoStatusResult {
  orderId: string;
  /** Verbatim cloud ledger status (`issued`, `settlement`, `expire`, ...). */
  status: string;
  /** True once the ledger recorded settlement/capture — poll exit. */
  settled: boolean;
}

/** Issue a dynamic QRIS charge for a sale (scoped — ADR #7). */
export const qrisAutoChargeScoped = (
  sessionToken: string,
  args: QrisAutoChargeArgs,
): Promise<QrisAutoChargeResult> =>
  loggedInvoke<QrisAutoChargeResult>('qris_auto_charge_scoped', { sessionToken, args });

/** Poll one charge's settlement status (scoped — ADR #7). */
export const qrisAutoStatusScoped = (
  sessionToken: string,
  orderId: string,
): Promise<QrisAutoStatusResult> =>
  loggedInvoke<QrisAutoStatusResult>('qris_auto_status_scoped', {
    sessionToken,
    args: { orderId },
  });
