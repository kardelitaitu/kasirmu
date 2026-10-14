// ── "NO open code defects" must be true, or the header must say otherwise ────
//
// `todo-restaurant-pos-reliability.md` opens with:
//
//   status: OPEN — P0–P8 DONE. NO open code defects. … Remaining: one unasserted
//   D6 pairing.
//
// Two guards written INTO this repo disagree with "NO open code defects":
//
//   ui/src/__tests__/coreRailToggleReach.test.ts
//       records two INERT core-rail toggles (cash, card) — an operator switches one
//       off and the charge modal keeps offering the tender. (`credit` was the third
//       until `abb1c324b` wired it into the modal; the guard moved it to WIRED and so
//       did this entry.)
//   ui/src/__tests__/ReceiptPreviewGroupingParity.test.ts
//       records that formatMoney groups by locale and cannot express
//       currency.thousands_separator, so paper and preview diverge.
//
// Both are PINS — the defects are known, stated in code with a wouldNeed clause, and
// deliberately left to an owner. Pinning them is right. Repeating \"NO open code
// defects\" beside them is not: the header is the first thing a reader sees, and it
// sends the next person away from the exact debt the guards exist to surface.
//
// WHY THIS IS THE SAME GUARD AS planStatusAccuracy, EXTENDED
// That file already pins the header against DECLARED_DEAD (\"the header and the
// dead-key guard agree on whether P1 is clean\") and against two stale claims. It
// states its own limit: \"It does not attempt to re-derive progress in general.\"
// This case does not re-derive either — it checks ONE specific assertion, \"NO open
// code defects\", against the guards that declare otherwise. The header's own history
// (rounds 74, 75, and twice in the file that documents them) is four corrections of
// this same kind, each found by re-reading the body by hand.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['todo-restaurant-pos-reliability.md', 'ui/src/__tests__/coreRailToggleReach.test.ts'];
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (markers.every((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repo root from ' + process.cwd());
}

const ROOT = findRoot();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

/**
 * Guards that DECLARE a live, unwired defect, and the header claim each contradicts.
 *
 * One entry per declared defect. A new pin belongs here, so the header cannot drift
 * away from it without failing this case.
 */
/**
 * EMPTIED 2026-10-14. Both entries were resolved by explicit owner rulings, and this
 * file's own contract says the list must follow:
 *
 *   core-rail toggles — WIRED. `coreRailToggleReach.test.ts`'s INERT map is now empty
 *   and its WIRED map holds all five rails; `PaymentModal` gates cash and card on
 *   `coreRailWithheld` in three places each, and four behavioural cases in
 *   `PaymentModalSaleFlow.test.tsx` pin the withholding.
 *
 *   formatMoney / currency.thousands_separator — CLOSED by `e84ccdc62` + `e0ffa8213`.
 *   `ReceiptPreviewGroupingParity.test.ts` likewise emptied its own ledger and now
 *   asserts the emptiness.
 *
 * So the header's "NO open code defects" is TRUE for the first time since this guard
 * existed. The cases below are DELETED rather than left green: the second one's own
 * message said *"no declared defects — this case is vacuous. Delete it rather than
 * leaving it green for the wrong reason."* An assertion that nothing is pinned is what
 * `coreRailToggleReach` already proves, and the opposite drift (a header claiming open
 * work that landed) is now policed by `planStatusAccuracy.test.ts`'s D6 case.
 */
const DECLARED_LIVE_DEFECTS: Array<{ guard: string; what: string }> = [];

/**
 * The lint that survives, and it is the half of this guard that is not about any one
 * defect: the list must not outlive the guards it names.
 *
 * The two cases that read it — "every declared defect is still declared by its guard"
 * and "the header does not claim there are no open defects while they are pinned" —
 * are gone because an empty list makes both vacuous, and the second one's own message
 * said to delete rather than leave it green for the wrong reason. What replaces them is
 * the check those cases existed to make cheap: if a real pin is ever added here, its
 * guard must actually declare it.
 *
 * Kept as a FORWARD guard rather than deleted with the rest, because the failure it
 * catches is the one this file was written for — a list that becomes a stale summary.
 * Adding an entry whose guard does not contain the matching marker fails here today,
 * not on the day someone re-reads it.
 */
describe('a defect declared here must still be declared by its own guard', () => {
  /** Each entry names the guard, and the guard must still carry an INERT rail or a
   *  non-empty widened/pinned ledger — whichever shape the defect takes. */
  const DECLARES: Record<string, RegExp> = {
    'ui/src/__tests__/coreRailToggleReach.test.ts': /INERT/,
  };

  it('every hypothetical future entry would still be checkable', () => {
    // Vacuity is the danger in a guard whose whole subject has been resolved: a file of
    // green tests proving nothing. This asserts the file can still fail, by proving the
    // detector it would use is real — the marker regex must match the guard's vocabulary
    // as it exists now, including the comments that explain why the INERT map is empty.
    const RAIL_GUARD = 'ui/src/__tests__/coreRailToggleReach.test.ts';
    const source = read(RAIL_GUARD);
    const marker = DECLARES[RAIL_GUARD];
    expect(marker, 'the marker table lost its rail-guard entry').toBeDefined();
    expect(
      marker!.test(source),
      'the INERT marker is gone from the rail guard even in prose — a future rail that ' +
        'goes inert would no longer be detectable by this file.',
    ).toBe(true);
    expect(DECLARED_LIVE_DEFECTS, 'no live defects are declared, which is the state this file now records').toEqual([]);
  });
});
