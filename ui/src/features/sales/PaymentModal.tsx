import { useState, useMemo, useCallback, useEffect, useRef, useContext } from 'react';
import { useToast } from '@/frontend/shared/Toast';
import { LocaleContext } from '@/i18n/LocaleContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { openUpgradePricing } from '@/utils/upgrade';
import { requiredLocalized } from '@/frontend/shared';
import { Localized, useLocalization } from '@fluent/react';
import { Skeleton } from '@/components/Skeleton';
import { startSaleScoped, addLineScoped, completeSaleScoped, printSalesReceipt, getSale, getSaleScoped, setCartDiscountScoped, holdCartScoped, finalizeSale, voidPendingSale, previewPromotedTotalFromLinesScoped, type SetCartDiscountScopedArgs, type CompleteSaleScopedArgs, type PaymentSplitArg, type SerialNumberArg, type PartialStockResult, type PreviewPromotedTotalResult } from '@/api/sales';
import { createKdsOrderFromSaleScoped } from '@/api/kds';
import { Button } from '@/components/Button';
import { formatMoney, minorUnitExponent, parseMinorUnits, type Money, type CartLine } from '@/types/domain';
import { useFeatures, FEATURES } from '@/hooks/useFeatures';
import {
  listCurrenciesScoped,
  listLatestExchangeRatesScoped,
  getDefaultCurrencyScoped,
  getLatestExchangeRateScoped,
  exchangeRateToDecimal,
  convertMinorUnits,
  reciprocalMillionths,
  type CurrencyDto,
  type ExchangeRateDto,
} from '@/api/currency';
import { listCustomersScoped, type CustomerDto } from '@/api/customers';
import { getLoyaltyAccount, redeemLoyaltyPoints, getPointsValue, type LoyaltyAccountWithDetails } from '@/api/loyalty';
import QrisQrDisplay from '@/components/QrisQrDisplay';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useSwipe } from '@/hooks/useSwipe';
import { useKeyboardAvoidance } from '@/hooks/useKeyboardAvoidance';
import { animDuration } from '@/utils/animation';
import StockShortfallDialog from '@/features/sales/StockShortfallDialog';
import ReceiptPreview from '@/features/sales/ReceiptPreview';
import type { PrintSalesReceiptArgs } from '@/api/sales';
import { plainErrorMessage } from '@/utils/app-error';
import './PaymentModal.css';

type PaymentMethod = 'cash' | 'card' | 'qris' | 'other' | 'open_bill' | 'credit';

interface SplitRow {
  id: number;
  method: PaymentMethod;
  otherLabel: string;
  amountMinor: string;
}

export interface PaymentModalProps {
  open: boolean;
  lineItems: CartLine[];
  total: Money;
  discountPercent?: number;
  discountLabel?: string;
  userId: string;
  /** ADR #7 session token for scoped commands (deduction-aware cart lifecycle). */
  sessionToken?: string;
  tableNumber?: string;
  selectedCustomer?: CustomerDto | null;
  onCustomerChange?: (customer: CustomerDto | null) => void;
  onComplete: () => void;
  onClose: () => void;
  /** Serial numbers captured per SKU for track_serial products. */
  serialNumbers?: Record<string, string>;
  /** Custom quick tender preset amounts (in minor units). Defaults to standard Rp denominations. */
  tenderPresets?: number[];
  /** Tip amount in minor units collected at checkout (default 0). Persisted on the sale. */
  tipMinor?: number;
  /** Service-charge amount in minor units collected at checkout (default 0). Persisted on the sale. */
  serviceChargeMinor?: number;
  /**
   * PROMO-3: promotion ids selected in the picker. The backend engine
   * applies them against the post-tax sale at checkout; this modal previews
   * the reduced total so the displayed amount and the payment splits cover
   * exactly what the checkout call will validate against.
   */
  promotionIds?: string[];
  /**
   * F2-6: the caller's claim that the displayed tax was an ESTIMATE —
   * the cart-tax cache was stale/unknown at checkout (D64 b). Threaded
   * into the complete_sale_scoped payload; core verifies by computing
   * the tax itself and stamps the claim + computed tax onto the sale.
   * Absent/false is the zero-change default: no stamp requested.
   */
  taxEstimated?: boolean;
}

