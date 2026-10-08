import { recordCrashReport, type CrashReportPayload } from '@/api/system';
import { getShellKind } from '@/utils/shellKind';
import { buildId } from '@/build-id';

/**
 * Sanitizes client-side text by scrubbing tokens, passwords, and PINs.
 * Prevents customer PII and sensitive merchant credentials from leaking into crash reports.
 */
export function sanitizeClientCrashText(text: string): string {
  // Redact Bearer tokens
  let clean = text.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
  // Redact PIN patterns: "pin": "..." or "owner_pin": "..."
  clean = clean.replace(/"(owner_)?pin"\s*:\s*"[^"]*"/gi, '"$1pin": "[REDACTED]"');
  // Redact password patterns
  clean = clean.replace(/"password"\s*:\s*"[^"]*"/gi, '"password": "[REDACTED]"');
  // Redact session tokens
  clean = clean.replace(/"session_?token"\s*:\s*"[^"]*"/gi, '"session_token": "[REDACTED]"');
  return clean;
}

// Track recently reported errors to avoid duplicate spam loops
const reportedFingerprints = new Set<string>();
const MAX_SAVED_FINGERPRINTS = 50;

export interface ReportCrashArgs {
  kind: CrashReportPayload['kind'];
  message: string;
  stack?: string | undefined;
  componentStack?: string | undefined;
  location?: string | undefined;
  timestamp?: string | undefined;
  appVersion?: string | undefined;
  shell?: string | undefined;
}

/**
 * Reports a client-side crash event to the backend crash telemetry sink.
 */
export function reportClientCrash(payload: ReportCrashArgs): void {
  try {
    const fingerprint = `${payload.kind}:${payload.message}:${payload.location ?? ''}`;
    if (reportedFingerprints.has(fingerprint)) {
      return;
    }
    if (reportedFingerprints.size >= MAX_SAVED_FINGERPRINTS) {
      reportedFingerprints.clear();
    }
    reportedFingerprints.add(fingerprint);

    const fullPayload: CrashReportPayload = {
      timestamp: payload.timestamp ?? new Date().toISOString(),
      kind: payload.kind,
      message: sanitizeClientCrashText(payload.message),
      stack: payload.stack ? sanitizeClientCrashText(payload.stack) : undefined,
      componentStack: payload.componentStack ? sanitizeClientCrashText(payload.componentStack) : undefined,
      location: payload.location,
      appVersion: payload.appVersion ?? buildId(),
      shell: payload.shell ?? getShellKind(),
    };

    void recordCrashReport(fullPayload).catch((err) => {
      console.warn('[crashReporter] failed to record crash report:', err);
    });
  } catch (e) {
    console.warn('[crashReporter] unexpected error during reportClientCrash:', e);
  }
}

let installed = false;

/**
 * Installs global error and unhandled promise rejection listeners on `window`.
 */
export function installCrashReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    reportClientCrash({
      kind: 'window_error',
      message: event.message || 'Unknown window error',
      stack: event.error instanceof Error ? event.error.stack : undefined,
      location: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      typeof reason === 'object' && reason !== null && 'message' in reason
        ? String((reason as { message: unknown }).message)
        : String(reason);
    const stack =
      typeof reason === 'object' && reason !== null && 'stack' in reason
        ? String((reason as { stack: unknown }).stack)
        : undefined;

    reportClientCrash({
      kind: 'unhandled_rejection',
      message: message || 'Unhandled promise rejection',
      stack,
    });
  });
}

/** Test helper to reset internal reporter state. */
export function resetCrashReporterForTesting(): void {
  reportedFingerprints.clear();
  installed = false;
}
