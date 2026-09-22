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
 *   - DESCENDS into conditional at-blocks (@media, @supports, @container, @layer)
 *     and grades PER CLASS: a rule's declarations are read MERGED with every other
 *     rule that re-opens the same class in the same sheet, at any depth, because
 *     that is the cascade. `@media (prefers-reduced-motion: no-preference) { .toast
 *     { animation: … } }` does not have to restate `background:` — the class's own
 *     top-level rule already paints it — so grading such a rule in isolation fails a
 *     surface that is fully opaque. What the merge buys back and what it costs, both
 *     printed: a class whose only opaque background lives in a SIBLING rule is no
 *     longer reported as missing one.
 *   - Still skips bodies that hold no selector: a `@keyframes` step (`from`, `50%`) is
 *     a keyframe, not a selector, so it never reaches the graded door. Those blocks
 *     are counted and named in the print as what is STILL skipped, beside what the
 *     descent now reads.
 *
 * Population guards, all in the floor case below, with their baselines named in
 * each message: five LOWER bounds on what the walk read (sheets opened, rules
 * parsed, at-blocks met, blocks found inside them, rules the descent recovered),
 * EXACT MEMBERSHIP of the walked stylesheet set, a TWO-SIDED band on (parsed +
 * still skipped), a CEILING on what is still skipped, and a required-member
 * identity that names every graded rule by file and by its WHOLE selector.
 *
 * The descent moved rules from "hidden inside an at-block" into "parsed", so the
 * SUM the band holds is conserved by construction while the still-skipped
 * population fell to the keyframe steps alone. No floor was lowered to accommodate
 * that: the widened harvest has to clear the OLD floors as well, because a widening
 * whose counters only ever go up in the flattering direction is how a shrink later
 * hides inside the same numbers.
 *
 * Membership rather than a band for the sheet set: a sheet that stops existing
 * changes the set on the spot whatever the counts do, while a band wide enough to
 * survive ordinary work is wide enough to swallow the largest sheet in the tree,
 * and a floor on how many sheets were opened cannot see a rename or a swap that
 * keeps the number. A growth is not a lie, so an added sheet is reported as an
 * appearance and not failed. Refresh in one line when a sheet legitimately comes
 * or goes:
 *   cd ui && npx vitest run src/__tests__/popupBackgroundCompliance.test.ts
 * and paste the walked-now pairs the failure prints over SHEETS_BASELINE.
 *
 * What is still blind, deliberately not papered over: a band has to be wide
 * enough to survive ordinary work, so up to ~500 rules -- one sheet the size of
 * the largest in the tree -- can still leave the walk silently, and nothing here
 * counts what never reaches the graded door: every selector POPUP_ROOT turns
 * away, every block left inside a skipped at-block, and every declaration the
 * per-class merge borrows from a sibling rule of the same class -- a class that is
 * painted opaque only by another of its own rules now passes, which is the cascade
 * and also the blind spot. Tightening the band past that rots the hour a new
 * sheet lands, so the identity and the ceiling are the structural guards and the
 * band is only the net under them. And no guard here grades a commit: the walk
 * reads the working tree through fs with no channel to any revision, so every
 * number in this file is a timestamp on this checkout, not a fact about a tip.
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

/* ── Extract CSS rules (selector + body + line), DESCENDING at-blocks ── */
interface CssRule {
  selector: string;
  body: string;
  /** '' at top level; otherwise the at-block chain the rule was found inside. */
  at: string;
  line: number;
}

/** What the walker records about the containers it met. */
interface WalkStats {
  /** Every at-block header the walk met, descended into or abandoned. */
  atBlocks: string[];
  /** Every block found INSIDE an at-block — recovered rules and skipped steps alike. */
  nestedRules: string[];
  /** Rules the descent recovered INTO the parsed population. */
  descendedRules: string[];
  /** At-blocks whose body is still not read (no selectors in it). */
  skippedAtBlocks: string[];
  /** Blocks inside those abandoned bodies — keyframe steps, not selectors. */
  stillHidden: string[];
}

/**
 * At-blocks whose children ARE style rules. Every other at-block is still
 * abandoned: @keyframes holds percentage/keyword STEPS, @font-face and @property
 * hold descriptors, and none of those is a selector — parsing them as rules would
 * hand the graded door strings it cannot grade and inflate every denominator in
 * this file with non-selectors.
 */
const DESCEND = /^@(?:media|supports|container|layer)\b/i;

