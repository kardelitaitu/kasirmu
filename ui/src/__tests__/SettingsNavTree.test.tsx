// ── SettingsNavTree tests — FLAT 13-page settings IA ─────────────
//
// The category accordion is gone: the sidebar is ONE role="list" of
// 13 pages in a fixed order (general, license-subscription, devices-
// connectivity, business-defaults, features-modules, security-account,
// data-sync, data-management [subpage, Plus], sync-status [subpage,
// Plus], offline-queue [subpage], tax-configuration, exchange-rates,
// system-diagnostics). These tests assert that mandated reality:
// order, roles, subpage/plus marking, pins, flat Fuse search (both
// locales), flat keyboard cycling, the resize separator, and the
// per-key debounced localStorage persistence.
//
// Labels are NEVER pinned to English strings in expectations: they are
// resolved from the REAL settings.ftl / settings.id.ftl raw imports
// through the ftlResolve() helper below, so copy edits keep the suite
// green while a missing key fails loudly.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsNavTree, {
  NAV_ITEMS,
  NAV_L10N_KEYS,
} from '@/features/settings/SettingsNavTree';
import settingsFtl from '@/locales/settings.ftl?raw';
import settingsIdFtl from '@/locales/settings.id.ftl?raw';

// ── Mocks ────────────────────────────────────────────────────────

const { fluentState } = vi.hoisted(() => ({
  // Shared mock locale: 'en' by default; Indonesian scenario flips it to 'id'.
  fluentState: { locale: 'en' as string },
}));

