import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/* -- Tablet home workspace-grid column contract ----------------------
 *
 * The tablet home screen shows the workspace picker, and the owner asked for
 * 2 columns in portrait and 3 in landscape. That outcome is decided ENTIRELY
 * by CSS: nothing in React reads orientation, and jsdom resolves neither
 * @media nor a grid, so no rendered assertion in the repo can see it.
 *
 * The bug this file exists for. The landscape half once shipped keyed on
 * the selector `.tablet-shell .workspace-grid`. Measured in headless Chromium
 * against the real sheets, that selector matched NOTHING on this screen:
 * TabletAppShell returns the home wrapper at line 445 and only enters
 * TabletAppLayout (the sole source of `.tablet-shell`, TabletAppLayout.tsx:117)
 * once a workspace is ACTIVE. So the rule was present, correct-looking, and
 * INERT -- and the width fallback in WorkspaceHome.css kept ruling at 2 columns.
 *
 * MEASURED, NOT ASSUMED (this is the whole point of the file):
 *
 *   selector keyed on           portrait (686px)     landscape (1097px)
 *   `.tablet-shell ...`         335+335 -> 2 cols    540+540 -> 2 cols  <- the bug
 *   `.workspace-home-wrapper`   335+335 -> 2 cols    355 x3  -> 3 cols  <- fixed
 *
 * The landscape viewport is 1097.1px CSS (1920 physical / 1.75 DPR), which is
 * THREE PIXELS under the 1100px max-width fallback in WorkspaceHome.css -- so
 * that fallback MATCHES in landscape too and would win on source order. It
 * loses only because `.workspace-home-wrapper .workspace-grid` is two class
 * selectors (0,2,0) against the fallback's one (0,1,0). A contract test that
 * asserted merely that a declaration is PRESENT would have passed on the
 * broken sheet. What this file pins is that the WINNING selector names the
 * wrapper the home screen actually renders.
 * ---------------------------------------------------------------- */

const TABLET_CSS = readFileSync(resolve(__dirname, '../app/tablet/tablet.css'), 'utf-8');

/** The home screen's real ancestor, per TabletAppShell.tsx:445. */
const HOME_WRAPPER = '.workspace-home-wrapper';
/**
 * The wrapper-qualified grid selectors. QUALIFIED is the point: the bare
 * `.workspace-grid` is what the fallback in WorkspaceHome.css uses, and the
 * orientation branch has to be MORE specific than it to win the cascade.
 */
const HOME_GRID = HOME_WRAPPER + ' .workspace-grid';

/** Slice the balanced body of the FIRST `@media <media>` block, or null. */
function mediaBlock(css: string, media: string): string | null {
  const at = css.indexOf('@media ' + media);
  if (at === -1) return null;
  const open = css.indexOf('{', at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Blank every CSS block comment, length-preservingly. Comments are not rules,
 * and these blocks carry long prose that names the very selectors under test --
 * read unstripped, the comment prose is matched as a selector and the real rule
 * is never reached.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
}

/**
 * Declaration body of the first rule in an `@media` block whose selector LIST
 * contains `selector`. Scoping to the block matters: the same selectors appear
 * in BOTH orientation branches, so a global read would grade the portrait rule
 * against the landscape assertion.
 *
 * Selectors are matched as trimmed STRINGS, not by building a RegExp from the
 * selector. An escaped selector needs the dot escaped once for the literal
 * (`\.`) and again for the string, so the obvious `replace` over-escapes and
 * then matches nothing -- and a matcher that can never match is exactly how
 * this file would have gone green on the broken sheet. Verified by running it
 * against the pre-fix CSS, which must fail.
 */
function bodyInMedia(css: string, media: string, selector: string): string | null {
  const block = mediaBlock(css, media);
  if (block === null) return null;
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(stripComments(block))) !== null) {
    const selectors = m[1]!.split(',').map((s) => s.trim());
    if (selectors.includes(selector)) return m[2]!;
  }
  return null;
}

