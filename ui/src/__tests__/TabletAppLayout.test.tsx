import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withFluent } from '@/i18n/test-utils';
import TabletAppLayout, { FALLBACK_TAB_LIMIT } from '@/app/tablet/TabletAppLayout';
import sharedFtl from '@/locales/shared.ftl?raw';

const mockGetNavItems = vi.fn();

vi.mock('@/registries/menu-registry', () => ({
  getNavItems: (...args: unknown[]) => mockGetNavItems(...args),
}));

beforeEach(() => {
  mockGetNavItems.mockReset();
  mockGetNavItems.mockReturnValue([
    { route: 'sales', label: 'Sales', i18nKey: 'nav-sales', icon: '💰' },
    { route: 'products', label: 'Products', i18nKey: 'nav-products', icon: '📦' },
    { route: 'customers', label: 'Customers', i18nKey: 'nav-customers', icon: '👥' },
    { route: 'settings', label: 'Settings', i18nKey: 'nav-settings', icon: '⚙️' },
    { route: 'reports', label: 'Reports', i18nKey: 'nav-reports', icon: '📊' },
    { route: 'kds', label: 'KDS', i18nKey: 'kds-title', icon: '🍳' },
    { route: 'inventory', label: 'Inventory', i18nKey: 'nav-inventory', icon: '📋' },
    { route: 'staff', label: 'Staff', i18nKey: 'nav-staff', icon: '👤' },
  ]);
});

function renderLayout(props: {
  route?: string;
  onNavigate?: (route: string) => void;
  enabledFeatures?: Set<string>;
  userRole?: string;
  workspaceScreens?: string[];
} = {}) {
  const {
    route = 'sales',
    onNavigate = vi.fn(),
    enabledFeatures,
    userRole,
    workspaceScreens,
  } = props;
  return render(
    withFluent(
      <TabletAppLayout route={route} onNavigate={onNavigate} enabledFeatures={enabledFeatures!} userRole={userRole!} workspaceScreens={workspaceScreens!}>
        <div data-testid="content">Main Content</div>
      </TabletAppLayout>,
      sharedFtl,
    ),
  );
}

