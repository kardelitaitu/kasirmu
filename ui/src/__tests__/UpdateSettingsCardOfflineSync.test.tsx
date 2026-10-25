import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProvidersSync } from '@/__tests__/test-utils/render';
import settingsFtl from '@/locales/settings.ftl?raw';

// ── UpdateSettingsCard — the offline safety modal ────────────────────────────
//
// The card gates an INSTALL behind a count of unsynced transactions: more than zero
// opens a modal whose "Sync Now" drains the queue and then closes the modal and fires
// whatever the operator asked for. Two taps on that button inside one tick reach the
// handler twice, because \`syncingOffline\` is STATE and React commits it on the next
// render. Each run READS the remaining count afterwards and acts when it reaches zero,
// so a replay can run the operator's queued download/install twice.
//
// The card is driven to the modal through its own Check-for-updates button: the check
// reports an update, the download click finds three unsynced transactions and opens the
// safety modal instead of downloading.

const mocks = vi.hoisted(() => ({
  pendingCount: vi.fn(),
  retrySync: vi.fn(),
  checkAppUpdate: vi.fn(),
  isTabletShell: vi.fn(),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'tok-1' }),
}));
vi.mock('@/api/offline', () => ({
  pendingOfflineCountScoped: (...a: unknown[]) => mocks.pendingCount(...a),
  retryOfflineSyncScoped: (...a: unknown[]) => mocks.retrySync(...a),
}));
vi.mock('@/utils/shellKind', () => ({
  isTabletShell: () => mocks.isTabletShell(),
  getShellKind: () => 'tablet',
  setShellKind: vi.fn(),
}));
vi.mock('@/api/updater', () => ({
  checkAppUpdate: (...a: unknown[]) => mocks.checkAppUpdate(...a),
}));
// The render helper mounts its own LocalizationProvider from this module, so only
// `Localized` is replaced: the card's fallbacks interpolate a JSX child LIST for the
// version badge, which the real component refuses without a matching FTL entry.
vi.mock('@fluent/react', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    Localized: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});
vi.mock('@/hooks/useVersionStatus', () => ({
  useVersionStatus: () => ({ currentVersion: '0.0.41', buildId: 'test', state: 'latest', availableVersion: null, update: null }),
}));

import { UpdateSettingsCard } from '@/features/settings/screens/UpdateSettingsCard';

function renderCard() {
  return renderWithProvidersSync(<UpdateSettingsCard />, settingsFtl);
}

describe('UpdateSettingsCard — offline safety modal', () => {
  beforeEach(() => {
    mocks.pendingCount.mockReset().mockResolvedValue(3);
    mocks.retrySync.mockReset().mockResolvedValue(undefined);
    mocks.isTabletShell.mockReset().mockReturnValue(true);
    mocks.checkAppUpdate.mockReset().mockResolvedValue({
      updateAvailable: true,
      latestVersion: '0.0.42',
      downloadUrl: 'https://example.test/app.apk',
      sha256: 'a'.repeat(64),
      fileSizeBytes: 1024,
      releaseNotes: '',
      abiMatched: 'universal',
    });
  });

  it('drains the queue once when Sync Now is double-tapped', async () => {
    renderCard();
    const checkBtn = await screen.findByTestId('updater-check-btn');
    fireEvent.click(checkBtn);

    const download = await screen.findByTestId('updater-download-btn');
    fireEvent.click(download);

    const syncBtn = await screen.findByTestId('updater-offline-sync-btn');
    // Hold the sync open, so both clicks land while the first is still in flight.
    let release: (() => void) | undefined;
    mocks.retrySync.mockReturnValue(new Promise<void>((res) => { release = res; }));

    await act(async () => {
      fireEvent.click(syncBtn);
      fireEvent.click(syncBtn);
    });

    release?.();
    await waitFor(() => expect(mocks.retrySync).toHaveBeenCalledTimes(1));
  });
});
