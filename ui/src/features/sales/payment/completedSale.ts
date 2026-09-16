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
import type { CartLine, Money } from '@/types/domain';
import type { PaymentDto, PrintSalesReceiptArgs, SaleDetail } from '@/api/sales';

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
}: CompletedSaleReceiptInput): PrintSalesReceiptArgs {
  return {
    date: new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    }),
    receiptNumber: `SALE-${saleId}`,
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
      };
    }),
    subtotal: completedSale
      ? { minorUnits: completedSale.subtotal.minor_units, currency: cartCurrency }
      : { minorUnits: saleTotal?.minor_units ?? fallbackTotalMinor, currency: cartCurrency },
    ...(completedSale && completedSale.taxTotal && completedSale.taxTotal.minor_units > 0
      ? { tax: { minorUnits: completedSale.taxTotal.minor_units, currency: cartCurrency } }
      : {}),
    total: { minorUnits: saleTotal?.minor_units ?? fallbackTotalMinor, currency: cartCurrency },
    payments,
    ...(tableNumber ? { tableNumber } : {}),
  };
}
