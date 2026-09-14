/**
 * Settings hub - which section is showing, and the URL contract that decides
 * it. Slice 2 of the settings extraction: KEPT_SECTIONS, the activeSection
 * state, navigateToSection and the hash-reading effect moved verbatim out of
 * SettingsPage.tsx - same names, same order, same comments. The rest of the
 * nav state stayed with the page: the mobile drawer and the nav search are
 * rendered there, which is why navigateToSection still takes one setter as
 * a parameter instead of owning the whole nav surface.
 *
 * SEAM: this hook OWNS activeSection (nothing outside it writes that state
 * any more) and receives exactly one value - setMobileSidebarOpen. Hook
 * order: the useState that sat at SettingsPage.tsx:228 moves down to this
 * call site, ahead of the drawer and search useStates. Neither reads the
 * other, and the effect still runs on the same mount in the same position
 * relative to them, so the move is inert.
 *
 * Two behaviours here are contract, not implementation, and SettingsDeepLink
 * pins both: a hash is cleared ONLY when it carried no query (a scoped deep
 * link may come back later for its hint), and a link naming something that
 * is not in KEPT_SECTIONS is ignored rather than answered with an empty
 * body. The listener is not optional either - AppShell refuses the
 * settings/... shape because only settings is a registered page, so once
 * this page is mounted nothing else re-reads the hash at all.
 */
import { useCallback, useEffect, useState } from 'react';

/**
 * Sections the settings hub actually still has. Deep-links (`#/settings/<section>`) from
 * the workspace tool cards are matched against this, so a bookmark to a tab that was
 * removed in the hub redesign is ignored and the page opens on its default instead of an
 * empty body. Module scope on purpose: the hash effect in the component closes over this
 * and must not see a new Set on every render.
 */
const KEPT_SECTIONS = new Set([
  'general', 'license-subscription', 'devices-connectivity', 'business-defaults',
  'features-modules', 'security-account', 'data-sync', 'data-management',
  'sync-status', 'sync-conflicts', 'offline-queue', 'tax-configuration', 'exchange-rates', 'system-diagnostics',
]);

export interface UseSettingsHashSectionParams {
  /** Closing the mobile drawer on navigate stays with the page: the
   *  drawer is its state and the nav tree renders it. */
  setMobileSidebarOpen: (open: boolean) => void;
}

/** The section the hub is showing, plus the way navigation changes it. */
export function useSettingsHashSection({ setMobileSidebarOpen }: UseSettingsHashSectionParams) {
  // ── Read section from the URL hash (e.g. #/settings/general) ────────
  const [activeSection, setActiveSection] = useState('general');

  /** Navigate to a section. */
  const navigateToSection = useCallback((key: string) => {
    setActiveSection(key);
    setMobileSidebarOpen(false);
  // The list was empty in the page, where the drawer setter came from a local
  // useState. It names one entry here only because that setter now arrives as
  // a parameter, which makes it reactive to this rule; a useState dispatcher
  // never changes identity, so navigateToSection keeps the same stable identity
  // it had before the move (React-stability argument, not measured).
  }, [setMobileSidebarOpen]);

  // Only sections that still exist in the flat IA are accepted; stale
  // deep-links to removed sections are ignored so the hub opens on its
  // default (general) section instead of an empty body — the "old settings
  // on <tab>" problem. KEPT_SECTIONS is module-scope on purpose: as a
  // render-scoped const it would be a new Set every render, re-running the
  // effect each time. This is deliberately NOT a mount-only effect:
  // AppShell's own hashchange listener refuses `settings/...` (only
  // `settings` is a registered page), so while the page is already mounted
  // nothing else re-reads the hash — listening here closes that gap.
  useEffect(() => {
    const applyHashSection = () => {
      const hash = window.location.hash.replace(/^#\//, '');
      if (!hash.startsWith('settings/')) return;
      // A deep link may append a query scoping the target section; the
      // section name is everything before the '?'.
      const rawSection = hash.slice('settings/'.length);
      const queryIndex = rawSection.indexOf('?');
      const section = queryIndex === -1 ? rawSection : rawSection.slice(0, queryIndex);
      if (section && KEPT_SECTIONS.has(section)) {
        setActiveSection(section);
        // Clear the hash after consuming it so stale sections don't persist.
        // A query-carrying hash is left alone (scoped deep links may return).
        if (queryIndex === -1) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
    };
    applyHashSection();
    window.addEventListener('hashchange', applyHashSection);
    return () => window.removeEventListener('hashchange', applyHashSection);
  }, []);

  return { activeSection, navigateToSection };
}
