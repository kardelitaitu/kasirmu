import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/* ── Setup wizard landscape + display-inset contract ─────────────────
 * The wizard is a FULL-SCREEN page (on a fresh device it renders instead of
 * the shell), and it must work in both orientations on a tablet whose
 * landscape viewport is 1097x686 CSS px — width to spare, not enough height.
 *
 * Two mechanisms are pinned here, both invisible in a diff:
 *
 *  1. **Landscape is CSS-only.** The layout branches on
 *     `@media (orientation: landscape)`; nothing re-renders in React. The
 *     query literal is duplicated between the sheet and
 *     `LANDSCAPE_QUERY` in `useOrientation.ts`, because CSS cannot import a
 *     JS string — so the duplication is asserted rather than trusted.
 *  2. **Insets are read once.** `env(safe-area-inset-*)` appears on `:root`
 *     in `reset.css` and nowhere else; every full-screen surface consumes the
 *     `--inset-*` tokens. A sheet that re-derives them keeps working, which is
 *     why the drift would otherwise go unnoticed.
 * ────────────────────────────────────────────────────────────────── */

const WIZARD_CSS = readFileSync(resolve(__dirname, '../features/setup/SetupWizard.css'), 'utf-8');
const TABLET_CSS = readFileSync(resolve(__dirname, '../app/tablet/tablet.css'), 'utf-8');
const TOKENS_CSS = readFileSync(resolve(__dirname, '../theme/tokens.css'), 'utf-8');
const RESET_CSS = readFileSync(resolve(__dirname, '../theme/reset.css'), 'utf-8');
const HOOK_TS = readFileSync(resolve(__dirname, '../hooks/useOrientation.ts'), 'utf-8');

/**
 * Extract a top-level rule's declaration body.
 *
 * The selector is anchored to a line start, and leading indentation is
 * allowed: a rule inside a media block is indented, and without `[ \t]*` the
 * anchored form matches nothing there. The anchor still matters, because an
 * unanchored match finds the FIRST occurrence anywhere in the file and several
 * of these selectors also appear earlier as descendants
 * (`.tablet-shell .tablet-setup-page`), whose bodies are unrelated.
 */
function ruleBody(css: string, selector: string): string | null {
  const re = new RegExp(`(?:^|\\n)[ \\t]*${selector}\\s*\\{([^}]*)\\}`, 'm');
  return css.match(re)?.[1] ?? null;
}

/**
 * Every top-level body for a selector. Needed where one selector legitimately
 * has more than one rule — `.tablet-shell` is declared both as the shell root
 * and again in the safe-area block, so "the first body" is the wrong one.
 */
function ruleBodies(css: string, selector: string): string[] {
  const re = new RegExp(`(?:^|\\n)[ \\t]*${selector}\\s*\\{([^}]*)\\}`, 'gm');
  return [...css.matchAll(re)].map((m) => m[1]!);
}

/**
 * Extract a media block's body by matching braces, so a later addition after
 * the block cannot leak into the assertions.
 */
function mediaBlock(css: string, query: string): string | null {
  const start = css.indexOf(`@media ${query}`);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return null;
}

