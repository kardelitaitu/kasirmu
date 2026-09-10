// ── SettingsPage tests — flat-IA rebuild (role gate first) ───────
//
// The settings hub is now: roleAtLeast(session.role_name, 'admin') gates the
// whole shell (owner/admin see it, everyone else gets the locked card), and
// the shell renders the FLAT 13-page sidebar IA whose bodies are the blank
// screens in features/settings/screens/ (SettingsNavTree commit 3c76e6c97).
//
// Deliberately NOT covered here anymore (behavior removed with the old
// section bodies — see the rebuild commit):
//   * Store/Currency/Display/Receipt/About/Cloud-Sync form fields and their
//     validateField/markDirty errors (inputs left the page).
//   * dirty-dependent Revert visibility, beforeunload dirty prompts (nothing
//     on the page can become dirty; the guard itself is covered with direct
//     hook tests in useUnsavedChangesGuard.test.tsx).
//   * the category accordion toggle (categories are gone; flat-nav coverage
//     lives in SettingsNavTree.test.tsx).
//   * deep props into the old sync section (converted to direct SyncSection
//     mounts in CloudSyncSettings.test.tsx).
// What remains of the old save/load flow IS still on the page (handleSave,
// SettingsContext lifecycle, topbar) and stays covered below.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, cleanup, fireEvent, within, configure } from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';

// The page mounts IPC-driven context + lazy screens; under parallel CI load a
// full render + microtask flush can exceed the default 1s waitFor timeout.
// Give this file's waitFor/findBy calls a comfortable 5s window.
configure({ asyncUtilTimeout: 5000 });

import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import SettingsPage from '@/features/settings/SettingsPage';
import { BrandProvider } from '@/contexts/BrandContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import { getAvailableLocales, getLocaleLabel } from '@/i18n';
import { NAV_ITEMS, NAV_L10N_KEYS } from '@/features/settings/SettingsNavTree';
import { withSyncDefaults } from '@/contexts/SettingsContext';

// Re-export the REAL @/api/branding module, overriding the global stub that
// test-setup.ts installs: the load/save error-path tests need branding to go
// through the per-file invokeMock so brand calls fail WITH the other commands.
vi.mock('@/api/branding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/branding')>()),
}));

// ── Session under test: the role gate reads session.role_name ──────
const { authState, sessions } = vi.hoisted(() => ({
  authState: {
    session: { username: 'ada', role_name: 'admin', display_name: 'Ada' } as
      { username: string; role_name: string; display_name: string } | null,
  },
  // Defaults map — every floor and the fail-closed spellings.
  sessions: {
    owner: { username: 'boss', role_name: 'owner', display_name: 'Boss' },
    admin: { username: 'ada', role_name: 'admin', display_name: 'Ada' },
    'role-admin': { username: 'preset', role_name: 'role-admin', display_name: 'Preset admin' },
    manager: { username: 'mo', role_name: 'manager', display_name: 'Mo' },
    'role-manager': { username: 'pm', role_name: 'role-manager', display_name: 'PM' },
    staff: { username: 'sam', role_name: 'staff', display_name: 'Sam' },
    auditor: { username: 'aud', role_name: 'auditor', display_name: 'Aud' },
    cashier: { username: 'retired', role_name: 'cashier', display_name: 'R' },
  },
}));

vi.mock('@/contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/AuthContext')>()),
  useAuth: () => ({
    session: authState.session,
    pickerTicket: null,
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: true,
    isOwner: false,
    swapSession: vi.fn(),
  }),
}));

