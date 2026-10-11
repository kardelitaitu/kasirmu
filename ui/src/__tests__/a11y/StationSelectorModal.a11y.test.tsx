//! A11y regression tests for StationSelectorModal.
//!
//! The station picker used by the Expo screen: a modal containing a radiogroup
//! of stations plus the "All" row. It had no axe coverage, and it hand-rolls the
//! radio pattern (role="radio" + aria-checked + roving tabindex), which axe does
//! not fully enforce. The structure is therefore pinned by assertion too.

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import { StationSelectorModal } from '@/features/kds/components/StationSelectorModal';
import kdsFtl from '@/locales/kds.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

const FTL = [sharedFtl, kdsFtl];

vi.mock('@/hooks/useFocusTrap', () => ({ useFocusTrap: () => {} }));

const OPTIONS = [
  { zone: 'Grill', tickets: 3 },
  { zone: 'Bar', tickets: 1 },
];

describe('StationSelectorModal a11y', () => {
  it('has no axe violations with stations and All listed', async () => {
    const { container } = renderWithProviders(
      <StationSelectorModal
        isOpen
        options={OPTIONS}
        selected="Grill"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
      ...FTL,
    );
    await checkA11y(container);

    // The dialog itself. It is named via aria-labelledby -> the visible <h2>,
    // which is a STRONGER binding than aria-label (the name follows the visible
    // heading), so the pin accepts either and asserts the referenced element
    // really exists — a dangling aria-labelledby is a silent unnamed dialog.
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const labelledBy = dialog!.getAttribute('aria-labelledby');
    if (labelledBy) {
      const target = container.querySelector('#' + CSS.escape(labelledBy));
      expect(target, 'aria-labelledby points at nothing: ' + labelledBy).toBeTruthy();
      expect((target!.textContent ?? '').trim()).toBeTruthy();
    } else {
      expect(dialog!.getAttribute('aria-label')).toBeTruthy();
    }

    // The radiogroup and its rows: All + one per station.
    const group = container.querySelector('[role="radiogroup"]');
    expect(group).toBeTruthy();
    const radios = container.querySelectorAll('[role="radio"]');
    expect(radios.length).toBe(3);
    // Exactly one checked, and exactly one tabbable (roving tabindex) — axe
    // does not enforce either, so they are pinned here.
    expect(container.querySelectorAll('[role="radio"][aria-checked="true"]').length).toBe(1);
    expect(container.querySelectorAll('[role="radio"][tabindex="0"]').length).toBe(1);
  });

  it('has no axe violations with "All" selected', async () => {
    const { container } = renderWithProviders(
      <StationSelectorModal
        isOpen
        options={OPTIONS}
        selected=""
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
      ...FTL,
    );
    await checkA11y(container);

    // The All row is the checked one in this state.
    const checked = container.querySelector('[role="radio"][aria-checked="true"]') as HTMLElement;
    expect(checked).toBeTruthy();
    expect(checked.textContent ?? '').toMatch(/all/i);
  });

  it('has no axe violations with no stations on the board', async () => {
    const { container } = renderWithProviders(
      <StationSelectorModal
        isOpen
        options={[]}
        selected=""
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
      ...FTL,
    );
    await checkA11y(container);

    // Only the All row remains — the group must not be empty-handed.
    expect(container.querySelectorAll('[role="radio"]').length).toBe(1);
  });

  it('renders nothing while closed', async () => {
    const { container } = renderWithProviders(
      <StationSelectorModal
        isOpen={false}
        options={OPTIONS}
        selected="Grill"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
      ...FTL,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
