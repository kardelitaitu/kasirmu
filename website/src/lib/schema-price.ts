/**
 * Price → schema.org `Offer.price` conversion for the pricing page's JSON-LD.
 *
 * The pricing content (`src/content/pricing/{en,id}.ts`) stores a **display**
 * string per tier — `'$4.99'`, `'Rp 1.000.000'`, `'Custom'` / `'Kustom'` —
 * because that is what the card renders. Schema.org's `Offer.price` must be a
 * **number**, so emitting the display string straight into JSON-LD produced
 * invalid structured data on the live pricing page:
 *
 *     "price": "$0"        // invalid — not a number
 *     "price": "$4.99"     // invalid — currency symbol is not part of a price
 *     "price": "Custom"    // invalid — not a price at all
 *
 * Google drops an `Offer` whose `price` cannot be parsed, which removes the
 * Product rich result from a commercial page. This module is the single
 * conversion point so the two cannot drift.
 *
 * The display string stays the single source of truth: no price is duplicated
 * as a second numeric literal that could go stale against the card copy.
 *
 * @param display   The tier's display price, e.g. `'$4.99'` / `'Rp 49.000'`.
 * @param currency  The tier's display currency, which fixes the separator
 *                  convention (IDR uses `.` as the thousands separator, so all
 *                  non-digits are dropped; USD keeps `.` as the decimal point).
 * @returns The numeric price, or `undefined` when the display text is not a
 *          price (the `Custom` / `Kustom` Enterprise tier). Callers must omit
 *          the offer rather than emit a placeholder — a wrong price is worse
 *          than an absent one.
 */
export function schemaPrice(display: string, currency: 'USD' | 'IDR'): number | undefined {
  const digits = currency === 'IDR' ? display.replace(/[^0-9]/g, '') : display.replace(/[^0-9.]/g, '');
  if (!digits || !/[0-9]/.test(digits)) return undefined;
  const value = Number(digits);
  return Number.isFinite(value) ? value : undefined;
}
