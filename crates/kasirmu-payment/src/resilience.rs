/*
last audited 22-10-26 by DSH-Agent
crate: kasirmu-payment | status: SAFE | lint: CLEAN
findings: ResilientProcessor decorator wrapping Arc<dyn PaymentProcessor>; 3-state CircuitBreaker (Closed/Open/HalfOpen); FULL-JITTER exponential backoff on Transient errors (O-M45), max_retries clamped to MAX_RETRIES at every config boundary; fails fast on Open breaker
next: none | perf: Async in-memory atomics / RwLock
*/
//! Resilience and fault-isolation decorator for [`PaymentProcessor`].
//!
//! Provides automatic retries with exponential backoff on transient errors
//! and a 3-state circuit breaker (`Closed` -> `Open` -> `HalfOpen`) to fail-fast
//! during gateway outages.
//!
//! The backoff is **full jitter** (AWS): the sleep before retry *n* is drawn
//! uniformly from `[0, initial_backoff_ms * 2^(n-1)]` and then clamped to
//! `max_backoff_ms`, so a fleet of terminals that fails together does not retry
//! together — and the window keeps widening with *n* instead of freezing at the
//! cap. `max_retries` is clamped to [`MAX_RETRIES`] at every config boundary,
//! which is also what keeps the doubling well inside `u64`.

use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use rand::Rng;
use tokio::sync::RwLock;

use crate::error::{ErrorClass, PaymentError};
use crate::processor::PaymentProcessor;
use crate::types::{PaymentReceipt, PaymentRequest, PaymentResult};
use foundation::Money;
use kasirmu_hal::types::DeviceInfo;

/// State of the circuit breaker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    /// Normal operation: requests pass through.
    Closed,
    /// Gateway is down: requests fail fast immediately.
    Open,
    /// Testing if gateway recovered: trial requests permitted.
    HalfOpen,
}

/// Hard ceiling on [`ResilientProcessorConfig::max_retries`] (O-M45).
///
/// `max_retries` feeds the backoff doubling below, so an unbounded value is not a
/// tuning knob but a way to make the retry path panic: `1 << (attempt - 1)` on a
/// `u64` shifts by >= 64 and traps in any build with overflow checks, which the
/// workspace sets for `release` too (`Cargo.toml` `[profile.release]
/// overflow-checks = true`). The ledger measured the multiply as the real
/// overflow (`todo-optimize-crates.md:1172`) — `initial_backoff_ms * 2^n` leaves
/// `u64` around attempt 58 at the 100 ms default — but the shift is the same
/// arithmetic in a second place, so both are clamped here rather than reasoned
/// about separately.
///
/// **Why 8 and not the arithmetic floor of 31/58.** The shift only needs the
/// exponent to stay under 64, so arithmetic alone would allow far more. The
/// ceiling is set by what a retry is FOR in this crate: every retry carries a
/// caller-supplied gateway key, so it is safe to repeat — but it is still another
/// round trip against a gateway that has already failed *n* times, and at the
/// default 100 ms base the full schedule is 100 + 200 + 400 + 800 + 1600 + 2000 +
/// 2000 + 2000 ms = **9.1 s** of sleeping before the error surfaces to a cashier
/// at a till. 8 retries is 9 attempts, which is already generous for a payment
/// gateway hiccup; past that the terminal is better served by failing fast and
/// letting the circuit breaker open than by holding a customer's card for tens of
/// seconds. The default stays 2 (300 ms total), so this ceiling only ever bites a
/// value someone deliberately typed.
pub const MAX_RETRIES: u32 = 8;

