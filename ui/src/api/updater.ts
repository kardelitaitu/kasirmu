// ── Android In-App Self-Updater IPC ─────────────────────────────────

import { loggedInvoke } from '@/utils/logged-invoke';

/** Result of checking for application updates. */
export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string | null;
  downloadUrl?: string | null;
  sha256?: string | null;
  fileSizeBytes?: number | null;
  abiMatched?: string | null;
}

/** Payload emitted on update-download-progress Tauri event. */
export interface DownloadProgressPayload {
  receivedBytes: number;
  totalBytes: number;
  percentage: number;
  speedBytesPerSec: number;
  etaSeconds: number;
}

/** Result of preparing update (backup created, ready for OS installer). */
export interface PrepareUpdateResult {
  success: boolean;
  backupPath: string;
  apkPath: string;
}

/** Android native bridge exposed via WebView JavascriptInterface. */
export interface KasirmuNativeBridge {
  canRequestPackageInstalls?: () => boolean;
  openInstallPermissionSettings?: () => void;
  launchPackageInstaller?: (apkFilePath: string) => boolean;
}

declare global {
  interface Window {
    __kasirmuNative?: KasirmuNativeBridge;
  }
}

/**
 * Check if a newer version is available.
 * Scoped by session token (SETTINGS_READ permission required).
 */
export const checkAppUpdate = (
  sessionToken: string,
  customManifestUrl?: string | null,
): Promise<UpdateCheckResult> =>
  loggedInvoke<UpdateCheckResult>('check_app_update', {
    sessionToken,
    customManifestUrl: customManifestUrl ?? null,
  });

/**
 * Start or resume downloading an APK update.
 * Emits `update-download-progress` events.
 * Scoped by session token (SETTINGS_EDIT permission required).
 */
export const startApkDownload = (
  sessionToken: string,
  url: string,
  expectedSha256: string,
  fileName: string,
): Promise<string> =>
  loggedInvoke<string>('start_apk_download', {
    sessionToken,
    url,
    expectedSha256,
    fileName,
  });

/**
 * Verify DB, create pre-update SQLite backup, and save updater settings.
 * Returns the final APK path and backup snapshot path.
 * Scoped by session token (SETTINGS_EDIT permission required).
 */
export const prepareAndLaunchUpdate = (
  sessionToken: string,
  apkPath: string,
): Promise<PrepareUpdateResult> =>
  loggedInvoke<PrepareUpdateResult>('prepare_and_launch_update', {
    sessionToken,
    apkPath,
  });
