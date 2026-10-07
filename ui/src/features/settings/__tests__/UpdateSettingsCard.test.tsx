import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateSettingsCard } from '../screens/UpdateSettingsCard';
import { isTabletShell } from '@/utils/shellKind';

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ sessionToken: 'mock-session-token' }),
}));

// The in-app updater is Android-only: its three commands exist on the tablet
// shell alone, so the card's real flow is exercised on that shell. The desktop
// shell's inert path is covered by its own case below.
vi.mock('@/utils/shellKind', () => ({
  isTabletShell: vi.fn().mockReturnValue(true),
}));

vi.mock('@fluent/react', () => ({
  Localized: ({ children, id, vars }: { children: React.ReactNode; id: string; vars?: Record<string, string> }) => {
    if (vars) {
      let str = id;
      for (const [k, v] of Object.entries(vars)) {
        str += ` ${k}=${v}`;
      }
      return <>{str}</>;
    }
    return <>{children || id}</>;
  },
  useLocalization: () => ({
    l10n: {
      getString: (id: string, vars?: Record<string, string>) => {
        if (vars) {
          let str = id;
          for (const [k, v] of Object.entries(vars)) {
            str += ` ${k}=${v}`;
          }
          return str;
        }
        return id;
      },
    },
  }),
}));

describe('UpdateSettingsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTabletShell).mockReturnValue(true);
    delete window.__kasirmuNative;
  });

  it('renders in idle state with check update button', () => {
    render(<UpdateSettingsCard />);
    expect(screen.getByTestId('update-settings-card')).toBeInTheDocument();
    expect(screen.getByTestId('updater-check-btn')).toBeInTheDocument();
  });

  it('handles up-to-date response', async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValueOnce({
      updateAvailable: false,
      currentVersion: '0.0.41',
      latestVersion: '0.0.41',
    });

    render(<UpdateSettingsCard />);
    await user.click(screen.getByTestId('updater-check-btn'));

    await waitFor(() => {
      expect(screen.getByText('Your application is up to date.')).toBeInTheDocument();
    });
    expect(mockInvoke).toHaveBeenCalledWith('check_app_update', {
      sessionToken: 'mock-session-token',
      customManifestUrl: null,
    });
  });

  it('shows update available and initiates download when cart and offline queue are clean', async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_app_update') {
        return Promise.resolve({
          updateAvailable: true,
          currentVersion: '0.0.41',
          latestVersion: '0.0.42',
          releaseNotes: 'Performance improvements',
          downloadUrl: 'https://example.com/app.apk',
          sha256: 'abc123sha',
          fileSizeBytes: 52428800,
          abiMatched: 'arm64-v8a',
        });
      }
      if (cmd === 'pending_offline_count_scoped') {
        return Promise.resolve(0);
      }
      if (cmd === 'start_apk_download') {
        return Promise.resolve('/cache/updates/kasirmu-0.0.42-arm64-v8a.apk');
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    render(<UpdateSettingsCard />);
    await user.click(screen.getByTestId('updater-check-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('updater-download-btn')).toBeInTheDocument();
    });
    expect(screen.getByText('Performance improvements')).toBeInTheDocument();

    // Click download
    await user.click(screen.getByTestId('updater-download-btn'));

    // Should reach ready state
    await waitFor(() => {
      expect(screen.getByTestId('updater-install-btn')).toBeInTheDocument();
    });
  });

  it('warns about unsynced offline transactions before downloading', async () => {
    const user = userEvent.setup();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_app_update') {
        return Promise.resolve({
          updateAvailable: true,
          currentVersion: '0.0.41',
          latestVersion: '0.0.42',
          releaseNotes: 'Bug fixes',
          downloadUrl: 'https://example.com/app.apk',
          sha256: 'abc123sha',
          fileSizeBytes: 52428800,
          abiMatched: 'arm64-v8a',
        });
      }
      if (cmd === 'pending_offline_count_scoped') {
        return Promise.resolve(3);
      }
      if (cmd === 'start_apk_download') {
        return Promise.resolve('/cache/updates/app.apk');
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    render(<UpdateSettingsCard />);
    await user.click(screen.getByTestId('updater-check-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('updater-download-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('updater-download-btn'));

    // Warning modal should appear with count=3
    await waitFor(() => {
      expect(screen.getByTestId('updater-offline-proceed-btn')).toBeInTheDocument();
      expect(screen.getByTestId('updater-offline-sync-btn')).toBeInTheDocument();
    });

    // User chooses to proceed anyway
    await user.click(screen.getByTestId('updater-offline-proceed-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('updater-install-btn')).toBeInTheDocument();
    });
  });

  it('invokes native installer on install click', async () => {
    const user = userEvent.setup();
    const mockLaunchInstaller = vi.fn().mockReturnValue(true);
    window.__kasirmuNative = {
      canRequestPackageInstalls: () => true,
      launchPackageInstaller: mockLaunchInstaller,
    };

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'check_app_update') {
        return Promise.resolve({
          updateAvailable: true,
          currentVersion: '0.0.41',
          latestVersion: '0.0.42',
          downloadUrl: 'https://example.com/app.apk',
          sha256: 'abc123sha',
        });
      }
      if (cmd === 'pending_offline_count_scoped') {
        return Promise.resolve(0);
      }
      if (cmd === 'start_apk_download') {
        return Promise.resolve('/cache/updates/app.apk');
      }
      if (cmd === 'prepare_and_launch_update') {
        return Promise.resolve({
          success: true,
          backupPath: '/cache/backups/backup.db',
          apkPath: '/cache/updates/app.apk',
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${cmd}`));
    });

    render(<UpdateSettingsCard />);
    await user.click(screen.getByTestId('updater-check-btn'));
    await waitFor(() => expect(screen.getByTestId('updater-download-btn')).toBeInTheDocument());

    await user.click(screen.getByTestId('updater-download-btn'));
    await waitFor(() => expect(screen.getByTestId('updater-install-btn')).toBeInTheDocument());

    await user.click(screen.getByTestId('updater-install-btn'));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('prepare_and_launch_update', {
        sessionToken: 'mock-session-token',
        apkPath: '/cache/updates/app.apk',
      });
      expect(mockLaunchInstaller).toHaveBeenCalledWith('/cache/updates/app.apk');
    });
  });

  it('refuses to check for updates on the desktop shell', async () => {
    vi.mocked(isTabletShell).mockReturnValue(false);
    const user = userEvent.setup();

    render(<UpdateSettingsCard />);
    await user.click(screen.getByTestId('updater-check-btn'));

    await waitFor(() => {
      expect(screen.getByText(/updates are Android-only/)).toBeInTheDocument();
    });
    // The desktop shell registers none of the updater doors, so nothing reaches IPC.
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'check_app_update',
      expect.anything(),
    );
  });
});