const { invokeMock, defaultImpl, failCommands } = vi.hoisted(() => {
  const SAMPLE_CURRENCIES = [
    { code: 'USD', name: 'US Dollar', minor_exponent: 2, symbol: '$' },
    { code: 'EUR', name: 'Euro', minor_exponent: 2, symbol: '\u20ac' },
  ];
  const failCommands = new Set<string>();

  const impl = (_cmd: string, _args?: unknown): Promise<unknown> => {
    const cmd = _cmd;
    if (failCommands.has(cmd)) {
      return Promise.reject(new Error('Mock failure: ' + cmd));
    }
    if (cmd === 'get_store_settings_scoped') {
      return Promise.resolve({ name: '', address: '', taxId: '', currency: 'IDR', branch: '' });
    }
    if (cmd === 'get_receipt_settings_scoped') {
      return Promise.resolve({
        showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '',
        paperWidth: 'standard', showTableNumber: false,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      });
    }
    if (cmd === 'list_currencies_scoped') {
      return Promise.resolve(SAMPLE_CURRENCIES);
    }
    if (cmd === 'get_default_currency') {
      return Promise.resolve('USD');
    }
    if (cmd === 'get_sync_settings_scoped') {
      return Promise.resolve({ serverUrl: null, hasApiKey: false, enabled: false });
    }
    if (cmd === 'get_user_preferences_scoped') {
      return Promise.resolve({ cardsize: '2', fontsize: '1', 'font-smoothing': 'antialiased' });
    }
    if (cmd === 'get_brand_settings_scoped') {
      return Promise.resolve({ primary_colour: '#4f46e5', logo_path: null, store_name: '' });
    }
    if (cmd === 'version_scoped') {
      return Promise.resolve({ name: 'oz-pos', version: '0.0.4', rustVersion: '1.80', target: 'x86_64' });
    }
    // Unscoped legacy twins — BrandProvider/SettingsContext hit these when no
    // session token is present (and BrandContext.tsx:54 always uses the
    // unscoped GET on boot). Returning undefined here crashes ThemeProvider.
    if (cmd === 'get_store_settings') {
      return Promise.resolve({ name: '', address: '', taxId: '', currency: 'IDR', branch: '' });
    }
    if (cmd === 'get_receipt_settings') {
      return Promise.resolve({
        showCurrency: false, decimalSeparator: 'dot', showTax: true, footer: '',
        paperWidth: 'standard', showTableNumber: false,
        marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
      });
    }
    if (cmd === 'list_currencies') {
      return Promise.resolve(SAMPLE_CURRENCIES);
    }
    if (cmd === 'get_sync_settings') {
      return Promise.resolve({ serverUrl: null, hasApiKey: false, enabled: false });
    }
    if (cmd === 'get_user_preferences') {
      return Promise.resolve({ cardsize: '2', fontsize: '1', 'font-smoothing': 'antialiased' });
    }
    if (cmd === 'get_brand_settings') {
      return Promise.resolve({ primary_colour: '#4f46e5', logo_path: null, store_name: '' });
    }
    if (cmd === 'version') {
      return Promise.resolve({ name: 'oz-pos', version: '0.0.4', rustVersion: '1.80', target: 'x86_64' });
    }
    return Promise.resolve(undefined);
  };
  return { invokeMock: vi.fn(impl), defaultImpl: impl, failCommands };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@/contexts/ZoomContext', () => ({
  useAppZoom: () => ({ zoomLevel: 'auto', setZoomLevel: vi.fn() }),
  ZoomProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeWorkspace: 'admin',
    setActiveWorkspace: vi.fn(),
    activeInstance: null,
    setActiveInstance: vi.fn(),
    availableWorkspaces: [],
    workspaceScreens: [],
    loading: false,
    error: null,
    retry: vi.fn(),
    lastWorkspace: null,
    switchStore: vi.fn(),
    resolvedStoreId: 'default',
    sessionToken: 'test-token',
    swapSessionToken: vi.fn(),
  }),
  useWorkspaceScope: () => null,
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/HardwareAccelContext', () => ({
  useHardwareAccel: () => ({ enabled: true, setEnabled: vi.fn() }),
  HardwareAccelProvider: ({ children }: { children: ReactNode }) => children,
}));

Element.prototype.scrollIntoView = vi.fn();

beforeEach(() => {
  cleanup();
  failCommands.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(defaultImpl);
  // Sidebar prefs must not leak between tests.
  localStorage.clear();
  // Default session: full-shell tests run as admin; gate tests override per case.
  authState.session = sessions.admin;
  window.location.hash = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-font-smoothing');
});

afterEach(() => {
  cleanup();
});

function TestWrapper({ children }: { children: ReactNode }) {
  return (
    <LocaleContext.Provider
      value={{
        locale: 'en',
        setLocale: () => {},
        availableLocales: getAvailableLocales(),
        getLocaleLabel,
        orgDefaultLocale: null,
        setOrgDefaultLocale: () => {},
      }}
    >
      <BrandProvider>
        <CurrencyProvider>
          {children}
        </CurrencyProvider>
      </BrandProvider>
    </LocaleContext.Provider>
  );
}

