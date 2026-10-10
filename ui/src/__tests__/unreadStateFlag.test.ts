// ── Guard: a control's state must actually be READ somewhere ──────
//
// Round 12 of todo-restaurant-pos-reliability.md found a class of defect while
// retiring the dead `components/UpdateBanner` twin: the SHIPPED banner's
// version-blocked branch returned before the `dismissed` check and never tested it,
// so its own Dismiss button set state that nothing read — a control that silently
// does nothing. The dead twin's copy of the same button routed through
// `useExitAnimation` and therefore worked, which is how the shipped one hid.
//
// The same scan found `_refundsLoading` in SalesHistoryScreen: set true/false
// around a read and never read, costing two re-renders per load.
//
// ── WHAT THIS PROVES, and what it does not ──
//
// ── WHAT THIS PROVES, and what it does NOT — measured, not assumed ──
//
// It proves a `useState(false)` flag that is SET is also MENTIONED somewhere else in
// the same file, ignoring comments. So a green run means "no flag is set and then
// ignored entirely".
//
// ⚠️ IT DOES NOT CATCH THE UPDATEBANNER BUG THAT MOTIVATED IT. Kill-testing proved
// that: reverting `versionBlocked && !dismissed` to `versionBlocked` leaves the guard
// GREEN, because `dismissed` IS still read — at the Priority-3 gate further down the
// same function. The defect was that one specific BRANCH returned before that read.
// Distinguishing "read somewhere" from "read on the path that matters" needs control
// flow, not a mention count.
//
// So the UpdateBanner regression is pinned by its own behavioural test in
// `appUpdateBanner.test.tsx` ('dismisses the version-blocked banner'), and this guard
// covers the cruder `_refundsLoading` shape — set, and mentioned NOWHERE. It is the
// floor, not the fix. Each component's own test is the ceiling.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src');

/**
 * Strip line and block comments. A COMMENT that names a flag is not a read of it.
 *
 * This mattered: removing `_refundsLoading` left an explanatory comment naming the
 * flag, which satisfied a naive mention-count and made the guard blind to the very
 * instance it was written for. Found by kill-testing, not by reading.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Flags declared `useState(false)` that are SET at least once but never mentioned
 * anywhere else in the file — i.e. state whose value no code path can observe.
 */
export function findUnreadStateFlags(text: string): Array<{ flag: string; setter: string }> {
  const out: Array<{ flag: string; setter: string }> = [];
  const src = stripComments(text);
  const decl = /const \[(\w+)\s*,\s*(\w+)\]\s*=\s*useState\(false\)/g;
  for (const m of src.matchAll(decl)) {
    const flag = m[1]!;
    const setter = m[2]!;
    // Only flags that are actually written are in scope; a declared-but-unused flag
    // is a different (lint-visible) problem.
    const isSet = new RegExp('\\b' + setter + '\\(').test(src);
    if (!isSet) continue;
    // Count mentions of the flag OUTSIDE its own declaration line.
    const all = [...src.matchAll(new RegExp('(?<![\\w.])' + flag + '(?![\\w])', 'g'))];
    if (all.length <= 1) out.push({ flag, setter });
  }
  return out;
}

/** Production .tsx files under src/, minus tests and dev mocks. */
function collectTsx(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'dev-mock') continue;
        walk(full);
      } else if (/\.tsx$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
}

describe('no control sets state that nothing reads', () => {
  it('flags a flag that is set but never read (the dead dismiss button)', () => {
    const bad = ['const [dismissed, setDismissed] = useState(false);', 'setDismissed(true);', 'return null;'].join('\n');
    expect(findUnreadStateFlags(bad)).toEqual([{ flag: 'dismissed', setter: 'setDismissed' }]);
  });

  it('does NOT flag a flag that is read in a condition', () => {
    const good = ['const [dismissed, setDismissed] = useState(false);', 'setDismissed(true);', 'if (dismissed) return null;'].join('\n');
    expect(findUnreadStateFlags(good)).toEqual([]);
  });

  it('does NOT flag a declared-but-never-set flag (lint owns that)', () => {
    const unset = 'const [unused, setUnused] = useState(false);';
    expect(findUnreadStateFlags(unset)).toEqual([]);
  });

  it('does NOT count a COMMENT that names the flag as a read', () => {
    const commented = [
      '// The dismissed flag was removed here.',
      'const [dismissed, setDismissed] = useState(false);',
      'setDismissed(true);',
    ].join('\n');
    expect(findUnreadStateFlags(commented)).toEqual([{ flag: 'dismissed', setter: 'setDismissed' }]);
  });

  it('scans a meaningful set of tsx files', () => {
    expect(collectTsx().length).toBeGreaterThan(50);
  });

  it('has no production flag that is set and never read', () => {
    const offenders: string[] = [];
    for (const file of collectTsx()) {
      const text = fs.readFileSync(file, 'utf-8');
      for (const { flag } of findUnreadStateFlags(text)) {
        offenders.push(path.relative(SRC, file) + ' :: ' + flag);
      }
    }
    expect(
      offenders,
      'This flag is SET but never READ, so whatever sets it — usually a button — ' +
        'changes nothing the user can see. Either read the flag in the render path, ' +
        'or delete the state and the control that sets it.',
    ).toEqual([]);
  });
});