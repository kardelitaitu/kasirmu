/**
 * Popup Background Compliance
 *
 * Every popup, dropdown, tooltip, modal, popover, menu, dialog, toast,
 * and floating surface container MUST have a visible background. A missing
 * or transparent background makes text unreadable against page content.
 *
 * This test auto-discovers surfaces by CSS class naming patterns and
 * verifies each one has a `background` or `background-color` declaration
 * that is NOT `transparent`, `none`, or `inherit`.
 *
 * Rules:
 *   - Only checks the ROOT container class (not children like -head, -body, -icon)
 *   - Excludes overlays (purposefully translucent dimmers)
 *   - Excludes pseudo-elements, state modifiers (:hover, :focus, --exiting)
 *   - Excludes buttons/inputs inside popups (they have their own styling)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, relative, join, sep } from 'path';

const UI_SRC = resolve(__dirname, '..');

/* ── Root container patterns (these need backgrounds) ───────────── */
const POPUP_ROOT = /(?:^|[\s,.])(?:popup|dropdown|tooltip|modal|popover|menu|dialog|toast|picker)(?:$|[\s{,:])/i;

/* ── Exclude: overlays, child elements, state modifiers ─────────── */
const IS_OVERLAY = /overlay/i;
const IS_CHILD = /(?:head|header|body|content|footer|close|icon|title|label|badge|arrow|pointer|item|entry|row|meta|summary|error|backdrop)(?:$|-)/i;
const IS_STATE = /(?:hover|focus|active|disabled|open|closed|exiting|entering|visible|hidden|selected|checked)/i;
const IS_PSEUDO = /::/;

/* ── Background values that indicate missing/transparent bg ─────── */
const NO_BG = /^(transparent|none|inherit|initial|unset)$/i;
const TRANSLUCENT_TOKEN = /var\(--color-bg-overlay\)/;

/* ── Collect all CSS files ──────────────────────────────────────── */
function collectCssFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      files.push(...collectCssFiles(full));
    } else if (entry.endsWith('.css') && !entry.endsWith('.test.css')) {
      files.push(full);
    }
  }
  return files;
}

/* ── Blank out comments WITHOUT moving anything ─────────────────── */
/**
 * Comments must not reach the selector or body text, but deleting them moves
 * every later byte and so turns a line number into a fiction: the arithmetic
 * below counts newlines, and a multi-line comment swallows one newline per line
 * it has. Replacing each comment with spaces of the same length keeps the masked
 * text the same LENGTH as the file, so a position in it IS a position in the
 * file. The address a finding reports is a file address by construction, not
 * because a per-comment offset was added back correctly.
 */
function maskComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/* ── Extract CSS rules (selector + body + line) ─────────────────── */
interface CssRule {
  selector: string;
  body: string;
  line: number;
}

function extractRules(css: string, stats?: { atBlocks: string[]; nestedRules: string[] }): CssRule[] {
  // Masked, never deleted (see maskComments): rule.line is a file address.
  const clean = maskComments(css);
  const rules: CssRule[] = [];
  let i = 0;
  while (i < clean.length) {
    const braceStart = clean.indexOf('{', i);
    if (braceStart === -1) break;
    const selector = clean.slice(i, braceStart).trim();
    // Skip @media, @keyframes, @supports, etc. — only check top-level rules
    if (selector.startsWith('@')) {
      // Skip past the entire @-block (including nested rules)
      let depth = 1;
      let pos = braceStart + 1;
      while (pos < clean.length && depth > 0) {
        if (clean[pos] === '{') { if (depth === 1) stats?.nestedRules.push(selector.trim().slice(0, 60)); depth++; }
        else if (clean[pos] === '}') depth--;
        pos++;
      }
      stats?.atBlocks.push(selector.trim().slice(0, 60));
      i = pos;
      continue;
    }
    let depth = 1;
    let pos = braceStart + 1;
    while (pos < clean.length && depth > 0) {
      if (clean[pos] === '{') depth++;
      else if (clean[pos] === '}') depth--;
      pos++;
    }
    if (depth === 0) {
      const body = clean.slice(braceStart + 1, pos - 1);
      const line = clean.slice(0, braceStart).split('\n').length;
      rules.push({ selector, body, line });
    }
    i = pos;
  }
  return rules;
}

