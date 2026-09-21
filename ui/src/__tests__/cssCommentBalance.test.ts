/**
 * CSS Comment Balance — the SEVENTH suite in the family
 * docs/frontend/css-verification.md names, and the only one that reads the
 * comments its siblings deliberately skip.
 *
 * WHAT IT GRADES. A CSS comment nests. A /* inside a comment's own PROSE is
 * parsed as a second opener, so the single closing *\/ closes only the inner
 * one: the outer comment never terminates and every rule after it is dead
 * text. The rules are still SYNTACTICALLY VALID — merely commented out — so
 * they pass every other gate in this directory by construction: the CSS
 * walkers blank comments before they run, and no linter reads .css.
 *
 * WHY IT EXISTS. The same defect shipped FOUR times on 2026-09-22, every one
 * of them a prose GLOB or a trailing comment:
 *   ui/src/features/retail/RetailPosScreen.css:3631 — prose features/retail/*.tsx
 *     swallowed ~90 lines incl. the whole customer-search panel (fixed 12a54b3d4)
 *   ui/src/features/sales/PosScreen.css:756 — a trailing unterminated comment
 *     (fixed 12a54b3d4)
 *   ui/src/app/AppLayout.css:572 — prose loads theme/*.css swallowed 9 brace
 *     blocks INCLUDING the T3 .page-rotate-prompt styles (fixed d79a48733)
 *   ui/src/app/tablet/tablet.css:361 — same glob, 4 brace blocks, same rules
 *     (fixed d79a48733)
 *
 * HOW IT READS. Node fs over the working tree, no channel to any revision,
 * exactly like its siblings. For each sheet the text is walked as a state
 * machine tracking comment depth (an opener increments, a closer decrements)
 * and the sheet FAILS when the depth is non-zero at EOF. The location reported
 * is the line where the unclosed comment OPENED AT DEPTH 0 — that is the
 * actionable line, not EOF, because everything between them is what the bug
 * kills.
 *
 * THE DENOMINATOR. The harvest prints one console line and one named test
 * carrying files scanned and files holding at least one comment, so a broken
 * traversal cannot read as a green scan of nothing. Both are asserted non-zero.
 *
 * THE PLANTED CASE. unbalancedCommentsIn is a pure function, so the suite
 * proves the check FIRES on synthetic text — an unterminated opener, and the
 * exact nested-prose shape that shipped four times — plus the negative
 * control: balanced comments, including a nested pair that DOES balance, are
 * NOT flagged.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, type Dirent } from 'fs';
import { join, relative, normalize, sep } from 'path';

/** Repo-relative, forward-slashed, so a finding is OS-independent. */
function relPosix(from: string, to: string): string {
  return relative(from, to).split(sep).join('/');
}

/**
 * Directories the walk could not open. Recorded, not swallowed: a sheet nobody
 * opened is a sheet nobody checks, and a silent empty return would make the
 * denominator read SMALLER rather than red. Same door its sibling
 * themeTokenCompliance.test.ts keeps open (CSS_WALK_ABANDONED).
 */
const CSS_WALK_ABANDONED: { dir: string; reason: string }[] = [];

/** Recursively collect .css files under dir, mirroring the sibling walkers. */
function collectCssFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    CSS_WALK_ABANDONED.push({ dir, reason: e instanceof Error ? e.message : String(e) });
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectCssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

/** 1-based line of a character offset. */
function lineOf(css: string, index: number): number {
  return css.slice(0, index).split('\n').length;
}

export interface CommentBalanceFinding {
  /** Repo-relative, forward-slashed. */
  path: string;
  /** The line the unclosed comment OPENED on — the actionable location. */
  line: number;
  /** Comment depth still open at EOF (>= 1). */
  depth: number;
  detail: string;
}

/**
 * Pure: walk one sheet's text as a comment-depth state machine and report the
 * comment still open at EOF.
 *
 * An opener increments the depth; a closer decrements it. The line reported is
 * where the OUTERMOST comment opened (the first opener seen while depth was 0),
 * because a nested opener inside prose is a symptom and the outer one is the
 * comment a reader has to terminate.
 *
 * The four shipped defects were all this exact shape: depth never returns to 0.
 * A sheet with no comment at all trivially passes — the denominator test below
 * is what keeps that from being the whole story.
 */
