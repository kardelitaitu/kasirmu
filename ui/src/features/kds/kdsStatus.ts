// ── KDS status progression ─────────────────────────────────────────
//
// The single source of truth for the kitchen display's forward-only status
// ladder: pending -> preparing -> ready -> served.
//
// Before this module the same four-element array was written out in four
// places -- KdsScreen.tsx's STATUS_ORDER, a second ITEM_STATUS_ORDER
// re-declared inside the advanceItemStatus callback body (so it was rebuilt
// on every call), KdsTicketCard.tsx's own STATUS_ORDER, and a copy inside
// KdsStatusAdvance.test.ts. The progression rule `idx < 0 || idx >= len - 1`
// was duplicated alongside it. Nothing kept those in step: changing the
// ladder in one place left the others silently behind, and the test copy
// meant the suite kept passing no matter what production did.
//
// `cancelled` is deliberately absent. It is a valid KdsStatus but not a rung
// on the ladder -- a cancelled ticket has no forward state, so nextKdsStatus
// returns null for it and canAdvanceKdsStatus returns false.

import type { KdsStatus } from '@/api/kds';

/** The forward-only progression. Index order IS the sequence. */
export const STATUS_ORDER: readonly KdsStatus[] = [
  'pending',
  'preparing',
  'ready',
  'served',
];

/**
 * The next status for a ticket or line item, or null when there is none.
 *
 * Returns null for a status outside the ladder (`cancelled`) and for the
 * terminal rung (`served`), which is why callers can treat "no next" and
 * "cannot advance" as the same question.
 */
export function nextKdsStatus(current: KdsStatus | string): KdsStatus | null {
  const idx = STATUS_ORDER.indexOf(current as KdsStatus);
  if (idx < 0 || idx >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1]!;
}

/** Whether a status has anywhere left to go. */
export function canAdvanceKdsStatus(current: KdsStatus | string): boolean {
  return nextKdsStatus(current) !== null;
}
