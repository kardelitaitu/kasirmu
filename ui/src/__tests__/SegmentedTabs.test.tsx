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
