// ── SegmentedTabs keyboard contract ────────────────────────────────
//
// Pins the WAI-ARIA tabs pattern the shared control implements since the
// scroll viewport landed: a roving tabindex keeps exactly one segment in the
// tab order (the active one; the first when the active value is gated out of
// `items`), ArrowLeft/ArrowRight move focus AND select with wrap-around,
// Home/End jump to the ends, and other keys are ignored. The pattern and its
// shape are the tablet shell's bottom bar (TabletAppLayout.tsx, A11Y-03/05),
// whose suite these cases mirror.
//
// Rendered directly against the component — no adopter, no Fluent — because
// the contract belongs to the shared control, not to any screen that mounts it.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedTabs } from '@/components/SegmentedTabs';

// jsdom has no scrollIntoView; the mock lets the suite assert the
// scroll-into-view call the keyboard handler must make (Chromium does not
// scroll an overflow viewport on programmatic focus — see the component doc).
Element.prototype.scrollIntoView = vi.fn();

const ITEMS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
  { value: 'd', label: 'Delta' },
] as const;

function renderStrip(activeValue: (typeof ITEMS)[number]['value'] | string = 'a') {
  const onSelect = vi.fn();
  const utils = render(
    <SegmentedTabs items={ITEMS} activeValue={activeValue as never} onSelect={onSelect} ariaLabel="Test tabs" />,
  );
  return { onSelect, rerender: utils.rerender };
}

const tabByLabel = (label: string) => screen.getByText(label).closest('button')!;