/** Index just past the '}' that closes the '{' at braceStart, bounded by end. */
function blockEnd(clean: string, braceStart: number, end: number): number {
  let depth = 1;
  let pos = braceStart + 1;
  while (pos < end && depth > 0) {
    if (clean[pos] === '{') depth++;
    else if (clean[pos] === '}') depth--;
    pos++;
  }
  return pos;
}

/** Walk one container of the masked stylesheet: top level, or inside an at-block. */
function walkContainer(
  clean: string, start: number, end: number, at: string, stats: WalkStats | undefined, rules: CssRule[],
): void {
  let i = start;
  while (i < end) {
    const braceStart = clean.indexOf('{', i);
    if (braceStart === -1 || braceStart >= end) return;
    const selector = clean.slice(i, braceStart).trim();
    const close = blockEnd(clean, braceStart, end);
    const bodyStart = braceStart + 1;
    const bodyEnd = close - 1;
    const label = selector.replace(/\s+/g, ' ');

    if (selector.startsWith('@')) {
      stats?.atBlocks.push(label.slice(0, 60));
      // A nested at-block is itself a block living inside an at-block.
      if (at) stats?.nestedRules.push((at + ' > ' + label).slice(0, 90));
      if (DESCEND.test(selector)) {
        walkContainer(clean, bodyStart, bodyEnd, at ? at + ' > ' + label : label, stats, rules);
      } else {
        // Count the body's blocks WITHOUT turning them into rules.
        stats?.skippedAtBlocks.push(label.slice(0, 60));
        let j = bodyStart;
        while (j < bodyEnd) {
          const inner = clean.indexOf('{', j);
          if (inner === -1 || inner >= bodyEnd) break;
          const step = clean.slice(j, inner).trim().replace(/\s+/g, ' ');
          const entry = (label + ' > ' + step).slice(0, 90);
          stats?.nestedRules.push(entry);
          stats?.stillHidden.push(entry);
          j = blockEnd(clean, inner, bodyEnd);
        }
      }
      i = close;
      continue;
    }

    const line = clean.slice(0, braceStart).split('\n').length;
    rules.push({ selector, body: clean.slice(bodyStart, bodyEnd), at, line });
    if (at) {
      const entry = (at + ' > ' + label).slice(0, 90);
      stats?.nestedRules.push(entry);
      stats?.descendedRules.push(entry);
    }
    i = close;
  }
}

function extractRules(css: string, stats?: WalkStats): CssRule[] {
  // Masked, never deleted (see maskComments): rule.line is a file address.
  const clean = maskComments(css);
  const rules: CssRule[] = [];
  walkContainer(clean, 0, clean.length, '', stats, rules);
  return rules;
}

/* ── Declarations as the cascade sees them: one bucket per class ─── */
/**
 * A selector carrying a pseudo-class or pseudo-element styles a STATE or a
 * generated box, not the base element, so it must not lend the base class a
 * background it does not have. Splitting on top-level commas matters because a
 * rule like `.modal, .popover { background: … }` declares BOTH surfaces.
 */
