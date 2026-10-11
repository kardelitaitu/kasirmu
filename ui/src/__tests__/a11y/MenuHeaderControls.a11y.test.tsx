//! A11y regression tests for the restaurant menu header strip:
//! MenuCategoryTabBar (the category tablist) and MenuSearchBar.
//!
//! These are the two controls above the product grid — the category pills and
//! the search field — and neither had axe coverage.
//!
//! The tab strip hand-rolls the ARIA tab pattern (role="tablist" + role="tab" +
//! roving tabindex), which is exactly the kind of wiring axe is good at grading,
//! so it is asked rather than assumed. Names come from the REAL products bundle.

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import { MenuCategoryTabBar } from '@/features/restaurant/components/MenuCategoryTabBar';
import { MenuSearchBar } from '@/features/restaurant/components/MenuSearchBar';
import productsFtl from '@/locales/products.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import { useRef } from 'react';

const FTL = [sharedFtl, productsFtl];

describe('MenuCategoryTabBar a11y', () => {
  it('has no axe violations with an active category', async () => {
    const { container } = renderWithProviders(
      <MenuCategoryTabBar
        options={['All', 'Makanan', 'Minuman']}
        active="Makanan"
        onSelect={vi.fn()}
        metaMap={new Map()}
      />,
      ...FTL,
    );
    await checkA11y(container);

    // Vacuity guard + structural pin. axe does NOT flag a role="tab" outside a
    // tablist for a <button>, so the role wiring is asserted directly rather
    // than left to axe: this strip's whole contract is the tab pattern.
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    expect(tablist!.getAttribute('aria-label')).toBeTruthy();
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(3);
    // Exactly one tab is selected, and only the selected tab is tabbable —
    // that is what makes the strip a single Tab stop.
    expect(container.querySelectorAll('[role="tab"][aria-selected="true"]').length).toBe(1);
    expect(container.querySelectorAll('[role="tab"][tabindex="0"]').length).toBe(1);
    // Every tab must be a direct child of the tablist, not merely nearby.
    for (const tab of Array.from(tabs)) {
      expect(tab.parentElement).toBe(tablist);
    }
  });
});

function SearchHarness({ value = '' }: { value?: string }) {
  const contextMenuOpenRef = useRef(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  return (
    <MenuSearchBar
      value={value}
      onChange={vi.fn()}
      menuOpen={false}
      contextMenuOpenRef={contextMenuOpenRef}
      popoverRef={popoverRef}
    />
  );
}

describe('MenuSearchBar a11y', () => {
  it('has no axe violations when empty', async () => {
    const { container } = renderWithProviders(<SearchHarness />, ...FTL);
    await checkA11y(container);

    // Vacuity guard + name-source pin. axe accepts the field's PLACEHOLDER as
    // its accessible name, so removing the aria-label would not fail axe — but
    // a placeholder is not a label, and this field has a real one.
    const input = container.querySelector('.restaurant-search-input') as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(
      input!.getAttribute('aria-label'),
      'the search field lost its aria-label and is named only by its placeholder',
    ).toBeTruthy();
  });

  it('has no axe violations with a query typed (clear button shown)', async () => {
    const { container } = renderWithProviders(<SearchHarness value="nasi" />, ...FTL);
    await checkA11y(container);

    // The clear button only appears with content, so it is its own surface.
    expect(container.querySelector('.restaurant-search-clear')).toBeTruthy();
  });
});
