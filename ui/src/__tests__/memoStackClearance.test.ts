import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

/* ── Memo stack clearance — regression guard ────────────────────────
 * The memo-clearance fix is a five-sheet CSS chain. Every link shipped
 * with geometry measurements and suite-green runs, but nothing asserted
 * the chain itself, so a plain revert of any link would have passed
 * every gate. This file pins each link by READING the shipped sheets
 * and asserting the parsed rule BODIES — never absolute line numbers,
 * which drift.
 *
 * The chain, and what breaks when a link is pulled:
 *
 *   tokens.css (:root default)
 *     --memo-bottom-inset: var(--space-6)
 *     → chrome-free fullscreen branches (POS/KDS) keep the historic
 *       24px gutter. Without it the consumer's var() fallback is the
 *       only thing holding the gutter — which works ONLY because the
 *       fallback and this default agree; any consumer-side "cleanup"
 *       of the fallback then silently drops the gutter to 0.
 *   tablet.css (.tablet-shell, its OWN block)
 *     calc(nav-height + --inset-bottom + --space-6)
 *     → the stack clears the 64px tab bar (it painted 40px over it).
 *   AppLayout.css (.app-layout)
 *     calc(var(--statusbar-height) + var(--space-6))
 *     → the desktop shell's stack clears the 28px status bar (4px over).
 *   SettingsPage.css (body:has(.settings-footer))
 *     calc(2.75rem + var(--space-6))
 *     → the fullscreen settings route has no shell ancestor, so its
 *       footer (45px, theme-toggle-driven) is cleared by a body-level
 *       override — .settings-page is NOT an ancestor of the fixed
 *       stack, which renders as its SIBLING under #root.
 *   MemoBanner.css (.memo-stack, the consumer)
 *     bottom: var(--memo-bottom-inset, var(--space-6))
 *     → the fallback is LOAD-BEARING (see tokens.css link above).
 *
 * Exit-row inertness, the second half of the shipped guard:
 *   .memo-stack has pointer-events: none (click-through over bottom
 *   chrome), the two live controls re-enable it with auto — and
 *   .memo-stack-item.is-exiting * re-inerts every DESCENDANT of an
 *   exiting row. That descendant rule is the one that matters: a
 *   descendant's explicit auto beats an ancestor's none, so without it
 *   an exiting bubble (opacity 0, open button NOT disabled — only the
 *   close chip is) stayed hit-testable for the 450ms collapse, and a
 *   stray click fired onExpand → pending ack → the memo was
 *   permanently discarded. Assert the RULE (descendant-targeting
 *   selector + none), not just that some pointer-events exists.
 * ────────────────────────────────────────────────────────────────── */

const SHEETS = {
  tokens: resolve(__dirname, '../theme/tokens.css'),
  tablet: resolve(__dirname, '../app/tablet/tablet.css'),
  appLayout: resolve(__dirname, '../app/AppLayout.css'),
  settings: resolve(__dirname, '../features/settings/SettingsPage.css'),
  memo: resolve(__dirname, '../features/memo/MemoBanner.css'),
} as const;

function readSheet(path: string): string {
  return readFileSync(path, 'utf-8');
}

/**
 * All rule bodies for one selector, including rules nested inside
 * `@media` (the regex is line-anchored and matches the selector
 * directly before `{`, so grouped selectors like `.memo-stack,`
 * and descendant forms do not match by accident). No line numbers are
 * asserted — they drift.
 */
