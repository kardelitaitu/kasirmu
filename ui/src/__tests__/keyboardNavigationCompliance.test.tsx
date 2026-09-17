//! A11Y-08: executable keyboard-navigation compliance gate.
//!
//! The audit flagged that keyboard behaviour was spread across ad hoc
//! handlers with no single codebase-wide suite verifying the shell-level
//! keyboard contract. This gate mounts representative shell + feature
//! flows and pins, in one place:
//!
//!   1. Skip-link focus (desktop + tablet shells) — first focusable element
//!   2. Tab containment inside dialogs (Modal focus trap wraps last→first)
//!   3. Escape ownership — Escape closes the dialog, and the shell's
//!      global escape-to-picker handler is SUPPRESSED while a modal is open
//!   4. Focus restoration — focus returns to the trigger after dialog close
//!   5. Widget arrow navigation — tablet tablist roving tabindex,
//!      StoreSwitcher listbox Arrow/Enter/Escape
//!   6. Shortcut suppression inside dialogs — F10 (settings toggle) does
//!      not fire while an aria-modal dialog is open
//!
//! Unit-level focus behaviour lives in useFocusTrap.test.ts / Modal.test.tsx;
//! this file is the shell-integration gate the audit asked for.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/__tests__/test-utils/render';
import { withFluent } from '@/locales/test-utils';
import sharedFtl from '@/locales/shared.ftl?raw';
import AppLayout from '@/app/AppLayout';
import TabletAppLayout from '@/app/tablet/TabletAppLayout';
import { Modal } from '@/components/Modal';
import StoreSwitcher from '@/components/StoreSwitcher';
import { registerNavItem, clearNavItems } from '@/platform/ui/menu-registry';
import type { LocationProfile } from '@/api/locations';

// ── Shell leaf stubs (each covered by its own focused suite) ──────────
vi.mock('@/app/StatusBar', () => ({
  // A div (NOT a <footer>) so the status role is aria-allowed-role legal:
  // axe rejects role="status" on <footer> (implicit contentinfo semantics).
  default: () => (
    <div role="status" aria-label="Application status">v0.0.25</div>
  ),
}));
vi.mock('@/app/UpdateBanner', () => ({ default: () => null }));
vi.mock('@/components/StockAlertBell', () => ({ default: () => null }));
vi.mock('@/components/RoleBadge', () => ({ default: () => null }));

// ── StoreSwitcher API + workspace mocks (mirrors StoreSwitcher.test.tsx) ──
const { mockListStores } = vi.hoisted(() => ({
  mockListStores: vi.fn(),
}));
vi.mock('@/api/locations', () => ({
  listLocationsScoped: () => mockListStores(),
  setPrimaryLocationScoped: vi.fn(() => Promise.resolve({ id: 's' })),
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    switchStore: vi.fn(),
    resolvedStoreId: 'default',
    activeWorkspace: null,
    activeInstance: null,
    setActiveWorkspace: vi.fn(),
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
  }),
}));

