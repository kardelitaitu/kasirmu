/**
 * Orientation-Adaptive Walker — ADR-0001 Slice 4 (T4 enforcement), the SIXTH
 * suite in the family `docs/frontend/css-verification.md` names.
 *
 * WHAT IT GRADES. The shell owns orientation. The two declared shell sheets —
 * `ui/src/app/AppLayout.css` and `ui/src/app/tablet/tablet.css` — are the only
 * allowed orientation locations. So, in ADR-0001 Slice 4's words: an orientation
 * literal OUTSIDE the shell fails, and a declared layout no call site consumes
 * fails. The assertion is a path fence rather than a count, for exactly that
 * reason.
 *
 * WHAT IT FINDS TODAY, AND WHY THIS FILE DOES NOT SILENTLY PASS. `npm test` is
 * green at this commit, and it is green while `ui/src/features/setup/SetupWizard.css:625`
 * declares `@media (orientation: landscape) and (min-width: 48rem)`. Slice 0 of
 * ADR-0001 shipped that rule BEFORE the decision it now contradicts — the rule
 * predates the fence that forbids it. That is a fact about the installed tree, not
 * about this suite: the walker is written to the decision, so the honest reading of
 * a red here is `the decision was taken and the shipped rule has not migrated yet`,
 * which is precisely the state the ADR's own sequencing constraint describes
 * ("slice 4 must land before slice 5 is broad"). Fencing the rule instead — allow-
 * listing SetupWizard.css — would convert a real migration debt into a green that
 * no future reader could distinguish from compliance, so it is not done. The
 * penalty, stated plainly: this file FAILS until the feature owner either migrates
 * the wizard to the shell/T2 mechanism (Slices 3+5) or records a scope amendment on
 * ADR-0001. Everything the walker reads is printed below, so neither outcome is
 * discovered by surprise.
 *
 * THE PLANTED VIOLATION. Slice 4's done condition is "the suite fails on a planted
 * violation and prints its denominator", which cannot be demonstrated by grading a
 * tree that has no planted sheet in it. `violationsIn(css, relPath)` is therefore a
 * pure function and the suite proves the fence fires on synthetic sheets — one
 * orientation branch in `ui/src/features/x/X.css`, one second copy of the landscape
 * literal in a feature sheet, and the negative control: the same query inside the
 * shell is NOT a violation. That is the difference between an assertion that happens
 * to be red on today's input and an assertion that is known to be able to go red.
 *
 * READ LIKE ITS SIBLINGS: node `fs` over the working tree, no channel to any
 * revision, block comments blanked length-preservingly before any regex runs (the
 * reference rule's own header at SetupWizard.css:604-624 names the literal in prose,
 * and prose must not be graded), and the denominator printed as one console line and
 * one named test, because a test name is the only channel a reader scrolls.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative, normalize, sep } from 'path';

/* ── Shell fence ────────────────────────────────────────────── */

/**
 * The ONLY sheets allowed to declare an orientation branch. ADR-0001 Slice 4 hands
 * the fence these two paths; §T1 says the tier is `ui/src/app/tablet/*` and the
 * shell CSS, and these are the two sheets the shell stylesheet actually lives in.
 * Repo-relative and forward-slashed, because that is how a violation is printed.
 */
const SHELL_ORIENTATION_SHEETS: ReadonlySet<string> = new Set([
  'ui/src/app/AppLayout.css',
  'ui/src/app/tablet/tablet.css',
]);

const SHELL_FENCE_HUMAN = [...SHELL_ORIENTATION_SHEETS].join(' or ');

/** Recursively collect `.css` files under `dir`. */
function findCssFiles(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      findCssFiles(fullPath, results);
    } else if (entry.name.endsWith('.css')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Blank every block comment, length-preservingly: each comment byte becomes a space
 * except newlines, so every offset a match reports and every line number a violation
 * prints still addresses the same place in the real file. A comment is text CSS never
 * parses, so a header that merely DESCRIBES a landscape query must not be read as one.
 */
function stripBlockComments(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const closed = css.indexOf('*/', i + 2);
      const stop = closed === -1 ? css.length : closed + 2;
      out += css.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += css[i];
      i++;
    }
  }
  return out;
}

/* ── The two shapes Slice 4 (a) names ───────────────────────── */

