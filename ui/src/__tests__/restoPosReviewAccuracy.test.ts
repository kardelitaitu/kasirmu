// ── The resto-pos review's CLOSED claims must stay closed (F30) ───────
//
// `.agents/reviews/resto-pos-ui-review.md` is a code review with a dated status block
// that records each finding as CLOSED or OPEN. F1 sat at **"STILL OPEN, unchanged"**
// long after it was fixed — the note claimed `ItemModifierModal`'s "only production
// importer is still `RetailPosScreen`", while the tree had three.
//
// Why a stale CLOSED/OPEN line is worse than a missing one: the file is consulted as a
// work list. A reader takes "STILL OPEN" at its word and rebuilds something that already
// exists — and because the claim is *specific* (a named importer), it reads as
// re-measured rather than remembered. Two source files still cite this review by name
// (`RestaurantMenu.tsx:79`, `CartLineItem.test.tsx:30`), so its text is read.
//
// This guard does not re-check PROSE. It checks the few structural facts the status
// block asserts, so the next staleness fails here instead of misleading a reader:
//   · F1 closed  -> the restaurant menu imports the picker AND carries `modifiers`
//   · F2 closed  -> the SHARED cart panel declares the two assignment props
// If a claim regresses, the code change is the defect and this fires on it.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['.agents/reviews/resto-pos-ui-review.md', 'ui/src/features/sales/PosScreen.tsx'];
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

const REVIEW = '.agents/reviews/resto-pos-ui-review.md';
const MENU = 'ui/src/features/restaurant/RestaurantMenu.tsx';
const SHARED_PANEL = 'ui/src/features/sales/components/CartPanel.tsx';

describe('the resto-pos review status block matches the tree (F30)', () => {
  const review = read(REVIEW);

  /**
   * The STATUS WORD a finding's own line declares — the token right after the em dash.
   *
   * Deliberately NOT "does the block contain CLOSED". My first version did that, and it
   * passed against a planted `- **F1 — STILL OPEN` because the rest of the same block
   * still mentioned the closure further down. The status is a property of the HEADLINE,
   * so it is read from the headline (`- **F3 — CLOSED.**` -> `CLOSED`).
   */
  function statusOf(finding: string): string {
    const m = review.match(new RegExp(`^- \\*\\*${finding} — ([A-Z][A-Z (),-]*)`, 'm'));
    return m ? m[1]!.trim() : '';
  }

  /** The finding's whole entry, up to the next finding — for reading its prose. */
  function blockOf(finding: string): string {
    const start = review.indexOf(`- **${finding} —`);
    if (start < 0) return '';
    const rest = review.slice(start + 1);
    const next = rest.search(/^- \*\*F[0-9] —/m);
    return next < 0 ? rest : rest.slice(0, next);
  }

  it('extracts both status blocks (guards the guards)', () => {
    // A drifted extraction would make every assertion below vacuously true.
    expect(statusOf('F1'), 'F1 headline status not extractable — the regex has drifted')
      .not.toBe('');
    expect(statusOf('F2'), 'F2 headline status not extractable — the regex has drifted')
      .not.toBe('');
    expect(blockOf('F1').length).toBeGreaterThan(50);
  });

  it('F1 claims CLOSED and the restaurant menu really attaches modifiers', () => {
    expect(statusOf('F1'), 'F1 is no longer recorded as CLOSED — re-measure before moving it')
      .toMatch(/^CLOSED/);
    const menu = read(MENU);
    expect(menu, 'the restaurant menu stopped importing the modifier picker, so F1 is open again')
      .toContain("ItemModifierModal");
    // The payload the finding was about: `meta.modifiers` reaching the add call.
    expect(menu, 'the restaurant menu stopped forwarding `modifiers` — F1 has regressed')
      .toContain('modifiers?: ModifierSelection[]');
  });

  it('F2 claims CLOSED and the SHARED cart panel carries both props', () => {
    expect(statusOf('F2')).toMatch(/^CLOSED/);
    const panel = read(SHARED_PANEL);
    // The distinction F2 turned on: the restaurant stack uses the SHARED panel, so the
    // props must be here, not only in retail's fork.
    expect(panel, 'the shared cart panel lost `onEditModifiers` — F2 has regressed')
      .toContain('onEditModifiers');
    expect(panel, 'the shared cart panel lost `onAssignCourse` — F2 has regressed')
      .toContain('onAssignCourse');
  });
});