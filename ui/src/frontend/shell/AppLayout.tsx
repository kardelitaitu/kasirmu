import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import RoleBadge from '@/components/RoleBadge';
import Tooltip from './Tooltip';
import UpdateBanner from './UpdateBanner';
import MemoBanner from '@/features/memo/MemoBanner';
import StoreSwitcher from '@/components/StoreSwitcher';
import StockAlertBell from '@/components/StockAlertBell';
import { useBrand } from '@/contexts/BrandContext';
import { requiredLocalized } from '@/frontend/shared';
import StatusBar from './StatusBar';

import { getNavItems, SECTION_LABELS, type SectionName } from '@/platform/ui/menu-registry';
import './AppLayout.css';

// ── Route type ──────────────────────────────────────────────────────

/** Route name used for application navigation. */
export type AppRoute = string;

// ── Section ordering ─────────────────────────────────────────────────

const SECTION_ORDER: SectionName[] = [
  'operations',
  'sales',
  'products',
  'finance',
  'customers',
  'reports',
  'inventory',
  'tools',
  'settings',
  'dev',
];

/** Group nav items by sidebar section in canonical SECTION_ORDER; items
 *  without a section fall back to 'settings'. Exported for unit tests. */
export function groupBySection<T extends { section?: SectionName }>(items: T[]): { section: SectionName; items: T[] }[] {
  const map = new Map<SectionName, T[]>();
  const seen = new Set<SectionName>();
  for (const item of items) {
    const s = item.section ?? 'settings';
    if (!map.has(s)) {
      map.set(s, []);
      seen.add(s);
    }
    map.get(s)!.push(item);
  }
  return SECTION_ORDER.filter((s) => seen.has(s)).map((s) => ({ section: s, items: map.get(s)! }));
}

// ── Props ───────────────────────────────────────────────────────────

/** Props for the AppLayout sidebar shell component. */
export interface AppLayoutProps {
  /** Current active route. */
  route: AppRoute;
  /** Called when the user clicks a navigation item. */
  onNavigate: (route: AppRoute) => void;
  /** Content to render in the main area. */
  children: ReactNode;
  /** Set of enabled feature keys. If omitted, all nav items are shown. */
  enabledFeatures?: Set<string>;
  /** Current user role for role-based nav filtering. */
  userRole?: string;
  /** Granted permission keys from the session (0046 registry) for nav filtering. */
  permissions?: string[];
  /** Session token for scoped IPC calls (stock alert bell). */
  sessionToken?: string | null;
}

// ── Component ──────────────────────────────────────────────────────

/**
 * Application shell with a sidebar navigation and content area.
 *
 * The sidebar shows the OZ-POS logo, navigation items from the
 * menu-registry, and a theme toggle at the bottom. Nav items that
 * require a disabled feature are hidden.
 *
 * Nav items are registered by feature pages in App.tsx via
 * `registerNavItem()`. The sidebar renders them dynamically
 * instead of using a hardcoded list.
 */
/** Routes that render without the top bar (hamburger + store switcher). */
const ADMIN_ROUTES = new Set(['settings', 'features', 'data-management']);

