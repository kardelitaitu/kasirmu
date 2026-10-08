// ── RestaurantMenuEditorScreen pure logic ─────────────────────────────────
//
// Extracted from RestaurantMenuEditorScreen.tsx for the same two reasons
// receiptLogic.ts sits beside RestaurantReceiptsScreen.tsx: the screen file must
// export components only (react-refresh/only-export-components), and price
// parsing is arithmetic that deserves direct unit tests rather than a DOM.
//
// Money crosses this boundary as INTEGER MINOR UNITS in both directions. The
// operator types major units, so the conversion happens here and nowhere else --
// never by parsing to float and multiplying, which is where the 0.1 + 0.2 class
// of error enters an invoice.

/**
 * Parse operator input (major units, as typed) into integer minor units.
 *
 * Accepts both conventions because the same field serves IDR and foreign stores:
 * `1.234,50` and `1234.50`. Grouping dots (a dot followed by exactly three
 * digits at a group boundary) are stripped before the decimal mark is decided.
 *
 * @returns the minor-unit value, or null when the text is not a usable amount
 *   (empty, non-numeric, or more precision than the currency has).
 */
export function parsePriceToMinor(input: string, currency: string): number | null {
  const raw = input.trim();
  if (raw === '') return null;

  // Drop spaces and underscores first: both are common paste artefacts.
  const normalised = raw.replace(/[ _]/g, '');

  // A dot is a GROUPING mark only when every dot-group is exactly three digits
  // AND there is no comma acting as the decimal mark. This is what separates
  // `1.234.567` (1234567) from `50.123` (a decimal with three places, which
  // IDR cannot hold). Treating any dot-before-three-digits as grouping reads the
  // second as 50123 -- the exact mis-parse this branch exists to prevent.
  // `50.123` is ambiguous by syntax alone: it is either the grouped integer
  // 50123 or a three-decimal amount. The currency breaks the tie. IDR cannot
  // hold three decimal places, so for IDR the grouped reading is the only one
  // that yields a valid amount; for a currency that CAN hold three, the decimal
  // reading is the one the operator meant.
  const threePlaceGroups = /^\d{1,3}(\.\d{3})+$/.test(normalised);
  const multiGroup = threePlaceGroups && (normalised.match(/\./g) ?? []).length > 1;
  const looksGrouped =
    !normalised.includes(',') && threePlaceGroups && (currency === 'IDR' || multiGroup);
  const degrouped = looksGrouped ? normalised.replace(/\./g, '') : normalised;

  // A comma is the decimal mark only when no dot survived.
  const dotForm = degrouped.includes('.') ? degrouped : degrouped.replace(',', '.');

  if (!/^\d+(\.\d*)?$/.test(dotForm)) return null;

  const [whole = '0', frac = ''] = dotForm.split('.');
  // IDR has no sub-unit in practice; more than two decimals is a typo, not a value.
  if (frac.length > 2 && currency === 'IDR') return null;

  const padded = (frac + '00').slice(0, 2);
  const minor = Number(whole) * 100 + Number(padded);
  return Number.isFinite(minor) ? minor : null;
}

/**
 * Render integer minor units back into the plain digits the operator edits:
 * no currency symbol, no grouping separators. `5000` -> `"50"`, `5050` -> `"50.50"`.
 */
export function formatMinorForInput(minor: number): string {
  if (!Number.isFinite(minor) || minor < 0) return '';
  const whole = Math.trunc(minor / 100);
  const frac = Math.abs(minor % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}
