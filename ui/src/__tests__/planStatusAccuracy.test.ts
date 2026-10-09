// ── The plan's own status header must match its body (F32) ─────────────
//
// `todo-restaurant-pos-reliability.md` opens with a status header that summarises
// progress: which phases are done, which screens remain. **That header went stale
// twice in a row** — it read "P6 2 of 3 screens" after the third landed, and named
// "P1's last two keys (owner decision)" after both were resolved by building them.
//
// A stale progress header is worse than no header. It is the FIRST thing a reader
// sees, it is written in the same confident voice as the rest, and it says work
// REMAINS when it does not — so it sends the next person to redo something. Both
// of this plan's stale claims were found only by re-reading the body against the
// tree, which is exactly the step a summary exists to save.
//
// This guard pins the two claims that went stale, so the same drift fails here. It
// does not attempt to re-derive progress in general — that is not mechanical. It
// checks the specific assertions that HAVE been wrong, against the evidence that
// makes them right.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['todo-restaurant-pos-reliability.md', 'ui/src/__tests__/deadSettingsKey.test.ts'];
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
const DEAD_GUARD = 'ui/src/__tests__/deadSettingsKey.test.ts';

describe('the plan status header matches the tree (F32)', () => {
  /**
   * The status header: the FIRST `> **…` block only.
   *
   * Deliberately stops at the first non-contiguous gap. This file also carries dated
   * CORRECTION notes that QUOTE the stale text they replaced ("it read *'P6 2 of 3
   * screens'*"), and a whole-file scan reads those quotes as live claims — which made
   * my first version fail on the CORRECT header. Quoted history is not a claim.
   */
  const header = (() => {
    const lines = read(PLAN).split('\n');
    const out: string[] = [];
    let seen = false;
    for (const l of lines) {
      if (l.startsWith('> **')) {
        out.push(l);
        seen = true;
      } else if (seen) {
        break;
      }
    }
    return out.join('\n');
  })();

  it('found the status header (guards the guard)', () => {
    expect(header.length, 'the plan header moved or changed shape — extraction has drifted')
      .toBeGreaterThan(80);
  });

  it('does not claim P6 has screens remaining', () => {
    // P6 landed all three screens in round 74. If a future edit re-adds a
    // "2 of 3" style claim, the sweep work reads as outstanding again.
    expect(header, 'the header claims P6 is incomplete — re-measure before saying so')
      .not.toMatch(/P6\s+\d+\s+of\s+3/);
    // Only the REMAINING clause counts. My corrected header legitimately mentions P6
    // ("P6's third screen landed round 74"), so a bare mention test fires on the
    // CORRECT text — the same over-broad-matcher flaw the round-71 kill-test caught.
    const remaining = (header.match(/Remaining:[^\n]*/i) ?? [''])[0];
    expect(remaining, "the header still lists P6's screen as remaining")
      .not.toMatch(/P6/i);
  });

  it('does not claim P1 has unresolved keys needing an owner', () => {
    // Both DELETE-or-BUILD keys were built (rounds 57-58) and `hold_order` was
    // removed (round 42). The guard that tracks this class is now EMPTY.
    expect(header, "the header still asks the owner about P1's keys — they are resolved")
      .not.toMatch(/P1's[^\n]*owner decision/i);
  });

  it('the dead-key guard really is empty, which is what makes P1 complete', () => {
    // The load-bearing fact behind the claim above. If a new dead key is
    // declared, this fails and the header line above must be revisited too.
    const src = read(DEAD_GUARD);
    const list = src.slice(src.indexOf('const DECLARED_DEAD'));
    const body = list.slice(list.indexOf('[') + 1, list.indexOf('];'));
    // Strip comments; only real entries count.
    const entries = body
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(
      entries,
      'DECLARED_DEAD gained an entry — a restaurant setting has no reader again, and the ' +
        "plan's P1-complete claim needs re-measuring",
    ).not.toMatch(/\{\s*key:/);
  });
});