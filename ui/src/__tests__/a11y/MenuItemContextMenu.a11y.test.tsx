//! A11y regression tests for MenuItemContextMenu.
//!
//! The menu-item context menu (pin/unpin, mark unavailable, set a colour) is
//! opened by right-click or long-press on a menu tile. It had no axe coverage,
//! and it is the one place in the POS that hand-rolls menu semantics —
//! role="menu"/menuitem plus a role="group" swatch strip — so axe is the right
//! check for the ARIA wiring.
//!
//! Names come from the REAL products bundle.

import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, checkA11y } from './axe-helper';
import { MenuItemContextMenu } from '@/features/restaurant/components/MenuItemContextMenu';
import productsFtl from '@/locales/products.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';

const FTL = [sharedFtl, productsFtl];

function makeMenu(overrides: Record<string, unknown> = {}) {
  return {
    sku: 'SKU-1',
    x: 100,
    y: 100,
    isPinned: false,
    isUnavailable: false,
    sourceInStock: true,
    currentColor: undefined,
    fromKeyboard: false,
    ...overrides,
  } as React.ComponentProps<typeof MenuItemContextMenu>['menu'];
}

function renderMenu(menu = makeMenu()) {
  return renderWithProviders(
    <MenuItemContextMenu
      menu={menu}
      setPinned={vi.fn()}
      setUnavailable={vi.fn()}
      setColors={vi.fn()}
      onClose={vi.fn()}
    />,
    ...FTL,
  );
}

describe('MenuItemContextMenu a11y', () => {
  it('has no axe violations on an unpinned, in-stock item', async () => {
    const { container } = renderMenu();
    await checkA11y(container);

    // Vacuity guard: the popup, its two actions and the swatch group mounted.
    // The container is role="dialog", NOT role="menu": a menu may only hold
    // menuitem-family children and this popup also holds a label and the
    // role="group" swatch strip (axe aria-required-children).
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(container.querySelectorAll('.restaurant-context-item').length).toBe(2);
    expect(container.querySelector('[role="group"]')).toBeTruthy();
    // And the invalid roles are gone.
    expect(container.querySelectorAll('[role="menu"], [role="menuitem"]').length).toBe(0);
  });

  it('has no axe violations on a pinned, unavailable item', async () => {
    // The labels flip with state, so the other branch is its own surface.
    const { container } = renderMenu(makeMenu({ isPinned: true, isUnavailable: true, currentColor: '#10b981' }));
    await checkA11y(container);

    expect(container.querySelectorAll('.restaurant-context-item').length).toBe(2);
    expect(container.querySelectorAll('button[aria-pressed]').length).toBeGreaterThan(0);
  });
});
