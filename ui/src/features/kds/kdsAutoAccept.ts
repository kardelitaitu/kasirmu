// ── KDS auto-acknowledge eligibility ───────────────────────────────
//
// The pure decision behind the auto-advance effect in KdsScreen.tsx: given a
// ticket, the in-flight guard, and the user's preferences, should this ticket
// be advanced to "preparing" right now?
//
// Extracted because the effect is a useCallback/useEffect body bound to a
// render, so it cannot be imported -- and the first suite that wanted to test
// it copied the logic into the test file instead. That copy was wrong in a way
// its own comment admitted:
//
//     if (inFlight.has(order.status)) return false; // simplified -- real impl checks order.id
//
// The production guard keys on the ORDER ID; the copy keyed on the STATUS.
// Every test still passed, because none of them exercised two pending tickets
// sharing a status -- the only input that distinguishes the two rules. So the
// suite documented a double-fire guard that the code does not implement, and
// would not have caught a regression that removed the guard entirely.
//
// Keeping the decision pure and exported means the tests import the same
// function the effect calls.

import type { KdsOrder } from '@/api/kds';

/** Milliseconds to wait after receipt before auto-advancing. */
export function autoAckDelayMs(acknowledgeDelayMin: number): number {
  return acknowledgeDelayMin * 60 * 1000;
}

/**
 * Whether `order` should be auto-advanced now.
 *
 * `inFlight` is keyed by ORDER ID, matching the effect that owns this guard --
 * the point the test-local copy got wrong. `now` is injectable so callers can
 * be tested against a fixed clock instead of vi.useFakeTimers().
 */
export function isAutoAckEligible(
  order: Pick<KdsOrder, 'id' | 'status' | 'received_at'>,
  inFlight: ReadonlySet<string>,
  prefs: { autoAcknowledge: boolean; acknowledgeDelayMin: number },
  now: number = Date.now(),
): boolean {
  if (!prefs.autoAcknowledge) return false;
  if (prefs.acknowledgeDelayMin <= 0) return false;
  if (order.status !== 'pending') return false;
  if (!order.received_at) return false;
  if (inFlight.has(order.id)) return false;
  const receivedAt = new Date(order.received_at).getTime();
  if (Number.isNaN(receivedAt)) return false;
  return now - receivedAt >= autoAckDelayMs(prefs.acknowledgeDelayMin);
}