function renderPage() {
  return renderWithProvidersSync(<TestWrapper><SettingsPage /></TestWrapper>, settingsFtl, sharedFtl);
}

/** Single-line Fluent message value from the raw English bundle. */
function ftlValue(key: string): string {
  const m = new RegExp('^' + key + '\\s*=\\s*(.*)$', 'm').exec(settingsFtl);
  return m ? m[1]!.trim() : '';
}

/** Bundle-resolved nav label for a page key (the accessible name the nav uses). */
function navLabel(key: string): string {
  return ftlValue(NAV_L10N_KEYS[key] ?? '');
}

/** The section body container. */
function sectionRoot(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.settings-section-content');
  if (!el) throw new Error('no .settings-section-content in the shell');
  return el;
}

/** Arguments of the LAST invoke call for a command ({ sessionToken, args? } envelope). */
function lastInvokeArgs(cmd: string): Record<string, unknown> | undefined {
  for (let i = invokeMock.mock.calls.length - 1; i >= 0; i--) {
    if (invokeMock.mock.calls[i]![0] === cmd) return invokeMock.mock.calls[i]![1] as Record<string, unknown>;
  }
  return undefined;
}

async function openShell() {
  renderPage();
  await waitFor(() => {
    expect(screen.getByTestId('settings-sidebar')).toBeInTheDocument();
  });
}

async function navigateByNav(key: string) {
  const label = navLabel(key);
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => {
    expect(within(sectionRoot()).getByRole('heading', { level: 1, name: label })).toBeInTheDocument();
  });
}

async function navigateCheck(key: string) {
  const label = navLabel(key);
  await waitFor(() => {
    expect(within(sectionRoot()).getByRole('heading', { level: 1, name: label })).toBeInTheDocument();
  });
}

describe('SettingsPage role gate', () => {
  it('shows the locked card — not the shell — to a manager session', async () => {
    authState.session = sessions.manager;
    renderPage();

    const card = await screen.findByTestId('settings-locked-card');
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('aria-disabled', 'true');
    // The wrapper announces the restriction politely.
    expect(card.parentElement).toHaveAttribute('role', 'status');
    // Copy resolves from the real bundle (no pinned English).
    expect(within(card).getByRole('heading', { level: 1 })).toHaveTextContent(ftlValue('settings-locked-title'));
    expect(within(card).getByText(ftlValue('settings-locked-desc'))).toBeInTheDocument();
    // No shell surfaces: sidebar, topbar save, search input all absent.
    expect(screen.queryByTestId('settings-sidebar')).toBeNull();
    expect(screen.queryByRole('button', { name: /save settings/i })).toBeNull();
    expect(document.querySelector('.settings-topbar')).toBeNull();
  });

  it('locks every role below the admin floor, fail-closed', async () => {
    for (const role of ['staff', 'auditor', 'manager', 'role-manager', 'cashier', null] as const) {
      cleanup();
      authState.session = role === null ? null : { username: 'u', role_name: role, display_name: 'U' };
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('settings-locked-card')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('settings-sidebar'), 'role_name=' + String(role) + ' must NOT see the shell').toBeNull();
    }
  });

  it('unlocks for owner, bare admin, and the role-admin preset id', async () => {
    for (const s of [sessions.owner, sessions.admin, sessions['role-admin']]) {
      cleanup();
      authState.session = s;
      await openShell();
      expect(screen.getByTestId('settings-sidebar')).toBeInTheDocument();
      expect(screen.queryByTestId('settings-locked-card')).toBeNull();
    }
  });
});

