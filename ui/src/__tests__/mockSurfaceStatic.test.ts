// ── Hand-rolled mock surface: the twin-absent check ──────────────────
//
// Closes R36-20 follow-up #4. mockFactorySurface.test.ts covers the shared
// factories, but ShiftManagementScreen.test.tsx hand-rolled its mock and the gate
// never saw its two dead keys -- the bug was found by reading one file.
//
// The rule is deliberately NOT "a mock must define no key the module lacks".
// Measured across 413 test files: 51 dead keys, of which 49 are harmless.
// StockCountDetail.test.tsx mocks both `getStockCount` and `getStockCountScoped`
// for all seven functions; the module exports only the unscoped ones, so the
// Scoped half is dead -- but it is a hedge around the unfinished ADR #7 migration,
// the screen's real call is answered, and the test works. Enforcing "no dead keys"
// would have failed 51 working tests and taught everyone to widen the assertion
// rather than fix the two that matter.
//
// The condition that actually breaks is: **a dead key whose live counterpart is
// absent.** `createCashPayout` (not exported) with `createCashPayoutScoped` also
// missing means the mock answers a call nobody makes and leaves the call that IS
// made unmocked. That is exactly the ShiftManagementScreen shape, and exactly the
// two cases still standing after c3b95af8.
//
// Why this reads source instead of importing modules: a hand-rolled mock only
// exists inside its own file's `vi.mock` factory, so there is no runtime object to
// inspect. screenExtraction.test.ts is the established precedent for a source-
// reading integrity test in this directory.
//
// Run: cd ui && npx vitest run src/__tests__/mockSurfaceStatic.test.ts

import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const TESTS_DIR = path.resolve(process.cwd(), 'src', '__tests__');
// Rooted at `src`, not `src/api`: the specifier already carries the `api/` segment
// once `@/` is stripped. Joining onto src/api produced src/api/api/products.ts, so
// every existsSync failed, moduleExports returned null for every module, and the
// scan reported a clean zero across all 417 files -- the same false-negative shape
// as a broken regex, and the reason this file carries a liveness assertion.
const SRC_DIR = path.resolve(process.cwd(), 'src');

/** Cached export-name sets per `@/api/<mod>` specifier. */
const exportsCache = new Map<string, Set<string> | null>();

function moduleExports(spec: string): Set<string> | null {
  if (exportsCache.has(spec)) return exportsCache.get(spec)!;
  const file = path.join(SRC_DIR, spec.replace('@/', '') + '.ts');
  if (!fs.existsSync(file)) {
    exportsCache.set(spec, null);
    return null;
  }
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:const|function|async function)\s+(\w+)/g)) {
    if (m[1]) names.add(m[1]);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    if (!m[1]) continue;
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (n) names.add(n);
    }
  }
  exportsCache.set(spec, names);
  return names;
}