/** A media query whose condition tests orientation: `@media (orientation: …)`. */
const ORIENTATION_QUERY = /@media[^{]*\(\s*orientation\s*:/gi;

/**
 * `landscape` (or `portrait`) as a QUOTED value — the second copy of the literal,
 * which is the form media queries, container queries and `matchMedia` all accept
 * (`@media screen and (orientation: "landscape")`). Unquoted `orientation: landscape`
 * is already caught by ORIENTATION_QUERY, and the unquoted keyword alone is a shape
 * every sheet legitimately writes as a token value (`--orientation: landscape`), so
 * matching it bare would fail the whole theme layer for a variable name.
 */
const ORIENTATION_LITERAL = /(['"])(?:landscape|portrait)\1/gi;

/** Repo-relative, forward-slashed, so the fence is OS-independent. */
function relPosix(from: string, to: string): string {
  return relative(from, to).split(sep).join('/');
}

function lineOf(css: string, index: number): number {
  return css.slice(0, index).split('\n').length;
}

/** `fence: true` when this sheet is one of the two the shell owns. */
export interface OrientationFinding {
  path: string;
  line: number;
  pattern: string;
  detail: string;
}

/**
 * Pure: grade one sheet's text against the fence. `relPath` is repo-relative and
 * forward-slashed; `isShellSheet` decides only whether a match is a violation, never
 * whether it is counted — both buckets are printed, so a shell that starts using its
 * tier is visible movement rather than silence.
 */
function violationsIn(
  css: string,
  relPath: string,
  isShellSheet: boolean,
): OrientationFinding[] {
  const text = stripBlockComments(css);
  const out: OrientationFinding[] = [];

  ORIENTATION_QUERY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ORIENTATION_QUERY.exec(text)) !== null) {
    if (isShellSheet) continue;
    out.push({
      path: relPath,
      line: lineOf(text, match.index),
      pattern: 'orientation-query-outside-shell',
      detail:
        `${relPath}:${lineOf(text, match.index)} - ${match[0].trim()} — an orientation branch outside the shell; ` +
        `T1 permits it only in ${SHELL_FENCE_HUMAN}`,
    });
  }

  ORIENTATION_LITERAL.lastIndex = 0;
  while ((match = ORIENTATION_LITERAL.exec(text)) !== null) {
    if (isShellSheet) continue;
    out.push({
      path: relPath,
      line: lineOf(text, match.index),
      pattern: 'orientation-literal-outside-shell',
      detail:
        `${relPath}:${lineOf(text, match.index)} - ${match[0]} — a second copy of the landscape/portrait literal; ` +
        'the shell declares it once, and a page that needs a structural change uses the T3 layout field',
    });
  }

  return out;
}

/* ── Harvest: the printed denominator ───────────────────────── */

const UI_SRC = normalize(join(__dirname, '..'));
const REPO_ROOT = normalize(join(UI_SRC, '..', '..'));

function harvestOrientationStats() {
  const cssFiles = findCssFiles(UI_SRC);
  const stats = {
    sheetsWalked: cssFiles.length,
    /** sheets inside the fence's scope (ui/src/features/**) */
    featurePathSheets: 0,
    /** shell sheets the fence hands a licence to */
    shellRegistered: 0,
    /** orientation branches found in the shell — 0 at this commit (§T1 unbuilt) */
    inShell: 0,
    /** all shapes graded, i.e. every match either pattern reached */
    graded: 0,
  };
  const findings: OrientationFinding[] = [];

  for (const filePath of cssFiles) {
    const rel = relPosix(REPO_ROOT, filePath);
    const isShellSheet = SHELL_ORIENTATION_SHEETS.has(rel);
    if (isShellSheet) stats.shellRegistered++;
    if (rel.startsWith('ui/src/features/')) stats.featurePathSheets++;

    const text = stripBlockComments(readFileSync(filePath, 'utf-8'));
    ORIENTATION_QUERY.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ORIENTATION_QUERY.exec(text)) !== null) {
      stats.graded++;
      if (isShellSheet) stats.inShell++;
    }
    ORIENTATION_LITERAL.lastIndex = 0;
    while ((m = ORIENTATION_LITERAL.exec(text)) !== null) stats.graded++;

    findings.push(...violationsIn(readFileSync(filePath, 'utf-8'), rel, isShellSheet));
  }

  return { stats, findings };
}

const { stats, findings } = harvestOrientationStats();
const byRule = (rule: string) => findings.filter((f) => f.pattern === rule).length;
const gradedPct = ((stats.graded / stats.sheetsWalked) * 100).toFixed(1);

