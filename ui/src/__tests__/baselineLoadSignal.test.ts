/**
 * @vitest-environment node
 *
 * This file's entire import graph is free of browser globals (no render, no
 * `document`/`window`/`localStorage`), so it does not need a jsdom window. Vitest
 * spawns a fresh jsdom per test FILE, which measured ~0.4-0.9s each; under the node
 * environment the same files report `environment: 0ms`.
 *
 * Do not copy this directive onto a file that renders or touches browser state —
 * it will fail with "document is not defined" rather than silently degrade.
 */
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

  // ── REACHABILITY, not presence ───────────────────────────────────────────────
  //
  // Rounds 234-237 found workspace cards whose F4 guards existed as TEXT and could never RUN.
  // The presence check above passed on every one of them: `loadFailed` was declared, the banner
  // was rendered, Save was gated — and the flag was unreachable. Two causes, both real:
  //
  //   WorkspaceRestaurantPosSettings  the once-per-session latch was set BEFORE the read, so
  //                                   StrictMode's cleanup discarded the only outcome that
  //                                   could set the flag (fixed round 235);
  //   WorkspaceKdsSettings            the card never received `sessionToken`, so its guard
  //                                   compared `undefined === undefined` on the FIRST run and
  //                                   returned before reading at all (fixed round 237).
  //
  // Both were invisible to a text scan. These cases are the cheapest form of the property that
  // would have caught them.

  it('a load-failure flag is SET somewhere, not merely declared', () => {
    const offenders: string[] = [];
    for (const file of filesSeedingBaseline()) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      const text = fs.readFileSync(file, 'utf-8');
      if (!/\b(loadFailed|hasPartialError)\b/.test(text)) continue; // the case above reports this
      // `useState(false)` is a declaration, not an assignment, so require the call form.
      // Two legitimate forms, and the distinction matters:
      //   `loadFailed`      — the card OWNS the flag, so something must set it true;
      //   `hasPartialError` — the card CONSUMES the context's signal, and cannot set it.
      // Requiring an assignment for the second would be wrong: the earlier presence case is the
      // whole cheque for a consumer, because the context owns both the flag and its setter.
      // THREE legitimate forms, and the distinction matters:
      //   `setLoadFailed(true)`  — the card OWNS the flag, so something must set it;
      //   `hasPartialError`      — the card CONSUMES the settings context's signal;
      //   `hw.loadFailed`        — the card CONSUMES a hook's signal (`useTerminalHardware`).
      // Requiring an assignment for the last two would be wrong: their owner supplies both the
      // flag and its setter, so the presence case above is the whole cheque. Discovering this by
      // running the case is the point — a checker demanding one shape reports its own shape,
      // not the property.
      const ownsFlag = /setLoadFailed\s*\(\s*true\s*\)/.test(text);
      const consumesContextFlag = /useSettings\(\)/.test(text) && /hasPartialError/.test(text);
      const consumesHookFlag = /\bhw\.loadFailed\b/.test(text);
      if (!ownsFlag && !consumesContextFlag && !consumesHookFlag) offenders.push(rel);
    }
    expect(
      offenders,
      'This file declares a load-failure flag but never SETS it true, so the flag cannot ' +
        'report anything — the F4 guard exists as text and cannot fire. Wire the failure path ' +
        'to set it (see WorkspaceKdsSettings/WorkspaceRestaurantPosSettings, rounds 234-237).',
    ).toEqual([]);
  });

  // Files that set a latch before their read, and why each is not (yet) changed here.
  //
  // An entry MUST name a concrete reason and a next step. Like EXEMPT above, this list is
  // designed to fail when it goes STALE: an entry whose site no longer matches is reported,
  // so a fixed file cannot stay listed and a listed file cannot be forgotten.
  const LATCH_ALLOW: Array<{ site: string; reason: string }> = [
    {
      site: 'features/locations/nodeTopologyEditorRestoreState.ts:23',
      reason:
        'outside the restaurant-POS surface; the restore seed is synchronous state, not an ' +
        'async read, so no StrictMode cleanup can discard it. Needs a separate audit.',
    },
    {
      site: 'features/locations/NodeTopologyEditor.tsx:1608',
      reason:
        'outside the restaurant-POS surface. `autoFitKeyRef` latches a synchronous key, same ' +
        'qualification as above.',
    },
    {
      site: 'features/restaurant/RestaurantMenu.tsx:391',
      reason:
        'IN the restaurant surface and NOT yet audited. `menuStateUserIdRef` latches a userId ' +
        'rather than a sessionToken; whether an async read follows before the outcome lands is ' +
        'unestablished. The next round should settle it the way rounds 234-238 settled the ' +
        'workspace cards: measure, then fix or exempt with evidence.',
    },
  ];

  it('a once-per-session latch is not set before its own read', () => {
    // The round-235 shape: `ref.current = token` directly after the guard comparing it, with
    // the read BELOW — so the run that reads is the run whose cleanup discards its outcome.
    const offenders: string[] = [];
    for (const file of collectFiles()) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      const srcLines = fs.readFileSync(file, 'utf-8').split('\n');
      for (let i = 0; i < srcLines.length - 1; i++) {
        const guard =
          /if\s*\([^)]*?([A-Za-z_$][\w$]*)\.current\s*===\s*[A-Za-z_$][\w$]*[^)]*\)\s*return/.exec(
            srcLines[i]!,
          );
        if (!guard) continue;
        const ref = guard[1]!;
        const assign = new RegExp(ref + '\\.current\\s*=\\s*');
        if (!assign.test(srcLines[i + 1] ?? '')) continue;
        const site = rel + ':' + (i + 2);
        if (LATCH_ALLOW.some((a) => a.site === site)) continue;
        offenders.push(site);
      }
    }
    expect(
      offenders,
      'A once-per-session latch is set on the line after its own guard, i.e. BEFORE the read ' +
        'it guards. Under React StrictMode the cleanup then discards the read that runs and the ' +
        'failure path is unreachable (round 235). Set the latch where the outcome settles.',
    ).toEqual([]);
  });

  it('has no STALE latch exemption: a listed site that no longer matches must be removed', () => {
    const stale: string[] = [];
    for (const entry of LATCH_ALLOW) {
      const [file, lineNo] = entry.site.split(':') as [string, string];
      const full = path.join(SRC, file.split('/').join(path.sep));
      if (!fs.existsSync(full)) { stale.push(entry.site + ' (file no longer exists)'); continue; }
      const srcLines = fs.readFileSync(full, 'utf-8').split('\n');
      const n = Number(lineNo) - 1;
      // The stored site is the ASSIGNMENT line: detection pushes `i + 2` for a 0-based guard
      // index i, so the guard is the line ABOVE the one recorded.
      const guard = srcLines[n - 1] ?? '';
      const assign = srcLines[n] ?? '';
      if (!/return/.test(guard) || !/\.current\s*=\s*/.test(assign)) {
        stale.push(entry.site + ' (no longer a pre-read latch)');
      }
    }
    expect(
      stale,
      'A latch exemption is stale — the condition it recorded no longer holds, so the entry ' +
        'is suppressing a site that no longer exists. Delete it (round 237-238 pattern).',
    ).toEqual([]);
  });
});