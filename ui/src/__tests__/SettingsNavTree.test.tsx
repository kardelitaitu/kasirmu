import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsNavTree, {
  CATEGORIES,
  NAV_ITEMS,
  NAV_L10N_KEYS,
} from '@/features/settings/SettingsNavTree';
import settingsFtl from '@/locales/settings.ftl?raw';
import settingsIdFtl from '@/locales/settings.id.ftl?raw';

// ── Mocks ────────────────────────────────────────────────────────

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: {
      getString: (key: string) => {
        const keyMap: Record<string, string> = {
          'settings-sidebar-nav-aria': 'Settings navigation',
          'settings-sidebar-collapse-all-aria': 'Collapse all categories',
          'settings-sidebar-collapse-aria': 'Collapse sidebar',
          'settings-sidebar-expand-aria': 'Expand sidebar',
          'settings-sidebar-no-results': 'No matching sections',
          'settings-sidebar-clear-results': 'Clear search',
          'settings-category-business': 'Business',
          'settings-category-operations': 'Operations',
          'settings-category-system': 'System',
          'settings-nav-general': 'General',
          'settings-nav-appearance': 'Appearance',
          'settings-nav-receipt': 'Receipt',
          'settings-nav-sync': 'Cloud Sync',
          'settings-nav-email': 'Email Reports',
          'settings-nav-about': 'About',
          'settings-nav-license': 'License',
          'settings-nav-topology': 'Topology',
          'settings-nav-store-pos': 'Store POS',
          'settings-nav-restaurant-pos': 'Restaurant POS',
          'settings-nav-inventory': 'Inventory',
          'settings-nav-diagnostics': 'Diagnostics',
        };
        return keyMap[key] ?? key;
      },
    },
  }),
  Localized: ({
    children,
  }: {
    id?: string;
    children: React.ReactNode;
    vars?: Record<string, string>;
    attrs?: Record<string, boolean>;
  }) => <>{children}</>,
}));

vi.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}));

vi.mock('@/frontend/shell/Tooltip', () => ({
  default: ({
    children,
  }: {
    children: React.ReactNode;
    content?: string;
    showDelay?: number;
  }) => <>{children}</>,
}));

// ── Default props ────────────────────────────────────────────────

const defaultProps = {
  activeSection: 'general',
  onNavigate: vi.fn(),
  searchQuery: '',
  onSearchChange: vi.fn(),
  mobileSidebarOpen: false,
  onMobileClose: vi.fn(),
};

// ── Helpers ──────────────────────────────────────────────────────

/** Get all nav item treeitems within the sidebar (filters out category headers). */
function getNavItems() {
  return screen.getAllByRole('treeitem').filter(
    (item) => item.closest('[data-testid="settings-sidebar"]') !== null
      && item.getAttribute('aria-level') === '2',
  );
}

/** Get the currently active nav item by aria-selected. */
function getActiveNavItem() {
  return screen.getByRole('treeitem', { selected: true });
}

/** Fire a keyboard event on a target element (defaults to document).
 *  Events bubble to document, matching the component's document-level
 *  keydown listener. */
function fireKey(key: string, dispatchTarget: EventTarget = document) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  dispatchTarget.dispatchEvent(event);
  return event;
}

// ── Tests ────────────────────────────────────────────────────────

