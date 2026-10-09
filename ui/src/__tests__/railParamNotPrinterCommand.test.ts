// ── Guard: the QRIS printReceipt rail parameter is NOT the printer command ──
//
// F19 records five payments-screen controls that round-trip to storage and reach
// nothing. `printReceipt` is the trap in that list, and round 106 measured why:
//
//   grep print_receipt  ->  79 Rust hits, EVERY ONE the printer COMMAND
//                           (`print_receipt_scoped` / `run_print_receipt_inner`)
//   grep "printReceipt" ->   0 Rust hits
//
// So the rail's parameter and the printer's command share a NAME and nothing else.
// A reader checking F19 by grep finds 79 hits and concludes the toggle is wired —
// which would close the one control in the list that is most obviously inert: a
// QRIS receipt switch that prints nothing and says nothing.
//
// ⚠️ This is the THIRD spelling of one failure in this session: a getter counted as
// a reader (round 93), a delegating wrapper counted as a consumer (round 94), and now
// a HOMONYM counted as a call site. The guard below pins the distinction so the trap
// cannot be walked into twice.
//
// It deliberately does NOT assert the toggle is inert — that is F19's product question,
// and building the feature is allowed. It asserts the two names are still DIFFERENT
// things, so whichever way F19 is resolved, the reading stays honest.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = (() => {
  const markers = ['todo-restaurant-pos-reliability.md', 'ui/src/__tests__/deadSettingsKey.test.ts'];
  let dir = process.cwd();
  for (let up = 0; up < 6; up += 1) {
    if (markers.every((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repo root from ' + process.cwd());
})();

/** Every .rs file under the crate roots, tests excluded. */
function rustSources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['target', 'node_modules', '.git'].includes(e.name)) continue;
        walk(full);
      } else if (e.name.endsWith('.rs')) {
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        if (/_tests\.rs$|\/tests\//.test(rel)) continue;
        out.push({ rel, text: fs.readFileSync(full, 'utf-8') });
      }
    }
  };
  for (const d of ['platform', 'crates', 'apps', 'modules', 'foundation']) {
    const full = path.join(ROOT, d);
    if (fs.existsSync(full)) walk(full);
  }
  return out;
}

describe('the QRIS rail parameter is not the printer command (F19)', () => {
  const rust = rustSources();

  it('the rail parameter has no Rust consumer, in either spelling', () => {
    const camel = rust.filter((f) => f.text.includes('printReceipt'));
    const snaked = rust.filter((f) => f.text.includes('print_receipt'));
    expect(
      camel.map((f) => f.rel),
      'a Rust file now names printReceipt — the QRIS rail parameter HAS a consumer, F19 is resolved for this control, and the plan row must be re-measured rather than left claiming it is inert',
    ).toEqual([]);
    expect(
      snaked.length,
      'the printer command disappeared from Rust — this guard no longer has the homonym to protect against, so it needs rewriting rather than silencing',
    ).toBeGreaterThan(0);
  });

  it('no Rust file parses the rail parameter JSON', () => {
    // ⚠️ The assertion is deliberately NOT "every print_receipt hit is the printer
    // command". My first version asserted that and FAILED — and the failure was
    // correct, because `print_receipt` is a NAME that appears across the HAL as the
    // printer TRAIT METHOD (`traits/printer.rs`), its mock (`drivers/mock.rs`), the
    // scoped commands, AND as an EDC trait method (`traits/edc.rs:150`). All of those
    // are printers. None of them reads the QRIS rail's `parameters` JSON.
    //
    // So the load-bearing fact is narrower and stronger: the rail parameter is a KEY
    // inside a JSON blob, and no Rust file names that key. A file that started
    // deserialising rail parameters would have to spell it.
    const parses = rust.filter(
      (f) => f.text.includes('printReceipt') || /parameters.*print_receipt|print_receipt.*parameter/i.test(f.text),
    );
    expect(
      parses.map((f) => f.rel),
      'a Rust file now reads the QRIS rail parameter — F19 is resolved for this control, ' +
        'and the plan row must be re-measured rather than left claiming it is inert',
    ).toEqual([]);
  });

  it('the control still exists, so the guard is not protecting a removed toggle', () => {
    const screen = fs.readFileSync(
      path.join(ROOT, 'ui/src/features/restaurant/screens/RestaurantPaymentsScreen.tsx'),
      'utf-8',
    );
    expect(
      screen.includes('data-testid="qris-print-bill-toggle"'),
      'the QRIS print-bill toggle is gone; if F19 was resolved by REMOVING it, delete this guard rather than leaving it green over nothing',
    ).toBe(true);
  });
});
