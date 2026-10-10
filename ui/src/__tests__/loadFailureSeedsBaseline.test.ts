// ── Guard: a failed load must not seed the dirty-tracking baseline (F4) ──
//
// Finding F4 in todo-restaurant-pos-reliability.md: a settings load that FAILS
// was indistinguishable from one that succeeded, because the catch seeded
// `originalsRef` (the baseline `dirty` compares against) from hardcoded defaults.
// The screen then looked clean and Save stayed enabled over values it never read —
// so the operator's next Save wrote those defaults over the real configuration.
//
// F4 was fixed BY HAND SIX TIMES across five files before this guard existed:
// RestaurantSettingsScreen, WorkspaceRestaurantPosSettings, RestaurantReceiptsScreen,
// WorkspaceKdsSettings and WorkspaceInventorySettings. Each was found by reading a
// file. A guard is the only thing that sees the seventh.
//
// ── SCOPE, stated because a partial guard read as a total one is a hazard ──
//
// This detects the DIRECT spelling: a `.catch(...)` handler whose body assigns
// `originalsRef`. That covers 3 of the 6 historical instances.
//
// It does NOT detect the INDIRECT spelling, where a `.catch(() => null)` result
// flows into a default and seeds the baseline further down — that needs dataflow
// analysis. Known indirect sites are recorded in the plan; the live one is
// RestaurantPaymentsScreen.tsx:454-455. So a green run here means "no direct
// re-introduction", NOT "F4 is impossible".
//
// THE DETECTOR IS SELF-TESTED, because two earlier guards in this repo passed
// their own self-tests while being wrong and were caught only by reintroducing
// the bug. The cases below pin the four shapes that matter.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(process.cwd(), 'src');

/** Strip quoted strings and line comments so braces inside them do not count. */
function strip(line: string): string {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""');
}

/**
 * Line numbers (1-based) of `.catch(...)` handlers that assign `originalsRef`.
 *
 * The handler's extent is found by counting parens AND braces on ONE combined
 * depth counter, starting at the `(` that opens the `.catch` call. Counting only
 * parens stops early at the empty parameter list `()`; counting only braces stops
 * at the arrow body. Together they balance exactly once, at the true end.
 */
export function findOriginalsSeededInCatch(lines: string[]): number[] {
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const at = lines[i]!.indexOf('.catch(');
    if (at === -1) continue;
    let depth = 0;
    let body = '';
    let started = false;
    let ended = false;
    for (let j = i; j < Math.min(lines.length, i + 40) && !ended; j += 1) {
      const line = strip(lines[j]!);
      const from = j === i ? at + '.catch'.length : 0;
      for (let k = from; k < line.length; k += 1) {
        const c = line[k];
        if (c === '(' || c === '{') depth += 1;
        else if (c === ')' || c === '}') depth -= 1;
        if (depth > 0) started = true;
        body += c;
        if (started && depth === 0) { ended = true; break; }
      }
      body += '\n';
    }
    if (body.includes('originalsRef')) hits.push(i + 1);
  }
  return hits;
}

/** Every production .ts/.tsx file under src/, minus tests and dev mocks. */
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

describe('a failed load must not seed the dirty baseline (F4)', () => {
  it('flags a catch that seeds originalsRef from defaults (the historical bug)', () => {
    const bad = [
      'load().catch(() => {',
      '  originalsRef.current = { ...draft };',
      '});',
    ];
    expect(findOriginalsSeededInCatch(bad)).toEqual([1]);
  });

  it('does NOT flag a catch that records the failure instead', () => {
    const good = [
      'load().catch(() => {',
      '  setLoadFailed(true);',
      '});',
    ];
    expect(findOriginalsSeededInCatch(good)).toEqual([]);
  });

  it('does NOT flag a bare null-returning catch (the indirect spelling, out of scope)', () => {
    expect(findOriginalsSeededInCatch(['load().catch(() => null)'])).toEqual([]);
  });

  it('does NOT flag an originalsRef assignment AFTER the catch closes', () => {
    const after = [
      'load().catch(() => {',
      '  setLoadFailed(true);',
      '});',
      'originalsRef.current = loaded;',
    ];
    expect(findOriginalsSeededInCatch(after)).toEqual([]);
  });

  it('scans a meaningful set of source files', () => {
    expect(collectFiles().length).toBeGreaterThan(50);
  });

  it('has no production catch that seeds originalsRef', () => {
    const offenders: string[] = [];
    for (const file of collectFiles()) {
      const text = fs.readFileSync(file, 'utf-8');
      if (!text.includes('originalsRef')) continue;
      const lines = text.split(/\r?\n/);
      for (const lineNo of findOriginalsSeededInCatch(lines)) {
        offenders.push(path.relative(SRC, file) + ':' + lineNo);
      }
    }
    expect(
      offenders,
      'A catch seeds originalsRef from defaults, so a failed load looks saved and ' +
        'Save stays enabled over values that were never read. Set a loadFailed flag ' +
        'and gate Save on it instead.',
    ).toEqual([]);
  });
});