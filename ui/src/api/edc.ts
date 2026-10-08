// ── EDC card-present payment terminal ──────────────────────────────
//
// Card-present payments via the EDC terminal wired into the desktop
// client. When multiple terminals exist, commands accept `terminalId`.
// Omitted or null terminalId falls back to the default configured terminal.

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

/** Configured card terminal DTO. */
export interface EdcTerminalDto {
  id: string;
  name: string;
  connectionType: 'wired' | 'wireless';
  transport: 'serial' | 'usb' | 'bluetooth' | 'tcp';
  address: string;
  vendor?: string | null;
  model?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Arguments to create an EDC card terminal. */
export interface CreateEdcTerminalDto {
  name: string;
  connectionType: 'wired' | 'wireless';
  transport: 'serial' | 'usb' | 'bluetooth' | 'tcp';
  address: string;
  vendor?: string | null;
  model?: string | null;
  isActive?: boolean;
}

/** Arguments to update an EDC card terminal. */
export interface UpdateEdcTerminalDto {
  id: string;
  name: string;
  connectionType: 'wired' | 'wireless';
  transport: 'serial' | 'usb' | 'bluetooth' | 'tcp';
  address: string;
  vendor?: string | null;
  model?: string | null;
  isActive: boolean;
}

/** Result of an EDC batch settlement operation. */
export interface EdcSettlementDto {
  success: boolean;
  batchNumber: string | null;
  transactionCount: number;
  totalAmount: number | null;
  currency: string | null;
  message: string;
}

/** Query an EDC terminal's current status. */
export const edcTerminalStatus = (terminalId?: string | null): Promise<EdcStatus> =>
  loggedInvoke<EdcStatus>('edc_terminal_status', { terminalId });

/**
 * Session-scoped status query — pre-flight before tender.
 */
export const edcTerminalStatusScoped = (
  sessionToken: string,
  terminalId?: string | null,
): Promise<EdcStatus> =>
  loggedInvoke<EdcStatus>('edc_terminal_status_scoped', { sessionToken, terminalId });

/**
 * Process a card-present sale (authorize + capture).
 *
 * `amountMinor` is in the currency's minor units (e.g. cents for USD,
 * rupiah for IDR).
 */
export const edcSale = (
  sessionToken: string,
  amountMinor: number,
  currency: string,
  terminalId?: string | null,
  reference?: string | null,
): Promise<EdcResult> =>
  loggedInvoke<EdcResult>('edc_sale', {
    sessionToken,
    amountMinor,
    currency,
    terminalId,
    reference,
  });

/** Refund a previously captured card transaction (SALES_REFUND). */
export const edcRefund = (
  sessionToken: string,
  transactionId: string,
  amountMinor: number,
  currency: string,
  terminalId?: string | null,
): Promise<EdcResult> =>
  loggedInvoke<EdcResult>('edc_refund', {
    sessionToken,
    transactionId,
    amountMinor,
    currency,
    terminalId,
  });

/** Void a pending authorisation before capture (SALES_VOID). */
export const edcVoid = (
  sessionToken: string,
  transactionId: string,
  terminalId?: string | null,
): Promise<EdcResult> =>
  loggedInvoke<EdcResult>('edc_void', { sessionToken, transactionId, terminalId });

/** Perform batch settlement on the EDC terminal (SALES_PROCESS or SETTINGS_EDIT). */
export const edcSettle = (
  sessionToken: string,
  terminalId?: string | null,
): Promise<EdcSettlementDto> =>
  loggedInvoke<EdcSettlementDto>('edc_settle', { sessionToken, terminalId });

/** Query/reconcile transaction status by invoice reference (SALES_PROCESS). */
export const edcInquiry = (
  sessionToken: string,
  invoice: string,
  terminalId?: string | null,
): Promise<EdcResult> =>
  loggedInvoke<EdcResult>('edc_inquiry', { sessionToken, invoice, terminalId });

/** List configured card-payment terminals (SETTINGS_READ or SALES_PROCESS). */
export const listEdcTerminalsScoped = (
  sessionToken: string,
): Promise<EdcTerminalDto[]> =>
  loggedInvoke<EdcTerminalDto[]>('list_edc_terminals_scoped', { sessionToken });

/** Create a new card-payment terminal (SETTINGS_EDIT). */
export const createEdcTerminalScoped = (
  sessionToken: string,
  args: CreateEdcTerminalDto,
): Promise<EdcTerminalDto> =>
  loggedInvoke<EdcTerminalDto>('create_edc_terminal_scoped', { sessionToken, args });

/** Update an existing card-payment terminal (SETTINGS_EDIT). */
export const updateEdcTerminalScoped = (
  sessionToken: string,
  args: UpdateEdcTerminalDto,
): Promise<EdcTerminalDto> =>
  loggedInvoke<EdcTerminalDto>('update_edc_terminal_scoped', { sessionToken, args });

/** Delete a card-payment terminal (SETTINGS_EDIT). */
export const deleteEdcTerminalScoped = (
  sessionToken: string,
  id: string,
): Promise<void> =>
  loggedInvoke<void>('delete_edc_terminal_scoped', { sessionToken, id });
