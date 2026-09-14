import { useState, useMemo, useCallback, useEffect, useRef, useContext } from 'react';
import { useToast } from '@/frontend/shared/Toast';
import { LocaleContext } from '@/i18n/LocaleContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { requiredLocalized } from '@/frontend/shared';
import { Localized, useLocalization } from '@fluent/react';
import { Skeleton } from '@/components/Skeleton';
import { startSaleScoped, addLineScoped, completeSaleScoped, printSalesReceipt, getSale, getSaleScoped, setCartDiscountScoped, holdCartScoped, finalizeSale, voidPendingSale, previewPromotedTotalFromLinesScoped, type SetCartDiscountScopedArgs, type CompleteSaleScopedArgs, type PaymentSplitArg, type SerialNumberArg, type PartialStockResult, type PreviewPromotedTotalResult } from '@/api/sales';
import { createKdsOrderFromSaleScoped } from '@/api/kds';
import { Button } from '@/components/Button';
import { formatMoney, minorUnitExponent, parseMinorUnits, type Money } from '@/types/domain';
import { useFeatures, FEATURES } from '@/hooks/useFeatures';
// W5-a: only the reciprocal helper is still read here (tenderSnapshot); the
// currency/rate loaders and the fixed-point converter moved to useMultiCurrency.
import { reciprocalMillionths } from '@/api/currency';
import { listCustomersScoped, type CustomerDto } from '@/api/customers';
import { getLoyaltyAccount, redeemLoyaltyPoints, getPointsValue, type LoyaltyAccountWithDetails } from '@/api/loyalty';
import QrisQrDisplay from '@/components/QrisQrDisplay';
import { edcSale, edcTerminalStatusScoped } from '@/api/edc';
import { railOffered, staticQrisPayload, useLocalPaymentRails, visibleMethods } from './useLocalPaymentRails';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useSwipe } from '@/hooks/useSwipe';
import { useKeyboardAvoidance } from '@/hooks/useKeyboardAvoidance';
import { animDuration } from '@/utils/animation';
import StockShortfallDialog from '@/features/sales/StockShortfallDialog';
import ReceiptPreview from '@/features/sales/ReceiptPreview';
import type { PrintSalesReceiptArgs } from '@/api/sales';
import { useAutoQr } from './payment/useAutoQr';
import { useGatewayQr } from './payment/useGatewayQr';
import { useMultiCurrency } from './payment/useMultiCurrency';
import { useTenderMath } from './payment/useTenderMath';
import { useSplitTenderState } from './payment/useSplitTenderState';
import QrisTenderPanel from './payment/QrisTenderPanel';
import CashTenderPanel from './payment/CashTenderPanel';
import CardTenderPanel from './payment/CardTenderPanel';
import SplitTenderRows from './payment/SplitTenderRows';
import LoyaltyTenderPanel from './payment/LoyaltyTenderPanel';
import PaymentModalCustomerBadge from './components/PaymentModalCustomerBadge';
import { distributeEvenly } from './payment/splitDistribution';
import { buildCompletedSaleReceipt } from './payment/completedSale';
import type { PaymentModalProps } from './payment/types';
import { classifyRetry, plainErrorMessage } from '@/utils/app-error';
import './PaymentModal.css';

type PaymentMethod = 'cash' | 'card' | 'qris' | 'other' | 'open_bill' | 'credit';

/**
 * The Fluent message that carries each tender's visible name. TOTAL over
 * `PaymentMethod` on purpose: this lookup was a nested ternary in the method
 * strip whose ELSE-BRANCH was `payment-method-credit`, so a 5th `TENDER_RAILS`
 * row (say `ewallet`) compiled clean, left every `input[name=payment-method]`
 * value assertion green, and put a tab LABELED Credit in front of the cashier
 * that tendered an e-wallet (Correctness review of 994c0e364, then
 * PaymentModal.tsx:1516 -- the one place the derivation was not self-checking).
 * A Record keyed by the union cannot stay silent about a new member: widen the
 * union, or widen `TenderMethod`/`TENDER_RAILS` under it, and `tsc` fails at
 * THIS declaration instead of at the register.
 *
 * Every entry names the key that renders TODAY -- none is new, none renamed.
 * `other` and `open_bill` are mapped because they are `PaymentMethod`s too, not
 * because they are strip tabs: `other` shows its name through the
 * `payment-other-placeholder` attributes and `open_bill` is fixed markup after
 * the strip. Do not fold either into `visibleMethods()`, and do not add a
 * member to the union without adding its id here.
 */