describe('setup wizard landscape layout', () => {
  it('declares an orientation-landscape block gated on a tablet-class width', () => {
    const block = mediaBlock(WIZARD_CSS, '(orientation: landscape) and (min-width: 48rem)');
    expect(block).toBeTruthy();
  });

  it('keeps the media query in step with LANDSCAPE_QUERY in useOrientation', () => {
    // The hook is the structural half of the mechanism; the sheet is the
    // layout half. They must agree on the word "landscape", or a screen can
    // be sized for one orientation and laid out for the other.
    const constant = HOOK_TS.match(/LANDSCAPE_QUERY\s*=\s*'([^']+)'/)?.[1];
    expect(constant).toBe('(orientation: landscape)');
    expect(WIZARD_CSS).toContain(`@media ${constant} and (min-width: 48rem)`);
  });

  it('widens the container in landscape, because portrait caps it at 40rem', () => {
    const portrait = ruleBody(WIZARD_CSS, '\\.setup-container');
    expect(portrait).toMatch(/max-width:\s*40rem/);

    const block = mediaBlock(WIZARD_CSS, '(orientation: landscape) and (min-width: 48rem)')!;
    const wide = ruleBody(block, '\\.setup-container');
    expect(wide).toMatch(/max-width:\s*72rem/);
  });

  it('puts the presets three-up in landscape and two-up in portrait', () => {
    const portrait = ruleBody(WIZARD_CSS, '\\.setup-presets');
    expect(portrait).toMatch(/grid-template-columns:\s*1fr 1fr/);

    const block = mediaBlock(WIZARD_CSS, '(orientation: landscape) and (min-width: 48rem)')!;
    const wide = ruleBody(block, '\\.setup-presets');
    expect(wide).toMatch(/grid-template-columns:\s*repeat\(3,/);
  });

  it('splits the step panel into two columns only when the live preview is present', () => {
    // Without the `:has()` guard the right-hand column is left empty on steps
    // 1-6, which render feature toggles and no preview.
    const block = mediaBlock(WIZARD_CSS, '(orientation: landscape) and (min-width: 48rem)')!;
    const panel = ruleBody(block, '\\.setup-step-panel:has\\(\\.lsp-root\\)');
    expect(panel).toBeTruthy();
    expect(panel).toMatch(/display:\s*grid/);
    expect(panel).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it('reflows the feature toggles two-up in landscape to halve their height', () => {
    const block = mediaBlock(WIZARD_CSS, '(orientation: landscape) and (min-width: 48rem)')!;
    const features = ruleBody(block, '\\.setup-features');
    expect(features).toMatch(/grid-template-columns:\s*repeat\(2,/);
  });
});

describe('display insets are read once and consumed everywhere', () => {
  const INSET_TOKENS = ['--inset-top', '--inset-right', '--inset-bottom', '--inset-left'];

  it('defines every inset token on :root in tokens.css', () => {
    // `tokens.css` is the token layer, and the only file
    // `themeTokenCompliance` counts as defining a token besides a `features/`
    // sheet or a JS `setProperty`. Declaring these in `reset.css` instead makes
    // the guard report the consuming sheet as referencing a token "defined
    // nowhere" — measured 2026-09-20.
    const root = ruleBody(TOKENS_CSS, ':root');
    expect(root).toBeTruthy();
    for (const token of INSET_TOKENS) {
      // `\s*`, not a single space: `tokens.css` column-aligns its values, so
      // `--inset-top:    env(...)` is the house style here.
      expect(root).toMatch(new RegExp(`${token}:\\s*env\\(safe-area-inset-`));
    }
  });

  it('derives env(safe-area-inset-*) nowhere else', () => {
    // tokens.css is the single reader. Any other sheet spelling `env(...)` is
    // the drift this test exists to catch — it would keep working while
    // disagreeing.
    expect(TOKENS_CSS).toContain('env(safe-area-inset-top');
    expect(WIZARD_CSS).not.toContain('env(safe-area-inset-');
    expect(TABLET_CSS).not.toContain('env(safe-area-inset-');
    expect(RESET_CSS).not.toContain('env(safe-area-inset-');
  });

  it('keeps the insets out of the theme blocks, since they are not themed', () => {
    // A per-theme copy would imply the insets follow the theme and would read
    // as a second source of truth.
    const light = ruleBody(TOKENS_CSS, "\\[data-theme='light'\\]");
    const dark = ruleBody(TOKENS_CSS, "\\[data-theme='dark'\\]");
    for (const block of [light, dark]) {
      expect(block).toBeTruthy();
      for (const token of INSET_TOKENS) {
        expect(block).not.toContain(`${token}:`);
      }
    }
  });

  it('applies the insets on the full-screen wizard page', () => {
    // The wizard renders instead of the shell on a fresh device, so it inherits
    // none of the shell's padding and must apply the insets itself.
    const page = ruleBody(WIZARD_CSS, '\\.setup-page');
    expect(page).toBeTruthy();
    for (const token of INSET_TOKENS) {
      expect(page).toContain(`var(${token})`);
    }
    // The visual gutter stays its own token, so the narrow breakpoint changes
    // one value instead of restating the whole inset sum.
    expect(page).toMatch(/--setup-gutter:\s*var\(--space-6\)/);
  });

  it('applies the insets on the tablet shell', () => {
    // `.tablet-shell` is declared twice at top level — as the shell root, and
    // again in the safe-area block — so look for the body that carries the
    // insets rather than assuming it is the first one.
    const bodies = ruleBodies(TABLET_CSS, '\\.tablet-shell');
    expect(bodies.length).toBeGreaterThan(1);
    const withInsets = bodies.filter((b) => INSET_TOKENS.every((t) => b.includes(`var(${t})`)));
    expect(withInsets).toHaveLength(1);
  });

  it('narrows only the gutter at the small breakpoint, not the insets', () => {
    const narrow = mediaBlock(WIZARD_CSS, '(max-width: 31.25rem)');
    expect(narrow).toBeTruthy();
    const page = ruleBody(narrow!, '\\.setup-page');
    expect(page).toMatch(/--setup-gutter:\s*var\(--space-4\)/);
    expect(page).not.toContain('env(safe-area-inset-');
  });
});