describe('SettingsPage admin shell — flat 13-page IA', () => {
  it('lists all 13 flat pages in the sidebar, defaulting to General', async () => {
    await openShell();

    const sidebar = screen.getByTestId('settings-sidebar');
    const navButtons = Array.from(sidebar.querySelectorAll<HTMLButtonElement>('button.settings-nav-item'));
    expect(navButtons).toHaveLength(13);
    expect(navButtons.map((b) => b.getAttribute('aria-label'))).toEqual(NAV_ITEMS.map((n) => navLabel(n.key)));

    // Default section renders the General placeholder and its breadcrumb.
    expect(within(sectionRoot()).getByRole('heading', { level: 1, name: navLabel('general') })).toBeInTheDocument();
    const topbar = document.querySelector('.settings-topbar') as HTMLElement;
    expect(within(topbar).getByRole('heading', { name: navLabel('general') })).toBeInTheDocument();
  });

  it('clicking a page updates aria-current, the breadcrumb, and the section body', async () => {
    await openShell();
    await navigateByNav('tax-configuration');

    const active = document.querySelector('[data-testid="settings-sidebar"] [aria-current="page"]');
    expect(active).toHaveAttribute('aria-label', navLabel('tax-configuration'));
    const topbar = document.querySelector('.settings-topbar') as HTMLElement;
    expect(within(topbar).getByRole('heading', { name: navLabel('tax-configuration') })).toBeInTheDocument();
  });

  it('every renderSection key mounts its own screen under the shared scaffold', async () => {
    await openShell();

    // Loop over the nav registry: one key must map to one screen. Most
    // screens are still the rebuild placeholder; a screen that has migrated
    // onto real content is listed in MIGRATED below and must mount THAT, so
    // the sweep keeps covering every key instead of skipping the built ones.
    const placeholder = ftlValue('settings-screen-placeholder');
    const migrating = ftlValue('settings-screen-migrating');
    expect(placeholder).not.toBe('');
    expect(migrating).not.toBe('');

    // key -> the markers its real screens own, asserted as class selectors
    // inside the section. Business Defaults hosts the four regional-slice
    // cards; with the mocked IPC (no location configured) each renders its
    // own empty/error state, which is the element that proves it mounted.
    const migrated: Record<string, string[]> = {
      'business-defaults': [
        'regional-settings-empty',
        'localpay-empty',
        'rcptfmt-empty',
        'fiscalnum-error',
      ],
    };

    for (const item of NAV_ITEMS) {
      const label = navLabel(item.key);
      expect(label, item.key + ' has no bundle label').not.toBe('');
      await navigateByNav(item.key);

      const root = sectionRoot();
      const section = root.querySelector('section.settings-screen-placeholder');
      expect(section, item.key + ' body must be the shared placeholder section').not.toBeNull();
      const body = section as HTMLElement;

      const markers = migrated[item.key];
      if (markers) {
        // A migrated screen must NOT fall back to the placeholder copy.
        expect(within(body).queryByText(placeholder), item.key + ' still shows the placeholder').toBeNull();
        for (const marker of markers) {
          expect(body.querySelector('.' + marker), item.key + ' must mount its .' + marker + ' screen').not.toBeNull();
        }
      } else {
        expect(within(body).getAllByText(placeholder)).toHaveLength(1);
      }
      expect(within(body).getByText(migrating)).toBeInTheDocument();
    }
  });

  it('honours an accepted deep-link section on mount and consumes the hash', async () => {
    window.location.hash = '#/settings/sync-status';
    await openShell();
    await navigateCheck('sync-status');
    expect(window.location.hash).toBe('');
  });

  it('treats old-IA deep links as unknown: default section, hash untouched', async () => {
    // 'receipt', 'appearance', 'topology' etc. are no longer KEPT_SECTIONS.
    window.location.hash = '#/settings/receipt';
    await openShell();
    expect(within(sectionRoot()).getByRole('heading', { level: 1, name: navLabel('general') })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/settings/receipt');
  });

  it('filters the sidebar flat from the topbar search box', async () => {
    await openShell();
    const input = screen.getByRole('textbox', { name: ftlValue('settings-sidebar-search-aria') });
    fireEvent.change(input, { target: { value: 'diagnostics' } });

    await waitFor(() => {
      const sidebar = screen.getByTestId('settings-sidebar');
      const visible = Array.from(sidebar.querySelectorAll<HTMLButtonElement>('button.settings-nav-item'));
      expect(visible).toHaveLength(1);
      expect(visible[0]).toHaveAttribute('aria-label', navLabel('system-diagnostics'));
    });
  });
});

describe('SettingsPage topbar save flow (kept)', () => {
  it('Save writes receipt, store, currency, prefs, sync and branding', async () => {
    await openShell();
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });
    expect(invokeMock).toHaveBeenCalledWith('set_receipt_settings_scoped', expect.any(Object));
    expect(invokeMock).toHaveBeenCalledWith('set_store_settings_scoped', expect.any(Object));
    expect(invokeMock).toHaveBeenCalledWith('update_sync_settings_scoped', expect.any(Object));
    expect(invokeMock).toHaveBeenCalledWith('set_brand_primary_colour_scoped', expect.any(Object));
    expect(invokeMock).toHaveBeenCalledWith('set_brand_store_name_scoped', expect.any(Object));
  });

  it('sync save carries the cloud draft default with enabled state and no apiKey', async () => {
    // SettingsContext applies withSyncDefaults to an unconfigured sync; the
    // page mirrors that DTO into the save call even though no sync inputs
    // remain on the shell.
    await openShell();
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });
    const envelope = lastInvokeArgs('update_sync_settings_scoped');
    expect(envelope).toBeDefined();
    expect(envelope!['args']).toEqual({ serverUrl: 'https://license.ozpos.my.id', enabled: true });
  });

  it('withSyncDefaults keeps configured URLs and states untouched', () => {
    // The contract the save-default test above relies on, pinned directly.
    const configured = { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: false };
    expect(withSyncDefaults(configured)).toBe(configured);
    expect(withSyncDefaults({ serverUrl: '   ', hasApiKey: false, enabled: false })).toEqual({
      serverUrl: 'https://license.ozpos.my.id', hasApiKey: false, enabled: true,
    });
  });

  it('shows the full save-error toast when every save API call fails', async () => {
    for (const cmd of [
      'set_receipt_settings_scoped', 'set_store_settings_scoped', 'set_default_currency',
      'set_user_preferences_scoped', 'update_sync_settings_scoped',
      'set_brand_primary_colour_scoped', 'set_brand_store_name_scoped',
    ]) failCommands.add(cmd);

    await openShell();
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByText(ftlValue('settings-save-error'))).toBeInTheDocument();
    });
  });

  it('shows the partial-save toast when some saves fail', async () => {
    failCommands.add('set_receipt_settings_scoped');
    await openShell();
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved!/i })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(ftlValue('settings-save-partial'))).toBeInTheDocument();
    });
  });

  it('Ctrl+S triggers the same save', async () => {
    await openShell();
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('set_store_settings_scoped', expect.any(Object));
    });
  });

  it('Save button is aria-busy while the saves are in flight', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (String(cmd).startsWith('set_') || cmd === 'update_sync_settings_scoped') {
        return new Promise(() => {});
      }
      return defaultImpl(String(cmd));
    });

    await openShell();
    const saveBtn = screen.getByRole('button', { name: /save settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveBtn).toHaveAttribute('aria-busy', 'true');
    });
  });
});

