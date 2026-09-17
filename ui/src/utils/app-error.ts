/**
 * Shared AppError normalizer (ERR-05/ERR-06).
 *
 * Every Tauri command rejects with a typed `AppError` (`kind` discriminator
 * plus optional `subKind`, see `apps/desktop-tauri/src/error.rs` and
 * `ui/src/types/domain.ts`). Raw backend messages can leak SQL, identifiers,
 * and infrastructure details into the UI — so screens must never render
 * `err.message` directly.
 *
 * This module is the single IPC-boundary adapter:
 *  - `parseAppError` extracts the typed shape from an object OR a
 *    Tauri-wrapped error string (the v2 runtime prefixes serialized JSON).
 *  - `normalizeError` produces a redacted, correlation-tagged diagnostic
 *    and a retry classification.
 *  - `userErrorMessage` maps the typed kind/subKind to localized, user-safe
 *    copy. Internal/db messages never become the default user-facing text.
 *  - `installGlobalErrorReporter` provides the ERR-01 global async-failure
 *    surface: `window.error` + `unhandledrejection` are logged redacted and
 *    surfaced as a recoverable notification only when unexpected (expected
 *    API failures are handled by screens and stay silent globally).
 */

import { isAppError, type AppError } from '@/types/domain';
import type { ReactLocalization } from '@fluent/react';

/** Retry classification derived from the typed error (ERR-06). */
export type RetryClass = 'retryable' | 'non-retryable';

/** A normalized, redacted, correlation-tagged error (ERR-06). */
export interface NormalizedError {
  /** `kind` discriminator or `'unknown'` when the shape is unrecognized. */
  kind: string;
  /** Typed `subKind` (camelCase mirror of the Rust enum), if present. */
  subKind?: string;
  /** Original message — development diagnostics only, never user-facing. */
  rawMessage: string;
  retryClass: RetryClass;
  /** Stable request correlation id so logs can be traced across retries. */
  correlationId: string;
  /** FTL key for the localized user-safe copy. */
  userKey: string;
}

// ── Correlation ids ────────────────────────────────────────────────

let correlationCounter = 0;

/** Generate a short, unique correlation id for a request/error. */
export function newCorrelationId(): string {
  correlationCounter += 1;
  return `oz-${Date.now().toString(36)}-${correlationCounter.toString(36)}`;
}

/** Attach (or reuse) a correlation id on a thrown value. */
export function withCorrelationId(err: unknown, id?: string): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { __ozCorrelationId?: string };
    if (e.__ozCorrelationId) return e.__ozCorrelationId;
    e.__ozCorrelationId = id ?? newCorrelationId();
    return e.__ozCorrelationId;
  }
  return id ?? newCorrelationId();
}

// ── Typed parsing ──────────────────────────────────────────────────

/**
 * Extract the typed `AppError` from any thrown value.
 *
 * Handles three shapes:
 *  1. A plain object carrying a `kind` discriminator (normal Tauri v2 path).
 *  2. An `Error` whose `.message` embeds the serialized JSON (the v2 runtime
 *     prefixes command failures with `Error invoking remote method '…': …`).
 *  3. A raw string containing that JSON.
 *
 * Returns `null` when the value is not a recognizable AppError.
 */
