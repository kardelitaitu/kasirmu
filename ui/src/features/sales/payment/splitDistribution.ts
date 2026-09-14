/**
 * Even split distribution - the pure arithmetic behind the "Split Evenly" button.
 *
 * Slice W5-d of the PaymentModal extraction campaign: the floor/remainder rule
 * that used to sit inside autoSplitEvenly in PaymentModal.tsx, moved verbatim
 * into a module with no React, no state and no currency reads in it. Same
 * Math.floor, same %, same exponent-explicit digit placement, same row order.
 *
 * WHY THIS ONE PIECE OF THE CLUSTER COULD MOVE AND THE STATE COULD NOT: the
 * split rows are an atom with writers on both sides of the money boundary -
 * splits is an INPUT to ./useTenderMath (which is why ./useSplitTenderState has
 * to be called above it) while the even-split writer needs that hook's OUTPUT
 * effectiveTotalInCartCurrency. No move of a stateful function can satisfy both
 * directions. The arithmetic can, because it has no opinion about the boundary:
 * it takes the total as a number and hands back strings, and the shell stays on
 * both sides of it - reading the total where the total exists, writing the rows
 * where the rows exist.
 *
 * THE LAW, which is what the 18 cases in
 * ui/src/__tests__/PaymentModalSplitTenderState.test.tsx (T8-T14) pin from the
 * rendered modal: every row gets Math.floor(total / count) minor units and the
 * LAST row only gets that base plus the exact remainder - never spread over the
 * first r rows, never on the first row, never rounded. 10001 over 3 rows is
 * 3333 + 3333 + 3335; over 5 rows it is 2000 x 4 + 2001; IDR exponent 0 over
 * 100000 on 3 rows is 33333 + 33333 + 33334 with no decimal separator anywhere.
 * The sums are exact by construction: base * count + remainder === total.
 * A toFixed or a float division here would reintroduce the over-split this rule
 * exists to prevent - 4,450,001 divided by 2 became 2,225,001 + 2,225,002 =
 * 4,450,003, one unit MORE than the sale - and the per-row literals in those
 * cases go red on it immediately, which is why they were landed first.
 *
 * THE count === 0 CHOICE, stated rather than inherited: this returns an empty
 * array. The early return it replaces bailed out before any setSplits call, so
 * "no rows" meant "nothing is written and nothing throws"; an empty result fed
 * back through the caller's patch is the same observable outcome - the rows are
 * unchanged. A throw is the wrong call here: the UI cannot reach it (case T5
 * proves the remove floor keeps at least one row alive), so it would be an
 * unexercised failure path in the payment flow rather than a guard. The branch
 * is kept because a total of 0 rows is a question this function should answer
 * instead of dividing by zero and producing NaN strings.
 *
 * MONEY: integer minor units in, decimal literals out, no float anywhere on the
 * path. totalMinor is the integer the money hook already holds; the only two
 * operations on it are Math.floor and %, both exact on integers; the minor ->
 * literal conversion goes through ./moneyFormat's minorUnitsToInputString, which
 * places digits with string arithmetic at the explicit currency exponent rather
 * than dividing by the scale. This module does not parse, does not sum, and does
 * not know what a currency code is.
 */
import { minorUnitsToInputString } from './moneyFormat';

/**
 * Split `totalMinor` integer minor units across `count` rows and render each
 * share as the decimal literal the row input holds, at `exponent` decimal places
 * (USD 2, IDR 0). Index order is row order; the remainder rides on the last slot.
 * Returns [] for count 0 - see the module doc.
 */
export function distributeEvenly(
  totalMinor: number,
  count: number,
  exponent: number,
): string[] {
  if (count === 0) return [];
  const baseMinor = Math.floor(totalMinor / count);
  const remainderMinor = totalMinor % count;
  const last = count - 1;
  return Array.from({ length: count }, (_, i) =>
    minorUnitsToInputString(i === last ? baseMinor + remainderMinor : baseMinor, exponent),
  );
}
