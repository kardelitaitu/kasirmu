/**
 * SettingsTopbar - the master-detail header of the Settings page: the
 * back-to-workspace button, the active page's icon + title, the nav-search
 * input and the save bar (dirty dot, Revert, Save).
 *
 * Extracted from SettingsPage.tsx by the settings lane's topbar slice. The
 * markup moved verbatim: the ContextMenu render node from :504-512 and the
 * header block from :513-626 of the 676-line page, with only the base
 * indentation changed, so it diffs clean against its old lines.
 *
 * OWNERSHIP. Three things moved IN here rather than being threaded, each
 * because the page had exactly one reader for it:
 *   - useContextMenu, the <ContextMenu> render and the cmInput props object.
 *     cmInput is NOT a ref: it is a useMemo of four input attributes plus
 *     onContextMenu, and its only spread site in the page was this search
 *     input. The real ref, cm.menuRef, is born inside useContextMenu() and
 *     dies inside the co-located <ContextMenu>, so hook + render + spread
 *     belong in one file - the shape AppearanceSettings.tsx:75/445 and
 *     FeatureToggleScreen.tsx:113/286 already use. The page keeps the root
 *     onContextMenu preventDefault.
 *     Moving the render node is inert, and both selectors were READ rather
 *     than assumed: .ctx-menu is position:fixed / z-index:9999
 *     (ContextMenu.css:1-3), while .settings-page (SettingsPage.css:15-21)
 *     and .settings-topbar (:90-100, plus its :402 mobile override) declare no
 *     transform, filter, will-change, backdrop-filter, contain or perspective.
 *     No containing block appears, so the menu still positions off the
 *     viewport - and the fragment keeps it a direct child of .settings-page,
 *     exactly where it rendered before, so the DOM does not move either.
 *   - useWorkspaceNav. goToWorkspacePicker had one click site: COL 1.
 *   - the breadcrumb lookup. NAV_ITEMS.find(key === activeSection) and the
 *     NAV_L10N_KEYS title fed only COL 2, so the page hands down the section
 *     NAME (one prop) and this file imports the registry it resolves against,
 *     instead of receiving a derived item plus two strings.
 *
 * PRESENTATIONAL, on purpose: no settings draft state lives here. The save bar
 * reads isDirty / saving / saved and calls back into onRevert / onSave, all of
 * which the page must keep - the Revert snapshot and the save fan-out each
 * write a dozen setters, and Ctrl+S is bound page-wide. searchQuery is
 * threaded (value + onChange) because the sidebar filter reads the same state;
 * the drawer's mobileSidebarOpen is NOT, because this header never touched it.
 * Eight props total.
 *
 * Registered in screenExtraction.test.ts (SettingsPage entry -> additionalTsx)
 * because every class it renders is styled by settings/SettingsPage.css. Skip
 * that registration and the guard goes red on nine of them - settings-back-btn,
 * the four settings-topbar-search* and settings-save-bar / -dot / settings-btn-revert
 * / settings-saved-checkmark. The other four (settings-topbar, __col--brand,
 * -icon, -name) stay readable only because the page's loading skeleton still
 * renders them; take that skeleton next and they join the list.
 */
import { useMemo } from 'react';

import { Localized, useLocalization } from '@fluent/react';
import { Button } from '@/components/Button';
import Tooltip from '@/app/Tooltip';
import { ContextMenu, useContextMenu, requiredLocalized } from '@/components';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { NAV_ITEMS, NAV_L10N_KEYS } from '../SettingsNavTree';

interface SettingsTopbarProps {
  /** Active section key; resolved against NAV_ITEMS for the COL 2 icon + title. */
  activeSection: string;
  /** Threaded because the sidebar filter reads the same page state. */
  searchQuery: string;
  onSearchChange: (value: string) => void;
  /** Drives the dirty dot, the Revert button's hidden class and its tabIndex. */
  isDirty: boolean;
  saving: boolean;
  saved: boolean;
  onRevert: () => void;
  onSave: () => void;
}