/// Configuration options for [`ResilientProcessor`].
#[derive(Debug, Clone)]
pub struct ResilientProcessorConfig {
    /// Maximum retry attempts on transient errors (default: 2).
    ///
    /// Clamped to [`MAX_RETRIES`] when the config is built through
    /// [`ResilientProcessorConfig::new`]; a value assigned directly onto a struct
    /// literal is re-clamped at the point of use.
    pub max_retries: u32,
    /// Initial backoff delay in milliseconds (default: 100 ms).
    pub initial_backoff_ms: u64,
    /// Maximum backoff delay in milliseconds (default: 2000 ms).
    ///
    /// This is the CEILING ON THE DRAWN SLEEP. The jitter source is handed the
    /// uncapped exponential `initial_backoff_ms * 2^(attempt-1)` (so the window
    /// keeps widening with every attempt) and the value it returns is clamped to
    /// this before the sleep, so no retry — jittered or otherwise — waits longer
    /// than this. See `ResilientProcessor::jittered_backoff_ms` for why the cap
    /// belongs on the result rather than on the window.
    pub max_backoff_ms: u64,
    /// Number of consecutive transient failures required to trip the breaker (default: 5).
    pub failure_threshold: u32,
    /// Duration to stay in `Open` state before transitioning to `HalfOpen` (default: 30s).
    pub cooldown_duration: Duration,
}

impl ResilientProcessorConfig {
    /// Build a config with `max_retries` already clamped to [`MAX_RETRIES`].
    ///
    /// This is the O-M45 clamp at CONSTRUCTION: a value above the ceiling cannot
    /// be held by a config that came through here, so the retry loop can rely on
    /// its budget without re-deriving it. Values at or below the ceiling are
    /// taken as-is, including 0 (no retries).
    ///
    /// Prefer this over a struct literal whenever a caller configures retries, so
    /// an out-of-range value is corrected once, at the door.
    #[must_use]
    pub fn new(max_retries: u32) -> Self {
        Self {
            max_retries: max_retries.min(MAX_RETRIES),
            ..Self::default()
        }
    }

    /// The retry budget actually in force, clamped to [`MAX_RETRIES`].
    ///
    /// A config built by struct literal or by `..Default::default()` can still
    /// carry a raw `max_retries` (the field is public and a `Debug`/`Clone`
    /// config can round-trip through serde or a caller's own struct), so the
    /// retry loop reads its budget through here rather than through the field.
    /// The clamp is idempotent, so this is safe on a config already built by
    /// [`Self::new`].
    #[must_use]
    pub fn retry_budget(&self) -> u32 {
        self.max_retries.min(MAX_RETRIES)
    }
}

impl Default for ResilientProcessorConfig {
    fn default() -> Self {
        Self {
            max_retries: 2,
            initial_backoff_ms: 100,
            max_backoff_ms: 2000,
            failure_threshold: 5,
            cooldown_duration: Duration::from_secs(30),
        }
    }
}

#[derive(Debug)]
struct BreakerInternal {
    state: CircuitState,
    consecutive_failures: u32,
    opened_at: Option<Instant>,
    /// Whether a `HalfOpen` trial is currently in flight (design doc §5).
    ///
    /// Without this, EVERY caller admitted after the cooldown elapses becomes a
    /// trial: the open-to-half-open transition happens on a time check inside
    /// [`CircuitBreaker::state`], so all concurrent callers see `HalfOpen` at once.
    probe_in_flight: bool,
}

/// Circuit breaker tracking consecutive failures and managing state transitions.
#[derive(Debug)]
pub struct CircuitBreaker {
    failure_threshold: u32,
    cooldown_duration: Duration,
    inner: RwLock<BreakerInternal>,
}

impl CircuitBreaker {
    /// Create a new circuit breaker with threshold and cooldown duration.
    #[must_use]
    pub fn new(failure_threshold: u32, cooldown_duration: Duration) -> Self {
        Self {
            failure_threshold,
            cooldown_duration,
            inner: RwLock::new(BreakerInternal {
                state: CircuitState::Closed,
                consecutive_failures: 0,
                opened_at: None,
                probe_in_flight: false,
            }),
        }
    }

    /// Current state of the breaker (transitions `Open` -> `HalfOpen` if cooldown expired).
    pub async fn state(&self) -> CircuitState {
        let mut guard = self.inner.write().await;
        if guard.state == CircuitState::Open
            && guard
                .opened_at
                .is_some_and(|opened| opened.elapsed() >= self.cooldown_duration)
        {
            guard.state = CircuitState::HalfOpen;
        }
        guard.state
    }

