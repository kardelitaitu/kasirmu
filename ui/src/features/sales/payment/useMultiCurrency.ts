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
import { settleRead } from '@/utils/settle-read';
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

export interface UseMultiCurrencyParams {
  /** Modal visibility: the loads and the rate lookup run on an open only. */
  open: boolean;
  /** FEATURES.MULTI_CURRENCY — the whole surface is inert when disabled. */
  multiCurrency: boolean;
  /** ADR #7 session token; no token means no scoped load and no rate query. */
  sessionToken: string | undefined;
  /** The sale's own currency (total.currency in the shell). */
  totalCurrency: string;
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
}: UseMultiCurrencyParams) {
  const [currencies, setCurrencies] = useState<CurrencyDto[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateDto[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState(totalCurrency);
  const [baseCurrency, setBaseCurrency] = useState(totalCurrency);

  // `Promise.all` over the three first-load reads gave the modal ONE answer for
  // three different questions, and any single failure discarded all three. A
  // refused read is an EXPECTED outcome here, not a malfunction: the two rate
  // and default reads require permissions::SETTINGS_READ
  // (crates/kasirmu-bridge/src/currency.rs:262 and :107), while the picker read
  // `list_currencies_scoped` requires nothing at all (crates/kasirmu-bridge/src/currency.rs:72-86).
  // So a cashier who may take a payment and see the currency list is routinely
  // refused the other two. Each arm is settled on its own now.
  const [currenciesUnknown, setCurrenciesUnknown] = useState(false);
  // `baseCurrency` is the store DEFAULT, printed beside the sale as the Default
  // currency row. It falls back to the sale's own currency when the read fails,
  // which prints a plausible answer the screen never received.
  const [baseCurrencyUnknown, setBaseCurrencyUnknown] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);

  useEffect(() => {
    if (!(open && multiCurrency)) return;
    let cancelled = false;
    // Settled arm by arm. `Promise.all` would let one refusal discard the other
    // two, and the outer `.catch` recorded it in a toast that has usually
    // scrolled away before the operator looks at the picker.
    settleRead('currencies', listCurrenciesScoped(sessionToken!)).then((currenciesRead) => {
      if (cancelled) return;
      setCurrencies(currenciesRead.ok ? currenciesRead.value : []);
      setCurrenciesUnknown(!currenciesRead.ok);
    });
    // CUR-11: the picker needs the CURRENT rate per pair, not the whole
    // history -- bounded query, no first-match ambiguity.
    settleRead('exchange_rate_list', listLatestExchangeRatesScoped(sessionToken!)).then((ratesRead) => {
      if (cancelled) return;
      setExchangeRates(ratesRead.ok ? ratesRead.value : []);
    });
    settleRead('default_currency', getDefaultCurrencyScoped(sessionToken!)).then((defaultRead) => {
      if (cancelled) return;
      if (!defaultRead.ok) {
        setBaseCurrencyUnknown(true);
        return;
      }
      // A store with no configured default answers null, and the sale's own
      // currency is the honest reading of THAT. Only a failed read is unknown.
      if (defaultRead.value) setBaseCurrency(defaultRead.value);
      setBaseCurrencyUnknown(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, multiCurrency, sessionToken, loadNonce]);

  /** Re-run the three first-load reads after a failure. */
  const retryCurrencyLoad = useCallback(() => setLoadNonce((n) => n + 1), []);

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
  // stale rate could be chosen.
  //
  // `latestRate === null` used to mean BOTH "the pair has no rate" and "the
  // read failed", because a rejection collapsed to null. That is not a cosmetic
  // conflation here: `effectiveRateInfo` below falls back to a `find()` over
  // `exchangeRates`, and THAT list is not the same question. `list_latest_exchange_rates`
  // (modules/currency/src/repository.rs:84-114) returns one row per pair ordered by
  // newest `effective_date` INCLUDING FUTURE-DATED rates; the CUR-04 read above
  // (`get_latest_exchange_rate`, :157-187, as-of the store business date computed in
  // crates/kasirmu-bridge/src/currency.rs:351-360) is the only one that honours the date.
  // So a failed read silently substituted a different — possibly future-dated — rate
  // for the one the sale was going to record, and rendered identically to a success.
  //
  // Three states, not two: a rate, genuinely no rate, and unknown. `rateUnknown`
  // keeps the third distinct, and `retryRateRead` drives the retry the cashier is
  // offered instead of a silent re-denomination.
  const [latestRate, setLatestRate] = useState<ExchangeRateDto | null>(null);
  const [rateUnknown, setRateUnknown] = useState(false);
  const [rateNonce, setRateNonce] = useState(0);
  useEffect(() => {
    setLatestRate(null);
    setRateUnknown(false);
    if (!open || !multiCurrency || !sessionToken || selectedCurrency === totalCurrency) {
      return;
    }
    let cancelled = false;
    settleRead(
      'exchange_rate',
      getLatestExchangeRateScoped(sessionToken, {
        fromCurrency: totalCurrency,
        toCurrency: selectedCurrency,
      }),
    ).then((settled) => {
      if (cancelled) return;
      if (settled.ok) {
        setLatestRate(settled.value);
        setRateUnknown(false);
      } else {
        // No fallback to `exchangeRateInfo` here: on an unknown rate the charge
        // currency must not convert the total at all (see `convertToChargeCurrency`).
        setLatestRate(null);
        setRateUnknown(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, multiCurrency, sessionToken, selectedCurrency, totalCurrency, rateNonce]);

  /** Re-run the rate read after a failure. Identity-stable via useCallback. */
  const retryRateRead = useCallback(() => setRateNonce((n) => n + 1), []);

  const effectiveRateInfo = useMemo(() => {
    // An unknown rate must NOT fall through to the in-memory `exchangeRateInfo`:
    // that list answers a different question (newest row per pair, future-dated
    // rates included) than the CUR-04 read does, and converting a total on the
    // strength of it while the notice shows nothing is how money gets recorded
    // against a rate nobody saw. Returning null makes `convertToChargeCurrency`
    // an identity and `canComplete` refuse to arm — the two gates below are what
    // make the unknown state safe rather than merely visible.
    if (rateUnknown) return null;
    if (!sessionToken || !latestRate) return exchangeRateInfo;
    return {
      ...latestRate,
      rate: exchangeRateToDecimal(latestRate),
      // The backend query is pair-specific (base→charge), so a hit is
      // always the direct direction.
      inverted: false,
    };
  }, [sessionToken, latestRate, exchangeRateInfo, rateUnknown]);

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
    // True only while the CUR-04 rate read is FAILED — not when the pair simply
    // has no rate, which is an answer. The caller gates the settle action on it
    // and shows the retry.
    rateUnknown,
    // Unknown is a distinct answer, not a missing one: the picker is not empty,
    // it was never asked. The caller shows the alert and the retry.
    currenciesUnknown,
baseCurrencyUnknown,
    retryCurrencyLoad,
    retryRateRead,
  };
}
