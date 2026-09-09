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
 * This mirrors `oz_core::service_health::HealthState` on the Rust side. The
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
 */

/** The health of a service as the indicators render it. */
export type ConnectionHealth = 'checking' | 'connected' | 'degraded' | 'disconnected';

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
    case 'disconnected':
      return 'bad';
  }
}

/**
 * The wire form of `oz_core::service_health::HealthState`, kept as a string
 * union rather than imported from Rust so the UI can be built against a
 * dev-mock. `fromWireHealth` is the single place that translates it.
 */
export type WireHealth = 'operational' | 'degraded' | 'unavailable' | 'unknown';

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
