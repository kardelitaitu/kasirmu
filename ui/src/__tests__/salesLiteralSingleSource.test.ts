/**
 * @file salesLiteralSingleSource.test.ts
 * @description SINGLE SOURCE, pinned - UI literals that should have one
 * definition each and had many. Two families are pinned here; a third is
 * recorded as deliberately out of scope (last paragraph).
 *
 * What was measured at tip b2247947e / 6fc2f84ae, before anything moved:
 *
 *   1. 'eod-tag-over' and 'eod-tag-short' were each spelled INLINE, twice,
 *      through l10n.getString(...) - once for a single shift's cash-difference
 *      tag and once for the totals-row tag in
 *      ui/src/features/sales/EodReportScreen.tsx (at :154 and :187). Two keys x
 *      two sites = four inline literals, no shared constant, while the keys
 *      themselves are declared once per bundle (ui/src/locales/sales.ftl:479 and
 *      sales.id.ftl:464). Four copies of a key is how a rename lands on three.
 *
 *   2. requiredPermission on every registerWidget call in
 *      ui/src/features/sales/widgets/index.ts was a bare string literal -
 *      'reports:export' twice (at :39, :51) and 'reports:view' three times (at
 *      :73, :83, :93), five copies, no constant and no import. That file's OWN
 *      comment says declaring the token there is what lets the HOST filter the
 *      tile, which is exactly why one definition matters: a gate whose value
 *      exists in five places has five chances to disagree with its sibling.
 *
 * SHAPE CHANGE, NOT POLICY CHANGE. resolved_gate_per_tile_is_unchanged asserts
 * the wire token each tile is armed with, tile by tile, against the values
 * measured BEFORE the constants existed. Arming a tile stronger or weaker is a
 * navigation decision and fails that case, so nobody has to re-audit this
 * refactor to find out whether it changed behaviour. It did not.
 *
 * WHY A SOURCE SCAN AND NOT A RENDER. The finding is duplication in source text,
 * so the source text is what is read: no import of the module under test, no
 * page registration, no gate, no render - the same discipline as
 * eodReportExportPermissionDrift.test.ts, whose findRoot() this mirrors.
 *
 * THE FLUENT HAZARD THE SHAPE HAS TO RESPECT - read before you change it. Two
 * gates pattern-match on source text and both are real blockers: pre-commit step
 * 3 runs scripts/verify-bundle-parity.py with --include-getstring and
 * --include-dynamic-literals (does a reference name a key no bundle defines?),
 * and step 8 runs scripts/verify-ftl-orphans.py --staged-only, whose stated job
 * includes "a reference you delete must not strand a key". So the single source
 * is a plain object of STRING LITERALS inside the features tree, never a
 * computed or template-built name: the orphan gate searches the whole non-test
 * ui/src blob by substring (its UI_EXCLUDES + referenced()), so a literal on one
 * line keeps both keys referenced either way. VERIFY, DO NOT ASSUME - from the
 * repo root with nothing staged:
 *
 *     python3 scripts/verify-bundle-parity.py
 *     python3 scripts/verify-ftl-orphans.py --census
 *
 * and confirm eod-tag-over / eod-tag-short appear in NEITHER the missing-key
 * list NOR the orphan candidate list. If either gate loses sight of a key, fix
 * the shape of the constant. Do NOT delete a Fluent entry and do NOT edit a
 * script to make this file green - both "fix" the check and keep the bug.
 *
 * INVERT, DO NOT DELETE. If a literal is ever legitimately needed twice, write
 * down WHY next to it and INVERT the matching case into a known_hazard_* pin
 * that records the duplication as accepted - exactly how the drift test records
 * its route/command mismatch at its lines 28-41. Deleting a red case hides the
 * duplication that caused it. The counts below ARE the assertion (2 keys at 1
 * site each; 5 gates at 0 bare literals), so a re-duplication goes red instead
 * of being reviewed past. If a case here is red because the shape moved, that is
 * the pin working: fold the new site into the constant, do not raise the number.
 *
 * OUT OF SCOPE ON PURPOSE - 'audit:view'. The same sweep found it four times in
 * the nav table at ui/src/features/audit/register.tsx (:9, :16, :21, :30) and
 * once in component code at ui/src/features/locations/TopologyScreen.tsx:128
 * (perms.includes('audit:view')). Reported, not pinned: the comment above the
 * component use (:120-123) says the commands check the token server-side and
 * this site only decides whether to OFFER the button, so that a user without the
 * permission "is not shown a control that would fail on click". A nav table and
 * a click-guard may legitimately disagree, and folding them together belongs to
 * whoever owns audit. Nothing below asserts anything about it, so resolving it -
 * or leaving it - cannot make this file red.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Repo root, found by walking up until both anchor files exist - never anchored
 * to a checkout path, and not via import.meta.url: under this suite's jsdom
 * environment that URL is not a 'file:' scheme, so fileURLToPath rejects it.
 */
