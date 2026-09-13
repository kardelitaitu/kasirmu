/**
 * Pick a store offset that provably shifts the UTC calendar day RIGHT NOW.
 *
 * Why this exists: an anchoring test that asserts "the UI shows the date for
 * store zone X" is only meaningful if zone X's calendar date actually differs
 * from UTC's at the moment the test runs. With a hardcoded +14:00 the assertion
 * is vacuous for ten hours of every day (UTC 00:00–09:59), because +14 has not
 * yet crossed midnight. That is precisely the "passes at some hours, fails at
 * others" property a regression gate must never have -- and a sabotage test
 * caught it in the R36-06 screens.
 *
 * Two offsets cover the whole clock:
 *   +14 differs from UTC whenever UTC hour >= 10
 *   -10 differs from UTC whenever UTC hour <  10
 * So exactly one of them always discriminates, and this returns it.
 */

export interface StoreZoneCase {
  /** IANA-ish fixed offset to feed getPrimaryLocationScoped mocks. */
  offset: string;
  /** Hours to shift, signed -- used to compute the expected date. */
  hours: number;
}

/** The offset that currently produces a different calendar date than UTC. */
export function discriminatingStoreZone(now: number = Date.now()): StoreZoneCase {
  const hour = new Date(now).getUTCHours();
  return hour >= 10
    ? { offset: '+14:00', hours: 14 }
    : { offset: '-10:00', hours: -10 };
}

/**
 * The store's calendar day for `now`, computed independently of the code under
 * test (plain UTC arithmetic), so the assertion is not self-referential.
 */
export function expectedStoreDay(case_: StoreZoneCase, daysAgo = 0, now: number = Date.now()): string {
  return new Date(now + case_.hours * 3_600_000 - daysAgo * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Guard for the test itself: fails loudly if the chosen offset happens not to
 * differ from UTC, which would silently make the anchoring assertion vacuous.
 * Cheap insurance against someone later "simplifying" discriminatingStoreZone.
 */
export function assertCaseDiscriminates(case_: StoreZoneCase, now: number = Date.now()): void {
  const utcDay = new Date(now).toISOString().slice(0, 10);
  const storeDay = expectedStoreDay(case_, 0, now);
  if (utcDay === storeDay) {
    throw new Error(
      `timezone test is vacuous right now: offset ${case_.offset} gives the same ` +
      `calendar day as UTC (${utcDay}). discriminatingStoreZone() should have ` +
      `picked the other side; check the hour boundary logic.`,
    );
  }
}
