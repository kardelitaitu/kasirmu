/**
 * Completed-sale -> receipt-preview derivation for the sales payment surface.
 *
 * The single home for the ADR #7 read-back mapping the payment modal needed
 * twice. PaymentModal.tsx built the same `PrintSalesReceiptArgs` twice, from
 * the same two inputs (`saleResult` from `completeSaleScoped` plus the
 * `getSale*` read-back of the sale that call just wrote): the gateway/QRIS tail
 * in `settleGatewaySale` and the cash/credit/split tail in `onComplete`. Before
 * this module existed the two copies were diffed line-by-line with leading
 * whitespace normalised, and every field of the DERIVATION agreed exactly —
 * date format, `SALE-${saleId}`, the positional `lines?.[i]` join,
 * `tax_amount`, the `unit_price.minor_units * qty` arithmetic, the
 * `completedSale.subtotal` -vs- `saleResult.total?.minor_units ?? effective`
 * fallback, the `taxTotal.minor_units > 0` gate, the `total` expression, the
 * tableNumber spread. So what is copied here is that agreed derivation moved
 * VERBATIM: no field changed shape, no fallback was picked over the other,
 * nothing was "simplified".
 *
 * The one thing the two sites genuinely do NOT share is the tender list, and it
 * is genuinely different rather than drifted: the QRIS tail always prints a
 * single `QRIS` payment with no change, while the direct tail maps the split
 * rows when split mode was used and otherwise prints the chosen method with the
 * real cash change. So `payments` is an explicit REQUIRED input with no
 * default. A third caller has to state its tenders; it cannot inherit one
 * site's answer by accident.
 */
import { courseLabel, type CartLine, type Money } from '@/types/domain';
import type { PaymentDto, PrintSalesReceiptArgs, SaleDetail } from '@/api/sales';
import type { ActiveMarketProfile } from '@/api/regional';
import { bareTableNumber } from '../utils/tableLabel';

export interface CompletedSaleReceiptInput {
  /** `saleResult.saleId` — keys the receipt number. */
  saleId: string;
  /** `saleResult.total`: what the backend rang the sale up for, or null. */
  saleTotal: Money | null | undefined;
  /**
   * ADR #7: the sale read back from the SAME store `completeSaleScoped` just
   * wrote to. Null/undefined when the read returned nothing, which is what
   * routes the subtotal to the fallback below.
   */
  completedSale: SaleDetail | null | undefined;
  /** The displayed cart lines, already re-stamped into the charge currency. */
  cartLines: CartLine[];
  /** Charge currency the sale was rung up in. */
  cartCurrency: string;
  /** Client-side effective total, used only when no server total exists. */
  fallbackTotalMinor: number;
  /** The tenders to print. See the header: deliberately has no default. */
  payments: PaymentDto[];
  /** Restaurant table, printed only when present. */
  tableNumber?: string | undefined;
  /** Market profile for fiscal tax regime, rounding, and tax registration label. */
  marketProfile?: ActiveMarketProfile | null | undefined;
  /** Whether this receipt should be formatted as a formal statutory Tax Invoice. */
  isInvoice?: boolean | undefined;
  /** Statutory document number (e.g. Tax Invoice number) stamped on the sale. */
  statutoryNumber?: string | null | undefined;
  /** Customer or business name for B2B statutory invoice header. */
  customerName?: string | null | undefined;
  /** Customer Tax ID (e.g. NPWP, VAT ID) for B2B statutory invoice header. */
  customerTaxId?: string | null | undefined;
}

/**
 * Build the receipt preview for a just-completed sale from the ADR #7 read-back.
 *
 * Field-for-field what both call sites did. Two places worth a second look:
 *  - `items` pairs the cart line at index `i` with `completedSale.lines?.[i]`
 *    POSITIONALLY, and takes only that line's tax from the read-back; name, qty,
 *    unit price and line total stay the client's. So a short or absent read-back
 *    degrades to a receipt built from the cart instead of a hole, and
 *    `taxAmount` is spread conditionally so an untaxed line never carries
 *    `taxAmount: undefined`.
 *  - `subtotal` prefers the read-back but `total` never does — `total` is the
 *    authoritative `saleResult.total` with the client estimate behind it. That
 *    asymmetry is the original behaviour of BOTH copies, kept exactly as found.
 */