describe('TabletAppLayout', () => {
  it('renders children content', () => {
    renderLayout();
    expect(screen.getByTestId('content')).toHaveTextContent('Main Content');
  });

  it('renders nav items from menu registry', () => {
    renderLayout();
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText('Products')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('caps the FALLBACK tab set at FALLBACK_TAB_LIMIT', () => {
    // No `workspaceScreens`, so the whole (8-item) mock registry is the tab
    // set. The fallback is the entire application nav — 41 items for an owner
    // — so it is capped; the bar scrolls but should not become the sidebar.
    renderLayout();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(FALLBACK_TAB_LIMIT);
    expect(mockGetNavItems).toHaveBeenCalled();
  });

  it('does NOT cap the workspace-declared tab set', () => {
    // A workspace declares its screens in `workspace_type_screens` (ordered,
    // owner-configured). Rendering only the first 7 silently discards the
    // rest: the seeded `admin` workspace declares 15 screens, 13 of them nav
    // items, so the cap dropped 6 with no signal. All 8 mocked routes are
    // declared here — more than FALLBACK_TAB_LIMIT — and all 8 must render.
    renderLayout({
      workspaceScreens: [
        'sales',
        'products',
        'customers',
        'settings',
        'reports',
        'kds',
        'inventory',
        'staff',
      ],
    });
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(8);
    expect(tabs.length).toBeGreaterThan(FALLBACK_TAB_LIMIT);
    // The tab past the old cap is the point of the test.
    expect(screen.getByText('Staff')).toBeTruthy();
  });

  it('renders the active tab even when it sits past the fallback cap', () => {
    // Before the declared list was rendered in full, navigating to a route
    // past index 7 rendered no tab for it at all, so the bar highlighted
    // nothing. Declared screens are what make that reachable.
    renderLayout({
      route: 'staff',
      workspaceScreens: [
        'sales',
        'products',
        'customers',
        'settings',
        'reports',
        'kds',
        'inventory',
        'staff',
      ],
    });
    const active = screen
      .getAllByRole('tab')
      .find((t) => t.getAttribute('aria-selected') === 'true');
    expect(active?.textContent).toContain('Staff');
  });

  it('highlights the active route', () => {
    renderLayout({ route: 'products' });
    const tabs = screen.getAllByRole('tab');
    const activeTab = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    expect(activeTab).toBeTruthy();
    expect(activeTab?.textContent).toContain('Products');
  });

  it('calls onNavigate when a tab is clicked', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();

    renderLayout({ onNavigate });
    await user.click(screen.getByText('Products'));

    expect(onNavigate).toHaveBeenCalledWith('products');
  });

  it('filters nav items by workspaceScreens', () => {
    renderLayout({ workspaceScreens: ['sales', 'kds'] });

    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText('KDS')).toBeTruthy();
    expect(screen.queryByText('Products')).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('passes enabledFeatures to getNavItems', () => {
    mockGetNavItems.mockClear();
    const features = new Set(['simple-retail']);

    renderLayout({ enabledFeatures: features });

    expect(mockGetNavItems).toHaveBeenCalledWith(features, undefined, undefined);
  });

  it('passes userRole to getNavItems', () => {
    mockGetNavItems.mockClear();

    renderLayout({ userRole: 'manager' });

    expect(mockGetNavItems).toHaveBeenCalledWith(undefined, 'manager', undefined);
  });

  it('has tablist role with aria-label', () => {
    renderLayout();
    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeTruthy();
  });

  it('sets aria-selected correctly on each tab', () => {
    renderLayout({ route: 'kds' });
    const tabs = screen.getAllByRole('tab');

    const kdsTab = tabs.find((t) => t.textContent?.includes('KDS'));
    expect(kdsTab?.getAttribute('aria-selected')).toBe('true');

    const salesTab = tabs.find((t) => t.textContent?.includes('Sales'));
    expect(salesTab?.getAttribute('aria-selected')).toBe('false');
  });

  // ── A11Y-03: skip-to-content link ─────────────────────────────

  it('renders a skip-to-content link as the first focusable element', () => {
    renderLayout();
    const skipLink = document.querySelector<HTMLAnchorElement>('.skip-to-content');
    expect(skipLink).toBeTruthy();
    expect(skipLink?.getAttribute('href')).toBe('#tablet-main-content');
  });

  it('targets the main content area via #tablet-main-content', () => {
    renderLayout();
    const main = document.getElementById('tablet-main-content');
    expect(main).toBeTruthy();
    expect(main?.getAttribute('role')).toBe('main');
  });

  it('is the first focusable element in the shell', () => {
    renderLayout();
    const skipLink = document.querySelector<HTMLAnchorElement>('.skip-to-content');
    const tablist = screen.getByRole('tablist');
    // The skip link must precede the tab bar in DOM order so Tab reaches it first.
    const position = skipLink
      ? skipLink.compareDocumentPosition(tablist)
      : 0;
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('places the tab bar after the main content in DOM order', () => {
    // Half of the "bar is at the bottom" pair; the other half is the
    // `display: flex` + `flex-direction: column` rule on `.app-layout`,
    // pinned in tabletShellLayout.test.ts. With DOM order [main, nav] a
    // plain column puts the bar at the bottom; `column-reverse` would put
    // it at the top, which is the bug ed6ec31f8 introduced.
    renderLayout();
    const main = document.getElementById('tablet-main-content');
    const nav = document.querySelector('.tablet-tab-bar-nav');
    expect(main).toBeTruthy();
    expect(nav).toBeTruthy();
    const position = main!.compareDocumentPosition(nav!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // ── A11Y-05: tablist roving tabindex + arrow-key navigation ──

  it('keeps only the active tab in the tab order (roving tabindex)', () => {
    renderLayout({ route: 'products' });
    const tabs = screen.getAllByRole('tab');
    const productsIdx = tabs.findIndex((t) => t.textContent?.includes('Products'));
    expect(productsIdx).toBeGreaterThanOrEqual(0);
    tabs.forEach((tab, idx) => {
      expect(tab.getAttribute('tabindex')).toBe(idx === productsIdx ? '0' : '-1');
    });
  });

  it('navigates tabs with the Right arrow key and activates', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderLayout({ route: 'sales', onNavigate });

    const salesTab = screen.getByText('Sales').closest('button')!;
    salesTab.focus();
    await user.keyboard('{ArrowRight}');

    // Automatic activation: focus moved to the next tab AND navigation fired.
    expect(onNavigate).toHaveBeenCalledWith('products');
    expect(screen.getByText('Products').closest('button')).toHaveFocus();
  });

  it('wraps around when pressing the Left arrow on the first tab', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderLayout({ route: 'sales', onNavigate });

    const salesTab = screen.getByText('Sales').closest('button')!;
    salesTab.focus();
    await user.keyboard('{ArrowLeft}');

    expect(onNavigate).toHaveBeenCalledWith('inventory');
  });

  it('jumps to the first tab with Home and the last with End', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderLayout({ route: 'products', onNavigate });

    const productsTab = screen.getByText('Products').closest('button')!;
    productsTab.focus();
    await user.keyboard('{End}');
    expect(onNavigate).toHaveBeenLastCalledWith('inventory');

    await user.keyboard('{Home}');
    expect(onNavigate).toHaveBeenLastCalledWith('sales');
  });

  it('ignores non-navigation keys on the tablist', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderLayout({ route: 'sales', onNavigate });

    const salesTab = screen.getByText('Sales').closest('button')!;
    salesTab.focus();
    await user.keyboard('a');

    expect(onNavigate).not.toHaveBeenCalled();
  });
});