/** Every selector in an `@media` block that declares `grid-template-columns`. */
function gridSelectorsInMedia(css: string, media: string): string[] {
  const block = mediaBlock(css, media);
  if (block === null) return [];
  const out: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(stripComments(block))) !== null) {
    if (!/grid-template-columns\s*:/.test(m[2]!)) continue;
    for (const sel of m[1]!.split(',')) out.push(sel.trim());
  }
  return out;
}

const classCount = (sel: string) => (sel.match(/\./g) ?? []).length;

describe('tablet home workspace grid: 2 columns portrait, 3 landscape', () => {
  it('keys the portrait branch on the wrapper the home screen actually renders', () => {
    const body = bodyInMedia(TABLET_CSS, '(orientation: portrait)', HOME_GRID);
    expect(body, 'the portrait branch must name ' + HOME_GRID).toBeTruthy();
    expect(body).toMatch(/grid-template-columns\s*:\s*repeat\(2,\s*1fr\)/);
  });

  it('keys the landscape branch on the wrapper, not on .tablet-shell alone', () => {
    const landscape = gridSelectorsInMedia(TABLET_CSS, '(orientation: landscape)');
    expect(
      landscape.some((s) => s.includes(HOME_WRAPPER)),
      'landscape grid selectors were: ' + JSON.stringify(landscape),
    ).toBe(true);

    const body = bodyInMedia(TABLET_CSS, '(orientation: landscape)', HOME_GRID);
    expect(body).toBeTruthy();
    expect(body).toMatch(/grid-template-columns\s*:\s*repeat\(3,\s*1fr\)/);
  });

  it('out-specifies the WorkspaceHome.css width fallback that also matches', () => {
    // The landscape viewport is 1097.1px, three pixels UNDER the fallback's
    // 1100px gate, so the fallback applies at the same time. The wrapper
    // selector carries two class selectors and out-specifies it; a rewrite to a
    // single-class selector would lose on source order and silently return the
    // grid to 2 columns. The fallback must keep its 1100px gate for this to hold.
    const fallback = readFileSync(
      resolve(__dirname, '../features/workspaces/WorkspaceHome.css'),
      'utf-8',
    );
    const at = fallback.indexOf('@media (max-width: 1100px)');
    expect(at, 'WorkspaceHome.css must keep its 1100px 2-column fallback').toBeGreaterThan(-1);
    const block = mediaBlock(fallback, '(max-width: 1100px)');
    expect(block).toBeTruthy();
    expect(block).toMatch(/grid-template-columns\s*:\s*repeat\(2,\s*1fr\)/);

    const winners = gridSelectorsInMedia(TABLET_CSS, '(orientation: landscape)').filter((s) =>
      s.includes(HOME_WRAPPER),
    );
    expect(winners.length).toBeGreaterThan(0);
    for (const sel of winners) {
      expect(
        classCount(sel),
        sel + ' must out-specify the single-class width fallback',
      ).toBeGreaterThan(1);
    }
  });

  it('does not depend on the home screen rendering inside .tablet-shell', () => {
    // Guards the assumption this file rests on. If TabletAppShell ever grows a
    // .tablet-shell ancestor for the home wrapper the original selector would
    // start working and the tablet.css comment would go stale -- this fails and
    // points the next reader at it, rather than letting the comment rot.
    const shell = readFileSync(resolve(__dirname, '../app/tablet/TabletAppShell.tsx'), 'utf-8');
    const homeAt = shell.indexOf('workspace-home-wrapper');
    expect(homeAt, 'TabletAppShell must render ' + HOME_WRAPPER).toBeGreaterThan(-1);
    const before = shell.slice(0, homeAt);
    const line = before.split('\n').length;
    expect(
      before.includes('className="tablet-shell"'),
      'the home wrapper is rendered at line ' + line + ' and a .tablet-shell' +
        ' ancestor now exists before it -- the tablet.css comment explaining why' +
        ' the shell-keyed selector is inert is now stale',
    ).toBe(false);
  });
});