export function buildCompletedSaleReceipt({
  saleId,
  saleTotal,
  completedSale,
  cartLines,
  cartCurrency,
  fallbackTotalMinor,
  payments,
  tableNumber,
  marketProfile,
  isInvoice: isInvoiceProp,
  statutoryNumber: statutoryNumberProp,
  customerName,
  customerTaxId,
}: CompletedSaleReceiptInput): PrintSalesReceiptArgs {
  const isInvoice = isInvoiceProp ?? Boolean(statutoryNumberProp ?? completedSale?.statutoryNumber);
  const statutoryNumber = statutoryNumberProp ?? completedSale?.statutoryNumber ?? null;

  const taxIdLabel = marketProfile
    ? marketProfile.country_code === 'ID'
      ? 'NPWP'
      : marketProfile.country_code === 'SG'
      ? 'GST Reg No'
      : marketProfile.country_code === 'MY'
      ? 'SST ID'
      : marketProfile.country_code === 'AU'
      ? 'ABN'
      : marketProfile.country_code === 'GB'
      ? 'VAT Reg No'
      : marketProfile.country_code === 'US'
      ? 'EIN'
      : 'Tax ID'
    : undefined;

  const taxRegime = marketProfile?.tax_regime && marketProfile.tax_regime !== 'NONE'
    ? marketProfile.tax_regime
    : undefined;

  return {
    date: new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    }),
    receiptNumber: (isInvoice && statutoryNumber) ? statutoryNumber : (completedSale?.displayCode ?? `SALE-${saleId}`),
    items: cartLines.map((line, i) => {
      const computedLine = completedSale?.lines?.[i];
      const tax = computedLine?.tax_amount
        ? { minorUnits: computedLine.tax_amount.minor_units, currency: computedLine.tax_amount.currency }
        : null;
      return {
        name: line.name ?? line.sku,
        quantity: line.qty,
        unitPrice: { minorUnits: line.unit_price.minor_units, currency: line.unit_price.currency },
        totalPrice: {
          minorUnits: line.unit_price.minor_units * line.qty,
          currency: line.unit_price.currency,
        },
        ...(tax ? { taxAmount: tax } : {}),
        ...(line.note ? { note: line.note } : {}),
      };
    }),
    // `completedSale?.` on the SUBTOTAL too, not just on `completedSale`.
    //
    // MEASURED 2026-10-09 on the tablet: a completed sale (row 01-01-261009-01-000007,
    // total 15000, status completed) showed the bare "Sale Complete" branch with NO
    // receipt preview, so the operator had nothing to print. The cause was here — the
    // read-back came back SHORT and `completedSale.subtotal` was undefined, so this
    // dereference threw. PaymentModal.tsx:1325 wraps the build in a try whose catch is
    // "Receipt/KDS may not be configured - non-blocking", so the throw was swallowed,
    // `setReceiptArgs` never ran, and the modal silently fell to its no-receipt branch.
    //
    // The declared type says `subtotal: Money` is required, and the docstring above
    // claims a "short or absent read-back degrades to a receipt built from the cart" —
    // this line did not honour that. `total` and `taxTotal` were already guarded; the
    // subtotal was the one that was not. Falling back keeps the promise the type cannot
    // enforce at runtime against an IPC boundary.
    subtotal:
      completedSale?.subtotal != null
        ? { minorUnits: completedSale.subtotal.minor_units, currency: cartCurrency }
        : { minorUnits: saleTotal?.minor_units ?? fallbackTotalMinor, currency: cartCurrency },
    ...(completedSale && completedSale.taxTotal && completedSale.taxTotal.minor_units > 0
      ? { tax: { minorUnits: completedSale.taxTotal.minor_units, currency: cartCurrency } }
      : {}),
    total: { minorUnits: saleTotal?.minor_units ?? fallbackTotalMinor, currency: cartCurrency },
    payments,
    ...(tableNumber ? { tableNumber } : {}),
    ...(taxIdLabel ? { taxIdLabel } : {}),
    ...(taxRegime ? { taxRegime } : {}),
    ...(marketProfile?.statutory_rounding ? { statutoryRounding: marketProfile.statutory_rounding } : {}),
    ...(isInvoice ? { isInvoice: true, documentKind: 'invoice' as const } : {}),
    ...(statutoryNumber ? { statutoryNumber } : {}),
    ...(customerName ? { customerName } : {}),
    ...(customerTaxId ? { customerTaxId } : {}),
  };
}

