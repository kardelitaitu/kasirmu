// ui/src/utils/settle-read.ts
//
// The shared contract for a read whose failure must not look like its answer.
//
// A read has three outcomes, not two: it ANSWERED, it found nothing, or it
// FAILED. The second and third both surface as `null` or `[]` to a caller that
// just awaits, which is why the third keeps turning into a claim the screen then
// makes out loud -- "no shift is open", "no quarantined items", "this sale was
// never refunded". Those are not the same statement about the world, and in two
// of the three the only affordance offered after one is the wrong action.
//
// `settleRead` returns `{ ok: false }` with NO value on failure, so there is
// nothing for the caller to mistake for an answer; it has to decide, for its own
// state, what an unanswered read means. `{ ok: true, value }` covers both real
// answers, because from the caller's side `null`/`[]` is a perfectly good value
// when it is genuinely what the read returned.

export type SettledRead<T> = { ok: true; value: T } | { ok: false };

/**
 * Await `read` and report whether it ANSWERED, logging the failure.
 *
 * @param label Names the read in the console line, so a swallowed throw and a
 *   genuine empty result stay tellable apart after the fact -- on screen they
 *   are the same pixels.
 *
 * Every call site so far:
 *   - OfflineQueueScreen.tsx -- the quarantine list
 *   - ShiftManagementScreen.tsx -- the active shift, where a failed read was
 *     inviting the cashier to open a shift that was already open
 *   - SalesHistoryScreen.tsx -- the refunds of the open sale, where a failed
 *     read was presenting a refunded sale as one that was never refunded
 */
export async function settleRead<T>(label: string, read: Promise<T>): Promise<SettledRead<T>> {
  try {
    return { ok: true, value: await read };
  } catch (err) {
    console.error(`[read] ${label} read failed -- recording unknown:`, err);
    return { ok: false };
  }
}
