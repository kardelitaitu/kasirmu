import { useEffect, useState, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Localized, useLocalization } from '@fluent/react';
import Tooltip from '@/frontend/shell/Tooltip';
import Fuse from 'fuse.js';

import { SettingsScopeTag, type SettingsScopeLevel } from './SettingsScopeTag';

// ── Sidebar nav item type ─────────────────────────────────────────

export interface SettingsNavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  scope: SettingsScopeLevel;
}

const NAV_ITEMS: SettingsNavItem[] = [
  {
    key: 'general',
    label: 'General',
    scope: 'organization',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    key: 'appearance',
    label: 'Appearance',
    scope: 'workspace',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
  {
    key: 'receipt',
    label: 'Receipt',
    scope: 'workspace',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    key: 'sync',
    label: 'Cloud Sync',
    scope: 'organization',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    key: 'local-api',
    label: 'Local API',
    scope: 'terminal',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
  {
    key: 'about',
    label: 'About',
    scope: 'terminal',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },

  {
    key: 'license',
    label: 'License',
    scope: 'organization',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
      </svg>
    ),
  },
  {
    key: 'email',
    label: 'Email Reports',
    scope: 'organization',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M22 7l-10 7L2 7" />
      </svg>
    ),
  },
  {
    key: 'topology',
    label: 'Topology',
    scope: 'organization',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="12" cy="18" r="3" />
        <line x1="8.5" y1="7.5" x2="10.5" y2="16.5" />
        <line x1="15.5" y1="7.5" x2="13.5" y2="16.5" />
      </svg>
    ),
  },
  {
    key: 'store-pos',
    label: 'Store POS',
    scope: 'workspace',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    ),
  },
  {
    key: 'restaurant-pos',
    label: 'Restaurant POS',
    scope: 'workspace',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
        <path d="M7 2v20" />
        <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
      </svg>
    ),
  },
  {
    key: 'inventory',
    label: 'Inventory',
    scope: 'location',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
];

// ── Category groupings (accordion) ──────────────────────────────

interface SettingsCategory {
  label: string;
  keys: string[];
}

const CATEGORY_I18N_KEYS: Record<string, string> = {
  Business: 'settings-category-business',
  Operations: 'settings-category-operations',
  System: 'settings-category-system',
};

const CATEGORIES: SettingsCategory[] = [
  { label: 'Business', keys: ['general', 'appearance'] },
  { label: 'Operations', keys: ['receipt', 'sync', 'email', 'store-pos', 'restaurant-pos', 'inventory'] },
  { label: 'System', keys: ['about', 'license', 'topology', 'local-api'] },
];

const NAV_L10N_KEYS: Record<string, string> = {
  general: 'settings-nav-general',
  appearance: 'settings-nav-appearance',
  receipt: 'settings-nav-receipt',
  sync: 'settings-nav-sync',
  'local-api': 'settings-nav-local-api',
  about: 'settings-nav-about',
  license: 'settings-nav-license',
  email: 'settings-nav-email',
  topology: 'settings-nav-topology',
  'store-pos': 'settings-nav-store-pos',
  'restaurant-pos': 'settings-nav-restaurant-pos',
  inventory: 'settings-nav-inventory',
};

// ── Exported for SettingsPage breadcrumb ────────────────────────

export { NAV_ITEMS, CATEGORIES, CATEGORY_I18N_KEYS, NAV_L10N_KEYS };

// ── Props ────────────────────────────────────────────────────────

