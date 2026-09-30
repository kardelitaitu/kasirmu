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

//
// The `label` is written into the console line verbatim, so a caller that wants
// its subsystem in the prefix passes it there: `settleRead('boot has_users', …)`
// logs `[read] boot has_users read failed -- recording unknown:`. Four local
// copies of this function predate it and each carried its own prefix
// (`[boot]`, `[stock-transfers]`, `[warehouse-count]`, `[read]`); the label is
// how that attribution survives the merge instead of being flattened away.

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
 *     read was presenting a refunded sale as one that was never refunded; then
 *     the sale's roster, then its per-line cost/margin report
 *   - useMultiCurrency.ts -- the exchange rate pair, the picker list and the
 *     store default
 *   - AppShell.tsx -- every boot read (`boot ` prefix)
 *   - StockTransfersScreen.tsx (`stock-transfers ` prefix)
 *   - WarehouseCountFlow.tsx (`warehouse-count ` prefix)
 *   - boot-retry.ts -- the tablet boot gate, whose lost-response retry
 *     settles to the same verdict (it cannot reuse the FUNCTION: the read
 *     has to be re-issued, not just awaited, so the contracts differ)
 */
export async function settleRead<T>(label: string, read: Promise<T>): Promise<SettledRead<T>> {
  try {
    return { ok: true, value: await read };
  } catch (err) {
    console.error(`[read] ${label} read failed -- recording unknown:`, err);
    return { ok: false };
  }
}
