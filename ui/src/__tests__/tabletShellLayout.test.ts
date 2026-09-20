import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/* ── Tablet shell: the tab bar belongs at the BOTTOM ─────────────────
 * `TabletAppLayout` documents a "bottom tab bar (thumb-reachable)", the
 * height token is `--tablet-bottom-nav-height`, and the bar consumes
 * `padding-bottom: var(--inset-bottom)` — but the bar rendered at the TOP
 * of the screen for ~7 weeks.
 *
 * Cause: `.tablet-shell .app-layout` carried `flex-direction: column-reverse`
 * from the file's creation while having NO `display: flex`. It stayed a block,
 * so the children stacked in DOM order [skip, main, nav] and the bar landed at
 * the bottom. Adding `display: flex` (ed6ec31f8, 2026-08-02) activated the
 * dormant `column-reverse`, which reverses that order and moved the bar to the
 * top. Measured in Chromium at 1024x1366: bar at y 0-65, content from 65;
 * with `column`, bar at y 1301-1366.
 *
 * The rule is a pair, so this pins the pair: `display: flex` together with
 * `flex-direction: column`. Flipping either one alone re-breaks the edge.
 * The DOM order the pair depends on is pinned in TabletAppLayout.test.tsx
 * ("places the tab bar after the main content in DOM order").
 * ────────────────────────────────────────────────────────────────── */

const CSS_PATH = resolve(__dirname, '../app/tablet/tablet.css');
const css = readFileSync(CSS_PATH, 'utf-8');

const APP_LAYOUT = '.tablet-shell .app-layout';
const TAB_BAR = '.tablet-shell .tablet-tab-bar';
const SHELL = '.tablet-shell';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ruleBody(selector: string): string {
  const re = new RegExp(`(?:^|\\n)[ \\t]*${escapeRe(selector)}\\s*\\{([^}]*)\\}`, 'g');
  const bodies = [...css.matchAll(re)].map((m) => m[1]!);
  expect(bodies.length, `expected a rule for ${selector}`).toBeGreaterThan(0);
  return bodies[0]!;
}

function ruleBodies(selector: string): string[] {
  const re = new RegExp(`(?:^|\\n)[ \\t]*${escapeRe(selector)}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1]!);
}

describe('tablet shell keeps the tab bar at the bottom', () => {
  it('makes .app-layout a flex column — not a reversed one', () => {
    const body = ruleBody(APP_LAYOUT);
    // `column` + DOM order [main, nav] = bar at the bottom. `column-reverse`
    // reverses that and puts the bar under the status bar.
    expect(body).toMatch(/flex-direction:\s*column\s*;/);
    expect(body).not.toMatch(/column-reverse/);
  });

  it('declares display: flex, which is what makes flex-direction apply at all', () => {
    // The original defect was an inert `column-reverse`: no `display: flex`
    // meant the direction was ignored. Asserting only the direction would
    // let the pair drift apart again.
    expect(ruleBody(APP_LAYOUT)).toMatch(/display:\s*flex/);
  });

  it('sizes the layout to the shell, and the shell to the viewport', () => {
    // `.app-layout` used to re-assert `100dvh` INSIDE a shell that had already
    // subtracted its display insets, so the two added up. Measured in Chromium
    // at 1097x686 with --inset-top 32 / --inset-bottom 24: the shell's border
    // box was 742px, the bar's bottom edge sat 32px past the fold and the
    // document scrolled. The shell owns the viewport height; the layout fills
    // whatever the shell has left.
    const layout = ruleBody(APP_LAYOUT);
    expect(layout).toMatch(/height:\s*100%\s*;/);
    // Declaration-specific on purpose: a comment inside the body would satisfy a
    // bare `/100dvh/` search in the wrong direction.
    expect(layout).not.toMatch(/height:\s*100dvh/);
    expect(layout).toMatch(/overflow:\s*hidden/);

    // `.tablet-shell` is declared more than once, so find the body that carries
    // the height rather than assuming it is the first one.
    const shell = ruleBodies(SHELL).find((b) => /height:\s*100dvh/.test(b));
    expect(shell, 'the shell must pin itself to the viewport').toBeTruthy();
  });

  it('keeps the bar consuming the bottom display inset', () => {
    // A bottom-edge signal: the inset is only correct at the bottom.
    expect(ruleBody(TAB_BAR)).toMatch(/padding-bottom:\s*var\(--inset-bottom\)/);
  });
});