describe('SettingsNavTree', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  // ── Render ─────────────────────────────────────────────────

  it('renders all 3 category headers', () => {
    render(<SettingsNavTree {...defaultProps} />);

    expect(screen.getByText('Business')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
  });

  it('shows count badges with correct item counts', () => {
    render(<SettingsNavTree {...defaultProps} />);

    // 2 items in Business, 6 in Operations, 5 in System (diagnostics
    // joined about + license + topology + local-api in 92829560).
    const badges = screen.getAllByText(/^\d+$/);
    expect(badges.length).toBe(3);
    const counts = badges.map((b) => Number(b.textContent)).sort((a, b) => a - b);
    expect(counts).toEqual([2, 5, 6]);
  });

  it('renders Diagnostics under System and navigates to it', async () => {
    // The nav entry is the only way onto the screen, and 92829560 added it
    // by editing three separate registries in one file. Nothing asserted
    // any of them: the count badge above is the sole test that even
    // notices the category grew, and it would pass just as happily if the
    // new key had landed in Business or never reached CATEGORIES at all.
    const onNavigate = vi.fn();
    render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} />);

    const item = screen.getByRole('treeitem', { name: 'Diagnostics' });
    const systemPanel = document.getElementById('settings-panel-system');
    expect(systemPanel).toBeInTheDocument();
    expect(systemPanel).toContainElement(item as HTMLElement);
    expect(screen.getByText('System').closest('button')).toHaveAttribute(
      'aria-controls',
      'settings-panel-system',
    );

    await userEvent.click(item);
    expect(onNavigate).toHaveBeenCalledWith('diagnostics');
  });

  it('keeps every nav item in exactly one category with a label defined in both locales', () => {
    // The invariant 92829560 had to satisfy by hand across NAV_ITEMS,
    // CATEGORIES and NAV_L10N_KEYS, plus two .ftl files. A key missing
    // from the l10n map renders its raw key as the label; a key missing
    // from CATEGORIES renders nowhere at all; a key in two categories
    // double-counts the badges. None of that is visible from a render
    // test that only looks at one item, and the bundle-parity gate walks
    // Localized ids, not these string maps.
    const seen = new Map<string, number>();
    for (const category of CATEGORIES) {
      for (const key of category.keys) {
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }

    const itemKeys = NAV_ITEMS.map((item) => item.key);
    expect(itemKeys).toHaveLength(new Set(itemKeys).size);
    for (const key of itemKeys) {
      expect(seen.get(key), `nav item ${key} is in no category`).toBe(1);
    }
    // And no category names an item that does not exist.
    for (const [key, count] of seen) {
      expect(count, `${key} appears in more than one category`).toBe(1);
      expect(itemKeys, `${key} is categorised but not a nav item`).toContain(key);
    }

    // Every item resolves through a real FTL key that BOTH locales define.
    for (const key of itemKeys) {
      const l10nKey = NAV_L10N_KEYS[key];
      expect(l10nKey, `${key} has no NAV_L10N_KEYS entry`).toBeTruthy();
      const pattern = new RegExp(`^${l10nKey}\\s*=`, 'm');
      expect(pattern.test(settingsFtl), `${l10nKey} missing from settings.ftl`).toBe(true);
      expect(pattern.test(settingsIdFtl), `${l10nKey} missing from settings.id.ftl`).toBe(true);
    }
  });

  it('highlights the active section nav item', () => {
    render(<SettingsNavTree {...defaultProps} activeSection="receipt" />);

    // Receipt is in Operations → Operations should be expanded
    const activeItem = getActiveNavItem();
    expect(activeItem).toBeInTheDocument();
    expect(activeItem.closest('.settings-nav-item--active')).toBeTruthy();
  });

  it('renders sidebar with testid attribute', () => {
    render(<SettingsNavTree {...defaultProps} />);

    expect(screen.getByTestId('settings-sidebar')).toBeInTheDocument();
  });

  // ── Accordion expand/collapse ────────────────────────────

  it('starts with the first category expanded (Business)', () => {
    render(<SettingsNavTree {...defaultProps} />);

    // Business category header should have aria-expanded="true"
    // Use getByText on the category label span, then find parent button
    const businessBtn = screen.getByText('Business').closest('button')!;
    expect(businessBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('expands a category when clicked — categories are multi-expandable', async () => {
    const user = userEvent.setup();
    render(<SettingsNavTree {...defaultProps} />);

    // Operations starts collapsed
    const operationsBtn = screen.getByText('Operations').closest('button')!;
    expect(operationsBtn).toHaveAttribute('aria-expanded', 'false');

    // Click to expand
    await user.click(operationsBtn);
    expect(operationsBtn).toHaveAttribute('aria-expanded', 'true');

    // Business should still be expanded (categories are multi-expandable)
    const businessBtn = screen.getByText('Business').closest('button')!;
    expect(businessBtn).toHaveAttribute('aria-expanded', 'true');

    // Click Business to collapse it independently
    await user.click(businessBtn);
    expect(businessBtn).toHaveAttribute('aria-expanded', 'false');

    // Operations remains expanded (independent toggle)
    expect(operationsBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses a category when clicking the already-expanded one', async () => {
    const user = userEvent.setup();
    render(<SettingsNavTree {...defaultProps} />);

    // Business starts expanded
    const businessBtn = screen.getByText('Business').closest('button')!;
    expect(businessBtn).toHaveAttribute('aria-expanded', 'true');

    // Click to collapse
    await user.click(businessBtn);
    expect(businessBtn).toHaveAttribute('aria-expanded', 'false');
  });

  // ── Search filtering ─────────────────────────────────────

  it('filters nav items by search query (match label)', () => {
    render(<SettingsNavTree {...defaultProps} searchQuery="general" />);

    // Only General should be visible (matches label)
    const navItems = getNavItems();
    expect(navItems.length).toBe(1);
  });

  it('filters nav items by search query (match category name)', () => {
    render(<SettingsNavTree {...defaultProps} searchQuery="business" />);

    // Business category items (General, Appearance) should be visible
    const navItems = getNavItems();
    expect(navItems.length).toBe(2);
  });

  it('filters case-insensitively', () => {
    render(<SettingsNavTree {...defaultProps} searchQuery="GENERAL" />);

    const navItems = getNavItems();
    expect(navItems.length).toBe(1);
  });

  it('shows empty state when no search results match', () => {
    render(<SettingsNavTree {...defaultProps} searchQuery="xyznonexistent" />);

    expect(screen.getByText('No matching sections')).toBeInTheDocument();
    expect(screen.getByText('Clear search')).toBeInTheDocument();
  });

  it('calls onSearchChange when Clear search is clicked in empty state', async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <SettingsNavTree
        {...defaultProps}
        searchQuery="xyznonexistent"
        onSearchChange={onSearchChange}
      />,
    );

    await user.click(screen.getByText('Clear search'));
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  // ── Navigation ───────────────────────────────────────────

  it('calls onNavigate when a nav item is clicked', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} />);

    // Click on Appearance (under Business, which is expanded by default)
    const appearanceItem = screen.getByRole('treeitem', { name: 'Appearance' });
    await user.click(appearanceItem);

    expect(onNavigate).toHaveBeenCalledWith('appearance');
  });

  // ── Collapsed sidebar ───────────────────────────────────

  it('collapses sidebar when toggle button is clicked and hides nav labels', async () => {
    const user = userEvent.setup();
    render(<SettingsNavTree {...defaultProps} />);

    // Initially expanded
    let sidebar = screen.getByTestId('settings-sidebar');
    expect(sidebar.classList.contains('collapsed')).toBe(false);

    // Labels are visible in expanded mode
    expect(screen.getByText('General')).toBeInTheDocument();

    // Click the toggle button
    const toggleBtn = screen.getByRole('button', { name: 'Collapse sidebar' });
    await user.click(toggleBtn);

    // Now collapsed
    sidebar = screen.getByTestId('settings-sidebar');
    expect(sidebar.classList.contains('collapsed')).toBe(true);

    // Labels should be hidden (via CSS display:none, so text is not visible)
    // The text element still exists in DOM but is hidden — verify class
    const navLabel = document.querySelector('.settings-nav-label');
    expect(navLabel).toBeTruthy();
    // Verify the sidebar has collapsed class which triggers CSS to hide labels
  });

  it('collapsed sidebar shows collapsed class when state is set', () => {
    // Simulate collapsed state via localStorage
    localStorage.setItem('settings-sidebar-collapsed', 'true');
    render(<SettingsNavTree {...defaultProps} />);

    const sidebar = screen.getByTestId('settings-sidebar');
    expect(sidebar.classList.contains('collapsed')).toBe(true);
  });

  // ── Mobile sidebar overlay ──────────────────────────────

  it('shows mobile backdrop when mobileSidebarOpen is true', () => {
    render(<SettingsNavTree {...defaultProps} mobileSidebarOpen={true} />);

    const backdrop = document.querySelector('.settings-sidebar-backdrop');
    expect(backdrop?.classList.contains('visible')).toBe(true);
  });

  it('calls onMobileClose when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onMobileClose = vi.fn();
    render(
      <SettingsNavTree
        {...defaultProps}
        mobileSidebarOpen={true}
        onMobileClose={onMobileClose}
      />,
    );

    const backdrop = document.querySelector('.settings-sidebar-backdrop');
    expect(backdrop).toBeTruthy();
    if (backdrop) await user.click(backdrop);

    expect(onMobileClose).toHaveBeenCalledTimes(1);
  });

  // ── Sidebar preference persistence (P60-2c, per-key debounce) ──

  describe('sidebar preference persistence', () => {
    it('writes both preference keys when toggled within the debounce window', () => {
      vi.useFakeTimers();
      try {
        const { getByRole } = render(<SettingsNavTree {...defaultProps} />);

        // Collapse the sidebar → schedules persist('settings-sidebar-collapsed', 'true')
        fireEvent.click(getByRole('button', { name: 'Collapse sidebar' }));
        // Expand a collapsed category → schedules persist('settings-sidebar-expanded', ...)
        fireEvent.click(screen.getByText('Operations').closest('button')!);

        // Both timers are still pending; advance past the 100ms debounce window.
        act(() => { vi.advanceTimersByTime(100); });

        expect(localStorage.getItem('settings-sidebar-collapsed')).toBe('true');
        const expanded = JSON.parse(localStorage.getItem('settings-sidebar-expanded') ?? '[]');
        expect(Array.isArray(expanded) && expanded).toContain('Operations');
      } finally {
        vi.useRealTimers();
      }
    });

    it('flushes pending preference writes on unmount instead of dropping them', () => {
      vi.useFakeTimers();
      try {
        const { unmount, getByRole } = render(<SettingsNavTree {...defaultProps} />);

        fireEvent.click(getByRole('button', { name: 'Collapse sidebar' }));
        // Unmount BEFORE the debounce timer fires → cleanup must flush the write.
        act(() => { unmount(); });

        expect(localStorage.getItem('settings-sidebar-collapsed')).toBe('true');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── Keyboard navigation (P60-5b) ───────────────────────────

  describe('keyboard navigation', () => {
    it('ArrowDown moves to the next nav item', () => {
      const onNavigate = vi.fn();
      render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} activeSection="general" />);

      fireKey('ArrowDown');

      // general → next item in Business category is appearance
      expect(onNavigate).toHaveBeenCalledWith('appearance');
    });

    it('ArrowUp moves to the previous nav item', () => {
      const onNavigate = vi.fn();
      render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} activeSection="appearance" />);

      fireKey('ArrowUp');

      // appearance → previous item is general
      expect(onNavigate).toHaveBeenCalledWith('general');
    });

    it('ArrowDown wraps around from last to first item', () => {
      const onNavigate = vi.fn();
      // Active section is local-api (last in System category, which is last)
      render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} activeSection="local-api" />);

      fireKey('ArrowDown');

      // local-api → wraps around to first item: general
      expect(onNavigate).toHaveBeenCalledWith('general');
    });

    it('ArrowUp wraps around from first to last item', () => {
      const onNavigate = vi.fn();
      render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} activeSection="general" />);

      fireKey('ArrowUp');

      // general → wraps around to last item: local-api
      expect(onNavigate).toHaveBeenCalledWith('local-api');
    });

    it('ArrowDown is no-op when focused on an input element', () => {
      const onNavigate = vi.fn();
      render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} activeSection="general" />);

      // Dispatch event on an input, letting it bubble to document.
      // The component checks event.target.tagName and skips INPUT/SELECT/TEXTAREA.
      const input = document.createElement('input');
      document.body.appendChild(input);
      try {
        fireKey('ArrowDown', input);
      } finally {
        document.body.removeChild(input);
      }

      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('ArrowDown is no-op when search yields no results', () => {
      const onNavigate = vi.fn();
      render(
        <SettingsNavTree
          {...defaultProps}
          onNavigate={onNavigate}
          activeSection="general"
          searchQuery="xyznonexistent"
        />,
      );

      fireKey('ArrowDown');

      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('Escape calls onMobileClose when mobile sidebar is open', () => {
      const onMobileClose = vi.fn();
      render(
        <SettingsNavTree
          {...defaultProps}
          mobileSidebarOpen={true}
          onMobileClose={onMobileClose}
        />,
      );

      fireKey('Escape');

      expect(onMobileClose).toHaveBeenCalledTimes(1);
    });

    it('Escape does not call onMobileClose when mobile sidebar is closed', () => {
      const onMobileClose = vi.fn();
      render(<SettingsNavTree {...defaultProps} onMobileClose={onMobileClose} />);

      fireKey('Escape');

      expect(onMobileClose).not.toHaveBeenCalled();
    });
  });

  // ── Accessibility regression tests (P60-5c) ────────────────

  describe('accessibility live region', () => {
    /** Get the role="status" live region element. */
    function getLiveRegion() {
      return document.querySelector('[role="status"]');
    }

    it('renders a role="status" live region for screen reader announcements', () => {
      render(<SettingsNavTree {...defaultProps} />);

      const region = getLiveRegion();
      expect(region).toBeInTheDocument();
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveAttribute('aria-atomic', 'true');
      expect(region).toHaveClass('sr-only');
    });

    it('announces category expanded when a collapsed category header is clicked', async () => {
      const user = userEvent.setup();
      render(<SettingsNavTree {...defaultProps} />);

      // Click Operations (collapsed by default) to expand it
      const operationsBtn = screen.getByText('Operations').closest('button')!;
      await user.click(operationsBtn);

      const region = getLiveRegion();
      expect(region?.textContent).toContain('Operations category expanded');
    });

    it('announces category collapsed when the expanded category header is clicked again', async () => {
      const user = userEvent.setup();
      render(<SettingsNavTree {...defaultProps} />);

      // Business starts expanded — click to collapse
      const businessBtn = screen.getByText('Business').closest('button')!;
      await user.click(businessBtn);

      const region = getLiveRegion();
      expect(region?.textContent).toContain('Business category collapsed');
    });

    it('announces section activated when activeSection prop changes', () => {
      const { rerender } = render(<SettingsNavTree {...defaultProps} activeSection="general" />);

      rerender(<SettingsNavTree {...defaultProps} activeSection="receipt" />);

      const region = getLiveRegion();
      expect(region?.textContent).toContain('Opened Receipt settings');
    });

    it('announces search results count when query changes', () => {
      const { rerender } = render(<SettingsNavTree {...defaultProps} searchQuery="" />);

      rerender(<SettingsNavTree {...defaultProps} searchQuery="general" />);

      const region = getLiveRegion();
      expect(region?.textContent).toContain('1 result found');
    });

    it('announces empty search state when no results match', () => {
      const { rerender } = render(<SettingsNavTree {...defaultProps} searchQuery="" />);

      rerender(<SettingsNavTree {...defaultProps} searchQuery="xyznonexistent" />);

      const region = getLiveRegion();
      expect(region?.textContent).toContain('No settings match your search');
    });

    it('announces search cleared when query is reset to empty', () => {
      const { rerender } = render(<SettingsNavTree {...defaultProps} searchQuery="general" />);

      rerender(<SettingsNavTree {...defaultProps} searchQuery="" />);

      const region = getLiveRegion();
      expect(region?.textContent).toContain('Search cleared');
    });
  });

  // ── aria-expanded and panel linking ──────────────────────

  it('category headers link to their panels via aria-controls', () => {
    render(<SettingsNavTree {...defaultProps} />);

    const businessBtn = screen.getByText('Business').closest('button')!;
    expect(businessBtn).toHaveAttribute('aria-controls', 'settings-panel-business');

    const panel = document.getElementById('settings-panel-business');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('role', 'region');
  });

  it('active nav item has aria-selected="true"', () => {
    render(<SettingsNavTree {...defaultProps} activeSection="appearance" />);

    const activeItem = getActiveNavItem();
    expect(activeItem).toHaveAttribute('aria-selected', 'true');
  });

});