    /// Check if a request should be allowed.
    ///
    /// **`HalfOpen` admits exactly ONE probe** (design doc §5). The state check and
    /// the claim happen under one write lock, so two callers arriving together
    /// cannot both take it: the first sets `probe_in_flight` and proceeds, every
    /// other fails fast until the probe resolves through
    /// [`Self::record_success`] or [`Self::record_failure`].
    ///
    /// This was `Ok(())` for `HalfOpen` unconditionally, which meant that the moment
    /// a cooldown elapsed every concurrent caller became a trial — a thundering herd
    /// against a gateway that had just come back, which is how a half-open breaker
    /// turns one outage into two. Measured before the fix: 20 concurrent callers, 20
    /// admitted.
    ///
    /// # Errors
    ///
    /// Returns [`PaymentError::Network`] when the breaker is `Open`, and when it is
    /// `HalfOpen` with a probe already in flight — the caller should fail fast in
    /// both cases, and the error text says which.
    pub async fn allow_request(&self) -> Result<(), PaymentError> {
        let mut guard = self.inner.write().await;
        // Transition Open -> HalfOpen here rather than through `state()`, so the
        // transition and the probe claim are one atomic step.
        if guard.state == CircuitState::Open
            && guard
                .opened_at
                .is_some_and(|opened| opened.elapsed() >= self.cooldown_duration)
        {
            guard.state = CircuitState::HalfOpen;
            guard.probe_in_flight = false;
        }
        match guard.state {
            CircuitState::Closed => Ok(()),
            CircuitState::HalfOpen => {
                if guard.probe_in_flight {
                    return Err(PaymentError::Network(
                        "circuit breaker is half-open with a probe in flight (failing fast)".into(),
                    ));
                }
                guard.probe_in_flight = true;
                Ok(())
            }
            CircuitState::Open => Err(PaymentError::Network(
                "circuit breaker is open (gateway unavailable, failing fast)".into(),
            )),
        }
    }

    /// Record a successful call.
    ///
    /// A success settles a `HalfOpen` probe by CLOSING the breaker, and clears the
    /// in-flight flag so the next cooldown can admit a fresh probe (§5).
    pub async fn record_success(&self) {
        let mut guard = self.inner.write().await;
        guard.consecutive_failures = 0;
        guard.state = CircuitState::Closed;
        guard.opened_at = None;
        guard.probe_in_flight = false;
    }

    /// Record a failure.
    ///
    /// A transient failure that reaches the threshold re-OPENS the breaker, which
    /// also ends any `HalfOpen` probe in flight — the probe failed, so the next
    /// caller must fail fast rather than be handed a second trial (§5).
    ///
    /// A non-transient failure returns early, deliberately: a card decline is not
    /// gateway ill-health, and it must not move the breaker or settle a probe. The
    /// probe that receives one stays in flight, so the caller that owns the probe
    /// still decides its outcome.
    pub async fn record_failure(&self, is_transient: bool) {
        if !is_transient {
            return;
        }
        let mut guard = self.inner.write().await;
        guard.consecutive_failures = guard.consecutive_failures.saturating_add(1);
        if guard.consecutive_failures >= self.failure_threshold {
            guard.state = CircuitState::Open;
            guard.opened_at = Some(Instant::now());
            guard.probe_in_flight = false;
        }
    }
}

/// Whether a money-moving operation may be retried when it fails transiently.
///
/// See `ResilientProcessor::execute_with_resilience` for the rule this encodes.
/// The variants are deliberately not `Default`-able: a call site must say which
/// it is, because the wrong default here is a silent double charge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryPolicy {
    /// The operation carries a caller-supplied gateway key, so the gateway can
    /// dedupe a repeat. Safe to retry within the configured budget.
    Keyed,
    /// The operation carries no key, or has no key parameter at all. Forwarded
    /// exactly once; the error is surfaced unchanged.
    SingleShot,
}

/// Source of the random draw used for backoff jitter (O-M45).
///
/// A closure rather than a bare `Rng` so a test can install a deterministic
/// sequence of draws and assert the EXACT sleep the retry loop chose. The
/// production implementation draws from a thread-local `rand` generator, seeded
/// by the OS, exactly as the crate's other random work does.
///
/// The closure returns a `u64` in `[0, bound]`; the bound is the already-capped
/// exponential window, so the returned value is the sleep in milliseconds and
/// can never exceed [`ResilientProcessorConfig::max_backoff_ms`].
pub type JitterFn = Box<dyn Fn(u64) -> u64 + Send + Sync + 'static>;

