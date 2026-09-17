/**
 * Tests for `groupBySection` in `AppLayout.tsx` — sidebar nav grouping.
 *
 * The function orders groups by the canonical SECTION_ORDER, falls back
 * to 'settings' for items without a section, and never emits empty
 * groups.
 */

import { describe, expect, it } from 'vitest';
import { groupBySection } from '@/app/AppLayout';

type Section = 'operations' | 'sales' | 'products' | 'finance' | 'customers' | 'reports' | 'inventory' | 'tools' | 'settings' | 'dev';

const item = (route: string, section?: Section): { route: string; section?: Section } =>
  section === undefined ? { route } : { route, section };

describe('groupBySection', () => {
  it('returns an empty list for no items', () => {
    expect(groupBySection([])).toEqual([]);
  });

  it('groups items by their section', () => {
    const grouped = groupBySection([
      item('a', 'sales'),
      item('b', 'sales'),
      item('c', 'dev'),
    ]);
    expect(grouped.map((g) => g.section)).toEqual(['sales', 'dev']);
    expect(grouped[0]!.items.map((i) => i.route)).toEqual(['a', 'b']);
    expect(grouped[1]!.items.map((i) => i.route)).toEqual(['c']);
  });

  it('orders groups by the canonical SECTION_ORDER, not first-seen order', () => {
    // 'dev' is registered first but must appear last.
    const grouped = groupBySection([
      item('d', 'dev'),
      item('o', 'operations'),
      item('s', 'settings'),
    ]);
    expect(grouped.map((g) => g.section)).toEqual(['operations', 'settings', 'dev']);
  });

  it('falls back to the settings section for items without one', () => {
    const grouped = groupBySection([item('no-section')]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.section).toBe('settings');
    expect(grouped[0]!.items.map((i) => i.route)).toEqual(['no-section']);
  });

  it('coalesces unsectioned items with explicit settings items', () => {
    const grouped = groupBySection([
      item('explicit', 'settings'),
      item('implicit'),
      item('other', 'sales'),
    ]);
    expect(grouped).toHaveLength(2);
    const settingsGroup = grouped.find((g) => g.section === 'settings')!;
    expect(settingsGroup.items.map((i) => i.route)).toEqual(['explicit', 'implicit']);
  });

  it('never emits a group for a section with no items', () => {
    const grouped = groupBySection([item('a', 'sales')]);
    expect(grouped.some((g) => g.section === 'dev')).toBe(false);
  });

  it('preserves item order within each section', () => {
    const grouped = groupBySection([
      item('a', 'sales'),
      item('b', 'dev'),
      item('c', 'sales'),
    ]);
    const sales = grouped.find((g) => g.section === 'sales')!;
    expect(sales.items.map((i) => i.route)).toEqual(['a', 'c']);
  });
});
