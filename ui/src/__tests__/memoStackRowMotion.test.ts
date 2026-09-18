import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/* ── Memo stack row motion ───────────────────────────────────────────
 * Owner report 2026-09-19: "when it spawned / moves / slides … did not
 * feel smooth, there's some kind of lags or glitch". Measured in a
 * HEADED browser (headless drives rAF from a virtual clock and cannot
 * see jank): the frame clock is clean — p50 16.7ms, zero frames over
 * 20ms, zero long tasks, ~8% main-thread busy — so the fault was never
 * performance. It was two discontinuities, both fixed here.
 *
 *   1. A bare `0fr` track is `minmax(auto, 0fr)`, and that `auto`
 *      MINIMUM is the item's content-based minimum, so the "collapsed"
 *      row floored at the bubble's min-content height (measured 23px)
 *      instead of 0. `minmax(0, 0fr)` collapses to a measured 0px.
 *      `min-height: 0` on the bubble does NOT help (the floor belongs to
 *      the track) and `overflow: hidden` on the row does not either.
 *
 *   2. The stack's flex `gap` sits BETWEEN items, so it is not part of
 *      the track and cannot be animated by `grid-template-rows`. A
 *      mounting row therefore added its whole gap in one frame — a
 *      measured 7px lurch of the stack's top edge and height with the
 *      spring still at rest — and the mirror −7px drop on unmount. The
 *      row cancels the gap with a negative margin that animates back to
 *      0 in step with the track: both jumps measured 0px afterwards,
 *      and the resting geometry is unchanged because gap + margin
 *      cancel exactly.
 *
 *   3. The spawn delay used to be the row's ABSOLUTE index, so a lone
 *      memo arriving while two others were on screen carried
 *      `transition-delay: 0.12s` and sat motionless for 120ms after its
 *      row had already mounted. It is now the row's position within the
 *      batch of rows appearing in that render — a 2-row first load still
 *      staggers 0/60ms, while a single arrival starts immediately — and
 *      the value is frozen at mount so a later re-render cannot cancel
 *      the stagger of a row that has not begun to animate.
 * ────────────────────────────────────────────────────────────────── */

const CSS_PATH = resolve(__dirname, '../features/memo/MemoBanner.css');
const TSX_PATH = resolve(__dirname, '../features/memo/MemoBanner.tsx');
const css = readFileSync(CSS_PATH, 'utf-8');
const source = readFileSync(TSX_PATH, 'utf-8');

/**
 * All rule bodies for a selector, including indented rules inside
 * `@media`. The line anchor keeps `.memo-stack-item` from matching the
 * descendant forms (`.memo-stack-item.is-mounted`, `…:not(…) .memo-banner`).
 */
function ruleBodies(selector: string): string[] {
  const re = new RegExp(`(?:^|\\n)\\s*${selector}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1] ?? '');
}

function ruleBody(selector: string): string | null {
  return ruleBodies(selector)[0] ?? null;
}

describe('Memo stack row collapse', () => {
  it('pins the collapsed track to an explicit 0 minimum, never a bare 0fr', () => {
    const row = ruleBody('\\.memo-stack-item');
    expect(row).toBeTruthy();
    // A bare `0fr` is minmax(auto, 0fr); the auto minimum is the item's
    // content-based minimum, which measured 23px on the collapsed row.
    expect(row).not.toMatch(/grid-template-rows:\s*0fr/);
    expect(row).toMatch(/grid-template-rows:\s*minmax\(0,\s*0fr\)/);
    expect(ruleBody('\\.memo-stack-item\\.is-mounted')).toMatch(
      /grid-template-rows:\s*minmax\(0,\s*1fr\)/,
    );
    expect(ruleBody('\\.memo-stack-item\\.is-exiting')).toMatch(
      /grid-template-rows:\s*minmax\(0,\s*0fr\)/,
    );
  });

  it('cancels the stack flex gap on a collapsed row, with the same token', () => {
    // The gap is between flex items, so grid-template-rows cannot animate
    // it: without the cancellation a mounting row lurches the whole stack
    // 7px in one frame. The two must reference the SAME token or the
    // cancellation stops being exact and the jump returns.
    const gapToken = ruleBody('\\.memo-stack')?.match(/gap:\s*var\((--[\w-]+)\)/)?.[1];
    expect(gapToken).toBeTruthy();
    const cancelToken = ruleBody('\\.memo-stack-item')?.match(
      /margin-top:\s*calc\(-1\s*\*\s*var\((--[\w-]+)\)\)/,
    )?.[1];
    expect(cancelToken).toBe(gapToken);
    // Mounted rows must release it again, or the resting geometry shrinks.
    expect(ruleBody('\\.memo-stack-item\\.is-mounted')).toMatch(/margin-top:\s*0/);
    // The leaver must release it too, so unmount removes a 0-height row.
    expect(ruleBody('\\.memo-stack-item\\.is-exiting')).toMatch(
      /margin-top:\s*calc\(-1\s*\*\s*var\(--[\w-]+\)\)/,
    );
  });

  it('animates the margin in step with the track, on both spawn and exit', () => {
    // A margin that snaps while the track springs would trade one jump for
    // another. Every transition that drives grid-template-rows must drive
    // margin-top with the same timing.
    for (const selector of ['\\.memo-stack-item', '\\.memo-stack-item\\.is-exiting']) {
      const transitions = ruleBodies(selector).filter((b) => /transition\s*:/.test(b));
      expect(transitions.length).toBeGreaterThan(0);
      for (const body of transitions) {
        expect(body).toMatch(/grid-template-rows[^;]*,\s*margin-top/);
      }
    }
  });
});

describe('Memo stack spawn stagger', () => {
  it('staggers within the render batch, not by absolute list position', () => {
    // The absolute index gave a lone arrival a 120ms dead stall at
    // position 2, with its row already mounted.
    expect(source).not.toMatch(/index=\{index\}/);
    expect(source).toMatch(/staggerIndex=\{/);
    expect(source).toMatch(/--memo-delay/);
  });

  it('freezes the delay at mount so a re-render cannot cancel it', () => {
    // The batch index is only meaningful for the render that introduces
    // the row; a poll or unrelated state change would recompute it to 0.
    expect(source).toMatch(/useState\(\(\)\s*=>\s*staggerIndex\s*\*\s*SPAWN_STAGGER_MS\)/);
    expect(source).not.toMatch(/\$\{staggerIndex \* SPAWN_STAGGER_MS\}ms/);
  });
});
