/**
 * Tender math - the pure money-derivation cluster of the payment modal.
 *
 * Slice W5-b of the PaymentModal extraction campaign: the ten memos that turn
 * the cart total, the promo preview, the loyalty discount, the tender string
 * and the split rows into the numbers the modal displays, gates Complete on
 * and stamps onto the sale. Moved verbatim out of PaymentModal.tsx - same
 * names, same logic, same body order, same memo dependencies. ZERO dep array
 * changed. What makes that possible where W5-a could not: total arrives as the
 * Money object rather than split into totalCurrency / totalMinorUnits, so every
 * dep below reads the exact tokens it read in the shell.
 *
 * The two feedback edges, held fixed on purpose (they are the whole risk of
 * this slice):
 *  - the PROMO-3 preview effect stays in the shell. It READS
 *    lineItemsInCartCurrency (returned here) and WRITES promoPreview (an input).
 *  - the loyalty-points effect stays for the same reason: it READS totalMinor
 *    (returned here) and WRITES loyaltyDiscount (an input).
 * Neither can move without moving the useState behind it, so the hook hands both
 * values back to the effect that consumes it. Every dep array on both sides of
 * the seam is unchanged in value and in token, which is the invariant this slice
 * exists to preserve.
 *
 * What stayed in the shell, on purpose:
 *  - tenderSnapshot. Its three own inputs (tipMinor, serviceChargeMinor,
 *    effectiveRateInfo) belong to no other memo here, so taking it would widen
 *    the seam from nine values to twelve for one memo - and it is payload
 *    assembly (the CUR-02 base-currency fields), not tender arithmetic. The page
 *    keeps its reciprocalMillionths import for exactly this reason.
 *  - canComplete. Seven deps, four of them payment-method form state (splitMode,
 *    otherLabel, customerName, qrReference) that nothing else here reads:
 *    sixteen params to save one memo is a worse file.
 *  - every useEffect, callback and JSX line. No JSX moved, so the CSS
 *    registrations in focusVisibleCompliance / touchTargetSizing are untouched.
 *
 * MONEY: still integer minor units end to end. The parses go through
 * parseMinorUnits at the explicit currency exponent, the payable stays the
 * fixed-point number convertToChargeCurrency returns, and the running split sum
 * is a bigint. No float arithmetic was introduced, removed or reordered.
 */
import { useCallback, useMemo } from 'react';
import { minorUnitExponent, parseMinorUnits, type CartLine, type Money } from '@/types/domain';
import type { PreviewPromotedTotalResult } from '@/api/sales';

/** Structural twin of useSplitTenderState's SplitRow (:63) - only the three fields the math reads. */
interface SplitTenderRow {
  method: string;
  otherLabel: string;
  amountMinor: string;
}

export interface UseTenderMathParams {
  /** The sale total as handed to the modal; kept whole so total.currency / total.minor_units deps read unchanged. */
  total: Money;
  /** The displayed cart, verbatim (the shell's lineItems prop). */
  lineItems: CartLine[];
  /** PROMO-3 engine preview of the promotion-reduced payable; null when no promotions are selected. */
  promoPreview: PreviewPromotedTotalResult | null;
  /** Loyalty discount in the sale's base currency, already clamped by the shell's loyalty effect. */
  loyaltyDiscount: bigint;
  /** Charge currency, from useMultiCurrency. */
  cartCurrency: string;
  /** Fixed-point base to charge conversion, from useMultiCurrency. */
  convertToChargeCurrency: (minorUnits: number | bigint) => number;
  /** The tender input string, verbatim (the shell's tendered state). */
  tendered: string;
  /** The chosen payment method (the shell's PaymentMethod union). */
  method: string;
  /** Split rows, verbatim (the shell's splits state). */
  splits: readonly SplitTenderRow[];
}

/**
 * The payable in charge currency, the tender against it, the change it earns
 * and the split tender's running totals.
 */
