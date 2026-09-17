// ── SettingsPage tests — flat-IA rebuild (role gate first) ───────
//
// The settings hub is now: roleAtLeast(session.role_name, 'admin') gates the
// whole shell (owner/admin see it, everyone else gets the locked card), and
// the shell renders the FLAT 14-page sidebar IA whose bodies are the blank
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
import { SETTINGS_SCREENS } from '@/features/settings/screens/registry';
import { KEPT_SECTIONS } from '@/features/settings/hooks/useSettingsHashSection';
import { withSyncDefaults } from '@/contexts/SettingsContext';

// KEPT_SECTIONS is imported, not copied: the sweep below compares it against the
// nav items and the screen registry rather than adding a fourth list of the 14
// section names to this file. The three lists stay independent (exporting the
// Set is not deriving one from another), which is what keeps that comparison a
// real assertion.

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
      // currency: 'USD' matches get_default_currency below on purpose - the two
      // readers hit the SAME column (run_set_store_settings stamps
      // store.currency through Settings::set_default_currency,
      // crates/kasirmu-bridge/src/settings.rs:1024), so a fixture that shows them
      // disagreeing hands Save one real diff to send on an untouched page and
      // the zero-write contract below stops being testable.
      return Promise.resolve({ name: '', address: '', taxId: '', currency: 'USD', branch: '' });
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

describe('SettingsPage admin shell — flat 14-page IA', () => {
  it('lists all 14 flat pages in the sidebar, defaulting to General', async () => {
    await openShell();

    const sidebar = screen.getByTestId('settings-sidebar');
    const navButtons = Array.from(sidebar.querySelectorAll<HTMLButtonElement>('button.settings-nav-item'));
    expect(navButtons).toHaveLength(14);
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
    // ── Named sync assertion (this coupling used to be implicit DOM only) ──
    // Three lists stay independent on purpose: NAV_ITEMS owns labels/icons/
    // order, KEPT_SECTIONS owns the accepted deep-link names, SETTINGS_SCREENS
    // owns key -> component. None derives from another, so dropping a key
    // from any one of them fails here instead of rendering a blank body.
    const registryKeys = Object.keys(SETTINGS_SCREENS).sort();
    expect(registryKeys).toEqual(NAV_ITEMS.map((n) => n.key).sort());
    const keptNames = [...KEPT_SECTIONS].sort();
    expect(registryKeys).toEqual(keptNames);

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
      'sync-conflicts': ['sync-conflict-review'],
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
  // CONTRACT REVERSAL, deliberately: this case used to assert that Save on an
  // UNTOUCHED page re-stamped all seven families. That was the old fan-out's
  // behaviour (every task sent its WHOLE DTO), and it is the data-loss path -
  // an untouched page is exactly the page whose draft may be stale (org switch,
  // partial load). The page can no longer express "edit a field": after the
  // flat-IA rebuild it owns no draft inputs, so the edit-then-write half of this
  // case moved to useSettingsSave.test.tsx (describe 'with genuine edits'), and
  // what stays here is the new page-level contract: nothing to write, nothing
  // sent, nothing claimed.
  it('Save on an untouched page sends no settings write at all', async () => {
    await openShell();
    invokeMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /saved!/i })).toBeNull();
    });
    const writes = invokeMock.mock.calls.map((c) => String(c[0])).filter((c) => c.startsWith('set_') || c === 'update_sync_settings_scoped');
    expect(writes).toEqual([]);
    expect(screen.queryByText(ftlValue('settings-save-error'))).toBeNull();
    expect(screen.queryByText(ftlValue('settings-save-partial'))).toBeNull();
  });

  // Second half of the reversal above, and the one that mattered: the old fan-
  // out pushed the CONTEXT'S withSyncDefaults fallback into update_sync_settings
  // _scoped, whose serverUrl write is unconditional (sync.rs:64-82), so a clean
  // Save could invent a sync target the operator never chose - and, with a
  // partial load, clear a configured one. Same-name payload coverage (an EDITED
  // sync still carries the server's URL) moved to useSettingsSave.test.tsx.
  it('an untouched page sends no sync write, so no URL is invented or cleared', async () => {
    await openShell();
    invokeMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /saved!/i })).toBeNull();
    });
    expect(lastInvokeArgs('update_sync_settings_scoped')).toBeUndefined();
  });

  it('withSyncDefaults keeps configured URLs and states untouched', () => {
    // The contract the save-default test above relies on, pinned directly.
    const configured = { serverUrl: 'https://sync.example.com', hasApiKey: true, enabled: false };
    expect(withSyncDefaults(configured)).toBe(configured);
    expect(withSyncDefaults({ serverUrl: '   ', hasApiKey: false, enabled: false })).toEqual({
      serverUrl: 'https://license.ozpos.my.id', hasApiKey: false, enabled: true,
    });
  });

  // The all-fail toast itself needs seven REAL writes, which the page can no
  // longer produce; that case moved to useSettingsSave.test.tsx ('reports every
  // task failing as an error even when all seven fires'). What the page still
  // owns is the other half of the same UI promise, which the old code got wrong
  // in the loud direction: an omitted task used to read as a failed one
  // (findIndex -1 -> undefined -> false), so a do-nothing Save on a page whose
  // writes are down must NOT be reported as a save error.
  it('is silent when every write API is down and nothing needed writing', async () => {
    for (const cmd of [
      'set_receipt_settings_scoped', 'set_store_settings_scoped', 'set_default_currency',
      'set_user_preferences_scoped', 'update_sync_settings_scoped',
      'set_brand_primary_colour_scoped', 'set_brand_store_name_scoped',
    ]) failCommands.add(cmd);

    await openShell();
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /saved!/i })).toBeNull();
    });
    expect(screen.queryByText(ftlValue('settings-save-error'))).toBeNull();
  });

  // Partial-toast-with-a-real-edit moved to useSettingsSave.test.tsx ('refreshes
  // the snapshot per task, not wholesale'). The page-level residual it replaces
  // is the rule that made the old lookup dangerous: SKIPPED must never render as
  // FAILED, so a failing receipt write on an untouched page is invisible.
  it('does not report a partial save for a task it never sent', async () => {
    failCommands.add('set_receipt_settings_scoped');
    await openShell();
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /saved!/i })).toBeNull();
    });
    expect(screen.queryByText(ftlValue('settings-save-partial'))).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith('set_receipt_settings_scoped', expect.any(Object));
  });

  // Still the keyboard wiring, now asserted on the path that reaches the fan-out
  // at all: the read-backs. The write assertion went with the contract above.
  it('Ctrl+S runs the same save path (it reads the server back)', async () => {
    await openShell();
    invokeMock.mockClear();
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('get_store_settings_scoped', expect.any(Object));
    });
    expect(invokeMock).not.toHaveBeenCalledWith('set_store_settings_scoped', expect.any(Object));
  });

  // aria-busy is a STATE, so it survives the reversal - but it can now only be
  // reached by a save with something to write, which the flat-IA page cannot
  // produce. The in-flight half moved to useSettingsSave.test.tsx ('brackets
  // only real writes with the saving state'). What the page must guarantee
  // instead is the negative: the zero-task short-circuit resolves BEFORE
  // setSaving(true), so an untouched Save never flickers busy.
  it('Save never enters the busy state when there is nothing to write', async () => {
    await openShell();
    const saveBtn = screen.getByRole('button', { name: /save settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveBtn).toBeInTheDocument();
    });
    expect(saveBtn).not.toHaveAttribute('aria-busy', 'true');
    expect(saveBtn).toHaveTextContent(ftlValue('settings-btn-save'));
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
