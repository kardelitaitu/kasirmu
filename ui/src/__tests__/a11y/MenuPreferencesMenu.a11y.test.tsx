//! A11y regression tests for MenuPreferencesMenu.
//!
//! The restaurant POS header's preferences cluster: the hamburger trigger and
//! its floating popover (sort options, card-size and font-size steppers, theme
//! toggle, fullscreen toggle). It had no axe coverage, and its controls are the
//! sort of icon-plus-label cluster where an unnamed stepper is easy to miss.
//! Mounts with the REAL products bundle so names come from shipped copy.

import { describe, it, expect, vi } from 'vitest';
import { useRef } from 'react';
import { renderWithProviders, checkA11y } from './axe-helper';
import { MenuPreferencesMenu } from '@/features/restaurant/components/MenuPreferencesMenu';
import productsFtl from '@/locales/products.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

const FTL = [sharedFtl, productsFtl];

function Harness({ open }: { open: boolean }) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  return (
    <MenuPreferencesMenu
      open={open}
      onOpenChange={vi.fn()}
      dropdownRef={dropdownRef}
      sortMode="a-z"
      onSelectSort={vi.fn()}
      cardSize={3}
      onCardSizeStep={vi.fn()}
      fontSize={12}
      onFontSizeStep={vi.fn()}
    />
  );
}

describe('MenuPreferencesMenu a11y', () => {
  it('has no axe violations with the dropdown open', async () => {
    const { container } = renderWithProviders(<Harness open />, ...FTL);
    await checkA11y(container);

    // Vacuity guard: the popover and its steppers mounted — without them the
    // pass would only be clearing a lone trigger button.
    expect(container.querySelector('.restaurant-hamburger-dropdown')).toBeTruthy();
    // The two stepper groups (menu size + font size) and the sort group.
    expect(container.querySelectorAll('.restaurant-hamburger-sort-group').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.restaurant-hamburger-size').length).toBeGreaterThan(0);
  });

  it('has no axe violations with the dropdown closed', async () => {
    const { container } = renderWithProviders(<Harness open={false} />, ...FTL);
    await checkA11y(container);

    // The trigger alone is the whole surface when closed.
    expect(container.querySelector('.restaurant-hamburger-btn')).toBeTruthy();
    expect(container.querySelector('.restaurant-hamburger-dropdown')).toBeNull();
  });
});