function findRoot(): string {
  const markers = [
    'ui/src/features/sales/EodReportScreen.tsx',
    'ui/src/features/sales/widgets/index.ts',
  ];
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
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const EOD_SCREEN = 'ui/src/features/sales/EodReportScreen.tsx';
const WIDGETS = 'ui/src/features/sales/widgets/index.ts';
const EN_BUNDLE = 'ui/src/locales/sales.ftl';
const ID_BUNDLE = 'ui/src/locales/sales.id.ftl';

/**
 * Every production UI source file, over the SAME universe the FTL orphan gate
 * walks (every ui/src .ts / .tsx file except __tests__, dev-mock and the bundles,
 * own UI_EXCLUDES). Counting a wider set here would disagree with the blocker for
 * the wrong reason: a test file names keys to prove a render, the dev-mock
 * fabricates a session, and the .ftl files are the declarations themselves.
 */
function productionSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      if (rel.includes('__tests__') || rel.includes('dev-mock') || rel.includes('/locales/')) continue;
      out.push(rel);
    }
  };
  walk(path.join(ROOT, 'ui', 'src'));
  return out.sort();
}

/** Every line outside tests where a key is spelled as a quoted string literal. */
function literalSites(key: string): { file: string; line: number; text: string }[] {
  const needle = new RegExp("['\"]" + key.replace(/-/g, '\\-') + "['\"]");
  const hits: { file: string; line: number; text: string }[] = [];
  for (const rel of productionSources()) {
    read(rel)
      .split('\n')
      .forEach((text, i) => {
        if (needle.test(text)) hits.push({ file: rel, line: i + 1, text: text.trim() });
      });
  }
  return hits;
}

/**
 * The members of an "export const NAME = { field: 'value', ... }" block, parsed
 * back out of the source. The pin checks the wire VALUES, not merely that some
 * name was used - a constant holding the wrong string would satisfy a
 * shape-only assertion and still be the bug.
 */
function constantValues(src: string, name: string): Record<string, string> {
  const decl = new RegExp('export const ' + name + '\\b[^=]*=\\s*\\{').exec(src);
  if (!decl) throw new Error('exported constant ' + name + ' is no longer declared - the single source moved');
  const open = decl.index + decl[0].length - 1;
  const end = src.indexOf('}', open);
  const block = src.slice(open, end < 0 ? src.length : end);
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)) {
    out[m[1] ?? ''] = m[2] ?? '';
  }
  return out;
}

