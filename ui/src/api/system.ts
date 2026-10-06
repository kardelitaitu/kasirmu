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

