// ── Restaurant source comments cite paths that exist (round 153) ──────
//
// Round 151 rewrote `RestaurantMenu.tsx`'s storage-tiers note and round 152 found the
// rewrite still cited `.agents/resto-pos-ui-review.md`, which had moved to
// `.agents/reviews/`. `check-dead-refs.py` polices this for DOCS, so nothing caught it — all
// three were source comments.
//
// A first version of this guard was written in round 152 and DELETED. It walked the whole
// `ui/src/__tests__` tree and fired on six citations, five of which the matcher should have
// skipped: a glob (`shared-ui/locales/*.ftl`), two templates (`<feature>/register.tsx`,
// `x/X.css`), a deliberately-deleted path (`SetupWizard.css:625`, whose absence IS the
// claim), and its own file. Four exemptions for six hits is a baseline with extra steps.
//
// The scope was the error, not the idea. Scoping to `ui/src/features` — where a comment
// names a file the reader will open — the same finder had **zero** false positives. Test
// traffic is full of synthetic shapes by construction; feature comments are not.
//
// SCOPE: `.ts`/`.tsx`/`.css` under `ui/src/features`, matching repo-relative prefixes.
// Globs and templates are rejected on shape; a reference whose surrounding line says
// `deleted`/`removed` is skipped, because the absence is the claim there.
//
// EXTENDED 2026-10-14: the backtick-only finder below is now joined by a BARE-prefix pass,
// which closes the gap round 153 recorded and then proved open by re-introducing the defect
// un-quoted. See `barePrefixed()` for the discriminator and its measured false-positive rate.
// The two passes are kept separate because they answer different questions — backticked is
// unambiguous, bare is shape-inferred — and a bug in one should not silence the other.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function findRoot(): string {
  const markers = ['.agents/reviews/resto-pos-ui-review.md', 'ui/src/features/sales/PosScreen.tsx'];
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
const FEATURES = path.join(ROOT, 'ui/src/features');

/** Repo-relative prefixes worth resolving. Anything else is prose. */
const PREFIXES = ['.agents/', 'ui/src/', 'crates/', 'docs/', 'scripts/', 'shared-ui/'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css)$/.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * Paths a feature file's comments name, as they would be written from the repo root.
 *
 * Backticks are this tree's convention for a path in a comment, so the match is anchored
 * on them: `ui/src/api/settings.ts:198-202` yields `ui/src/api/settings.ts` once the trailing
 * `:line` is stripped.
 *
 * ⚠️ A BARE PATH IS INVISIBLE. Round 153 killed this guard by re-introducing the defect with
 * the path un-quoted — `// .agents/resto-pos-ui-review.md §F5 finding` — and it PASSED. Round
 * 151's own comment had written the path bare, so that defect shape is not hypothetical, and
 * this finder will not catch it.
 *
 * Two ways to close it, neither chosen here:
 *   * match bare paths too — but then every prose mention of a path becomes a citation, and
 *     the false-positive rate that killed round 152's version returns;
 *   * lint the two files that matter — a shell `grep` for the handful of review citations.
 *
 * So this guard covers the CONVENTIONAL spelling (backticked), which is what the three
 * dangling references round 152 found used and what round 151's fix used. Recorded rather
 * than hidden, so the next reader does not test the bare case and conclude the guard works.
 */
function citedPaths(source: string): string[] {
  return [...new Set([...backticked(source), ...barePrefixed(source)])];
}

/**
 * The CONVENTIONAL spelling: a repo-relative path in backticks.
 *
 * Round 153's version, unchanged. Kept as its own pass because the two shapes differ in
 * what they can mean: a backticked token is unambiguously a citation, including one the
 * author wrote to point at a *deleted* file.
 */
function backticked(source: string): string[] {
  const found = new Set<string>();
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const raw = m[1]!;
      if (!PREFIXES.some((p) => raw.startsWith(p))) continue;
      const cleaned = raw.replace(/:\d+(-\d+)?$/, '').replace(/[.,;]$/, '');
      if (!/\.[a-z]{2,4}$/.test(cleaned)) continue;   // needs a file extension
      if (/[*<>]/.test(cleaned)) continue;            // a glob or a template
      // A deliberately-deleted reference is a claim that the file is gone.
      const context = [lines[index - 1] ?? '', line].join(' ').toLowerCase();
      if (/deleted|removed/.test(context)) continue;
      found.add(cleaned);
    }
  });
  return [...found];
}