interface SettingsNavTreeProps {
  activeSection: string;
  onNavigate: (key: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  mobileSidebarOpen: boolean;
  onMobileClose: () => void;
}

// ── Imperative handle type for parent ───────────────────────────
export interface SettingsNavTreeHandle {
  toggleCategory: (label: string) => void;
}

// ── Component ─────────────────────────────────────────────────────

const SettingsNavTree = forwardRef<SettingsNavTreeHandle, SettingsNavTreeProps>(function SettingsNavTree({
  activeSection,
  onNavigate,
  searchQuery,
  onSearchChange,
  mobileSidebarOpen,
  onMobileClose,
}, ref) {
  const { l10n } = useLocalization();
  const sidebarRef = useRef<HTMLElement>(null);

  // P60-4b: Focus trap on mobile sidebar overlay
  useFocusTrap(sidebarRef, mobileSidebarOpen, onMobileClose);

  // ── Debounced localStorage write (P60-2c: prevents race on rapid toggle) ─
  const debouncedRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function debouncedPersist(key: string, value: string | null) {
    if (debouncedRef.current) clearTimeout(debouncedRef.current);
    debouncedRef.current = setTimeout(() => {
      if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
      debouncedRef.current = null;
    }, 100);
  }

  useEffect(() => {
    return () => {
      if (debouncedRef.current) clearTimeout(debouncedRef.current);
    };
  }, []);

  // ── Collapsed sidebar (persisted) ──────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    localStorage.getItem('settings-sidebar-collapsed') === 'true',
  );

  useEffect(() => {
    debouncedPersist('settings-sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);



  // ── Pinned sections (P60-blog-1): saved to top of sidebar ───────
  const [pinnedSections, setPinnedSections] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('settings-pinned-sections');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { /* ignore corrupt JSON */ }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('settings-pinned-sections', JSON.stringify(pinnedSections));
  }, [pinnedSections]);

  const togglePin = useCallback((key: string) => {
    setPinnedSections((prev) =>
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key],
    );
  }, []);



  // ── Resizable sidebar drag state (P60-blog-4) ────────────────
  const SIDEBAR_MIN_WIDTH = 250;
  const SIDEBAR_MAX_WIDTH = 400;

  const [sidebarWidth, setSidebarWidth] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem('settings-sidebar-width');
      if (stored) {
        const parsed = Number(stored);
        if (!isNaN(parsed) && parsed >= SIDEBAR_MIN_WIDTH && parsed <= SIDEBAR_MAX_WIDTH) {
          return parsed;
        }
      }
    } catch { /* ignore corrupt data */ }
    return null;
  });

  const isResizing = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const currentWidthRef = useRef(sidebarWidth ?? SIDEBAR_MIN_WIDTH);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    startXRef.current = e.clientX;
    const startWidth = sidebarWidth ?? SIDEBAR_MIN_WIDTH;
    startWidthRef.current = startWidth;
    currentWidthRef.current = startWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = ev.clientX - startXRef.current;
      const newWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, startWidthRef.current + delta));
      currentWidthRef.current = newWidth;
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        localStorage.setItem('settings-sidebar-width', String(currentWidthRef.current));
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  useEffect(() => {
    return () => {
      isResizing.current = false;
    };
  }, []);

  // ── Keyboard shortcut hints (P60-blog-3) ─────────────────
  const KEYBOARD_SHORTCUTS = [
    { keys: ['↑', '↓'], desc: 'Navigate items' },
    { keys: ['→'], desc: 'Expand category' },
    { keys: ['←'], desc: 'Collapse category' },
    { keys: ['Home', 'End'], desc: 'First / last item' },
    { keys: ['Esc'], desc: 'Close mobile sidebar' },
  ];

  const [showShortcuts, setShowShortcuts] = useState(false);
  const shortcutRef = useRef<HTMLDivElement>(null);

  // Close shortcuts popover on click outside
  useEffect(() => {
    if (!showShortcuts) return;
    const handleClick = (e: MouseEvent) => {
      if (shortcutRef.current && !shortcutRef.current.contains(e.target as Node)) {
        setShowShortcuts(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showShortcuts]);

  // ── Screen reader live announcements (P60-4e) ────────────────
  const [announcement, setAnnouncement] = useState('');

  // Announce section activated when navigating
  const prevSection = useRef(activeSection);
  useEffect(() => {
    if (prevSection.current !== activeSection) {
      const item = NAV_ITEMS.find((n) => n.key === activeSection);
      if (item) {
        setAnnouncement(`Opened ${item.label} settings`);
      }
      prevSection.current = activeSection;
    }
  }, [activeSection]);

  // ── Collapsible categories (multi-expandable, persisted) ──────────
  const [expandedCategories, setExpandedCategories] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('settings-sidebar-expanded');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore corrupt localStorage data
    }
    return ['Business'];
  });

  useEffect(() => {
    debouncedPersist('settings-sidebar-expanded', JSON.stringify(expandedCategories));
  }, [expandedCategories]);

  // Auto-expand category when navigating to a section
  useEffect(() => {
    const cat = CATEGORIES.find((c) => c.keys.includes(activeSection));
    if (cat?.label) {
      setExpandedCategories((prev) => 
        prev.includes(cat.label) ? prev : [...prev, cat.label]
      );
    }
  }, [activeSection]);

  const toggleCategory = useCallback((label: string) => {
    userToggleRef.current = true;
    setExpandedCategories((prev) => 
      prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label]
    );
  }, []);

  // ── Expose imperative toggleCategory to parent (P60-breadcrumb) ─
  useImperativeHandle(ref, () => ({ toggleCategory }), [toggleCategory]);

  // ── Fuse.js fuzzy search (P60-blog-2) ────────────────────────
  const searchData = useMemo(() => {
    return CATEGORIES.flatMap((cat) =>
      cat.keys.map((key) => {
        const item = NAV_ITEMS.find((n) => n.key === key)!;
        return { key: item.key, label: item.label, category: cat.label };
      }),
    );
  }, []);

  const fuse = useMemo(() => {
    return new Fuse(searchData, {
      keys: ['label', 'category'],
      threshold: 0.4,
      includeMatches: true,
    });
  }, [searchData]);

  const q = searchQuery.toLowerCase().trim();
  const filteredCategories = useMemo(() => {
    if (!q) return CATEGORIES;

    const results = fuse.search(searchQuery.trim());
    const matchedKeys = new Set(results.map((r) => r.item.key));

    return CATEGORIES
      .map((cat) => ({
        ...cat,
        keys: cat.keys.filter((key) => matchedKeys.has(key)),
      }))
      .filter((cat) => cat.keys.length > 0);
  }, [q, fuse, searchQuery]);

  /** Highlight matching characters in a label. */
  const highlightLabel = useCallback((label: string) => {
    if (!q) return label;
    const idx = label.toLowerCase().indexOf(q);
    if (idx === -1) return label;
    return (
      <>
        {label.slice(0, idx)}
        <mark className="settings-nav-highlight">{label.slice(idx, idx + q.length)}</mark>
        {label.slice(idx + q.length)}
      </>
    );
  }, [q]);

  /** Total visible items across all filtered categories. */
  const visibleCount = useMemo(() =>
    filteredCategories.reduce((sum, cat) => sum + cat.keys.length, 0),
  [filteredCategories]);

  // ── Screen reader: announce search results when query changes (P60-4e) ─
  const prevQ = useRef(q);
  useEffect(() => {
    if (q && prevQ.current !== q) {
      setAnnouncement(visibleCount === 0
        ? 'No settings match your search'
        : `${visibleCount} ${visibleCount === 1 ? 'result' : 'results'} found`);
    } else if (!q && prevQ.current) {
      setAnnouncement('Search cleared');
    }
    prevQ.current = q;
  }, [q, visibleCount]);

  // ── Screen reader: announce category expand/collapse (P60-4e) ────
  // We track previous expandedCategories to detect user-initiated toggles
  // (as opposed to programmatic auto-expand when navigating sections).
  const prevCategories = useRef(expandedCategories);
  const userToggleRef = useRef(false);
  useEffect(() => {
    // Only announce if this change was user-initiated (via toggleCategory)
    if (userToggleRef.current) {
      const prev = prevCategories.current;
      const added = expandedCategories.find((c) => !prev.includes(c));
      const removed = prev.find((c) => !expandedCategories.includes(c));
      const label = added || removed || '';
      if (label) {
        const count = CATEGORIES.find((c) => c.label === label)?.keys.length ?? 0;
        setAnnouncement(added
          ? `${label} category expanded, ${count} ${count === 1 ? 'item' : 'items'}`
          : `${label} category collapsed`);
      }
      userToggleRef.current = false;
    }
    prevCategories.current = expandedCategories;
  }, [expandedCategories]);

  // ── Treegrid keyboard navigation (P60-4c/d) ──────────────
  useEffect(() => {
    const flatKeys = filteredCategories.flatMap((c) => c.keys);

    function handleKeyDown(e: KeyboardEvent) {
      // Escape → close mobile sidebar
      if (e.key === 'Escape' && mobileSidebarOpen) {
        e.preventDefault();
        onMobileClose();
        return;
      }

      // Skip when focused on inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      // P60-2b: Guard against empty search results
      if (flatKeys.length === 0) return;

      const idx = flatKeys.indexOf(activeSection);
      if (idx === -1) return;

      // Home / End → first / last item
      if (e.key === 'Home') {
        e.preventDefault();
        if (flatKeys[0]) onNavigate(flatKeys[0]);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        const lastKey = flatKeys[flatKeys.length - 1];
        if (lastKey) onNavigate(lastKey);
        return;
      }

      // ArrowRight → select first child item if category is collapsed
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const cat = CATEGORIES.find((c) => c.keys.includes(activeSection));
        if (cat && !expandedCategories.includes(cat.label)) {
          // Category is collapsed — expand it
          setExpandedCategories((prev) => [...prev, cat.label]);
        }
        return;
      }

      // ArrowLeft → collapse parent category (if at level 2)
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const cat = CATEGORIES.find((c) => c.keys.includes(activeSection));
        if (cat && expandedCategories.includes(cat.label)) {
          // Current section's category is expanded — collapse it
          setExpandedCategories((prev) => prev.filter((c) => c !== cat.label));
        }
        return;
      }

      // ArrowDown / ArrowUp → navigate through visible items
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = e.key === 'ArrowDown'
          ? (idx + 1) % flatKeys.length
          : (idx - 1 + flatKeys.length) % flatKeys.length;
        const nextKey = flatKeys[next];
        if (!nextKey) return;
        onNavigate(nextKey);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeSection, expandedCategories, mobileSidebarOpen, filteredCategories, onMobileClose, onNavigate]);

  // ── Render ────────────────────────────────────────────────────

  return (
    <>
      {/* ── Mobile backdrop ─────────────────────── */}
      <div
        className={`settings-sidebar-backdrop${mobileSidebarOpen ? ' visible' : ''}`}
        onClick={onMobileClose}
        aria-hidden="true"
      />

      {/* ── Sidebar ────────────────────────────────── */}
      <aside
        ref={sidebarRef}
        className={`settings-sidebar${sidebarCollapsed ? ' collapsed' : ''}${mobileSidebarOpen ? ' mobile-open' : ''}`}
        data-testid="settings-sidebar"
        aria-label={l10n.getString('settings-sidebar-nav-aria')}
        style={sidebarWidth && !sidebarCollapsed ? { width: sidebarWidth, minWidth: sidebarWidth } as React.CSSProperties : undefined}
      >
        <div className="settings-sidebar-header">
          <button
            type="button"
            className="settings-sidebar-collapse-all"
            onClick={() => setExpandedCategories([])}
            aria-label={l10n.getString('settings-sidebar-collapse-all-aria')}
            title={l10n.getString('settings-sidebar-collapse-all-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
              <polyline points="6 15 12 9 18 15" />
            </svg>
          </button>
          {!sidebarCollapsed && (
            <div className="settings-shortcut-btn-wrap" ref={shortcutRef}>
              <button
                type="button"
                className="settings-shortcut-btn"
                onClick={() => setShowShortcuts((p) => !p)}
                aria-label={l10n.getString('settings-shortcut-btn-aria')}
                title={l10n.getString('settings-shortcut-btn-aria')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h.01M10 16h.01M14 16h4" />
                </svg>
              </button>
              {showShortcuts && (
                <div className="settings-shortcuts-popover" role="tooltip">
                  <div className="settings-shortcuts-title">{l10n.getString('settings-shortcuts-title')}</div>
                  {KEYBOARD_SHORTCUTS.map((shortcut) => (
                    <div key={shortcut.keys.join('')} className="settings-shortcuts-row">
                      <kbd className="settings-shortcuts-kbd">
                        {shortcut.keys.map((k, i) => (
                          <span key={k}>
                            {i > 0 && <span className="settings-shortcuts-sep">/</span>}
                            <span>{k}</span>
                          </span>
                        ))}
                      </kbd>
                      <span className="settings-shortcuts-desc">{shortcut.desc}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="settings-sidebar-toggle"
            onClick={() => setSidebarCollapsed((p) => !p)}
            aria-label={
              sidebarCollapsed
                ? l10n.getString('settings-sidebar-expand-aria')
                : l10n.getString('settings-sidebar-collapse-aria')
            }
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="16"
              height="16"
              aria-hidden="true"
            >
              <polyline points={sidebarCollapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6'} />
            </svg>
          </button>
        </div>

        <div
          className="settings-sidebar-nav"
          role="treegrid"
          aria-label={l10n.getString('settings-sidebar-nav-aria')}
        >
          {/* ── Pinned sections (P60-blog-1) ────────────────── */}
          {!q && pinnedSections.length > 0 && !sidebarCollapsed && (
            <div className="settings-sidebar-pinned" role="group" aria-label={l10n.getString('settings-sidebar-pinned-group-aria')}>
              {pinnedSections.map((key) => {
                const item = NAV_ITEMS.find((n) => n.key === key);
                if (!item) return null;
                return (
                  <div key={key} className="settings-nav-item-wrapper">
                    <button
                      type="button"
                      role="treeitem"
                      aria-level={2}
                      aria-selected={activeSection === key}
                      className={`settings-nav-item${activeSection === key ? ' settings-nav-item--active' : ''}`}
                      onClick={() => onNavigate(key)}
                      aria-label={l10n.getString(NAV_L10N_KEYS[item.key] ?? '')}
                    >
                      <span className="settings-nav-icon">{item.icon}</span>
                      <span className="settings-nav-label">
                        <Localized id={NAV_L10N_KEYS[item.key] ?? ''}>{item.label}</Localized>
                      </span>
                      <SettingsScopeTag scope={item.scope} />
                    </button>
                    <button
                      type="button"
                      className="settings-nav-pin-btn pinned"
                      onClick={() => togglePin(key)}
                      aria-label={l10n.getString('settings-nav-unpin-aria', { name: item.label })}
                      title={l10n.getString('settings-nav-unpin-title')}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12" aria-hidden="true">
                        <path d="M12 2L9.5 10L2 11l6 6l-1.5 7L12 18l6.5 6L17 17l6-6l-7.5-1z" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {q && filteredCategories.length === 0 ? (
            <div className="settings-sidebar-empty-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="1.75rem" height="1.75rem" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
              <Localized id="settings-sidebar-no-results">
                <span className="settings-sidebar-empty-title">No matching sections</span>
              </Localized>
              <button
                type="button"
                className="settings-sidebar-empty-clear"
                onClick={() => onSearchChange('')}
              >
                <Localized id="settings-sidebar-clear-results">Clear search</Localized>
              </button>
            </div>
          ) : (
            filteredCategories.map((cat, catIdx) => {
              const isExpanded = expandedCategories.includes(cat.label) || !!q;
              const hasActive = cat.keys.includes(activeSection);
              const panelId = `settings-panel-${cat.label.toLowerCase()}`;
              return (
                <div key={cat.label} className="settings-sidebar-section">
                  <button
                    type="button"
                    role="treeitem"
                    aria-level={1}
                    aria-posinset={catIdx + 1}
                    aria-setsize={filteredCategories.length}
                    // Treeitem parent nodes are expandable, not selectable
                    aria-selected={false}
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    className={`settings-sidebar-section-header${hasActive ? ' settings-sidebar-section-header--active' : ''}`}
                    onClick={() => toggleCategory(cat.label)}
                  >
                    <span className="settings-sidebar-section-label-wrap">
                      <span className="settings-sidebar-section-label">
                        <Localized id={CATEGORY_I18N_KEYS[cat.label] ?? ''}>{cat.label}</Localized>
                      </span>
                      {!sidebarCollapsed && (
                        <span className="settings-sidebar-count" key={cat.keys.length} title={l10n.getString('settings-sidebar-count-title', { count: cat.keys.length })} aria-label={l10n.getString('settings-sidebar-count-aria', { count: cat.keys.length })}>
                          {cat.keys.length}
                        </span>
                      )}
                    </span>
                    <svg
                      className={`settings-sidebar-chevron${isExpanded ? '' : ' collapsed'}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width="12"
                      height="12"
                      aria-hidden="true"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                  <div
                    id={panelId}
                    role="region"
                    aria-label={l10n.getString(CATEGORY_I18N_KEYS[cat.label] ?? cat.label)}
                    className={`settings-sidebar-section-items${isExpanded || sidebarCollapsed ? ' settings-sidebar-section-items--expanded' : ''}`}>
                      {cat.keys.map((key, itemIdx) => {
                        const item = NAV_ITEMS.find((n) => n.key === key)!;
                        return (
                          <Tooltip
                            key={key}
                            content={l10n.getString(NAV_L10N_KEYS[item.key] ?? '')}
                            showDelay={800}
                            portal
                            // Suppressed while expanded: labels are already
                            // visible, so a bubble repeating the label reads
                            // as a double tooltip. Must be a prop, not CSS —
                            // portal bubbles live in document.body, outside
                            // the sidebar's descendant-selector reach.
                            disabled={!sidebarCollapsed}
                          >
                            <div className="settings-nav-item-wrapper">
                              <button
                                type="button"
                                role="treeitem"
                                aria-level={2}
                                aria-posinset={itemIdx + 1}
                                aria-setsize={cat.keys.length}
                                aria-selected={activeSection === key}
                                className={`settings-nav-item${activeSection === key ? ' settings-nav-item--active' : ''}`}
                                onClick={() => onNavigate(key)}
                                aria-label={l10n.getString(NAV_L10N_KEYS[item.key] ?? '')}
                              >
                                <span className="settings-nav-icon">{item.icon}</span>
                                <span className="settings-nav-label">
                                  {q ? highlightLabel(l10n.getString(NAV_L10N_KEYS[item.key] ?? item.label)) : (
                                    <Localized id={NAV_L10N_KEYS[item.key] ?? ''}>{item.label}</Localized>
                                  )}
                                </span>
                                {!sidebarCollapsed && <SettingsScopeTag scope={item.scope} />}
                              </button>
                              {!sidebarCollapsed && (
                                <button
                                  type="button"
                                  className={`settings-nav-pin-btn${pinnedSections.includes(key) ? ' pinned' : ''}`}
                                  onClick={() => togglePin(key)}
                                  aria-label={pinnedSections.includes(key) ? l10n.getString('settings-nav-unpin-aria', { name: item.label }) : l10n.getString('settings-nav-pin-aria', { name: item.label })}
                                  title={pinnedSections.includes(key) ? l10n.getString('settings-nav-unpin-title') : l10n.getString('settings-nav-pin-title')}
                                >
                                  <svg viewBox="0 0 24 24" fill={pinnedSections.includes(key) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12" aria-hidden="true">
                                    <path d="M12 2L9.5 10L2 11l6 6l-1.5 7L12 18l6.5 6L17 17l6-6l-7.5-1z" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </Tooltip>
                        );
                      })}
                    </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Resize handle (P60-blog-4) ─────────── */}
        {!sidebarCollapsed && (
          <button
            type="button"
            className="settings-sidebar-resize-handle"
            onMouseDown={handleResizeStart}
            aria-label={l10n.getString('settings-sidebar-resize-aria')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                setSidebarWidth((prev) => Math.min(SIDEBAR_MAX_WIDTH, (prev ?? SIDEBAR_MIN_WIDTH) + 10));
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setSidebarWidth((prev) => Math.max(SIDEBAR_MIN_WIDTH, (prev ?? SIDEBAR_MIN_WIDTH) - 10));
              }
            }}
          />
        )}
      </aside>

      {/* ── Live region: announcements for screen readers (P60-4e) ── */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>
    </>
  );
});

export default SettingsNavTree;
