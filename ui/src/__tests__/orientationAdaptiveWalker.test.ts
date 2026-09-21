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
 * THE SECOND HALF, AND WHY IT IS A SEPARATE WALK. Slice 4's sentence has a second
 * clause — "a declared layout no call site consumes fails" — and it grades a different
 * artifact: the `layout` field of a `PageRegistration`, which
 * `ui/src/features/<feature>/register.tsx` may set and the two shells consume
 * (`ui/src/app/AppShell.tsx`, `ui/src/app/tablet/TabletAppShell.tsx`, both via the
 * `renderPageLayout` helper). No CSS walk can see it, so it is graded by
 * `layoutDeclarationsIn` + `unconsumedLayouts` below: every distinct value a
 * registration declares must be consumed by a call site in BOTH shells, or the
 * registration is structural intent nobody implements.
 *
 * TODAY IT REPORTS ZERO. No page sets `layout` at this commit, so the population is
 * empty — the exact shape that lets a scan read green without ever having opened a
 * file. The harvest therefore proves it did the work (`registryFiles` and
 * `pagesDeclared` are asserted non-zero, and both shell helpers must be located) and
 * prints its denominator, so "0 declarations" reads as "N registerPage calls, none of
 * them declaring a layout" rather than as silence. The plant feeds the same pure
 * checker a declared value no shell consumes and proves it fires; the negative control
 * feeds it the three contract values against the real shells and proves it does not
 * fire on everything.
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

/* ── Slice 4, second clause: a declared layout no call site consumes ─────────
 *
 * The registry field is reviewable DATA (ADR-0001 T3): a page says what it
 * structurally needs, and the shell is the one place that reads it. That only
 * holds if both ends exist, so this half asserts the two ends meet — every
 * distinct value a registration declares must be consumed by a call site in BOTH
 * shells. A registration naming a layout nothing implements is structural intent
 * with no implementer, which is what the clause forbids.
 *
 * WHY THE HARVEST IS TEXT, NOT AN IMPORT. Importing `ui/src/features/<feature>/register.tsx`
 * would execute every feature module's side effects to read a literal field, and
 * the file this suite reads for its other half is CSS — so the walk stays on
 * `fs`+regex like its siblings. The consequence is deliberate: the plant below
 * proves the parser fires on a registration, and the negative control proves the
 * consumer scan finds the real shells, so a green cannot come from a regex that
 * matches nothing.
 */

/** The three values the registry's `layout` field accepts (page-registry/index.ts). */
const CONTRACT_LAYOUTS: readonly string[] = ['fluid', 'landscape-locked', 'custom'];

/**
 * The two shells that consume a registration's declared layout, each with the
 * marker its own `renderPageLayout` renders. Both must consume every declared
 * value: one shell implementing a value and the other silently ignoring it is the
 * same defect, one surface wide. The markers are what the shell's CSS keys off, so
 * they are the observable proof the branch is wired to something.
 */
const LAYOUT_CONSUMER_SHELLS: readonly {
  path: string;
  /** Literal marker strings this shell must render for a consumed layout. */
  markers: readonly string[];
}[] = [
  { path: 'ui/src/app/AppShell.tsx', markers: ['data-layout="landscape-locked"', 'data-layout="custom"'] },
  {
    path: 'ui/src/app/tablet/TabletAppShell.tsx',
    markers: ['data-layout="landscape-locked"', 'data-layout="custom"'],
  },
];

/** Repo-relative paths of the registry files the layout half grades. */
const REGISTER_GLOB_DIR = normalize(join(UI_SRC, 'features'));

/** Every `register.tsx` under `ui/src/features`, repo-relative POSIX. */
function findRegisterFiles(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      findRegisterFiles(fullPath, results);
    } else if (entry.name === 'register.tsx') {
      results.push(fullPath);
    }
  }
  return results;
}

/** A layout declared by one registration, as found in a registry file. */
export interface LayoutDeclaration {
  /** Repo-relative, forward-slashed — how a violation is printed. */
  path: string;
  line: number;
  /** The route the registration names, when the text names one. */
  route: string;
  layout: string;
}

