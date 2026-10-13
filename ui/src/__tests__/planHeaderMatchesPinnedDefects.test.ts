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

const PLAN = 'todo-restaurant-pos-reliability.md';

/**
 * Guards that DECLARE a live, unwired defect, and the header claim each contradicts.
 *
 * One entry per declared defect. A new pin belongs here, so the header cannot drift
 * away from it without failing this case.
 */
const DECLARED_LIVE_DEFECTS: Array<{ guard: string; what: string }> = [
  {
    guard: 'ui/src/__tests__/coreRailToggleReach.test.ts',
    what: 'two INERT core-rail toggles (cash, card)',
  },
  {
    guard: 'ui/src/__tests__/ReceiptPreviewGroupingParity.test.ts',
    what: 'formatMoney cannot express currency.thousands_separator',
  },
];

describe('the plan header agrees with the guards that pin open defects', () => {
  it('every declared defect is still declared by its guard', () => {
    // If a guard is deleted or emptied, its entry here must go too — otherwise this
    // list becomes the stale summary it exists to prevent.
    for (const d of DECLARED_LIVE_DEFECTS) {
      expect(fs.existsSync(path.join(ROOT, d.guard)), d.guard + ' is missing').toBe(true);
    }
    expect(
      /INERT/.test(read('ui/src/__tests__/coreRailToggleReach.test.ts')),
      'coreRailToggleReach no longer records an INERT rail — invert or delete the ' +
        'entry in this file to match.',
    ).toBe(true);
  });

  it('the header does not claim there are no open defects while they are pinned', () => {
    const header = read(PLAN).split('\n').slice(0, 12).join('\n');
    // The claim only becomes true when every entry above is resolved. Until then the
    // header must describe the debt instead of denying it.
    expect(
      DECLARED_LIVE_DEFECTS.length,
      'no declared defects — this case is vacuous. Delete it rather than leaving it ' +
        'green for the wrong reason.',
    ).toBeGreaterThan(0);
    // Match the CLAIM, not any mention of the phrase.
    //
    // A corrected header legitimately QUOTES the old wording to explain what changed
    // ("the earlier X was false"), and a bare substring test read that quotation as
    // the claim — failing the header that had just been fixed. So the check asks a
    // narrower question: does the header ASSERT the phrase as its own position?
    //
    // Plain string work rather than a regex: the phrase contains no escapes, and a
    // nested-quote lookbehind here was unreadable and brittle.
    const PHRASE = 'NO open code defects';
    let claimsClean = false;
    for (const line of header.split('\n')) {
      const at = line.indexOf(PHRASE);
      if (at === -1) continue;
      const before = line.slice(0, at);
      const after = line.slice(at + PHRASE.length);
      // Quoted, or sitting after a negation, is a MENTION rather than the claim.
      const quoted = before.trimEnd().endsWith('"') || after.trimStart().startsWith('"');
      const negated = /\b(no|not|never|false)\b/i.test(before);
      if (!quoted && !negated) claimsClean = true;
    }
    expect(
      claimsClean,
      'The header still claims "NO open code defects" while ' +
        DECLARED_LIVE_DEFECTS.map((d) => d.what).join(' and ') +
        ' are pinned as open in code. State them, or resolve them — a summary that ' +
        'denies the debt its own guards record is the drift this plan has corrected ' +
        'four times already (rounds 74, 75, and twice in planStatusAccuracy).',
    ).toBe(false);
  });
});
