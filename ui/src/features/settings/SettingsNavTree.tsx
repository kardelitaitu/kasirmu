import { useEffect, useState, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Localized, useLocalization } from '@fluent/react';
import Tooltip from '@/frontend/shell/Tooltip';
import Fuse from 'fuse.js';
import type { FuseResultMatch } from 'fuse.js';

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
    key: 'diagnostics',
    label: 'Diagnostics',
    scope: 'organization',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
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
  { label: 'System', keys: ['about', 'license', 'diagnostics', 'topology', 'local-api'] },
];

const NAV_L10N_KEYS: Record<string, string> = {
  general: 'settings-nav-general',
  appearance: 'settings-nav-appearance',
  receipt: 'settings-nav-receipt',
  sync: 'settings-nav-sync',
  'local-api': 'settings-nav-local-api',
  about: 'settings-nav-about',
  license: 'settings-nav-license',
  diagnostics: 'settings-nav-diagnostics',
  email: 'settings-nav-email',
  topology: 'settings-nav-topology',
  'store-pos': 'settings-nav-store-pos',
  'restaurant-pos': 'settings-nav-restaurant-pos',
  inventory: 'settings-nav-inventory',
};

// ── Exported for SettingsPage breadcrumb ────────────────────────

export { NAV_ITEMS, CATEGORIES, CATEGORY_I18N_KEYS, NAV_L10N_KEYS };

