// ── Settings deep-link section switching ──────────────────────────
//
// WorkspaceHome's tool cards navigate by writing window.location.hash and letting the
// Settings page read the sub-section out of it. SettingsPage.tsx:255-276 does exactly
// that: KEPT_SECTIONS (:72) lists the accepted names and a useEffect maps
// `#/settings/<section>` onto activeSection -- on mount and on every hashchange.
//
// The listener is there because AppShell refuses `settings/...` (only 'settings' is a
// registered page), so while the page is ALREADY MOUNTED nothing else re-reads the hash.
// A mount-only effect made every card click from the admin workspace change the URL and
// nothing else -- the defect this suite pins.
//
// 3c76e6c97 flattened the settings IA: the 'topology' section is gone and KEPT_SECTIONS
// now lists the 13 rebuild screens ('general', 'data-sync', 'sync-status', ...). The old
// settings-section-content--full marker was removed with it, so the live section is read
// off the nav's active item instead. A link to a key the guard does not accept is ignored:
// the hub keeps its default 'general' body and the hash stays unconsumed -- the fallback
// the removed-section cases below assert.

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

/** The section the hub is showing, read off the sidebar's active nav item. */
function activeSectionLabel(): string | null {
  return document.querySelector('.settings-nav-item--active')?.getAttribute('aria-label') ?? null;
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
  it('switches to a kept section when the hash changes after mount', async () => {
    await renderAtSettingsRoot();

    // Baseline: arriving at plain #/settings opens the default section.
    const defaultSection = activeSectionLabel();
    expect(defaultSection).not.toBeNull();
    expect(isTopologySection()).toBe(false);

    // What a card click does: assign the hash, which fires hashchange in a real browser.
    // 'data-sync' stands in for the old 'topology' target, which 3c76e6c97 removed from
    // KEPT_SECTIONS -- the switching path is pinned against a section that still exists.
    window.location.hash = '#/settings/data-sync';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    // The defect: nothing re-reads the hash once the page is mounted, so the URL changes
    // and the section does not.
    await waitFor(() => {
      expect(activeSectionLabel()).not.toBe(defaultSection);
    });
    // A bare link to a kept section is consumed, so a later remount cannot re-arm it.
    expect(window.location.hash).toBe('');
  });

  it('still honours a deep-link already present at mount time', async () => {
    // Guards the path that works today, so the fix cannot regress it: arriving from
    // another workspace mounts the page with the hash already set.
    // 'tax-configuration' is a KEPT_SECTIONS key since 3c76e6c97 removed 'topology'.
    window.location.hash = '#/settings/tax-configuration';
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

    // Only an accepted section clears the hash, so an empty hash plus an active nav item
    // that is not the default page proves the mount-time branch mapped the deep link.
    expect(window.location.hash).toBe('');
    const defaultLabel = /^settings-nav-general\s*=\s*(.*)$/m.exec(settingsFtl)![1]!.trim();
    const active = activeSectionLabel();
    expect(active).not.toBeNull();
    expect(active).not.toBe(defaultLabel);
    expect(isTopologySection()).toBe(false);
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

  it('leaves a hint-carrying link to the removed topology section unconsumed', async () => {
    // Locations → Configure topology. 3c76e6c97 removed the topology section, so
    // the hand-off has no target: the guard rejects the key, the hub keeps a real
    // default body, and the hash survives because only an accepted section clears it.
    window.location.hash = '#/settings/topology?branch=store-9&create=1';
    renderWithProvidersSync(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>,
      settingsFtl,
      sharedFtl,
    );

    // Fallback, not a blank or crashed section: the default placeholder screen mounts.
    await waitFor(() => {
      expect(document.querySelector('section.settings-screen-placeholder')).toBeTruthy();
    });
    expect(isTopologySection()).toBe(false);
    expect(topologyScreenSpy).not.toHaveBeenCalled();
    expect(activeSectionLabel()).not.toBeNull();

    // A hint-carrying hash is still never cleared (unchanged contract) — here
    // because nothing consumed it, so a stale scope cannot re-arm a removed section.
    expect(window.location.hash).toBe('#/settings/topology?branch=store-9&create=1');
  });

  it('ignores a bare link to the removed topology section without a blank body', async () => {
    // The plain section deep link. 3c76e6c97 removed the topology section, so
    // the hub now falls back to its default page instead of mounting the editor.
    window.location.hash = '#/settings/topology';
    renderWithProvidersSync(
      <TestWrapper>
        <SettingsPage />
      </TestWrapper>,
      settingsFtl,
      sharedFtl,
    );

    await waitFor(() => {
      expect(document.querySelector('section.settings-screen-placeholder')).toBeTruthy();
    });
    expect(isTopologySection()).toBe(false);
    expect(topologyScreenSpy).not.toHaveBeenCalled();

    // Bare links ARE consumed, but only once accepted — a rejected key leaves the
    // URL alone, which is what keeps the guard honest for both link shapes.
    expect(window.location.hash).toBe('#/settings/topology');
  });
});