describe('SegmentedTabs keyboard pattern', () => {
  it('keeps only the active segment in the tab order (roving tabindex)', () => {
    renderStrip('b');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    tabs.forEach((tab) => {
      expect(tab.getAttribute('tabindex')).toBe(tab === tabByLabel('Bravo') ? '0' : '-1');
    });
  });

  it('leaves the first segment as the tab stop when the active value is gated out', () => {
    renderStrip('z');
    const tabs = screen.getAllByRole('tab');
    tabs.forEach((tab) => {
      expect(tab.getAttribute('tabindex')).toBe(tab === tabByLabel('Alpha') ? '0' : '-1');
      expect(tab.getAttribute('aria-selected')).toBe('false');
    });
    // The thumb parks on column 0 rather than translating to a column that
    // no longer exists.
    const indicator = document.querySelector('.segmented-tab-indicator') as HTMLElement;
    expect(indicator.style.getPropertyValue('--segmented-tab-index')).toBe('0');
  });

  it('moves focus and selects with the Right arrow (automatic activation)', async () => {
    const { onSelect } = renderStrip('a');
    const user = userEvent.setup();
    tabByLabel('Alpha').focus();
    await user.keyboard('{ArrowRight}');

    expect(onSelect).toHaveBeenCalledWith('b');
    expect(tabByLabel('Bravo')).toHaveFocus();
    // And scrolls the newly focused segment into the overflow viewport
    // itself — the browser will not do it for a programmatic focus().
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
  });

  it('wraps from the first segment with the Left arrow and from the last with the Right', async () => {
    const { onSelect } = renderStrip('a');
    const user = userEvent.setup();
    tabByLabel('Alpha').focus();
    await user.keyboard('{ArrowLeft}');
    expect(onSelect).toHaveBeenLastCalledWith('d');
    expect(tabByLabel('Delta')).toHaveFocus();

    onSelect.mockClear();
    tabByLabel('Delta').focus();
    await user.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenLastCalledWith('a');
    expect(tabByLabel('Alpha')).toHaveFocus();
  });

  it('jumps to the first segment with Home and the last with End', async () => {
    const { onSelect } = renderStrip('c');
    const user = userEvent.setup();
    tabByLabel('Charlie').focus();
    await user.keyboard('{End}');
    expect(onSelect).toHaveBeenLastCalledWith('d');

    await user.keyboard('{Home}');
    expect(onSelect).toHaveBeenLastCalledWith('a');
    expect(tabByLabel('Alpha')).toHaveFocus();
  });

  it('moves from FOCUS, not from the selection, when the two diverge', async () => {
    // Selection changed to Charlie while focus stayed on Alpha (a caller
    // reset the filter, say). The next Right arrow must move from where
    // focus sits — Alpha → Bravo — not from the selection — Charlie → Delta.
    const { onSelect, rerender } = renderStrip('a');
    const user = userEvent.setup();
    tabByLabel('Alpha').focus();

    rerender(
      <SegmentedTabs items={ITEMS} activeValue="c" onSelect={onSelect} ariaLabel="Test tabs" />,
    );
    expect(tabByLabel('Alpha')).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenLastCalledWith('b');
  });

  it('ignores non-navigation keys on the strip', async () => {
    // Character keys do nothing. Enter and Space are NOT asserted here: they
    // natively activate the focused <button>, which selects — browser
    // behaviour, not this pattern's business.
    const { onSelect } = renderStrip('a');
    const user = userEvent.setup();
    tabByLabel('Alpha').focus();
    await user.keyboard('a');
    expect(onSelect).not.toHaveBeenCalled();
    expect(tabByLabel('Alpha')).toHaveFocus();
  });

  it('does not hijack arrows when focus is not on a segment', () => {
    // The handler lives on the tablist; a keydown aimed at it while nothing
    // inside holds focus must fall through (no preventDefault, no select) so
    // an outer handler — a screen's own arrow handling — still sees it.
    const { onSelect } = renderStrip('a');
    const track = document.querySelector('.segmented-tabs') as HTMLElement;
    const event = fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(event).toBe(true); // not preventDefault()-ed
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ── SegmentedTabs box contract ──────────────────────────────────────
//
// The control's box is meant to BE the primary button's box, so a segmented
// control reads as the same control family as the buttons beside it ("Add
// Staff" on the staff page). jsdom computes no layout, so the coupling is only
// readable off the sheets. MEASURED in Chromium 2026-09-19 against the real
// tokens.css: a literal 32px matched "Add Staff" only at a 16px root — at the
// 14px root a narrow window gets, the button is 28.25px, at the 125% zoom
// preset 39.5px, at 150% 47px, at 200% 62px, while the pill stayed 32px.
// Derived, the two agree to 0px at all five, and the track stays exactly 8px
// taller than the pill (its 3px padding + 1px border per side), so the pill
// can never overflow the track.
//
// Two couplings make the pill's height equal the button's, and these cases pin
// both: (a) the segment's box is .btn--md's border-box arithmetic, and (b) the
// thumb is inset by the track's OWN padding, so it spans exactly that segment
// box instead of carrying a height of its own.

describe('SegmentedTabs box contract', () => {
  /** Drop CSS comments: these contracts read DECLARATIONS, and a comment that
   *  discusses a property must not be able to satisfy or trip an assertion
   *  about it (this file's own rule comment talks about `line-height`). */
  const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');

  const css = stripComments(
    readFileSync(resolve(__dirname, '..', 'components', 'SegmentedTabs.css'), 'utf8'),
  );
  const buttonCss = stripComments(
    readFileSync(resolve(__dirname, '..', 'theme', 'components.css'), 'utf8'),
  );

  /**
   * The single top-level rule body for `selector`. Anchored to a line start
   * with optional indentation so a descendant selector's body cannot be matched
   * first, and collected globally so a selector with two top-level rules is
   * reported rather than silently read as its first body.
   */
  function ruleBody(source: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|\\n)[ \\t]*${escaped}\\s*\\{([^}]*)\\}`, 'g');
    const bodies = [...source.matchAll(re)].map((m) => m[1]!);
    expect(bodies, `${selector} must have exactly one top-level rule`).toHaveLength(1);
    return bodies[0]!;
  }

  it("sizes the segment as .btn--md's border-box, in .btn--md's own tokens", () => {
    const body = ruleBody(css, '.segmented-tab');
    expect(body).toMatch(
      /min-height:\s*calc\(var\(--text-base\)\s*\+\s*2\s*\*\s*var\(--space-2\)\s*\+\s*2px\)/,
    );
    // The literal this replaced matched the button only at a 16px root, so its
    // return would silently reinstate the mismatch at every other root size.
    expect(body).not.toMatch(/min-height:\s*\d+px/);
  });

  it('derives that sum from the real button rather than a guess', () => {
    // If any of these move, the calc above is stale — and this case says why.
    const btn = ruleBody(buttonCss, '.btn');
    expect(btn).toMatch(/line-height:\s*1\s*;/);
    expect(btn).toMatch(/padding:\s*var\(--space-2\)\s+var\(--space-4\)/);
    expect(btn).toMatch(/border:\s*1px\s+solid\s+transparent/);
    expect(ruleBody(buttonCss, '.btn--md')).toMatch(/font-size:\s*var\(--text-base\)/);
  });

  it('centres the glyph with flex rather than a line-height literal', () => {
    // Recorded decision (themeTokenCompliance.test.ts, restated 2026-09-19):
    // the segment centres its glyph with flex, so `line-height: 1` is not the
    // step to take here — it would also spread a new frozen literal.
    const body = ruleBody(css, '.segmented-tab');
    expect(body).not.toMatch(/line-height\s*:/);
    expect(body).toMatch(/align-items:\s*center/);
  });

  it('insets the thumb by the track padding, so it spans exactly the segment box', () => {
    expect(ruleBody(css, '.segmented-tabs')).toMatch(/padding:\s*3px/);
    const thumb = ruleBody(css, '.segmented-tab-indicator');
    expect(thumb).toMatch(/top:\s*3px/);
    expect(thumb).toMatch(/bottom:\s*3px/);
    // No height of its own: a height here would decouple the pill from the
    // segment box — exactly the regression this pins against.
    expect(thumb).not.toMatch(/(?:^|[;\s])(?:min-)?height\s*:/);
  });
});
