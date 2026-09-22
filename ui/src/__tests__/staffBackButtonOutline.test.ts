import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/* ── Staff back-button chrome guard ──────────────────────────────────
 * The staff page is registered `fullscreen`, so its header carries the only
 * route back to the workspace picker. That button used to declare
 * `border: 1px solid var(--color-border)` on `var(--color-bg-surface)` — the
 * same surface token `.staff-mgmt-header` paints — so the fill was invisible
 * against the bar and a bare outlined square was all that showed at rest. A
 * mouse click leaves no ring (`reset.css`: `:focus:not(:focus-visible)`), so
 * the box never went away.
 *
 * jsdom computes no layout and reports no painted border, so this has to read
 * the sheet. Measured in Chromium against the real `tokens.css` on 2026-09-19:
 * rest went from `1px solid` + opaque fill to `0px none` + transparent, the
 * hover fill and the 2px `:focus-visible` ring both survived, and the box
 * stayed 44x44 in every state. These cases pin that contract:
 *
 *   1. The resting rule paints no box and declares no outline.
 *   2. The hover fill stays — dropping the border must not cost the affordance.
 *   3. The `:focus-visible` ring stays — it is the keyboard user's only cue.
 *   4. The target stays the 44px token now that no border pads the box.
 * ────────────────────────────────────────────────────────────────── */

const css = readFileSync(
  resolve(__dirname, '../features/staff/StaffManagementScreen.css'),
  'utf-8',
);
const tokens = readFileSync(resolve(__dirname, '../theme/tokens.css'), 'utf-8');

/**
 * Declaration bodies of the top-level rules for `selector`.
 *
 * Anchored to a line start with optional indentation so a descendant
 * selector's body cannot be matched first, and global so a selector that
 * legitimately carries two top-level rules yields both — "the first body" is
 * then the wrong one. `.staff-mgmt-back-btn` does not match
 * `.staff-mgmt-back-btn:hover` because `:hover` sits where `{` must be.
 */
function ruleBodies(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)[ \\t]*${escaped}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1]!);
}

function ruleBody(selector: string): string {
  const bodies = ruleBodies(selector);
  expect(bodies, `${selector} must have exactly one top-level rule`).toHaveLength(1);
  return bodies[0]!;
}

describe('Staff back button — no resting box', () => {
  it('paints no border and no fill at rest', () => {
    const body = ruleBody('.staff-mgmt-back-btn');
    expect(body, 'resting border must be suppressed').toMatch(
      /border:\s*none|border:\s*1px\s+solid\s+transparent/,
    );
    expect(body, 'resting border must not be the visible --color-border box').not.toMatch(
      /border:\s*(?!none)1px\s+solid\s+var\(--color-border\)/,
    );
    expect(body, 'resting fill must be transparent so it cannot repaint a box').toMatch(
      /background:\s*transparent/,
    );
  });

  it('declares no outline in the resting rule', () => {
    expect(ruleBody('.staff-mgmt-back-btn')).not.toMatch(/outline\s*:/);
  });

  it('keeps the hover fill that carries the affordance', () => {
    // With no border, the hover fill is the whole hover cue — losing it would
    // trade a resting box for an invisible control.
    expect(ruleBody('.staff-mgmt-back-btn:hover')).toMatch(
      /background:\s*var\(--color-bg-hover\)/,
    );
  });

  it('keeps the keyboard focus ring', () => {
    expect(ruleBody('.staff-mgmt-back-btn:focus-visible')).toMatch(
      /outline:\s*2px\s+solid\s+var\(--color-border-focus\)/,
    );
  });

  it('keeps the full touch target now that no border contributes to the box', () => {
    const body = ruleBody('.staff-mgmt-back-btn');
    expect(body).toMatch(/width:\s*var\(--touch-target-min\)/);
    expect(body).toMatch(/height:\s*var\(--touch-target-min\)/);
    // The rule's own comment cites this token as the repo's stated minimum;
    // pin the value so the citation cannot drift away from it.
    expect(tokens).toMatch(/--touch-target-min:\s*44px/);
  });
});
