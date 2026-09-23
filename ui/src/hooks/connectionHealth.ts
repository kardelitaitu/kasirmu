/**
 * Shared connection-health vocabulary for the status indicators.
 *
 * Before this existed the same idea had three names: `AuthConnectionState`
 * and `SyncConnectionState` were structurally identical unions written out
 * twice, and `StatusBar` kept a third local `HealthState` with different
 * members (`online`/`offline` instead of `connected`/`disconnected`). Three
 * spellings of one concept is how a state gets handled in one indicator and
 * missed in the next.
 *
 * This mirrors `kasirmu_core::service_health::HealthState` on the Rust side. The
 * mapping is not one-to-one on purpose:
 *
 *   Rust `operational`  ->  `connected`
 *   Rust `degraded`     ->  `degraded`
 *   Rust `unavailable`  ->  `disconnected`
 *   Rust `unknown`      ->  `checking`
 *
 * `checking` is the UI's own pre-probe state and has no Rust counterpart —
 * a service is never reported `unknown` by a probe, because probing is what
 * ends the uncertainty. Keeping them distinct means "we have not asked yet"
 * can never be drawn the same colour as "we asked and got nothing back".
 *
 * `unconfigured` is likewise the UI's own state, and it exists for the same
 * reason one level down: the sync probe distinguishes "this device has no
 * server URL at all" (its `status` says so, `latency_ms` is absent) from "a
 * configured server did not answer". Before this member existed both answers
 * collapsed into `disconnected`, so a tablet that had never been configured
 * drew the same red pill as a server that was down — and read as a network
 * outage to the person debugging it.
 */

/** The health of a service as the indicators render it. */
export type ConnectionHealth =
  | 'checking'
  | 'connected'
  | 'degraded'
  | 'disconnected'
  | 'unconfigured';

/** Visual tone for an indicator dot. */
export type StatusTone = 'good' | 'warn' | 'bad' | 'checking';

/** Latency at or below which a connected service still reads as healthy. */
export const LATENCY_GOOD_MAX_MS = 999;

/** Latency at or below which a connected service reads as slow but working. */
export const LATENCY_WARN_MAX_MS = 2999;

/**
 * Map a health state plus the last measured latency onto a tone.
 *
 * `degraded` is `warn` and not `bad`, which is the whole point of adding it:
 * the service is answering and can still serve, so painting it red would
 * tell a cashier to stop using a till that is working. It is not `good`
 * either — something named is broken and support needs to see that.
 */
export function toneForHealth(state: ConnectionHealth, latencyMs: number | null): StatusTone {
  switch (state) {
    case 'checking':
      return 'checking';
    case 'degraded':
      return 'warn';
    case 'unconfigured':
      // NOT `bad`. Red says "the service you rely on has stopped answering",
      // and that is exactly the misreading this state removes: nothing was
      // ever set up, so there is no working service being reported as broken
      // and no outage to go looking for. It is not `good` either — sync is
      // genuinely not running and a green dot would hide that. `warn` is the
      // same answer `degraded` gets above, and for the same reason: draw the
      // operator's eye without telling them to stop trading.
      return 'warn';
    case 'disconnected':
      return 'bad';
    case 'connected':
      if (latencyMs === null) return 'bad';
      if (latencyMs <= LATENCY_GOOD_MAX_MS) return 'good';
      if (latencyMs <= LATENCY_WARN_MAX_MS) return 'warn';
      return 'bad';
  }
}

/**
 * Tone for probes that carry no latency reading — payment-gateway
 * configuration and device enumeration (saas-3 service pills). Their answer
 * is binary, so `connected` reads good; routing them through
 * `toneForHealth` would trip its "connected but unmeasured" bad branch,
 * which exists for latency probes that lost their round-trip figure.
 */
export function toneForBinaryHealth(state: ConnectionHealth): StatusTone {
  switch (state) {
    case 'checking':
      return 'checking';
    case 'degraded':
      return 'warn';
    case 'connected':
      return 'good';
    case 'unconfigured':
      // Same reasoning as `toneForHealth`: an unconfigured service is not a
      // failing one. This arm is what a payment pill would use the day it
      // stops folding "no gateway configured" into `disconnected`.
      return 'warn';
    case 'disconnected':
      return 'bad';
  }
}

/**
 * The wire form of `kasirmu_core::service_health::HealthState`, kept as a string
 * union rather than imported from Rust so the UI can be built against a
 * dev-mock. `fromWireHealth` is the single place that translates it.
 */
export type WireHealth = 'operational' | 'degraded' | 'unavailable' | 'unknown';

/**
 * The `status` string both shells' `test_sync_connection` answers when the
 * device has no sync server URL at all (mobile-tauri commands/sync.rs:123 and
 * :399, bridge sync.rs:422/483/518). It is the probe's OWN signal, which is
 * the only thing that separates "never configured" from "configured and
 * unreachable" — both arrive as `ok: false`.
 */
export const SYNC_NOT_CONFIGURED_STATUS = 'No server URL configured';

/**
 * True when a sync probe's answer means "this device was never configured"
 * rather than "the configured server did not answer".
 *
 * Matching the status string and not merely `ok === false` is the point: a
 * real ping failure also answers `ok: false` with no latency (`ping_server`'s
 * transport-error and sync-http-disabled branches both carry `latency_ms:
 * None`), so a latency test alone would relabel genuine outages as
 * configuration gaps — the same class of lie in the opposite direction.
 */
export function isSyncUnconfigured(status: string, ok: boolean): boolean {
  return !ok && status === SYNC_NOT_CONFIGURED_STATUS;
}

/**
 * Translate a probe's health field into an indicator state.
 *
 * `undefined` and unrecognised values fall back to the reachability answer
 * rather than to a guess at health. A desktop build older than this field
 * sends no `state` at all, and inventing `operational` there would report
 * health we never measured.
 */
export function fromWireHealth(
  state: WireHealth | string | undefined,
  ok: boolean,
): ConnectionHealth {
  switch (state) {
    case 'operational':
      return 'connected';
    case 'degraded':
      return 'degraded';
    case 'unavailable':
      return 'disconnected';
    case 'unknown':
      return 'checking';
    default:
      return ok ? 'connected' : 'disconnected';
  }
}
