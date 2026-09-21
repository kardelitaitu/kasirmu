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
 * WHY IT IS GREEN, AND WHAT THAT GREEN DOES NOT COVER. The tree holds exactly one
 * orientation rule: `ui/src/features/setup/SetupWizard.css:625`,
 * `@media (orientation: landscape) and (min-width: 48rem)`. That sheet is carved out
 * by name — `SLICE_0_EXEMPT_SHEETS` below — because ADR-0001 **Slice 0** shipped the
 * rule before the fence that forbids it, and because the wizard renders as its own
 * full-page surface rather than as shell chrome, so §T1's "only at the shell" has no
 * shell sheet to move it into. The exemption is ONE resolved path, matched by
 * whole-string equality: a sibling sheet in `ui/src/features/setup/` still fails, and
 * the planted-violation case below proves exactly that. The exempted matches stay in
 * the printed denominator (`exempted by ADR-0001 Slice 0`) instead of disappearing,
 * so a green here reads as "one known occupant, carved out by name" and never as
 * "no orientation rule exists". That is the whole difference between this and an
 * allow-list dropped in to silence a red.
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

/**
 * Named, single-path exemption — ADR-0001 **Slice 0**, shipped before the fence
 * exists and explicitly carved out of this decision ("Slice 0 is done and is not
 * part of this decision's work").
 *
 * WHY THE SHELL FENCE CANNOT COVER IT. Slice 0's rule is on the WIZARD, and the
 * wizard is not shell chrome: the setup wizard renders as its own full-page surface
 * (`ui/src/features/setup/`), reached before the app shell — before AppLayout's
 * rail, tab bar and insets exist. §T1 licenses an orientation query "only at the
 * shell, where the shell owns the whole viewport and there is exactly one of them
 * to keep in step"; on the wizard surface there is no shell sheet to move the rule
 * into, so relocating it to `AppLayout.css`/tablet.css would change a different
 * screen's layout. The rule is therefore correct where it is until Slice 5 migrates
 * the wizard per-feature (the ADR's own sequencing note: Slice 4 lands before
 * Slice 5 is broad) or Slice 3 gives the shell chrome an orientation tier for the
 * wizard's own container.
 *
 * SHAPE OF THE EXEMPTION. It is a single resolved path, matched by whole-string
 * equality against a repo-relative POSIX path — NOT a directory prefix, NOT a
 * glob, NOT a pattern. `SetupWizardScreen.css`, a second `SetupWizard*.css`, or any
 * new sheet in `ui/src/features/setup/` is still graded and still fails. The CSS
 * half of the fence is untouched everywhere else, and the planted-violation case
 * below plants inside `ui/src/features/` precisely so this entry cannot silently
 * widen into the fence it is carved out of.
 */
const SLICE_0_EXEMPT_SHEETS: ReadonlySet<string> = new Set([
  // ADR-0001 Slice 0 (shipped): @media (orientation: landscape) and (min-width: 48rem)
  // at SetupWizard.css:625, pinned by ui/src/__tests__/setupWizardLandscape.test.ts.
  'ui/src/features/setup/SetupWizard.css',
]);

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
  // The Slice-0 carve-out, applied HERE and nowhere else: a licensed shell sheet
  // and the one named Slice-0 path are both non-violating, but they are counted in
  // different buckets (shell vs. exempt) so the print can tell them apart — an
  // exemption that reads the same as a licence is one nobody can audit.
  if (isShellSheet || SLICE_0_EXEMPT_SHEETS.has(relPath)) return [];

  const text = stripBlockComments(css);
  const out: OrientationFinding[] = [];

  ORIENTATION_QUERY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ORIENTATION_QUERY.exec(text)) !== null) {
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
    /** sheets holding a Slice-0 exemption, and the matches that exemption covers */
    exemptSheets: 0,
    exemptedMatches: 0,
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
    const isExempt = SLICE_0_EXEMPT_SHEETS.has(rel);
    if (isExempt) stats.exemptSheets++;

    // Counted with an offset-free match() — the walk below uses these same global
    // regexes with lastIndex, and one shared object cannot serve both without the
    // last read leaping past the next sheet's first match.
    const orientationQueries = (text.match(ORIENTATION_QUERY) ?? []).length;
    const orientationLiterals = (text.match(ORIENTATION_LITERAL) ?? []).length;
    stats.graded += orientationQueries + orientationLiterals;
    if (isShellSheet) stats.inShell += orientationQueries;
    if (isExempt) stats.exemptedMatches += orientationQueries + orientationLiterals;

    findings.push(...violationsIn(readFileSync(filePath, 'utf-8'), rel, isShellSheet));
  }

  return { stats, findings };
}

const { stats, findings } = harvestOrientationStats();
const byRule = (rule: string) => findings.filter((f) => f.pattern === rule).length;
const gradedPct = ((stats.graded / stats.sheetsWalked) * 100).toFixed(1);

console.log(
  `orientationAdaptiveWalker harvest: ${stats.sheetsWalked} sheets parsed; ${stats.featurePathSheets} feature sheets fenced, ` +
    `${stats.shellRegistered} shell sheets licensed, ${stats.exemptSheets} Slice-0 exempt; ` +
    `${stats.graded} graded orientation shapes (${gradedPct}% of sheets) = ` +
    `${stats.inShell} inside the shell + ${stats.exemptedMatches} exempted by ADR-0001 Slice 0 + ` +
    `${byRule('orientation-query-outside-shell')} orientation queries outside both + ` +
    `${byRule('orientation-literal-outside-shell')} orientation literals outside both; ` +
    `${findings.length} violations` +
    `${findings.length ? ' (' + findings.map((f) => `${f.path}:${f.line}`).join(', ') + ')' : ''}.`,
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

    // The Slice-0 carve-out is one resolved path, proven in both directions: the
    // named sheet is exempt, and its neighbour in the SAME directory is not.
    expect(violationsIn(plantedBranch, 'ui/src/features/setup/SetupWizard.css', false)).toEqual([]);
    // Same text, different path: the sibling is graded exactly as the fence grades
    // any feature sheet. Compared on the VERDICT (rule + line), not the whole finding
    // — the finding's path label is the argument this call supplied, so comparing it
    // against branchFindings would assert the argument equals itself and prove nothing.
    expect(
      violationsIn(plantedBranch, 'ui/src/features/setup/SetupWizardScreen.css', false).map(
        (f) => `${f.pattern}@${f.line}`,
      ),
      'the Slice-0 exemption widened past its single named path',
    ).toEqual(branchFindings.map((f) => `${f.pattern}@${f.line}`));
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
      stats.inShell +
        stats.exemptedMatches +
        byRule('orientation-query-outside-shell') +
        byRule('orientation-literal-outside-shell'),
    ).toBe(stats.graded);
    expect(stats.sheetsWalked).toBeGreaterThan(0);
    // Both licensed sheets were actually reached, so the licence list is not a
    // stale string that matches nothing.
    expect(stats.shellRegistered).toBe(SHELL_ORIENTATION_SHEETS.size);
    // An exemption that resolves to nothing is a licence nobody can audit: the one
    // named Slice-0 sheet must exist AND still carry the rule it is exempted for.
    expect(stats.exemptSheets).toBe(SLICE_0_EXEMPT_SHEETS.size);
    expect(stats.exemptedMatches).toBeGreaterThan(0);
    expect(stats.graded).toBeGreaterThan(0);
    expect(findings.length).toBe(0);
  });
});
