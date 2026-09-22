import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/* ── Full-screen surface landscape + display-inset contract ──────────
 * The fresh-device surface is FULL SCREEN: `ProvisioningFlow` renders instead
 * of the shell (AppShell renders it before `setupKnownComplete`), so it must
 * work in both orientations on a tablet whose landscape viewport is
 * 1097x686 CSS px — width to spare, not enough height.
 *
 * Two mechanisms are pinned here, both invisible in a diff:
 *
 *  1. **Landscape is CSS-only.** The layout branches on
 *     `@media (orientation: landscape)`; nothing re-renders in React. The
 *     query literal is duplicated between the sheet and
 *     `LANDSCAPE_QUERY` in `useOrientation.ts`, because CSS cannot import a
 *     JS string — so the duplication is asserted rather than trusted.
 *  2. **Insets are read once.** `env(safe-area-inset-*)` appears on `:root`
 *     in `tokens.css` and nowhere else; every full-screen surface consumes the
 *     `--inset-*` tokens. A sheet that re-derives them keeps working, which is
 *     why the drift would otherwise go unnoticed.
 *
 * This file used to read `SetupWizard.css`, which was retired (ADR #56 §2.3 —
 * the component was unreachable; its later stages are in-app settings). The
 * surface it described is now `ProvisioningFlow.css`. The assertions were
 * REPOINTED rather than deleted with the sheet, because the inset contract is
 * about the live surface: deleting the test alongside the dead file would have
 * removed the only evidence that the live screen applies the insets at all —
 * which is exactly the gap this file then proved (`ProvisioningFlow.css` had a
 * flat `padding` and applied none).
 * ────────────────────────────────────────────────────────────────── */

const PROVISIONING_CSS = readFileSync(resolve(__dirname, '../features/setup/ProvisioningFlow.css'), 'utf-8');
const TABLET_CSS = readFileSync(resolve(__dirname, '../app/tablet/tablet.css'), 'utf-8');
const TOKENS_CSS = readFileSync(resolve(__dirname, '../theme/tokens.css'), 'utf-8');
const RESET_CSS = readFileSync(resolve(__dirname, '../theme/reset.css'), 'utf-8');

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

