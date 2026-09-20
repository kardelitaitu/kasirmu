import { getSetupStatus } from '@/api/settings';
import { hasUsers } from '@/api/staff';

/**
 * Boot-gate read recovery for lost IPC responses.
 *
 * Measured on the Android tablet build (2026-09-20, debug APK, fresh
 * install): invokes issued while the Rust backend was still applying
 * migrations resolved on the Rust side but their responses never reached
 * the WebView — the pending promise never settled, rejected, or errored.
 * The shell's boot gate hung on `Loading…` forever, and the only recovery
 * was killing the app. A later invoke on the same page resolved instantly,
 * so the drop is tied to the backend-init window, not to a dead channel.
 *
 * The defence is therefore not error handling — there is no error — but a
 * bounded timeout-and-retry around each boot read: if the promise is still
 * silent after `timeoutMs`, re-issue it. Re-issuing is safe: every read the
 * gate makes (`get_setup_status`, `has_users`) is a pure pre-auth query.
 *
 * `bootRetryConfig` is a mutable object rather than constants so tests can
 * shrink the windows; ESM live bindings would make bare consts unpatchable.
 */
export const bootRetryConfig = { attempts: 4, timeoutMs: 5000 };

/** A settled boot read: the value, or "the read never answered". */
export type BootReadResult<T> = { ok: true; value: T } | { ok: false };

/**
 * Run one boot read with the lost-response retry above.
 *
 * A rejection also lands on `{ ok: false }` — callers map it to their own
 * failure semantics (the tablet shell pins a failed setup read to "show the
 * wizard", and a failed has_users read to "unknown → login"). Note the
 * losing `fn()` promise is intentionally left running: a late resolution is
 * harmless (the caller has already moved on) and there is no cancellation
 * channel to reach through.
 */
export async function readWithRetry<T>(fn: () => Promise<T>): Promise<BootReadResult<T>> {
  for (let attempt = 1; attempt <= bootRetryConfig.attempts; attempt++) {
    const outcome = await Promise.race([
      fn()
        .then((value) => ({ ok: true as const, value }))
        .catch(() => ({ ok: false as const })),
      new Promise<{ ok: false }>((resolve) =>
        setTimeout(() => resolve({ ok: false }), bootRetryConfig.timeoutMs),
      ),
    ]);
    if (outcome.ok) return outcome;
  }
  return { ok: false };
}

/**
 * The two reads the tablet shell's boot gate makes, run in parallel with
 * independent verdicts — one read's failure cannot forge the other's answer.
 */
export function readBootGate() {
  return Promise.all([readWithRetry(getSetupStatus), readWithRetry(hasUsers)]);
}