/// The production jitter source: a uniform draw from the thread-local RNG.
///
/// `rand::thread_rng()` is the same source the sync daemon and the image-refs
/// backoff already use (`platform/sync/src/daemon.rs:61`,
/// `crates/kasirmu-core/src/db/image_refs.rs:263`), so this crate needs no new
/// dependency and follows the established convention.
fn os_jitter(bound: u64) -> u64 {
    // `bound == 0` is the degenerate window (a zero initial backoff): there is
    // nothing to draw, and `gen_range(0..=0)` would be a needless RNG call.
    if bound == 0 {
        return 0;
    }
    rand::thread_rng().gen_range(0..=bound)
}

/// Decorator wrapping an inner [`PaymentProcessor`] to provide retries on
/// transient errors and circuit-breaker isolation.
pub struct ResilientProcessor {
    inner: Arc<dyn PaymentProcessor>,
    config: ResilientProcessorConfig,
    breaker: Arc<CircuitBreaker>,
    /// Injectable jitter source. Defaults to [`os_jitter`]; tests replace it with
    /// a deterministic closure via [`Self::with_jitter`].
    jitter: JitterFn,
}

impl ResilientProcessor {
    /// Create a new resilient processor wrapping `inner` with default config.
    #[must_use]
    pub fn new(inner: Arc<dyn PaymentProcessor>) -> Self {
        Self::with_config(inner, ResilientProcessorConfig::default())
    }

    /// Create a new resilient processor with custom configuration.
    ///
    /// Builds its OWN breaker. Two decorators made this way have two independent
    /// breakers even when they front the same gateway — use
    /// [`Self::with_shared_breaker`] when they must agree about that gateway's
    /// health (design doc §3, `docs/plans/_done/done-plan-payment-resilience-design.md:127`).
    #[must_use]
    pub fn with_config(inner: Arc<dyn PaymentProcessor>, config: ResilientProcessorConfig) -> Self {
        let breaker = CircuitBreaker::new(config.failure_threshold, config.cooldown_duration);
        Self::with_shared_breaker(inner, config, Arc::new(breaker))
    }

    /// Wrap `inner` with a breaker the CALLER supplies and owns.
    ///
    /// **This is the seam §4 needs, added without deciding §4's question.** The doc
    /// names one API change as the thing actively preventing the right design:
    /// *"`ResilientProcessor::with_config` constructs its breaker internally, so the
    /// breaker cannot be shared or keyed as written"* (`:161`). Splitting the
    /// constructor removes that obstacle while leaving the KEY entirely to the
    /// caller — whichever map shape §4 settles on (per gateway, per
    /// `(tenant, gateway)`, or something else), it is built outside this type and
    /// handed in here. Nothing in this crate has to change to adopt it.
    ///
    /// The config's `failure_threshold` and `cooldown_duration` are ignored on this
    /// path: a breaker that is shared cannot read its thresholds from two decorators
    /// at once, and silently applying one caller's config to another's breaker is
    /// exactly the kind of quiet divergence this seam exists to prevent. They are
    /// the shared breaker's own, fixed at its construction.
    #[must_use]
    pub fn with_shared_breaker(
        inner: Arc<dyn PaymentProcessor>,
        config: ResilientProcessorConfig,
        breaker: Arc<CircuitBreaker>,
    ) -> Self {
        Self {
            inner,
            config,
            breaker,
            jitter: Box::new(os_jitter),
        }
    }

    /// Replace the backoff jitter source (O-M45's determinism seam).
    ///
    /// `jitter` receives the capped exponential window in milliseconds and must
    /// return a value in `[0, window]`; the retry loop sleeps exactly that long.
    /// A test supplies a closure returning known values so it can assert the
    /// exact sleep per attempt; production leaves the default [`os_jitter`].
    ///
    /// The return is `Self` so this chains after any constructor:
    /// `ResilientProcessor::with_config(inner, cfg).with_jitter(Box::new(|_| 0))`.
    /// Nothing outside the jitter draw changes — attempts, classification, the
    /// breaker calls and the [`RetryPolicy`] split are all untouched.
    #[must_use]
    pub fn with_jitter(mut self, jitter: JitterFn) -> Self {
        self.jitter = jitter;
        self
    }

