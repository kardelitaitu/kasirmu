import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Localized, useLocalization } from '@fluent/react';
import Tooltip from '@/frontend/shell/Tooltip';
import Fuse from 'fuse.js';
import type { FuseResultMatch } from 'fuse.js';

// ── Sidebar nav item type ─────────────────────────────────────────

/**
 * One page in the flat settings sidebar IA. The category accordion is
 * gone: every entry is a page. `subpage` marks a drill-down page
 * (rendered indented with a guide border); `plus` marks a page gated
 * behind the Plus plan (badged in the nav).
 */
export interface SettingsNavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  subpage?: boolean;
  plus?: boolean;
}

// ── Flat page list (13 pages, fixed order) ────────────────────────
// Labels are the English display strings. They double as the Localized
// fallback children and the secondary English search field; the active
// locale resolves through NAV_L10N_KEYS below. Icons are 24-viewBox
// stroke-2 currentColor glyphs, sized by CSS.
const NAV_ITEMS: SettingsNavItem[] = [
  {
    key: 'general',
    label: 'General',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    key: 'license-subscription',
    label: 'License & Subscription',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
      </svg>
    ),
  },
  {
    key: 'devices-connectivity',
    label: 'Devices & Connectivity',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22v-5" />
        <path d="M9 8V2" />
        <path d="M15 8V2" />
        <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
      </svg>
    ),
  },
  {
    key: 'business-defaults',
    label: 'Business Defaults',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </svg>
    ),
  },
  {
    key: 'features-modules',
    label: 'Features & Modules',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    ),
  },
  {
    key: 'security-account',
    label: 'Security & Account',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    key: 'data-sync',
    label: 'Data Sync',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      </svg>
    ),
  },
  {
    key: 'data-management',
    label: 'Data Management',
    subpage: true,
    plus: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    key: 'sync-status',
    label: 'Sync Status',
    subpage: true,
    plus: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    ),
  },
  {
    key: 'sync-conflicts',
    label: 'Sync Conflicts',
    subpage: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 6h8" />
        <path d="M8 12h8" />
        <path d="M8 18h5" />
        <circle cx="19" cy="18" r="2.5" />
      </svg>
    ),
  },
  {
    key: 'offline-queue',
    label: 'Offline Queue',
    subpage: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.5 16.5A5 5 0 0 0 18 10h-1.26A8 8 0 0 0 9 4" />
        <path d="M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.42-.14" />
      </svg>
    ),
  },
  {
    key: 'tax-configuration',
    label: 'Tax Configuration',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="19" y1="5" x2="5" y2="19" />
        <circle cx="6.5" cy="6.5" r="2.5" />
        <circle cx="17.5" cy="17.5" r="2.5" />
      </svg>
    ),
  },
  {
    key: 'exchange-rates',
    label: 'Exchange Rates',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    ),
  },
  {
    key: 'system-diagnostics',
    label: 'System Diagnostics',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
];

// Fluent keys for the localized nav labels. 'settings-nav-general' is
// reused from the previous IA; every other key is defined by the settings
// bundles (settings.ftl / settings.id.ftl).
const NAV_L10N_KEYS: Record<string, string> = {
  general: 'settings-nav-general',
  'license-subscription': 'settings-nav-license-subscription',
  'devices-connectivity': 'settings-nav-devices-connectivity',
  'business-defaults': 'settings-nav-business-defaults',
  'features-modules': 'settings-nav-features-modules',
  'security-account': 'settings-nav-security-account',
  'data-sync': 'settings-nav-data-sync',
  'data-management': 'settings-nav-data-management',
  'sync-status': 'settings-nav-sync-status',
  'offline-queue': 'settings-nav-offline-queue',
  'tax-configuration': 'settings-nav-tax-configuration',
  'exchange-rates': 'settings-nav-exchange-rates',
  'system-diagnostics': 'settings-nav-system-diagnostics',
};

// ── Exported for SettingsPage topbar/breadcrumb ─────────────────

export { NAV_ITEMS, NAV_L10N_KEYS };

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

// ── Component ─────────────────────────────────────────────────────

