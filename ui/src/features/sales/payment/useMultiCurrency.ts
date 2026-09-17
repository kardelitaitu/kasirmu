/**
 * Multi-currency checkout — the charge-currency slice of the payment modal.
 *
 * Slice W5-a of the PaymentModal extraction campaign: the supported-currency /
 * rate reads, the charge-currency choice, and everything derived from THAT
 * alone, moved verbatim out of PaymentModal.tsx — same names, same logic, same
 * body order, same memo dependencies. The two mechanical deltas, labelled:
 *  - total.currency arrives as a parameter named totalCurrency (the sale's own
 *    base currency). baseCurrency could not be reused as the name: this cluster
 *    already owns a state called baseCurrency — the store default from
 *    getDefaultCurrencyScoped — and the two are different things. Every dep
 *    array below is unchanged in VALUE; only that identifier reads differently
 *    inside the list.
 *  - nothing else. No setter of processing / paymentError / done / leaving /
 *    receiptArgs is touched here, so none is received: this hook writes only
 *    its own state. That is what keeps the seam six values wide.
 *
 * What stayed in the shell, on purpose:
 * - unpromotedTotalInCartCurrency / promotedChargeTotal /
 *   effectiveTotalInCartCurrency / lineItemsInCartCurrency /
 *   tenderedMinorInCartCurrency / tenderSnapshot. They convert THROUGH
 *   convertToChargeCurrency, but their inputs are loyalty state, the promo
 *   preview, the displayed cart and the tendered string — not currency data —
 *   so pulling them in would widen this hook to a dozen shell values for zero
 *   cohesion. They receive cartCurrency / effectiveRateInfo /
 *   convertToChargeCurrency from here instead.
 * - the currency picker JSX, untouched, as in every slice of this campaign.
 * - MONEY: nothing is recomputed here and no float is re-introduced. The
 *   10 ** exp sites stayed deleted — the conversion still goes through
 *   convertMinorUnits (fixed-point, exponent-explicit) and the shell keeps its
 *   parseMinorUnits sites. rate remains a float DISPLAY field only (MONEY-01)
 *   and rate_millionths remains the scale-6 fixed-point integer that gets
 *   persisted; both moved verbatim, neither was touched.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { minorUnitExponent } from '@/types/domain';
import type { useToast } from '@/components/Toast';
import {
  listCurrenciesScoped,
  listLatestExchangeRatesScoped,
  getDefaultCurrencyScoped,
  getLatestExchangeRateScoped,
  exchangeRateToDecimal,
  convertMinorUnits,
  type CurrencyDto,
  type ExchangeRateDto,
} from '@/api/currency';

/** Exact addToast signature, taken from the Toast provider's own hook. */
type AddToast = ReturnType<typeof useToast>['addToast'];
/** Structural twin of the caller's useRef(l10n) result — only getString is used. */
type L10nRef = { current: { getString: (id: string) => string } };

export interface UseMultiCurrencyParams {
  /** Modal visibility: the loads and the rate lookup run on an open only. */
  open: boolean;
  /** FEATURES.MULTI_CURRENCY — the whole surface is inert when disabled. */
  multiCurrency: boolean;
  /** ADR #7 session token; no token means no scoped load and no rate query. */
  sessionToken: string | undefined;
  /** The sale's own currency (total.currency in the shell). */
  totalCurrency: string;
  addToast: AddToast;
  l10nRef: L10nRef;
}

/**
 * The charge-currency choice, the rate that backs it, and the two things every
 * caller needs: cartCurrency (which currency the cart is denominated in) and
 * convertToChargeCurrency (how to move an amount into it).
 */
export function useMultiCurrency({
  open,
  multiCurrency,
  sessionToken,
  totalCurrency,
  addToast,
  l10nRef,
}: UseMultiCurrencyParams) {
  const [currencies, setCurrencies] = useState<CurrencyDto[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateDto[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState(totalCurrency);
  const [baseCurrency, setBaseCurrency] = useState(totalCurrency);

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
    // l10n via ref — stable dep chain. l10nRef is listed only because it is a
    // parameter here rather than a local useRef in the shell; a useRef object's
    // identity never changes, so this effect re-runs on exactly the same
    // triggers as before (React-stability argument, not measured).
  }, [open, multiCurrency, sessionToken, addToast, l10nRef]);

  const exchangeRateInfo = useMemo(() => {
    if (selectedCurrency === totalCurrency) return null;
    const rate = exchangeRates.find(
      (r) => r.from_currency === totalCurrency && r.to_currency === selectedCurrency,
    );
    if (rate) {
      return { ...rate, rate: exchangeRateToDecimal(rate), inverted: false };
    }
    const inverse = exchangeRates.find(
      (r) => r.from_currency === selectedCurrency && r.to_currency === totalCurrency,
    );
    if (inverse) {
      return {
        ...inverse,
        rate: 1 / exchangeRateToDecimal(inverse),
        from_currency: totalCurrency,
        to_currency: selectedCurrency,
        // MONEY-01: the conversion must know the stored rate is the
        // reciprocal — rate here is float display math only.
        inverted: true,
      };
    }
    return null;
  }, [selectedCurrency, totalCurrency, exchangeRates]);

  // CUR-04: when a session store is active, ask the backend for the latest
  // rate effective today (or before) instead of relying on find() over the
  // full history list — the list is not ordered by effective date, so a
  // stale rate could be chosen. Falls back to the in-memory list only when
  // there is no session (single-store legacy path).
  const [latestRate, setLatestRate] = useState<ExchangeRateDto | null>(null);
  useEffect(() => {
    setLatestRate(null);
    if (!open || !multiCurrency || !sessionToken || selectedCurrency === totalCurrency) {
      return;
    }
    getLatestExchangeRateScoped(sessionToken, {
      fromCurrency: totalCurrency,
      toCurrency: selectedCurrency,
    })
      .then((r) => setLatestRate(r))
      .catch(() => setLatestRate(null));
  }, [open, multiCurrency, sessionToken, selectedCurrency, totalCurrency]);

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

  // Convert base currency amount to selected charge currency using exchange rate
  const convertToChargeCurrency = useCallback(
    (minorUnits: number | bigint): number => {
      if (selectedCurrency === totalCurrency || !effectiveRateInfo) {
        return typeof minorUnits === 'bigint' ? Number(minorUnits) : minorUnits;
      }
      // MONEY-01: exact fixed-point conversion. The old float chain
      // (divide to major, multiply by a binary-float rate, scale back)
      // mis-rounded every product landing on the .5 minor boundary
      // (0.03 USD @ 149.5 → 448 instead of 449).
      return convertMinorUnits({
        baseMinor: typeof minorUnits === 'bigint' ? Number(minorUnits) : minorUnits,
        baseExponent: minorUnitExponent(totalCurrency),
        rateMillionths: effectiveRateInfo.rate_millionths,
        chargeExponent: minorUnitExponent(selectedCurrency),
        inverse: effectiveRateInfo.inverted,
      });
    },
    [selectedCurrency, totalCurrency, effectiveRateInfo],
  );

  // Get the currency to use for the cart (charge currency if multi-currency, else base)
  const cartCurrency = multiCurrency && selectedCurrency !== totalCurrency ? selectedCurrency : totalCurrency;

  return {
    currencies,
    selectedCurrency,
    setSelectedCurrency,
    baseCurrency,
    cartCurrency,
    effectiveRateInfo,
    convertToChargeCurrency,
  };
}