const PSEUDO_SELECTOR = /::|:(?:hover|active|visited|checked|disabled|open|target|focus|first-child|last-child|nth-|not\(|is\(|where\()/i;

function selectorParts(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of selector) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** class -> every declaration the sheet writes for that class in its base state. */
function declarationsByClass(rules: CssRule[]): Map<string, string> {
  const byClass = new Map<string, string>();
  for (const rule of rules) {
    for (const part of selectorParts(rule.selector)) {
      if (PSEUDO_SELECTOR.test(part)) continue;
      const cls = primaryClass(part);
      if (!cls) continue;
      const prev = byClass.get(cls);
      byClass.set(cls, prev === undefined ? rule.body : prev + '\n' + rule.body);
    }
  }
  return byClass;
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
  const stats = {
    atBlocks: [] as string[],        // every at-block met, descended into or abandoned
    nestedRules: [] as string[],     // every block found inside one, recovered or skipped
    descendedRules: [] as string[],  // rules the descent brought INTO the parsed set
    skippedAtBlocks: [] as string[], // at-blocks whose body is still not read
    stillHidden: [] as string[],     // blocks inside those bodies: @keyframes steps
    parsed: 0, pseudo: 0, notRoot: 0, boundary: 0, boundaryNoBg: 0, graded: 0,
    // Graded rules whose background came ONLY from another rule of the same class —
    // the per-class merge doing its job, and the number that says how often.
    mergedFrom: 0,
  };
  // Rules contributed by each sheet the walk opened, so the sheet-membership case
  // can say how much reading a disappeared sheet took with it.
  const perSheet = new Map<string, number>();
  // Every rule that reaches the background check, by address. The count of this
  // set is what stats.graded is; the set itself is what the graded floor needs, so
  // a rule can be seen LEAVING even when a second rule arrives to hold the number up.
  const gradedAt: string[] = [];
  // Same population, structured, for the exact-member identity: file, the whole
  // whitespace-collapsed selector, and the at-block chain the rule sits in -- never
  // a prefix of any of the three. The chain is part of the identity because the
  // descent made "@media (…) { .toast }" and ".toast" two DIFFERENT rules to grade:
  // without it, the rule the descent newly reaches is invisible to membership, the
  // baseline still says one member, and a set of two reads exactly like a set of one.
  const gradedMembers: { file: string; selector: string; at: string }[] = [];
  // The graded door is per CLASS under the merge, so two rules of one class are one
  // surface checked twice. The print carries both units or a reader cannot tell a
  // widened harvest from a doubled denominator.
  const gradedClasses = new Set<string>();

  for (const filePath of cssFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const rules = extractRules(content, stats);
    const relPath = relative(UI_SRC, filePath);
    const gradedFile = relPath.split(sep).join('/');
    perSheet.set(gradedFile, rules.length);
    // The cascade's own view of the sheet: each class's declarations, every rule
    // that writes it, from the top level and from inside every descended at-block.
    const declarations = declarationsByClass(rules);

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

      // PER CLASS: the background graded is the class's own declaration, or the one
      // the cascade hands it from a sibling rule. Read alone, an at-block rule that
      // overrides only `animation:` is a missing background that does not exist.
      const own = getBackground(rule.body);
      const bg = own ?? getBackground(declarations.get(cls) ?? rule.body);
      if (own === null && bg !== null) stats.mergedFrom++;
      stats.graded++;
      gradedClasses.add(gradedFile + ' { ' + cls);
      // Identity, not address: a line number would make this baseline fail when an
      // unrelated edit above it moves the rule, which is not a rule leaving the door.
      const gradedSelector = rule.selector.trim().replace(/\s+/g, ' ');
      gradedAt.push(gradedFile + ' { ' + gradedSelector);
      gradedMembers.push({ file: gradedFile, selector: gradedSelector, at: rule.at });

      // No background at all, for this class anywhere in the sheet
      if (bg === null) {
        failures.push(
          `${relPath}:${rule.line} — ${rule.at ? rule.at + ' > ' : ''}${rule.selector}\n` +
          `  No background/background-color declaration, nor on any other rule that` +
          ` writes .${cls} in this sheet (its own and its at-block rules were merged)`,
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

  it(`every popup container has an opaque background (graded per class: ${stats.graded} rules / ${gradedClasses.size} classes of ${stats.parsed} rules parsed across ${cssFiles.length} sheets, ${stats.mergedFrom} of them graded on a declaration merged in from a sibling rule of the same class; ${stats.descendedRules.length} rules descended into from ${stats.atBlocks.length - stats.skippedAtBlocks.length} conditional at-blocks, ${stats.stillHidden.length} still skipped inside ${stats.skippedAtBlocks.length} at-blocks whose body holds no selector (@keyframes steps); ${stats.nestedRules.length} blocks found inside at-blocks in total; ${stats.boundary} rejected by the primary-class boundary, ${stats.boundaryNoBg} of them declaring no background; ${stats.pseudo} pseudo, ${stats.notRoot} not popup-shaped)`, () => {
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
  it(`the walk itself: ${cssFiles.length} sheets opened, ${stats.parsed} rules parsed (${stats.parsed - stats.descendedRules.length} at top level + ${stats.descendedRules.length} descended from inside at-blocks), ${stats.graded} graded (${gradedClasses.size} distinct classes, ${stats.mergedFrom} graded on a merged sibling declaration), ${stats.atBlocks.length} at-blocks met = ${stats.atBlocks.length - stats.skippedAtBlocks.length} descended + ${stats.skippedAtBlocks.length} still skipped holding ${stats.stillHidden.length} selector-less blocks, ${stats.nestedRules.length} blocks found inside at-blocks, ${stats.boundary} refused by the primary-class boundary (${stats.boundaryNoBg} of them carrying no background), ${stats.pseudo} pseudo, ${stats.notRoot} not popup-shaped`, () => {
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
// `npx vitest run src/__tests__/popupBackgroundCompliance.test.ts --reporter=verbose`,
// and NONE of them was lowered when the extractor started descending: a widening is
// allowed to blow past its floors, never to be excused by one. The two floors whose
// UNIT the descent changed are re-named below (atBlocks now counts every at-block MET,
// nestedRules every block FOUND inside one), and the descent got its own floor, since
// a walk that silently stops descending back into at-blocks is precisely the shrink
// these floors exist to catch.
    const FLOORS = { sheets: 120, parsed: 5200, atBlocks: 280, nestedRules: 650, descendedRules: 300 };
    expect(cssFiles.length, `sheets opened ${cssFiles.length}, floor ${FLOORS.sheets} (baseline 137) -- the walk lost stylesheets, so every other number here is about a smaller tree`).toBeGreaterThan(FLOORS.sheets);
    expect(stats.parsed, `rules parsed ${stats.parsed}, floor ${FLOORS.parsed} (baseline 6078 before the descent, 6529 after it) -- the harvest shrank; check what stopped being read`).toBeGreaterThan(FLOORS.parsed);
    expect(stats.atBlocks.length, `at-blocks met (descended into or skipped) ${stats.atBlocks.length}, floor ${FLOORS.atBlocks} (baseline 347 top-level-only before the descent, 477 counting nested containers now) -- fewer containers are even being seen`).toBeGreaterThan(FLOORS.atBlocks);
    expect(stats.nestedRules.length, `blocks found inside at-blocks ${stats.nestedRules.length}, floor ${FLOORS.nestedRules} (baseline 816 before the descent, 1111 now that blocks inside nested containers are counted too) -- content moved out of the walk's sight altogether`).toBeGreaterThan(FLOORS.nestedRules);
    // THE DESCENT'S OWN FLOOR. The other four are satisfied by a top-level-only walk
    // too, so on their own none of them can see the descent being reverted; 300 of
    // headroom under 441 is what makes "stopped descending" red rather than quieter.
    expect(stats.descendedRules.length, `rules descended out of at-blocks ${stats.descendedRules.length}, floor ${FLOORS.descendedRules} (baseline 441) -- the extractor is abandoning at-blocks wholesale again`).toBeGreaterThan(FLOORS.descendedRules);

    // SHEET MEMBERSHIP, not a floor on size. Baseline: the 137 stylesheets this walk
    // opened at tip bf990e2cc, read out of a git archive of HEAD and counted by this
    // file's own extractor. The second field is the rules each sheet contributed at that
    // moment: it is printed in a failure and never asserted, so a stale number beside a
    // path costs a word, not a green.
    //
    // WHY A SET AND NOT A BAND: a sheet that stops existing changes membership on the
    // spot, whatever the counts do. The largest sheet here holds 436 rules, so losing it
    // moves parsed by that much and the sum band by the same amount -- a band wide enough
    // to survive ordinary work is by construction wide enough to swallow it, and the
    // sheets-opened floor only asks HOW MANY, so a rename or a swap that keeps the number
    // passes that too. Membership needs no tuning: the set is the same or it is not, so
    // this goes red on the commit that loses coverage, not on the day the band stops
    // fitting. A GROWTH is not a lie, so it is not failed either: a new sheet is walked,
    // graded and counted by every floor and band here, and this case only REPORTS it as
    // an appearance. Refresh is one line -- paste the walked-now pairs the failure prints
    // over SHEETS_BASELINE, and never delete a floor to make a failure go away.
    //
    // AND THE LIMIT OF THAT REFRESH, written down not fixed: the walked-now pairs come off a working
    // tree other lanes are editing, so one clipboard trip pastes a disappeared sheet away and every
    // floor, band and ceiling then re-reads the shrunken walk as its own baseline -- permanently green,
    // permanently smaller, with nothing tying the set to a revision. What would close it is data this
    // literal does not carry: a committed tip on the baseline, or a per-entry expiry, the introduced /
    // expires shape scripts/architecture-boundaries-baseline.json already uses. That choice is above
    // this box, so nothing is chosen here and the paste stays one unguarded motion.
    //
    // PATH EQUALITY, stated because the sibling guards in this repo match SELECTOR names and
    // their rules do not transfer: an entry is the WHOLE sheet path as the walk sees it --
    // relative(UI_SRC, file) with every platform separator folded to '/' -- and membership is
    // exact string equality over that whole path (includes / ===), no prefix match and no
    // boundary class. A '/' or a '.' in a path is not a boundary the way it is in a selector,
    // so 'features/sales/CartPanel.css' cannot credit 'features/sales/CartPanelLineItem.css'
    // and a moved directory cannot pass as the sheet it replaced.
    const SHEETS_BASELINE: [string, number][] = [
      ["components/ConnectionStatus.css",9],
      ["components/ErrorBoundary.css",7],
      ["components/ExitSurveyModal.css",11],
      ["components/FastPINOverlay.css",49],
      ["components/GatewayStatusBadge.css",5],
      ["components/ImpersonationBanner.css",4],
      ["components/MachineIdStatus.css",5],
      ["components/OrgSelector.css",7],
      ["components/OrgSwitcher.css",15],
      ["components/PermissionDenied.css",10],
      ["components/QrisQrDisplay.css",28],
      ["components/RoleBadge.css",14],
      ["components/StatusBar.css",9],
      ["components/StockAlertBell.css",4],
      ["components/StoreSwitcher.css",18],
      ["components/TierLockedFeature.css",5],
      ["components/UpdateBanner.css",16],
      ["components/charts/charts.css",9],
      ["contexts/HardwareAccel.css",9],
      ["features/analytics/AnalyticsScreen.css",219],
      ["features/audit/AuditLogScreen.css",64],
      ["features/auth/CreatePinScreen.css",16],
      ["features/auth/LicenseActivationScreen.css",30],
      ["features/auth/SessionLockScreen.css",44],
      ["features/auth/StaffLoginScreen.css",62],
      ["features/categories/CategoryManagementScreen.css",45],
      ["features/currency/ExchangeRateScreen.css",26],
      ["features/customers/CustomerManagementScreen.css",58],
      ["features/design/DesignSystem.css",34],
      ["features/design/DevToolbar.css",19],
      ["features/design/TooltipPreview.css",29],
      ["features/design/brand-tokens.css",1],
      ["features/gift-cards/GiftCardsScreen.css",63],
      ["features/inventory/InventoryAdjustmentScreen.css",52],
      ["features/inventory/LocationPicker.css",31],
      ["features/inventory/ShiftBar.css",22],
      ["features/inventory/StockAlertPanel.css",28],
      ["features/inventory/StockCountBadge.css",5],
      ["features/inventory/StockCountDetail.css",38],
      ["features/inventory/StockCountForm.css",13],
      ["features/inventory/StockCountHistory.css",23],
      ["features/inventory/StockCountsScreen.css",25],
      ["features/inventory/ThresholdConfigScreen.css",16],
      ["features/inventory/TransactionLogScreen.css",32],
      ["features/inventory/TransitAuditScreen.css",18],
      ["features/kds/ExpoScreen.css",59],
      ["features/kds/KdsCompletedView.css",6],
      ["features/kds/KdsScreen.css",336],
      ["features/kds/components/KdsDeviceStatusIndicator.css",19],
      ["features/kds/components/KdsEnrollmentModal.css",32],
      ["features/kds/components/KdsProductPickerModal.css",51],
      ["features/kds/components/KdsRoutingRulesEditor.css",63],
      ["features/kds/components/ModifierBadge.css",6],
      ["features/kiosk/KioskScreen.css",39],
      ["features/locations/MultiStoreDashboardScreen.css",34],
      ["features/locations/NodeTopologyEditor.css",350],
      ["features/locations/TerminalStatusPanel.css",19],
      ["features/locations/TopologyApplyConfirm.css",38],
      ["features/locations/TopologyRevisionBrowser.css",33],
      ["features/locations/TopologyScreen.css",9],
      ["features/loyalty/LoyaltyManagementScreen.css",56],
      ["features/marketplace/AddonsMarketplace.css",17],
      ["features/memo/MemoBanner.css",25],
      ["features/memo/MemosScreen.css",44],
      ["features/offline/OfflineQueueScreen.css",62],
      ["features/products/BundleManagementScreen.css",35],
      ["features/products/ProductLookupScreen.css",58],
      ["features/products/ProductManagementScreen.css",66],
      ["features/promotions/PromotionManagementScreen.css",37],
      ["features/purchasing/PurchaseOrderForm.css",26],
      ["features/purchasing/PurchaseOrdersScreen.css",31],
      ["features/purchasing/SuppliersScreen.css",30],
      ["features/reports/CustomReportScreen.css",44],
      ["features/reports/DashboardScreen.css",46],
      ["features/reports/InventoryReportScreen.css",24],
      ["features/reports/MenuEngineeringScreen.css",41],
      ["features/reports/SalesReportScreen.css",42],
      ["features/restaurant/RestaurantMenu.css",85],
      ["features/retail/RetailPosScreen.css",436],
      ["features/retail/ScaleIndicator.css",19],
      ["features/sales/CartPanel.brand.css",1],
      ["features/sales/CartPanel.css",37],
      ["features/sales/CartPanelActions.css",14],
      ["features/sales/CartPanelCourseBar.css",9],
      ["features/sales/CartPanelFooterTotals.css",62],
      ["features/sales/CartPanelLineItem.css",33],
      ["features/sales/EodReportScreen.css",82],
      ["features/sales/PaymentModal.css",151],
      ["features/sales/PosScreen.css",77],
      ["features/sales/PriceOverrideModal.css",41],
      ["features/sales/PromotionsModal.css",22],
      ["features/sales/ReceiptPreview.css",38],
      ["features/sales/RefundModal.css",37],
      ["features/sales/SalesDashboardScreen.css",4],
      ["features/sales/SalesHistoryScreen.css",95],
      ["features/sales/StockShortfallDialog.css",39],
      ["features/sales/VoidOrdersScreen.css",66],
      ["features/sales/components/ItemModifierModal.css",44],
      ["features/sales/widgets/widgets.css",22],
      ["features/settings/AppearanceSettings.css",29],
      ["features/settings/DataManagementScreen.css",63],
      ["features/settings/FeatureToggleScreen.css",50],
      ["features/settings/LicenseSettings.css",35],
      ["features/settings/SettingsNavTree.css",64],
      ["features/settings/SettingsPage.css",126],
      ["features/settings/SettingsScopeTag.css",6],
      ["features/settings/SettingsSelect.css",14],
      ["features/settings/WorkspaceSettingsModal.module.css",20],
      ["features/settings/screens/LocalPaymentSettingsCard.css",21],
      ["features/settings/screens/ReceiptFormatSettingsCard.css",16],
      ["features/settings/screens/RegionalSettingsCard.css",14],
      ["features/settings/screens/StatutoryNumberingCard.css",10],
      ["features/settings/screens/screens-placeholder.css",3],
      ["features/settings/sections/DiagnosticsSection.css",7],
      // SetupWizard.css (67 rules) was removed with the retired wizard (ADR #56 §2.3).
      // Its six StepAccount form atoms moved to ProvisioningFlow.css, which the
      // "appeared since baseline" arm reports rather than this shrink-only list.
      ["features/setup/components/LiveSetupPreview.css",25],
      ["features/shifts/ShiftManagementScreen.css",101],
      ["features/staff/components/RoleAuthoringPanel.css",29],
      ["features/staff/StaffManagementScreen.css",74],
      ["features/stock-transfers/StockTransfersScreen.css",73],
      ["features/tables/TableManagementScreen.css",44],
      ["features/tax/TaxConfigurationScreen.css",54],
      ["features/terminals/TerminalManagementScreen.css",70],
      ["features/warehouse/WarehouseConsole.css",104],
      ["features/workspaces/WorkspaceHome.css",131],
      ["components/ContextMenu.css",5],
      ["components/LoadingStatus.css",3],
      ["components/PermissionDenied.css",8],
      ["components/SettingsPopup.css",14],
      ["app/AppLayout.css",62],
      ["app/StatusBar.css",20],
      ["app/Tooltip.css",30],
      ["app/UpdateBanner.css",23],
      ["app/tablet/tablet.css",32],
      ["theme/components.css",140],
      ["theme/reset.css",28],
      ["theme/responsive.css",4],
      ["theme/tokens.css",5],
    ];
    // FLOOR THE BASELINE ITSELF, mirroring the graded-identity floor below: goneSheets is a filter
    // over this literal, so deleting all 137 entries is ONE motion that turns the membership guard
    // green forever while appearedSheets stays report-only and nothing else notices. 100, not 137:
    // a legitimate sheet coming or going must still read clean, and an emptied list must not.
    expect(SHEETS_BASELINE.length, 'membership over nothing is not membership').toBeGreaterThan(100);
    const walkedSheets = cssFiles.map((f) => relative(UI_SRC, f).split(sep).join('/')).sort();
    const goneSheets = SHEETS_BASELINE.filter(([p]) => !walkedSheets.includes(p));
    const appearedSheets = walkedSheets.filter((p) => !SHEETS_BASELINE.some(([b]) => b === p));
    const goneRules = goneSheets.reduce((n, [, r]) => n + r, 0);
    const appearedWithRules = appearedSheets.map((p) => [p, perSheet.get(p) ?? 0]);
    expect(
      goneSheets,
      'walked stylesheet set lost a member: ' + JSON.stringify(goneSheets) +
        ' -- ' + goneRules + ' rules that used to be read are now unread, counting what each '
        + 'lost sheet contributed at the baseline tip. No size guard can see this: the '
        + 'sheets-opened floor only counts, so a rename that keeps the count passes it, and a '
        + 'deletion moves parsed and the sum band by exactly the amount a band wide enough to '
        + 'survive ordinary work tolerates. Sheets that APPEARED since the baseline ('
        + appearedWithRules.length + ') are walked, graded and REPORTED, not failed: ' +
        JSON.stringify(appearedWithRules) +
        '\n  REFRESH: paste this over SHEETS_BASELINE -- walked now: ' +
        JSON.stringify(walkedSheets.map((p) => [p, perSheet.get(p) ?? 0])),
    ).toEqual([]);

    // TWO-SIDED BOUNDS. These lower bounds cannot see a MOVE, because the counter
    // that a move inflates is one of the counters being floored: putting one whole
    // sheet inside an @media took parsed 6078 -> 5642 and pushed hidden 816 -> 1238,
    // and every floor above read that as healthier. So bound the SUM of what the
    // walk knows about -- parsed plus what is STILL selector-less behind a skipped
    // at-block -- from both sides, which is what a deletion cannot hide inside
    // (deleting a rule lowers the sum by exactly one, whichever door it came out of),
    // and bound the still-skipped population from above as well, which is what a
    // wholesale move into an at-block cannot hide inside.
    //
    // THE UNIT THE DESCENT CHANGED, stated rather than smoothed over: the sum's second
    // term used to be every block inside an at-block, most of which was real rules the
    // extractor simply refused to read. It is now only the blocks that genuinely are
    // not selectors -- @keyframes steps and descriptor blocks -- because everything
    // else was pulled into `parsed`. So the sum is no longer "6068 + 816"; it is
    // 6529 parsed (of which 441 came out of at-blocks) + 544 selector-less blocks, and
    // the same band that held the old pair holds the new one: the descent conserved
    // this sum by construction, which is the point of it.
    //
    // Baselines are the
    // committed tree measured 2026-09-15 at tip `36ca7fc6b` (git archive of HEAD,
    // walked by this file's own extractor): parsed 6068 + hidden 816 = 6884, over
    // 137 sheets whose median holds 30 rules and whose single largest holds 436 and
    // hides 61. The band is therefore +/- a whole large sheet in each direction --
    // deliberately NOT tightened to today's biggest silent loss; see the residual
    // blind spot in the header comment.
    const SUM_BASELINE = 6884;                 // 6068 parsed + 816 hidden at 36ca7fc6b
    const SUM_BAND = { low: 6200, high: 7800 }; // -684 / +916: one large sheet either way
    // parsed already CONTAINS the descended rules; the only population not in it is the
    // blocks inside a skipped at-block, which are not selectors.
    const rulesSeen = stats.parsed + stats.stillHidden.length;
    expect(
      rulesSeen,
      `rules the walk knows about: ${stats.parsed} parsed (incl. ${stats.descendedRules.length} descended) + ${stats.stillHidden.length} selector-less blocks inside skipped at-blocks = ${rulesSeen}, ` +
      `outside the band ${SUM_BAND.low}..${SUM_BAND.high} around the baseline ${SUM_BASELINE} (6068 parsed + 816 hidden, ` +
      `measured at 36ca7fc6b) -- rules left the walk, or arrived in it, without either counter's floor noticing`,
    ).toBeGreaterThanOrEqual(SUM_BAND.low);
    expect(
      rulesSeen,
      `rules the walk knows about: ${stats.parsed} parsed + ${stats.stillHidden.length} selector-less = ${rulesSeen}, above the ceiling ` +
      `${SUM_BAND.high} around the baseline ${SUM_BASELINE} (6068 parsed + 816 hidden at 36ca7fc6b) -- the harvest grew past one ` +
      `large sheet since that baseline, so re-measure it here rather than widening the band`,
    ).toBeLessThanOrEqual(SUM_BAND.high);
    const SKIPPED_CEILING = 1000;              // same number as before, over a smaller population now
    // What this ceiling guards was re-aimed by the descent, and the number did not move.
    // It used to bound EVERY block inside an at-block (816 of them) because the extractor
    // skipped all of them; it now bounds only the blocks that are not selectors -- the
    // 544 @keyframes steps and descriptor blocks still behind a skipped body -- because the
    // other 441 are rules now and no longer belong in a ceiling about invisibility. The
    // file's own note before this change said it plainly: the ceiling "fails on the RIGHT
    // fix -- teaching extractRules to descend into at-blocks drives nestedRules and atBlocks
    // toward zero". It was re-aimed at what the right fix leaves behind, not deleted, and
    // no floor was lowered to make room for the descent: 1000 is still the same 1000, and
    // today's 544 sits 456 below it.
    expect(
      stats.stillHidden.length,
      `selector-less blocks still hidden inside skipped at-blocks: ${stats.stillHidden.length}, above the ceiling ${SKIPPED_CEILING} ` +
      `(544 at this tip; 816 was the whole hidden population before the descent learned to read an @media) -- ` +
      `content moved behind the door the extractor still skips, which is how a walk gets emptier while ` +
      `its own hidden counter goes UP; the sum band cannot see this move because hiding conserves it`,
    ).toBeLessThanOrEqual(SKIPPED_CEILING);

    // THE GRADED DOOR. Before the descent the baseline was exactly one rule, so
    // `graded > 0` was arithmetically `graded === 1`: the moment a second rule became
    // gradable it stopped distinguishing anything, and one rule could then leave
    // through the graded door taking its check with it while the floor never blinked.
    // The descent made that rule two -- the base `.toast` and its reduced-motion twin
    // in an @media -- so the floor is now demonstrably not an existence check, and
    // pinning the count would still block legitimate improvement. What the door
    // protects is stated instead: the population behind it is bounded by the sheet
    // and rule floors around it (139 sheets, 6,529 parsed, 441 of them descended),
    // and what must never happen is a rule that used to be checked ceasing to be
    // checked. So the assertion is a SUBSET check on identity -- a new gradable rule
    // passes, a rule that leaves fails, and the size of the set is never pinned.
    // Members are named by file, by their WHOLE selector, and by the at-block chain
    // they were read in -- never a prefix of any of the three. A prefix is the escape:
    // `startsWith('... { .toast')` also accepts `.toast:hover` (the base toast now
    // has no background at all, only a hovered one does) and `.toast, .popover` (the
    // rule quietly grew a second surface). Both were demonstrated green against the
    // prefix form, which is why the comparison is exact on every part of the name.
    // The check stays a required-member check, never a pinned set: a rule that
    // BECOMES gradable passes, one that changes shape or leaves fails.
    const GRADED_BASELINE: { file: string; selector: string; at: string }[] = [
      // Both members re-earned from a run of this file, not pasted from a header:
      // the top-level rule at components.css:1106 and the reduced-motion rule at
      // :1289 that the descent now reads. The second is the false positive a naive
      // per-rule descent lands RED on -- it declares only `animation:` -- and it is
      // green here because the per-class merge hands it the `background:
      // var(--color-toast-bg)` its own top-level rule already declares. Deleting the
      // merge, or the descent, or that declaration, each fails this list.
      { file: 'theme/components.css', selector: '.toast', at: '' },
      { file: 'theme/components.css', selector: '.toast', at: '@media (prefers-reduced-motion: no-preference)' },
    ];
    // A subset check over an EMPTY baseline is a green with no population: toEqual([]) of
    // a filter that had nothing to look for passes when nothing is required to stay graded.
    // So floor the baseline itself, as the magnitude floors above bound the walk -- with a
    // graded population of two rules sharing ONE selector, this file is two deletions away
    // from grading nothing, and the selector count alone cannot tell that apart.
    expect(
      GRADED_BASELINE.length,
      `the graded-identity baseline holds ${GRADED_BASELINE.length} required rule(s) -- a subset check over nothing passes on ` +
      `nothing, so name the rules that must keep reaching the background check before comparing against them`,
    ).toBeGreaterThan(0);
    // Identity is file + WHOLE selector + the at-block chain, so a top-level rule and
    // the descended rule that shares its selector are two named members, not one.
    // Comparing on file+selector alone would let the descended `.toast` satisfy the
    // baseline entry written for the top-level one and hide that the merge is what
    // keeps it green -- which is the exact fact a reader of this file needs kept.
    const lostGraded = GRADED_BASELINE.filter(
      (b) => !gradedMembers.some((m) => m.file === b.file && m.selector === b.selector && m.at === b.at),
    );
    expect(
      lostGraded,
      `rules that were graded and no longer reach the background check as the same rule: ` +
      `${JSON.stringify(lostGraded)}\n  expected at least: ${JSON.stringify(GRADED_BASELINE)}\n` +
      `  the graded set now (${stats.graded}): ${JSON.stringify(gradedMembers)}`,
    ).toEqual([]);

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
