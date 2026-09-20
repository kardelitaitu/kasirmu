import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/* ── Tablet tab bar: horizontally swipeable strip ────────────────────
 * The bottom tab bar must scroll horizontally rather than squeeze its tabs.
 * jsdom computes no CSS, so this scans the stylesheet (same pattern as
 * restaurantCardHeight.test.ts / touchTargetSizing.test.tsx) and pins the
 * contract the swipe behaviour rests on:
 *
 *   1. The bar is a scroll container (`overflow-x: auto`).
 *   2. Items keep their natural width (`flex: 0 0 auto`), so a long strip
 *      overflows and scrolls instead of compressing below its labels.
 *   3. `justify-content` is `safe center`, never plain `center`: plain
 *      `center` pushes leading tabs to a negative offset that a scroll
 *      container cannot reach, making the first tabs unreachable.
 *   4. Horizontal panning is the bar's own gesture and does not steal the
 *      page's vertical scroll.
 *   5. The bar stays fixed chrome — fixed height, bottom inset consumed.
 * ────────────────────────────────────────────────────────────────── */

const CSS_PATH = resolve(__dirname, '../app/tablet/tablet.css');
const css = readFileSync(CSS_PATH, 'utf-8');

const BAR = '.tablet-shell .tablet-tab-bar';
const ITEM = '.tablet-shell .tablet-tab-item';
const NAV = '.tablet-shell .tablet-tab-bar-nav';
const LABEL = '.tablet-shell .tablet-tab-label';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every top-level declaration body for `selector`.
 *
 * Anchored to a line start so a descendant selector's body cannot be
 * mistaken for this one, but tolerant of leading whitespace so rules nested
 * inside `@media` blocks still match.
 */
function ruleBodies(selector: string): string[] {
  const re = new RegExp(`(?:^|\\n)[ \\t]*${escapeRe(selector)}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1]!);
}

function ruleBody(selector: string): string {
  const bodies = ruleBodies(selector);
  expect(bodies.length, `expected exactly one rule for ${selector}`).toBeGreaterThan(0);
  return bodies[0]!;
}

describe('tablet tab bar scrolls horizontally', () => {
  it('is a horizontal scroll container', () => {
    const body = ruleBody(BAR);
    expect(body).toMatch(/overflow-x:\s*auto/);
    // Without this the strip can pick up a vertical scrollbar and shift the
    // bar's height mid-scroll.
    expect(body).toMatch(/overflow-y:\s*hidden/);
  });

  it('keeps every tab at its natural width so the strip overflows', () => {
    // The flex default (`flex-shrink: 1`) lets a long strip compress items
    // below their own labels instead of overflowing — the bug that made the
    // bar look like it "fit" while dropping tabs.
    expect(ruleBody(ITEM)).toMatch(/flex:\s*0 0 auto/);
    expect(ruleBody(NAV)).toMatch(/flex:\s*0 0 auto/);
  });

  it('uses `safe center`, never plain `center`', () => {
    const body = ruleBody(BAR);
    expect(body).toMatch(/justify-content:\s*safe center/);
    // Plain `center` is the trap: once the strip overflows, the leading tabs
    // sit at a negative offset a scroll container cannot scroll back to.
    expect(body).not.toMatch(/justify-content:\s*center\s*;/);
    // `space-around` was the pre-scroll layout, which squeezed tabs instead.
    expect(body).not.toMatch(/justify-content:\s*space-around/);
  });

  it('owns the horizontal pan without stealing the page vertical scroll', () => {
    const body = ruleBody(BAR);
    expect(body).toMatch(/touch-action:\s*pan-x/);
    expect(body).toMatch(/overscroll-behavior-x:\s*contain/);
  });

  it('hides the scrollbar so it cannot sit on top of the labels', () => {
    expect(ruleBody(BAR)).toMatch(/scrollbar-width:\s*none/);
    // Firefox has no ::-webkit-scrollbar, so the webkit rule must exist too.
    const webkit = ruleBodies(`${BAR}::-webkit-scrollbar`);
    expect(webkit.length).toBeGreaterThan(0);
    expect(webkit.join('\n')).toMatch(/display:\s*none/);
  });

  it('stays fixed chrome: fixed height and the bottom display inset', () => {
    const body = ruleBody(BAR);
    expect(body).toMatch(/height:\s*var\(--tablet-bottom-nav-height\)/);
    expect(body).toMatch(/min-height:\s*var\(--tablet-bottom-nav-height\)/);
    // The inset is applied here, not re-derived from env() — the token layer
    // reads env() once (see ui/src/theme/tokens.css).
    expect(body).toMatch(/padding-bottom:\s*var\(--inset-bottom\)/);
    expect(body).not.toMatch(/env\(safe-area-inset/);
  });

  it('styles the label, which the component renders but nothing styled before', () => {
    // A wrapping label makes one tab taller than its neighbours and defeats
    // the fixed bar height.
    expect(ruleBody(LABEL)).toMatch(/white-space:\s*nowrap/);
  });
});
