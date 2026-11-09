// ui/src/features/sales/utils/draftCart.ts
//
// Reviving a persisted POS cart draft.
//
// WHY THIS MODULE EXISTS. The POS writes the in-progress cart to localStorage so a
// crash, an Android memory trim, or a lock/unlock cycle does not lose the sale, and
// restores it on mount. That draft carries each line's `unit_price`, which includes a
// `currency`. The restore used to copy that currency verbatim, which made the DRAFT
// the authority on what currency the cart is in.
//
// That is wrong on its own terms, and it produced a real defect: a cart saved while
// the store's currency was USD came back rendering "$" — including the line prices,
// the subtotal and the change — even after the store, its products and its settings
// had all moved to IDR. The cart's currency is a STORE fact; a crash-recovery draft
// has no business asserting it, because a stale draft outlives the setting it copied.
//
// So the currency is taken from the store here, and the draft's recorded currency is
// demoted to a VALIDATION MARKER. It is kept in the payload rather than dropped, for
// the reason in the next paragraph.

import type { CartLine, LineId, Sku } from '@/types/domain';

/** One line as it appears in a persisted draft (structurally a CartLine, no `id`). */
export interface DraftLine {
  sku: string;
  name?: string;
  category?: string;
  qty: number;
  unit_price: { minor_units: number; currency: string };
  courseId?: CartLine['courseId'];
  coursingStatus?: CartLine['coursingStatus'];
  modifiers?: CartLine['modifiers'];
  note?: string;
}

/**
 * Rebuild cart lines from a persisted draft, taking the currency from the STORE.
 *
 * **A mismatch REFUSES the whole draft rather than relabelling it.** Minor units are
 * meaningless without the exponent they were written under, and the exponents differ
 * between currencies (IDR and JPY are 0; USD and EUR are 2). Stamping IDR onto a
 * draft whose 500000 minor units meant $5,000.00 would render `Rp 500.000` — the
 * same integer, a 100x mispricing, and nothing on screen to show it happened.
 * Relabelling is therefore not a fix, it is a second bug wearing the first one's
 * clothes. When the recorded currency disagrees with the store's, the amounts cannot
 * be trusted, so the caller gets `null` and starts from an empty cart: losing a draft
 * is recoverable, ringing up the wrong price is not.
 *
 * The common case — draft and store agree — behaves exactly as before.
 *
 * @param rawLines       the `lines` array from the parsed draft, untrusted.
 * @param storeCurrency  the store's CURRENT currency code (e.g. "IDR").
 * @returns the revived lines, or `null` when the draft must be discarded.
 */
export function reviveDraftLines(
  rawLines: readonly DraftLine[],
  storeCurrency: string,
): CartLine[] | null {
  for (const line of rawLines) {
    const recorded = line?.unit_price?.currency;
    // A FALSY recorded currency means none was recorded — a payload from a build
    // before the field existed, or one the writer could not resolve. That is an
    // absence of a claim, not a conflicting one, so it is treated as agreeing and
    // the store's currency is stamped on. Only a PRESENT, different code is refused.
    if (recorded && recorded !== storeCurrency) return null;
  }

  return rawLines.map((l) => ({
    id: `restored-${Date.now()}-${Math.random().toString(36).slice(2)}` as LineId,
    sku: l.sku as Sku,
    // Conditionally spread, not assigned: under `exactOptionalPropertyTypes` a
    // present-but-undefined `name` is not the same as an absent one, and `CartLine`
    // models "the IPC did not send a name" as absent.
    ...(l.name !== undefined ? { name: l.name } : {}),
    ...(l.category !== undefined ? { category: l.category } : {}),
    qty: l.qty,
    // The store's currency, NOT `l.unit_price.currency` — that is the whole point.
    unit_price: { minor_units: l.unit_price.minor_units, currency: storeCurrency },
    ...(l.courseId ? { courseId: l.courseId } : {}),
    ...(l.coursingStatus ? { coursingStatus: l.coursingStatus } : {}),
    ...(l.modifiers && l.modifiers.length > 0 ? { modifiers: l.modifiers } : {}),
    ...(l.note ? { note: l.note } : {}),
  }));
}