console.log(
  `orientationAdaptiveWalker harvest: ${stats.sheetsWalked} sheets parsed; ${stats.featurePathSheets} feature sheets fenced, ` +
    `${stats.shellRegistered} shell sheets licensed; ${stats.graded} graded orientation shapes (${gradedPct}% of sheets) = ` +
    `${stats.inShell} inside the shell + ${byRule('orientation-query-outside-shell')} orientation queries outside it + ` +
    `${byRule('orientation-literal-outside-shell')} orientation literals outside it; ` +
    `${findings.length} violations (${findings.map((f) => `${f.path}:${f.line}`).join(', ')}).`,
);

describe('orientation-adaptive layout compliance (ADR-0001 Slice 4 / T4)', () => {
  let cssFiles: string[];

  beforeAll(() => {
    cssFiles = findCssFiles(UI_SRC);
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it('fails on a planted violation: an orientation branch in a feature sheet, and a repeated literal', () => {
    // The plant. These sheets do not exist — they are text handed to the same pure
    // function the real walk calls, which is why nothing is written to the tree.
    const plantedBranch =
      '.setup-container {\n  max-width: 72rem;\n}\n\n' +
      '@media (orientation: landscape) and (min-width: 48rem) {\n  .setup-container { max-width: 80rem; }\n}\n';
    const plantedLiteral =
      '@container (orientation: "portrait") {\n  .card { flex-direction: column; }\n}\n';

    const branchFindings = violationsIn(plantedBranch, 'ui/src/features/x/X.css', false);
    const literalFindings = violationsIn(plantedLiteral, 'ui/src/features/x/X.css', false);

    expect(
      branchFindings.map((f) => `${f.pattern}@${f.line}`),
      'the fence no longer fires on an orientation branch planted in a feature sheet',
    ).toEqual(['orientation-query-outside-shell@5']);
    expect(
      literalFindings.map((f) => `${f.pattern}@${f.line}`),
      'the fence no longer fires on a second copy of the orientation literal',
    ).toEqual(['orientation-literal-outside-shell@1']);

    // Negative control: the same text inside the shell is a licence, not a
    // violation — otherwise the plant would only be proving the regex matches.
    expect(violationsIn(plantedBranch, 'ui/src/app/tablet/tablet.css', true)).toEqual([]);

    // And prose is not a branch: the reference rule's own header names the literal.
    expect(
      violationsIn('/* mirrors @media (orientation: landscape) */\n.a { color: red; }\n', 'ui/src/features/x/X.css', false),
    ).toEqual([]);
  });

  it('no sheet outside the shell declares an orientation branch or repeats the orientation literal', () => {
    const msg =
      `Found ${findings.length} orientation-adaptive violations.\n` +
      'Expected:\n' +
      '  A: zero @media (orientation: …) or quoted orientation literal outside the shell — T1 licenses it only at the shell\n' +
      `  B: the only sheets licensed to hold one are ${SHELL_FENCE_HUMAN}\n` +
      '\nViolations:\n' +
      findings.map((f) => f.detail).join('\n');
    expect(findings, msg).toEqual([]);
  });

  it(`prints its own denominator: ${stats.graded} graded orientation shapes across ${stats.sheetsWalked} sheets (${gradedPct}% of sheets) = ${stats.inShell} in the shell + ${byRule('orientation-query-outside-shell')} orientation queries outside it + ${byRule('orientation-literal-outside-shell')} orientation literals outside it; ${stats.featurePathSheets} feature sheets fenced, ${stats.shellRegistered} shell sheets licensed; ${findings.length} violations`, () => {
    // The parts must sum to the whole: a walk that stopped descending cannot read
    // green behind this arithmetic.
    expect(
      stats.inShell + byRule('orientation-query-outside-shell') + byRule('orientation-literal-outside-shell'),
    ).toBe(stats.graded);
    expect(stats.sheetsWalked).toBeGreaterThan(0);
    // Both licensed sheets were actually reached, so the licence list is not a
    // stale string that matches nothing.
    expect(stats.shellRegistered).toBe(SHELL_ORIENTATION_SHEETS.size);
    // The denominator is this suite's floor. It is a floor and not a target: it is
    // lowered only when a violation is resolved, never to make the suite pass.
    expect(findings.length).toBeLessThanOrEqual(1);
  });
});
