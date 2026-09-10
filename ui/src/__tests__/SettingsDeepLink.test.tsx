// ── Settings deep-link section switching ──────────────────────────
//
// WorkspaceHome's tool cards navigate by writing window.location.hash and letting the
// Settings page read the sub-section out of it. SettingsPage.tsx:314-328 does exactly
// that: KEPT_SECTIONS lists the accepted names ('sync' and 'topology' among them) and a
// useEffect maps `#/settings/<section>` onto activeSection.
//
// The effect's dependency array is `[]`, so it runs once, on mount. That is fine when the
// card is clicked from ANOTHER workspace: AppShell.tsx:217 tries getPage('settings/sync'),
// fails because only 'settings' is registered, falls to the else branch, and sets
// currentRoute from the workspace default (L231 maps admin -> 'settings'), which mounts
// SettingsPage, which then reads the hash. The deep-link works by accident of remounting.
//
// When SettingsPage is ALREADY mounted -- the user is on the admin workspace looking at
// settings and clicks the topology or cloud-sync card -- nothing remounts. AppShell's
// hashchange listener (L244-252) deliberately refuses unregistered routes ("prevents
// garbage hashes"), so currentRoute never changes and the mount-only effect never re-runs.
// The URL updates and the visible section does not. Both WorkspaceHome.tsx:865 (topology,
// committed) and the in-flight cloud-sync card hit this.
//
// The marker is settings-section-content--full, applied at SettingsPage.tsx:1003 if and
// only if activeSection === 'topology', so it is an unambiguous read of the live section.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';
import sharedFtl from '@/locales/shared.ftl?raw';
import SettingsPage from '@/features/settings/SettingsPage';
import { AuthProvider } from '@/contexts/AuthContext';
import { BrandProvider } from '@/contexts/BrandContext';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import { getAvailableLocales, getLocaleLabel } from '@/i18n';

// The topology section body is stubbed so the deep-link scope hints can be
// asserted on the props SettingsPage hands the editor (the real screen owns
// its own suite). Stubbing the barrel also keeps these shell-level tests off
// the editor's IPC surface.
const { topologyScreenSpy } = vi.hoisted(() => ({
  topologyScreenSpy: vi.fn((_props?: unknown) => null),
}));
vi.mock('@/features/locations', () => ({
  TopologyScreen: (props: unknown) => topologyScreenSpy(props),
}));

// ── Session under test: the settings role gate ──────────────────────
// SettingsPage.tsx:204-208 gates the whole shell on
// roleAtLeast(session?.role_name, 'admin') and renders the locked card
// otherwise. The real AuthProvider starts with session = null, so every
// nav/section query below would time out on the locked card. Spread the
// REAL module (AuthProvider stays mountable for the wrapper) and override
// only useAuth, hoisted so no consumer sees a fresh object identity per
// render. Same shape as the precedent in SettingsPage.test.tsx:49-82.
const { authValue } = vi.hoisted(() => ({
  authValue: {
    session: {
      user_id: 'u-ada',
      username: 'ada',
      display_name: 'Ada',
      role_name: 'admin',
      role_id: 'r-admin',
      permissions: ['*'],
    },
    pickerTicket: null,
    loading: false,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    isManager: true,
    isOwner: false,
    swapSession: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/AuthContext')>()),
  useAuth: () => authValue,
}));

// SettingsPage reads useCurrency/useAuth/useBrand, so it needs the same wrapper the
// existing SettingsPage suite builds. It does NOT need seeded IPC data here: these tests
// only assert which section body is mounted, and the section switch happens in the shell
// regardless of what the body fetches.
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
          <AuthProvider>{children}</AuthProvider>
        </CurrencyProvider>
      </BrandProvider>
    </LocaleContext.Provider>
  );
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

function isTopologySection() {
  return !!document.querySelector('.settings-section-content--full');
}

async function renderAtSettingsRoot() {
  window.location.hash = '#/settings';
  renderWithProvidersSync(
    <TestWrapper>
      <SettingsPage />
    </TestWrapper>,
    settingsFtl,
    sharedFtl,
  );
  // The section body is IPC-driven and Suspense-wrapped; wait for the shell.
  await waitFor(() => {
    expect(document.querySelector('.settings-section-content')).toBeTruthy();
  });
}

describe('Settings deep-links while the page is already mounted', () => {
  it('switches to the topology section when the hash changes after mount', async () => {
    await renderAtSettingsRoot();

    // Baseline: arriving at plain #/settings opens the default section, not topology.
    expect(isTopologySection()).toBe(false);

    // What a card click does: assign the hash, which fires hashchange in a real browser.
    window.location.hash = '#/settings/topology';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    // The defect: nothing re-reads the hash once the page is mounted, so the URL changes
    // and the section does not.
    await waitFor(() => {
      expect(isTopologySection()).toBe(true);
    });
  });

  it('still honours a deep-link already present at mount time', async () => {
    // Guards the path that works today, so the fix cannot regress it: arriving from
    // another workspace mounts the page with the hash already set.
    window.location.hash = '#/settings/topology';
    renderWithProvidersSync(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>,
      settingsFtl,
      sharedFtl,
    );

    await waitFor(() => {
      expect(isTopologySection()).toBe(true);
    });
  });

  it('ignores a deep-link to a section that is not in KEPT_SECTIONS', async () => {
    // The guard the mount path has must survive the fix: stale links to removed tabs
    // ("staff", "audit") are ignored so the hub opens on its default instead of an empty
    // body. Without this case, "handle hashchange" could be implemented as "accept any
    // settings/* hash" and silently reintroduce the old bug.
    await renderAtSettingsRoot();
    window.location.hash = '#/settings/staff';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await new Promise((r) => setTimeout(r, 50));
    expect(isTopologySection()).toBe(false);
  });

  it('applies ?branch= and ?create=1 hints to the topology editor and clears the hash', async () => {
    // Locations → Configure topology: the scope must survive the section
    // switch (applyHashSection must NOT clear a hint-carrying hash — the
    // hand-off would be lost between the hashchange and the section mount)
    // and reach the editor as mount props.
    window.location.hash = '#/settings/topology?branch=store-9&create=1';
    renderWithProvidersSync(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>,
      settingsFtl,
      sharedFtl,
    );

    await waitFor(() => {
      expect(isTopologySection()).toBe(true);
    });
    expect(topologyScreenSpy).toHaveBeenCalled();
    const props = topologyScreenSpy.mock.lastCall![0] as {
      initialBranchId?: string;
      openCreateOnMount?: boolean;
    };
    expect(props.initialBranchId).toBe('store-9');
    expect(props.openCreateOnMount).toBe(true);

    // Consumed: the hash is cleared once the hints have been handed off,
    // so a stale scope cannot re-arm on a later remount.
    await waitFor(() => {
      expect(window.location.hash).toBe('');
    });
  });

  it('applies no hints for a bare #/settings/topology deep link', async () => {
    // The plain section deep link (pre-existing behaviour) must keep
    // mounting the editor without a branch scope.
    window.location.hash = '#/settings/topology';
    renderWithProvidersSync(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>,
      settingsFtl,
      sharedFtl,
    );

    await waitFor(() => {
      expect(isTopologySection()).toBe(true);
    });
    expect(topologyScreenSpy).toHaveBeenCalled();
    const props = topologyScreenSpy.mock.lastCall![0] as {
      initialBranchId?: string;
      openCreateOnMount?: boolean;
    };
    expect(props.initialBranchId).toBeUndefined();
    expect(props.openCreateOnMount).toBeUndefined();
  });
});