const SettingsNavTree = function SettingsNavTree({
  activeSection,
  onNavigate,
  searchQuery,
  onSearchChange,
  mobileSidebarOpen,
  onMobileClose,
}: SettingsNavTreeProps) {
  const { l10n } = useLocalization();
  const sidebarRef = useRef<HTMLElement>(null);

  // P60-4b: Focus trap on mobile sidebar overlay
  useFocusTrap(sidebarRef, mobileSidebarOpen, onMobileClose);

  // ── Per-key debounced localStorage write (P60-2c: prevents race on rapid toggle) ─
  // Each preference key owns its own pending timer so two writes on DIFFERENT
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

  // The category accordion persisted 'settings-sidebar-expanded'; with the
  // accordion gone that key is dead data — sweep it once per mount.
  useEffect(() => {
    localStorage.removeItem('settings-sidebar-expanded');
  }, []);

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
  // The flat list has no expand/collapse level, so only the hints that still
  // describe real behaviour are listed.
  const KEYBOARD_SHORTCUTS = [
    { keys: ['↑', '↓'], desc: l10n.getString('settings-shortcuts-desc-navigate') },
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

  // ── Fuse.js fuzzy search (P60-blog-2) ────────────────────────
  // Search must match the user's CURRENT locale, not just English. We build
  // the index from the localized label (falling back to the English constant
  // when the bundle has no translation) and ALSO keep englishLabel so typing
  // the English term still finds the section. The index is rebuilt whenever
  // the locale or l10n binding changes (P60-i18n-search).
  const searchData = useMemo(() => {
    return NAV_ITEMS.map((item) => ({
      key: item.key,
      label: resolveLocalizedLabel(l10n, NAV_L10N_KEYS[item.key] ?? item.key, item.label),
      englishLabel: item.label,
    }));
  }, [l10n]);

  const fuse = useMemo(() => {
    return new Fuse(searchData, {
      keys: ['label', 'englishLabel'],
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

  /** Visible nav items: the full 13-page flat list, or the search-filtered
   *  subset in NAV_ITEMS order (not relevance order — the sidebar must not
   *  reshuffle while typing). The pinned group is hidden during search. */
  const visibleItems = useMemo(() => {
    if (!searchMatches) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => searchMatches.has(item.key));
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

  /** Total visible items (search result count for announcements). */
  const visibleCount = visibleItems.length;

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

  // ── Flat-list keyboard navigation (P60-4c/d) ──────────────
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
  // button or link). We keep a single document-level listener (so events
  // dispatched anywhere on the page still reach it) but GUARD it to fire only
  // when the event target is inside the sidebar, or when nothing specific is
  // focused (document / body). The Escape-to-close-mobile-drawer handler above
  // remains a separate GLOBAL document listener.
  useEffect(() => {
    const flatKeys = visibleItems.map((item) => item.key);

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

      // ArrowDown / ArrowUp → cycle the flat visible order
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
  }, [activeSection, visibleItems, onNavigate]);

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
          {/* (The old "collapse all" button is gone with the categories: the only
              collapsible surface left is the rail itself, and the toggle button
              on the right already owns it.) */}
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

        {/* Flat-navigation container. The <aside> landmark above already carries
            the accessible name, so this wrapper stays role-free (the old
            role="treegrid" was removed for exactly that reason). */}
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

          {q && visibleItems.length === 0 ? (
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
            /* ── ONE flat page list — no categories, no chevrons, no counts.
                Search renders the matching subset in the same flat container. */
            <div className="settings-nav-list" role="list">
              {visibleItems.map((item) => {
                const key = item.key;
                const l10nKey = NAV_L10N_KEYS[key] ?? '';
                return (
                  <div key={key} className="settings-nav-item-wrapper" role="listitem">
                    <Tooltip content={l10n.getString(l10nKey)} showDelay={800} portal>
                      <button
                        type="button"
                        aria-current={activeSection === key ? 'page' : undefined}
                        className={`settings-nav-item${item.subpage ? ' settings-nav-item--subpage' : ''}${activeSection === key ? ' settings-nav-item--active' : ''}`}
                        onClick={() => onNavigate(key)}
                        aria-label={l10n.getString(l10nKey)}
                      >
                        <span className="settings-nav-icon">{item.icon}</span>
                        <span className="settings-nav-label">
                          {q ? (
                            highlightLabel(
                              resolveLocalizedLabel(l10n, l10nKey || item.key, item.label),
                              searchMatches?.get(key),
                            )
                          ) : (
                            <Localized id={l10nKey}>{item.label}</Localized>
                          )}
                        </span>
                        {item.plus && !sidebarCollapsed && (
                          <span className="settings-nav-plus-badge" aria-label={l10n.getString('settings-nav-plus-badge-aria')}>Plus+</span>
                        )}
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
                // sidebar arrow navigation.
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
};

export default SettingsNavTree;