function blocksOf(css: string, selector: string): string[] {
  const re = new RegExp(`(?:^|\\n)\\s*${selector}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1] ?? '');
}

/** The custom-property value declared in a set of rule bodies, if any. */
function customProp(blocks: string[], name: string): string | null {
  for (const body of blocks) {
    const m = body.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
    if (m) return m[1]!.trim();
  }
  return null;
}

describe('Memo stack clearance — the token chain', () => {
  it('tokens.css declares the chrome-free :root DEFAULT --memo-bottom-inset: var(--space-6)', () => {
    const css = readSheet(SHEETS.tokens);
    const rootBlocks = blocksOf(css, ':root');
    expect(
      rootBlocks.length,
      'tokens.css must have a :root block to hold the --memo-bottom-inset default',
    ).toBeGreaterThan(0);
    const value = customProp(rootBlocks, '--memo-bottom-inset');
    // The exact match pins the default to the chrome-free gutter token:
    // a px/rem literal here would be a second source of truth competing
    // with the shell overrides.
    expect(
      value,
      'tokens.css :root must declare --memo-bottom-inset (the chrome-free default; without it the consumer runs on its var() fallback alone)',
    ).toBe('var(--space-6)');
  });

  it('the consumer .memo-stack keeps the load-bearing var() fallback on bottom', () => {
    const css = readSheet(SHEETS.memo);
    const stack = blocksOf(css, '\\.memo-stack');
    expect(
      stack.length,
      'MemoBanner.css must keep the .memo-stack rule (the consumer of --memo-bottom-inset)',
    ).toBeGreaterThan(0);
    expect(
      stack.some((b) => /bottom:\s*var\(--memo-bottom-inset,\s*var\(--space-6\)\)/.test(b)),
      'MemoBanner.css .memo-stack must consume bottom: var(--memo-bottom-inset, var(--space-6)) — the fallback is load-bearing and must agree with the :root default',
    ).toBe(true);
    // The chain only works because default and fallback agree: pin both
    // to the SAME token, so editing one without the other fails here.
    const tokens = readSheet(SHEETS.tokens);
    const fallback = customProp(blocksOf(css, '\\.memo-stack'), 'bottom')?.match(
      /var\(--memo-bottom-inset,\s*var\((--[\w-]+)\)\)/,
    )?.[1];
    const def = customProp(blocksOf(tokens, ':root'), '--memo-bottom-inset')?.match(
      /var\((--[\w-]+)\)/,
    )?.[1];
    expect(fallback).toBe('--space-6');
    expect(def).toBe(fallback);
  });

  it('the tablet shell overrides the inset on .tablet-shell in its OWN block, as nav + inset-bottom + space-6', () => {
    const css = readSheet(SHEETS.tablet);
    const shellBlocks = blocksOf(css, '\\.tablet-shell');
    expect(
      shellBlocks.length,
      'tablet.css must keep .tablet-shell rules (the tablet shell layout root)',
    ).toBeGreaterThan(0);
    const withInset = shellBlocks.filter((b) => /--memo-bottom-inset\s*:/.test(b));
    expect(
      withInset.length,
      'tablet.css must declare --memo-bottom-inset on .tablet-shell (the tablet shell override: the stack painted 40px over the 64px tab bar at a flat --space-6)',
    ).toBeGreaterThan(0);
    expect(
      withInset.some((b) =>
        /--memo-bottom-inset:\s*calc\(\s*var\(--tablet-bottom-nav-height\)\s*\+\s*var\(--inset-bottom\)\s*\+\s*var\(--space-6\)\s*\)/.test(b),
      ),
      'tablet.css .tablet-shell --memo-bottom-inset must be calc(var(--tablet-bottom-nav-height) + var(--inset-bottom) + var(--space-6)) — the bar\'s height, its own bottom inset, and the gutter',
    ).toBe(true);
    // The override lives in a SEPARATE block from the shell body that
    // carries the display insets (setupWizardLandscape.test.ts pins that
    // body to top/left/right only). If the inset declaration joins the
    // shell body, that pinned contract breaks.
    for (const body of withInset) {
      expect(
        /padding/.test(body),
        'tablet.css: the --memo-bottom-inset override must stay in its own .tablet-shell block, not join the inset-carrying shell body (pinned by setupWizardLandscape.test.ts)',
      ).toBe(false);
    }
  });

  it('the desktop shell overrides the inset on .app-layout as statusbar + space-6', () => {
    const css = readSheet(SHEETS.appLayout);
    const layout = blocksOf(css, '\\.app-layout');
    expect(
      layout.length,
      'AppLayout.css must keep the .app-layout rule (the desktop shell layout root)',
    ).toBeGreaterThan(0);
    expect(
      layout.some((b) =>
        /--memo-bottom-inset:\s*calc\(\s*var\(--statusbar-height\)\s*\+\s*var\(--space-6\)\s*\)/.test(b),
      ),
      'AppLayout.css .app-layout must declare --memo-bottom-inset: calc(var(--statusbar-height) + var(--space-6)) — the desktop stack painted 4px over the 28px status bar at a flat --space-6',
    ).toBe(true);
    // The statusbar height token is single-sourced in tokens.css and
    // must not be redefined by a consumer.
    const tokens = readSheet(SHEETS.tokens);
    const statusbar = customProp(blocksOf(tokens, ':root'), '--statusbar-height');
    expect(statusbar, 'tokens.css :root must declare --statusbar-height (28px, single source)').toBe('28px');
    expect(
      customProp(layout, '--statusbar-height'),
      'AppLayout.css must not redefine --statusbar-height — tokens.css is its single source',
    ).toBeNull();
  });

  it('the settings route overrides the inset on body:has(.settings-footer), the ancestor the stack actually has', () => {
    const css = readSheet(SHEETS.settings);
    const bodyRule = blocksOf(css, 'body:has\\(\\.settings-footer\\)');
    expect(
      bodyRule.length,
      'SettingsPage.css must declare --memo-bottom-inset on body:has(.settings-footer) — the settings route is a FULLSCREEN page whose .settings-page is a SIBLING of the fixed .memo-stack under #root, so an override on the page root can never reach the stack',
    ).toBeGreaterThan(0);
    expect(
      bodyRule.some((b) => /--memo-bottom-inset:\s*calc\(2\.75rem\s*\+\s*var\(--space-6\)\)/.test(b)),
      'SettingsPage.css body:has(.settings-footer) --memo-bottom-inset must be calc(2.75rem + var(--space-6)) — the footer\'s height is set by its tallest child, the coarse-pointer theme toggle (2.75rem), per the "own bottom chrome height + --space-6" contract',
    ).toBe(true);
    // The footer that sets the chrome height must keep the toggle that
    // sizes it, or the 2.75rem above drifts silently.
    const footer = blocksOf(css, '\\.settings-footer-theme-toggle');
    expect(
      footer.some((b) => /height:\s*2\.75rem/.test(b)),
      'SettingsPage.css .settings-footer-theme-toggle must keep height: 2.75rem under pointer:coarse — it is the value the body override\'s calc is derived from',
    ).toBe(true);
  });

  it('no other sheet declares the token — exactly one default, three scoped overrides, one consumer', () => {
    // Scopes: :root default (tokens), .tablet-shell (tablet),
    // .app-layout (desktop), body:has(.settings-footer) (settings),
    // and the consumer read in MemoBanner.css. A stray declaration
    // elsewhere would be a competing source of truth.
    const expectedSheets = new Set(Object.values(SHEETS));
    const uiSrc = resolve(__dirname, '..');
    const cssFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = resolve(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.css')) cssFiles.push(p);
      }
    };
    walk(uiSrc);
    const foreign: string[] = [];
    for (const file of cssFiles) {
      if (!expectedSheets.has(file)) {
        if (/--memo-bottom-inset\s*:/.test(readSheet(file))) foreign.push(file);
      }
    }
    expect(
      foreign,
      'only tokens.css, tablet.css, AppLayout.css, SettingsPage.css and MemoBanner.css may touch --memo-bottom-inset; these files declare it outside the chain',
    ).toEqual([]);
  });
});

describe('Memo stack exit-row inertness', () => {
  it('.memo-stack is click-through, and only the two live controls re-enable pointer-events', () => {
    const css = readSheet(SHEETS.memo);
    const stack = blocksOf(css, '\\.memo-stack');
    expect(
      stack.some((b) => /pointer-events:\s*none/.test(b)),
      'MemoBanner.css .memo-stack must keep pointer-events: none — the fixed overlay overlaps bottom chrome, and pointer-events is what lets clicks pass through to it',
    ).toBe(true);
    for (const control of ['\\.memo-banner-open', '\\.memo-banner-close']) {
      const blocks = blocksOf(css, control);
      expect(
        blocks.some((b) => /pointer-events:\s*auto/.test(b)),
        `MemoBanner.css ${control.slice(2)} must keep pointer-events: auto — it re-enables the stack\'s click-through for a real control; dropping it makes the banner unopenable/unacknowledgeable`,
      ).toBe(true);
    }
  });

  it('.memo-stack-item.is-exiting * re-inerts every descendant of an exiting row', () => {
    // THE rule that guards the discard hazard. A descendant's explicit
    // auto beats an ancestor's none, and .memo-stack-item.is-exiting's
    // own pointer-events: none is NOT inherited past the open button's
    // auto — so during the 450ms collapse an invisible bubble stayed
    // hit-testable and a stray click fired onExpand → pending ack →
    // permanent memo discard. The descendant-targeting selector is the
    // fix; a plain .memo-stack-item.is-exiting rule does NOT cover it.
    const css = readSheet(SHEETS.memo);
    const rule = blocksOf(css, '\\.memo-stack-item\\.is-exiting \\*');
    expect(
      rule.length,
      'MemoBanner.css must keep the .memo-stack-item.is-exiting * rule — without it an exiting bubble (opacity 0, open button not disabled) stays hit-testable for 450ms and a stray click permanently discards the memo',
    ).toBeGreaterThan(0);
    expect(
      rule.some((b) => /pointer-events:\s*none/.test(b)),
      'MemoBanner.css .memo-stack-item.is-exiting * must declare pointer-events: none',
    ).toBe(true);
    // The row's own rule is not sufficient on its own (the open button's
    // auto survives it), but the pair is the shipped shape: row none +
    // descendant none.
    const row = blocksOf(css, '\\.memo-stack-item\\.is-exiting');
    expect(
      row.some((b) => /pointer-events:\s*none/.test(b)),
      'MemoBanner.css .memo-stack-item.is-exiting must keep its own pointer-events: none (paired with the descendant rule)',
    ).toBe(true);
  });
});