/**
 * Pure: every `registerPage({ … layout: '<value>' … })` in one registry file's
 * text. The regex is anchored on the `layout:` KEY so a bare `'custom'` elsewhere
 * in the file is not a declaration, and it is bounded to a literal string so an
 * expression (`layout: someVar`) is reported as the value it literally writes
 * rather than silently skipped — an unparseable declaration must be visible, not
 * absent. Block comments are blanked first, so the header prose in this very suite
 * and in the registry cannot be read as a declaration.
 */
function layoutDeclarationsIn(src: string, relPath: string): LayoutDeclaration[] {
  const text = stripBlockComments(src);
  const out: LayoutDeclaration[] = [];
  const decl = /layout\s*:\s*(['`])([^'`]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = decl.exec(text)) !== null) {
    const before = text.slice(0, match.index);
    // The route is the nearest `route: '…'` BEFORE this declaration — the same
    // registration object, since each registerPage( block carries its own route.
    const routeAt = before.lastIndexOf("route: '");
    const route =
      routeAt >= 0 ? (before.slice(routeAt).match(/^route: '([^']+)'/) ?? [])[1] ?? '?' : '?';
    out.push({ path: relPath, line: lineOf(text, match.index), route, layout: match[2]! });
  }
  return out;
}

/** One shell's consumption of one layout value, or the reason it is missing. */
interface ConsumptionCheck {
  shell: string;
  layout: string;
  consumed: boolean;
  detail: string;
}

/**
 * Pure: is `layout` consumed by the shell at `shellPath`? Consumed means the
 * shell's `renderPageLayout` branches on that exact literal AND renders that
 * branch's marker, so the declared value reaches the DOM the shell's CSS keys off
 * instead of being read and dropped. `'fluid'` is the default the registry
 * documents as the ABSENCE of the field, so it is consumed by the fall-through
 * branch: every consumer must still have one (a helper with no return path would
 * drop the page entirely).
 */
function consumptionOf(shellText: string, shellPath: string, layout: string): ConsumptionCheck {
  const branches = new RegExp(`layout\\s*===\\s*'${layout}'`).test(shellText);
  const markers = LAYOUT_CONSUMER_SHELLS.find((s) => s.path === shellPath)?.markers ?? [];
  const hasMarker = markers.some((m) => shellText.includes(m));
  const hasFallthrough = /return page;/.test(shellText);

  if (layout === 'fluid') {
    return {
      shell: shellPath,
      layout,
      consumed: hasFallthrough,
      detail: hasFallthrough
        ? `${shellPath} — 'fluid' is the fall-through branch ('return page'), so a fluid page renders as-is`
        : `${shellPath} has no 'return page' fall-through, so a 'fluid' page would not render`,
    };
  }
  const consumed = branches && hasMarker;
  return {
    shell: shellPath,
    layout,
    consumed,
    detail: consumed
      ? `${shellPath} branches on '${layout}' and renders ${markers.join(' / ')}`
      : `${shellPath} does not consume '${layout}' ` +
        `(branch: ${branches ? 'present' : 'MISSING'}, marker: ${hasMarker ? 'present' : 'MISSING'})`,
  };
}

/** Every (shell × declared layout) pair that is not consumed. */
function unconsumedLayouts(
  shells: { path: string; text: string }[],
  declared: readonly string[],
): ConsumptionCheck[] {
  const out: ConsumptionCheck[] = [];
  for (const layout of declared) {
    for (const shell of shells) {
      const check = consumptionOf(shell.text, shell.path, layout);
      if (!check.consumed) out.push(check);
    }
  }
  return out;
}

/** Read the shells once; a missing shell is a violation, not a skip. */
function readConsumerShells(): { path: string; text: string }[] {
  return LAYOUT_CONSUMER_SHELLS.map((s) => ({
    path: s.path,
    text: readFileSync(join(REPO_ROOT, s.path), 'utf-8'),
  }));
}

const registryFiles = findRegisterFiles(REGISTER_GLOB_DIR)
  .map((p) => relPosix(REPO_ROOT, p))
  .sort();

/** Every registerPage call in the registry files — the harvest's own denominator. */
const pagesDeclared = registryFiles.reduce((n, rel) => {
  const text = stripBlockComments(readFileSync(join(REPO_ROOT, rel), 'utf-8'));
  return n + (text.match(/registerPage\s*\(/g) ?? []).length;
}, 0);

/** Every layout declaration, across the registry files. */
const layoutDeclarations: LayoutDeclaration[] = registryFiles.flatMap((rel) =>
  layoutDeclarationsIn(readFileSync(join(REPO_ROOT, rel), 'utf-8'), rel),
);

/** The distinct declared values — the population the consumer scan grades. */
const declaredLayouts = [...new Set(layoutDeclarations.map((d) => d.layout))].sort();

/** Declared values that are not in the registry's own contract union. */
const unknownLayouts = declaredLayouts.filter((v) => !CONTRACT_LAYOUTS.includes(v));

const consumerShells = readConsumerShells();
const unconsumed = unconsumedLayouts(consumerShells, declaredLayouts);

console.log(
  `orientationAdaptiveWalker layout harvest: ${registryFiles.length} registry files scanned, ${pagesDeclared} registerPage calls, ` +
    `${layoutDeclarations.length} declaring a layout (${declaredLayouts.length ? declaredLayouts.join(', ') : 'none'}); ` +
    `${consumerShells.length} consumer shells checked against ${CONTRACT_LAYOUTS.length} contract values; ` +
    `${unconsumed.length + unknownLayouts.length} violations` +
    `${unconsumed.length ? ' (' + unconsumed.map((c) => `${c.shell}<${c.layout}>`).join(', ') + ')' : ''}` +
    `${unknownLayouts.length ? ' (unknown values: ' + unknownLayouts.join(', ') + ')' : ''}.`,
);

describe('declared layout is consumed (ADR-0001 Slice 4 / T4, second half)', () => {
  it('fails on a planted violation: a registration declaring a layout no call site consumes', () => {
    // The plant. This registry text does not exist — it is handed to the same pure
    // parser + checker the real harvest uses, which is why nothing is written.
    const plantedRegistry = [
      "import { registerPage } from '@/registries/page-registry';",
      'registerPage({',
      "  route: 'register',",
      '  component: PosScreen,',
      "  label: 'POS Terminal',",
      "  layout: 'landscape-locked',",
      '});',
      'registerPage({',
      "  route: 'expo',",
      '  component: ExpoScreen,',
      "  label: 'Expo',",
      "  layout: 'custom',",
      '});',
      'registerPage({',
      "  route: 'reports',",
      '  component: ReportsScreen,',
      "  label: 'Reports',",
      "  layout: 'side-by-side',",
      '});',
      '',
    ].join('\n');

    const parsed = layoutDeclarationsIn(plantedRegistry, 'ui/src/features/x/register.tsx');
    expect(
      parsed.map((d) => `${d.route}=${d.layout}@${d.line}`),
      'the harvest no longer reads a layout out of a registration',
    ).toEqual([
      'register=landscape-locked@6',
      'expo=custom@12',
      'reports=side-by-side@18',
    ]);

    // END TO END: the plant's OWN parsed values, graded against the REAL shells.
    // 'landscape-locked' and 'custom' are both consumed, 'side-by-side' is not — so
    // the full chain (registry text → parser → consumer scan → violation) is proven
    // here, not just its two halves in isolation.
    const shells = readConsumerShells();
    const declaredByPlant = [...new Set(parsed.map((d) => d.layout))].sort();
    const planted = unconsumedLayouts(shells, declaredByPlant);
    expect(
      planted.map((c) => `${c.shell}<${c.layout}>`),
      'the consumer scan did not fire on the one layout value no shell consumes',
    ).toEqual(['ui/src/app/AppShell.tsx<side-by-side>', 'ui/src/app/tablet/TabletAppShell.tsx<side-by-side>']);
    expect(planted[0]!.detail).toContain('MISSING');

    // Negative control: a value BOTH shells consume is not a violation — otherwise
    // the check above would be firing on every declaration.
    expect(
      unconsumedLayouts(shells, ['landscape-locked', 'custom']),
      'the consumer scan fired on a declared layout both shells consume',
    ).toEqual([]);

    // And 'fluid', the registry's documented default (the ABSENCE of the field), is
    // consumed by the shells' fall-through branch rather than by a marker.
    expect(unconsumedLayouts(shells, ['fluid'])).toEqual([]);
    expect(consumptionOf('function renderPageLayout() { return null; }', 'ui/src/app/AppShell.tsx', 'fluid').consumed).toBe(
      false,
    );

    // And a shell stripped of its branch must fail for a value it used to consume,
    // which is the whole point: deleting the consumer is the defect, not the value.
    const gutted = [{ path: 'ui/src/app/AppShell.tsx', text: 'function renderPageLayout() { return page; }' }];
    expect(
      unconsumedLayouts(gutted, ['custom']).map((c) => `${c.shell}<${c.layout}>`),
      'the consumer scan passed a shell whose marker branch was deleted',
    ).toEqual(['ui/src/app/AppShell.tsx<custom>']);

    // Prose is not a declaration: this suite's own header and the registry's doc
    // comment describe `layout: 'custom'` in words.
    expect(
      layoutDeclarationsIn("/* a page may declare layout: 'custom' */\nconst x = 1;\n", 'ui/src/features/x/register.tsx'),
    ).toEqual([]);
  });

  it('every declared layout is consumed by both shells', () => {
    const msg =
      `Found ${unconsumed.length + unknownLayouts.length} unconsumed-layout violations.\n` +
      'Expected:\n' +
      `  A: every declared value is one of ${CONTRACT_LAYOUTS.join(' | ')} (page-registry/index.ts)\n` +
      `  B: both shells consume it — ${LAYOUT_CONSUMER_SHELLS.map((s) => s.path).join(' and ')} — ` +
      'so a page behaves the same on either surface\n' +
      '\nViolations:\n' +
      [...unconsumed.map((c) => c.detail), ...unknownLayouts.map((v) => `unknown layout value '${v}'`)].join('\n');
    expect([...unconsumed, ...unknownLayouts], msg).toEqual([]);
  });

  it(`prints its own denominator: ${registryFiles.length} registry files scanned, ${pagesDeclared} registerPage calls, ${layoutDeclarations.length} declaring a layout` +
    ` (${declaredLayouts.length ? declaredLayouts.join(', ') : 'none'}); ${consumerShells.length} consumer shells x ${CONTRACT_LAYOUTS.length} contract values checked; ` +
    `${unconsumed.length + unknownLayouts.length} violations`, () => {
    // THE EMPTY POPULATION MUST NOT BE VACUOUS. Today zero pages declare a layout,
    // so every assertion above passes on an empty list — the exact shape that lets a
    // scan read green without opening a file. These four prove the walk did the work:
    // it found the registry files, it parsed their registrations, and it read both
    // shells. Remove any one of them and this suite can go green on nothing.
    expect(registryFiles.length, 'the registry walk found no register.tsx files').toBeGreaterThan(0);
    expect(registryFiles.every((p) => p.endsWith('/register.tsx'))).toBe(true);
    expect(pagesDeclared, 'no registerPage call was parsed — the harvest read nothing').toBeGreaterThan(0);
    expect(consumerShells.length).toBe(LAYOUT_CONSUMER_SHELLS.length);
    // Both shells really carry the helper, so the consumer scan is not reading an
    // empty string and calling it consumption.
    for (const shell of consumerShells) {
      expect(shell.text, `${shell.path} has no renderPageLayout helper`).toContain('renderPageLayout');
    }
    // The denominator is printed even when it is zero — that is the difference
    // between "no page declares a layout" and "the harvest did not run". A declared
    // value is counted ONCE in the population the consumer scan grades.
    expect(new Set(declaredLayouts).size).toBe(declaredLayouts.length);
    expect(unconsumed).toEqual([]);
    expect(unknownLayouts).toEqual([]);
  });
});