function unbalancedCommentsIn(css: string, relPath: string): CommentBalanceFinding[] {
  let depth = 0;
  let openedAt = -1;
  let i = 0;
  const n = css.length;

  while (i < n) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      if (depth === 0) openedAt = i;
      depth++;
      i += 2;
      continue;
    }
    if (c === '*' && css[i + 1] === '/') {
      if (depth > 0) depth--;
      i += 2;
      continue;
    }
    i++;
  }

  if (depth === 0) return [];
  const line = lineOf(css, openedAt);
  return [
    {
      path: relPath,
      line,
      depth,
      detail:
        relPath + ':' + line + ' — an unterminated CSS comment (depth ' + depth + ' at EOF). ' +
        'Every rule after this line is dead text: an opener inside the comment prose is a NESTED ' +
        'opener, so the closing delimiter closes only the inner one. Terminate the outer comment.',
    },
  ];
}

/* ── Harvest: the printed denominator ───────────────────────── */

const UI_SRC = normalize(join(__dirname, '..'));
const REPO_ROOT = normalize(join(UI_SRC, '..', '..'));

function harvestCommentBalance() {
  const cssFiles = collectCssFiles(UI_SRC);
  const stats = {
    sheetsWalked: cssFiles.length,
    /** sheets holding at least one comment opener — the non-vacuity denominator. */
    sheetsWithComment: 0,
    /** total comment openers seen across the tree. */
    commentOpeners: 0,
  };
  const findings: CommentBalanceFinding[] = [];

  for (const filePath of cssFiles) {
    const text = readFileSync(filePath, 'utf-8');
    const rel = relPosix(REPO_ROOT, filePath);
    const openers = (text.match(/\/\*/g) ?? []).length;
    if (openers > 0) stats.sheetsWithComment++;
    stats.commentOpeners += openers;
    findings.push(...unbalancedCommentsIn(text, rel));
  }

  return { stats, findings };
}

const { stats, findings } = harvestCommentBalance();
const commentPct = ((stats.sheetsWithComment / stats.sheetsWalked) * 100).toFixed(1);
const DENOMINATOR =
  stats.sheetsWalked + ' stylesheets scanned under ui/src, ' +
  stats.sheetsWithComment + ' (' + commentPct + '%) containing at least one comment, ' +
  stats.commentOpeners + ' comment openers walked; ' +
  findings.length + ' unbalanced';

console.log(
  'cssCommentBalance harvest: ' + DENOMINATOR +
    (findings.length ? ' (' + findings.map((f) => f.path + ':' + f.line).join(', ') + ')' : '') + '.',
);