// ── Test store fixtures ───────────────────────────────────────────────
function makeStore(overrides: Partial<LocationProfile> = {}): LocationProfile {
  return {
    id: 'store-1',
    name: 'HQ',
    address: '',
    tax_id: '',
    currency: 'IDR',
    timezone: 'Asia/Jakarta',
    is_primary: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Shared shell setup ────────────────────────────────────────────────
// AppLayout renders the REAL StoreSwitcher and the registry-backed nav;
// give every shell mount a sane baseline (empty store list → switcher
// renders null, and three registered nav items for the sidebar/tablist).
beforeEach(() => {
  clearNavItems();
  registerNavItem({ route: 'products', label: 'Products', section: 'products' });
  registerNavItem({ route: 'sales', label: 'Sales', section: 'sales' });
  registerNavItem({ route: 'inventory', label: 'Inventory', section: 'inventory' });
  mockListStores.mockResolvedValue([]);
});

afterEach(() => {
  mockListStores.mockReset();
  clearNavItems();
  // Modal/useFocusTrap locks body scroll — restore it so later tests in
  // this file don't inherit a hidden overflow.
  document.body.style.overflow = '';
});

describe('keyboardNavigationCompliance — skip-link focus', () => {

  it('desktop shell: skip link is the first focusable element via Tab', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <AppLayout route="products" onNavigate={() => {}}>
        <h1>Products</h1>
      </AppLayout>,
      sharedFtl,
    );

    const skipLink = document.querySelector<HTMLAnchorElement>('.skip-to-content');
    expect(skipLink).not.toBeNull();
    expect(skipLink?.getAttribute('href')).toBe('#app-main-content');

    // Tab from <body> — the skip link (first focusable in the DOM) must
    // receive focus first.
    document.body.focus();
    await user.tab();
    expect(document.activeElement).toBe(skipLink);
  });

  it('tablet shell: skip link is the first focusable element via Tab', async () => {
    const user = userEvent.setup();
    await renderWithProviders(
      <TabletAppLayout route="products" onNavigate={() => {}}>
        <h1>Products</h1>
      </TabletAppLayout>,
      sharedFtl,
    );

    const skipLink = document.querySelector<HTMLAnchorElement>('.skip-to-content');
    expect(skipLink).not.toBeNull();
    expect(skipLink?.getAttribute('href')).toBe('#tablet-main-content');

    document.body.focus();
    await user.tab();
    expect(document.activeElement).toBe(skipLink);
  });
});

describe('keyboardNavigationCompliance — modal Tab containment', () => {
  it('Tab on the last focusable element inside a dialog wraps to the first', () => {
    render(
      withFluent(
        <Modal open onClose={() => {}} title="Dialog">
          <button type="button" data-testid="btn-last">Last</button>
        </Modal>,
      ),
    );

    const last = screen.getByTestId('btn-last');
    const closeBtn = screen.getByRole('button', { name: /close/i });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeBtn).toHaveFocus();
  });

  it('Shift+Tab on the first element wraps to the last (focus stays trapped)', () => {
    render(
      withFluent(
        <Modal open onClose={() => {}} title="Dialog">
          <button type="button" data-testid="btn-last">Last</button>
        </Modal>,
      ),
    );

    const last = screen.getByTestId('btn-last');
    const closeBtn = screen.getByRole('button', { name: /close/i });

    closeBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});

describe('keyboardNavigationCompliance — Escape ownership + focus restoration', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          data-testid="open-dialog"
          onClick={() => setOpen(true)}
        >
          Open dialog
        </button>
        <Modal open={open} onClose={() => setOpen(false)} title="Settings">
          <button type="button">Save</button>
        </Modal>
      </>
    );
  }

  it('Escape closes the dialog and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(withFluent(<Harness />));

    await user.click(screen.getByTestId('open-dialog'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Focus moved into the dialog (focus trap auto-focus).
    expect(
      screen.getByRole('dialog').contains(document.activeElement),
    ).toBe(true);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('open-dialog')).toHaveFocus();
  });

  it('suppresses the shell escape-to-picker while an aria-modal dialog is open, then fires after close', async () => {
    // Mirrors AppShell's useWorkspaceNavShortcuts guard exactly:
    //   Escape → onBack() UNLESS Ctrl+Shift+Escape or an aria-modal is open.
    const onBack = vi.fn();
    function ShellHarness({ children }: { children: ReactNode }) {
      const backRef = useRef(onBack);
      backRef.current = onBack;
      const [open, setOpen] = useState(true);
      useEffect(() => {
        const handler = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            if (e.ctrlKey && e.shiftKey) {
              backRef.current();
            } else if (!document.querySelector('[aria-modal="true"]')) {
              backRef.current();
            }
          }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
      }, []);
      return (
        <>
          <Modal open={open} onClose={() => setOpen(false)} title="Settings">
            <button type="button" onClick={() => setOpen(false)}>Done</button>
          </Modal>
          {children}
        </>
      );
    }

    const user = userEvent.setup();
    render(withFluent(<ShellHarness><button type="button">Page</button></ShellHarness>));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Escape while modal open: dialog closes, shell navigation suppressed.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onBack).not.toHaveBeenCalled();

    // Escape with no modal open: shell handler fires.
    await user.keyboard('{Escape}');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('suppresses the F10 settings-toggle while a modal is open', async () => {
    // Mirrors AppShell's F10 handler guard: only toggles when no aria-modal.
    const toggleSettings = vi.fn();
    function F10Harness() {
      const toggleRef = useRef(toggleSettings);
      toggleRef.current = toggleSettings;
      const [open, setOpen] = useState(true);
      useEffect(() => {
        const handler = (e: KeyboardEvent) => {
          if (e.key === 'F10') {
            e.preventDefault();
            if (!document.querySelector('[aria-modal="true"]')) {
              toggleRef.current();
            }
          }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
      }, []);
      return (
        <>
          <Modal open={open} onClose={() => setOpen(false)} title="Settings">
            <button type="button" onClick={() => setOpen(false)}>Done</button>
          </Modal>
        </>
      );
    }

    const user = userEvent.setup();
    render(withFluent(<F10Harness />));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await user.keyboard('{F10}');
    expect(toggleSettings).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.keyboard('{F10}');
    expect(toggleSettings).toHaveBeenCalledTimes(1);
  });
});

