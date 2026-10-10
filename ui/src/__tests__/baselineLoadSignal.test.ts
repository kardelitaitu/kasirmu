// ── Guard: every dirty-tracking baseline must consume a load-failure signal ──
//
// Companion to loadFailureSeedsBaseline.test.ts, and it exists because that one
// is not enough. F4 (todo-restaurant-pos-reliability.md) turned out to have THREE
// spellings across eight sites:
//
//   1. the catch itself seeds the baseline   -> caught by loadFailureSeedsBaseline
//   2. `.catch(() => null)` feeds a default  -> needs dataflow analysis
//   3. a shared HOOK substitutes defaults and the consumer never learns
//
// Spelling 3 is how round 8's root cause hid: `useTerminalHardware`'s catch put a
// default profile in `profile`, and five consumers seeded their baseline from it.
// `TerminalPreferencesCard` had NO load signal at all and no test caught it.
//
// ── WHAT THIS PROVES, and what it does not ──
//
// It proves each baseline-seeding file MENTIONS a load-failure signal. It does NOT
// prove the signal is wired to the Save gate — that is what each file's own test
// does. This is a floor against a file being added with no signal at all, not a
// substitute for the per-file cases.
//
// The exemption list is narrow, dated and REASONED, and it fails when stale: if an
// exempted file gains a signal the entry must be deleted, so the list cannot quietly
// outlive the condition it records. That mirrors scripts/ipc-parity-allowlist.json.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src');

/** Signals a file can use to record that a load failed. */
const LOAD_FAILURE_SIGNALS = ['loadFailed', 'hasPartialError'];

/**
 * Files that seed a baseline without a load-failure signal, and why.
 *
 * An entry MUST name the concrete reason. A stale entry — one whose file now has a
 * signal — FAILS the guard below, so this list cannot grow silently or rot.
 */
const EXEMPT: Array<{ file: string; reason: string }> = [
  // EMPTY, and that is the point: the one entry this list ever held was for
  // `RestaurantPaymentsScreen.tsx`, and the fix landed 2026-10-09. The list is
  // kept rather than deleted so the next INDIRECT spelling has somewhere honest
  // to go — with a reason, and failing when it goes stale.
];

/** Production .ts/.tsx files under src/, minus tests and dev mocks. */
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

/** Files that seed a dirty-tracking baseline. */
export function filesSeedingBaseline(): string[] {
  return collectFiles().filter((f) =>
    fs.readFileSync(f, 'utf-8').includes('originalsRef.current ='),
  );
}

describe('every dirty-tracking baseline consumes a load-failure signal (F4)', () => {
  it('scans a meaningful set of baseline-seeding files', () => {
    // A collector that silently found nothing would pass every case below.
    expect(filesSeedingBaseline().length).toBeGreaterThanOrEqual(5);
  });

  it('has no baseline-seeding file without a load-failure signal', () => {
    const exempt = new Set(EXEMPT.map((e) => e.file));
    const offenders: string[] = [];
    for (const file of filesSeedingBaseline()) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (exempt.has(rel)) continue;
      const text = fs.readFileSync(file, 'utf-8');
      if (!LOAD_FAILURE_SIGNALS.some((s) => text.includes(s))) offenders.push(rel);
    }
    expect(
      offenders,
      'This file seeds a dirty-tracking baseline but never records whether its ' +
        'load FAILED. A failed load then looks clean and Save writes defaults over ' +
        'the real values (F4). Add a loadFailed/hasPartialError flag and gate Save ' +
        'on it — or, if it genuinely has no async load, add a REASONED exemption.',
    ).toEqual([]);
  });

  it('has no STALE exemption: an exempted file that now has a signal must be removed', () => {
    const stale: string[] = [];
    for (const e of EXEMPT) {
      const full = path.join(SRC, e.file.split('/').join(path.sep));
      if (!fs.existsSync(full)) { stale.push(e.file + ' (file no longer exists)'); continue; }
      const text = fs.readFileSync(full, 'utf-8');
      if (LOAD_FAILURE_SIGNALS.some((s) => text.includes(s))) {
        stale.push(e.file + ' (now HAS a signal)');
      }
    }
    expect(
      stale,
      'An exemption is stale — the condition it recorded no longer holds. Delete ' +
        'the entry so the guard covers the file again.',
    ).toEqual([]);
  });
});