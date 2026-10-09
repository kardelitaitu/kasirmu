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

/**
 * Production `.ts`/`.tsx` under `ui/src`, minus tests and dev mocks.
 *
 * The reader search must exclude tests — a key named only in its own test is not
 * wired — and dev mocks, which mirror the wire without being a consumer.
 */
function collectUiSources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const root = path.join(ROOT, 'ui/src');
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'dev-mock') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        out.push({
          rel: path.relative(ROOT, full).split(path.sep).join('/'),
          text: fs.readFileSync(full, 'utf-8'),
        });
      }
    }
  };
  walk(root);
  return out;
}

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
    //
    // ⚠️ THIS FILE READS A PLAN DOC OTHER LANES EDIT. A full-suite run on
    // 2026-10-09 failed here once and passed on re-run: another lane rewrote the
    // header between this test's read and its assertion. That is a race in the
    // TEST, not a defect in the plan — so if this case fails while the header
    // reads correctly by hand, suspect a concurrent edit and re-run before
    // changing anything. The extraction below is intentionally strict so a real
    // drift still fails loudly.
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

  it("F1's evidence row does not claim its keys are unread", () => {
    // The row read "repo-wide grep returns no reader for 7 keys" — true when
    // written, false after P1 wired eight of them. It is the FOURTH place this
    // plan's summary outlived its body (rounds 74, 75, and twice here).
    const body = read(PLAN);
    const row = (body.match(/^\| F1 \|[^\n]*/m) ?? [''])[0];
    expect(row, 'the F1 evidence row was not found — the index table has been restructured')
      .not.toBe('');
    expect(
      row,
      "the F1 row again claims its keys have no reader — 8 of 10 are wired and 2 were removed; " +
        're-measure with the readers table in the F1 resolution note before restoring this claim',
    ).not.toMatch(/no reader/);
  });

  /**
   * A section heading that still says IN PROGRESS after its work landed.
   *
   * ⚠️ Added round 100. The header guard above covers the TOP of the plan, and that
   * was still not enough: `:2996` kept the title *"P6 — i18n sweep (fixes F10) — 🔶 IN
   * PROGRESS"* for ~26 rounds after all three screens landed, while the body three
   * paragraphs down said DONE for two of them and the third was recorded at `:1130`.
   *
   * **The body gets updated and the title does not** — the same drift the header
   * guard exists for, one level down. A reader who opens the P6 section to check
   * whether the sweep is finished reads the title first and stops.
   *
   * This checks the P6 heading only, because it is the one that was wrong. A general
   * "no heading claims in-progress" rule would fire on sections that genuinely are,
   * which is the over-broad-matcher flaw this file has already been bitten by twice.
   */
  it('does not leave P6 marked IN PROGRESS after all three screens landed', () => {
    // Strip fenced code blocks FIRST. The F43 note (round 100) QUOTES the stale
    // heading inside a fence to show what it replaced, and the guard then failed
    // against its own documentation of the bug. Quoted history is not a live claim --
    // the header extractor above makes the same allowance, and this is the second
    // place in this file it has come up.
    const body = read(PLAN).replace(/```[\s\S]*?```/g, '');
    const heading = (body.match(/^### P6 — i18n sweep[^\n]*/m) ?? [''])[0];
    expect(heading, 'the P6 section heading moved or changed shape — extraction has drifted')
      .not.toBe('');
    expect(
      heading,
      'the P6 heading still says IN PROGRESS, but all three screens are done (rounds 74 + 75) ' +
        '— the body says so while the title does not, which sends the next reader to redo the sweep',
    ).not.toMatch(/IN PROGRESS/i);
    // And the claim is load-bearing: the i18n gate backing it must still be clean.
    // A heading that says DONE over a dirty lint is the opposite failure.
    expect(heading, 'the P6 heading must name its screens, not just a status word')
      .toMatch(/i18n sweep \(fixes F10\)/);
  });

  /**
   * A key the plan records as WIRED must not also be described as needing wiring.
   *
   * ⚠️ Added round 104. The plan carried `sound_chime is the remaining D5 key and needs
   * a POS sound path` at `:2843` — for ~30 rounds after D5 was closed — while the
   * register at `:4700` recorded it `WIRED ea8f8a007`. The paragraph was DUPLICATED, and
   * one copy was updated while the other was not.
   *
   * This is F43's drift in its purest form: the same claim in two places, one refreshed.
   * A guard cannot generally tell which copy is authoritative — but it CAN check the
   * specific sentence that was wrong against the source, which is what this does.
   */
  it('does not call sound_chime unwired — it has been wired since round 73', () => {
    // Strip fenced blocks AND blockquotes before matching. The correction note above
    // QUOTES the stale sentence in a `>` block, and a quote is not a claim -- the same
    // allowance the header extractor and the P6 case both make. My first version stripped
    // fences only and failed against my own correction.
    const body = read(PLAN)
      .replace(/```[\s\S]*?```/g, '')
      .split('\n')
      .filter((l) => !l.startsWith('>'))
      .join('\n');
    expect(
      body,
      'the plan again says sound_chime needs a POS sound path — PosScreen.tsx:897 reads the ' +
        'setting and :713 plays the chime, so this claim is false; re-measure before restoring it',
    ).not.toMatch(/sound_chime`? is the remaining D5 key/i);

    // The load-bearing fact: the setting still has a real reader. If this ever fails, the
    // claim above would become TRUE and the guard needs revisiting rather than silencing.
    const pos = fs.readFileSync(path.join(ROOT, 'ui/src/features/sales/PosScreen.tsx'), 'utf-8');
    expect(
      pos.includes("'restaurant.sound_chime'"),
      'PosScreen no longer reads restaurant.sound_chime — D5 has reopened, and the plan needs ' +
        'a new finding rather than a quiet deletion of this guard',
    ).toBe(true);
  });

  it('the keys F1 calls wired really do have production readers', () => {
    // The load-bearing fact behind the corrected row. A key losing its last
    // reader is exactly the regression the corrected row must not hide.
    const WIRED = [
      'restaurant.auto_print_kitchen',
      'restaurant.sound_chime',
      'restaurant.customer_name',
      'restaurant.save_tab',
    ];
    const sources = collectUiSources();
    const missing = WIRED.filter((key) => {
      // The settings screen WRITES these; a reader is any OTHER production file.
      return !sources.some(
        (f) =>
          !f.rel.includes('RestaurantSettingsScreen') &&
          f.text.includes(key),
      );
    });
    expect(
      missing,
      'these keys lost their production reader — the F1 resolution note is now wrong, and the ' +
        'P1-complete claim with it: ' + missing.join(', '),
    ).toEqual([]);
  });
});