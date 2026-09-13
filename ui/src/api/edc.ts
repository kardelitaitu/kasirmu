// ── EDC card-present payment terminal ──────────────────────────────
//
// Card-present payments via the EDC terminal wired into the desktop
// client (currently a success-mode mock). These wrappers call the
// `edc_*` Tauri commands registered in lib.rs.

import { loggedInvoke } from '@/utils/logged-invoke';

/** Terminal status discriminator (mirrors TerminalStatus). */
export type EdcTerminalStatus =
  | 'ready'
  | 'busy'
  | 'offline'
  | 'paperError'
  | 'error';

/** Result of an EDC terminal status query. */
export interface EdcStatus {
  status: EdcTerminalStatus;
}

/** Result of a card-present sale / refund / void. */
export interface EdcResult {
  success: boolean;
  transactionId: string | null;
  authCode: string | null;
  cardScheme: string | null;
  cardLast4: string | null;
  message: string;
}

/** Query the EDC terminal's current status. */
export const edcTerminalStatus = (): Promise<EdcStatus> =>
  loggedInvoke<EdcStatus>('edc_terminal_status');

/**
 * Session-scoped status query — the pre-flight the checkout runs before
 * asking the terminal to take money. `test_edc_connection_scoped` was
 * once planned as a dedicated probe; it never shipped, and this command
 * answers the same question under the same session enforcement, so the
 * checkout reuses the wire that exists (agents-3 3.2 decision).
 */
export const edcTerminalStatusScoped = (sessionToken: string): Promise<EdcStatus> =>
  loggedInvoke<EdcStatus>('edc_terminal_status_scoped', { sessionToken });

/**
 * Process a card-present sale (authorize + capture).
 *
 * `amountMinor` is in the currency's minor units (e.g. cents for USD,
 * rupiah for IDR). The Rust command resolves the session from
 * `sessionToken` and enforces the SALES_PROCESS permission — without a
 * valid token the invoke fails, never the terminal.
 */
export const edcSale = (
  sessionToken: string,
  amountMinor: number,
  currency: string,
): Promise<EdcResult> =>
  loggedInvoke<EdcResult>('edc_sale', { sessionToken, amountMinor, currency });

/** Refund a previously captured card transaction (SALES_REFUND). */
export const edcRefund = (
  sessionToken: string,
  transactionId: string,
  amountMinor: number,
  currency: string,
): Promise<EdcResult> =>
  loggedInvoke<EdcResult>('edc_refund', {
    sessionToken,
    transactionId,
    amountMinor,
    currency,
  });

/** Void a pending authorisation before capture (SALES_VOID). */
export const edcVoid = (
  sessionToken: string,
  transactionId: string,
): Promise<EdcResult> =>
  loggedInvoke<EdcResult>('edc_void', { sessionToken, transactionId });