/** One entry per "registerWidget({ ... })" call: its id and its raw permission expression. */
function widgetGates(src: string): { id: string; raw: string; bare: boolean }[] {
  const calls = src.match(/registerWidget\(\{[\s\S]*?\n {2}\}\);/g) ?? [];
  return calls.map((call) => {
    const id = /id:\s*['"]([^'"]+)['"]/.exec(call)?.[1];
    const raw = (/requiredPermission:\s*([^,\n]+)/.exec(call)?.[1] ?? '').trim();
    return { id: id ?? '<no id>', raw, bare: /^['"]/.test(raw) };
  });
}

describe('EOD cash-difference tag keys have one source', () => {
  it('each eod tag key literal appears at exactly one non-test source site', () => {
    for (const key of ['eod-tag-over', 'eod-tag-short']) {
      const sites = literalSites(key);
      expect(
        sites.map((s) => s.file + ':' + s.line),
        "'" + key + "' is spelled at " + sites.length + ' site(s). The single source is the EOD_TAG_KEYS ' +
          'object in ' + EOD_SCREEN + ' and nothing else. INVERT, DO NOT DELETE - see the file header.',
      ).toHaveLength(1);
      expect(sites[0]?.file, "'" + key + "' moved out of the sales feature - re-run both Fluent gates").toBe(EOD_SCREEN);
    }
  });

  it('the one site is a plain string literal in the exported constant, not a getString call', () => {
    const screen = read(EOD_SCREEN);
    // Whichever line holds it, a getString naming the key inline IS the
    // duplication, so a count alone could be satisfied by moving the literal to
    // a second call site. Both halves are asserted.
    expect(/getString\(\s*['"]eod-tag-/.test(screen), 'a getString site still spells a tag key inline').toBe(false);
    const consts = constantValues(screen, 'EOD_TAG_KEYS');
    expect(Object.keys(consts).sort()).toEqual(['over', 'short']);
    expect(consts).toEqual({ over: 'eod-tag-over', short: 'eod-tag-short' });
  });

  it('both tag sites read the constant, and both bundles still declare both keys', () => {
    const screen = read(EOD_SCREEN);
    const uses = screen.match(/getString\(\s*EOD_TAG_KEYS\.\w+\s*\)/g) ?? [];
    // 4, by construction: the shape being replaced was 2 keys x 2 render sites =
    // 4 inline literals, so the constant must be read 4 times - once per former
    // copy - across the two ternaries (per-shift tag and totals-row tag).
    expect(uses, 'the per-shift tag and the totals-row tag must both resolve through EOD_TAG_KEYS').toHaveLength(4);
    expect(uses.filter((u) => /\.over\b/.test(u))).toHaveLength(2);
    expect(uses.filter((u) => /\.short\b/.test(u))).toHaveLength(2);
    // The mirror of the orphan hazard: a constant naming a key no bundle
    // defines renders a raw identifier to the user AND strands the real entry.
    for (const bundle of [EN_BUNDLE, ID_BUNDLE]) {
      const src = read(bundle);
      for (const key of ['eod-tag-over', 'eod-tag-short']) {
        expect(src, key + ' is gone from ' + bundle + ' - no test here may cause a Fluent entry to be deleted').toContain(
          key + ' =',
        );
      }
    }
  });
});

describe('sales widget permission gates have one source', () => {
  const EXPECTED: Record<string, string> = {
    'daily-total': 'reports:export',
    'sales-by-hour': 'reports:export',
    'revenue-line-chart': 'reports:view',
    'category-pie-chart': 'reports:view',
    'hourly-heatmap': 'reports:view',
  };

  it('no registerWidget call spells requiredPermission as a bare literal', () => {
    const src = read(WIDGETS);
    const gates = widgetGates(src);
    expect(gates.length, 'the sales feature no longer registers five widgets - re-measure this pin').toBe(5);
    // A sixth gate declared outside a registerWidget block is still a second
    // source of truth, so the field is counted globally as well as per call.
    const total = (src.match(/requiredPermission\s*:/g) ?? []).length;
    expect(total, 'requiredPermission appears ' + total + ' times in ' + WIDGETS + ', not 5').toBe(5);
    const bare = gates.filter((g) => g.bare);
    expect(
      bare.map((g) => g.id + ' -> ' + g.raw),
      'every requiredPermission must resolve through SALES_WIDGET_PERMISSIONS; a bare literal is the ' +
        'duplication this pin exists to prevent. INVERT, DO NOT DELETE - see the file header.',
    ).toEqual([]);
  });

  it('all five resolve through ONE exported constant holding both wire tokens', () => {
    const src = read(WIDGETS);
    const owners = [...new Set(widgetGates(src).map((g) => /^([A-Z][A-Z0-9_]*)\./.exec(g.raw)?.[1] ?? '<bare>'))];
    expect(owners, 'five gates naming more than one source is still five sources').toEqual(['SALES_WIDGET_PERMISSIONS']);
    expect(constantValues(src, 'SALES_WIDGET_PERMISSIONS')).toEqual({
      reportsExport: 'reports:export',
      reportsView: 'reports:view',
    });
  });

  it('resolved_gate_per_tile_is_unchanged - the refactor armed nothing new', () => {
    const src = read(WIDGETS);
    const consts = constantValues(src, 'SALES_WIDGET_PERMISSIONS');
    const resolved: Record<string, string> = {};
    for (const g of widgetGates(src)) {
      const member = /^[A-Z][A-Z0-9_]*\.(\w+)$/.exec(g.raw)?.[1];
      // A bare literal resolves to itself, so reverting to inline strings fails
      // the case above rather than this one: this case is only about the VALUE.
      const value = member ? consts[member] : g.raw.replace(/^['"]|['"]$/g, '');
      expect(value, g.id + ' resolves to nothing - the gate member no longer exists in the constant').toBeTruthy();
      resolved[g.id] = value ?? '';
    }
    expect(resolved).toEqual(EXPECTED);
  });
});
