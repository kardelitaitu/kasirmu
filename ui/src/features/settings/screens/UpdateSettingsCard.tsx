import { useState, useEffect, useCallback, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { l10nErrorMessage } from '@/utils/app-error';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useVersionStatus } from '@/hooks/useVersionStatus';
import { formatDisplayVersion } from '@/build-id';
import {
  checkAppUpdate,
  startApkDownload,
  prepareAndLaunchUpdate,
  type UpdateCheckResult,
  type DownloadProgressPayload,
} from '@/api/updater';
import { pendingOfflineCountScoped, retryOfflineSyncScoped } from '@/api/offline';
import { isTabletShell } from '@/utils/shellKind';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import './UpdateSettingsCard.css';

type UpdateStep =
  | 'idle'
  | 'checking'
  | 'up_to_date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error';

interface DownloadState {
  percentage: number;
  speedMb: string;
  etaSeconds: number;
  receivedMb: string;
  totalMb: string;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Settings Card for Android In-App Self-Updater.
 *
 * Provides:
 * - Version checking against release manifest (ABI aware)
 * - Resumable HTTP download with live speed and ETA
 * - Pre-update offline queue safety check & SQLite snapshot
 * - Handoff to Android native package installer
 */
export function UpdateSettingsCard() {
  const { l10n } = useLocalization();
  const { sessionToken } = useWorkspace();

  const [step, setStep] = useState<UpdateStep>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  // Live version and build stamp for the "Current Version" badge. The updater
  // probe's own `currentVersion` still wins when it has answered.
  const { currentVersion, buildId } = useVersionStatus();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadState>({
    percentage: 0,
    speedMb: '0.0',
    etaSeconds: 0,
    receivedMb: '0',
    totalMb: '0',
  });
  const [downloadedApkPath, setDownloadedApkPath] = useState<string | null>(null);

  // Safety gate: pending offline transactions
  const [offlineModalOpen, setOfflineModalOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [syncingOffline, setSyncingOffline] = useState(false);

  // Unlisten ref for download events
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  // Check if native bridge is available and if unknown apps install permission is granted
  const canRequestInstall = useCallback((): boolean => {
    if (typeof window === 'undefined' || !window.__kasirmuNative?.canRequestPackageInstalls) {
      return true;
    }
    try {
      return window.__kasirmuNative.canRequestPackageInstalls();
    } catch {
      return true;
    }
  }, []);

  const openPermissionSettings = useCallback(() => {
    try {
      window.__kasirmuNative?.openInstallPermissionSettings?.();
    } catch {
      // ignore
    }
  }, []);

  // 1. Check for updates
  const handleCheckUpdate = useCallback(async () => {
    if (!sessionToken) return;
    setStep('checking');
    setErrorMessage(null);

    try {
      // Android-only, like the download and install legs below: only the tablet
      // shell registers this door.
      if (isTabletShell()) {
        const res = await checkAppUpdate(sessionToken);
        setUpdateInfo(res);
        if (res.updateAvailable) {
          setStep('available');
        } else {
          setStep('up_to_date');
        }
      } else {
        setStep('error');
        setErrorMessage('In-app updates are Android-only');
      }
    } catch (err: unknown) {
      setStep('error');
      // ERR-05: never render the raw updater error — a plugin/IO failure message
      // is developer-facing text and this card shows it directly to the user.
      setErrorMessage(l10nErrorMessage(err, l10n, 'settings-updater-check-failed'));
    }
  }, [sessionToken, l10n]);

  // Execute actual download after safety check
  const executeDownload = useCallback(async () => {
    if (!sessionToken || !updateInfo?.downloadUrl || !updateInfo?.sha256) return;

    setStep('downloading');
    setErrorMessage(null);
    setDownloadProgress({
      percentage: 0,
      speedMb: '0.0',
      etaSeconds: 0,
      receivedMb: '0',
      totalMb: formatBytes(updateInfo.fileSizeBytes),
    });

    try {
      // Listen for progress events
      const unlisten = await listen<DownloadProgressPayload>(
        'update-download-progress',
        (event) => {
          const payload = event.payload;
          setDownloadProgress({
            percentage: Math.round(payload.percentage),
            speedMb: (payload.speedBytesPerSec / (1024 * 1024)).toFixed(1),
            etaSeconds: payload.etaSeconds,
            receivedMb: formatBytes(payload.receivedBytes),
            totalMb: formatBytes(payload.totalBytes),
          });
        },
      );
      unlistenRef.current = unlisten;

      // Android-only: the APK download and install handoff exist on the tablet
      // shell alone, so the call is guarded rather than routed (no scoped twin).
      if (isTabletShell()) {
        const fileName = `kasirmu-${updateInfo.latestVersion}-${updateInfo.abiMatched || 'universal'}.apk`;
        const apkPath = await startApkDownload(
          sessionToken,
          updateInfo.downloadUrl,
          updateInfo.sha256,
          fileName,
        );

        if (unlistenRef.current) {
          unlistenRef.current();
          unlistenRef.current = null;
        }

        setDownloadedApkPath(apkPath);
        setStep('ready');
      } else {
        setStep('error');
        setErrorMessage('In-app updates are Android-only');
      }
    } catch (err: unknown) {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      setStep('error');
      // ERR-05: never render the raw updater error — a plugin/IO failure message
      // is developer-facing text and this card shows it directly to the user.
      setErrorMessage(l10nErrorMessage(err, l10n, 'settings-updater-check-failed'));
    }
  }, [sessionToken, updateInfo, l10n]);

  // Execute actual install after safety check
  const executeInstall = useCallback(async () => {
    if (!sessionToken || !downloadedApkPath) return;

    if (!canRequestInstall()) {
      openPermissionSettings();
      return;
    }

    setStep('installing');
    setErrorMessage(null);

    try {
      if (isTabletShell()) {
        await prepareAndLaunchUpdate(sessionToken, downloadedApkPath);
        if (window.__kasirmuNative?.launchPackageInstaller) {
          window.__kasirmuNative.launchPackageInstaller(downloadedApkPath);
        }
      }
    } catch (err: unknown) {
      setStep('error');
      // ERR-05: never render the raw updater error — a plugin/IO failure message
      // is developer-facing text and this card shows it directly to the user.
      setErrorMessage(l10nErrorMessage(err, l10n, 'settings-updater-check-failed'));
    }
  }, [sessionToken, downloadedApkPath, canRequestInstall, openPermissionSettings, l10n]);

  // Safety Gate: check offline queue before proceeding with download or install
  const checkSafetyAndProceed = useCallback(
    async (action: () => void) => {
      if (!sessionToken) {
        action();
        return;
      }
      try {
        const count = await pendingOfflineCountScoped(sessionToken);
        if (count > 0) {
          setPendingCount(count);
          setPendingAction(() => action);
          setOfflineModalOpen(true);
        } else {
          action();
        }
      } catch {
        // If offline check cannot be read, proceed directly
        action();
      }
    },
    [sessionToken],
  );

  const handleDownloadClick = useCallback(() => {
    checkSafetyAndProceed(executeDownload);
  }, [checkSafetyAndProceed, executeDownload]);

  const handleInstallClick = useCallback(() => {
    checkSafetyAndProceed(executeInstall);
  }, [checkSafetyAndProceed, executeInstall]);

  const handleSyncOffline = useCallback(async () => {
    if (!sessionToken) return;
    setSyncingOffline(true);
    try {
      await retryOfflineSyncScoped(sessionToken);
      const remaining = await pendingOfflineCountScoped(sessionToken);
      setPendingCount(remaining);
      if (remaining === 0) {
        setOfflineModalOpen(false);
        if (pendingAction) {
          pendingAction();
          setPendingAction(null);
        }
      }
    } catch {
      // keep modal open so user can choose to proceed anyway
    } finally {
      setSyncingOffline(false);
    }
  }, [sessionToken, pendingAction]);

  const handleIgnoreOfflineAndProceed = useCallback(() => {
    setOfflineModalOpen(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  }, [pendingAction]);

  return (
    <div className="update-settings-card" data-testid="update-settings-card">
      <div className="update-settings-header">
        <div>
          <h2 className="update-settings-title">
            <Localized id="settings-updater-title">Application Updates</Localized>
          </h2>
          <p className="update-settings-subtitle">
            <Localized id="settings-updater-subtitle">
              Check for and install Android POS system updates safely.
            </Localized>
          </p>
        </div>
        <div className="update-settings-version-tags">
          <span className="update-badge update-badge--current">
            <Localized
              id="settings-updater-current-version"
              // Fall back to the live app version, not a literal. The updater's
              // own `currentVersion` wins once it has answered; `useVersionStatus`
              // supplies the same value before then. The build stamp is appended
              // for the same reason the footer shows it: a version number cannot
              // tell two builds of one release apart.
              vars={{ version: formatDisplayVersion(updateInfo?.currentVersion, currentVersion, buildId) }}
            >
              {/* FTL fallback only: shown when the key is absent. The live value
                  arrives through `vars`, so this literal is a translation default
                  and deliberately NOT a version source. */}
              Current Version: v0.0.41
            </Localized>
          </span>
          {updateInfo?.latestVersion && (
            <span className="update-badge update-badge--latest">
              <Localized
                id="settings-updater-latest-version"
                vars={{ version: updateInfo.latestVersion }}
              >
                Available Version: v{updateInfo.latestVersion}
              </Localized>
            </span>
          )}
        </div>
      </div>

      <div className="update-settings-body">
        {step === 'idle' && (
          <div className="update-state-box">
            <Button
              variant="primary"
              onClick={handleCheckUpdate}
              data-testid="updater-check-btn"
            >
              <Localized id="settings-updater-check-btn">Check for Updates</Localized>
            </Button>
          </div>
        )}

        {step === 'checking' && (
          <div className="update-state-box update-state-box--loading">
            <div className="update-spinner" aria-hidden="true" />
            <p>
              <Localized id="settings-updater-checking">Checking for updates…</Localized>
            </p>
          </div>
        )}

        {step === 'up_to_date' && (
          <div className="update-state-box update-state-box--ok">
            <div className="update-status-icon" aria-hidden="true">✓</div>
            <p className="update-status-message">
              <Localized id="settings-updater-up-to-date">
                Your application is up to date.
              </Localized>
            </p>
            <Button variant="secondary" onClick={handleCheckUpdate}>
              <Localized id="settings-updater-check-btn">Check for Updates</Localized>
            </Button>
          </div>
        )}

        {step === 'available' && updateInfo && (
          <div className="update-state-box update-state-box--available">
            <div className="update-banner">
              <span className="update-banner-icon" aria-hidden="true">🚀</span>
              <p className="update-banner-text">
                <Localized id="settings-updater-available-banner">
                  A newer version is available for your device!
                </Localized>
              </p>
            </div>

            {updateInfo.releaseNotes && (
              <div className="update-release-notes">
                <div className="update-notes-title">Changelog</div>
                <div className="update-notes-content">{updateInfo.releaseNotes}</div>
              </div>
            )}

            <div className="update-action-row">
              <Button
                variant="primary"
                onClick={handleDownloadClick}
                data-testid="updater-download-btn"
              >
                <Localized
                  id="settings-updater-download-btn"
                  vars={{ size: formatBytes(updateInfo.fileSizeBytes) }}
                >
                  Download Update ({formatBytes(updateInfo.fileSizeBytes)})
                </Localized>
              </Button>
              <Button variant="secondary" onClick={handleCheckUpdate}>
                <Localized id="settings-updater-check-btn">Check for Updates</Localized>
              </Button>
            </div>
          </div>
        )}

        {step === 'downloading' && (
          <div className="update-state-box update-state-box--progress">
            <div className="update-progress-meta">
              <span className="update-progress-label">
                <Localized
                  id="settings-updater-progress"
                  vars={{
                    percent: String(downloadProgress.percentage),
                    speed: downloadProgress.speedMb,
                  }}
                >
                  Downloading: {downloadProgress.percentage}% ({downloadProgress.speedMb} MB/s)
                </Localized>
              </span>
              {downloadProgress.etaSeconds > 0 && (
                <span className="update-progress-eta">
                  <Localized
                    id="settings-updater-eta"
                    vars={{ eta: String(downloadProgress.etaSeconds) }}
                  >
                    Estimated time remaining: {downloadProgress.etaSeconds}s
                  </Localized>
                </span>
              )}
            </div>

            <div
              className="update-progress-track"
              role="progressbar"
              aria-valuenow={downloadProgress.percentage}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="update-progress-fill"
                style={{ width: `${downloadProgress.percentage}%` }}
              />
            </div>
          </div>
        )}

        {step === 'ready' && (
          <div className="update-state-box update-state-box--ready">
            <div className="update-banner update-banner--ready">
              <span className="update-banner-icon" aria-hidden="true">📦</span>
              <p className="update-banner-text">
                Ready to install update (v{updateInfo?.latestVersion || '0.0.41'}).
              </p>
            </div>

            {!canRequestInstall() ? (
              <div className="update-permission-box">
                <p className="update-permission-text">
                  <Localized id="settings-updater-permission-note">
                    Android requires permission to install packages from this app.
                  </Localized>
                </p>
                <Button variant="primary" onClick={openPermissionSettings}>
                  <Localized id="settings-updater-permission-btn">
                    Grant Install Permission
                  </Localized>
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                onClick={handleInstallClick}
                data-testid="updater-install-btn"
              >
                <Localized id="settings-updater-install-btn">
                  Install Update Now
                </Localized>
              </Button>
            )}
          </div>
        )}

        {step === 'installing' && (
          <div className="update-state-box update-state-box--loading">
            <div className="update-spinner" aria-hidden="true" />
            <p>
              <Localized id="settings-updater-backup-creating">
                Creating pre-update database backup…
              </Localized>
            </p>
          </div>
        )}

        {step === 'error' && (
          <div className="update-state-box update-state-box--error">
            <p className="update-error-text">
              <Localized
                id="settings-updater-error-prefix"
                vars={{ error: errorMessage || 'Unknown error' }}
              >
                Update error: {errorMessage}
              </Localized>
            </p>
            <Button variant="secondary" onClick={handleCheckUpdate}>
              <Localized id="settings-updater-check-btn">Try Again</Localized>
            </Button>
          </div>
        )}
      </div>

      {/* Offline Unsynced Transactions Safety Modal */}
      <Modal
        open={offlineModalOpen}
        onClose={() => setOfflineModalOpen(false)}
        title={l10n.getString('settings-updater-offline-warning-title')}
        footer={
          <div className="update-modal-actions">
            <Button variant="secondary" onClick={() => setOfflineModalOpen(false)}>
              <Localized id="settings-updater-cancel">Cancel</Localized>
            </Button>
            <Button
              variant="secondary"
              onClick={handleIgnoreOfflineAndProceed}
              data-testid="updater-offline-proceed-btn"
            >
              <Localized id="settings-updater-offline-ignore-proceed">
                Proceed Anyway
              </Localized>
            </Button>
            <Button
              variant="primary"
              onClick={handleSyncOffline}
              loading={syncingOffline}
              data-testid="updater-offline-sync-btn"
            >
              <Localized id="settings-updater-offline-sync-now">Sync Now</Localized>
            </Button>
          </div>
        }
      >
        <p className="update-offline-body">
          <Localized
            id="settings-updater-offline-warning-body"
            vars={{ count: String(pendingCount) }}
          >
            You have {pendingCount} unsynced transactions in your offline queue. Please sync
            them with the cloud before updating to prevent potential data loss.
          </Localized>
        </p>
      </Modal>
    </div>
  );
}