vi.mock('@fluent/react', () => ({
  useLocalization: () => ({
    l10n: {
      getString: (key: string, args?: Record<string, unknown>) => {
        // Indonesian scenario: serve the id bundle so the component's
        // localized-search index is built from translated labels.
        if (fluentState.locale === 'id') {
          const idText = ftlResolve(
            settingsIdFtl,
            key,
            (args ?? {}) as Record<string, string | number>,
          );
          if (idText) return idText;
        }
        // Default: resolve from the REAL English bundle. Expectations are
        // computed with the same resolver, so no test pins English wording.
        return ftlResolve(settingsFtl, key, (args ?? {}) as Record<string, string | number>);
      },
    },
  }),
  Localized: ({
    children,
  }: {
    id?: string;
    children: React.ReactNode;
    vars?: Record<string, string | number>;
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
    fit?: string;
    portal?: boolean;
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

// ── FTL resolver helpers ─────────────────────────────────────────

/** Raw Fluent message body for a key (multi-line continuations joined). */
function ftlMessage(ftlRaw: string, key: string): string {
  const lines = ftlRaw.split('\n');
  const start = lines.findIndex((l) => l.startsWith(key + ' =') || l.startsWith(key + '='));
  if (start === -1) return '';
  const rawValue = lines[start]!.slice(key.length + 1).trim();
  // Drop the leading "=" produced when the message uses the "{key} = {value}"
  // form so the resolver mirrors what the real Fluent bundle returns.
  const parts = [rawValue.startsWith('=') ? rawValue.slice(1).trim() : rawValue];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('#') || /^\S/.test(line)) break;
    parts.push(line.trim());
  }
  return parts.join(' ');
}

/** Resolve a simple Fluent message: [one]/[other] selects on $count plus $var placeables. */
function ftlResolve(ftlRaw: string, key: string, vars: Record<string, string | number> = {}): string {
  let text = ftlMessage(ftlRaw, key);
  for (;;) {
    const open = text.search(/\{\s*\$\w+\s*->/);
    if (open === -1) break;
    let depth = 0;
    let close = open;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
    }
    const expr = text.slice(open, close + 1);
    const m = /\{\s*\$(\w+)\s*->/.exec(expr)!;
    const body = expr.slice(m[0].length, -1);
    const wanted = Number(vars[m[1]!]) === 1 ? 'one' : 'other';
    const chunks = body.split(/\[([^\]]+)\]/); // [pre, key1, text1, *key2, text2, ...]
    let chosen = '';
    for (let k = 1; k < chunks.length; k += 2) {
      const rawKey = chunks[k]!.trim();
      const keyName = rawKey.replace(/^\*/, '');
      if (rawKey.startsWith('*')) chosen = chunks[k + 1] ?? '';
      if (keyName === wanted) { chosen = chunks[k + 1] ?? ''; break; }
    }
    text = text.slice(0, open) + chosen + text.slice(close + 1);
  }
  text = text.replace(/\{\s*\$(\w+)\s*\}/g, (_m, name: string) => String(vars[name] ?? ''));
  return text.replace(/\s+/g, ' ').trim();
}

/** Expected localized announcement text, resolved from the real English bundle. */
function announceFtl(key: string, vars: Record<string, string | number> = {}): string {
  return ftlResolve(settingsFtl, key, vars);
}

/** The English-locale accessible name the component gives a nav item. */
function labelOf(key: string): string {
  const l10nKey = NAV_L10N_KEYS[key] ?? '';
  return ftlResolve(settingsFtl, l10nKey);
}

/** The Indonesian accessible name for a nav item (id bundle). */
function idLabelOf(key: string): string {
  const l10nKey = NAV_L10N_KEYS[key] ?? '';
  return ftlResolve(settingsIdFtl, l10nKey);
}

/** Get all nav item buttons within the sidebar (flat disclosure items). */
function getNavItems(root: ParentNode = document): HTMLButtonElement[] {
  const sidebar = screen.getByTestId('settings-sidebar');
  const scope = root === document ? sidebar : (root.contains(sidebar) ? sidebar : root);
  return Array.from(scope.querySelectorAll<HTMLButtonElement>('button.settings-nav-item'));
}

/** Keys of the visible nav item buttons, in DOM order (matched via the
 *  bundle-resolved label of the locale the mock is currently serving). */
function visibleNavKeys(root: ParentNode = document): string[] {
  const names = getNavItems(root).map((b) => b.getAttribute('aria-label') ?? '');
  return names.map((name) => {
    const item = NAV_ITEMS.find((n) => {
      const label = fluentState.locale === 'id' ? idLabelOf(n.key) : labelOf(n.key);
      return label === name;
    });
    return item ? item.key : '(unknown)';
  });
}

/** Get the currently active nav item by aria-current="page". */
function getActiveNavItem(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="settings-sidebar"] [aria-current="page"]');
  if (!el) throw new Error('no nav item carries aria-current="page"');
  return el;
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

describe('SettingsNavTree (flat 13-page IA)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    // Default to English for every test unless a scenario opts into 'id'.
    fluentState.locale = 'en';
  });

  // ── Render: the mandated flat list ───────────────────────────

  it('renders all 13 nav items as ONE flat role=list in the mandated order', () => {
    render(<SettingsNavTree {...defaultProps} />);

    const sidebar = screen.getByTestId('settings-sidebar');

    // ONE flat list; every NAV_ITEMS entry visible without expanding anything.
    const lists = Array.from(sidebar.querySelectorAll('[role="list"]'));
    expect(lists).toHaveLength(1);
    const list = lists[0]!;
    expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(13);

    // The mandated key order, asserted against the DOM via bundle-resolved names.
    expect(NAV_ITEMS.map((n) => n.key)).toEqual([
      'general',
      'license-subscription',
      'devices-connectivity',
      'business-defaults',
      'features-modules',
      'security-account',
      'data-sync',
      'data-management',
      'sync-status',
      'offline-queue',
      'tax-configuration',
      'exchange-rates',
      'system-diagnostics',
    ]);
    expect(visibleNavKeys()).toEqual(NAV_ITEMS.map((n) => n.key));

    // Each item is reachable by its accessible name (from settings.ftl, via
    // the same resolver the assertions use).
    for (const item of NAV_ITEMS) {
      expect(screen.getByRole('button', { name: labelOf(item.key) })).toBeInTheDocument();
    }
  });

  it('keeps every nav item key unique with a label key defined in BOTH locale bundles', () => {
    // NAV_ITEMS is the single registry; a duplicated key would render twice,
    // and a missing NAV_L10N_KEYS entry would render its raw key as the label.
    const itemKeys = NAV_ITEMS.map((item) => item.key);
    expect(itemKeys).toHaveLength(new Set(itemKeys).size);

    for (const key of itemKeys) {
      const l10nKey = NAV_L10N_KEYS[key];
      expect(l10nKey, key + ' has no NAV_L10N_KEYS entry').toBeTruthy();
      const pattern = new RegExp('^' + l10nKey + '\\s*=', 'm');
      expect(pattern.test(settingsFtl), l10nKey + ' missing from settings.ftl').toBe(true);
      expect(pattern.test(settingsIdFtl), l10nKey + ' missing from settings.id.ftl').toBe(true);
    }
  });

  it('leaves no category-accordion or tree residue anywhere in the sidebar', () => {
    render(<SettingsNavTree {...defaultProps} activeSection="exchange-rates" />);

    const sidebar = screen.getByTestId('settings-sidebar');
    // Category era: headers, chevrons, count badges, collapse-all control.
    expect(sidebar.querySelector('.settings-sidebar-section-header')).toBeNull();
    expect(sidebar.querySelector('.settings-sidebar-chevron')).toBeNull();
    expect(sidebar.querySelector('.settings-sidebar-count')).toBeNull();
    expect(sidebar.querySelector('.settings-sidebar-collapse-all')).toBeNull();
    expect(sidebar.querySelector('[aria-expanded]')).toBeNull();
    expect(sidebar.querySelector('[aria-controls]')).toBeNull();
    // Tree era: no tree roles or level/selection attributes survive.
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryByRole('treegrid')).toBeNull();
    expect(screen.queryByRole('treeitem')).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
    expect(sidebar.querySelector('[aria-selected]')).toBeNull();
    expect(sidebar.querySelector('[aria-level]')).toBeNull();
    expect(sidebar.querySelector('[aria-posinset]')).toBeNull();
    expect(sidebar.querySelector('[aria-setsize]')).toBeNull();
    // aria-level on any heading (the old category headers used h2s inside buttons).
    expect(document.querySelector('[data-testid="settings-sidebar"] h2')).toBeNull();
  });

  it('marks the active section with aria-current="page" and nothing else', () => {
    render(<SettingsNavTree {...defaultProps} activeSection="tax-configuration" />);

    const active = getActiveNavItem();
    expect(active).toHaveAttribute('aria-label', labelOf('tax-configuration'));
    expect(active.classList.contains('settings-nav-item--active')).toBe(true);
    expect(getNavItems().filter((b) => b.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('marks drill-down pages with the --subpage class and top-level pages without it', () => {
    render(<SettingsNavTree {...defaultProps} />);

    const subpageKeys = ['data-management', 'sync-status', 'offline-queue'];
    for (const item of getNavItems()) {
      const key = visibleNavKeys().find((k) => labelOf(k) === item.getAttribute('aria-label'));
      if (!key) throw new Error('nav button did not map to a known key: ' + item.getAttribute('aria-label'));
      const hasClass = item.classList.contains('settings-nav-item--subpage');
      expect(hasClass, key + ' subpage class').toBe(subpageKeys.includes(key));
    }
  });

  it('badges exactly data-management and sync-status with the Plus pill', () => {
    render(<SettingsNavTree {...defaultProps} />);

    const badgeAria = ftlResolve(settingsFtl, 'settings-nav-plus-badge-aria');
    expect(badgeAria).not.toBe('');
    const plusKeys = NAV_ITEMS.filter((n) => n.plus).map((n) => n.key);
    expect(plusKeys).toEqual(['data-management', 'sync-status']);

    for (const item of getNavItems()) {
      const key = visibleNavKeys().find((k) => labelOf(k) === item.getAttribute('aria-label'));
      const badge = item.querySelector('.settings-nav-plus-badge');
      if (key && plusKeys.includes(key)) {
        expect(badge, key + ' must carry the Plus pill').not.toBeNull();
        expect(badge!.getAttribute('aria-label')).toBe(badgeAria);
        expect(badge!.textContent).toBe('Plus+');
      } else {
        expect(badge, key + ' must NOT carry a Plus pill').toBeNull();
      }
    }
    // offline-queue is a subpage but NOT Plus-gated — the two marks are independent.
    expect(NAV_ITEMS.find((n) => n.key === 'offline-queue')?.plus).toBeFalsy();
  });

  it('renders the sidebar landmark with its accessible name', () => {
    render(<SettingsNavTree {...defaultProps} />);
    const sidebar = screen.getByTestId('settings-sidebar');
    expect(sidebar).toHaveAttribute('aria-label', ftlResolve(settingsFtl, 'settings-sidebar-nav-aria'));
  });

  it('navigates when a nav item is clicked', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} />);

    await user.click(screen.getByRole('button', { name: labelOf('system-diagnostics') }));
    expect(onNavigate).toHaveBeenCalledWith('system-diagnostics');

    onNavigate.mockClear();
    await user.click(screen.getByRole('button', { name: labelOf('general') }));
    expect(onNavigate).toHaveBeenCalledWith('general');
  });

  // ── Pinned group ──────────────────────────────────────────────

  it('pins any page: the pinned group is a labeled list rendered ABOVE the main list', async () => {
    const user = userEvent.setup();
    render(<SettingsNavTree {...defaultProps} activeSection="tax-configuration" />);

    // Pin a page from its row's pin button (aria-label resolves with the English label).
    await user.click(screen.getByRole('button', { name: 'Pin ' + NAV_ITEMS.find((n) => n.key === 'tax-configuration')!.label }));

    const group = document.querySelector('[data-testid="settings-sidebar"] .settings-sidebar-pinned');
    expect(group).not.toBeNull();
    expect(group).toHaveAttribute('role', 'list');
    expect(group).toHaveAttribute('aria-label', ftlResolve(settingsFtl, 'settings-sidebar-pinned-group-aria'));
    expect(group!.querySelectorAll('[role="listitem"]')).toHaveLength(1);

    // The pinned group renders ABOVE the flat list (it is a shortcut strip).
    const list = document.querySelector('[data-testid="settings-sidebar"] .settings-nav-list');
    expect(list).not.toBeNull();
    // eslint-disable-next-line no-bitwise
    expect(group!.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // aria-current mirrors inside the pinned group too.
    expect(group!.querySelector('[aria-current="page"]')).not.toBeNull();
    // The pin persists immediately (pins are not debounced).
    expect(JSON.parse(localStorage.getItem('settings-pinned-sections') ?? '[]')).toEqual(['tax-configuration']);
  });

  it('unpins from the pinned group, restoring the plain flat list', async () => {
    const user = userEvent.setup();
    localStorage.setItem('settings-pinned-sections', JSON.stringify(['data-sync', 'exchange-rates']));
    render(<SettingsNavTree {...defaultProps} />);

    const group = document.querySelector('[data-testid="settings-sidebar"] .settings-sidebar-pinned');
    expect(group!.querySelectorAll('[role="listitem"]')).toHaveLength(2);

    // A pinned page shows the Unpin control in BOTH mirrors (pinned group +
    // main list row); unpinned from the group mirror here.
    const dataSyncLabel = NAV_ITEMS.find((n) => n.key === 'data-sync')!.label;
    expect(screen.getAllByRole('button', { name: 'Unpin ' + dataSyncLabel })).toHaveLength(2);
    await user.click(within(group as HTMLElement).getByRole('button', { name: 'Unpin ' + dataSyncLabel }));
    expect(JSON.parse(localStorage.getItem('settings-pinned-sections') ?? '[]')).toEqual(['exchange-rates']);
    const exchangeLabel = NAV_ITEMS.find((n) => n.key === 'exchange-rates')!.label;
    const groupNow = document.querySelector('.settings-sidebar-pinned');
    expect(groupNow).not.toBeNull();
    await user.click(within(groupNow as HTMLElement).getByRole('button', { name: 'Unpin ' + exchangeLabel }));
    expect(document.querySelector('.settings-sidebar-pinned')).toBeNull();
    expect(JSON.parse(localStorage.getItem('settings-pinned-sections') ?? 'x')).toEqual([]);
  });

  it('hides the pinned group while a search query is active', () => {
    localStorage.setItem('settings-pinned-sections', JSON.stringify(['general']));
    render(<SettingsNavTree {...defaultProps} searchQuery="general" />);

    expect(document.querySelector('.settings-sidebar-pinned')).toBeNull();
    // The flat search result itself still renders.
    expect(getNavItems()).toHaveLength(1);
  });

  it('drops stale pinned keys that no longer exist in the flat IA', async () => {
    // 'appearance' was a page in the old IA; its pin must render nothing.
    localStorage.setItem('settings-pinned-sections', JSON.stringify(['appearance']));
    render(<SettingsNavTree {...defaultProps} />);
    const group = document.querySelector('[data-testid="settings-sidebar"] .settings-sidebar-pinned');
    expect(group).not.toBeNull();
    expect(group!.querySelectorAll('[role="listitem"]')).toHaveLength(0);
    // The stale pin does not pollute the main list: still exactly 13 items.
    expect(getNavItems()).toHaveLength(13);
  });

  // ── Flat search ───────────────────────────────────────────────

  it('filters to a single result and highlights the matched characters', () => {
    render(<SettingsNavTree {...defaultProps} searchQuery="management" />);

    expect(visibleNavKeys()).toEqual(['data-management']);
    const highlights = document.querySelectorAll('[data-testid="settings-sidebar"] mark.settings-nav-highlight');
    expect(highlights.length).toBeGreaterThan(0);
    // Every highlighted fragment is part of the query (case-insensitively).
    for (const h of highlights) {
      expect('management'.toLowerCase()).toContain((h.textContent ?? '').toLowerCase());
    }
  });

  it('filters case-insensitively', () => {
    render(<SettingsNavTree {...defaultProps} searchQuery="GENERAL" />);
    expect(visibleNavKeys()).toEqual(['general']);
  });

  it('returns flat results in NAV order, never relevance order', () => {
    render(<SettingsNavTree {...defaultProps} searchQuery="sync" />);

    // Both sync pages match, and they render in NAV_ITEMS order.
    expect(visibleNavKeys()).toEqual(['data-sync', 'sync-status']);
  });

  it('shows the no-results state and clears via the clear button', async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <SettingsNavTree
        {...defaultProps}
        searchQuery="xyznonexistent"
        onSearchChange={onSearchChange}
      />,
    );

    // The Localized fallback children render (the mock Localized passes them through).
    expect(screen.getByText('No matching sections')).toBeInTheDocument();
    expect(getNavItems()).toHaveLength(0);

    await user.click(screen.getByText('Clear search'));
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('navigating a search result calls onNavigate with the section key', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} searchQuery="management" />);

    await user.click(screen.getByRole('button', { name: labelOf('data-management') }));
    expect(onNavigate).toHaveBeenCalledWith('data-management');
  });

  // ── Localized (Indonesian) sidebar search ────────────────────

  describe('localized (Indonesian) sidebar search', () => {
    beforeEach(() => {
      // Flip the mocked bundle to Indonesian so the component builds its Fuse
      // index from translated labels.
      fluentState.locale = 'id';
    });

    it('finds a page by its Indonesian label', () => {
      // Expectation computed from settings.id.ftl — no hardcoded Indonesian.
      const query = 'kurs';
      const key = 'exchange-rates';
      render(<SettingsNavTree {...defaultProps} searchQuery={query} />);

      expect(visibleNavKeys()).toEqual([key]);
      expect(screen.getByRole('button', { name: idLabelOf(key) })).toBeInTheDocument();
    });

    it('keeps English search working while labels are Indonesian', () => {
      render(<SettingsNavTree {...defaultProps} searchQuery="exchange rates" />);

      // The englishLabel fallback must still resolve to the page, whose
      // accessible name stays the Indonesian translation.
      expect(visibleNavKeys()).toEqual(['exchange-rates']);
      expect(screen.getByRole('button', { name: idLabelOf('exchange-rates') })).toBeInTheDocument();
    });

    it('finds the data-management page by its Indonesian label', async () => {
      const user = userEvent.setup();
      const onNavigate = vi.fn();
      const idLabel = idLabelOf('data-management');
      render(
        <SettingsNavTree {...defaultProps} onNavigate={onNavigate} searchQuery="manajemen" />,
      );

      const item = screen.getByRole('button', { name: idLabel });
      expect(idLabel).not.toBe('data-management');
      await user.click(item);
      expect(onNavigate).toHaveBeenCalledWith('data-management');
    });
  });

  // ── Keyboard navigation (flat cycle) ─────────────────────────

  describe('keyboard navigation', () => {
    it('ArrowDown moves to the next item in flat order', () => {
      const onNavigate = vi.fn();
      render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} activeSection="general" />);

      fireKey('ArrowDown', screen.getByTestId('settings-sidebar'));
      expect(onNavigate).toHaveBeenCalledWith('license-subscription');
    });

    it('ArrowUp moves to the previous item in flat order', () => {
      const onNavigate = vi.fn();
      render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} activeSection="license-subscription" />);

      fireKey('ArrowUp', screen.getByTestId('settings-sidebar'));
      expect(onNavigate).toHaveBeenCalledWith('general');
    });

    it('ArrowDown wraps from the last page to the first', () => {
      const onNavigate = vi.fn();
      render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} activeSection="system-diagnostics" />);

      fireKey('ArrowDown', screen.getByTestId('settings-sidebar'));
      expect(onNavigate).toHaveBeenCalledWith('general');
    });

    it('ArrowUp wraps from the first page to the last', () => {
      const onNavigate = vi.fn();
      render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} activeSection="general" />);

      fireKey('ArrowUp', screen.getByTestId('settings-sidebar'));
      expect(onNavigate).toHaveBeenCalledWith('system-diagnostics');
    });

    it('Home jumps to the first page and End to the last', () => {
      const onNavigate = vi.fn();
      render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} activeSection="security-account" />);

      const sidebar = screen.getByTestId('settings-sidebar');
      fireKey('Home', sidebar);
      expect(onNavigate).toHaveBeenCalledWith('general');
      onNavigate.mockClear();
      fireKey('End', sidebar);
      expect(onNavigate).toHaveBeenCalledWith('system-diagnostics');
    });

    it('ArrowLeft/ArrowRight no longer expand or collapse anything', () => {
      // The accordion is gone; horizontal arrows must be inert for navigation.
      const onNavigate = vi.fn();
      render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} activeSection="business-defaults" />);

      const sidebar = screen.getByTestId('settings-sidebar');
      const collapsedBefore = sidebar.classList.contains('collapsed');
      fireKey('ArrowLeft', sidebar);
      fireKey('ArrowRight', sidebar);

      expect(onNavigate).not.toHaveBeenCalled();
      expect(sidebar.classList.contains('collapsed')).toBe(collapsedBefore);
    });

    it('ArrowDown is no-op when focused on an input element', () => {
      const onNavigate = vi.fn();
      render(<SettingsNavTree {...defaultProps} onNavigate={onNavigate} activeSection="general" />);

      // The input must live INSIDE the sidebar: the arrow handler is scoped
      // to events originating there (or on document/body).
      const sidebar = screen.getByTestId('settings-sidebar');
      const input = document.createElement('input');
      sidebar.appendChild(input);
      try {
        fireKey('ArrowDown', input);
      } finally {
        sidebar.removeChild(input);
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

      fireKey('ArrowDown', screen.getByTestId('settings-sidebar'));
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('arrows are no-op when the active page is not among the search results', () => {
      // The cycle walks the VISIBLE list; an active section hidden by the
      // filter yields no index, and the guard must not invent one.
      const onNavigate = vi.fn();
      render(
        <SettingsNavTree
          {...defaultProps}
          onNavigate={onNavigate}
          activeSection="general"
          searchQuery="sync"
        />,
      );

      const sidebar = screen.getByTestId('settings-sidebar');
      fireKey('ArrowDown', sidebar);
      fireKey('Home', sidebar);
      fireKey('End', sidebar);
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('Escape calls onMobileClose only when the mobile sidebar is open', () => {
      const onMobileClose = vi.fn();
      const { unmount } = render(
        <SettingsNavTree {...defaultProps} mobileSidebarOpen={true} onMobileClose={onMobileClose} />,
      );
      fireKey('Escape');
      expect(onMobileClose).toHaveBeenCalledTimes(1);

      // Re-render with the drawer CLOSED: Escape must no longer fire. The
      // open instance is unmounted first so its global listener is gone.
      unmount();
      onMobileClose.mockClear();
      render(<SettingsNavTree {...defaultProps} onMobileClose={onMobileClose} />);
      fireKey('Escape');
      expect(onMobileClose).not.toHaveBeenCalled();
    });
  });

  // ── Sidebar preference persistence (per-key debounce) ────────

  describe('sidebar preference persistence', () => {
    it('persists the collapsed toggle through the debounce window', () => {
      vi.useFakeTimers();
      try {
        const { getByRole } = render(<SettingsNavTree {...defaultProps} />);

        fireEvent.click(getByRole('button', { name: ftlResolve(settingsFtl, 'settings-sidebar-collapse-aria') }));

        expect(localStorage.getItem('settings-sidebar-collapsed')).toBeNull();
        // The timer is still pending; advance past the 100ms debounce window.
        act(() => { vi.advanceTimersByTime(100); });

        expect(localStorage.getItem('settings-sidebar-collapsed')).toBe('true');
      } finally {
        vi.useRealTimers();
      }
    });

    it('flushes pending preference writes on unmount instead of dropping them', () => {
      vi.useFakeTimers();
      try {
        const { unmount, getByRole } = render(<SettingsNavTree {...defaultProps} />);

        fireEvent.click(getByRole('button', { name: ftlResolve(settingsFtl, 'settings-sidebar-collapse-aria') }));
        // Unmount BEFORE the debounce timer fires → cleanup must flush the write.
        act(() => { unmount(); });

        expect(localStorage.getItem('settings-sidebar-collapsed')).toBe('true');
      } finally {
        vi.useRealTimers();
      }
    });

    it('collapses the sidebar via the toggle and hides the Plus pills', async () => {
      const user = userEvent.setup();
      render(<SettingsNavTree {...defaultProps} />);

      const sidebar = screen.getByTestId('settings-sidebar');
      expect(sidebar.classList.contains('collapsed')).toBe(false);
      expect(document.querySelectorAll('.settings-nav-plus-badge')).toHaveLength(2);

      await user.click(screen.getByRole('button', { name: ftlResolve(settingsFtl, 'settings-sidebar-collapse-aria') }));

      expect(sidebar.classList.contains('collapsed')).toBe(true);
      // The badge is display-none territory in the rail; the Plus mark itself
      // is not rendered while collapsed (it is a label-level affordance).
      expect(document.querySelectorAll('.settings-nav-plus-badge')).toHaveLength(0);
      // And the toggle now offers the expand action.
      expect(screen.getByRole('button', { name: ftlResolve(settingsFtl, 'settings-sidebar-expand-aria') })).toBeInTheDocument();
    });

    it('restores the collapsed state from localStorage on mount', () => {
      localStorage.setItem('settings-sidebar-collapsed', 'true');
      render(<SettingsNavTree {...defaultProps} />);
      expect(screen.getByTestId('settings-sidebar').classList.contains('collapsed')).toBe(true);
    });

    it('sweeps the retired category-expanded localStorage key on mount', () => {
      localStorage.setItem('settings-sidebar-expanded', JSON.stringify(['Business']));
      render(<SettingsNavTree {...defaultProps} />);

      expect(localStorage.getItem('settings-sidebar-expanded')).toBeNull();
    });
  });

  // ── Mobile sidebar overlay ────────────────────────────────────

  describe('mobile overlay', () => {
    it('shows the backdrop when mobileSidebarOpen is true and dismisses on click', async () => {
      const user = userEvent.setup();
      const onMobileClose = vi.fn();
      render(
        <SettingsNavTree {...defaultProps} mobileSidebarOpen={true} onMobileClose={onMobileClose} />,
      );

      const backdrop = document.querySelector('.settings-sidebar-backdrop');
      expect(backdrop).toBeTruthy();
      expect(backdrop!.classList.contains('visible')).toBe(true);
      // Decorative click-to-dismiss surface: never in the a11y tree.
      expect(backdrop).toHaveAttribute('role', 'presentation');
      expect(backdrop).toHaveAttribute('aria-hidden', 'true');

      await user.click(backdrop!);
      expect(onMobileClose).toHaveBeenCalledTimes(1);
    });
  });

  // ── Resize separator ──────────────────────────────────────────

  describe('resize separator', () => {
    it('exposes the handle as a keyboard-operable vertical separator', async () => {
      const user = userEvent.setup();
      render(<SettingsNavTree {...defaultProps} />);

      const handle = document.querySelector<HTMLElement>('[data-testid="settings-sidebar"] [role="separator"]');
      expect(handle).not.toBeNull();
      expect(handle).toHaveAttribute('aria-orientation', 'vertical');
      expect(handle).toHaveAttribute('aria-label', ftlResolve(settingsFtl, 'settings-sidebar-resize-aria'));
      expect(handle).toHaveAttribute('aria-valuemin', '250');
      expect(handle).toHaveAttribute('aria-valuemax', '400');
      expect(handle).toHaveAttribute('aria-valuenow', '250'); // the CSS default width
      expect(handle).toHaveAttribute('tabindex', '0');

      handle!.focus();
      await user.keyboard('{ArrowRight}');
      expect(handle).toHaveAttribute('aria-valuenow', '260');
      // One ArrowLeft lands exactly on the minimum (the CSS default width);
      // a further press clamps there instead of undershooting the bound.
      await user.keyboard('{ArrowLeft}{ArrowLeft}');
      expect(handle).toHaveAttribute('aria-valuenow', '250');
    });

    it('clamps 260 -> 250 -> 250 from a persisted width of 260', async () => {
      const user = userEvent.setup();
      localStorage.setItem('settings-sidebar-width', '260');
      render(<SettingsNavTree {...defaultProps} />);

      const handle = document.querySelector<HTMLElement>('[data-testid="settings-sidebar"] [role="separator"]')!;
      expect(handle).toHaveAttribute('aria-valuenow', '260');

      handle.focus();
      await user.keyboard('{ArrowLeft}');
      expect(handle).toHaveAttribute('aria-valuenow', '250');
      await user.keyboard('{ArrowLeft}');
      expect(handle).toHaveAttribute('aria-valuenow', '250'); // clamped at min
    });

    it('clamps a persisted 395px width at the 400px maximum', async () => {
      const user = userEvent.setup();
      localStorage.setItem('settings-sidebar-width', '395');
      render(<SettingsNavTree {...defaultProps} />);

      const handle = document.querySelector<HTMLElement>('[data-testid="settings-sidebar"] [role="separator"]')!;
      expect(handle).toHaveAttribute('aria-valuenow', '395');
      handle.focus();
      await user.keyboard('{ArrowRight}');
      expect(handle).toHaveAttribute('aria-valuenow', '400');
      await user.keyboard('{ArrowRight}');
      expect(handle).toHaveAttribute('aria-valuenow', '400'); // clamped at max
    });

    it('rejects an out-of-range persisted width and falls back to the default', () => {
      localStorage.setItem('settings-sidebar-width', '999');
      render(<SettingsNavTree {...defaultProps} />);
      const handle = document.querySelector<HTMLElement>('[data-testid="settings-sidebar"] [role="separator"]');
      expect(handle).toHaveAttribute('aria-valuenow', '250');
    });
  });

  // ── Screen reader live region ─────────────────────────────────

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

    it('announces the section opened when activeSection changes', () => {
      const { rerender } = render(<SettingsNavTree {...defaultProps} activeSection="general" />);

      rerender(<SettingsNavTree {...defaultProps} activeSection="exchange-rates" />);

      // The component announces with the English display label; the sentence
      // itself comes from the bundle via the resolver.
      const label = NAV_ITEMS.find((n) => n.key === 'exchange-rates')!.label;
      expect(getLiveRegion()?.textContent).toBe(
        announceFtl('settings-announce-section-opened', { section: label }),
      );
    });

    it('announces the search result count when the query changes', () => {
      const { rerender } = render(<SettingsNavTree {...defaultProps} searchQuery="" />);

      rerender(<SettingsNavTree {...defaultProps} searchQuery="sync" />);

      expect(getLiveRegion()?.textContent).toBe(announceFtl('settings-announce-search-count', { count: 2 }));
    });

    it('announces the empty search state when no results match', () => {
      const { rerender } = render(<SettingsNavTree {...defaultProps} searchQuery="" />);

      rerender(<SettingsNavTree {...defaultProps} searchQuery="xyznonexistent" />);

      expect(getLiveRegion()?.textContent).toBe(announceFtl('settings-announce-search-none'));
    });

    it('announces search cleared when the query is reset to empty', () => {
      const { rerender } = render(<SettingsNavTree {...defaultProps} searchQuery="general" />);

      rerender(<SettingsNavTree {...defaultProps} searchQuery="" />);

      expect(getLiveRegion()?.textContent).toBe(announceFtl('settings-announce-search-cleared'));
    });

    it('resolves every announcement + shortcut key from BOTH locale bundles', () => {
      // Assertions above compute expectations from the same files, so the
      // pinned contract is key EXISTENCE + interpolation, not wording.
      const keys = [
        'settings-announce-section-opened',
        'settings-announce-search-none',
        'settings-announce-search-count',
        'settings-announce-search-cleared',
        'settings-shortcuts-desc-navigate',
        'settings-shortcuts-desc-firstlast',
        'settings-shortcuts-desc-close',
        'settings-nav-plus-badge-aria',
      ];
      const bundles = [
        ['settings.ftl', settingsFtl] as const,
        ['settings.id.ftl', settingsIdFtl] as const,
      ];
      for (const key of keys) {
        for (const [name, raw] of bundles) {
          expect(ftlResolve(raw, key, { section: 'X', count: 2 }), key + ' unresolvable in ' + name).not.toBe('');
        }
      }
    });
  });
});