/** Index just past the `close` matching the opener at `open`. String-aware. */
function balance(src: string, open: number): number {
  let depth = 0;
  let str: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (c === '\\') i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') str = c;
    else if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Top-level property names of an object literal, plus whether it spreads.
 *
 * The outer braces are stripped first. Leaving them on puts the scan at depth 1
 * for the entire literal, so no top-level comma is ever seen and the function
 * returns nothing -- which is how an earlier version of this logic reported zero
 * dead keys for a file known to have two.
 */
function topLevelKeys(objLiteral: string): { keys: Set<string>; spreads: boolean } {
  const body = objLiteral.replace(/^\s*\{/, '').replace(/\}\s*$/, '');
  const keys = new Set<string>();
  let spreads = false;
  let depth = 0;
  let str: string | null = null;
  let chunk = '';
  const flush = (c: string) => {
    if (c.includes('...')) spreads = true;
    const m = c.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*[:(]/);
    if (m?.[1]) keys.add(m[1]);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (str) {
      if (c === '\\') { chunk += (body[i] ?? '') + (body[i + 1] ?? ''); i++; }
      else if (c === str) { str = null; chunk += c; }
      else chunk += c;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; chunk += c; }
    else if (c === '{' || c === '(' || c === '[') { depth++; chunk += c; }
    else if (c === '}' || c === ')' || c === ']') { depth--; chunk += c; }
    else if (c === ',' && depth === 0) { flush(chunk); chunk = ''; }
    else chunk += c;
  }
  flush(chunk);
  return { keys, spreads };
}

interface MockSite {
  file: string;
  spec: string;
  keys: Set<string>;
}

/**
 * Blank out `//` and block comments, preserving offsets and length.
 *
 * Essential, not cosmetic: the parser treats a backtick as a string opener, and a
 * `//` comment containing an odd number of them puts the scan into "inside a string"
 * for the rest of the file. Every comma is then ignored and the remaining keys
 * silently vanish. This bit the first version of this very gate -- the comment added
 * to ShiftManagementScreen.test.tsx explaining the fix is what broke parsing of it,
 * so the extractor reported 5 of 6 keys and the Python measurement it was validated
 * against shared the flaw (it only ever checked a revision with no such comment).
 *
 * Comments are replaced by spaces rather than removed so that any index computed
 * against the original text still lines up.
 */
function stripComments(src: string): string {
  const out = src.split('');
  let str: string | null = null;
  let line = false;
  let block = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const n = out[i + 1];
    if (line) {
      if (c === '\n') line = false;
      else out[i] = ' ';
      continue;
    }
    if (block) {
      if (c === '*' && n === '/') { out[i] = ' '; out[i + 1] = ' '; block = false; i++; }
      else if (c !== '\n') out[i] = ' ';
      continue;
    }
    if (str) {
      if (c === '\\') { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') str = c;
    else if (c === '/' && n === '/') { out[i] = ' '; out[i + 1] = ' '; line = true; i++; }
    else if (c === '/' && n === '*') { out[i] = ' '; out[i + 1] = ' '; block = true; i++; }
  }
  return out.join('');
}

/** Every hand-rolled `vi.mock('@/api/...', ...)` literal in `src`. */
function mockSites(file: string, rawSrc: string): MockSite[] {
  const src = stripComments(rawSrc);
  const sites: MockSite[] = [];
  for (const m of src.matchAll(/vi\.mock\(\s*'(@\/api\/[\w/]+)'/g)) {
    const spec = m[1];
    if (!spec) continue;
    const comma = src.indexOf(',', m.index! + m[0].length - 1);
    if (comma < 0) continue;
    const rest = src.slice(comma + 1);
    const arrow = rest.indexOf('=>');
    if (arrow < 0) continue;
    const after = rest.slice(arrow + 2).replace(/^\s+/, '');
    let obj = '';
    if (after.startsWith('(')) {
      const ob = after.indexOf('{');
      const oe = balance(after, ob);
      obj = oe > 0 ? after.slice(ob, oe) : '';
    } else {
      // Block body: the returned literal, if the factory returns one at all.
      const ob = after.indexOf('{');
      if (ob < 0) continue;
      const oe = balance(after, ob);
      const block = oe > 0 ? after.slice(ob, oe) : '';
      const r = block.match(/return\s*\(?\s*\{/);
      if (!r) continue; // delegates to a factory -- covered by mockFactorySurface
      const rb = block.indexOf('{', r.index!);
      const re = balance(block, rb);
      obj = re > 0 ? block.slice(rb, re) : '';
    }
    const { keys } = topLevelKeys(obj);
    if (keys.size) sites.push({ file, spec, keys });
  }
  return sites;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The live counterpart of a legacy/hedged name, if the module has one. */
function twin(name: string, real: Set<string>): string | null {
  if (name.endsWith('Scoped')) return real.has(name.slice(0, -6)) ? name.slice(0, -6) : null;
  return real.has(name + 'Scoped') ? name + 'Scoped' : null;
}

/**
 * Frozen baseline. Shrank from 2 to 1 when `searchProducts` was removed from
 * ProductLookupScreen.a11y.test.tsx -- which is the point of asserting equality rather
 * than membership: the deletion forced this edit, so the baseline cannot quietly rot
 * after the cleanup that shrinks it.
 *
 * The survivor is not an ADR #7 leftover but a rename the test never followed:
 * `pendingSyncCount` -- @/api/offline has `pendingOfflineCountScoped`, a different base
 * name entirely, so neither the name nor a Scoped twin has ever existed.
 */
const KNOWN_BROKEN: Record<string, string[]> = {
  'a11y/SettingsPage.a11y.test.tsx@/api/offline': ['pendingSyncCount'],
};

const brokenBySite = new Map<string, string[]>();
for (const file of walk(TESTS_DIR)) {
  const rel = path.relative(TESTS_DIR, file).replace(/\\/g, '/');
  let src: string;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const site of mockSites(rel, src)) {
    const real = moduleExports(site.spec);
    if (!real) continue;
    const broken = [...site.keys]
      .filter((k) => !real.has(k) && twin(k, real) === null)
      .sort();
    if (broken.length) brokenBySite.set(`${rel}${site.spec}`, broken);
  }
}

describe('hand-rolled @/api mocks define no dead key whose live twin is absent', () => {
  it('the scan itself finds work -- a scan matching nothing proves nothing', () => {
    // Every failure of this gate's own plumbing so far produced a CLEAN ZERO: a
    // non-greedy regex stopping at a nested brace, a body slice landing on an
    // `overrides = {}` default, an indentation assumption, backticks in a comment,
    // and finally a doubled `api/` path segment that made every module lookup miss
    // and the scan report nothing at all. A green "0 broken" is therefore not
    // evidence; these assertions make the machinery itself the thing under test.
    const fixed = fs.readFileSync(
      path.join(TESTS_DIR, 'ShiftManagementScreen.test.tsx'), 'utf8');
    const sites = mockSites('ShiftManagementScreen.test.tsx', fixed);
    expect(sites.length, 'the extractor found no mock in a file that has one').toBeGreaterThan(0);
    // All six keys, not five: a comment containing a backtick used to swallow the
    // rest of the file and drop the last one. A superset check, not an exact length
    // -- an earlier version asserted length 6, which made this liveness test fire on
    // any unrelated key added to the file and masked the real signal from the
    // baseline assertions.
    expect([...sites[0]!.keys]).toEqual(
      expect.arrayContaining([
        'listShiftsScoped', 'getActiveShiftScoped', 'openShiftScoped',
        'closeShiftScoped', 'getShiftReportScoped', 'createCashPayoutScoped',
      ]),
    );

    const real = moduleExports('@/api/shifts');
    expect(real, 'module lookup returned nothing -- the api path is wrong again')
      .not.toBeNull();
    expect(real!.size).toBeGreaterThan(0);

    // And the scan must actually be finding the baseline cases, not just running.
    expect(brokenBySite.size, 'scan found no broken sites, but the baseline has 2')
      .toBe(Object.keys(KNOWN_BROKEN).length);
  });

  const keys = [...brokenBySite.keys()].sort();
  const expected = [...Object.keys(KNOWN_BROKEN)].sort();

  it('the set of affected mock sites is exactly the baseline', () => {
    expect(keys).toEqual(expected);
  });

  it.each(expected)('%s', (site) => {
    expect(brokenBySite.get(site) ?? []).toEqual([...(KNOWN_BROKEN[site] ?? [])].sort());
  });
});