export function parseAppError(err: unknown): AppError | null {
  if (isAppError(err)) return err;

  const source = typeof err === 'string' ? err : err instanceof Error ? err.message : null;
  if (source === null) return null;

  // Tauri v2 prefixes the serialized payload with a human-readable wrapper.
  const jsonStart = source.indexOf('{');
  if (jsonStart < 0) return null;
  const jsonStr = source.slice(jsonStart);
  try {
    const parsed: unknown = JSON.parse(jsonStr);
    if (isAppError(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** The `subKind` value if this error carries one. */
export function appErrorSubKind(err: AppError): string | undefined {
  return 'subKind' in err ? (err as { subKind?: string }).subKind : undefined;
}

// ── Retry classification ───────────────────────────────────────────

/** Hardware transport failures are retryable — the device may come back. */
const RETRYABLE_HARDWARE = new Set([
  'timeout', 'disconnected', 'io', 'usb', 'bluetooth', 'protocol', 'busy',
]);

/** Transient infrastructure failures are retryable. */
const RETRYABLE_CORE = new Set(['platform']);

/**
 * Classify an error as retryable or not from its typed shape.
 *
 * Conservative by design: validation, permission, session, conflict, and
 * internal errors are NOT retried automatically (the user or the app must
 * change something first); hardware transport + platform infrastructure
 * failures are.
 */
export function classifyRetry(err: AppError | unknown): RetryClass {
  const typed = parseAppError(err);
  if (!typed) {
    // Unrecognized — the message text is all that is left, so read it
    // with the same precedence the checkout scanner had before R3
    // deleted it: a message naming a terminal condition is NOT an
    // invitation to re-submit a payment, even when it also mentions
    // transport words ('connection closed after the charge was already
    // captured' must never offer Retry).
    const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
    const lower = msg.toLowerCase();
    if (/declined|invalid|not found|insufficient|unauthorized|forbidden|already/i.test(lower)) {
      return 'non-retryable';
    }
    // Transient transport/infrastructure vocabulary. Deliberately absent:
    // 'try again' — this module's OWN user-safe copy ends non-retryable
    // messages with it ("…changed by someone else. Refresh and try
    // again."), so treating the phrase as a retry signal once made the
    // checkout classify its own fallback text as retryable.
    return /timeout|timed out|network|econnrefused|etimedout|econnreset|enotfound|connection|server error|unavailable|offline/i.test(
      lower,
    )
      ? 'retryable'
      : 'non-retryable';
  }

  switch (typed.kind) {
    case 'hardware': {
      const sub = (appErrorSubKind(typed) ?? '').toLowerCase();
      return RETRYABLE_HARDWARE.has(sub) ? 'retryable' : 'non-retryable';
    }
    case 'core': {
      const sub = (appErrorSubKind(typed) ?? '').toLowerCase();
      return RETRYABLE_CORE.has(sub) ? 'retryable' : 'non-retryable';
    }
    case 'invalid':
    case 'permissionDenied':
    case 'invalidSession':
    case 'internal':
    default:
      return 'non-retryable';
  }
}

// ── A call that cannot be made ──────────────────────────────────────────────

/**
 * The shapes the IPC boundary produces when the COMMAND it was handed does
 * not exist on this shell — Tauri rejects with
 * `Error invoking remote method 'x': Error: command x not found`, the
 * dev-mock and the contract tests use the shorter `command x not found` or
 * `not registered`, and the parity scripts print `is not registered in that
 * shell`. Every alternative NAMES the command or its handler, and that is
 * the discriminator: a domain miss arriving inside the very same wrapper
 * (`Error invoking 'get_product': product not found`, `tax rate 7 not found`)
 * is an ANSWER to a call that ran, not a capability this build lacks, and must
 * never be folded into this class.
 */
const UNASKABLE_COMMAND_RE = new RegExp(
  [
    '\\bcommand\\b[\\s\\S]{0,80}?\\b(?:not found|not registered|is not registered)\\b',
    '\\b(?:no such command|unknown command)\\b',
    '\\bno handler registered\\b',
    '\\bhandler\\b[\\s\\S]{0,60}?\\b(?:not found|not registered)\\b',
  ].join('|'),
  'i',
);

/** A thrown value's own text, for the three shapes an IPC rejection takes. */
function rejectionText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

/**
 * Did this failure mean the call could not even be sent?
 *
 * "The server did not answer" and "this build has no such command" both
 * arrive as a rejected promise, and the difference between them is the whole
 * fact an indicator exists to report: one is an outage worth re-asking, the
 * other is a permanent property of the binary, so re-asking it on a timer
 * produces load and no information. The verdict is deliberately NOT
 * re-derived here — `classifyRetry` above already marks a message naming
 * `not found` non-retryable, precisely because re-issuing the same call
 * cannot change the answer. This asks that verdict first and only then
 * checks that it is being carried by command-registry wording, so the two
 * rules cannot drift apart. Consequences worth naming: a genuine transport
 * throw (`econnrefused`, `timed out`) is retryable and stays a real outage,
 * and a typed business error never enters this class.
 *
 * THE KNOWN LIMIT, measured rather than assumed: `classifyRetry` searches the
 * message by SUBSTRING, so a command whose own NAME carries a transport word —
 * `test_auth_connection` contains `connection` — is judged retryable whenever
 * the message adds no terminal word, and this predicate then refuses it. A
 * bare `No handler registered for 'test_auth_connection'` is exactly that
 * shape and stays a red, retried outage. Every form the boundary ACTUALLY
 * prints for a missing command (`Error invoking remote method 'x': Error:
 * command x not found`, and the parity scripts' `is not registered in that
 * shell` phrasing aside) names `not found`, which the terminal branch reads
 * first, so the tablet case is caught. The bias is deliberate and one-way: a
 * false UNKNOWN would silence a real outage, while a false RED only preserves
 * the behaviour the shell has today.
 */
export function isUnaskableCommandError(err: unknown): boolean {
  if (classifyRetry(err) !== 'non-retryable') return false;
  return UNASKABLE_COMMAND_RE.test(rejectionText(err));
}

// ── User-safe copy ─────────────────────────────────────────────────

/**
 * Map a typed error to the FTL key for its localized user-safe copy.
 *
 * The raw backend message is NEVER returned here — internal details only
 * exist in the redacted diagnostic.
 */
export function userErrorKey(err: AppError | unknown): string {
  const typed = parseAppError(err);
  if (!typed) return 'app-error-generic';

  switch (typed.kind) {
    case 'invalid':
      return 'app-error-validation';
    case 'permissionDenied':
      return 'app-error-permission';
    case 'invalidSession':
      return 'app-error-session';
    case 'core': {
      const sub = (appErrorSubKind(typed) ?? '').toLowerCase();
      if (sub === 'conflict') return 'app-error-conflict';
      if (sub === 'notfound') return 'app-error-not-found';
      if (sub === 'validation') return 'app-error-validation';
      if (sub === 'subscriptionlimitexceeded' || sub === 'invalidsubscriptionsignature') {
        return 'app-error-subscription';
      }
      return 'app-error-generic';
    }
    case 'hardware':
      return 'app-error-hardware';
    case 'internal':
    default:
      return 'app-error-generic';
  }
}

/** English fallbacks for every user-safe key (localized bundles carry the real copy). */
export const USER_ERROR_FALLBACKS: Record<string, string> = {
  'app-error-generic': 'Something went wrong. Please try again.',
  'app-error-validation': 'Please check the information you entered and try again.',
  'app-error-permission': "You don't have permission to do this.",
  'app-error-session': 'Your session has expired. Please sign in again.',
  'app-error-conflict': 'This record was changed by someone else. Refresh and try again.',
  'app-error-not-found': 'The requested item could not be found.',
  'app-error-offline': 'You appear to be offline. Check your connection and try again.',
  'app-error-hardware': 'A hardware device did not respond. Check it and try again.',
  'app-error-subscription': 'This action is not included in your current plan.',
};

/**
 * Adapter so screens can pass their Fluent `l10n` directly:
 * `userErrorMessage(err, fluentErrorGetter(l10n))`.
 * Fluent's `getString(id, args?, fallback?)` takes the fallback in the third
 * slot, which is awkward at call sites — this bridges the two signatures.
 */
export function fluentErrorGetter(l10n: ReactLocalization) {
  return (key: string, fallback?: string): string => l10n.getString(key, null, fallback);
}

/**
 * Resolve the localized user-safe message for a thrown error.
 *
 * Typed `AppError`s always map to the shared `app-error-*` copy (validation,
 * permission, session, conflict, offline, hardware). Unrecognized values fall
 * back to `fallbackKey` — the screen's own localized message — so each screen
 * keeps its operational context while raw backend text never renders.
 */
export function userErrorMessage(
  err: AppError | unknown,
  getString: (key: string, fallback?: string) => string,
  fallbackKey = 'app-error-generic',
): string {
  const typed = parseAppError(err);
  if (!typed) {
    return getString(fallbackKey, USER_ERROR_FALLBACKS[fallbackKey] ?? USER_ERROR_FALLBACKS['app-error-generic']);
  }
  const key = userErrorKey(typed);
  return getString(key, USER_ERROR_FALLBACKS[key] ?? USER_ERROR_FALLBACKS['app-error-generic']);
}

/**
 * Convenience wrapper so a screen can pass its Fluent `l10n` object directly:
 * `l10nErrorMessage(err, l10n, 'audit-log-error-load')`.
 * Same semantics as `userErrorMessage` — one import instead of two.
 */
export function l10nErrorMessage(
  err: AppError | unknown,
  l10n: ReactLocalization,
  fallbackKey = 'app-error-generic',
): string {
  return userErrorMessage(err, fluentErrorGetter(l10n), fallbackKey);
}

/**
 * For non-Fluent contexts (hooks, plain modules): resolve the user-safe copy
 * from the shared English fallback map, or `fallback` when the key is unknown.
 * Typed `AppError`s still map to their user-safe copy, so raw backend text
 * never reaches a hook consumer either.
 */
export function plainErrorMessage(
  err: AppError | unknown,
  fallback: string = USER_ERROR_FALLBACKS['app-error-generic'] ?? 'Something went wrong. Please try again.',
): string {
  const typed = parseAppError(err);
  if (!typed) return fallback;
  return USER_ERROR_FALLBACKS[userErrorKey(typed)] ?? fallback;
}

// ── Diagnostic detail for toast copy-to-clipboard ─────────────────

/**
 * Extract a redacted diagnostic detail string from an error, suitable
 * for the toast `detail` field (copy-to-clipboard for support tickets).
 * Returns null when no useful detail can be extracted.
 */
export function errorDetail(err: unknown): string | null {
  const parts: string[] = [];
  const typed = parseAppError(err);
  if (typed) {
    parts.push(`Kind: ${typed.kind}`);
    if ('subKind' in typed && typed.subKind) parts.push(`SubKind: ${typed.subKind}`);
    if (typed.message) parts.push(`Server: ${redactDiagnostic(typed.message)}`);
  } else if (err instanceof Error) {
    parts.push(`Error: ${redactDiagnostic(err.message)}`);
    if (err.stack) {
      // Only include first 3 lines of stack (skip internal frames)
      const stackLines = err.stack.split('\n').slice(0, 4).join('\n');
      parts.push(`Stack: ${redactDiagnostic(stackLines)}`);
    }
  } else if (typeof err === 'string') {
    parts.push(`Error: ${redactDiagnostic(err)}`);
  } else if (err !== null && err !== undefined) {
    parts.push(`Error: ${String(err)}`);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

// ── Redaction & normalization ──────────────────────────────────────

/** Remove sensitive material from a diagnostic string (ERR-06). */
export function redactDiagnostic(input: string): string {
  return input
    // License keys: OZ-XXXX-… or UUIDs
    .replace(/\b(?:OZ|OZ-PRO)-[A-Z0-9-]{8,}\b/gi, 'REDACTED-LICENSE')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'REDACTED-UUID')
    // Stripe/sk_ live keys
    .replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, 'REDACTED-KEY')
    // Emails
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, 'REDACTED-EMAIL')
    // Absolute filesystem paths (Windows drive letters, UNC, Unix absolute)
    .replace(/([A-Za-z]:[\\/][^\s"']+|\\\\[\\/][^\s"']+|(?<!\w)\/[a-zA-Z][^\s"']*)/g, 'REDACTED-PATH')
    // Raw sqlite/SQL detail — only match after semicolons or at start (actual SQL statements)
    .replace(/(?:;\s*)\bsqlite\b[^;]{0,120}/gi, ';sqlite:REDACTED')
    // Hex blobs — with or without a 0x prefix (the prefix breaks the word
    // boundary the bare pattern relies on, so match both shapes).
    .replace(/\b0x[0-9a-f]{8,}\b/gi, 'REDACTED-HEX')
    .replace(/\b[0-9a-f]{16,}\b/gi, 'REDACTED-HEX');
}

/**
 * Produce a normalized, redacted, correlation-tagged error.
 * Never throws — always returns a usable object.
 */
export function normalizeError(err: unknown, correlationId?: string): NormalizedError {
  const typed = parseAppError(err);
  const rawMessage =
    typeof err === 'string' ? err : err instanceof Error ? err.message : JSON.stringify(err) ?? 'unknown error';
  const base: Omit<NormalizedError, 'subKind'> = {
    kind: typed?.kind ?? 'unknown',
    rawMessage,
    retryClass: classifyRetry(err),
    correlationId: withCorrelationId(err, correlationId),
    userKey: userErrorKey(err),
  };
  const subKind = typed ? appErrorSubKind(typed) : undefined;
  // exactOptionalPropertyTypes: never assign `undefined` to the optional
  // `subKind` — only attach the property when a value exists.
  return subKind !== undefined ? { ...base, subKind } : base;
}

/** One-line redacted diagnostic for logs/telemetry (ERR-06). */
export function redactedDiagnostic(err: unknown): string {
  const normalized = normalizeError(err);
  return `[${normalized.kind}${normalized.subKind ? `:${normalized.subKind}` : ''}]` +
    ` ${normalized.correlationId} retry=${normalized.retryClass} ${redactDiagnostic(normalized.rawMessage).slice(0, 200)}`;
}

// ── Structured IPC error events (ERR-06) ──────────────────────────

type IpcErrorListener = (event: { command: string; error: NormalizedError }) => void;

const ipcErrorListeners = new Set<IpcErrorListener>();

/**
 * Subscribe to normalized IPC failures. Returns an unsubscribe fn.
 * Telemetry/analytics layers can hook in without touching every caller.
 */
export function onIpcError(fn: IpcErrorListener): () => void {
  ipcErrorListeners.add(fn);
  return () => {
    ipcErrorListeners.delete(fn);
  };
}

/**
 * Normalize a thrown IPC error, notify subscribers, and return it.
 * Called once at the boundary (`loggedInvoke`) so every command failure
 * is classified + correlation-tagged exactly once.
 */
export function emitIpcError(command: string, err: unknown): NormalizedError {
  const normalized = normalizeError(err);
  for (const fn of [...ipcErrorListeners]) {
    try {
      fn({ command, error: normalized });
    } catch {
      // Listener isolation — a misbehaving subscriber must not break IPC.
    }
  }
  return normalized;
}
