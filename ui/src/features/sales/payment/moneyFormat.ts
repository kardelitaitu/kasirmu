/**
 * Shared money formatting for the sales payment surface (features/sales/payment).
 *
 * The single home for the minor-units -> decimal-literal helper that the payment
 * modal and its extracted tender panels need. It moved here VERBATIM (body and
 * doc comment) out of PaymentModal.tsx: CashTenderPanel used to receive it as the
 * `formatMinorUnits` prop, which existed only because there was no shared module
 * for it. Both callers now import this one definition; nothing re-implements or
 * "simplifies" the digit placement.
 */

/**
 * Render integer minor units as the plain decimal literal an editable amount
 * `<input>` needs — 350 with exp 2 → "3.50", 10000 with exp 0 → "10000" — so the
 * value round-trips back through `parseMinorUnits` unchanged.
 *
 * Deliberately NOT `formatMoney`: that is the *display* formatter, and its output
 * ("Rp 10.000") is not a decimal literal — `parseMinorUnits` returns `null` for
 * it, which would silently zero the tender. Digit placement here is pure
 * integer/string arithmetic, so no money value passes through a binary float
 * (same shape as `millionthsToDecimalString` in `@/types/domain`). It agrees with
 * the exact quotient for every input: an integer scaled by 10^exp has at most
 * `exp` fractional digits, so nothing is ever rounded.
 */
export function minorUnitsToInputString(minor: number, exp: number): string {
  const digits = String(Math.trunc(Math.abs(minor))).padStart(exp + 1, '0');
  const body = exp > 0
    ? `${digits.slice(0, digits.length - exp)}.${digits.slice(digits.length - exp)}`
    : digits;
  return minor < 0 ? `-${body}` : body;
}