// ── Localized label resolution ───────────────────────────────
// Resolve a Fluent key to the current-locale string, falling back to the
// English constant when the bundle returns the key itself or an empty string
// (e.g. a key the active locale does not define yet).
function resolveLocalizedLabel(
  l10n: { getString: (id: string) => string },
  key: string,
  english: string,
): string {
  const translated = l10n.getString(key);
  return translated && translated !== key ? translated : english;
}

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

  // ── Per-key debounced localStorage write (P60-2c: prevents race on rapid toggle) ─
  // Each preference key owns its own pending timer so two toggles on DIFFERENT
  // keys within the debounce window no longer clobber each other (the previous
  // shared-timer design silently dropped the first write). On unmount we FLUSH
  // every pending write rather than dropping it, so no preference is lost.
  const pendingWritesRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>>(new Map());

  function debouncedPersist(key: string, value: string | null) {
    const existing = pendingWritesRef.current.get(key);
    if (existing) clearTimeout(existing.timer);

    const run = () => {
      if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
      pendingWritesRef.current.delete(key);
    };

    const timer = setTimeout(run, 100);
    pendingWritesRef.current.set(key, { timer, run });
  }

  useEffect(() => {
    const pending = pendingWritesRef.current;
    return () => {
      // Flush all pending writes on unmount instead of dropping them.
      pending.forEach(({ timer, run }) => {
        clearTimeout(timer);
        run();
      });
      pending.clear();
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
    { keys: ['↑', '↓'], desc: l10n.getString('settings-shortcuts-desc-navigate') },
    { keys: ['→'], desc: l10n.getString('settings-shortcuts-desc-expand') },
    { keys: ['←'], desc: l10n.getString('settings-shortcuts-desc-collapse') },
    { keys: ['Home', 'End'], desc: l10n.getString('settings-shortcuts-desc-firstlast') },
    { keys: ['Esc'], desc: l10n.getString('settings-shortcuts-desc-close') },
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
        setAnnouncement(l10n.getString('settings-announce-section-opened', { section: item.label }));
      }
      prevSection.current = activeSection;
    }
  }, [activeSection, l10n]);

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
  // Search must match the user's CURRENT locale, not just English. We build
  // the index from the localized label (falling back to the English constant
  // when the bundle has no translation) and ALSO keep englishLabel /
  // englishCategory so typing the English term still finds the section. The
  // index is rebuilt whenever the locale or l10n binding changes
  // (P60-i18n-search).
  const searchData = useMemo(() => {
    return CATEGORIES.flatMap((cat) => {
      const categoryKey = CATEGORY_I18N_KEYS[cat.label] ?? cat.label;
      const categoryLabel = resolveLocalizedLabel(l10n, categoryKey, cat.label);
      return cat.keys.map((key) => {
        const item = NAV_ITEMS.find((n) => n.key === key)!;
        return {
          key: item.key,
          label: resolveLocalizedLabel(l10n, NAV_L10N_KEYS[key] ?? key, item.label),
          category: categoryLabel,
          englishLabel: item.label,
          englishCategory: cat.label,
        };
      });
    });
  }, [l10n]);

  const fuse = useMemo(() => {
    return new Fuse(searchData, {
      keys: ['label', 'category', 'englishLabel', 'englishCategory'],
      threshold: 0.4,
      includeMatches: true,
    });
  }, [searchData]);

  const q = searchQuery.toLowerCase().trim();
  // Map of matched section key -> Fuse match metadata (positions) for the
  // highlight renderer. null when not searching.
  const searchMatches = useMemo(() => {
    if (!q) return null;
    const results = fuse.search(searchQuery.trim());
    const map = new Map<string, readonly FuseResultMatch[]>();
    for (const r of results) map.set(r.item.key, r.matches ?? []);
    return map;
  }, [q, fuse, searchQuery]);

  const filteredCategories = useMemo(() => {
    if (!searchMatches) return CATEGORIES;

    const matchedKeys = new Set(searchMatches.keys());
    return CATEGORIES
      .map((cat) => ({
        ...cat,
        keys: cat.keys.filter((key) => matchedKeys.has(key)),
      }))
      .filter((cat) => cat.keys.length > 0);
  }, [searchMatches]);

  /** Highlight matching characters in a label. Prefers Fuse's fuzzy match
   *  positions (so transliterated / non-substring hits highlight correctly)
   *  and falls back to a raw substring when no 'label' indices are present
   *  (e.g. an English query that matched on englishLabel instead). */
  const highlightLabel = useCallback((label: string, matches?: readonly FuseResultMatch[]) => {
    if (!q) return label;
    const labelMatch = matches?.find((m) => m.key === 'label');
    if (labelMatch && labelMatch.indices.length > 0) {
      const parts: React.ReactNode[] = [];
      let cursor = 0;
      labelMatch.indices.forEach(([start, end], i) => {
        const s = start;
        const e = end + 1;
        if (s > cursor) parts.push(label.slice(cursor, s));
        parts.push(
          <mark key={i} className="settings-nav-highlight">
            {label.slice(s, e)}
          </mark>,
        );
        cursor = e;
      });
      if (cursor < label.length) parts.push(label.slice(cursor));
      return <>{parts}</>;
    }
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
        ? l10n.getString('settings-announce-search-none')
        : l10n.getString('settings-announce-search-count', { count: visibleCount }));
    } else if (!q && prevQ.current) {
      setAnnouncement(l10n.getString('settings-announce-search-cleared'));
    }
    prevQ.current = q;
  }, [q, visibleCount, l10n]);

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
          ? l10n.getString('settings-announce-category-expanded', { category: label, count })
          : l10n.getString('settings-announce-category-collapsed', { category: label }));
      }
      userToggleRef.current = false;
    }
    prevCategories.current = expandedCategories;
  }, [expandedCategories, l10n]);

  // ── Treegrid keyboard navigation (P60-4c/d) ──────────────
  // Escape-to-close-mobile-drawer stays GLOBAL (document) because focus may
  // legitimately rest outside the sidebar while the drawer is open (e.g. on
  // the backdrop or a trapped focus that hasn't entered the aside yet).
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape' && mobileSidebarOpen) {
        e.preventDefault();
        onMobileClose();
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mobileSidebarOpen, onMobileClose]);

  // Arrow / Home / End navigation is scoped to the sidebar so it never hijacks
  // arrows while focus is on a control outside the sidebar (e.g. a detail-pane
  // button or link). Previously it was bound on `document` with only an
  // INPUT/SELECT/TEXTAREA exemption, so it still stole arrows from any other
  // focused element. We keep a single document-level listener (so events
  // dispatched anywhere on the page still reach it) but GUARD it to fire only
  // when the event target is inside the sidebar, or when nothing specific is
  // focused (document / body) — matching the prior page-level behaviour for the
  // common case while fixing the real hijack. The Escape-to-close-mobile-drawer
  // handler above remains a separate GLOBAL document listener.
  useEffect(() => {
    const flatKeys = filteredCategories.flatMap((c) => c.keys);

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as Node | null;
      const tEl = target as HTMLElement | null;
      // Skip when focus is on a form field (typing must not move the nav).
      if (tEl && (tEl.tagName === 'INPUT' || tEl.tagName === 'SELECT' || tEl.tagName === 'TEXTAREA' || tEl.isContentEditable)) return;

      // Scope: only act for events originating inside the sidebar, or when no
      // specific control is focused (document / body). This prevents the handler
      // from hijacking arrow keys while focus rests on a control elsewhere.
      const sidebar = sidebarRef.current;
      const inSidebar = !!sidebar && (target === sidebar || (target != null && sidebar.contains(target)));
      const noFocus = target === null || target === document || target === document.body || target === document.documentElement;
      if (!inSidebar && !noFocus) return;

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
  }, [activeSection, expandedCategories, mobileSidebarOpen, filteredCategories, onNavigate]);

  // ── Render ────────────────────────────────────────────────────

  return (
    <>
      {/* ── Mobile backdrop ───────────────────────
          role="presentation" + tabIndex={-1} marks this purely decorative,
          click-to-dismiss overlay as non-interactive for AT (antipattern fix per
          components/FastPINOverlay.tsx, commit dc6687f3). */}
      <div
        role="presentation"
        tabIndex={-1}
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
          <Tooltip content={l10n.getString('settings-sidebar-collapse-all-aria')} fit="inline" portal>
            <button
              type="button"
              className="settings-sidebar-collapse-all"
              onClick={() => setExpandedCategories([])}
              aria-label={l10n.getString('settings-sidebar-collapse-all-aria')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
                <polyline points="6 15 12 9 18 15" />
              </svg>
            </button>
          </Tooltip>
          {!sidebarCollapsed && (
            <div className="settings-shortcut-btn-wrap" ref={shortcutRef}>
              <Tooltip content={l10n.getString('settings-shortcut-btn-aria')} fit="inline" portal>
                <button
                  type="button"
                  className="settings-shortcut-btn"
                  onClick={() => setShowShortcuts((p) => !p)}
                  aria-label={l10n.getString('settings-shortcut-btn-aria')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h.01M10 16h.01M14 16h4" />
                  </svg>
                </button>
              </Tooltip>
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

        {/* Disclosure-navigation container. The <aside> landmark above already
            carries the accessible name, so this wrapper is intentionally
            role-free: the old role="treegrid" advertised a 2D interactive grid
            the DOM could not honour (no rows/gridcells, no treeitem ownership -
            items were DOM siblings of their headers, split by a region), and
            regions are landmarks, illegal inside a grid. */}
        <div className="settings-sidebar-nav">
          {/* ── Pinned sections (P60-blog-1) ────────────────── */}
          {!q && pinnedSections.length > 0 && !sidebarCollapsed && (
            <div className="settings-sidebar-pinned" role="list" aria-label={l10n.getString('settings-sidebar-pinned-group-aria')}>
              {pinnedSections.map((key) => {
                const item = NAV_ITEMS.find((n) => n.key === key);
                if (!item) return null;
                return (
                  <div key={key} className="settings-nav-item-wrapper" role="listitem">
                    <button
                      type="button"
                      aria-current={activeSection === key ? 'page' : undefined}
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
                    <Tooltip content={l10n.getString('settings-nav-unpin-title')} fit="inline" portal>
                      <button
                        type="button"
                        className="settings-nav-pin-btn pinned"
                        onClick={() => togglePin(key)}
                        aria-label={l10n.getString('settings-nav-unpin-aria', { name: item.label })}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12" aria-hidden="true">
                          <path d="M12 2L9.5 10L2 11l6 6l-1.5 7L12 18l6.5 6L17 17l6-6l-7.5-1z" />
                        </svg>
                      </button>
                    </Tooltip>
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
            filteredCategories.map((cat) => {
              const isExpanded = expandedCategories.includes(cat.label) || !!q;
              const hasActive = cat.keys.includes(activeSection);
              const panelId = `settings-panel-${cat.label.toLowerCase()}`;
              return (
                <div key={cat.label} className="settings-sidebar-section">
                  {/* APG disclosure pattern: the header is a disclosure button
                      (aria-expanded + aria-controls), never a selectable node. */}
                  <button
                    type="button"
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
                        <span className="settings-sidebar-count" key={cat.keys.length} aria-label={l10n.getString('settings-sidebar-count-aria', { count: cat.keys.length })}>
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
                    role="list"
                    className={`settings-sidebar-section-items${isExpanded || sidebarCollapsed ? ' settings-sidebar-section-items--expanded' : ''}`}>
                      {cat.keys.map((key) => {
                        const item = NAV_ITEMS.find((n) => n.key === key)!;
                        return (
                          <div key={key} className="settings-nav-item-wrapper" role="listitem">
                            <Tooltip content={l10n.getString(NAV_L10N_KEYS[item.key] ?? '')} showDelay={800} portal>
                              <button
                                type="button"
                                aria-current={activeSection === key ? 'page' : undefined}
                                className={`settings-nav-item${activeSection === key ? ' settings-nav-item--active' : ''}`}
                                onClick={() => onNavigate(key)}
                                aria-label={l10n.getString(NAV_L10N_KEYS[item.key] ?? '')}
                              >
                                <span className="settings-nav-icon">{item.icon}</span>
                                <span className="settings-nav-label">
                                  {q ? (
                                    highlightLabel(
                                      resolveLocalizedLabel(l10n, NAV_L10N_KEYS[item.key] ?? item.key, item.label),
                                      searchMatches?.get(key),
                                    )
                                  ) : (
                                    <Localized id={NAV_L10N_KEYS[item.key] ?? ''}>{item.label}</Localized>
                                  )}
                                </span>
                                {!sidebarCollapsed && <SettingsScopeTag scope={item.scope} />}
                              </button>
                            </Tooltip>
                            {!sidebarCollapsed && (
                              <Tooltip
                                content={pinnedSections.includes(key) ? l10n.getString('settings-nav-unpin-title') : l10n.getString('settings-nav-pin-title')}
                                fit="inline"
                                portal
                              >
                                <button
                                  type="button"
                                  className={`settings-nav-pin-btn${pinnedSections.includes(key) ? ' pinned' : ''}`}
                                  onClick={() => togglePin(key)}
                                  aria-label={pinnedSections.includes(key) ? l10n.getString('settings-nav-unpin-aria', { name: item.label }) : l10n.getString('settings-nav-pin-aria', { name: item.label })}
                                >
                                  <svg viewBox="0 0 24 24" fill={pinnedSections.includes(key) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12" aria-hidden="true">
                                    <path d="M12 2L9.5 10L2 11l6 6l-1.5 7L12 18l6.5 6L17 17l6-6l-7.5-1z" />
                                  </svg>
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        );
                      })}
                    </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Resize handle (P60-blog-4): APG window-splitter separator ── */}
        {!sidebarCollapsed && (
          /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- APG separator pattern: the window splitter is a focusable non-interactive element with pointer + arrow-key resize by design (aria-valuenow/min/max report the geometry) */
          <div
            role="separator"
            tabIndex={0}
            className="settings-sidebar-resize-handle"
            onMouseDown={handleResizeStart}
            aria-orientation="vertical"
            aria-label={l10n.getString('settings-sidebar-resize-aria')}
            aria-valuenow={sidebarWidth ?? SIDEBAR_MIN_WIDTH}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                // The splitter owns its arrows: stop them from also reaching the
                // sidebar disclosure arrow navigation (expand/collapse).
                e.stopPropagation();
                e.preventDefault();
                setSidebarWidth((prev) => e.key === 'ArrowRight'
                  ? Math.min(SIDEBAR_MAX_WIDTH, (prev ?? SIDEBAR_MIN_WIDTH) + 10)
                  : Math.max(SIDEBAR_MIN_WIDTH, (prev ?? SIDEBAR_MIN_WIDTH) - 10));
              }
            }}
          />
        )}
        {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
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
