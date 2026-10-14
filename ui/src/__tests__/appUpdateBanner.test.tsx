// ── app/UpdateBanner tests ────────────────────────────────────────
//
// WHY THIS FILE EXISTS, and what changed beneath it. It was written when the tree
// held TWO UpdateBanner components: a dead twin at `ui/src/components/UpdateBanner.tsx`,
// reachable only from its own test, and the shipped one at `ui/src/app/UpdateBanner.tsx`,
// imported by `AppLayout.tsx:5`. This file was added to cover the SHIPPED banner, which
// had no test at all.
//
// THE TWIN IS NOW GONE. Measured 2026-10-14 (round 152): the only `UpdateBanner` files
// in `ui/src` are `app/UpdateBanner.tsx`, `app/UpdateBanner.css` and this test. The dead
// component and its `UpdateBanner.test.tsx` were both retired, so the title above is
// stale and the file is now simply the shipped banner's suite — the reason it is named
// `app…` rather than `UpdateBanner…` is history, not a distinction still to draw.
//
// The regression this pins: `versionBlocked` was a ONE-WAY LATCH. It was set
// when the running build was below the update's `min_version`, and never
// cleared — while its render branch returns BEFORE the `updateAvailable`
// check. One probe reporting an incompatible release therefore replaced the
// update banner for the rest of the session, even after the probe reported a
// compatible one.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { ReactLocalization, LocalizationProvider } from '@fluent/react';
import UpdateBanner from '@/app/UpdateBanner';

const mocks = vi.hoisted(() => ({
  version: {
    state: 'latest' as 'checking' | 'latest' | 'update',
    currentVersion: '0.0.41',
    availableVersion: null as string | null,
    instance: null as { body?: string | undefined; downloadAndInstall: () => Promise<void> } | null,
  },
}));

vi.mock('@/hooks/useVersionStatus', () => ({
  useVersionStatus: () => ({
    state: mocks.version.state,
    currentVersion: mocks.version.currentVersion,
    buildId: 'test-build',
    availableVersion: mocks.version.availableVersion,
    instance: mocks.version.instance,
  }),
}));

vi.mock('@/api/settings', () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/api/data', () => ({ createBackup: vi.fn(() => Promise.resolve({ path: '/tmp/b.db' })) }));

const FTL = [
  'update-banner-title = Update available:',
  'update-banner-new-version = new version',
  'update-banner-install = Install',
  'update-banner-installing = Installing',
  'update-banner-install-aria = Install update',
  'update-banner-installing-aria = Installing update',
  'update-banner-backing-up = Backing up',
  'update-banner-backing-up-aria = Backing up',
  'update-banner-dismiss = Dismiss',
  'update-banner-dismiss-aria = Dismiss update banner',
  'update-banner-backup-error = Backup failed',
  'update-banner-version-blocked-title = Update not available:',
  'update-banner-version-blocked-desc = Your version { $current } is below minimum { $minimum }.',
  'update-banner-rollback-title = Update may have failed:',
  'update-banner-rollback-desc = Previous version { $version } available.',
  'update-banner-rollback = Download',
  'update-banner-rollback-aria = Download previous version',
].join('\n');

function wrapper({ children }: { children: React.ReactNode }) {
  const bundle = new FluentBundle('en');
  bundle.addResource(new FluentResource(FTL));
  return (
    <LocalizationProvider l10n={new ReactLocalization([bundle])}>
      {children}
    </LocalizationProvider>
  );
}

function setUpdate(body?: string, version = '9.9.9') {
  mocks.version.state = 'update';
  mocks.version.availableVersion = version;
  mocks.version.instance = { body, downloadAndInstall: vi.fn(() => Promise.resolve()) };
}

beforeEach(() => {
  mocks.version.state = 'latest';
  mocks.version.currentVersion = '0.0.41';
  mocks.version.availableVersion = null;
  mocks.version.instance = null;
});

describe('app/UpdateBanner (the SHIPPED banner)', () => {
  it('renders nothing when no update is available', () => {
    render(<UpdateBanner />, { wrapper });
    expect(screen.queryByText(/Update available/i)).toBeNull();
  });

  it('renders the update banner when an update is available', async () => {
    setUpdate('Bug fixes');
    render(<UpdateBanner />, { wrapper });
    await waitFor(() => expect(screen.getByText(/Update available/i)).toBeInTheDocument());
  });

  it('blocks the install when the running build is below the minimum', async () => {
    // `min_version` rides inside the release body as JSON metadata.
    setUpdate(JSON.stringify({ min_version: '1.0.0' }));
    render(<UpdateBanner />, { wrapper });

    await waitFor(() => expect(screen.getByText(/Update not available/i)).toBeInTheDocument());
    // The incompatible banner REPLACES the update banner — no install control.
    expect(screen.queryByText(/^Install$/)).toBeNull();
  });

  it('dismisses the version-blocked banner when Dismiss is clicked', async () => {
    // The Priority-2 (version-blocked) branch returns BEFORE the `dismissed` check,
    // and did not consult it at all -- so this button set state that nothing read.
    // A control that silently does nothing is worse than no control.
    setUpdate(JSON.stringify({ min_version: '1.0.0' }));
    render(<UpdateBanner />, { wrapper });
    await waitFor(() => expect(screen.getByText(/Update not available/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(screen.queryByText(/Update not available/i)).toBeNull());
  });

  it('CLEARS the block when a later probe reports a compatible update (the latch)', async () => {
    // The regression: `versionBlocked` was set but never reset, and its render
    // branch returns before the updateAvailable check — so the blocked banner
    // outlived the condition that produced it, for the rest of the session.
    setUpdate(JSON.stringify({ min_version: '1.0.0' }));
    const view = render(<UpdateBanner />, { wrapper });
    await waitFor(() => expect(screen.getByText(/Update not available/i)).toBeInTheDocument());

    // The SAME running build, but the probe now reports a compatible release.
    setUpdate(JSON.stringify({ min_version: '0.0.1' }), '9.9.10');
    view.rerender(<UpdateBanner />);

    await waitFor(() => expect(screen.getByText(/Update available/i)).toBeInTheDocument());
    expect(screen.queryByText(/Update not available/i)).toBeNull();
  });

  it('treats a release with no min_version as compatible', async () => {
    setUpdate('Plain text release notes');
    render(<UpdateBanner />, { wrapper });
    await waitFor(() => expect(screen.getByText(/Update available/i)).toBeInTheDocument());
    expect(screen.queryByText(/Update not available/i)).toBeNull();
  });
});