export default function AppLayout({ route, onNavigate, children, enabledFeatures, userRole, permissions, sessionToken }: AppLayoutProps) {
  const { l10n } = useLocalization();
  const { settings: brandSettings } = useBrand();
  const navItems = getNavItems(enabledFeatures, userRole, permissions);

  // ── Sidebar collapse state (persisted to localStorage) ─────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('app-sidebar-collapsed') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('app-sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);

  // ── Section accordion state (single expanded section) ───────
  const [expandedSection, setExpandedSection] = useState<string | null>(() => {
    try {
      // Migrate from old multi-section format if present
      const oldRaw = localStorage.getItem('app-sidebar-sections');
      if (oldRaw) {
        localStorage.removeItem('app-sidebar-sections');
      }
      return localStorage.getItem('app-sidebar-expanded') || null;
    } catch { return null; }
  });

  useEffect(() => {
    if (expandedSection) {
      localStorage.setItem('app-sidebar-expanded', expandedSection);
    } else {
      localStorage.removeItem('app-sidebar-expanded');
    }
  }, [expandedSection]);

  const toggleSection = useCallback((section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  }, []);

  // Set document title to the brand store name (fallback to 'OZ-POS').
  useEffect(() => {
    document.title = brandSettings.store_name
      ? `${brandSettings.store_name} — OZ-POS`
      : 'OZ-POS';
  }, [brandSettings.store_name]);

  return (
    <div className="app-layout">
      {/* ── Skip-to-content link (keyboard-only, first focusable element) ── */}
      <a
        href="#app-main-content"
        className="skip-to-content"
      >
        {requiredLocalized(l10n, 'a11y-skip-to-content')}
      </a>
      {/* ── Body (sidebar + content) ──────────────────── */}
      <div className="app-layout-body">
        {/* ── Sidebar ──────────────────────────────── */}
        <aside className={`app-sidebar${sidebarCollapsed ? ' collapsed' : ''}`} aria-label={l10n.getString('nav-main-aria')}>
          <div className="app-sidebar-header">
            {/* ── Brand ──────────────────────────────── */}
            <Tooltip content={brandSettings.store_name || 'OZ-POS'}>
              <div className="app-sidebar-brand">
                {brandSettings.logo_path ? (
                  <img
                    className="app-sidebar-logo-img"
                    src={`file://${brandSettings.logo_path}`}
                    alt=""
                  />
                ) : (
                  <div className="app-sidebar-brand-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
                      <rect x="3" y="3" width="18" height="14" rx="2" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                      <line x1="7" y1="15" x2="9" y2="15" />
                      <line x1="15" y1="15" x2="17" y2="15" />
                    </svg>
                  </div>
                )}
                <div className="app-sidebar-brand-text">
                  <span className="app-sidebar-store-name">
                    {brandSettings.store_name || 'OZ-POS'}
                  </span>
                  <Localized id="app-sidebar-subtitle">
                    <span className="app-sidebar-subtitle">Point of Sale</span>
                  </Localized>
                </div>
              </div>
            </Tooltip>
            {/* ── User info ──────────────────────────── */}
            <RoleBadge />
          </div>

          <nav className="app-sidebar-nav">
            {groupBySection(navItems).map(({ section, items }) => {
              const sectionI18nKey = SECTION_LABELS[section];
              const isExpanded = expandedSection === section;
              return (
                <div key={section} className="app-sidebar-section">
                  { }
                  <button
                    type="button"
                    className="app-sidebar-section-header"
                    onClick={() => toggleSection(section)}
                    aria-expanded={isExpanded}
                  >
                    <Localized id={sectionI18nKey}>
                      <span className="app-sidebar-section-label">{section}</span>
                    </Localized>
                    <svg
                      className={`app-sidebar-chevron${isExpanded ? '' : ' collapsed'}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                  {isExpanded && (
                    <div className="app-sidebar-section-items">
                      {items.map((item) => {
                        const label = l10n.getString(item.i18nKey ?? item.label) ?? item.label;
                        return (
                          <Tooltip key={item.route} content={label}>
                            <button
                              type="button"
                              className={
                                route === item.route
                                  ? 'app-nav-item app-nav-item--active'
                                  : 'app-nav-item'
                              }
                              onClick={() => onNavigate(item.route)}
                              aria-current={route === item.route ? 'page' : undefined}
                              aria-label={label}
                            >
                              {item.icon && (
                                <span className="app-nav-icon">{item.icon}</span>
                              )}
                              <Localized id={item.i18nKey ?? item.label}><span>{item.label}</span></Localized>
                            </button>
                          </Tooltip>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* ── Sidebar collapse button ──────────────── */}
          <Tooltip content={l10n.getString(sidebarCollapsed ? 'nav-sidebar-expand' : 'nav-sidebar-collapse')} showDelay={800}>
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={toggleSidebar}
              aria-label={l10n.getString(sidebarCollapsed ? 'nav-sidebar-expand' : 'nav-sidebar-collapse')}
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
          </Tooltip>
        </aside>

        {/* ── Content area ─────────────────────────── */}
        <main className="app-content" id="app-main-content">
          {/* A11Y-07: the topbar lives INSIDE <main>, so it must not carry the
              banner landmark role (banner is top-level-only per aria; axe's
              `landmark-banner-is-top-level` flags it under global rules). The
              content is already contained by the main landmark. */}
          {!ADMIN_ROUTES.has(route) && (
            <div className="app-topbar">
              <div className="app-topbar-left">
                <Tooltip content={l10n.getString(sidebarCollapsed ? 'nav-sidebar-expand' : 'nav-sidebar-collapse')} position="bottom" showDelay={800}>
                  <button
                    type="button"
                    className="sidebar-toggle"
                    onClick={toggleSidebar}
                    aria-label={l10n.getString(sidebarCollapsed ? 'nav-sidebar-expand' : 'nav-sidebar-collapse')}
                    aria-expanded={!sidebarCollapsed}
                  >
                    {sidebarCollapsed ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
                        <line x1="3" y1="12" x2="21" y2="12" />
                        <line x1="3" y1="6" x2="21" y2="6" />
                        <line x1="3" y1="18" x2="21" y2="18" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                  </button>
                </Tooltip>
              </div>
              <div className="app-topbar-right">
                {sessionToken && (
                  <StockAlertBell
                    sessionToken={sessionToken}
                    onClick={() => onNavigate('products')}
                  />
                )}
                <StoreSwitcher />
              </div>
            </div>
          )}
          <UpdateBanner />
          <MemoBanner />
          <div className="app-content-inner" key={route}>
            {children}
          </div>
        </main>
      </div>

      {/* ── Status Bar (full width) ───────────────── */}
      <StatusBar />
    </div>
  );
}