describe('SettingsPage load lifecycle and chrome (kept)', () => {
  it('shows the loading skeleton before the APIs resolve', () => {
    renderPage();
    expect(document.querySelector('.settings-loading-card')).toBeInTheDocument();
  });

  it('renders a localized error with a working retry when all APIs fail', async () => {
    invokeMock.mockRejectedValue(new Error('IPC error'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(ftlValue('settings-load-failed'))).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: ftlValue('settings-retry') });
    invokeMock.mockImplementation(defaultImpl);
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByTestId('settings-sidebar')).toBeInTheDocument();
    });
  });

  it('toasts a partial-load warning when one source fails', async () => {
    failCommands.add('get_sync_settings_scoped');
    await openShell();
    await waitFor(() => {
      expect(screen.getByText(ftlValue('settings-load-partial'))).toBeInTheDocument();
    });
  });

  it('renders the footer theme toggle and app version', async () => {
    await openShell();
    expect(screen.getByRole('button', { name: /switch to light/i })).toBeInTheDocument();
    expect(document.body.textContent).toContain('0.0.4');
  });

  it('persists the sidebar collapsed toggle', async () => {
    await openShell();
    const collapse = ftlValue('settings-sidebar-collapse-aria');
    fireEvent.click(screen.getByRole('button', { name: collapse }));
    await waitFor(() => {
      expect(localStorage.getItem('settings-sidebar-collapsed')).toBe('true');
    });
  });

  it('does not block window close while nothing is dirty', async () => {
    await openShell();
    const event = new Event('beforeunload', { cancelable: true, bubbles: true });
    const spy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