/* ── Pull background declaration ────────────────────────────────── */
function getBackground(body: string): string | null {
  const bgColor = body.match(/(?:^|;)\s*background-color\s*:\s*([^;]+)/);
  if (bgColor) return bgColor[1]!.trim();
  const bg = body.match(/(?:^|;)\s*background\s*:\s*([^;]+)/);
  if (bg) return bg[1]!.trim();
  return null;
}

/* ── Extract the primary class name from a selector ─────────────── */
function primaryClass(selector: string): string | null {
  const m = selector.match(/\.([a-zA-Z][\w-]*)/);
  return m ? m[1]! : null;
}

/* ── Tests ──────────────────────────────────────────────────────── */

describe('popup surfaces have visible backgrounds', () => {
  const cssFiles = collectCssFiles(UI_SRC);
  const failures: string[] = [];
  const stats = { atBlocks: [] as string[], nestedRules: [] as string[], parsed: 0, pseudo: 0, notRoot: 0, boundary: 0, boundaryNoBg: 0, graded: 0 };
  // Every rule that reaches the background check, by address. The count of this
  // set is what stats.graded is; the set itself is what the graded floor needs, so
  // a rule can be seen LEAVING even when a second rule arrives to hold the number up.
  const gradedAt: string[] = [];

  for (const filePath of cssFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const rules = extractRules(content, stats);
    const relPath = relative(UI_SRC, filePath);

    for (const rule of rules) { stats.parsed++;
      // Skip pseudo-elements
      if (IS_PSEUDO.test(rule.selector)) { stats.pseudo++; continue; }

      // Must contain a popup-like class
      if (!POPUP_ROOT.test(rule.selector)) { stats.notRoot++; continue; }

      // Get the primary class — skip child/state/overlay classes
      const cls = primaryClass(rule.selector);
      if (!cls) { stats.boundary++; if (getBackground(rule.body) === null) stats.boundaryNoBg++; continue; }
      if (IS_OVERLAY.test(cls)) { stats.boundary++; if (getBackground(rule.body) === null) stats.boundaryNoBg++; continue; }
      if (IS_CHILD.test(cls)) { stats.boundary++; if (getBackground(rule.body) === null) stats.boundaryNoBg++; continue; }
      if (IS_STATE.test(cls)) { stats.boundary++; if (getBackground(rule.body) === null) stats.boundaryNoBg++; continue; }

      const bg = getBackground(rule.body); stats.graded++;
      // Identity, not address: a line number would make this baseline fail when an
      // unrelated edit above it moves the rule, which is not a rule leaving the door.
      gradedAt.push(relPath.split(sep).join('/') + ' { ' + rule.selector.trim().replace(/\s+/g, ' ').slice(0, 80));

      // No background at all
      if (bg === null) {
        failures.push(
          `${relPath}:${rule.line} — ${rule.selector}\n` +
          `  No background/background-color declaration`,
        );
        continue;
      }

      // Transparent / none / inherit
      if (NO_BG.test(bg)) {
        failures.push(
          `${relPath}:${rule.line} — ${rule.selector}\n` +
          `  Background is "${bg}" (must be visible)`,
        );
        continue;
      }

      // Translucent overlay token used on a popup container
      if (TRANSLUCENT_TOKEN.test(bg)) {
        failures.push(
          `${relPath}:${rule.line} — ${rule.selector}\n` +
          `  Uses --color-bg-overlay (${bg}) — too translucent for readable text`,
        );
      }
    }
  }

  it(`every popup container has an opaque background (graded ${stats.graded} of ${stats.parsed} top-level rules parsed across ${cssFiles.length} sheets; ${stats.nestedRules.length} rules hidden inside ${stats.atBlocks.length} at-blocks the extractor skips wholesale; ${stats.boundary} rejected by the primary-class boundary, ${stats.boundaryNoBg} of them declaring no background; ${stats.pseudo} pseudo, ${stats.notRoot} not popup-shaped)`, () => {
    expect(failures, `\n${failures.join('\n\n')}`).toEqual([]);
  });

  /* ── Address oracle: a reported line must be the file's own line ── */
  function newlinesInsideComments(css: string): number {
    let n = 0;
    let i = 0;
    for (;;) {
      const open = css.indexOf('/*', i);
      if (open === -1) break;
      const close = css.indexOf('*/', open + 2);
      if (close === -1) break;
      for (let j = open; j < close; j++) if (css[j] === '\n') n++;
      i = close + 2;
    }
    return n;
  }

  it('reports the file line a finding actually lives on, for every rule of every sheet', () => {
    // The mechanism, on a fixture: a rule sitting behind a multi-line comment
    // must be addressed by the file's own line count. `.toast` opens on line 4
    // lands them on 1 and 5 — inside an unrelated rule's body.
    const fixture = [
      '/* one',
      '   two',
      '   three */',
      '.toast {',
      '  /* four',
      '     five */',
      '  color: var(--color-fg);',
      '}',
      '.popup {',
      '  background: var(--color-bg-surface);',
      '}',
    ].join('\n');
    expect(extractRules(fixture).map((r) => `${r.selector}:${r.line}`)).toEqual(['.toast:4', '.popup:9']);

    // The claim, on the tree — every rule any finding could report, in every
    // sheet, not only where a measurement happened to look.
    const misaddressed: string[] = [];
    let checked = 0;
    let behindComments = 0;
    for (const filePath of cssFiles) {
      const content = readFileSync(filePath, 'utf-8');
      const fileLines = content.split('\n');
      if (newlinesInsideComments(content) > 0) behindComments++;
      const relPath = relative(UI_SRC, filePath);
      for (const rule of extractRules(content)) {
        checked++;
        const at = fileLines[rule.line - 1];
        if (at === undefined || !at.includes('{')) {
          misaddressed.push(relPath + ':' + rule.line + ' — ' + rule.selector.split('\n')[0] + ' (holds ' + JSON.stringify((at ?? '<past end of file>').trim().slice(0, 48)) + ')');
        }
      }
    }
    // A sweep over nothing, or over sheets whose comments never span a line, is
    // vacuous without the fix — both floors are part of the point.
    expect(checked, 'the address sweep examined no rules').toBeGreaterThan(1000);
    expect(behindComments, 'the sweep covered no sheet whose comments span lines').toBeGreaterThan(0);
    expect(misaddressed, '\n' + misaddressed.length + ' rule(s) report a line that is not the line their block opens on:\n' + misaddressed.slice(0, 15).join('\n')).toEqual([]);
  });

  /* ── Population floor + counter arithmetic: the print must be alive ─────── */
  it(`the walk itself: ${cssFiles.length} sheets opened, ${stats.parsed} top-level rules parsed, ${stats.graded} graded, ${stats.nestedRules.length} hidden inside ${stats.atBlocks.length} at-blocks skipped wholesale, ${stats.boundary} refused by the primary-class boundary (${stats.boundaryNoBg} of them carrying no background), ${stats.pseudo} pseudo, ${stats.notRoot} not popup-shaped`, () => {
    // A green on an empty walk would be the same vacuity the bare file count
    // hid, so the harvest is asserted too, not only the verdict it feeds.
// MAGNITUDE FLOORS. Each `toBeGreaterThan(0)` above is an existence check: it
// holds while the walk loses nine tenths of its population. The partition sum
// below cannot help either -- every rule leaves through exactly one door and
// increments that door's counter on the same statement that continues, so the
// sum closes for ANY extractor, including one that returns a single rule from a
// single sheet. It is a check on control flow, not on the tree. Only a floor on
// magnitude turns a silently shrinking walk red. Thresholds are set with
// headroom BELOW the measurement, never at it: a floor equal to today's value
// fails on any improvement and teaches people to delete guards instead of
// reading them. Baselines below were measured 2026-09-15 at tip `af4b27238` by
// `npx vitest run src/__tests__/popupBackgroundCompliance.test.ts --reporter=verbose`.
    const FLOORS = { sheets: 120, parsed: 5200, atBlocks: 280, nestedRules: 650 };
    expect(cssFiles.length, `sheets opened ${cssFiles.length}, floor ${FLOORS.sheets} (baseline 137) -- the walk lost stylesheets, so every other number here is about a smaller tree`).toBeGreaterThan(FLOORS.sheets);
    expect(stats.parsed, `top-level rules parsed ${stats.parsed}, floor ${FLOORS.parsed} (baseline 6078) -- the harvest shrank; check what stopped being read`).toBeGreaterThan(FLOORS.parsed);
    expect(stats.atBlocks.length, `at-blocks skipped ${stats.atBlocks.length}, floor ${FLOORS.atBlocks} (baseline 347) -- fewer containers are being abandoned wholesale`).toBeGreaterThan(FLOORS.atBlocks);
    expect(stats.nestedRules.length, `rules hidden inside at-blocks ${stats.nestedRules.length}, floor ${FLOORS.nestedRules} (baseline 816) -- content moved behind the door that skips it`).toBeGreaterThan(FLOORS.nestedRules);

    // THE GRADED DOOR. Baseline today is exactly one rule, so `graded > 0` is
    // arithmetically `graded === 1`: the moment a second rule becomes gradable it
    // stops distinguishing anything, and one rule can then leave through the graded
    // door taking its check with it while the floor never blinks. Pinning it to 1
    // would block legitimate improvement, so the floor says what it actually
    // protects: the population behind this door is bounded by the sheet and rule
    // floors around it (137 sheets, 6,078 parsed, and 816 hidden), and what must
    // never happen is a rule that used to be checked ceasing to be checked. So the
    // assertion is a SUBSET check on identity -- a new gradable rule passes, a rule
    // that leaves fails, and the size of the set is never pinned.
    // Measured at af4b27238: the only rule reaching this door today. A prefix, so
    // the rule gaining a descendant selector still matches and only a rule
    // genuinely no longer graded can fail it.
    const GRADED_BASELINE = ['frontend/themes/components.css { .toast'];
    const lostGraded = GRADED_BASELINE.filter((id) => !gradedAt.some((g) => g.startsWith(id)));
    expect(lostGraded, `rules that were graded and no longer reach the background check: ${JSON.stringify(lostGraded)} (graded set now ${stats.graded}: ${JSON.stringify(gradedAt)})`).toEqual([]);

    expect(stats.graded, `no rule reached the background check at all (graded set empty; ${stats.parsed} parsed, ${cssFiles.length} sheets)`).toBeGreaterThan(0);
    // The three reject paths must have run: on today's tree the primary-class
    // boundary itself refuses nothing (POPUP_ROOT turns selectors away first),
    // so the floor is on the reject set as a whole, never on one door.
    expect(stats.pseudo + stats.notRoot + stats.boundary, 'no selector was ever refused, so the reject counters are untested').toBeGreaterThan(0);
    // Every parsed rule leaves the walk through exactly one door, so the four
    // door counters must add up to the total that entered it. A counter that
    // cannot be falsified by arithmetic is a decoration, not a measurement.
    expect(
      stats.pseudo + stats.notRoot + stats.boundary + stats.graded,
      "the exit counters do not sum to the parsed total -- a counter is counting " +
        "something the walk does not do: " +
        stats.pseudo + " + " + stats.notRoot + " + " + stats.boundary + " + " + stats.graded +
        " != " + stats.parsed,
    ).toBe(stats.parsed);
    expect(stats.boundaryNoBg <= stats.boundary, 'a subset counter exceeded its parent set').toBe(true);
  });

});