/** Renders the settings page's top bar. Owns no settings draft state. */
export function SettingsTopbar({
  activeSection,
  searchQuery,
  onSearchChange,
  isDirty,
  saving,
  saved,
  onRevert,
  onSave,
}: SettingsTopbarProps) {
  const { l10n } = useLocalization();
  const { goToWorkspacePicker } = useWorkspaceNav();

  // Right-click copy/paste on the search field: the custom menu replaces the
  // native one, which the page root still suppresses for everything else.
  const cm = useContextMenu();
  const cmInput = useMemo(() => ({
    autoComplete: 'off' as const,
    autoCorrect: 'off' as const,
    spellCheck: false as const,
    'data-gramm': 'false' as const,
    onContextMenu: (e: React.MouseEvent<HTMLInputElement>) => cm.open(e, e.currentTarget),
  }), [cm]);

  const currentNavItem = NAV_ITEMS.find((n) => n.key === activeSection);
  // The page computed this inline three times; one name here keeps the
  // Revert / dot / tabIndex trio in step by construction.
  const actionsVisible = isDirty && !saving && !saved;

  return (
    <>
      {cm.menu && (
        <ContextMenu
          menu={cm.menu}
          menuRef={cm.menuRef}
          onCopy={cm.handleCopy}
          onPaste={cm.handlePaste}
          onClose={cm.close}
        />
      )}
      <header className="settings-topbar">
        {/* COL 1: back to the workspace picker */}
        <div className="settings-topbar__col">
          <Tooltip content={l10n.getString('settings-back-aria')} fit="inline" portal>
            <button
              type="button"
              className="settings-back-btn"
              onClick={() => goToWorkspacePicker()}
              aria-label={l10n.getString('settings-back-aria')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="16 5 8 12 16 19" />
              </svg>
            </button>
          </Tooltip>
        </div>
        {/* COL 2: branding */}
        <div className="settings-topbar__col settings-topbar__col--brand">
          <div className="settings-topbar-icon" aria-hidden="true">
            {currentNavItem?.icon ?? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            )}
          </div>
          <h1 className="settings-topbar-name">
            <Localized id={NAV_L10N_KEYS[currentNavItem?.key ?? ''] ?? 'settings-title'}>
              {currentNavItem?.label ?? 'Settings'}
            </Localized>
          </h1>
        </div>
        {/* COL 3: search */}
        <div className="settings-topbar__col settings-topbar__col--search">
          <div className="settings-topbar-search">
            <svg className="settings-topbar-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              id="settings-search-input"
              name="settings-search"
              className="settings-topbar-search-input"
              type="text"
              placeholder={requiredLocalized(l10n, 'settings-search-placeholder')}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label={l10n.getString('settings-sidebar-search-aria')}
              {...cmInput}
            />
            {searchQuery && (
              <button
                type="button"
                className="settings-topbar-search-clear"
                onClick={() => onSearchChange('')}
                aria-label={l10n.getString('settings-sidebar-search-clear-aria')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
        {/* COL 4: actions */}
        <div className="settings-topbar__col settings-topbar__col--actions">
          <div className="settings-save-bar">
            {/* Revert button is always rendered but invisible when not dirty.
                This reserves layout space and prevents the clock and save
                button from shifting on appearance/disappearance. */}
            <span
              className={`settings-save-dot${actionsVisible ? '' : ' settings-save-dot--hidden'}`}
              aria-hidden="true"
            />
            <Localized id="settings-btn-revert-aria" attrs={{ 'aria-label': true }}>
              <button
                type="button"
                className={`settings-btn-revert${actionsVisible ? '' : ' settings-btn-revert--hidden'}`}
                onClick={onRevert}
                aria-label={l10n.getString('revert-changes-aria')}
                tabIndex={actionsVisible ? undefined : -1}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                <Localized id="settings-btn-revert">
                  <span>Revert</span>
                </Localized>
              </button>
            </Localized>
            <Localized id="settings-btn-save-aria" attrs={{ 'aria-label': true }} vars={{ state: saved ? 'saved' : 'save' }}>
              <Button
                variant="primary"
                onClick={onSave}
                loading={saving}
              >
                {saved && !saving ? (
                  <span className="settings-saved-checkmark">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <Localized id="settings-saved"><span>Saved!</span></Localized>
                  </span>
                ) : (
                  <Localized id="settings-btn-save"><span>Save</span></Localized>
                )}
              </Button>
            </Localized>
          </div>
        </div>
      </header>
    </>
  );
}
