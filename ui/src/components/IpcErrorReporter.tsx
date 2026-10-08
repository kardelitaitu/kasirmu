import { useEffect } from 'react';
import { onIpcError, redactedDiagnostic, userErrorKey } from '@/utils/app-error';

/**
 * ERR-06 field-diagnostics recorder — the telemetry subscriber the
 * `loggedInvoke` boundary promises.
 *
 * WHY THIS EXISTS — measured 2026-10-07: the tablet cold start intermittently
 * rejected one settings fan-out source and toasted "Some settings could not
 * be loaded", with no way to name the command from a device walk. Patching
 * `window.__TAURI_INTERNALS__.invoke` from a CDP session is INERT against
 * this app's transport, so the recorder subscribes through the app's own
 * boundary (`onIpcError`) instead — it sees every failure by construction.
 *
 * The log is a bounded (last 40), redacted, namespaced array on `window`:
 * `window.__ipcFailures`. Bounded because it is written on every IPC failure
 * for the life of the session; redacted because tokens, SQL and customer
 * data must never land in a surface a support session can dump.
 *
 * Mount once inside `AppProviders` (next to `GlobalErrorReporter`).
 */

const MAX_ENTRIES = 40;

export interface IpcFailureEntry {
  command: string;
  message: string;
  userKey: string;
  at: number;
}

declare global {
  interface Window {
    __ipcFailures?: IpcFailureEntry[];
  }
}

/** Test seam: start from a known-empty log. */
export function __resetIpcFailuresForTests(): void {
  if (typeof window !== 'undefined') window.__ipcFailures = [];
}

export function IpcErrorReporter() {
  useEffect(() => {
    window.__ipcFailures = window.__ipcFailures ?? [];
    return onIpcError(({ command, error }) => {
      const list = window.__ipcFailures ?? (window.__ipcFailures = []);
      list.push({
        command,
        message: redactedDiagnostic(error),
        userKey: userErrorKey(error),
        at: Date.now(),
      });
      if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
    });
  }, []);
  return null;
}

export default IpcErrorReporter;
