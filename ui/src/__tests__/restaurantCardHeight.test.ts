import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/* ── Menu-card uniform height guard ──────────────────────────────────
 * The restaurant menu grid must render every card at the same height
 * regardless of content length. The rule lives in CSS, which jsdom does
 * not compute, so this test scans the stylesheet (same pattern as
 * touchTargetSizing.test.tsx) to pin the contract:
 *
 *   1. `.restaurant-card` declares a fixed `height` (not `min-height`)
 *      so rows never grow with the tallest card's content.
 *   2. The formula scales with both the card-size and font-size controls
 *      so the two-line name + price + status chip always fit.
 *   3. `overflow: hidden` stays in place so nothing bleeds out of the box.
 * ────────────────────────────────────────────────────────────────── */

const CSS_PATH = resolve(__dirname, '../features/restaurant/RestaurantMenu.css');
const css = readFileSync(CSS_PATH, 'utf-8');

/** Extract the declaration body of the first matching top-level rule. */
function ruleBody(selector: string): string | null {
  const re = new RegExp(`${selector}\\s*\\{([^}]*)\\}`);
  const match = css.match(re);
  return match?.[1] ?? null;
}

describe('RestaurantMenu card uniform height', () => {
  it('declares a fixed height (not min-height) so every box is the same size', () => {
    const body = ruleBody('\\.restaurant-card');
    expect(body).toBeTruthy();
    expect(body).toMatch(/height:\s*calc\(/);
    // min-height would let rows grow with the tallest card — a regression
    // the uniform-height contract explicitly forbids.
    expect(body).not.toMatch(/min-height:/);
  });

  it('scales the height with both the card-size and font-size controls', () => {
    const body = ruleBody('\\.restaurant-card');
    // Slimmed in the "reduce the height ratio" pass: 14px per card-size
    // step (was 16px) and 8px per font-size step (was 10px).
    expect(body).toMatch(/var\(--card-size, 0\)\s*\* 14px/);
    expect(body).toMatch(/var\(--font-size, 0\)\s*\* 8px/);
  });

  it('keeps overflow hidden so content cannot bleed out of the fixed box', () => {
    const body = ruleBody('\\.restaurant-card');
    expect(body).toMatch(/overflow:\s*hidden/);
  });

  it('fits the two-line name plus price and status chip at the smallest settings', () => {
    // Base = --space-14 (3.5rem) + --space-8 (2rem) + --space-1 (0.25rem)
    // = 5.75rem = 92px at card-size 0 / font-size 0 (80.5px at the app's
    // 14px root). Live-preview verified 2026-08-06: forcing a long
    // two-line name clamps at exactly 2 lines with contentOverflow 0 and
    // the price + status chip fully visible (≈15px and ≈26px clearance),
    // and the fit holds (with more headroom) at card-size 2 / font-size 2.
    const body = ruleBody('\\.restaurant-card');
    const baseMatch = body?.match(/var\(--space-14\)\s*\+\s*var\(--space-8\)\s*\+\s*var\(--space-1\)/);
    expect(baseMatch).toBeTruthy();
    // Sanity: the two space tokens resolve to known sizes in tokens.css.
    const tokens = readFileSync(resolve(__dirname, '../theme/tokens.css'), 'utf-8');
    expect(tokens).toMatch(/--space-14:\s*3\.5rem/);
    expect(tokens).toMatch(/--space-8:\s*2rem/);
    expect(tokens).toMatch(/--space-1:\s*0\.25rem/);
  });
});

describe('RestaurantMenu card title two-line cap', () => {
  it('clamps the menu title to at most two lines', () => {
    const body = ruleBody('\\.restaurant-card-name');
    expect(body).toBeTruthy();
    // Primary clamp (webkit-box path).
    expect(body).toMatch(/display:\s*-webkit-box/);
    expect(body).toMatch(/-webkit-line-clamp:\s*2/);
    // Standard property for engines without webkit-box support.
    expect(body).toMatch(/line-clamp:\s*2/);
    // Fallback cap = 2 lines x --leading-normal, independent of font-size,
    // so a third line is impossible even where line-clamp is unsupported.
    expect(body).toMatch(/max-height:\s*calc\(var\(--leading-normal\)\s*\*\s*2em\)/);
    expect(body).toMatch(/overflow:\s*hidden/);
  });
});