/**
 * The BARE spelling, which round 153's docblock recorded as blind and then PROVED blind
 * by re-introducing the defect with the path un-quoted — the guard passed.
 *
 * Round 152 had tried closing this by matching every path-shaped token in a comment and
 * was killed by false positives: 568 comment lines under ui/src/features name a file
 * (measured 2026-10-14), and the overwhelming majority are a NAME, not a citation —
 * `\`components.css\``, `AnalyticsScreen.css`, `<feature>/register.tsx`.
 *
 * The discriminator that makes this pass cheap: **a bare token only counts when it carries a
 * repo-relative prefix**. `.agents/`, `ui/src/`, `crates/`, `docs/`, `scripts/`,
 * `shared-ui/` — the same PREFIXES list the backticked pass uses. A bare filename with no
 * prefix is prose about a sibling; a bare token with a prefix is the author writing a path
 * from the repo root, which is the only shape that can dangle by a file MOVING.
 *
 * Measured on the whole features tree at 2026-10-14: 81 distinct prefixed tokens, **78
 * resolve and 3 do not** — all three real dangling citations the backticked pass could not
 * see. That 3.7% miss rate is the number that makes this pass safe; it is recorded because
 * a future refactor that raises it means the shape assumption has broken.
 */
function barePrefixed(source: string): string[] {
  const found = new Set<string>();
  // COMMENT STATE, not a line-local test. A `/* */` block's continuation lines carry no marker
  // at all — `ScaleIndicator.css`'s citation sits on such a line, six lines into a block whose
  // `/*` is at the top — so a per-line `indexOf` sees prose and skips a real citation. Found by
  // running the first version of this pass: it caught 1 of the 3 known dangling paths.
  let inBlock = false;
  const allLines = source.split('\n');
  for (let li = 0; li < allLines.length; li += 1) {
    const line = allLines[li]!;
    let comment = '';
    if (inBlock) {
      const end = line.indexOf('*/');
      comment = end === -1 ? line : line.slice(0, end);
      if (end !== -1) inBlock = false;
    } else {
      const lineAt = line.indexOf('//');
      const blockAt = line.indexOf('/*');
      if (blockAt !== -1 && (lineAt === -1 || blockAt < lineAt)) {
        const end = line.indexOf('*/', blockAt + 2);
        comment = end === -1 ? line.slice(blockAt) : line.slice(blockAt, end);
        if (end === -1) inBlock = true;
      } else if (lineAt !== -1) {
        comment = line.slice(lineAt);
      }
    }
    if (!comment) continue;
    if (/[*<>]/.test(comment)) continue;   // a glob or a template
    // The SAME exemption the backticked pass carries, and it is load-bearing here rather
    // than decorative: a deleted predecessor is a claim that the file is GONE, which no
    // `existsSync` can satisfy. `ScaleIndicator.css`'s note is exactly that shape — the
    // sentence reads "since deleted (338c15c01, …)" on the line AFTER the path, so the
    // window has to look forward as well as back.
    const window = [allLines[li - 1] ?? '', line, allLines[li + 1] ?? ''].join(' ');
    if (/deleted|removed|retired/.test(window)) continue;
    for (const m of comment.matchAll(/((\.agents|ui\/src|crates|docs|scripts|shared-ui)\/[A-Za-z0-9_.\/-]+)/g)) {
      const raw = m[1]!;
      const cleaned = raw.replace(/[:\d].*$/, '').replace(/[.,;)]$/, '');
      if (!/\.[a-z]{2,4}$/.test(cleaned)) continue;   // needs a file extension
      found.add(cleaned);
    }
  }
  return [...found];
}

describe('feature-source comments cite paths that exist', () => {
  it('every repo-relative path in a feature comment resolves', () => {
    const files = walk(FEATURES);
    expect(files.length, 'no files scanned — FEATURES is wrong').toBeGreaterThan(100);
    // Round 153 measured 8 cited paths across the whole of `ui/src/features`, so a
    // threshold above that would fire on a healthy tree. This one is a floor against a
    // future refactor silently shrinking the finder to nothing.

    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const cited of citedPaths(fs.readFileSync(file, 'utf-8'))) {
        checked += 1;
        if (!fs.existsSync(path.join(ROOT, cited))) {
          missing.push(`${path.relative(ROOT, file).split(path.sep).join('/')} -> ${cited}`);
        }
      }
    }

    expect(checked, 'no cited paths found — the matcher is wrong').toBeGreaterThan(5);
    expect(
      missing.sort(),
      `feature comment(s) citing a path that does not exist. A moved file leaves every ` +
        `reference dangling, and these are read as pointers:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });
});