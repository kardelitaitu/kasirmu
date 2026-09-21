import { getLicenseStatus, type LicenseStatusDto } from '@/api/license';
import { getFirstRunState, type FirstRunState } from '@/api/settings';
import { hasUsers, type HasUsersResult } from '@/api/staff';
import { getDeviceId } from '@/api/system';

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
 * silent after `timeoutMs`, re-issue it. Re-issuing is safe in BOTH directions
 * here: `get_first_run_state` and `has_users` are pure pre-auth queries, and the
 * first is idempotent by construction (ADR #56 §2.2) so a re-issue cannot mint a
 * second owner or terminal.
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
 * failure semantics (the tablet shell pins a failed first-run read to "show the
 * provisioning flow", and a failed has_users read to "unknown → login"). Note the
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
 * The three reads the tablet shell's boot gate makes, run in parallel with
 * independent verdicts — one read's failure cannot forge the other's answer.
 *
 * ADR #56 §5 Q2: includes licence status so tablet converges on desktop's
 * activation-first boot ladder.
 *
 * The first-run read needs the device id first, and that lookup is INSIDE the
 * retried thunk so a dropped `get_device_id` response is retried with it rather
 * than resolving the pair to a terminal id nobody could read.
 */
export function readBootGate() {
  const firstRun = () =>
    getDeviceId().then((terminalId) => getFirstRunState(terminalId));
  return Promise.all([
    readWithRetry<LicenseStatusDto>(getLicenseStatus),
    readWithRetry<FirstRunState>(firstRun),
    readWithRetry<HasUsersResult>(hasUsers),
  ]);
}
