// ── System: ping, version info ───────────────────────────────────

import { loggedInvoke } from '@/utils/logged-invoke';

/** Placeholder type for the ping command (returns "pong" as a string). */
export interface PingResult {
  // ping returns "pong" as a string
}

/** Application version and build information. */
export interface VersionInfo {
  name: string;
  version: string;
  rustVersion: string;
  target: string;
}

/** Ping the backend to verify connectivity. Returns "pong" on success. */
export const ping = (): Promise<string> => loggedInvoke<string>('ping');

/** Get the application version and build details. */
export const getVersion = (): Promise<VersionInfo> =>
  loggedInvoke<VersionInfo>('version');

/** Get application version resolved from a session token. ADR #7. Falls back to unscoped version if version_scoped is unavailable. */
export const getVersionScoped = (sessionToken: string): Promise<VersionInfo> =>
  loggedInvoke<VersionInfo>('version_scoped', { sessionToken }).catch((err) => {
    const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err ?? '');
    if (msg.includes('version_scoped') || msg.toLowerCase().includes('not found')) {
      return getVersion();
    }
    throw err;
  });


/** Get the local IP address of the device. */
export const getLocalIp = (): Promise<string> =>
  loggedInvoke<string>('get_local_ip');

/** Get the stable device identifier (hostname) for terminal binding. */
export const getDeviceId = (): Promise<string> =>
  loggedInvoke<string>('get_device_id');

/**
 * Subscribe to `kasirmu://reconnect` broadcasts (fired when window regains focus
 * after being backgrounded or suspended, e.g. on Android WebView resume).
 */
export const onAppReconnect = async (
  handler: () => void,
): Promise<() => void> => {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen('kasirmu://reconnect', () => handler());
    return unlisten;
  } catch {
    return () => {};
  }
};

/** Storage health status and capacity info. */
export interface StorageHealth {
  availableBytes: number;
  totalBytes: number;
  isLowSpace: boolean;
  thresholdBytes: number;
}

/** Check storage capacity and low space warning (< 500 MB). */
export const getStorageHealth = (): Promise<StorageHealth> =>
  loggedInvoke<StorageHealth>('get_storage_health');

/** Diagnostic export archive result. */
export interface DiagnosticExportResult {
  path: string;
  sizeBytes: number;
  filesIncluded: string[];
}

/** Pick output path for diagnostic archive (.zip) via native file dialog. */
export const pickDiagnosticExportPath = async (): Promise<string | null> => {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { cachePathFor, isContentUri } = await import('@/api/file-bridge');
  const chosen = await save({
    defaultPath: `kasirmu_diagnostics_${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
  });
  if (!chosen) return null;
  if (!isContentUri(chosen)) return chosen;
  return cachePathFor('diagnostics', '.zip');
};

/** Export diagnostic archive (.zip) containing system telemetry, sync stats, and sanitized logs. */
export const exportDiagnostics = (
  sessionToken: string,
  outputPath: string,
): Promise<DiagnosticExportResult> =>
  loggedInvoke<DiagnosticExportResult>('export_diagnostics', { sessionToken, outputPath });

/** Payload for crash telemetry reporting. */
export interface CrashReportPayload {
  timestamp: string;
  kind: 'panic' | 'unhandled_rejection' | 'window_error' | 'react_error_boundary';
  message: string;
  stack?: string | undefined;
  componentStack?: string | undefined;
  location?: string | undefined;
  appVersion?: string | undefined;
  shell?: string | undefined;
}

/** Record fatal frontend or runtime crash telemetry report without sensitive PII. */
export const recordCrashReport = (report: CrashReportPayload): Promise<void> =>
  loggedInvoke<void>('record_crash_report', { report });


