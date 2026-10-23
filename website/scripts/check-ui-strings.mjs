#!/usr/bin/env node
/**
 * scripts/check-ui-strings.mjs — gate: no hardcoded English UI strings.
 *
 * The rule and its allowlist live in `src/lib/ui-strings.ts`, next to the site
 * source they scan, and `src/__tests__/ui-strings.test.ts` runs the same
 * function inside `npm test`. This wrapper is for the build: `prebuild.mjs`
 * runs it in phase 1 beside `audit-i18n.mjs`, so a literal that bypasses the
 * dictionaries stops a build instead of shipping.
 *
 * An `is:inline` script cannot import the dictionaries, so a string for one is
 * injected with `define:vars` — that is the fix for a reported literal, not an
 * allowlist entry.
 *
 * WHAT THIS FILE OWNS: the verdict is "scanned nothing" vs "scanned and found
 * nothing", and the second must never be inferred from emptiness alone:
 *
 *   1. a walk that returns no files (the scanner moved, `SRC` broke) — the rule
 *      never runs, and "no offenders" is returned having read nothing;
 *   2. no .astro file scanned — the markup text-node rule never executes, and a
 *      per-line rule then reports "skip to content" only when it is inline;
 *   3. the rule itself stopped firing on a literal it must catch.
 *
 * All three print the same clean sentence, so `--self-test` grades the verdict
 * through the injectable `scan` parameter (default: the shipped
 * `findUiStringOffenders`) and grades the rule through `findUiStringOffendersIn`
 * — the SAME function the walk calls. The normal run refuses to report OK
 * unless that self-test passes.
 *
 * Run: node --experimental-strip-types scripts/check-ui-strings.mjs [--self-test]
 */
import { join } from 'node:path';
import { findUiStringOffendersIn, scanUiStringSources } from '../src/lib/ui-strings.ts';

const SRC = join(import.meta.dirname, '..', 'src');

/**
 * An empty or blind scan is a broken gate, never a clean bill of health.
 *
 * The floors sit well BELOW the tree's real size (measured 2026-10-23: 107
 * files, 51 of them .astro) so ordinary churn never trips them, while a walk
 * that stops matching still lands far underneath.
 */
const MIN_FILES = 50;
const MIN_ASTRO_FILES = 20;

/**
 * Decide whether a walk saw a tree at all.
 *
 * `scan` is a parameter, not a direct call, so a self-test case can hand the
 * verdict a blind walk and prove the verdict refuses it. The live path passes
 * nothing and gets the shipped scanner.
 *
 * The floor is applied to the FILES THE SCAN READ, never to the findings. An
 * earlier version counted findings and would have declared "0 files, 0
 * offenders" clean on the real tree — a passing gate that had read nothing,
 * which is exactly the failure this file exists to refuse.
 */
export function checkUiStrings(scan = scanUiStringSources, root = SRC) {
  const problems = [];
  const result = scan(root) ?? {};
  const found = result.offenders ?? [];
  const files = (result.files ?? []).map((file) => String(file));

  // A finding with no file name or no literal pins nothing, and would also let
  // a broken rule look as if it had detected something.
  for (const item of found) {
    const base = String(item.file ?? '').split(/[\\/]/).pop() ?? '';
    if (!base || !String(item.value ?? '').trim()) {
      problems.push(`RULE: a finding with no file or no literal: ${JSON.stringify(item)}`);
    }
  }

  const astroFiles = files.filter((file) => file.endsWith('.astro')).length;

  if (files.length < MIN_FILES) {
    problems.push(
      `SCAN: the walk read ${files.length} file(s) under ${root}, expected at least ` +
        `${MIN_FILES} — the sources moved or the walk stopped matching, and "no offenders" ` +
        'over an empty file set is a pass over nothing',
    );
  } else if (astroFiles < MIN_ASTRO_FILES) {
    problems.push(
      `SCAN: ${astroFiles} of ${files.length} scanned files are .astro, expected at least ` +
        `${MIN_ASTRO_FILES} — the markup text-node rule only runs on .astro, so every ` +
        'sentence written between two tags is ungraded',
    );
  }

  return { ok: problems.length === 0, problems, audit: { files: files.length, astro: astroFiles } };
}

/** The finding a case expects, as `rule:value`, or `null` for "must stay quiet". */
const asPair = (item) => `${item.rule}:${String(item.value).trim()}`;