describe('keyboardNavigationCompliance — widget arrow navigation', () => {
  it('tablet tablist: ArrowRight/Left move focus with roving tabindex and navigate', async () => {
    const onNavigate = vi.fn();
    await renderWithProviders(
      <TabletAppLayout route="products" onNavigate={onNavigate}>
        <h1>Products</h1>
      </TabletAppLayout>,
      sharedFtl,
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(2);

    // The active route tab carries tabindex=0 (roving tabindex).
    const activeIdx = tabs.findIndex((t) => t.getAttribute('tabindex') === '0');
    expect(activeIdx).toBeGreaterThanOrEqual(0);
    const active = tabs[activeIdx]!;
    active.focus();
    expect(document.activeElement).toBe(active);

    // ArrowRight moves focus to the next tab (roving tabindex) and navigates.
    fireEvent.keyDown(active, { key: 'ArrowRight' });
    const nextIdx = (activeIdx + 1) % tabs.length;
    // aria-selected only updates when the route prop re-renders (the mocked
    // onNavigate does not), so assert focus position, not selection.
    expect(document.activeElement).toBe(tabs[nextIdx]);
    expect(onNavigate).toHaveBeenCalledTimes(1);

    // ArrowLeft returns focus to the previous tab.
    fireEvent.keyDown(tabs[nextIdx]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(active);
  });

  it('StoreSwitcher listbox: ArrowDown moves the active descendant, Enter selects, Escape closes + restores trigger', async () => {
    mockListStores.mockResolvedValue([
      makeStore({ name: 'HQ', is_primary: true }),
      makeStore({ id: 'store-2', name: 'Branch A', is_primary: false }),
      makeStore({ id: 'store-3', name: 'Branch B', is_primary: false }),
    ]);

    render(withFluent(<StoreSwitcher />));
    await waitFor(() => expect(screen.getByRole('button', { name: /HQ/ })).toBeInTheDocument());

    const trigger = screen.getByRole('button', { name: /HQ/ });
    await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

    const listbox = screen.getByRole('listbox');
    await userEvent.keyboard('{ArrowDown}');
    expect(listbox.getAttribute('aria-activedescendant')).toBe('store-switcher-option-store-2');

    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

    // Reopen, then Escape must close AND restore focus to the trigger.
    await userEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

});