    /// Reference to the underlying circuit breaker.
    ///
    /// Returns the SHARED handle, so a caller that supplied one can observe the
    /// state both decorators are acting on rather than a private copy.
    #[must_use]
    pub fn breaker(&self) -> &Arc<CircuitBreaker> {
        &self.breaker
    }

    /// Reference to the inner payment processor.
    #[must_use]
    pub fn inner(&self) -> &Arc<dyn PaymentProcessor> {
        &self.inner
    }

    /// Run `operation` under the breaker, retrying **only when it is safe to**.
    ///
    /// **§2's rule** (`docs/plans/_done/done-plan-payment-resilience-design.md:99`):
    ///
    /// > `ResilientProcessor` may retry a money-moving operation **only when that
    /// > operation carries a caller-supplied gateway key**. With no key it forwards
    /// > the call **once** and surfaces the error unchanged.
    ///
    /// The reason is that a `Transient` error is precisely the class where the
    /// request *may have reached the gateway* — a timeout, a dropped connection, a
    /// 502 after the gateway committed. Without a key the driver mints a fresh one
    /// per call (`drivers/qris.rs:338-352`, `drivers/square.rs:341`), so the second
    /// attempt is a SECOND CHARGE rather than a repeat of the first. Retrying it is
    /// not resilience; it is double-billing with a retry's reputation.
    ///
    /// Measured before this guard: a keyless `authorize` against a transient failure
    /// reached the driver **4 times**.
    ///
    /// # The reduction, named rather than discovered later
    ///
    /// `capture` and `void` take a bare `transaction_id` and carry no key parameter,
    /// so under this rule they are always single-shot. That **reduces** the
    /// shipped behaviour — the doc calls it out at `:117` — and it is the honest
    /// reading: a capture retried without a key can double-capture.
    async fn execute_with_resilience<T, F, Fut>(
        &self,
        policy: RetryPolicy,
        operation: F,
    ) -> Result<T, PaymentError>
    where
        F: Fn() -> Fut,
        Fut: Future<Output = Result<T, PaymentError>>,
    {
        self.breaker.allow_request().await?;
        // A single-shot operation gets exactly one attempt: no retry budget is
        // consulted, so the error the driver returned is the error the caller sees.
        // `retry_budget()` re-clamps to MAX_RETRIES at the point of use: the field is
        // public, so a struct literal can bypass `ResilientProcessorConfig::new`.
        // Clamping here as well as at construction is what makes the shift's
        // safety a property of this loop rather than of every caller.
        let max_retries = match policy {
            RetryPolicy::Keyed => self.config.retry_budget(),
            RetryPolicy::SingleShot => 0,
        };

        let mut attempt = 0;
        loop {
            match operation().await {
                Ok(val) => {
                    self.breaker.record_success().await;
                    return Ok(val);
                }
                Err(err) => {
                    let class = err.classify();
                    let is_transient = class == ErrorClass::Transient;

                    if is_transient && attempt < max_retries {
                        attempt += 1;
                        let sleep_ms = self.jittered_backoff_ms(attempt);
                        tokio::time::sleep(Duration::from_millis(sleep_ms)).await;
                        continue;
                    }

                    self.breaker.record_failure(is_transient).await;
                    return Err(err);
                }
            }
        }
    }