/**
 * One case table, graded against `findUiStringOffendersIn` — the rule itself.
 *
 * Each row pins ONE side. The positive rows are the ways a literal has
 * actually reached a shipped page here; the negative rows are the shapes that
 * make a scanner noisy enough that someone loosens it.
 */
const RULE_CASES = [
  // ── must fire ─────────────────────────────────────────────────────────────
  {
    name: 'a literal aria-label',
    file: 'a.tsx',
    text: 'export const A = () => <button aria-label="Search" />;',
    expect: 'attribute:Search',
  },
  {
    name: 'a literal title attribute',
    file: 'a.tsx',
    text: '<img title="Open the menu" />',
    expect: 'attribute:Open the menu',
  },
  {
    name: 'a literal written into the DOM',
    file: 'a.tsx',
    text: "el.textContent = 'Copy code to clipboard';",
    expect: 'dom-write:Copy code to clipboard',
  },
  {
    name: 'a setAttribute call',
    file: 'a.tsx',
    text: "el.setAttribute('aria-label', 'Copy code to clipboard');",
    expect: 'dom-write:Copy code to clipboard',
  },
  {
    name: 'an English sentence in the markup',
    file: 'a.astro',
    text: '<p>Page not found</p>',
    expect: 'text-node:Page not found',
  },
  {
    // The shape that shipped "Skip to content" to every /id/ page: the
    // sentence has no `>` before it on its own line, so a per-line rule misses
    // it — which is the regression `ui-strings.ts` calls out by name.
    name: 'a sentence on its own line between two tags',
    file: 'a.astro',
    text: '<a href="#main">\n  Skip to content\n</a>',
    expect: 'text-node:Skip to content',
  },
  // ── must stay quiet ───────────────────────────────────────────────────────
  {
    name: 'TypeScript between > and < is not text',
    file: 'a.tsx',
    text: 'const nodes = cond ? Array.from(document.querySelectorAll("a")) : [];',
    expect: null,
  },
  {
    name: 'a translated expression',
    file: 'a.tsx',
    text: "el.textContent = t(labels, 'docs.copyCode');",
    expect: null,
  },
  {
    name: 'a token attribute',
    file: 'a.tsx',
    text: "el.setAttribute('aria-expanded', 'true');",
    expect: null,
  },
  {
    name: 'a declared literal',
    file: 'a.tsx',
    text: '<a aria-label="Discord" />',
    expect: null,
  },
  {
    name: 'a template attribute with only holes',
    file: 'a.astro',
    text: '<div title={`${label}`}></div>',
    expect: null,
  },
  {
    // JSX prose written inline. Measured 2026-10-23: no other case reached the
    // .tsx text-node branch, so deleting that branch left --self-test green
    // (mutation R5). This row is the only one that fails when it goes away.
    name: 'an English sentence inline in JSX',
    file: 'a.tsx',
    text: 'export const B = () => <p>Page not found</p>;',
    expect: 'text-node:Page not found',
  },
  {
    // A single word is a token, not a sentence: every stopword gives the
    // text-node rule its notion of prose, so this pins that boundary from the
    // quiet side. (Prose in a COMMENT is stripped by the walk, before the rule
    // is called — no rule case can see it; see the walk cases below.)
    name: 'a single word in the markup is a token, not prose',
    file: 'a.astro',
    text: '<span>Review</span>',
    expect: null,
  },
  {
    name: 'an Astro frontmatter block',
    file: 'a.astro',
    text: "---\nimport { t } from '../i18n';\nconst x: Record<string, string> = {};\n---\n<h1>{x}</h1>",
    expect: null,
  },
  {
    name: 'an is:inline script body',
    file: 'a.astro',
    text: '<script>const label = x > y ? "a" : "b";</script>',
    expect: null,
  },
];

/** Run one rule case. Returns the mismatch message, or '' when the half matched. */
function gradeCase(item) {
  let found;
  try {
    found = findUiStringOffendersIn(item.file, item.text);
  } catch (error) {
    return `  ${item.name}: the rule threw: ${error.message}`;
  }
  const pairs = found.map(asPair);
  if (item.expect === null) {
    return found.length === 0 ? '' : `  ${item.name}: expected no finding, got ${JSON.stringify(pairs)}`;
  }
  return pairs.includes(item.expect)
    ? ''
    : `  ${item.name}: expected ${item.expect}, got ${JSON.stringify(pairs)}`;
}