export interface PreCheckoutBillReceiptInput {
  billNumber?: string;
  cartLines: CartLine[];
  cartCurrency: string;
  subtotal: Money;
  total: Money;
  taxAmount?: Money | null | undefined;
  tableNumber?: string | undefined;
  customerName?: string | undefined;
  marketProfile?: ActiveMarketProfile | null | undefined;
}

/**
 * Format a pre-checkout interim bill/check for a dining table before payment is collected.
 * Produces PrintSalesReceiptArgs with an unpaid indicator and no cash tender (preventing drawer pulse).
 */
export function buildPreCheckoutBillReceipt({
  billNumber,
  cartLines,
  cartCurrency,
  subtotal,
  total,
  taxAmount,
  tableNumber,
  customerName,
  marketProfile,
}: PreCheckoutBillReceiptInput): PrintSalesReceiptArgs {
  const taxIdLabel = marketProfile
    ? marketProfile.country_code === 'ID'
      ? 'NPWP'
      : marketProfile.country_code === 'SG'
      ? 'GST Reg No'
      : 'Tax ID'
    : undefined;
  const taxRegime = marketProfile?.tax_regime ?? undefined;

  return {
    date: new Date().toISOString(),
    receiptNumber: billNumber ?? (tableNumber ? `CHECK-${tableNumber.trim()}` : `BILL-${Date.now().toString().slice(-6)}`),
    items: cartLines.map((line) => {
      const lineTax = taxAmount && cartLines.length > 0 && taxAmount.minor_units > 0
        ? { minorUnits: Math.round(taxAmount.minor_units / cartLines.length), currency: cartCurrency }
        : undefined;
      return {
        name: line.name ?? line.sku,
        quantity: line.qty,
        unitPrice: { minorUnits: line.unit_price.minor_units, currency: line.unit_price.currency },
        totalPrice: { minorUnits: line.unit_price.minor_units * line.qty, currency: line.unit_price.currency },
        ...(lineTax ? { taxAmount: lineTax } : {}),
        ...(line.note ? { note: line.note } : {}),
      };
    }),
    subtotal: { minorUnits: subtotal.minor_units, currency: cartCurrency },
    ...(taxAmount && taxAmount.minor_units > 0
      ? { tax: { minorUnits: taxAmount.minor_units, currency: cartCurrency } }
      : {}),
    total: { minorUnits: total.minor_units, currency: cartCurrency },
    payments: [],
    ...(tableNumber ? { tableNumber } : {}),
    ...(customerName ? { customerName } : {}),
    ...(taxIdLabel ? { taxIdLabel } : {}),
    ...(taxRegime ? { taxRegime } : {}),
  };
}

export interface KitchenChitReceiptInput {
  chitNumber?: string;
  cartLines: CartLine[];
  cartCurrency: string;
  tableNumber?: string | undefined;
  customerName?: string | undefined;
}

/**
 * Format a kitchen order ticket (KOT / chit) for food orders sent to the kitchen.
 * Formats line items with their quantity, modifiers, course indicators, and notes.
 */
export function buildKitchenChitReceipt({
  chitNumber,
  cartLines,
  cartCurrency,
  tableNumber,
  customerName,
}: KitchenChitReceiptInput): PrintSalesReceiptArgs {
  return {
    date: new Date().toISOString(),
    receiptNumber: chitNumber ?? `KOT-${bareTableNumber(tableNumber || '') || 'ORDER'}-${Date.now().toString().slice(-4)}`,
    items: cartLines.map((line) => {
      let displayName = line.name ?? line.sku;
      if (line.courseId) {
        displayName = `[${courseLabel(line.courseId)}] ${displayName}`;
      }
      const noteParts: string[] = [];
      if (line.modifiers && line.modifiers.length > 0) {
        noteParts.push(line.modifiers.map((m) => m.modifierName).join(', '));
      }
      if (line.note?.trim()) {
        noteParts.push(line.note.trim());
      }
      return {
        name: displayName,
        quantity: line.qty,
        unitPrice: { minorUnits: 0, currency: cartCurrency },
        totalPrice: { minorUnits: 0, currency: cartCurrency },
        ...(noteParts.length > 0 ? { note: noteParts.join(' | ') } : {}),
      };
    }),
    subtotal: { minorUnits: 0, currency: cartCurrency },
    total: { minorUnits: 0, currency: cartCurrency },
    payments: [],
    ...(tableNumber ? { tableNumber } : {}),
    ...(customerName ? { customerName } : {}),
    documentKind: 'kitchen',
    printerTarget: 'kitchen',
  };
}

