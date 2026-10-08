// ── Guard: never mirror to localStorage before the durable write resolves ──
//
// Finding F5 in todo-restaurant-pos-reliability.md was filed against two files
// and turned out to be THREE: RestaurantSettingsScreen, WorkspaceRestaurantPosSettings
// and RestaurantReceiptsScreen all wrote a client-side mirror (localStorage)
// BEFORE awaiting the DB write. A rejected save therefore left the mirror holding
// the new values while the DB kept the old ones — so the next mount rendered an
// un-persisted edit as if it had been saved.
//
// The pattern is the defect, not the file. This guard scans production source for
// a `localStorage.setItem` followed by an `await` at the same-or-shallower brace
// depth before the enclosing block closes, and asserts there are none.
//
// WHY A STATIC SCAN: the three real instances were each found by reading a file,
// one at a time, over three rounds. A behavioural test cannot see the NEXT file.
//
// THE DETECTOR IS SELF-TESTED (see the fixture cases below). A guard that always
// reports zero is worse than no guard, because it reads as proof. The fixture
// cases run the SAME detector over known-bad and known-good source and assert it
// discriminates, which is what makes the empty result on the real tree meaningful.
//
// ⚠️ A hit is not automatically a bug — two unrelated statements in one block can
// match. When this fails, read the site: if the write genuinely does not mirror a
// pending durable write, the correct response is to reorder it (the mirror is
// cheap to move) rather than to widen this guard.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Resolve against the working directory (ui/), per the convention
// errorPolicyCompliance.test.ts documents.
const SRC = path.resolve(process.cwd(), 'src');

/**
 * True when `line` closes the enclosing function body.
 *
 * ⚠️ THIS REPLACED A BRACE-DEPTH COUNTER THAT DID NOT WORK. Two earlier versions
 * counted braces and BOTH PASSED against a deliberately reintroduced bug, because
 * the mirror sits inside a `try { }` whose braces net to zero — so by the time the
 * `await` was examined the depth was back at its start value. A brace counter
 * cannot answer this question across try/catch.
 */
function closesEnclosingFunction(line: string): boolean {
  return /^\s{0,6}\}\s*[,)]/.test(line) || /^\s{0,4}\}\s*$/.test(line);
}

/**
 * True when an `await` on this line settles a durable write.
 *
 * ⚠️ FOUR VERSIONS OF THIS DETECTOR WERE WRONG BEFORE THIS ONE, and each wrong
 * version was exposed only by a kill-test, never by the self-tests I wrote
 * first. The progression is worth keeping:
 *
 *   1. brace depth — netted to zero across the mirror's own `try { }`;
 *   2. depth + transparent try/catch — still zero, same reason;
 *   3. "any await" in the function — 14 false positives, because a later
 *      `await new Promise(setTimeout)` UI delay is an await but not a write;
 *   4. "await …Scoped(/.save(" — missed this very case, because the durable
 *      calls are `tasks.push(setReceiptSettingsScoped(...))` and the only
 *      awaited line is `await Promise.all(tasks)`.
 *
 * The lesson: the awaited line alone cannot tell you what it settles. So the
 * detector recognises the two shapes the codebase actually uses to settle a
 * batch — `await Promise.all(tasks)` and a directly awaited `*Scoped(`/`.save(`
 * call — and treats a plain `await` (delays, reads) as not durable.
 *
 * STILL A HEURISTIC, and that is why a hit is a review prompt, not a verdict.
 */
function isDurableWrite(line: string): boolean {
  if (!/await\s/.test(line)) return false;
  return /await\s+Promise\.(all|allSettled)\s*\(/.test(line) || /Scoped\(|\.save\(/.test(line);
}

/**
 * Line numbers (1-based) of mirrors written BEFORE a durable write in the same
 * function body — the F5 shape. One entry per mirror RUN, not per line.
 */
export function findMirrorBeforeAwait(lines: string[]): number[] {
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i]!.includes('localStorage.setItem')) continue;
    // Only the LAST line of a consecutive mirror run is a candidate, so a
    // 14-key block reports once rather than 14 times.
    if (lines[i + 1]?.includes('localStorage.setItem')) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 80); j += 1) {
      const next = lines[j]!;
      if (closesEnclosingFunction(next)) break; // left the function
      if (isDurableWrite(next)) {
        hits.push(i + 1);
        break;
      }
    }
  }
  return hits;
}

function collectFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'dev-mock') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
}

describe('mirror-before-await guard (F5)', () => {
  // ── The detector must discriminate, or the empty result below means nothing ──
  it('flags a mirror written before a durable write (the F5 shape)', () => {
    const bad = [
      'async function save() {',
      "  localStorage.setItem('a', '1');",
      '  await setSettingsScoped(token, entries);',
      '}',
    ];
    expect(findMirrorBeforeAwait(bad)).toEqual([2]);
  });

  it('does NOT flag a mirror written after the durable write', () => {
    // The real RestaurantReceiptsScreen shape after the fix.
    const good = [
      'async function save() {',
      '  await setSettingsScoped(token, entries);',
      "  localStorage.setItem('a', '1');",
      '}',
    ];
    expect(findMirrorBeforeAwait(good)).toEqual([]);
  });

  it('does NOT flag a mirror followed only by a non-durable await', () => {
    // The false positive that broke the previous version: a UI delay is an await
    // but not a write, and must not count.
    const delay = [
      'async function save() {',
      '  await setSettingsScoped(token, entries);',
      "  localStorage.setItem('a', '1');",
      '  await new Promise((r) => setTimeout(r, 500));',
      '}',
    ];
    expect(findMirrorBeforeAwait(delay)).toEqual([]);
  });

  it('reports a multi-key mirror block once, not once per line', () => {
    const block = [
      'async function save() {',
      "  localStorage.setItem('a', '1');",
      "  localStorage.setItem('b', '2');",
      "  localStorage.setItem('c', '3');",
      '  await setSettingsScoped(token, entries);',
      '}',
    ];
    expect(findMirrorBeforeAwait(block)).toEqual([4]);
  });

  it('does NOT flag a mirror whose block closes with no durable write', () => {
    const plain = [
      'function remember() {',
      "  localStorage.setItem('a', '1');",
      '}',
      'function other() {',
      '  await setSettingsScoped(token, entries);',
      '}',
    ];
    expect(findMirrorBeforeAwait(plain)).toEqual([]);
  });

  it('scans a meaningful set of source files', () => {
    // A collector that silently found nothing would pass every case above.
    expect(collectFiles().length).toBeGreaterThan(50);
  });

  it('has no production source that mirrors to localStorage before an await', () => {
    const offenders: string[] = [];
    for (const file of collectFiles()) {
      const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
      for (const lineNo of findMirrorBeforeAwait(lines)) {
        offenders.push(`${path.relative(SRC, file)}:${lineNo}`);
      }
    }
    expect(
      offenders,
      'A localStorage mirror is written before the durable write resolves. Move it ' +
        'after the await so a rejected save cannot leave the mirror ahead of the DB.',
    ).toEqual([]);
  });
});