/**
 * The vacuous cases: a scan that read nothing must be REFUSED.
 *
 * These grade the wrapper's verdict, not the rule — that is where "an empty
 * set agrees with every expectation" lives.
 */
function selfTest() {
  const problems = [];
  for (const item of RULE_CASES) {
    const message = gradeCase(item);
    if (message) problems.push(message);
  }

  // A walk that returns nothing — the file set is empty and must not be read
  // as "the sets agree".
  const empty = checkUiStrings(() => ({ offenders: [], files: [] }));
  if (empty.ok) problems.push('  an empty walk: the verdict reported OK over 0 files');
  if (!empty.problems.some((line) => line.startsWith('SCAN:'))) {
    problems.push(`  an empty walk: refused without a SCAN problem: ${JSON.stringify(empty.problems)}`);
  }

  // A finding with no file name: the rule fired on nothing, and counting it
  // would let a broken rule look productive.
  const nameless = checkUiStrings(() => ({
    offenders: [{ file: '', line: 1, rule: 'attribute', value: '' }],
    files: [`components/Feature${MIN_FILES}.astro`],
  }));
  if (!nameless.problems.some((line) => line.startsWith('RULE:'))) {
    problems.push(`  a nameless finding: not reported: ${JSON.stringify(nameless.problems)}`);
  }

  // A scan of a plausible shape must NOT be refused — otherwise the floors
  // would fail a good tree and the gate would be turned off.
  const healthyFiles = Array.from({ length: MIN_FILES + 5 }, (_, i) =>
    i % 2 === 0 ? `components/Feature${i}.astro` : `components/Feature${i}.tsx`,
  );
  const healthy = { offenders: [], files: healthyFiles };
  if (!checkUiStrings(() => healthy).ok) {
    problems.push(`  a healthy scan was refused: ${JSON.stringify(checkUiStrings(() => healthy).problems)}`);
  }

  // ...and the same file list with every .astro turned into .tsx must be
  // refused, or the markup rule could be dead while the count still looked
  // healthy.
  const noAstro = { offenders: [], files: healthyFiles.map((f) => f.replace('.astro', '.tsx')) };
  if (checkUiStrings(() => noAstro).ok) {
    problems.push('  a scan with no .astro files: the verdict reported OK');
  }

  // THE DEFECT THIS GATE SHIPPED WITH: a scan that read every file and found
  // nothing is CLEAN. Findings are not evidence of breadth, so the floor must
  // not read them — counting findings declared the real 107-file tree a
  // 0-file scan and failed the build.
  if (!checkUiStrings(() => healthy).audit.files) {
    problems.push('  a clean scan of a full tree: reported 0 files read');
  }

  if (problems.length) {
    console.error(`SELF-TEST WRONG (${problems.length}):`);
    for (const line of problems) console.error(line);
    return 2;
  }
  console.log(`SELF-TEST OK (${RULE_CASES.length} rule cases + 5 verdict cases, no file read)`);
  return 0;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
}

// Grade the verdict before trusting it: a detector that cannot fail prints the
// same clean sentence as a detector that found nothing.
//
// Quiet on success on purpose: without --self-test this file must print exactly
// what it printed before the self-test existed, or every log that greps the
// clean sentence starts matching twice.
{
  const quiet = console.log;
  console.log = () => {};
  let rc;
  try {
    rc = selfTest();
  } finally {
    console.log = quiet;
  }
  if (rc !== 0) {
    console.error('UI-STRING RULE WENT DEAF: not trusting the scan for src/.');
    process.exit(rc);
  }
}

const verdict = checkUiStrings();
if (!verdict.ok) {
  console.error(`UI-string scan could not grade src/: ${verdict.problems.length} problem(s)`);
  for (const line of verdict.problems) console.error(`  ${line}`);
  process.exit(1);
}

const offenders = scanUiStringSources().offenders;

if (offenders.length === 0) {
  console.log('UI strings OK — no undeclared literal UI strings in src/');
  process.exit(0);
}

console.error(`Hardcoded UI strings: ${offenders.length}\n`);
for (const item of offenders) {
  console.error(`  ${item.file}:${item.line}  [${item.rule}]  ${JSON.stringify(item.value)}`);
}
console.error(
  '\nRoute each one through the dictionaries (t(locale, …), an island labels prop, ' +
    'or define:vars for an is:inline script), or declare it in ALLOWED_LITERALS ' +
    '(src/lib/ui-strings.ts) with the reason it must stay English.',
);
process.exit(1);