export function useTenderMath({
  total,
  lineItems,
  promoPreview,
  loyaltyDiscount,
  cartCurrency,
  convertToChargeCurrency,
  tendered,
  method,
  splits,
}: UseTenderMathParams) {
  const totalMinor = useMemo(() => BigInt(total.minor_units), [total.minor_units]);

  const effectiveTotal = useMemo(() => {
    // PROMO-3: when promotions are selected the base is the engine-exact
    // previewed total (post-tax, post-cart-discount, promotions applied);
    // otherwise the cart total prop. Loyalty discount subtracts on top in
    // both cases.
    const base = promoPreview ? BigInt(promoPreview.totalMinor) : totalMinor;
    const discount = loyaltyDiscount;
    return base - discount >= 0n ? base - discount : 0n;
  }, [promoPreview, totalMinor, loyaltyDiscount]);

  const effectiveTotalMoney = useMemo<Money>(() => ({
    minor_units: Number(effectiveTotal),
    currency: total.currency,
  }), [effectiveTotal, total.currency]);

  const tenderedMinor = useMemo(() => {
    // MONEY-02: exact decimal parse (parseFloat mis-rounded "1.005").
    const parsed = parseMinorUnits(tendered, minorUnitExponent(total.currency));
    if (parsed === null || parsed < 0) return 0n;
    return BigInt(parsed);
  }, [tendered, total.currency]);

  // PROMO-3: the charge total when promotions are selected — the engine
  // preview result (already in cart currency) minus the loyalty discount
  // converted into cart currency. Null when no preview (no promotions).
  const promotedChargeTotal = useMemo(() => {
    if (!promoPreview) return null;
    const loyaltyInCart = cartCurrency === total.currency
      ? Number(loyaltyDiscount)
      : convertToChargeCurrency(loyaltyDiscount);
    return Math.max(0, promoPreview.totalMinor - loyaltyInCart);
  }, [promoPreview, loyaltyDiscount, cartCurrency, total.currency, convertToChargeCurrency]);

  // Get the effective total in the cart currency — WITHOUT promotions.
  // The StockShortfallDialog retry needs this unpromoted base: the backend
  // shortfall command re-applies the promotions itself, so passing the
  // promoted total here would discount twice.
  const unpromotedTotalInCartCurrency = useMemo(() => {
    if (cartCurrency === total.currency) return Number(effectiveTotal);
    return convertToChargeCurrency(effectiveTotal);
  }, [effectiveTotal, cartCurrency, total.currency, convertToChargeCurrency]);

  // The charge total the cashier sees and pays: engine-promoted when a
  // preview is active, the loyalty-adjusted cart total otherwise.
  const effectiveTotalInCartCurrency = promotedChargeTotal ?? unpromotedTotalInCartCurrency;

  // Convert line item unit prices to cart currency
  const lineItemsInCartCurrency = useMemo(() => {
    if (cartCurrency === total.currency) return lineItems;
    return lineItems.map((line) => ({
      ...line,
      unit_price: {
        minor_units: convertToChargeCurrency(line.unit_price.minor_units),
        currency: cartCurrency,
      },
    }));
  }, [lineItems, cartCurrency, total.currency, convertToChargeCurrency]);

  // Convert tendered amount to cart currency
  const tenderedMinorInCartCurrency = useMemo(() => {
    if (cartCurrency === total.currency) return Number(tenderedMinor);
    // MONEY-02: exact decimal parse at the charge currency's exponent.
    const parsed = parseMinorUnits(tendered, minorUnitExponent(cartCurrency));
    if (parsed === null || parsed < 0) return 0;
    return parsed;
  }, [tendered, cartCurrency, tenderedMinor, total.currency]);

  const { sufficient, change } = useMemo(() => {
    if (method !== 'cash') return { sufficient: true, change: null };
    if (tenderedMinorInCartCurrency < effectiveTotalInCartCurrency) return { sufficient: false, change: null };
    const diff = tenderedMinorInCartCurrency - effectiveTotalInCartCurrency;
    return {
      sufficient: true,
      change: { minor_units: diff, currency: cartCurrency } as Money,
    };
  }, [method, tenderedMinorInCartCurrency, effectiveTotalInCartCurrency, cartCurrency]);

  // Parse split amounts using cart currency exponent
  const parseSplitMinor = useCallback((val: string): bigint => {
    // MONEY-02: exact decimal parse (parseFloat mis-rounded "1.005").
    const parsed = parseMinorUnits(val, minorUnitExponent(cartCurrency));
    if (parsed === null || parsed < 0) return 0n;
    return BigInt(parsed);
  }, [cartCurrency]);

  const splitTotals = useMemo(() => {
    let splitSum = 0n;
    for (const s of splits) {
      splitSum += parseSplitMinor(s.amountMinor);
    }
    return { splitSum, remaining: BigInt(effectiveTotalInCartCurrency) - splitSum };
  }, [splits, parseSplitMinor, effectiveTotalInCartCurrency]);

  const splitComplete = useMemo(() => {
    if (splitTotals.remaining !== 0n) return false;
    // Zero-amount sale: empty splits are acceptable
    if (effectiveTotalInCartCurrency === 0) return true;
    return splits.every((s) => {
      if (s.method === 'other' && !s.otherLabel.trim()) return false;
      return parseSplitMinor(s.amountMinor) > 0n;
    });
  }, [splits, splitTotals, parseSplitMinor, effectiveTotalInCartCurrency]);

  return {
    totalMinor,
    effectiveTotalMoney,
    unpromotedTotalInCartCurrency,
    effectiveTotalInCartCurrency,
    lineItemsInCartCurrency,
    tenderedMinorInCartCurrency,
    sufficient,
    change,
    splitTotals,
    splitComplete,
  };
}