    /// The sleep, in milliseconds, before retry number `attempt` (1-based).
    ///
    /// Two properties O-M45 turns on:
    ///
    /// 1. **Full jitter over a window that keeps growing.** The jitter source is
    ///    handed the UNCAPPED exponential `initial_backoff_ms * 2^(attempt-1)` and
    ///    the draw is capped only afterwards:
    ///    `sleep = min(max_backoff_ms, draw(initial * 2^(attempt-1)))`. Full jitter
    ///    rather than the narrower equal-jitter (`window/2 + U[0, window/2]`) or
    ///    decorrelated variants because it is the strongest of the standard
    ///    schemes at exactly the failure this exists for: every terminal in a
    ///    fleet retries on the same beat, so a gateway hiccup becomes a
    ///    synchronised reconnect storm. Full jitter spreads the retries over the
    ///    whole window, including "retry almost immediately", which is what lets
    ///    the fleet drain a transient blip fast instead of all waiting out a
    ///    shared delay and colliding on the far side of it.
    /// 2. **Never above the ceiling.** Whatever the source returns is clamped to
    ///    `max_backoff_ms` on the way out, so no sleep can exceed the configured
    ///    ceiling even if the source ignores its bound.
    ///
    /// **Why the cap goes on the RESULT and not on the window.** Capping the
    /// window first (`min(max, initial * 2^n)`) is the obvious-looking order and
    /// it quietly destroys the exponential: once `initial * 2^n` passes the cap,
    /// every later attempt is handed the SAME bound, so `min(400, 300)` and
    /// `min(800, 300)` both read `300` and the loop can no longer tell whether the
    /// doubling is happening at all. That is not exponential backoff with jitter,
    /// it is a fixed-width window with jitter. Capping the result instead keeps
    /// the window growing — a source that returns its bound keeps spreading wider
    /// as `n` grows — while the sleep still never exceeds the ceiling.
    ///
    /// The arithmetic is saturating in both directions on purpose. `1u64 <<
    /// (attempt - 1)` traps for `attempt >= 65`, and `initial * 2^n` leaves `u64`
    /// around attempt 58 at the 100 ms default (`todo-optimize-crates.md:1172`).
    /// [`MAX_RETRIES`] already keeps `attempt` at 8 or below on any config, but a
    /// panic in the retry path is the worst possible failure mode and costs one
    /// `saturating_mul` to make unreachable twice over rather than once.
    fn jittered_backoff_ms(&self, attempt: u32) -> u64 {
        let exponential = self
            .config
            .initial_backoff_ms
            .saturating_mul(1u64 << attempt.saturating_sub(1).min(63));
        let drawn = (self.jitter)(exponential);
        drawn.min(self.config.max_backoff_ms)
    }
}

/// The retry policy for a key-carrying request: retry only when the caller
/// supplied a gateway key.
fn policy_for_key(key: Option<&str>) -> RetryPolicy {
    match key {
        Some(k) if !k.trim().is_empty() => RetryPolicy::Keyed,
        // Blank is treated as absent: `Some("")` reaches the driver, which
        // sanitises to an empty `order_id` and mints a fresh one — the same
        // keyless hazard as `None`, so it must not be retried either.
        _ => RetryPolicy::SingleShot,
    }
}

#[async_trait]
impl PaymentProcessor for ResilientProcessor {
    async fn authorize(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        self.execute_with_resilience(policy_for_key(request.idempotency_key.as_deref()), || {
            self.inner.authorize(request)
        })
        .await
    }

    async fn capture(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        // Single-shot: `capture` takes a bare `transaction_id` and has no key
        // parameter, so a retry after a timeout could capture twice. This REDUCES
        // the shipped behaviour and the reduction is intentional (§2.2's
        // consequence, `docs/plans/_done/done-plan-payment-resilience-design.md:118`).
        self.execute_with_resilience(RetryPolicy::SingleShot, || {
            self.inner.capture(transaction_id)
        })
        .await
    }

    async fn sale(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        self.execute_with_resilience(policy_for_key(request.idempotency_key.as_deref()), || {
            self.inner.sale(request)
        })
        .await
    }

    async fn refund(
        &self,
        transaction_id: &str,
        amount: Option<Money>,
        idempotency_key: Option<&str>,
    ) -> Result<PaymentResult, PaymentError> {
        self.execute_with_resilience(policy_for_key(idempotency_key), || {
            self.inner.refund(transaction_id, amount, idempotency_key)
        })
        .await
    }

    async fn void(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        // Single-shot for the same reason as `capture`: no key parameter exists.
        self.execute_with_resilience(RetryPolicy::SingleShot, || self.inner.void(transaction_id))
            .await
    }

    async fn receipt(&self, transaction_id: &str) -> Result<PaymentReceipt, PaymentError> {
        // A receipt is a read. Retrying it cannot move money, so the policy is
        // Keyed rather than SingleShot purely to keep the retry budget available.
        self.execute_with_resilience(RetryPolicy::Keyed, || self.inner.receipt(transaction_id))
            .await
    }

    fn device_info(&self) -> DeviceInfo {
        self.inner.device_info()
    }
}

#[cfg(test)]
#[path = "resilience_tests.rs"]
mod tests;
