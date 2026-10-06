/**
 * CSS comment-integrity guard
 *
 * Catches one specific, silent, high-blast-radius defect: a CSS comment body that
 * contains the comment-CLOSE sequence. The parser ends the comment at that point,
 * so everything after it in the comment becomes live CSS, the parser then
 * resynchronises by dropping rules it cannot make sense of, and the page renders
 * with a stylesheet that is quietly missing rules.
 *
 * Why this needs its own guard: no existing check can see it.
 *   - No linter reads .css (AGENTS.md §5.1).
 *   - themeTokenCompliance reads FILE TEXT, so a swallowed declaration is still
 *     "present" to it and passes.
 *   - animationCompliance / noiseDitherCompliance use string-inclusion checks
 *     that their own docstrings describe as deliberately avoiding CSS parsing.
 *   - The Vitest run is green either way; only the browser's CSSOM differs.
 *
 * Measured case (2026-10-07): ui/src/app/tablet/tablet.css wrote a broken
 * selector shape INSIDE its explanatory comment. The comment closed early, and
 * the tablet shell lost .tablet-shell's height block, .tablet-tab-icon,
 * .tablet-tab-item:active, .tablet-tab-item svg, .app-content and
 * .app-content-inner from the live stylesheet. On the device the tab bar sat at
 * y=150 in a 686px viewport with 0x0 icons — while all four guard suites passed.
 *
 * The check therefore PARSES (postcss, already a dependency) and compares what a
 * real parser sees, rather than trusting the file bytes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_SRC = path.resolve(HERE, '..');

/** Every .css under ui/src, repo-relative with forward slashes. */
function collectStylesheets(dir: string, out: string[] = []): string[] {
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, dirent.name);
    if (dirent.isDirectory()) collectStylesheets(p, out);
    else if (dirent.name.endsWith('.css')) {
      out.push(path.relative(UI_SRC, p).split(path.sep).join('/'));
    }
  }
  return out;
}

/**
 * The comment-close sequence, built at runtime so THIS file never contains it
 * literally — otherwise this very docstring would trip the guard it defines.
 */
const CLOSE = '*' + '/';

/**
 * Sheets that are DELIBERATELY rule-free. Each must say so in its own docstring —
 * this list records a decision, it does not mute a finding. A sheet added here
 * without that note is a mistake this list cannot catch, so keep it short.
 */
const COMMENT_ONLY_SHEETS = new Set([
  // Its docstring: "This screen currently defines no rule of its own ... The file
  // exists so a later screen-specific rule has an obvious home, and so the
  // screenExtraction entry names it explicitly rather than silently citing a
  // sheet it does not use."
  'features/settings/screens/SyncStatusScreen.css',
]);

describe('CSS comment integrity', () => {
  const sheets = collectStylesheets(UI_SRC);

  it('collects the stylesheet population (never a vacuous pass)', () => {
    expect(sheets.length, 'no stylesheets were collected under ui/src').toBeGreaterThanOrEqual(130);
  });

  it('every stylesheet parses without throwing', () => {
    const broken: string[] = [];
    for (const rel of sheets) {
      const css = fs.readFileSync(path.join(UI_SRC, rel), 'utf-8');
      try {
        postcss.parse(css, { from: rel });
      } catch (e) {
        broken.push(`${rel}: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    expect(broken, `stylesheets failed to parse:\n  ${broken.join('\n  ')}`).toEqual([]);
  });

  it('no parsed selector contains prose, which is the comment-close signature', () => {
    // THE check that actually catches the defect, established by trying four other
    // detectors that did not:
    //   - "comment body contains a close" is circular: each comment by definition
    //     ends at the first close, so the body never contains one.
    //   - "text after a close looks like prose" false-positives on declarations
    //     that sit between two comments.
    //   - raw comment pairing mis-pairs on a /* inside the prose itself.
    // What DOES differ, measurably: when prose escapes a comment it becomes a
    // SELECTOR. Verified on the original defect — the committed tablet.css parsed
    // to one selector reading ".tablet-tab-icon`, which detached the tab-label
    // rule", and the fixed file parses to none. A real selector never contains a
    // close sequence, a backtick, or English prose.
    const offenders: string[] = [];
    for (const rel of sheets) {
      const css = fs.readFileSync(path.join(UI_SRC, rel), 'utf-8');
      const root = postcss.parse(css, { from: rel });
      root.walkRules((rule) => {
        const sel = rule.selector ?? '';
        const prose =
          sel.includes(CLOSE) ||
          sel.includes('`') ||
          /\b(which|detached|dangling)\s+[a-z]/.test(sel);
        if (prose) {
          offenders.push(
            `${rel}:${rule.source?.start?.line ?? '?'}: selector contains prose — ` +
              `a comment ended early: ${JSON.stringify(sel.slice(0, 60))}`,
          );
        }
      });
    }
    expect(
      offenders,
      'a comment closed early and its prose became a selector:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('each sheet declares at least one rule or at-rule the parser can see', () => {
    // A sheet whose rules all vanished is the failure mode above; this catches it
    // a second way, from the parsed side rather than the text side.
    //
    // Two populations are legitimately rule-free and are not failures: a sheet
    // that carries only @import/@font-face (theme/fonts.css), and a deliberately
    // empty sheet that exists to give a screen an obvious home for a future rule
    // (settings/screens/SyncStatusScreen.css says so in its own docstring). A
    // sheet with NO node at all beyond comments would be a real anomaly, but both
    // of those live cases are asserted here to stay honest rather than silently
    // skipped.
    const empty: string[] = [];
    for (const rel of sheets) {
      const css = fs.readFileSync(path.join(UI_SRC, rel), 'utf-8');
      const root = postcss.parse(css, { from: rel });
      let rules = 0;
      let atRules = 0;
      root.walkRules(() => { rules += 1; });
      root.walkAtRules(() => { atRules += 1; });
      if (rules === 0 && atRules === 0 && !COMMENT_ONLY_SHEETS.has(rel)) empty.push(rel);
    }
    expect(
      empty,
      'stylesheets parsed to no rules and no at-rules at all:\n  ' + empty.join('\n  '),
    ).toEqual([]);
  });
});