const PAYMENT_METHOD_MESSAGE_IDS: Record<PaymentMethod, string> = {
  cash: 'payment-method-cash',
  card: 'payment-method-card',
  qris: 'payment-method-qris',
  other: 'payment-other-placeholder',
  open_bill: 'payment-open-bill',
  credit: 'payment-method-credit',
};

// PaymentModalProps moved to ./payment/types (slice S1 of the contract-first
// extraction campaign: one shared module for the frozen top-level contract plus the
// narrowed sub-component types the later slices add). Re-exported here so a future
// `import type { PaymentModalProps } from '.../PaymentModal'` still resolves.
export type { PaymentModalProps };

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
  // agents-5 R1: the regional slice-6 rail store is the real per-site
  // surface for "does this location offer QRIS" (the master doc's
  // payment:* keys were never implemented). Fail-open until loaded.
  const { rails: paymentRails } = useLocalPaymentRails(sessionToken);
  // visibleMethods() owns which tabs the tender list offers; the two reads
  // below are the gates that live OUTSIDE that list -- qrisOffered also kicks
  // the selection back to cash when a reload withholds QRIS, and edcOffered
  // gates only the pay-on-terminal button inside the card panel.
  const qrisOffered = railOffered(paymentRails, 'qris');
  const edcOffered = railOffered(paymentRails, 'edc');
  // Manual QRIS shows the merchant's real static QR when the rail
  // carries one (agents-5 R2); the dialog itself says so when not.
  const manualQrString = staticQrisPayload(paymentRails);
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
  // The roster exactly as the last list read returned it. The rows the overlay
  // renders are DERIVED from this plus customerSearchQuery (see the memo below):
  // there is deliberately no second stored list, because a stored list is a value
  // a filter can be skipped over without anything noticing. S5 pins that pair.
  const [customerRoster, setCustomerRoster] = useState<CustomerDto[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
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

  /**
   * Adapt an IPC rejection to the banner's {message, retryable} shape.
   *
   * This used to be a private ~20-line English substring scan ('timeout',
   * 'declined', 'already'…) maintained beside — and below the quality of
   * — the shared boundary classifier in utils/app-error (ERR-06), which
   * reads the typed `AppError.kind`/`subKind` every command actually
   * rejects with and keyword-sniffs only genuinely untyped values. A
   * gateway that localizes its messages or words them without the
   * hardcoded substrings classified wrong HERE but right THERE; two
   * answers to one question means one of them is dead weight. The retry
   * decision now delegates; only the message keeps this screen's own
   * fallback (raw text for unrecognized shapes, safe copy otherwise —
   * plainErrorMessage, ERR-05, unchanged).
   */
  const classifyError = useCallback((err: unknown): { message: string; retryable: boolean } => {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      message: plainErrorMessage(err, errMsg),
      retryable: classifyRetry(err) === 'retryable',
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

  // W5-c: the split-mode flag, the rows, the id counter behind + Add Split and
  // the three row callbacks moved verbatim to ./payment/useSplitTenderState -
  // zero parameters, and the same hook order (two useState then one useRef in
  // the same slots). The open-reset below still re-seeds the rows through
  // setSplits; autoSplitEvenly stayed HERE because its inputs
  // (effectiveTotalInCartCurrency, cartCurrency) are returned by the two hooks
  // called below, one of which consumes these very rows as an input.
  const {
    splitMode,
    setSplitMode,
    splits,
    setSplits,
    addSplit,
    removeSplit,
    updateSplit,
  } = useSplitTenderState();

  const { isEnabled } = useFeatures();
  const multiCurrency = isEnabled(FEATURES.MULTI_CURRENCY);
  // One read of the entitlement, shared by the FETCH and the render below: an
  // unlicensed tenant must not spend a getLoyaltyAccount round-trip on a panel it
  // can never show. A named boolean rather than the call inline in the effect, so
  // the dep array holds a value (isEnabled's identity in this file is not
  // something an effect should depend on).
  const loyaltyLicensed = isEnabled(FEATURES.LOYALTY_PROGRAM);


  // A rail that loads (or reloads) to disabled while QRIS is the chosen
  // tab must not strand the cashier on a hidden surface (agents-5 R1).
  useEffect(() => {
    if (!qrisOffered && method === 'qris') setMethod('cash');
  }, [qrisOffered, method]);

  // ── Multi-currency (FEATURES.MULTI_CURRENCY) ───────────────────────
  // Charge-currency state, the rate reads, the converter and cartCurrency
  // moved verbatim to ./payment/useMultiCurrency (slice W5-a). It receives
  // six values and writes none of the shell atoms; the totals that convert
  // through it stay here because their other inputs (loyalty, promo preview,
  // the displayed cart, the tendered string) are not currency data.
  // cartCurrency / convertToChargeCurrency were declared far below, at :508
  // and :529 — nothing above this call read them, so their first read is
  // still the promoted/unpromoted total memos further down.
  const {
    currencies,
    selectedCurrency,
    setSelectedCurrency,
    baseCurrency,
    cartCurrency,
    effectiveRateInfo,
    convertToChargeCurrency,
  } = useMultiCurrency({
    open,
    multiCurrency,
    sessionToken,
    totalCurrency: total.currency,
    addToast,
    l10nRef,
  });

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
      setCustomerRoster([]); // the derived rows are empty with it — no second list to clear
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
    // setShowQr / setQrReference / setSelectedCurrency stay off this list: the
    // array is evaluated during render and the hook calls that create them are
    // BELOW this effect, so listing them is a use-before-declaration error — and
    // a no-op anyway, since a useState dispatcher never changes identity. The
    // reset still fires only on open / charge-currency / controlled-customer
    // changes (W3-c + W5-a).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, total.currency, selectedCustomerProp]);

  useEffect(() => {
    if (!showCustomerSearch) return;
    if (!sessionToken) {
      // Customer data is store-scoped. Never fall back to the legacy global
      // command when this modal is rendered outside an authenticated scope.
      setCustomerRoster([]);
      setLoadingCustomers(false);
      return;
    }
    setLoadingCustomers(true);
    listCustomersScoped(sessionToken)
      // Writes the ROSTER only. The list the overlay shows is derived from it
      // below, so this can no longer publish an unfiltered result over a filter
      // that is still in the input.
      .then((customers) => {
        setCustomerRoster(customers);
      })
      .catch(() => { addToast({ message: requiredLocalized(l10nRef.current, 'payment-toast-customers-failed'), type: 'error' }); setCustomerRoster([]); })
      .finally(() => setLoadingCustomers(false));
  }, [showCustomerSearch, sessionToken, addToast]); // l10n via ref — stable dep chain

  // The rows the overlay renders are a DERIVED value, not a second stored list.
  // The predicate below is the old filter effect's, unchanged, now over the roster
  // state and the query as its two real inputs. As an effect writing
  // customerSearchResults it could not be trusted to re-run: on a close and
  // re-open the fetch resolves the roster again while neither of the effect's two
  // deps (showCustomerSearch, customerSearchQuery) has changed, so the input kept
  // the surviving filter and the list showed everybody. Deriving makes that pair
  // unrepresentable — rows are always f(roster, query).
  const customerSearchResults = useMemo(() => {
    const customers = customerRoster;
    const q = customerSearchQuery.trim().toLowerCase();
    if (!q) {
      return customers;
    }
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)),
    );
  }, [customerRoster, customerSearchQuery]);

  // W5-b: the ten-memo tender/split derivation cluster moved verbatim to
  // ./payment/useTenderMath - nine plain-data inputs, no dep array changed.
  // tenderSnapshot and canComplete stayed here on purpose (3 and 4 exclusive inputs).
  const {
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
  } = useTenderMath({
    total,
    lineItems,
    promoPreview,
    loyaltyDiscount,
    cartCurrency,
    convertToChargeCurrency,
    tendered,
    method,
    splits,
  });

  useEffect(() => {
    // Entitlement first, and the same three resets the no-customer branch below
    // performs: with the feature off there is no account, and a stale account
    // left in state would carry redeemPoints / loyaltyDiscount with it - a
    // discount that moves Total Due while nothing on screen can cancel it.
    if (!loyaltyLicensed) {
      setLoyaltyAccount(null);
      setRedeemPoints(false);
      setLoyaltyDiscount(0n);
      return;
    }
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
  }, [selectedCustomer, sessionToken, addToast, loyaltyLicensed]); // l10n via ref — stable dep chain

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

  // Shared gateway-tender front half (manual QRIS, Auto QRIS, EDC card):
  // cart -> discount -> lines -> complete. The caller's split metadata
  // decides the settlement story: manual QRIS passes its cashier-asserted
  // reference + 'completed', Auto completes as 'pending' FIRST so the cloud
  // charge can bind to the real sale id (the ledger's queued finalize_sale
  // then addresses a sale the device actually has), and EDC completes
  // 'captured' with the terminal's transaction fields.
  const buildGatewaySale = useCallback(
    async (split: { method: string; gatewayReference: string; gatewayStatus: string; gatewayResponse: string }) => {
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
      return completeSaleScoped(sessionToken!, {
            cartId,
            paymentMethod: split.method,
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
                method: split.method,
                amountMinor: effectiveTotalInCartCurrency,
                gatewayReference: split.gatewayReference,
                gatewayStatus: split.gatewayStatus,
                gatewayResponse: split.gatewayResponse,
              },
            ],
            // PROMO-3: the engine re-applies and re-validates server-side.
            ...(promotionIds && promotionIds.length > 0 ? { promotionIds } : {}),
            // F2-6: the client's estimate claim — absent (falsy) means
            // the tax was freshly computed and no stamp is requested.
            ...(taxEstimated ? { taxEstimated: true } : {}),
            ...tenderSnapshot,
          } as CompleteSaleScopedArgs);
    },
    [sessionToken, cartCurrency, discountPercent, discountLabel, lineItems,
     lineItemsInCartCurrency, serialNumbers, selectedCustomer, promotionIds,
     effectiveTotalInCartCurrency, tenderSnapshot, taxEstimated],
  );

  // Shared QRIS tail (manual + Auto): server read-back for the receipt,
  // KDS ticket, ADR-20 finalize, loyalty redemption, done. Throws after
  // surfacing so the caller's catch classifies once. `voidOnFinalizeFailure`
  // splits the two flows' risk: manual's payment was only asserted, so a
  // failed finalize voids the pending sale; Auto's payment is REAL at the
  // gateway by then, so the sale must stay pending — the queued
  // finalize_sale from the settlement webhook completes it on the next
  // sync apply instead.
  const settleGatewaySale = useCallback(
    async (saleResult: Awaited<ReturnType<typeof completeSaleScoped>>, voidOnFinalizeFailure: boolean) => {
      try {
        // ADR #7: read the sale back from the same store completeSaleScoped just wrote it to.
        // The value feeds the receipt preview, so an ambient read here showed a customer a
        // total fetched from a different store than the one they had just paid into.
        const completedSale = sessionToken
          ? await getSaleScoped(sessionToken, saleResult.saleId)
          : await getSale(saleResult.saleId);

        setReceiptArgs(buildCompletedSaleReceipt({
          saleId: saleResult.saleId,
          saleTotal: saleResult.total,
          completedSale,
          cartLines: lineItemsInCartCurrency,
          cartCurrency,
          fallbackTotalMinor: effectiveTotalInCartCurrency,
          // The one field this site and the direct-checkout site below really
          // do differ: a gateway sale is a single QRIS tender with no change.
          payments: [
            {
              method: 'QRIS',
              amount: { minorUnits: effectiveTotalInCartCurrency, currency: cartCurrency },
              change: null,
            },
          ],
          tableNumber,
        }));
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
          if (voidOnFinalizeFailure) {
            try {
              await voidPendingSale(sessionToken, saleResult.saleId);
            } catch (voidErr) {
              addToast({ message: `Void also failed: ${voidErr instanceof Error ? voidErr.message : String(voidErr)}`, type: 'error' });
            }
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
    },
    [sessionToken, lineItemsInCartCurrency, cartCurrency, tableNumber, addToast,
     loyaltyAccount, redeemPoints, loyaltyDiscount, selectedCustomer, effectiveTotalInCartCurrency],
  );

  // ── Manual QRIS (gateway tender, cashier-asserted reference) ─────────
  // State + both ends of the dialog moved verbatim to ./payment/useGatewayQr
  // (slice W3-c), called from where handleQrConfirmed was — BELOW the shared
  // gateway front/tail halves it receives, since those stay defined once here
  // for all three gateway tenders (see ./payment/useGatewayQr for why).
  // showQr/qrReference moved down with the handlers; their dispatchers come
  // back up so the open-reset effect and the dialog's onClose keep their text.
  const {
    showQr,
    qrReference,
    handleQrPay,
    handleQrConfirmed,
    setShowQr,
    setQrReference,
  } = useGatewayQr({
    buildGatewaySale,
    settleGatewaySale,
    classifyError,
    setProcessing,
    setPaymentError,
    addToast,
  });

  // ── QRIS Auto (dynamic Midtrans charge, agents-3) ────────────────
  // State + handlers moved verbatim to ./payment/useAutoQr (slice W3-a). The
  // shell keeps the shared atoms this phase reads — processing, paymentError,
  // the attempt id, the localized bundle ref, the gateway front/tail halves
  // and the charge total — and passes them down, so this slice stays
  // independently revertible. The JSX below and the tender-button
  // `autoQr !== null` guards are untouched.
  const {
    autoQr,
    handleDynamicQrPay,
    handleAutoReissue,
    handleAutoCancel,
    handleAutoConfirmed,
    handleAutoPoll,
  } = useAutoQr({
    sessionToken,
    effectiveTotalInCartCurrency,
    attemptIdRef,
    l10nRef,
    buildGatewaySale,
    settleGatewaySale,
    classifyError,
    setProcessing,
    setPaymentError,
    addToast,
  });

  // ── EDC card-present (agents-3 3.2) ────────────────────────────────
  // Capture-first, the mirror of QRIS-Auto's pending-first: the terminal
  // needs no sale_id, so money is authorized+captured BEFORE any sale is
  // built and every failed branch behind the capture leaves no orphaned
  // pending sale to void. The inverse risk (captured, then the app dies
  // before complete_sale) is the accepted one — it reconciles through the
  // terminal's own journal, and the pre-flight + decline paths never touch
  // the ledger at all. Preflight is `edc_terminal_status_scoped`: the
  // never-shipped `test_edc_connection_scoped` (agents-2 residual) is
  // decided INTO this call — same session enforcement, same answer. On the
  // tablet (no edc commands registered) the pre-flight simply rejects and
  // the flow falls back to manual card — desktop-only expressed as
  // degradation, not platform-sniffing.
  const [edc, setEdc] = useState<{
    phase: 'preflight' | 'waiting' | 'declined';
    reason?: string | undefined;
  } | null>(null);

  const handleTerminalPay = useCallback(async () => {
    setProcessing(true);
    try {
      setEdc({ phase: 'preflight' });
      const status = await edcTerminalStatusScoped(sessionToken!);
      if (status.status !== 'ready') {
        setEdc(null);
        addToast({
          message: requiredLocalized(l10nRef.current, 'payment-edc-not-ready', {
            status: status.status,
          }),
          type: 'error',
        });
        return;
      }
      // The card-present wait is the terminal's, not ours: no client-side
      // cancel (a tap can land any moment — cancelling the promise would
      // abandon captured money), no invented progress. The overlay says
      // tap/insert/swipe and waits.
      setEdc({ phase: 'waiting' });
      const result = await edcSale(
        sessionToken!,
        Number(effectiveTotalInCartCurrency),
        cartCurrency,
      );
      if (!result.success) {
        setEdc({ phase: 'declined', reason: result.message });
        return;
      }
      const saleResult = await buildGatewaySale({
        method: 'CARD',
        gatewayReference: result.transactionId ?? '',
        gatewayStatus: 'captured',
        gatewayResponse: JSON.stringify({
          auth_code: result.authCode,
          card_scheme: result.cardScheme,
          card_last4: result.cardLast4,
          message: result.message,
        }),
      });
      // voidOnFinalizeFailure = false: the terminal holds captured money;
      // a local finalize fault keeps the sale pending for reconciliation,
      // it must not void a PAID sale.
      await settleGatewaySale(saleResult, false);
      setEdc(null);
    } catch (err) {
      // Back to tender selection with the reason (the capture, if any, is
      // the terminal's record; nothing local was created yet at this
      // point except a possibly-built sale — settleGatewaySale throws only
      // after its own surfacing, and its pending-on-failure branch applies).
      setEdc(null);
      addToast({
        message: requiredLocalized(l10nRef.current, 'payment-edc-failed', {
          reason: plainErrorMessage(err),
        }),
        type: 'error',
      });
    } finally {
      setProcessing(false);
    }
  }, [sessionToken, effectiveTotalInCartCurrency, cartCurrency, buildGatewaySale, settleGatewaySale, addToast]);

  const handleTerminalDismiss = useCallback(() => setEdc(null), []);

  const autoSplitEvenly = useCallback(() => {
    // W5-d: the arithmetic itself moved verbatim to ./payment/splitDistribution -
    // same Math.floor base, same exact remainder on the LAST row only, same
    // exponent-explicit digit placement, and the same count === 0 outcome (no row
    // is written). What is left here is the two reads the boundary forces into the
    // shell (the total the money hook returns, the currency the multi-currency
    // hook returns, the row count the split hook owns) and the write.
    const literals = distributeEvenly(
      effectiveTotalInCartCurrency,
      splits.length,
      minorUnitExponent(cartCurrency),
    );
    // PATCH, never rebuild: method and otherLabel survive the rewrite, so an
    // `other` row labelled "voucher" keeps both after Split Evenly.
    setSplits((prev) =>
      prev.map((s, i) => ({ ...s, amountMinor: literals[i] ?? s.amountMinor })),
    );
  // setSplits is now an import from ./payment/useSplitTenderState rather than a
  // useState dispatcher declared in this file, so the rule can no longer prove it
  // stable and asks for it. It is stable - it IS the dispatcher, returned through
  // the hook - so listing it cannot re-fire this callback on any render; the value
  // and the identity of the array are unchanged in behaviour.
  }, [splits.length, effectiveTotalInCartCurrency, cartCurrency, setSplits]);

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

        const receiptData = buildCompletedSaleReceipt({
          saleId: saleResult.saleId,
          saleTotal: saleResult.total,
          completedSale,
          cartLines: lineItemsInCartCurrency,
          cartCurrency,
          fallbackTotalMinor: effectiveTotalInCartCurrency,
          // Differs from the gateway site on purpose: split mode prints one row
          // per tender, and a single cash tender prints with its real change.
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
          tableNumber,
        });
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
        {...(manualQrString ? { qrString: manualQrString } : {})}
      />

      {autoQr && (
        <QrisQrDisplay
          amount={total.minor_units}
          currency={total.currency}
          reference={autoQr.orderId}
          isOpen={true}
          onClose={handleAutoCancel}
          onPaymentConfirmed={handleAutoConfirmed}
          qrString={autoQr.qrString}
          pollSettled={handleAutoPoll}
          expiresInSeconds={autoQr.expiresIn}
          onReissue={handleAutoReissue}
        />
      )}

      {edc && (
        <div
          className="payment-edc-overlay"
          role={edc.phase === 'declined' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <div className="payment-edc-panel">
            {edc.phase === 'declined' ? (
              <>
                <p className="payment-edc-declined-title">
                  <Localized id="payment-edc-declined">
                    <span>Card declined</span>
                  </Localized>
                </p>
                {/* The reason is the terminal's own message — operator data,
                    shown verbatim, not UI copy. */}
                {edc.reason && <p className="payment-edc-declined-reason">{edc.reason}</p>}
                <button
                  type="button"
                  className="payment-edc-btn payment-edc-btn--dismiss"
                  aria-label={l10n.getString('payment-edc-dismiss')}
                  onClick={handleTerminalDismiss}
                >
                  <Localized id="payment-edc-dismiss">
                    <span>Back to payment</span>
                  </Localized>
                </button>
              </>
            ) : (
              <>
                <span className="payment-edc-spinner" aria-hidden="true" />
                <p className="payment-edc-waiting-text">
                  {edc.phase === 'preflight' ? (
                    <Localized id="payment-edc-preflight">
                      <span>Checking card terminal…</span>
                    </Localized>
                  ) : (
                    <Localized id="payment-edc-waiting">
                      <span>Please tap, insert or swipe the card…</span>
                    </Localized>
                  )}
                </p>
              </>
            )}
          </div>
        </div>
      )}

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
                    {visibleMethods(paymentRails).map((m) => (
                      <label key={m} className="payment-method-label" data-testid="quick-pay-button">
                        <input
                          type="radio"
                          name="payment-method"
                          value={m}
                          checked={method === m}
                          onChange={() => setMethod(m)}
                        />
                        <span className="payment-method-name">
                          {requiredLocalized(l10n, PAYMENT_METHOD_MESSAGE_IDS[m])}
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
                      {/* .payment-method-name on the text input below is not decoration:
                          the checked-tender rule (PaymentModal.css:184) is an ADJACENT-SIBLING
                          selector, so that input - the radio's next sibling, and the element
                          the cashier actually reads for this row - is the only one the rule
                          can treat. Without the class, Other was the one selected tender
                          whose name kept neither the accent nor the semibold. */}
                        <Localized id="payment-other-placeholder" attrs={{ 'aria-label': true, placeholder: true }}>
                        <input
                          type="text"
                          className="payment-other-input payment-method-name"
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
                  <CashTenderPanel
                    tendered={tendered}
                    onTenderedChange={setTendered}
                    total={total}
                    tenderPresets={tenderPresets}
                    sufficient={sufficient}
                    change={change}
                    locale={locale}
                  />
                )}

                {method === 'card' && !splitMode && (
                  <CardTenderPanel
                    terminalOffered={edcOffered}
                    processing={processing}
                    terminalPending={edc !== null}
                    autoQrPending={autoQr !== null}
                    onTerminalPay={handleTerminalPay}
                  />
                )}

                {method === 'qris' && (
                  <QrisTenderPanel
                    qrisAllowed={!caps || caps.supportsQris}
                    locale={locale}
                    processing={processing}
                    autoQrPending={autoQr !== null}
                    onQrPay={handleQrPay}
                    onDynamicQrPay={handleDynamicQrPay}
                  />
                )}
              </>
            )}

            <SplitTenderRows
              splitMode={splitMode}
              splits={splits}
              currency={total.currency}
              remainingMinor={splitTotals.remaining}
              onSplitModeChange={setSplitMode}
              onAddSplit={addSplit}
              onRemoveSplit={removeSplit}
              onUpdateSplit={updateSplit}
              onAutoSplitEvenly={autoSplitEvenly}
            />

            <PaymentModalCustomerBadge
              customer={selectedCustomer}
              onOpenSearch={() => setShowCustomerSearch(true)}
              onRemove={() => notifyCustomerChange(null)}
            />

            {loyaltyLicensed && loyaltyAccount && (
              <LoyaltyTenderPanel
                loyaltyOffered={loyaltyLicensed && !!loyaltyAccount}
                points={loyaltyAccount.account.points}
                pointsWorthMinor={pointsWorthMinor}
                currency={total.currency}
                redeemPoints={redeemPoints}
                pointsToRedeem={pointsToRedeem}
                loyaltyDiscount={loyaltyDiscount}
                onRedeemStart={() => {
                  setRedeemPoints(true);
                  setPointsToRedeem(loyaltyAccount.account.points);
                }}
                onPointsChange={setPointsToRedeem}
                onRedeemCancel={() => {
                  setRedeemPoints(false);
                  setPointsToRedeem(0);
                  setLoyaltyDiscount(0n);
                }}
              />
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
