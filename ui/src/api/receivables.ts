import { loggedInvoke } from '@/utils/logged-invoke';

export interface MoneyDto {
  minor_units: number;
  currency: string;
}

export type ReceivableStatus = 'open' | 'partial' | 'paid' | 'written_off';

export interface Receivable {
  id: string;
  tenantId: string;
  customerId: string;
  saleId?: string | null;
  source: string;
  reference: string;
  amount: MoneyDto;
  paid: MoneyDto;
  balance: MoneyDto;
  dueDate?: string | null;
  status: ReceivableStatus;
  isOverdue: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string | null;
  writtenOffAt?: string | null;
}

export interface CustomerReceivablesSummary {
  customerId: string;
  outstandingTotal: MoneyDto;
  openCount: number;
  hasOverdue: boolean;
}

export interface CreateReceivableArgs {
  customerId: string;
  saleId?: string | null;
  source?: string;
  reference?: string;
  amount: MoneyDto;
  dueDate?: string | null;
  note?: string;
}

export interface RecordReceivablePaymentArgs {
  receivableId: string;
  amount: MoneyDto;
  method: string;
  note?: string;
}

/** List receivables for the tenant. */
export const listReceivablesScoped = (
  sessionToken: string,
  status?: string,
): Promise<Receivable[]> =>
  loggedInvoke<Receivable[]>('list_receivables_scoped', { sessionToken, status });

/** List receivables for a specific customer. */
export const listCustomerReceivablesScoped = (
  sessionToken: string,
  customerId: string,
  status?: string,
): Promise<Receivable[]> =>
  loggedInvoke<Receivable[]>('list_customer_receivables_scoped', {
    sessionToken,
    customerId,
    status,
  });

/** Fetch one receivable by ID. */
export const getReceivableScoped = (
  sessionToken: string,
  receivableId: string,
): Promise<Receivable | null> =>
  loggedInvoke<Receivable | null>('get_receivable_scoped', { sessionToken, receivableId });

/** Get customer's outstanding kasbon summary. */
export const getCustomerReceivablesSummaryScoped = (
  sessionToken: string,
  customerId: string,
): Promise<CustomerReceivablesSummary> =>
  loggedInvoke<CustomerReceivablesSummary>('get_customer_receivables_summary_scoped', {
    sessionToken,
    customerId,
  });

/** Create a receivable (extend debt / credit). */
export const createReceivableScoped = (
  sessionToken: string,
  args: CreateReceivableArgs,
): Promise<Receivable> =>
  loggedInvoke<Receivable>('create_receivable_scoped', { sessionToken, args });

/** Record repayment against a receivable. */
export const recordReceivablePaymentScoped = (
  sessionToken: string,
  args: RecordReceivablePaymentArgs,
): Promise<Receivable> =>
  loggedInvoke<Receivable>('record_receivable_payment_scoped', { sessionToken, args });

/** Write off an uncollectible receivable. */
export const writeOffReceivableScoped = (
  sessionToken: string,
  receivableId: string,
): Promise<Receivable> =>
  loggedInvoke<Receivable>('write_off_receivable_scoped', { sessionToken, receivableId });

export interface ReceivableAgingBucket {
  currentMinor: number;
  days3160Minor: number;
  days6190Minor: number;
  daysOver90Minor: number;
  totalOutstandingMinor: number;
}

export interface CustomerAgingRow {
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
  currentMinor: number;
  days3160Minor: number;
  days6190Minor: number;
  daysOver90Minor: number;
  totalMinor: number;
  openCount: number;
}

export interface ReceivableAgingReport {
  asOfDate: string;
  currency: string;
  summary: ReceivableAgingBucket;
  customers: CustomerAgingRow[];
}

/** Get Accounts Receivable Aging Report. */
export const getArAgingReportScoped = (
  sessionToken: string,
  asOfDate?: string,
): Promise<ReceivableAgingReport> =>
  loggedInvoke<ReceivableAgingReport>('get_ar_aging_report_scoped', { sessionToken, asOfDate });