describe('CSS comment balance (an unterminated comment disables every following rule)', () => {
  let cssFiles: string[];

  beforeAll(() => {
    cssFiles = collectCssFiles(UI_SRC);
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it('fails on a planted violation: an unterminated comment, and the nested-prose shape that shipped four times', () => {
    // The plant. These sheets do not exist — they are text handed to the same
    // pure function the real walk calls, which is why nothing is written to the
    // tree. Same pattern as orientationAdaptiveWalker.test.ts's planted cases.
    const trailingUnterminated =
      '.a { color: red; }\n/* this comment never closes\n.b { color: blue; }\n';
    // The exact defect: a glob in the prose opens a nested comment, so the one
    // closing delimiter only closes the inner one. RetailPosScreen.css:3631,
    // AppLayout.css:572 and tablet.css:361 all had this shape.
    const nestedProseGlob =
      '/* styles shared with features/retail/*.tsx */\n.panel { display: grid; }\n';

    const trailingFindings = unbalancedCommentsIn(trailingUnterminated, 'ui/src/features/x/X.css');
    const nestedFindings = unbalancedCommentsIn(nestedProseGlob, 'ui/src/features/x/X.css');

    expect(
      trailingFindings.map((f) => f.path + ':' + f.line),
      'the check no longer fires on a comment that never closes',
    ).toEqual(['ui/src/features/x/X.css:2']);
    expect(trailingFindings[0]!.depth).toBe(1);

    // The nested case opens on line 1 and is STILL open at EOF — that is the bug.
    expect(
      nestedFindings.map((f) => f.path + ':' + f.line),
      'the check no longer fires on a prose glob inside a comment',
    ).toEqual(['ui/src/features/x/X.css:1']);
    expect(nestedFindings[0]!.depth).toBe(1);

    // Negative control: a balanced sheet is NOT flagged — otherwise the plant
    // would only be proving the state machine matches something.
    const balanced =
      '/* a comment */\n.a { color: red; }\n/* another\n   spanning lines */\n.b { color: blue; }\n';
    expect(unbalancedCommentsIn(balanced, 'ui/src/features/x/X.css')).toEqual([]);

    // And a genuinely NESTED pair that DOES balance (two openers, two closers)
    // is balanced too: the machine grades depth, not the presence of nesting.
    const balancedNested = '/* outer /* inner */ still outer */\n.a { color: red; }\n';
    expect(unbalancedCommentsIn(balancedNested, 'ui/src/features/x/X.css')).toEqual([]);

    // A sheet with no comment at all is trivially balanced — stated so a reader
    // knows the empty case is a pass by construction, not an oversight.
    expect(unbalancedCommentsIn('.a { color: red; }\n', 'ui/src/features/x/X.css')).toEqual([]);
  });

  it('no stylesheet under ui/src has an unterminated CSS comment', () => {
    const msg =
      'Found ' + findings.length + ' stylesheet(s) with an unbalanced CSS comment.\n' +
      'An unterminated comment silently disables every rule after it — the rules stay ' +
      'syntactically valid, so no other gate can see it. The line named is where the ' +
      'unclosed comment OPENED; terminate it (and check for an opener in its prose, which ' +
      'opens a NESTED comment).\n\n' +
      findings.map((f) => f.detail).join('\n');
    expect(findings, msg).toEqual([]);
  });

  it('prints its own denominator: ' + DENOMINATOR, () => {
    // The denominator is printed even when the finding is zero — that is the
    // difference between "the tree is clean" and "the walk opened nothing".
    // Same floor as themeTokenCompliance.test.ts's CSS walk (120 at the time it
    // was written, measured 140 here): losing a whole directory fails, a sheet
    // or two appearing does not.
    const cssFloor = 120;
    expect(
      stats.sheetsWalked,
      'the walk found ' + stats.sheetsWalked + ' stylesheets under ui/src, below the ' + cssFloor +
        ' it was measured at when this floor was written. Either the tree shrank dramatically ' +
        'or the walk is reaching somewhere other than what this check claims to cover.',
    ).toBeGreaterThanOrEqual(cssFloor);

    // Non-vacuity: the scan must actually be reading comments, not merely files.
    // 126 of 140 sheets carry at least one comment at this commit; a floor of 100
    // keeps the assertion meaningful without pinning a number that drifts.
    expect(
      stats.sheetsWithComment,
      'only ' + stats.sheetsWithComment + ' of ' + stats.sheetsWalked + ' stylesheets contain a ' +
        'comment — the comment walk is reading almost nothing, so a green here would be vacuous.',
    ).toBeGreaterThanOrEqual(100);
    expect(stats.commentOpeners).toBeGreaterThanOrEqual(stats.sheetsWithComment);
  });

  it('scope floor probe: an unopenable directory is recorded, not read as empty', () => {
    const before = CSS_WALK_ABANDONED.length;
    expect(collectCssFiles(join(UI_SRC, 'no-such-directory-at-all'))).toEqual([]);
    // A returned empty array and a recorded abandon are two different facts;
    // before this helper existed both looked identical to the caller.
    expect(CSS_WALK_ABANDONED.length).toBe(before + 1);
    expect(CSS_WALK_ABANDONED[before]?.dir).toContain('no-such-directory-at-all');
    expect(CSS_WALK_ABANDONED[before]?.reason).toBeTruthy();
    // Clean up the record this probe deliberately made.
    CSS_WALK_ABANDONED.pop();
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it('the walk reached every .css file, including the four that shipped the defect', () => {
    // The four known-bad sheets are named so a walk that stopped descending into
    // features/ or app/ fails loudly here rather than reading green.
    const walked = new Set(cssFiles.map((f) => relPosix(REPO_ROOT, f)));
    for (const known of [
      'ui/src/features/retail/RetailPosScreen.css',
      'ui/src/features/sales/PosScreen.css',
      'ui/src/app/AppLayout.css',
      'ui/src/app/tablet/tablet.css',
    ]) {
      expect(walked.has(known), 'the walk never opened ' + known).toBe(true);
    }
  });
});
