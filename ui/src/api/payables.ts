/**
 * Accounts Payable (Hutang / Beli Tempo) API client.
 *
 * Exposes session-scoped commands for managing vendor debts incurred from
 * purchase orders and stock receipts, recording payments/settlement,
 * and writing off unpayable debts.
 */

import { loggedInvoke } from '@/utils/logged-invoke';

export interface MoneyDto {
  minor_units: number;
  currency: string;
}

export type PayableStatus = 'open' | 'partial' | 'paid' | 'written_off';

export interface PayableDto {
  id: string;
  tenant_id: string;
  supplier_id: string;
  po_id?: string | null;
  source: string;
  reference: string;
  amount: MoneyDto;
  paid: MoneyDto;
  balance: MoneyDto;
  due_date?: string | null;
  status: PayableStatus;
  is_overdue: boolean;
  note: string;
  created_at: string;
  updated_at: string;
  settled_at?: string | null;
  written_off_at?: string | null;
}

export interface CreatePayableArgs {
  supplierId: string;
  poId?: string | null;
  source?: string;
  reference?: string;
  amount: MoneyDto;
  dueDate?: string | null;
  note?: string;
}

export interface RecordPayablePaymentArgs {
  payableId: string;
  amount: MoneyDto;
  method?: string;
  note?: string;
}

/**
 * List all vendor payables, optionally filtered by status ('open', 'partial', 'paid', 'written_off').
 * Requires payables:view permission.
 */
export async function listPayablesScoped(
  sessionToken: string,
  status?: string,
): Promise<PayableDto[]> {
  return loggedInvoke<PayableDto[]>('list_payables_scoped', {
    sessionToken,
    status: status || null,
  });
}

/**
 * Create a new accounts payable (vendor debt) row.
 * Requires payables:create permission.
 */
export async function createPayableScoped(
  sessionToken: string,
  args: CreatePayableArgs,
): Promise<PayableDto> {
  return loggedInvoke<PayableDto>('create_payable_scoped', {
    sessionToken,
    args,
  });
}

/**
 * Record a payment against an open or partial payable.
 * Requires payables:settle permission.
 */
export async function recordPayablePaymentScoped(
  sessionToken: string,
  args: RecordPayablePaymentArgs,
): Promise<PayableDto> {
  return loggedInvoke<PayableDto>('record_payable_payment_scoped', {
    sessionToken,
    args,
  });
}

/**
 * Write off an unsettled payable debt (forgiveness/cancellation).
 * Requires payables:writeoff permission.
 */
export async function writeOffPayableScoped(
  sessionToken: string,
  payableId: string,
): Promise<PayableDto> {
  return loggedInvoke<PayableDto>('write_off_payable_scoped', {
    sessionToken,
    payableId,
  });
}

export interface PayableAgingBucket {
  currentMinor: number;
  days3160Minor: number;
  days6190Minor: number;
  daysOver90Minor: number;
  totalOutstandingMinor: number;
}

export interface VendorAgingRow {
  vendorId: string;
  vendorName: string;
  currentMinor: number;
  days3160Minor: number;
  days6190Minor: number;
  daysOver90Minor: number;
  totalMinor: number;
  openCount: number;
}

export interface PayableAgingReport {
  asOfDate: string;
  currency: string;
  summary: PayableAgingBucket;
  vendors: VendorAgingRow[];
}

/** Get Accounts Payable Aging Report. */
export const getApAgingReportScoped = (
  sessionToken: string,
  asOfDate?: string,
): Promise<PayableAgingReport> =>
  loggedInvoke<PayableAgingReport>('get_ap_aging_report_scoped', { sessionToken, asOfDate });