describe('the live full-screen surface needs no orientation branch', () => {
  // The retired wizard DID carry one (`@media (orientation: landscape) and
  // (min-width: 48rem)`, ADR-0001 Slice 0) because it laid presets three-up and
  // split a two-column step panel. `ProvisioningFlow` does not: it is one
  // centered card capped at 31.25rem inside a scroll container, so a wide
  // viewport asks nothing of it that portrait does not already answer.
  //
  // That is worth ASSERTING rather than assuming, because the opposite claim
  // is what the old file implied. It also keeps the two facts the orientation
  // fence cares about honest: `orientationAdaptiveWalker` grades every sheet in
  // `features/setup/` EXCEPT the one path it carves out by name, so adding a
  // landscape branch here would be a violation rather than a fix.

  it('declares no orientation literal, which the shell owns', () => {
    // ADR-0001 Slice 4: the shell owns orientation. This sheet is a feature
    // sheet, so a branch here is a fence violation, not a layout choice.
    expect(PROVISIONING_CSS).not.toContain('orientation: landscape');
    expect(PROVISIONING_CSS).not.toContain('orientation: portrait');
  });

  it('stays a single centered column at any width, capped for the landscape viewport', () => {
    // The card is width-constrained, so the 1097px landscape viewport shows the
    // same single column as portrait rather than a stretched form.
    const card = ruleBody(PROVISIONING_CSS, '\\.provisioning-card');
    expect(card).toBeTruthy();
    expect(card).toMatch(/max-width:\s*31\.25rem/);
    expect(card).toMatch(/margin:\s*auto/);
  });

  it('stays scrollable, since the form is taller than the landscape height', () => {
    // The tablet's landscape viewport is 1097x686 CSS px: height is the scarce
    // axis. The container owns its own scroll area so a field cannot become
    // unreachable when the card outgrows the viewport.
    const container = ruleBody(PROVISIONING_CSS, '\\.provisioning-container');
    expect(container).toMatch(/overflow-y:\s*auto/);
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
    expect(PROVISIONING_CSS).not.toContain('env(safe-area-inset-');
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

  it('applies the insets on the full-screen provisioning surface', () => {
    // The fresh-device surface renders instead of the shell, so it inherits
    // none of the shell's padding and must apply the insets itself. This
    // assertion is why the retirement repointed rather than deleted: measured
    // 2026-09-23 the live sheet had a flat `padding` and applied NO insets,
    // while the dead wizard sheet was the only in-tree consumer besides the
    // shell — so the contract read as covered when it was not.
    const container = ruleBody(PROVISIONING_CSS, '\\.provisioning-container');
    expect(container).toBeTruthy();
    for (const token of INSET_TOKENS) {
      expect(container).toContain(`var(${token})`);
    }
    // The visual gutter stays its own token, so a breakpoint changes one value
    // instead of restating the whole inset sum.
    expect(container).toMatch(/--provisioning-gutter:\s*var\(--space-8\)/);
  });

  it('splits the inset ownership: the shell takes top/left/right, the tab bar takes the bottom', () => {
    // `.tablet-shell` is declared twice at top level — as the shell root, and
    // again in the safe-area block — so look for the body that carries the
    // insets rather than assuming it is the first one.
    const bodies = ruleBodies(TABLET_CSS, '\\.tablet-shell');
    expect(bodies.length).toBeGreaterThan(1);
    const SHELL_INSETS = ['--inset-top', '--inset-left', '--inset-right'];
    const withInsets = bodies.filter((b) => SHELL_INSETS.every((t) => b.includes(`var(${t})`)));
    expect(withInsets).toHaveLength(1);
    // The bottom edge is deliberately NOT the shell's. The tab bar is the
    // bottom-most element and pads itself, so its elevated background still
    // reaches the screen edge instead of stopping short over a strip of
    // `--color-bg`. Both layers padding it double-spaced the bar and, with
    // `.app-layout` at `100dvh`, overflowed the viewport by the inset sum.
    expect(withInsets[0]).not.toContain('--inset-bottom');

    const bar = ruleBody(TABLET_CSS, '\\.tablet-shell \\.tablet-tab-bar');
    expect(bar).toBeTruthy();
    expect(bar).toContain('padding-bottom: var(--inset-bottom)');
  });

  it('keeps the gutter its own token, so an inset edit cannot touch the spacing', () => {
    // The retired wizard narrowed its gutter at a small breakpoint and this test
    // pinned that. The live surface has no such breakpoint, so the property
    // worth keeping is the one that made the pattern safe: the visual gutter is
    // a custom property, so a breakpoint changes ONE value instead of restating
    // the inset sum, and re-deriving `env()` here stays impossible.
    const container = ruleBody(PROVISIONING_CSS, '\\.provisioning-container');
    expect(container).toMatch(/--provisioning-gutter:\s*var\(--space-8\)/);
    expect(container).not.toContain('env(safe-area-inset-');
  });

  it('adds the inset to the gutter on each edge rather than replacing one with the other', () => {
    // WHY THIS IS ASSERTED RATHER THAN ONLY ITS INGREDIENTS. The tests above check
    // that the tokens are mentioned; this one checks they are SUMMED. The
    // difference was measured in Chromium against this sheet on a notched viewport
    // (412x915, insets 44/0/34/0, gutter var(--space-8)=32px):
    //
    //   calc(gutter + inset)  padding 76px top / 66px bottom, card top y=459
    //   bare gutter (the bug) padding 32px top / 32px bottom, card top y=415
    //
    // A flat padding put the card 44px higher - under the notch - while a test
    // that merely looked for `var(--inset-top)` somewhere in the rule passed.
    // The calc shape on all four edges is what produces the first row.
    const container = ruleBody(PROVISIONING_CSS, '\\.provisioning-container')!;
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect(
        container,
        `${edge}: the inset must be ADDED to the gutter, not used alone`,
      ).toContain(`calc(var(--provisioning-gutter) + var(--inset-${edge}))`);
    }
  });
});