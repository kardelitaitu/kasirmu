//! A11y regression tests for KdsHeaderLeft.
//!
//! The left header cluster: the back button and the filter dropdown. The filter
//! is the only listbox in the KDS, and its options sit inside a
//! `<div className="kds-filter-modes">` wrapper — the same nested-container
//! shape that produced invalid ARIA twice already (the floor plan and the menu
//! grid). axe is asked directly rather than the pattern assumed, and the
//! listbox/option structure is pinned because axe's checks here are partial.

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import { KdsHeaderLeft } from '@/features/kds/components/KdsHeaderLeft';
import kdsFtl from '@/locales/kds.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import type { RefObject } from 'react';

const FTL = [sharedFtl, kdsFtl];

function elemRef<T extends HTMLElement>(tag: string): RefObject<T> {
  return { current: document.createElement(tag) as T };
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    activeTab: 'open' as const,
    completedFilter: 'all' as const,
    filterCats: null,
    filterMode: 'all' as const,
    zones: [] as string[],
    boardFiltered: false,
    filterBtnRef: elemRef<HTMLButtonElement>('button'),
    filterPanelRef: elemRef<HTMLDivElement>('div'),
    showFilter: false,
    setCompletedFilter: vi.fn(),
    setFilterCats: vi.fn(),
    setFilterMode: vi.fn(),
    setShowFilter: vi.fn(),
    goToWorkspacePicker: vi.fn(),
    handleFilterBtnKeyDown: vi.fn(),
    handleFilterPanelKeyDown: vi.fn(),
    ...overrides,
  } as React.ComponentProps<typeof KdsHeaderLeft>;
}

describe('KdsHeaderLeft a11y', () => {
  it('has no axe violations with the filter closed', async () => {
    const { container } = renderWithProviders(<KdsHeaderLeft {...makeProps()} />, ...FTL);
    await checkA11y(container);

    expect(container.querySelector('[data-testid="kds-topbar-back"]')).toBeTruthy();
    const btn = container.querySelector('[data-testid="kds-topbar-filter"]') as HTMLElement;
    expect(btn).toBeTruthy();
    // The trigger owns the popup relationship, which axe does not verify.
    expect(btn.getAttribute('aria-haspopup')).toBe('listbox');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    // Closed: no panel in the DOM.
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('has no axe violations with the OPEN-tab filter panel expanded', async () => {
    const { container } = renderWithProviders(
      <KdsHeaderLeft {...makeProps({ showFilter: true })} />,
      ...FTL,
    );
    await checkA11y(container);

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
    expect(listbox!.getAttribute('aria-label')).toBeTruthy();
    expect(listbox!.getAttribute('aria-expanded')).toBeNull();
    // The trigger now reports expanded.
    const btn = container.querySelector('[data-testid="kds-topbar-filter"]') as HTMLElement;
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    // Multi-select on the Open tab, single-select on Completed.
    expect(listbox!.getAttribute('aria-multiselectable')).toBe('true');
    expect(container.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
  });

  it('has no axe violations with the COMPLETED-tab filter panel expanded', async () => {
    const { container } = renderWithProviders(
      <KdsHeaderLeft
        {...makeProps({ activeTab: 'completed', completedFilter: 'dinein', showFilter: true })}
      />,
      ...FTL,
    );
    await checkA11y(container);

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
    // The Completed branch is single-select.
    expect(listbox!.getAttribute('aria-multiselectable')).toBe('false');
    // Exactly the active option is selected.
    const selected = container.querySelectorAll('[role="option"][aria-selected="true"]');
    expect(selected.length).toBe(1);
    expect(selected[0]!.getAttribute('data-testid')).toBe('kds-filter-completed-dinein');
  });

  it('has no axe violations with a multi-category filter applied', async () => {
    const { container } = renderWithProviders(
      <KdsHeaderLeft
        {...makeProps({
          // The zone options come from this prop; without it the panel has no
          // category rows to be selected at all.
          zones: ['Grill', 'Bar'],
          filterCats: new Set(['Grill', 'Bar']),
          boardFiltered: true,
          showFilter: true,
        })}
      />,
      ...FTL,
    );
    await checkA11y(container);

    // The trigger label reflects the filtered state.
    const btn = container.querySelector('[data-testid="kds-topbar-filter"]') as HTMLElement;
    expect((btn.textContent ?? '').trim()).not.toBe('All Categories');
    expect(container.querySelectorAll('[role="option"][aria-selected="true"]').length).toBe(2);
  });
});
