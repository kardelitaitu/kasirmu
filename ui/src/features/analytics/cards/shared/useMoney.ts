//! Money/count formatting shared by every analytics card (mirrors reports
//! DashboardScreen). Number formatting follows the active Fluent locale
//! (en-US / id) so currency strings match the rest of the localized UI —
//! never a hardcoded English locale.

import { useLocalization } from '@fluent/react';
import { useCurrency } from '@/contexts/CurrencyContext';
import { minorUnitExponent } from '@/types/domain';

export function useMoney() {
  const { currency } = useCurrency();
  const { l10n } = useLocalization();
  const exp = minorUnitExponent(currency);
  // Number formatting follows the active Fluent locale (en-US / id) so
  // currency strings match the rest of the localized UI — never a
  // hardcoded English locale.
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const fmt = (minor: number) =>
    new Intl.NumberFormat(numLocale, { style: 'currency', currency, maximumFractionDigits: exp }).format(minor / 10 ** exp);
  // REP-06: report rows carry their own currency — format in it, same locale.
  const fmtIn = (minor: number, code: string) => {
    const e = minorUnitExponent(code);
    return new Intl.NumberFormat(numLocale, { style: 'currency', currency: code, maximumFractionDigits: e }).format(minor / 10 ** e);
  };
  const short = (minor: number) =>
    new Intl.NumberFormat(numLocale, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(minor / 10 ** exp);
  const count = (n: number) => new Intl.NumberFormat(numLocale).format(n);
  return { fmt, fmtIn, short, count };
}