/** Payment processing modal — method selection (cash, card, QRIS, open bill, credit), split tender, customer/loyalty, multi-currency, and change calculation. */
export default function PaymentModal({
  open,
  lineItems,
  total,
  discountPercent = 0,
  discountLabel,
  // `userId` is deliberately not destructured. It is declared required on PaymentModalProps and
  // passed by both callers, but the component body never reads it -- it appeared only inside two
  // useCallback dependency arrays, which is what kept it "used" and hid the fact. The backend
  // resolves the cashier from `sessionToken`, so the value is redundant on every ADR #7 path. The
  // prop is left on the interface rather than removed because 62 test call sites pass it; dropping
  // it is a real cleanup but a separate, wider change. Recorded in docs/plans/0.0.36-backlog.md.
  sessionToken,
  tableNumber,
  selectedCustomer: selectedCustomerProp,
  onCustomerChange,
  onComplete,
  onClose,
  serialNumbers,
  tenderPresets,
  tipMinor = 0,
  serviceChargeMinor = 0,
  promotionIds,
  taxEstimated,
}: PaymentModalProps) {
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  // C2.2: QRIS is a Plus+ feature — caps arrive from the subscription context.
  const { caps } = useSubscription();
  const locale = useContext(LocaleContext)?.locale ?? 'en';
  const { addToast } = useToast();
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [otherLabel, setOtherLabel] = useState('');
  const [tendered, setTendered] = useState('');
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [changeDue, setChangeDue] = useState<Money | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDto | null>(selectedCustomerProp ?? null);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [loyaltyAccount, setLoyaltyAccount] = useState<LoyaltyAccountWithDetails | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0n);
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  // PROMO-3: engine-exact preview of the promotion-reduced payable, from
  // the displayed cart lines. Null when no promotions are selected (or the
  // preview failed — the checkout call then validates against the
  // un-promoted total and fails closed if the splits no longer cover it).
  const [promoPreview, setPromoPreview] = useState<PreviewPromotedTotalResult | null>(null);
  const [pointsWorthMinor, setPointsWorthMinor] = useState<number | null>(null);

  const notifyCustomerChange = useCallback(
    (c: CustomerDto | null) => {
      setSelectedCustomer(c);
      onCustomerChange?.(c);
    },
    [onCustomerChange],
  );
  // The reset effect below must run ONLY when the modal opens (or the charge
  // currency changes) — NOT on every parent re-render. Consumers pass
  // onCustomerChange as an inline arrow, so notifyCustomerChange's identity
  // changes with every parent render; depending on it directly would re-run
  // the effect and wipe user input (e.g. the tendered amount) mid-payment.
  // Route through a ref so the effect body always calls the latest callback
  // while the effect itself stays stable (same pattern as l10nRef above).
  const notifyCustomerChangeRef = useRef(notifyCustomerChange);
  notifyCustomerChangeRef.current = notifyCustomerChange;
  // Same identity-churn protection for the auto-dismiss timer: consumers
  // pass onComplete/onClose as inline arrows, and parents that re-render
  // frequently (e.g. the retail POS 1-second clock) would otherwise keep
  // re-arming the dismiss timer via the effect dependency below.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState<CustomerDto[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const allCustomersRef = useRef<CustomerDto[]>([]);
  const [leaving, setLeaving] = useState(false);
  const leaveCb = useRef<(() => void) | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const customerSearchPanelRef = useRef<HTMLDivElement>(null);

  // One id per checkout *attempt*, so the backend can make completion
  // idempotent: a replay returns the receipt that already exists instead of
  // ringing up a second sale.
  //
  // The lifetime is the attempt, not the mount. The sales host keeps this
  // component mounted and merely toggles `open` (`{total && <PaymentModal
  // open={showPayment} …/>}`), and the early `return null` on !open below is
  // a render short-circuit — not an unmount — so refs survive Cancel →
  // re-open. A mount-scoped id would therefore leak into the NEXT customer's
  // checkout, and the backend would replay the previous basket's receipt for
  // a different basket. The open-reset effect below re-mints on every open;
  // within one attempt every submission still carries the same value: the
  // first tap, the shortfall-resolution retry (the dialog renders inside
  // this tree), and any re-tap after a lost response.
  //
  // Lazy init, not `useRef(crypto.randomUUID())`: the eager form evaluates on
  // every render and discards the result, which reads as a bug waiting to be
  // "fixed" by moving it into state — and re-minting per render would silently
  // defeat the whole mechanism.
  const attemptIdRef = useRef<string | null>(null);
  if (attemptIdRef.current === null) {
    attemptIdRef.current = crypto.randomUUID();
  }

  const MS_200 = animDuration(200);

  // ── Error classification ───────────────────────────────────────

  /** Determine whether an error is likely retryable (network) or terminal (declined). */
  const classifyError = useCallback((err: unknown): { message: string; retryable: boolean } => {
    const errMsg = err instanceof Error ? err.message : String(err);
    const lower = errMsg.toLowerCase();
    // Retryable: network, timeout, connection, server errors
    const retryablePatterns = [
      'timeout', 'timed out', 'network', 'econnrefused', 'etimedout',
      'econnreset', 'enotfound', 'connection', 'server error',
      'try again', 'unavailable', 'offline',
    ];
    const isRetryable = retryablePatterns.some((p) => lower.includes(p));
    // Terminal: explicitly declined or invalid — NOT retryable even if also matches retryable patterns
    const terminalPatterns = [
      'declined', 'invalid', 'not found', 'insufficient',
      'unauthorized', 'forbidden', 'already',
    ];
    const isTerminal = terminalPatterns.some((p) => lower.includes(p));
    return {
      // The classification above reads the raw text on purpose; the message
      // surfaced to the user goes through the shared safe mapper (ERR-05).
      message: plainErrorMessage(err, errMsg),
      retryable: isRetryable && !isTerminal,
    };
  }, []);

  const animateLeave = useCallback((done: () => void) => {
    setLeaving(true);
    leaveCb.current = done;
  }, []);

  const handleLeaveEnd = useCallback(() => {
    if (!leaving) return;
    leaveCb.current?.();
    leaveCb.current = null;
    setLeaving(false);
  }, [leaving]);

  const [showQr, setShowQr] = useState(false);
  const [qrReference, setQrReference] = useState('');
  // P7-1: Swipe right on payment modal → go back to cart
  const paymentSwipe = useSwipe({
    onSwipeRight: () => {
      if (!processing && !done) animateLeave(onClose);
    },
  });

  // P7-4: Keyboard avoidance – scroll inputs into view on mobile
  const { containerRef: keyboardAvoidRef } = useKeyboardAvoidance();

  const [shortfallResult, setShortfallResult] = useState<PartialStockResult | null>(null);
  const [receiptArgs, setReceiptArgs] = useState<PrintSalesReceiptArgs | null>(null);

  const [paymentError, setPaymentError] = useState<{ message: string; retryable: boolean } | null>(null);

  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<SplitRow[]>([
    { id: 1, method: 'cash', otherLabel: '', amountMinor: '' },
    { id: 2, method: 'card', otherLabel: '', amountMinor: '' },
  ]);
  const nextSplitId = useRef(3);

  const { isEnabled } = useFeatures();
  const multiCurrency = isEnabled(FEATURES.MULTI_CURRENCY);

  const [currencies, setCurrencies] = useState<CurrencyDto[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateDto[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState(total.currency);
  const [baseCurrency, setBaseCurrency] = useState(total.currency);

  useEffect(() => {
    if (open && multiCurrency) {
      const loads: [
        Promise<CurrencyDto[]>,
        Promise<ExchangeRateDto[]>,
        Promise<string | null>,
      ] = [
        listCurrenciesScoped(sessionToken!),
        // CUR-11: the picker needs the CURRENT rate per pair, not the
        // whole history — bounded query, no first-match ambiguity.
        listLatestExchangeRatesScoped(sessionToken!),
        getDefaultCurrencyScoped(sessionToken!),
      ];
      Promise.all(loads)
        .then(([currs, rates, base]) => {
          setCurrencies(currs);
          setExchangeRates(rates);
          if (base) setBaseCurrency(base);
        })
        .catch(() => addToast({ message: l10nRef.current.getString('payment-toast-currency-failed'), type: 'error' }));
    }
  }, [open, multiCurrency, sessionToken, addToast]); // l10n via ref — stable dep chain

  const exchangeRateInfo = useMemo(() => {
    if (selectedCurrency === total.currency) return null;
    const rate = exchangeRates.find(
      (r) => r.from_currency === total.currency && r.to_currency === selectedCurrency,
    );
    if (rate) {
      return { ...rate, rate: exchangeRateToDecimal(rate), inverted: false };
    }
    const inverse = exchangeRates.find(
      (r) => r.from_currency === selectedCurrency && r.to_currency === total.currency,
    );
    if (inverse) {
      return {
        ...inverse,
        rate: 1 / exchangeRateToDecimal(inverse),
        from_currency: total.currency,
        to_currency: selectedCurrency,
        // MONEY-01: the conversion must know the stored rate is the
        // reciprocal — `rate` here is float display math only.
        inverted: true,
      };
    }
    return null;
  }, [selectedCurrency, total.currency, exchangeRates]);

  // CUR-04: when a session store is active, ask the backend for the latest
  // rate effective today (or before) instead of relying on `find()` over the
  // full history list — the list is not ordered by effective date, so a
  // stale rate could be chosen. Falls back to the in-memory list only when
  // there is no session (single-store legacy path).
  const [latestRate, setLatestRate] = useState<ExchangeRateDto | null>(null);
  useEffect(() => {
    setLatestRate(null);
    if (!open || !multiCurrency || !sessionToken || selectedCurrency === total.currency) {
      return;
    }
    getLatestExchangeRateScoped(sessionToken, {
      fromCurrency: total.currency,
      toCurrency: selectedCurrency,
    })
      .then((r) => setLatestRate(r))
      .catch(() => setLatestRate(null));
  }, [open, multiCurrency, sessionToken, selectedCurrency, total.currency]);

  const effectiveRateInfo = useMemo(() => {
    if (!sessionToken || !latestRate) return exchangeRateInfo;
    return {
      ...latestRate,
      rate: exchangeRateToDecimal(latestRate),
      // The backend query is pair-specific (base→charge), so a hit is
      // always the direct direction.
      inverted: false,
    };
  }, [sessionToken, latestRate, exchangeRateInfo]);

  useEffect(() => {
    if (open) {
      // Fresh open = fresh checkout attempt: re-mint the idempotency id so
      // a reused mount cannot carry the previous basket's key into this one.
      attemptIdRef.current = crypto.randomUUID();
      setMethod('cash');
      setOtherLabel('');
      setTendered('');
      setProcessing(false);
      setDone(false);
      setChangeDue(null);
      setPaymentError(null);
      setSplitMode(false);
      setShowQr(false);
      setQrReference('');
      setShortfallResult(null);
      setReceiptArgs(null);
      setSelectedCurrency(total.currency);
      setCustomerSearchQuery('');
      setCustomerSearchResults([]);
      setSplits([
        { id: 1, method: 'cash', otherLabel: '', amountMinor: '' },
        { id: 2, method: 'card', otherLabel: '', amountMinor: '' },
      ]);
      // Only clear the customer if the parent did NOT explicitly provide a selectedCustomer prop.
      // If selectedCustomerProp is undefined, the parent expects us to manage the customer internally.
      // If it's null or a CustomerDto, the parent is controlling the customer selection.
      if (selectedCustomerProp === undefined) {
        notifyCustomerChangeRef.current(null);
      }
    }
    // onCustomerChange is intentionally omitted: it is routed through
    // notifyCustomerChangeRef, so depending on it here would re-run this
    // reset (and wipe the tendered amount) on every parent re-render.
  }, [open, total.currency, selectedCustomerProp]);

  useEffect(() => {
    if (!showCustomerSearch) return;
    if (!sessionToken) {
      // Customer data is store-scoped. Never fall back to the legacy global
      // command when this modal is rendered outside an authenticated scope.
      allCustomersRef.current = [];
      setCustomerSearchResults([]);
      setLoadingCustomers(false);
      return;
    }
    setLoadingCustomers(true);
    listCustomersScoped(sessionToken)
      .then((customers) => {
        allCustomersRef.current = customers;
        setCustomerSearchResults(customers);
      })
      .catch(() => { addToast({ message: requiredLocalized(l10nRef.current, 'payment-toast-customers-failed'), type: 'error' }); setCustomerSearchResults([]); })
      .finally(() => setLoadingCustomers(false));
  }, [showCustomerSearch, sessionToken, addToast]); // l10n via ref — stable dep chain

  useEffect(() => {
    if (!showCustomerSearch) return;
    const customers = allCustomersRef.current;
    const q = customerSearchQuery.trim().toLowerCase();
    if (!q) {
      setCustomerSearchResults(customers);
    } else {
      setCustomerSearchResults(
        customers.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.phone && c.phone.includes(q)) ||
            (c.email && c.email.toLowerCase().includes(q)),
        ),
      );
    }
  }, [showCustomerSearch, customerSearchQuery]);

  const totalMinor = useMemo(() => BigInt(total.minor_units), [total.minor_units]);

  useEffect(() => {
    if (selectedCustomer) {
      if (!sessionToken) {
        setLoyaltyAccount(null);
        return;
      }
      getLoyaltyAccount(sessionToken, selectedCustomer.id)
        .then((account) => {
          setLoyaltyAccount(account);
          if (account && account.account.points > 0) {
            setRedeemPoints(false);
            setLoyaltyDiscount(0n);
          }
        })
        .catch(() => { addToast({ message: requiredLocalized(l10nRef.current, 'payment-toast-loyalty-failed'), type: 'error' }); setLoyaltyAccount(null); });
    } else {
      setLoyaltyAccount(null);
      setRedeemPoints(false);
      setLoyaltyDiscount(0n);
    }
  }, [selectedCustomer, sessionToken, addToast]); // l10n via ref — stable dep chain

  useEffect(() => {
    if (loyaltyAccount?.account && loyaltyAccount.account.points > 0) {
      if (!sessionToken) {
        setPointsWorthMinor(null);
        return;
      }
      getPointsValue(sessionToken, loyaltyAccount.account.points)
        .then(setPointsWorthMinor)
        .catch(() => { addToast({ message: requiredLocalized(l10nRef.current, 'payment-toast-points-value-failed'), type: 'error' }); setPointsWorthMinor(null); });
    } else {
      setPointsWorthMinor(null);
    }
  }, [loyaltyAccount, sessionToken, addToast]); // l10n via ref — stable dep chain

  useEffect(() => {
    if (!redeemPoints || pointsToRedeem <= 0) {
      setLoyaltyDiscount(0n);
      return;
    }
    let cancelled = false;
    if (!sessionToken) return;
    getPointsValue(sessionToken, pointsToRedeem)
      .then((val) => {
        if (!cancelled) {
          const discount = BigInt(val);
          setLoyaltyDiscount(discount > totalMinor ? totalMinor : discount);
        }
      })
      .catch(() => { /* points value calc is best-effort */ });
    return () => { cancelled = true; };
  }, [pointsToRedeem, redeemPoints, totalMinor, sessionToken]);

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

  // Convert base currency amount to selected charge currency using exchange rate
  const convertToChargeCurrency = useCallback(
    (minorUnits: number | bigint): number => {
      if (selectedCurrency === total.currency || !effectiveRateInfo) {
        return typeof minorUnits === 'bigint' ? Number(minorUnits) : minorUnits;
      }
      // MONEY-01: exact fixed-point conversion. The old float chain
      // (divide to major, multiply by a binary-float rate, scale back)
      // mis-rounded every product landing on the .5 minor boundary
      // (0.03 USD @ 149.5 → 448 instead of 449).
      return convertMinorUnits({
        baseMinor: typeof minorUnits === 'bigint' ? Number(minorUnits) : minorUnits,
        baseExponent: minorUnitExponent(total.currency),
        rateMillionths: effectiveRateInfo.rate_millionths,
        chargeExponent: minorUnitExponent(selectedCurrency),
        inverse: effectiveRateInfo.inverted,
      });
    },
    [selectedCurrency, total.currency, effectiveRateInfo],
  );

  // Get the currency to use for the cart (charge currency if multi-currency, else base)
  const cartCurrency = multiCurrency && selectedCurrency !== total.currency ? selectedCurrency : total.currency;

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

  // PROMO-3: keep the engine preview in sync with the displayed cart.
  // The backend cart doesn't exist yet (it is materialized at the confirm
  // step), so the preview runs over the raw lines — the same cart → sale →
  // tax → engine sequence the checkout call performs.
  useEffect(() => {
    if (!open || !sessionToken || !promotionIds || promotionIds.length === 0) {
      setPromoPreview(null);
      return;
    }
    let cancelled = false;
    const args = {
      lines: lineItemsInCartCurrency.map((l) => ({
        sku: l.sku,
        qty: l.qty,
        unitPriceMinor: l.unit_price.minor_units,
        unitPriceCurrency: l.unit_price.currency,
      })),
      discountPercent,
      promotionIds,
    };
    if (args.lines.length === 0) {
      setPromoPreview(null);
      return;
    }
    previewPromotedTotalFromLinesScoped(sessionToken, args)
      .then((r) => {
        if (!cancelled) setPromoPreview(r);
      })
      .catch(() => {
        // Preview is best-effort display support: fall back to the
        // un-promoted total. The checkout call re-validates everything
        // server-side and fails closed on any mismatch.
        if (!cancelled) setPromoPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionToken, promotionIds, lineItemsInCartCurrency, discountPercent]);

  // Convert tendered amount to cart currency
  const tenderedMinorInCartCurrency = useMemo(() => {
    if (cartCurrency === total.currency) return Number(tenderedMinor);
    // MONEY-02: exact decimal parse at the charge currency's exponent.
    const parsed = parseMinorUnits(tendered, minorUnitExponent(cartCurrency));
    if (parsed === null || parsed < 0) return 0;
    return parsed;
  }, [tendered, cartCurrency, tenderedMinor, total.currency]);

  // CUR-02: snapshot of what the customer actually paid — tip/service are
  // always sent; base-currency fields appear only when the charge
  // currency differs from the sale's base currency. Shared by the QRIS
  // path, the main path, and the FRONTEND-04 shortfall retry so all three
  // settle with identical tender metadata.
  const tenderSnapshot = useMemo(
    () => ({
      tipMinor,
      serviceChargeMinor,
      ...(cartCurrency !== total.currency && effectiveRateInfo
        ? {
            baseCurrency: total.currency,
            baseTotalMinor: total.minor_units,
            // MONEY-01: persist the ORIGINAL fixed-point integer (or its
            // exact reciprocal for inverse pairs) instead of round-tripping
            // the float display rate through 1e6.
            tenderRateMillionths: effectiveRateInfo.inverted
              ? reciprocalMillionths(effectiveRateInfo.rate_millionths)
              : effectiveRateInfo.rate_millionths,
          }
        : {}),
    }),
    [tipMinor, serviceChargeMinor, cartCurrency, total.currency, total.minor_units, effectiveRateInfo],
  );

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

  const handleQrPay = useCallback(() => {
    const ref = `QR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    setQrReference(ref);
    setShowQr(true);
  }, []);

  const handleQrConfirmed = useCallback(async () => {
    setShowQr(false);
    setProcessing(true);

    try {
      const { cartId } = await startSaleScoped(sessionToken!, { currency: cartCurrency });

      if (discountPercent > 0) {
        const scopedArgs: SetCartDiscountScopedArgs = { cartId, percent: discountPercent };
        if (discountLabel) scopedArgs.label = discountLabel;
        await setCartDiscountScoped(sessionToken!, scopedArgs);
      }

      for (const line of lineItemsInCartCurrency) {
        const lineArgs = {
          cartId,
          sku: line.sku,
          qty: line.qty,
          unitPriceMinor: line.unit_price.minor_units,
          // FRONTEND-03: carry the line's own currency across IPC so the
          // backend can reject a mismatch instead of silently re-stamping
          // it to the cart currency.
          unitPriceCurrency: line.unit_price.currency,
        };
        await addLineScoped(sessionToken!, lineArgs);
      }

      const serialNumberArgs: SerialNumberArg[] | undefined = serialNumbers
        ? Object.entries(serialNumbers)
            .filter(([_, s]) => s.trim().length > 0)
            .map(([lineId, serial]) => {
              const line = lineItems.find((l) => String(l.id) === lineId);
              return { sku: String(line?.sku ?? lineId), serial };
            })
        : undefined;
      // CUR-02: snapshot the base currency / total / rate for the QRIS
      // settlement payload too. Tip/service always sent.
      // FRONTEND-04: shared tenderSnapshot memo (see component scope).
      const saleResult = await completeSaleScoped(sessionToken!, {
            cartId,
            paymentMethod: 'QRIS',
            tenderedMinor: null,
            // COR-7: the scan-and-wait flow is ONE checkout attempt. The QR
            // was generated under this attempt's id (attemptIdRef only
            // re-mints on an open transition, so it is the same id the QR
            // generation ran under), and the confirm callback can legally
            // fire MORE than once for one QR — a poll that returns pending
            // and then succeeds twice. Every firing carries the same id, so
            // the backend's replay guard answers the second settlement with
            // the FIRST receipt instead of ringing a second sale.
            attemptId: attemptIdRef.current ?? undefined,
            ...(selectedCustomer ? { customerId: selectedCustomer.id } : {}),
            ...(serialNumberArgs && serialNumberArgs.length > 0 ? { serialNumbers: serialNumberArgs } : {}),
            paymentSplits: [
              {
                method: 'QRIS',
                amountMinor: effectiveTotalInCartCurrency,
                gatewayReference: qrReference,
                gatewayStatus: 'completed',
                gatewayResponse: 'QRIS payment confirmed',
              },
            ],
            // PROMO-3: the engine re-applies and re-validates server-side.
            ...(promotionIds && promotionIds.length > 0 ? { promotionIds } : {}),
            // F2-6: the client's estimate claim — absent (falsy) means
            // the tax was freshly computed and no stamp is requested.
            ...(taxEstimated ? { taxEstimated: true } : {}),
            ...tenderSnapshot,
          } as CompleteSaleScopedArgs);

      try {
        // ADR #7: read the sale back from the same store completeSaleScoped just wrote it to.
        // The value feeds the receipt preview, so an ambient read here showed a customer a
        // total fetched from a different store than the one they had just paid into.
        const completedSale = sessionToken
          ? await getSaleScoped(sessionToken, saleResult.saleId)
          : await getSale(saleResult.saleId);

        const qrisReceiptData: PrintSalesReceiptArgs = {
          date: new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
          }),
          receiptNumber: `SALE-${saleResult.saleId}`,
          items: lineItemsInCartCurrency.map((line, i) => {
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
            : { minorUnits: saleResult.total?.minor_units ?? effectiveTotalInCartCurrency, currency: cartCurrency },
          ...(completedSale && completedSale.taxTotal && completedSale.taxTotal.minor_units > 0
            ? { tax: { minorUnits: completedSale.taxTotal.minor_units, currency: cartCurrency } }
            : {}),
          total: { minorUnits: saleResult.total?.minor_units ?? effectiveTotalInCartCurrency, currency: cartCurrency },
          payments: [
            {
              method: 'QRIS',
              amount: { minorUnits: effectiveTotalInCartCurrency, currency: cartCurrency },
              change: null,
            },
          ],
          ...(tableNumber ? { tableNumber } : {}),
        };
        setReceiptArgs(qrisReceiptData);
      } catch {
        // Sale fetch may fail in edge cases — non-blocking.
      }

      try {
        await createKdsOrderFromSaleScoped(sessionToken!, saleResult.saleId);
      } catch (kdsErr) {
        // KDS may not be configured — but a swallowed failure here meant a
        // paid sale silently produced NO kitchen ticket (retried zoned
        // checkouts hit the UNIQUE guard). The cashier must know to call
        // the kitchen; the sale itself is already committed.
        console.error('createKdsOrderFromSale failed', kdsErr);
        addToast({ message: requiredLocalized(l10nRef.current, 'payment-toast-kds-failed'), type: 'warning' });
      }

      // ADR-20: Finalize the pending sale after QR confirmation
      if (sessionToken) {
        try {
          await finalizeSale(sessionToken, saleResult.saleId);
        } catch (finalizeErr) {
          addToast({ message: `Finalize failed, attempting void: ${finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr)}`, type: 'error' });
          try {
            await voidPendingSale(sessionToken, saleResult.saleId);
          } catch (voidErr) {
            addToast({ message: `Void also failed: ${voidErr instanceof Error ? voidErr.message : String(voidErr)}`, type: 'error' });
          }
          throw finalizeErr;
        }
      }

      if (loyaltyAccount && redeemPoints && loyaltyDiscount > 0n) {
        try {
          if (selectedCustomer?.id) {
            if (sessionToken) {
              await redeemLoyaltyPoints(
                sessionToken,
                selectedCustomer.id,
                Number(loyaltyDiscount),
                saleResult.saleId,
              );
            }
          }
        } catch {
          // non-blocking
        }
      }

      setDone(true);
    } catch (err) {
      addToast({ message: `QR payment failed: ${plainErrorMessage(err)}`, type: 'error' });
      const classified = classifyError(err);
      setPaymentError(classified);
    } finally {
      setProcessing(false);
    }
  }, [lineItems, discountPercent, discountLabel, promotionIds, sessionToken, qrReference, selectedCustomer, loyaltyAccount, redeemPoints, loyaltyDiscount, serialNumbers, tableNumber, classifyError, addToast, cartCurrency, lineItemsInCartCurrency, effectiveTotalInCartCurrency, tenderSnapshot, taxEstimated]);

  const addSplit = useCallback(() => {
    setSplits((prev) => [
      ...prev,
      { id: nextSplitId.current++, method: 'cash', otherLabel: '', amountMinor: '' },
    ]);
  }, []);

  const removeSplit = useCallback((id: number) => {
    setSplits((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const updateSplit = useCallback((id: number, patch: Partial<SplitRow>) => {
    setSplits((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const autoSplitEvenly = useCallback(() => {
    const count = splits.length;
    if (count === 0) return;
    const exp = minorUnitExponent(cartCurrency);
    // Integer floor division in minor units: every row gets baseMinor, and the
    // exact remainder lands on the last row — avoids float `toFixed` rounding
    // that used to over-split non-divisible totals (e.g. 4,450,001 by 2 became
    // 2,225,001 + 2,225,002 = 4,450,003).
    const baseMinor = Math.floor(effectiveTotalInCartCurrency / count);
    const remainderMinor = effectiveTotalInCartCurrency % count;
    const fmt = (minor: number) => (minor / 10 ** exp).toFixed(exp);
    setSplits((prev) =>
      prev.map((s, i) => ({
        ...s,
        amountMinor: i === prev.length - 1
          ? fmt(baseMinor + remainderMinor)
          : fmt(baseMinor),
      })),
    );
  }, [splits.length, effectiveTotalInCartCurrency, cartCurrency]);

  const canComplete = useMemo(() => {
    if (splitMode) return splitComplete;
    if (method === 'other' && !otherLabel.trim()) return false;
    if (method === 'open_bill') return customerName.trim().length > 0;
    if (method === 'credit') return customerName.trim().length > 0;
    if (method === 'cash') return sufficient;
    if (method === 'qris') return qrReference.length > 0;
    return true;
  }, [splitMode, splitComplete, method, otherLabel, sufficient, customerName, qrReference]);

  const complete = useCallback(async () => {
    setProcessing(true);

    try {
      // ── Open Bill: save cart without payment ──────────────
      if (method === 'open_bill') {
        const cartData = JSON.stringify({
          lines: lineItems.map((l) => ({
            sku: l.sku,
            name: l.name,
            qty: l.qty,
            unit_price: l.unit_price,
          })),
          discountPercent,
          discountLabel,
          tableNumber,
        });
        await holdCartScoped(sessionToken!, {
          label: customerName.trim() || `Open Bill #${Date.now()}`,
          cart_data: cartData,
          item_count: lineItems.length,
          total_minor: total.minor_units,
          currency: total.currency,
          bill_type: 'open_bill',
          customer_name: customerName.trim(),
        });
        setDone(true);
        return;
      }


      const { cartId } = await startSaleScoped(sessionToken!, { currency: cartCurrency });

      if (discountPercent > 0) {
        const scopedArgs: SetCartDiscountScopedArgs = { cartId, percent: discountPercent };
        if (discountLabel) scopedArgs.label = discountLabel;
        await setCartDiscountScoped(sessionToken!, scopedArgs);
      }

      for (const line of lineItemsInCartCurrency) {
        const lineArgs = {
          cartId,
          sku: line.sku,
          qty: line.qty,
          unitPriceMinor: line.unit_price.minor_units,
          // FRONTEND-03: carry the line's own currency across IPC so the
          // backend can reject a mismatch instead of silently re-stamping
          // it to the cart currency.
          unitPriceCurrency: line.unit_price.currency,
        };
        await addLineScoped(sessionToken!, lineArgs);
      }

      let paymentSplits: PaymentSplitArg[] | undefined;

      if (splitMode) {
        const exp = minorUnitExponent(cartCurrency);
        paymentSplits = splits.map((s) => ({
          method: s.method === 'other' ? s.otherLabel.trim() || 'OTHER' : s.method.toUpperCase(),
          amountMinor: parseMinorUnits(s.amountMinor || '0', exp) ?? 0,
        }));
      }

      const methodLabel = splitMode
        ? 'split'
        : method === 'other'
          ? otherLabel.trim() || 'OTHER'
          : method.toUpperCase();

      const serialNumberArgs: SerialNumberArg[] | undefined = serialNumbers
        ? Object.entries(serialNumbers)
            .filter(([_, s]) => s.trim().length > 0)
            .map(([lineId, serial]) => {
              const line = lineItems.find((l) => String(l.id) === lineId);
              return { sku: String(line?.sku ?? lineId), serial };
            })
        : undefined;
      // CUR-02: when multi-currency checkout converted the total, snapshot
      // the original (base) currency, base total, and the fixed-point rate
      // used so the backend can persist them atomically on the sale for
      // audit/refund/reconciliation. Omitted entirely for single-currency
      // sales (the common case). Tip and service charge are always sent so
      // the backend records what the customer actually paid.
      // FRONTEND-04: shared tenderSnapshot memo (see component scope).

      const saleResult = await completeSaleScoped(sessionToken!, {
            cartId,
            paymentMethod: methodLabel,
            tenderedMinor: method === 'cash' && !splitMode ? tenderedMinorInCartCurrency : null,
            ...(selectedCustomer ? { customerId: selectedCustomer.id } : {}),
            ...(paymentSplits ? { paymentSplits } : {}),
            ...(method === 'credit' && customerName.trim() ? { customerName: customerName.trim() } : {}),
            ...(serialNumberArgs && serialNumberArgs.length > 0 ? { serialNumbers: serialNumberArgs } : {}),
            // PROMO-3: the engine re-applies and re-validates server-side.
            ...(promotionIds && promotionIds.length > 0 ? { promotionIds } : {}),
            attemptId: attemptIdRef.current ?? undefined,
            // F2-6: the client's estimate claim — absent (falsy) means
            // the tax was freshly computed and no stamp is requested.
            ...(taxEstimated ? { taxEstimated: true } : {}),
            ...tenderSnapshot,
          } as CompleteSaleScopedArgs);

      // ADR-20: Finalize the pending sale (transitions 'pending' → 'completed')
      // For cash/credit/other/split methods, capture is instantaneous — finalize immediately.
      // Note: open_bill returns early above, so this only runs for paid methods.
      if (sessionToken) {
        try {
          await finalizeSale(sessionToken, saleResult.saleId);
        } catch (finalizeErr) {
          // Attempt to void the pending sale to restore stock
          addToast({ message: `Finalize failed, attempting void: ${finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr)}`, type: 'error' });
          try {
            await voidPendingSale(sessionToken, saleResult.saleId);
          } catch (voidErr) {
            addToast({ message: `Void also failed: ${voidErr instanceof Error ? voidErr.message : String(voidErr)}`, type: 'error' });
          }
          // Throw the original finalize error so the outer catch handles it
          throw finalizeErr;
        }
      }

      try {
        // ADR #7: read the sale back from the same store completeSaleScoped just wrote it to.
        // The value feeds the receipt preview, so an ambient read here showed a customer a
        // total fetched from a different store than the one they had just paid into.
        const completedSale = sessionToken
          ? await getSaleScoped(sessionToken, saleResult.saleId)
          : await getSale(saleResult.saleId);

        const receiptData: PrintSalesReceiptArgs = {
          date: new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
          }),
          receiptNumber: `SALE-${saleResult.saleId}`,
          items: lineItemsInCartCurrency.map((line, i) => {
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
            : { minorUnits: saleResult.total?.minor_units ?? effectiveTotalInCartCurrency, currency: cartCurrency },
          ...(completedSale && completedSale.taxTotal && completedSale.taxTotal.minor_units > 0
            ? { tax: { minorUnits: completedSale.taxTotal.minor_units, currency: cartCurrency } }
            : {}),
          total: { minorUnits: saleResult.total?.minor_units ?? effectiveTotalInCartCurrency, currency: cartCurrency },
          payments: paymentSplits
            ? paymentSplits.map((ps) => ({
                method: ps.method,
                amount: { minorUnits: ps.amountMinor, currency: cartCurrency },
                change: null,
              }))
            : [
                {
                  method: methodLabel,
                  amount: { minorUnits: effectiveTotalInCartCurrency, currency: cartCurrency },
                  change: change
                    ? { minorUnits: change.minor_units, currency: change.currency }
                    : null,
                },
              ],
          ...(tableNumber ? { tableNumber } : {}),
        };
        // Store receipt data for preview (user chooses to print or skip)
        setReceiptArgs(receiptData);
      } catch {
        // Receipt/KDS may not be configured — non-blocking
      }

      try {
        await createKdsOrderFromSaleScoped(sessionToken!, saleResult.saleId);
      } catch (kdsErr) {
        // See the QR path: a failed kitchen ticket must not stay silent.
        console.error('createKdsOrderFromSale failed', kdsErr);
        addToast({ message: requiredLocalized(l10n, 'payment-toast-kds-failed'), type: 'warning' });
      }

      if (loyaltyAccount && redeemPoints && loyaltyDiscount > 0n) {
        try {
          if (selectedCustomer?.id) {
            if (sessionToken) {
              await redeemLoyaltyPoints(
                sessionToken,
                selectedCustomer.id,
                Number(loyaltyDiscount),
                saleResult.saleId,
              );
            }
          }
        } catch {
          // Loyalty redemption failure is non-blocking
        }
      }

      if (change) setChangeDue(change);
      setDone(true);
    } catch (err) {
      // Try to detect PartialStockResult from the backend error
      const errMsg = err instanceof Error ? err.message : String(err);
      const parsed = tryParsePartialStockResult(errMsg);
      if (parsed) {
        setShortfallResult(parsed);
        return; // Don't show generic error — let the ShortfallDialog handle it
      }
      const classified = classifyError(err);
      setPaymentError(classified);
      if (!classified.retryable) {
        addToast({ message: classified.message, type: 'error' });
      }
    } finally {
      setProcessing(false);
    }
  }, [method, customerName, lineItems, discountPercent, discountLabel, promotionIds, splitMode, splits, otherLabel, change, sessionToken, selectedCustomer, loyaltyAccount, redeemPoints, loyaltyDiscount, serialNumbers, tableNumber, addToast, classifyError, l10n, cartCurrency, effectiveTotalInCartCurrency, lineItemsInCartCurrency, tenderedMinorInCartCurrency, total.currency, total.minor_units, tenderSnapshot, taxEstimated]);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => {
      animateLeave(onCompleteRef.current);
    }, changeDue ? 3000 : 1500);
    return () => clearTimeout(timer);
  }, [done, changeDue, animateLeave]); // onComplete via ref — stable deps

  // Auto-dismiss after leave animation completes
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(handleLeaveEnd, MS_200);
    return () => clearTimeout(timer);
  }, [leaving, handleLeaveEnd, MS_200]);

  // ── Focus trap (Escape + Tab cycling) ─────────────────────
  useFocusTrap(panelRef, open && !leaving && !processing && !done, () => {
    if (!showCustomerSearch && !showQr) animateLeave(onClose);
  });

  // ── Focus trap for nested customer search modal ────────────
  useFocusTrap(customerSearchPanelRef, showCustomerSearch, () => setShowCustomerSearch(false));

  // Parse PartialStockResult from Tauri error messages
  const tryParsePartialStockResult = (msg: string): PartialStockResult | null => {
    try {
      // Tauri wraps AppError with prefix; try to find JSON in the message
      const jsonStart = msg.indexOf('{');
      if (jsonStart < 0) return null;
      const jsonStr = msg.substring(jsonStart);
      const parsed = JSON.parse(jsonStr);
      if (parsed && parsed.requiresResolution && Array.isArray(parsed.shortfalls)) {
        return parsed as PartialStockResult;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Reconstruct payment splits from the current split state (for shortfall retry)
  const paymentSplitsFromState = useCallback((): PaymentSplitArg[] | undefined => {
    if (!splitMode) return undefined;
    const exp = minorUnitExponent(total.currency);
    return splits.map((s) => ({
      method: s.method === 'other' ? s.otherLabel.trim() || 'OTHER' : s.method.toUpperCase(),
      amountMinor: parseMinorUnits(s.amountMinor || '0', exp) ?? 0,
    }));
  }, [splitMode, splits, total.currency]);

  // Reconstruct serial number args from the current serialNumbers prop
  const serialNumberArgsFromState = useCallback((): SerialNumberArg[] | undefined => {
    if (!serialNumbers) return undefined;
    return Object.entries(serialNumbers)
      .filter(([_, s]) => s.trim().length > 0)
      .map(([lineId, serial]) => {
        const line = lineItems.find((l) => String(l.id) === lineId);
        return { sku: String(line?.sku ?? lineId), serial };
      });
  }, [serialNumbers, lineItems]);

  if (!open && !leaving) return null;

  const stateClass = leaving ? 'payment-overlay--exit' : 'payment-overlay--enter';
  const modalStateClass = leaving ? 'payment-modal--exit' : 'payment-modal--enter';

  return (
      <Localized id="payment-dialog-aria" attrs={{ 'aria-label': true }}>
        <div className={`payment-overlay ${stateClass}`} role="dialog" aria-modal="true" {...paymentSwipe}>
      <QrisQrDisplay
        amount={total.minor_units}
        currency={total.currency}
        reference={qrReference}
        isOpen={showQr}
        onClose={() => setShowQr(false)}
        onPaymentConfirmed={handleQrConfirmed}
      />

      {shortfallResult && (
        <StockShortfallDialog
          shortfallResult={shortfallResult}
          // FRONTEND-04: the retry must settle in the SAME currency the
          // first command used (cartCurrency, with converted lines) — not
          // the base currency — and forward the CUR-02 tender snapshot
          // (tip/service + base fields when converted) so the second
          // command records what the customer actually paid.
          cartLines={lineItemsInCartCurrency.map((l) => ({
            sku: l.sku,
            qty: l.qty,
            unitPriceMinor: l.unit_price.minor_units,
            // FRONTEND-03 follow-up: carry the line's own currency so the
            // backend can enforce it on reconstruction.
            unitPriceCurrency: l.unit_price.currency,
          }))}
          // PROMO-3: the retry total must be the UNPROMOTED one — the
          // backend shortfall command re-applies the promotions itself
          // (reducing the sale total from this base), so the promoted
          // charge total would discount twice.
          totalMinor={unpromotedTotalInCartCurrency}
          currency={cartCurrency}
          {...tenderSnapshot}
          // PROMO-3: the SAME promotion list the first submission carried,
          // in the same order, so the retry re-applies identical discounts.
          promotionIds={promotionIds && promotionIds.length > 0 ? promotionIds : null}
          paymentMethod={splitMode ? 'split' : method === 'other' ? otherLabel.trim() || 'OTHER' : method.toUpperCase()}
          tenderedMinor={method === 'cash' && !splitMode ? tenderedMinorInCartCurrency : null}
          paymentSplits={paymentSplitsFromState() ?? null}
          customerId={selectedCustomer?.id ?? null}
          customerName={customerName.trim() || null}
          serialNumbers={serialNumberArgsFromState() ?? null}
          // The retry of THIS attempt, so it must carry the attempt's id —
          // not a fresh one. If the first submission committed and only its
          // response was lost, a new id here would let the backend ring up a
          // second sale, which is the exact case the guard exists for.
          attemptId={attemptIdRef.current ?? undefined}
          discountPercent={discountPercent}
          discountLabel={discountLabel ?? null}
          onComplete={async (result) => {
            setShortfallResult(null);
            if (!result?.saleId) {
              // No committed sale to describe — fall back to the old
              // bare completion (also keeps partially-mocked flows safe).
              setDone(true);
              return;
            }
            // Shortfall receipt parity: the retry committed a REAL sale,
            // so show the same print preview the normal path does. Items
            // come from the COMMITTED sale lines — resolutions may have
            // reduced quantities or substituted SKUs, the local cart no
            // longer describes what sold.
            try {
              // ADR #7, and the third site of this exact defect: the two receipt reads above were
              // converted by searching for the literal `getSale(saleResult.saleId)`, which missed
              // this one because the shortfall dialog's callback names its parameter `result`.
              // get_sale is registered by tablet only, so on desktop this threw, the catch below
              // swallowed it as "non-blocking", and the customer who had just paid saw no receipt
              // preview at all.
              const completedSale = sessionToken
                ? await getSaleScoped(sessionToken, result.saleId)
                : await getSale(result.saleId);
              const shortfallTotalMinor = result.total?.minor_units ?? completedSale?.total.minor_units ?? effectiveTotalInCartCurrency;
              const shortfallCurrency = result.total?.currency ?? completedSale?.total.currency ?? cartCurrency;
              const receiptData: PrintSalesReceiptArgs = {
                date: new Date().toLocaleDateString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric',
                }),
                receiptNumber: `SALE-${result.saleId}`,
                items: (completedSale?.lines ?? []).map((line) => ({
                  name: line.name || line.sku,
                  quantity: line.qty,
                  unitPrice: { minorUnits: line.unit_price.minor_units, currency: line.unit_price.currency },
                  totalPrice: { minorUnits: line.total_minor, currency: line.unit_price.currency },
                  ...(line.tax_amount
                    ? { taxAmount: { minorUnits: line.tax_amount.minor_units, currency: line.tax_amount.currency } }
                    : {}),
                })),
                subtotal: completedSale
                  ? { minorUnits: completedSale.subtotal.minor_units, currency: cartCurrency }
                  : { minorUnits: shortfallTotalMinor, currency: shortfallCurrency },
                ...(completedSale && completedSale.taxTotal && completedSale.taxTotal.minor_units > 0
                  ? { tax: { minorUnits: completedSale.taxTotal.minor_units, currency: cartCurrency } }
                  : {}),
                total: { minorUnits: shortfallTotalMinor, currency: shortfallCurrency },
                payments: paymentSplitsFromState()
                  ? paymentSplitsFromState()!.map((ps) => ({
                      method: ps.method,
                      amount: { minorUnits: ps.amountMinor, currency: cartCurrency },
                      change: null,
                    }))
                  : [
                      {
                        method: splitMode ? 'split' : method === 'other' ? otherLabel.trim() || 'OTHER' : method.toUpperCase(),
                        amount: { minorUnits: shortfallTotalMinor, currency: shortfallCurrency },
                        change: null,
                      },
                    ],
                ...(tableNumber ? { tableNumber } : {}),
              };
              setReceiptArgs(receiptData);
            } catch {
              // Receipt preview is non-blocking — mirrors the normal path.
            }
            setDone(true);
          }}
          onCancel={() => {
            setShortfallResult(null);
            addToast({ message: requiredLocalized(l10n, 'payment-shortfall-cancelled'), type: 'info' });
            animateLeave(onClose);
          }}
        />
      )}

      {!shortfallResult && (
      <div className={`payment-modal ${modalStateClass}`} data-testid="payment-modal" ref={(el) => {
        // Combine panelRef (focus trap) with keyboardAvoidRef (scroll-into-view)
        (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        (keyboardAvoidRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}>
        {done && receiptArgs ? (
          <ReceiptPreview
            receipt={receiptArgs}
            onPrint={async () => {
              try {
                await printSalesReceipt(sessionToken!, receiptArgs);
                animateLeave(onComplete);
              } catch {
                // Printer error — still dismiss
                animateLeave(onComplete);
              }
            }}
            onSkip={() => animateLeave(onComplete)}
          />
        ) : done ? (
          <div className="payment-done" role="status" aria-live="assertive">
            <svg className="payment-done-checkmark" viewBox="0 0 64 64" aria-hidden="true">
              <circle className="payment-done-checkmark-circle" cx="32" cy="32" r="26" />
              <path className="payment-done-checkmark-path" d="M20 32 l8 8 l16 -16" />
            </svg>
            <Localized id="payment-done-title">
              <h2 className="payment-done-title">Sale Complete</h2>
            </Localized>
            {changeDue && (
              <div className="payment-change">
                <Localized id="payment-change-label">
                  <span className="payment-change-label">Change due</span>
                </Localized>
                <span className="payment-change-amount">
                  {formatMoney(changeDue)}
                </span>
              </div>
            )}
            <Localized id="payment-done-receipt">
              <p className="payment-done-note">Receipt printed</p>
            </Localized>
          </div>
        ) : (
          <>
            <div className="payment-header">
              <Localized id="payment-title">
                <h2 className="payment-title">Complete Sale</h2>
              </Localized>
              <Localized id="payment-close-aria" attrs={{ 'aria-label': true }}>
                <button
                  type="button"
                  className="payment-close"
                  onClick={() => animateLeave(onClose)}
                >
                  &times;
                </button>
              </Localized>
            </div>

            {tableNumber && (
              <div className="payment-table-badge">
                <Localized id="payment-table-number" vars={{ number: tableNumber }}>
                  <span>Table {tableNumber}</span>
                </Localized>
              </div>
            )}

            <div className="payment-total-row">
              <Localized id="payment-total-due">
                <span className="payment-total-label">Total Due</span>
              </Localized>
              <span className="payment-total-amount">
                {promoPreview
                  ? formatMoney({ minor_units: effectiveTotalInCartCurrency, currency: cartCurrency })
                  : loyaltyDiscount > 0n ? formatMoney(effectiveTotalMoney) : formatMoney(total)}
              </span>
            </div>

            {promoPreview && promoPreview.discounts.length > 0 && (
              <div className="payment-promotions-row">
                {promoPreview.discounts.map((d) => (
                  <div key={d.promotionId} className="payment-promotions-item">
                    <span className="payment-promotions-label">{d.description}</span>
                    <span className="payment-promotions-amount">
                      −{formatMoney({ minor_units: d.discountMinor, currency: cartCurrency })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {multiCurrency && (
              <div className="payment-currency-selector">
                  <Localized id="payment-currency-aria" attrs={{ 'aria-label': true }}>
                  {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span at runtime */}
                  <label htmlFor="payment-currency-select">
                    <Localized id="payment-currency-label">
                      <span className="payment-currency-label">Charge Currency</span>
                    </Localized>
                      <Localized id="payment-currency-select-aria" attrs={{ 'aria-label': true }}>
                      <select
                        id="payment-currency-select"
                        className="payment-currency-select"
                        value={selectedCurrency}
                        onChange={(e) => setSelectedCurrency(e.target.value)}
                      >
                        {currencies.length === 0 && (
                          <option value={total.currency}>{total.currency}</option>
                        )}
                        {currencies.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} — {c.name}
                          </option>
                        ))}
                      </select>
                      </Localized>
                  </label>
                  </Localized>
              </div>
            )}

            {selectedCurrency !== total.currency && effectiveRateInfo && (
              <Localized id="payment-exchange-aria" attrs={{ 'aria-label': true }}>
              <div className="payment-exchange-notice">
                <div className="payment-exchange-row">
                  <Localized id="payment-exchange-rate">
                    <span>Exchange rate</span>
                  </Localized>
                  <span>
                    1 {effectiveRateInfo.from_currency} = {effectiveRateInfo.rate.toFixed(6)} {effectiveRateInfo.to_currency}
                  </span>
                </div>
                <div className="payment-exchange-row">
                  <Localized id="payment-rate-source">
                    <span>Rate source</span>
                  </Localized>
                  <span>{effectiveRateInfo.source || l10n.getString('payment-rate-source-manual')}</span>
                </div>
                <div className="payment-exchange-row">
                  <Localized id="payment-rate-timestamp">
                    <span>Rate timestamp</span>
                  </Localized>
                  <span>{effectiveRateInfo.effective_date}</span>
                </div>
              </div>
              </Localized>
            )}

            {selectedCurrency !== total.currency && (
              <Localized id="payment-receipt-currency-aria" attrs={{ 'aria-label': true }}>
              <div className="payment-receipt-currency">
                <div className="payment-receipt-currency-row">
                  <Localized id="payment-charged-in">
                    <span>Charged in</span>
                  </Localized>
                  <span>{selectedCurrency}</span>
                </div>
                <div className="payment-receipt-currency-row">
                  <Localized id="payment-default-currency">
                    <span>Default currency</span>
                  </Localized>
                  <span>{baseCurrency}</span>
                </div>
                <div className="payment-receipt-currency-row">
                  <Localized id="payment-base-amount">
                    <span>Base amount</span>
                  </Localized>
                  <span>{formatMoney(total)}</span>
                </div>
                <div className="payment-receipt-currency-row">
                  <Localized id="payment-charge-amount">
                    <span>Charge amount</span>
                  </Localized>
                  <span>
                    {formatMoney({
                      minor_units: convertToChargeCurrency(total.minor_units),
                      currency: selectedCurrency,
                    } as Money)}
                  </span>
                </div>
              </div>
              </Localized>
            )}

            {!splitMode && (
              <>
                <fieldset className="payment-methods">
                  <Localized id="payment-method-label">
                    <legend className="payment-section-title">Payment Method</legend>
                  </Localized>
                  <div className="payment-method-options">
                    {(['cash', 'card', 'qris', 'credit'] as const).map((m) => (
                      <label key={m} className="payment-method-label" data-testid="quick-pay-button">
                        <input
                          type="radio"
                          name="payment-method"
                          value={m}
                          checked={method === m}
                          onChange={() => setMethod(m)}
                        />
                        <span className="payment-method-name">
                          {m === 'cash' ? l10n.getString('payment-method-cash') : m === 'card' ? l10n.getString('payment-method-card') : m === 'qris' ? l10n.getString('payment-method-qris') : requiredLocalized(l10n, 'payment-method-credit')}
                        </span>
                      </label>
                    ))}
                    <div className="payment-method-label">
                      <input
                        type="radio"
                        name="payment-method"
                        value="other"
                        checked={method === 'other'}
                        onChange={() => setMethod('other')}
                      />
                        <Localized id="payment-other-placeholder" attrs={{ 'aria-label': true, placeholder: true }}>
                        <input
                          type="text"
                          className="payment-other-input"
                          value={otherLabel}
                          onChange={(e) => {
                            setMethod('other');
                            setOtherLabel(e.target.value);
                          }}
                          disabled={method !== 'other'}
                        />
                        </Localized>
                    </div>
                    <>
                      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                      <label className="payment-method-label" htmlFor="payment-method-open-bill">
                        <input
                          id="payment-method-open-bill"
                          type="radio"
                          name="payment-method"
                          value="open_bill"
                          checked={method === 'open_bill'}
                          onChange={() => setMethod('open_bill')}
                        />
                        <span className="payment-method-name">
                          <Localized id="payment-open-bill"><span>Open Bill</span></Localized>
                        </span>
                      </label>
                    </>
                  </div>
                </fieldset>

                {(method === 'open_bill' || method === 'credit') && (
                  <div className="payment-open-bill-section">
                    <>
                      { }
                      {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- accessible text via Localized span + input aria-label at runtime */}
                      <label className="payment-customer-label" htmlFor="payment-customer-input">
                        <Localized id="payment-customer-name">
                          <span>Customer Name</span>
                        </Localized>
                          <Localized id="payment-customer-name-aria" attrs={{ 'aria-label': true }}>
                          <input
                            id="payment-customer-input"
                            type="text"
                            className="payment-customer-input"
                            placeholder={l10n.getString('payment-customer-placeholder')}
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                          />
                          </Localized>
                      </label>
                    </>
                  </div>
                )}

                {method === 'cash' && (
                  <div className="payment-cash-section">
                    <div className="payment-tendered-label">
                      <Localized id="payment-amount-tendered">
                        <span>Amount Tendered</span>
                      </Localized>
                        <Localized id="payment-tendered-input" attrs={{ 'aria-label': true, placeholder: true }}>
                        <input
                          type="text"
                          className="payment-tendered-input"
                          inputMode="decimal"
                          value={tendered}
                          onChange={(e) => setTendered(e.target.value)}
                        />
                        </Localized>
                    </div>

                    <div className="payment-quick-cash">
                      {(tenderPresets ?? [5000, 10000, 20000, 50000, 100000]).map((amount) => {
                        // Presets are major-unit denominations (Rp 5.000 / $5).
                        // Use the currency's minor-unit exponent so the quick
                        // buttons stay consistent with tenderedMinor's parse.
                        const exp = minorUnitExponent(total.currency);
                        const totalMajor = Number(total.minor_units) / 10 ** exp;
                        const quickVal = Math.ceil(totalMajor / amount) * amount;
                        return (
                          <button
                            key={amount}
                            type="button"
                            className="payment-quick-btn"
                            aria-label={l10n.getString('payment-quick-tender-aria', { amount: quickVal.toFixed(exp) }, 'Tender')}
                            onClick={() => setTendered(quickVal.toFixed(exp))}
                          >
                            {total.currency} {quickVal.toLocaleString('id-ID')}
                          </button>
                        );
                      })}
                      <Localized id="payment-tender-exact-aria" attrs={{ 'aria-label': true }}>
                      <button
                        type="button"
                        className="payment-quick-btn"
                        onClick={() => {
                          const exp = minorUnitExponent(total.currency);
                          setTendered((Number(total.minor_units) / 10 ** exp).toFixed(exp));
                        }}
                      >
                        <Localized id="payment-tender-exact">
                          <span>Exact</span>
                        </Localized>
                      </button>
                      </Localized>
                    </div>

                    {tendered.length > 0 && (
                      <div className="payment-change-preview">
                        <Localized id="payment-change">
                          <span className="payment-change-label">Change</span>
                        </Localized>
                        <span
                          className={`payment-change-amount ${!sufficient ? 'payment-change-insufficient' : ''}`}
                        >
                          {sufficient && change
                            ? formatMoney(change)
                            : l10n.getString('payment-insufficient')}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {method === 'qris' &&
                  (caps && !caps.supportsQris ? (
                    // C2.2: QRIS setup gate (Free→Plus trigger) — show the
                    // upgrade prompt instead of the QR generation UI.
                    <div className="payment-qris-upgrade" role="note">
                      <p>{l10n.getString('payment-qris-upgrade-required')}</p>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => openUpgradePricing(locale, 'plus')}
                      >
                        {l10n.getString('payment-qris-upgrade-cta')}
                      </Button>
                    </div>
                  ) : (
                  <div className="payment-qris-section">
                    <Localized id="payment-qris-description">
                      <p className="payment-qris-description">
                        Generate a QRIS QR code for the customer to scan with their payment app.
                      </p>
                    </Localized>
                    <button
                      type="button"
                      className="payment-qris-btn"
                      aria-label={l10n.getString('payment-qris-pay')}
                      onClick={handleQrPay}
                      disabled={processing}
                    >
                      <Localized id="payment-qris-pay">
                        <span>Pay with QR</span>
                      </Localized>
                    </button>
                  </div>
                  ))}
              </>
            )}

            {splitMode && (
              <div className="payment-split-section">
                <div className="payment-split-header">
                  <Localized id="payment-split-title">
                    <span className="payment-section-title">Split Payments</span>
                  </Localized>
                  <div className="payment-split-actions">
                    <button
                      type="button"
                      className="payment-split-btn"
                      aria-label={l10n.getString('payment-split-evenly')}
                      onClick={autoSplitEvenly}
                    >
                      <Localized id="payment-split-evenly">
                        <span>Split Evenly</span>
                      </Localized>
                    </button>
                    <button
                      type="button"
                      className="payment-split-btn"
                      aria-label={l10n.getString('payment-split-add')}
                      onClick={addSplit}
                    >
                      <Localized id="payment-split-add">
                        <span>+ Add Split</span>
                      </Localized>
                    </button>
                  </div>
                </div>

                <div className="payment-split-rows">
                  {splits.map((s) => (
                    <div key={s.id} className="payment-split-row">
                      <div className="payment-split-method-group">
                        {(['cash', 'card'] as const).map((m) => (
                          <label key={m} className="payment-split-radio-label">
                            <input
                              type="radio"
                              name={`split-method-${s.id}`}
                              value={m}
                              checked={s.method === m}
                              onChange={() => updateSplit(s.id, { method: m, otherLabel: '' })}
                            />
                            <span>{m === 'cash' ? l10n.getString('payment-split-method-cash') : l10n.getString('payment-split-method-card')}</span>
                          </label>
                        ))}
                        <div className="payment-split-radio-label">
                          <input
                            type="radio"
                            name={`split-method-${s.id}`}
                            value="other"
                            checked={s.method === 'other'}
                            onChange={() => updateSplit(s.id, { method: 'other' })}
                          />
                            <Localized id="payment-split-other-placeholder" attrs={{ 'aria-label': true, placeholder: true }}>
                            <input
                              type="text"
                              className="payment-split-other-input"
                              value={s.otherLabel}
                              onChange={(e) => updateSplit(s.id, { otherLabel: e.target.value })}
                              disabled={s.method !== 'other'}
                            />
                            </Localized>
                        </div>
                      </div>
                      <div className="payment-split-amount-group">
                        <span className="payment-split-currency">{total.currency}</span>
                          <Localized id="payment-split-amount-placeholder" attrs={{ placeholder: true, 'aria-label': true }}>
                            <input
                              type="text"
                              className="payment-split-amount-input"
                              inputMode="decimal"
                              value={s.amountMinor}
                              onChange={(e) => updateSplit(s.id, { amountMinor: e.target.value })}
                            />
                          </Localized>
                      </div>
                      <button
                        type="button"
                        className="payment-split-remove"
                        aria-label={l10n.getString('payment-split-remove-aria')}
                        onClick={() => removeSplit(s.id)}
                        disabled={splits.length <= 1}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>

                <div className="payment-split-remaining">
                  <Localized id="payment-split-remaining">
                    <span className="payment-split-remaining-label">Remaining</span>
                  </Localized>
                  <span
                    className={`payment-split-remaining-amount ${
                      splitTotals.remaining !== 0n ? 'payment-split-remaining-positive' : ''
                    }`}
                  >
                    {formatMoney({
                      minor_units: Number(splitTotals.remaining),
                      currency: total.currency,
                    } as Money)}
                  </span>
                </div>
              </div>
            )}

            <div className="payment-split-toggle">
              <label className="payment-split-toggle-label" htmlFor="payment-split-toggle-cb">
                <input
                  id="payment-split-toggle-cb"
                  type="checkbox"
                  checked={splitMode}
                  onChange={(e) => setSplitMode(e.target.checked)}
                />
                {l10n.getString('payment-split-toggle')}
              </label>
            </div>

            <div className="payment-customer-section">
              {selectedCustomer ? (
                <div className="payment-customer-badge">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
                    <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 1114 0H3z" />
                  </svg>
                  <span className="payment-customer-name">{selectedCustomer.name}</span>
                  <Localized id="payment-customer-change">
                    <button
                      type="button"
                      className="payment-customer-change"
                      onClick={() => setShowCustomerSearch(true)}
                    >
                      <span>Change</span>
                    </button>
                  </Localized>
                  <button
                    type="button"
                    className="payment-customer-remove"
                    onClick={() => notifyCustomerChange(null)}
                    aria-label={l10n.getString('payment-customer-remove-aria', null, 'Remove customer')}
                  >
                    &times;
                  </button>
                </div>
              ) : (
                <Localized id="payment-customer-select">
                  <button
                    type="button"
                    className="payment-customer-select-btn"
                    onClick={() => setShowCustomerSearch(true)}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
                      <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 1114 0H3z" />
                    </svg>
                    <span>Select Customer</span>
                  </button>
                </Localized>
              )}
            </div>

            {isEnabled(FEATURES.LOYALTY_PROGRAM) && loyaltyAccount && (
              <div className="payment-loyalty-section">
                <div className="payment-loyalty-balance">
                  <span className="payment-loyalty-label">
                    {requiredLocalized(l10n, 'payment-loyalty-points-label')}: {loyaltyAccount.account.points}
                  </span>
                  <span className="payment-loyalty-value">
                    {pointsWorthMinor !== null
                      ? `(${formatMoney({ minor_units: pointsWorthMinor, currency: total.currency } as Money)})`
                      : '…'}
                  </span>
                </div>
                {loyaltyAccount.account.points > 0 && !redeemPoints && (
                  <Localized id="payment-loyalty-use-points">
                    <button
                      type="button"
                      className="payment-loyalty-redeem-btn"
                      onClick={() => {
                        setRedeemPoints(true);
                        setPointsToRedeem(loyaltyAccount.account.points);
                      }}
                    >
                      <span>Use Points</span>
                    </button>
                  </Localized>
                )}
                {redeemPoints && (
                  <div className="payment-loyalty-active">
                    <div className="payment-loyalty-input-row">
                      <Localized id="payment-loyalty-points-label"><span className="payment-loyalty-input-label">Points</span></Localized>
                      <input
                        type="number"
                        className="payment-loyalty-input"
                        value={pointsToRedeem}
                        onChange={(e) => {
                          // Whole number only — ignore fractional in-progress input
                          // instead of silently truncating it via parseInt.
                          const v = Number(e.target.value);
                          if (e.target.value === '' || (Number.isInteger(v) && v >= 0)) {
                            setPointsToRedeem(e.target.value === '' ? 0 : v);
                          }
                        }}
                        min={0}
                        max={loyaltyAccount.account.points}
                        aria-label={l10n.getString('payment-loyalty-points-aria')}
                      />
                      <span className="payment-loyalty-input-hint">
                        / {loyaltyAccount.account.points}
                      </span>
                    </div>
                    <span className="payment-loyalty-discount-label">
                      <Localized id="payment-loyalty-discount-label" vars={{ amount: formatMoney({
                        minor_units: Number(loyaltyDiscount),
                        currency: total.currency,
                      } as Money) }}>
                        <span>{'Discount: -{ $amount }'}</span>
                      </Localized>
                    </span>
                    <Localized id="payment-cancel">
                      <button
                        type="button"
                        className="payment-loyalty-cancel-btn"
                        onClick={() => {
                          setRedeemPoints(false);
                          setPointsToRedeem(0);
                          setLoyaltyDiscount(0n);
                        }}
                      >
                        <span>Cancel</span>
                      </button>
                    </Localized>
                  </div>
                )}
              </div>
            )}

            {paymentError && (
              <div className="payment-error-banner" role="alert">
                <svg className="payment-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span className="payment-error-text">{paymentError.message}</span>
                {paymentError.retryable && (
                  <Localized id="payment-retry-aria" attrs={{ 'aria-label': true }}>
                  <button
                    type="button"
                    className="payment-error-retry-btn"
                    onClick={() => {
                      setPaymentError(null);
                      complete();
                    }}
                  >
                    <Localized id="payment-retry">
                      <span>Retry</span>
                    </Localized>
                  </button>
                  </Localized>
                )}
              </div>
            )}

            {showCustomerSearch && (
              <>
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
              <div
                className="payment-customer-search-overlay"
                role="dialog"
                onClick={(e) => { if (e.target === e.currentTarget) setShowCustomerSearch(false); }}
                onKeyDown={(e) => { if (e.key === 'Escape') setShowCustomerSearch(false); }}
                tabIndex={-1}
              >
                <div
                  ref={customerSearchPanelRef}
                  className="payment-customer-search-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label={l10n.getString('payment-customer-search-heading', null, 'Select Customer')}
                >
                  <Localized id="payment-customer-search-heading">
                    <h3 className="payment-customer-search-heading">Select Customer</h3>
                  </Localized>
                  <input
                    className="payment-customer-search-input"
                    type="text"
                    aria-label={l10n.getString('payment-search-customers-aria')}
                    placeholder={l10n.getString('payment-search-customers-placeholder')}
                    value={customerSearchQuery}
                    onChange={(e) => setCustomerSearchQuery(e.target.value)}
                  />
                  <div className="payment-customer-search-list">
                    {loadingCustomers ? (
                      <div className="payment-customer-search-list-skeleton" aria-hidden="true">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} className="payment-customer-search-item">
                            <Skeleton width="8rem" height="1rem" />
                            <Skeleton width="5rem" height="0.75rem" style={{ marginTop: '2px' }} />
                          </div>
                        ))}
                      </div>
                    ) : customerSearchResults.length === 0 ? (
                      <Localized id="payment-customer-search-empty">
                        <div className="payment-customer-search-empty">No customers found</div>
                      </Localized>
                    ) : (
                      customerSearchResults.map((c) => (
                        <button
                          key={c.id}
                          className="payment-customer-search-item"
                          onClick={() => {
                            notifyCustomerChange(c);
                            setShowCustomerSearch(false);
                            setCustomerSearchQuery('');
                          }}
                        >
                          <span className="payment-customer-search-item-name">{c.name}</span>
                          {(c.phone || c.email) && (
                            <span className="payment-customer-search-item-detail">
                              {c.phone || c.email}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                  <Localized id="payment-cancel">
                    <button
                      className="payment-customer-search-close"
                      onClick={() => setShowCustomerSearch(false)}
                    >
                      <span>Cancel</span>
                    </button>
                  </Localized>
                </div>
              </div>
            </>)}

            <div className="payment-actions">
              <Localized id="payment-cancel">
                <Button variant="ghost" onClick={() => animateLeave(onClose)} disabled={processing}>
                  Cancel
                </Button>
              </Localized>
              <Button
                variant="primary"
                loading={processing}
                disabled={!canComplete}
                onClick={complete}
                data-testid="settle-button"
              >
                {method === 'open_bill' ? (
                  <Localized id="payment-open-bill">
                    <span>Open Bill</span>
                  </Localized>
                ) : method === 'credit' ? (
                  <Localized id="payment-credit-sale"><span>Credit Sale</span></Localized>
                ) : (
                  <Localized id="payment-complete">
                    <span>Complete Sale</span>
                  </Localized>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
      )}
    </div>
      </Localized>
  );
}
