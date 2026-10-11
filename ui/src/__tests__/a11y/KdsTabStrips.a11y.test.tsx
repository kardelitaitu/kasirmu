//! A11y regression tests for the two KDS tab strips: KdsHeaderTabs (the
//! Open/Completed switcher) and KdsZoneChips (the kitchen-zone filter).
//!
//! Both hand-roll the ARIA tab pattern (role="tablist" + role="tab" + roving
//! tabindex). axe does NOT enforce tab->tablist parenting for <button role="tab">,
//! so — as learned on the restaurant category strip — the structure is pinned by
//! assertion rather than left to axe alone.

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import { KdsHeaderTabs } from '@/features/kds/components/KdsHeaderTabs';
import { KdsZoneChips } from '@/features/kds/components/KdsZoneChips';
import kdsFtl from '@/locales/kds.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { RefObject } from 'react';

const FTL = [sharedFtl, kdsFtl];

// The components type their refs as RefObject<T> (non-nullable current), so the
// helper must match exactly rather than widening to T | null.
function ref<T>(v: T): RefObject<T> {
  return { current: v };
}

describe('KdsHeaderTabs a11y', () => {
  it('has no axe violations with the Open tab active', async () => {
    const { container } = renderWithProviders(
      <KdsHeaderTabs
        activeTab="open"
        setActiveTab={vi.fn()}
        openCount={3}
        tabIndicator={{ left: 0, width: 100 }}
        tabsTrackRef={ref<HTMLDivElement>(document.createElement('div'))}
        tabOpenRef={ref<HTMLButtonElement>(document.createElement('button'))}
        tabCompletedRef={ref<HTMLButtonElement>(document.createElement('button'))}
        tabIndicatorRef={ref<HTMLSpanElement>(document.createElement('span'))}
      />,
      ...FTL,
    );
    await checkA11y(container);

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    expect(tablist!.getAttribute('aria-label')).toBeTruthy();
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(2);
    expect(container.querySelectorAll('[role="tab"][aria-selected="true"]').length).toBe(1);
    // Every tab must be a direct child of the tablist — the sliding indicator
    // span lives alongside them, so this also pins that it did not become one.
    for (const tab of Array.from(tabs)) {
      expect(tab.parentElement).toBe(tablist);
    }
  });
});

describe('KdsZoneChips a11y', () => {
  it('has no axe violations with zones and "All" selectable', async () => {
    const zoneTabRefs = { current: [] as Array<HTMLButtonElement | null> };
    const { container } = renderWithProviders(
      <KdsZoneChips
        zones={['Grill', 'Bar']}
        activeZone=""
        onSelectZone={vi.fn()}
        onKeyDown={vi.fn()}
        zoneTabRefs={zoneTabRefs}
      />,
      ...FTL,
    );
    await checkA11y(container);

    // "All" plus one chip per zone.
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(3);
    expect(container.querySelectorAll('[role="tab"][aria-selected="true"]').length).toBe(1);
    expect(container.querySelectorAll('[role="tab"][tabindex="0"]').length).toBe(1);
    // The ref array the roving handler walks is filled in the same order.
    expect(zoneTabRefs.current.filter(Boolean).length).toBe(3);
  });

  it('renders nothing when there are no zones', async () => {
    const { container } = renderWithProviders(
      <KdsZoneChips
        zones={[]}
        activeZone=""
        onSelectZone={vi.fn()}
        onKeyDown={vi.fn()}
        zoneTabRefs={{ current: [] }}
      />,
      ...FTL,
    );
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});
