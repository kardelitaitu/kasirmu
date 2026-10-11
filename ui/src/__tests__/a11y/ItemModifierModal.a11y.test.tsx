//! A11y regression tests for ItemModifierModal.
//!
//! The modifier picker is how a restaurant order is customised — per-group
//! checkbox/radio options, a selection counter, min/max enforcement and a live
//! price summary. It had no axe coverage, and this session's earlier static scan
//! flagged this file as holding unlabelled controls, so axe is being asked
//! directly rather than the heuristic being trusted.
//!
//! The REAL sales bundle is mounted because the modal names its controls from
//! Fluent (`<Localized ... attrs>`), which the helper's minimal bundle lacks.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import ItemModifierModal, {
  type ModifierGroup,
} from '@/features/sales/components/ItemModifierModal';
import salesFtl from '@/locales/sales.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

const FTL = [sharedFtl, salesFtl];

// One radio-style group (choose exactly one) and one multi-select group, which
// is the pair a restaurant actually configures (e.g. Size, and Add-ons).
const GROUPS: ModifierGroup[] = [
  {
    id: 'g-size',
    name: 'Size',
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 0,
    modifiers: [
      { id: 'm-reg', name: 'Regular', priceMinor: 0, sortOrder: 0, isDefault: true },
      { id: 'm-large', name: 'Large', priceMinor: 5000, sortOrder: 1, isDefault: false },
    ],
  },
  {
    id: 'g-addons',
    name: 'Add-ons',
    minSelections: 0,
    maxSelections: 3,
    sortOrder: 1,
    modifiers: [
      { id: 'm-cheese', name: 'Extra Cheese', priceMinor: 3000, sortOrder: 0, isDefault: false },
      { id: 'm-egg', name: 'Fried Egg', priceMinor: 2500, sortOrder: 1, isDefault: false },
    ],
  },
];

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    productName: 'Nasi Goreng',
    basePriceMinor: 50000,
    currency: 'IDR',
    groups: GROUPS,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  } as React.ComponentProps<typeof ItemModifierModal>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ItemModifierModal a11y', () => {
  it('has no axe violations with two modifier groups open', async () => {
    const { container } = renderWithProviders(<ItemModifierModal {...makeProps()} />, ...FTL);
    await checkA11y(document.body);

    // Vacuity guard: both groups and their four option controls mounted, so the
    // pass is clearing the real picker and not an empty dialog shell. The
    // options are <button>s, not inputs — the roles are what axe grades.
    expect(container.textContent).toContain('Size');
    expect(container.textContent).toContain('Add-ons');
    expect(container.querySelectorAll('[data-testid^="modifier-m-"]').length).toBe(4);
    // And the fix itself: no option role outside a listbox remains.
    expect(container.querySelectorAll('[role="option"]').length).toBe(0);
  });
});
