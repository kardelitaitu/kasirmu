import { type KeyboardEvent, type ReactNode } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components/requiredLocalized';
import { getNavItems } from '@/registries/menu-registry';
import MemoBanner from '@/features/memo/MemoBanner';
import './tablet.css';

// ── Props ───────────────────────────────────────────────────────────

/** Props for the tablet-optimised shell layout component. */
export interface TabletAppLayoutProps {
  /** Current active route. */
  route: string;
  /** Called when the user clicks a navigation item. */
  onNavigate: (route: string) => void;
  /** Content to render in the main area. */
  children: ReactNode;
  /** Set of enabled feature keys. If omitted, all nav items are shown. */
  enabledFeatures?: Set<string>;
  /** Current user role for role-based nav filtering. */
  userRole?: string;
  /** Granted permission keys from the session (0046 registry) for nav filtering. */
  permissions?: string[];
  /** ADR #4 Phase 3b: workspace type screens for dynamic tab generation.
   *  When provided, the tab bar shows only screens in this list (in order).
   *  When omitted, falls back to the full menu registry. */
  workspaceScreens?: string[];
}

// ── Tab set ────────────────────────────────────────────────────────

/**
 * Cap on the FALLBACK tab set — the whole menu registry, used only when the
 * active workspace declares no screens of its own.
 *
 * The bar scrolls horizontally (see `tablet.css`), so this is not a layout
 * limit any more; it is a limit on what belongs in a thumb-reachable
 * quick-access surface. The fallback list is the entire application nav —
 * 41 items for an owner, i.e. the desktop sidebar — and is also what renders
 * when no workspace is active yet. Neither case should produce a 41-item bar.
 *
 * The workspace-declared list is NOT capped: see `navItems` below.
 */
export const FALLBACK_TAB_LIMIT = 7;

// ── Component ──────────────────────────────────────────────────────

/**
 * Tablet-optimised application shell.
 *
 * Features:
 * - Bottom tab bar instead of sidebar (thumb-reachable)
 * - Minimum 48px touch targets
 * - Larger typography
 * - Full-screen content with safe-area inset support
 * - Active tab highlighting with accent colour
 */
export default function TabletAppLayout({
  route,
  onNavigate,
  children,
  enabledFeatures,
  userRole,
  permissions,
  workspaceScreens,
}: TabletAppLayoutProps) {
  const { l10n } = useLocalization();
  // ADR #4 Phase 3b: when workspaceScreens is provided, filter nav items
  // to only those matching the workspace type screens. This creates a
  // dynamic, per-instance tab bar instead of a static one.
  const allNavItems = getNavItems(enabledFeatures, userRole, permissions);
  //
  // The declared list is rendered IN FULL. It is ordered, owner-configured
  // data (`workspace_type_screens`), so truncating it silently discards
  // configuration: the seeded `admin` workspace declares 15 screens, 13 of
  // which are nav items, and a cap of 7 dropped 6 of them with no signal.
  // A screen the registry does not register as a nav item is filtered out by
  // the `includes` intersection below — that is the registry's business, not
  // a truncation this component should perform silently.
  //
  // The fallback is the whole registry and stays capped — see
  // `FALLBACK_TAB_LIMIT`.
  const declaredScreens =
    workspaceScreens && workspaceScreens.length > 0 ? workspaceScreens : null;
  const navItems = declaredScreens
    ? allNavItems.filter((item) => declaredScreens.includes(item.route))
    : allNavItems.slice(0, FALLBACK_TAB_LIMIT);

  // ── A11Y-03/05: WAI-ARIA tabs keyboard pattern ────────────────
  // The bottom tab bar is a roving-tabindex tablist: only the selected tab is
  // in the tab order (tabIndex 0), and Left/Right arrows move focus with
  // automatic activation (navigation), Home/End jump to the first/last tab.
  // Because these are navigation tabs, focus movement activates the tab.
  const handleTablistKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') {
      return;
    }
    const tabs = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    if (tabs.length === 0) return;
    const currentIdx = tabs.findIndex((t) => t === document.activeElement);
    if (currentIdx < 0) return;
    e.preventDefault();
    let nextIdx = currentIdx;
    if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabs.length - 1;
    const nextItem = navItems[nextIdx];
    if (!nextItem) return;
    tabs[nextIdx]?.focus();
    onNavigate(nextItem.route);
  };

  return (
    <div className="tablet-shell">
      <div className="app-layout">
        {/* ── A11Y-03: skip-to-content link (first focusable element) ── */}
        <a href="#tablet-main-content" className="skip-to-content">
          {requiredLocalized(l10n, 'a11y-skip-to-content')}
        </a>
        {/* ── Main content area ─────────────────────── */}
        <main className="app-content" role="main" id="tablet-main-content">
          <MemoBanner />
          <div className="app-content-inner" key={route}>
            {children}
          </div>
        </main>

        {/* ── Bottom tab bar ────────────────────────── */}
        {/* A11Y-07: the tab bar is navigation — wrap it in a <nav> landmark so
            its buttons are contained in a landmark (axe `region` rule) and the
            shell exposes a consistent navigation landmark on both layouts. */}
        <nav
          className="tablet-tab-bar-nav"
          aria-label={l10n.getString('nav-tablist-aria')}
        >
        <div
          className="tablet-tab-bar"
          role="tablist"
          aria-label={l10n.getString('nav-tablist-aria')}
          // Programmatically focusable (roving tabindex lives on the tabs) so
          // the interactive role passes jsx-a11y's interactive-supports-focus.
          tabIndex={-1}
          onKeyDown={handleTablistKeyDown}
        >
          {navItems.map((item) => (
            <button
              key={item.route}
              type="button"
              role="tab"
              tabIndex={route === item.route ? 0 : -1}
              className={
                route === item.route
                  ? 'tablet-tab-item tablet-tab-item--active'
                  : 'tablet-tab-item'
              }
              onClick={() => onNavigate(item.route)}
              aria-selected={route === item.route}
              aria-label={l10n.getString(item.i18nKey ?? item.label) ?? item.label}
            >
              {item.icon && (
                <span className="tablet-tab-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className="tablet-tab-label"><Localized id={item.i18nKey ?? item.label}><span>{item.label}</span></Localized></span>
            </button>
          ))}
        </div>
        </nav>
      </div>
    </div>
  );
}
