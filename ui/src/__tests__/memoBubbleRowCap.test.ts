import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/* ── Memo bubble row cap ─────────────────────────────────────────────
 * Owner direction 2026-09-19: the notification bubble shows at most
 * THREE rows of memo text, with the engine's own ellipsis marking the
 * cut. The cap lives in CSS, which jsdom does not compute, so this test
 * scans the stylesheet (same pattern as restaurantCardHeight.test.ts)
 * to pin the contract:
 *
 *   1. The body clamps to 3 rows through every engine path —
 *      `-webkit-line-clamp` (primary), `line-clamp` (standard) and a
 *      `max-height` fallback for an engine without webkit-box.
 *   2. The title clamps to 1 row. It sits OUTSIDE the body's clamp, and
 *      the composer allows a 120-character title
 *      (MemosScreen.tsx:330) that would otherwise wrap and outgrow the
 *      budget the body cap was set to enforce.
 *   3. `overflow: hidden` stays, or the cut text would paint past the
 *      bubble; `overflow-wrap: anywhere` stays, or a long URL would
 *      stretch the adaptive bubble past its cap instead of wrapping.
 *
 * Measured against the running app before landing (2026-09-19): the two
 * six-line dev fixtures are 6 rows unclamped (126px) and exactly 3
 * clamped (63px); 1L/2L/3L bodies measure 1/2/3 rows and are never
 * clamped early; a 99- and a 120-character title both measure 1 row.
 * ────────────────────────────────────────────────────────────────── */

const CSS_PATH = resolve(__dirname, '../features/memo/MemoBanner.css');
const css = readFileSync(CSS_PATH, 'utf-8');

/**
 * Extract the declaration body of the first rule whose selector starts a
 * line. The line anchor is load-bearing: `.memo-banner-text` also occurs
 * as a descendant selector (`.memo-banner-open:hover .memo-banner-text`)
 * EARLIER in the file, and an unanchored match would return that rule's
 * single `color` declaration instead of the clamp.
 */
function ruleBody(selector: string): string | null {
  const match = css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? null;
}

describe('Memo bubble body three-row cap', () => {
  it('clamps the body to exactly three rows on every engine path', () => {
    const body = ruleBody('\\.memo-banner-text');
    expect(body).toBeTruthy();
    // Primary clamp (webkit-box path).
    expect(body).toMatch(/display:\s*-webkit-box/);
    expect(body).toMatch(/-webkit-line-clamp:\s*3/);
    // Standard property for engines without webkit-box support.
    expect(body).toMatch(/line-clamp:\s*3/);
    // Fallback cap = 3 rows x --leading-normal, independent of font-size,
    // so a fourth line is impossible even where line-clamp is unsupported.
    expect(body).toMatch(/max-height:\s*calc\(var\(--leading-normal\)\s*\*\s*3em\)/);
    expect(body).toMatch(/overflow:\s*hidden/);
  });

  it('keeps long unbroken strings wrapping rather than stretching the bubble', () => {
    const body = ruleBody('\\.memo-banner-text');
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('does not fall back to a character-count truncation', () => {
    // The cap is a row budget. A fixed character count cannot hold it:
    // three rows fit 241 characters for a six-line body but 63 for a
    // one-line one, because the capacity depends on the body's own
    // character mix and the bubble's adaptive width.
    const source = readFileSync(
      resolve(__dirname, '../features/memo/MemoBanner.tsx'),
      'utf-8',
    );
    expect(source).not.toMatch(/\.slice\(0,\s*-?\d+\)/);
    expect(source).not.toMatch(/\.substring\(0,\s*\d+\)/);
  });
});

describe('Memo preview three-row total (title spends one of them)', () => {
  it('gives the body two rows when a title is present', () => {
    // Ruling 2026-09-19: "maximum is 3 row" is the whole preview. The title
    // element is conditionally rendered, so this is keyed on :has().
    const titled = ruleBody('\\.memo-banner-open:has\\(\\.memo-banner-title\\) \\.memo-banner-text');
    expect(titled).toBeTruthy();
    expect(titled).toMatch(/-webkit-line-clamp:\s*2/);
    expect(titled).toMatch(/line-clamp:\s*2/);
    expect(titled).toMatch(/max-height:\s*calc\(var\(--leading-normal\)\s*\*\s*2em\)/);
  });

  it('gives the body all three rows when there is no title', () => {
    const body = ruleBody('\\.memo-banner-text');
    expect(body).toMatch(/-webkit-line-clamp:\s*3/);
    expect(body).toMatch(/max-height:\s*calc\(var\(--leading-normal\)\s*\*\s*3em\)/);
  });
});

describe('Memo bubble title one-row cap', () => {
  it('clamps the title to a single row', () => {
    const body = ruleBody('\\.memo-banner-title');
    expect(body).toBeTruthy();
    expect(body).toMatch(/display:\s*-webkit-box/);
    expect(body).toMatch(/-webkit-line-clamp:\s*1/);
    expect(body).toMatch(/line-clamp:\s*1/);
    // The title's own leading, not the body's: it is --leading-tight.
    expect(body).toMatch(/max-height:\s*calc\(var\(--leading-tight\)\s*\*\s*1em\)/);
    expect(body).toMatch(/overflow:\s*hidden/);
  });

  it('keeps the title left-aligned (the 2026-09-19 owner-reported regression)', () => {
    // text-align alone could never move the title: reset.css gives every
    // button `align-items: center`, and a shrink-to-fit title box was
    // centred on the cross axis. The clamp must not reintroduce that.
    const body = ruleBody('\\.memo-banner-title');
    expect(body).toMatch(/text-align:\s*left/);
    const open = ruleBody('\\.memo-banner-open');
    expect(open).toMatch(/align-items:\s*stretch/);
  });
});
