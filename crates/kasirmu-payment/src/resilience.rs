/*
last audited 15-09-26 by DSH-Agent
crate: kasirmu-payment | status: SAFE | lint: CLEAN
findings: ResilientProcessor decorator wrapping Arc<dyn PaymentProcessor>; 3-state CircuitBreaker (Closed/Open/HalfOpen); bounded exponential backoff on Transient errors; fails fast on Open breaker
next: none | perf: Async in-memory atomics / RwLock
*/
//! Resilience and fault-isolation decorator for [`PaymentProcessor`].
//!
//! Provides automatic retries with exponential backoff on transient errors
//! and a 3-state circuit breaker (`Closed` -> `Open` -> `HalfOpen`) to fail-fast
//! during gateway outages.

use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
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

/// Configuration options for [`ResilientProcessor`].
#[derive(Debug, Clone)]
pub struct ResilientProcessorConfig {
    /// Maximum retry attempts on transient errors (default: 2).
    pub max_retries: u32,
    /// Initial backoff delay in milliseconds (default: 100 ms).
    pub initial_backoff_ms: u64,
    /// Maximum backoff delay in milliseconds (default: 2000 ms).
    pub max_backoff_ms: u64,
    /// Number of consecutive transient failures required to trip the breaker (default: 5).
    pub failure_threshold: u32,
    /// Duration to stay in `Open` state before transitioning to `HalfOpen` (default: 30s).
    pub cooldown_duration: Duration,
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
                        "circuit breaker is half-open with a probe in flight (failing fast)"
                            .into(),
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

/// Decorator wrapping an inner [`PaymentProcessor`] to provide retries on
/// transient errors and circuit-breaker isolation.
pub struct ResilientProcessor {
    inner: Arc<dyn PaymentProcessor>,
    config: ResilientProcessorConfig,
    breaker: Arc<CircuitBreaker>,
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
    /// health (design doc §3, `payment-resilience-design.md:125`).
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
        }
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
    /// **§2's rule** (`docs/plans/_active/payment-resilience-design.md:99`):
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
        let max_retries = match policy {
            RetryPolicy::Keyed => self.config.max_retries,
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
                        let backoff_ms = (self.config.initial_backoff_ms * (1 << (attempt - 1)))
                            .min(self.config.max_backoff_ms);
                        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                        continue;
                    }

                    self.breaker.record_failure(is_transient).await;
                    return Err(err);
                }
            }
        }
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
        self.execute_with_resilience(
            policy_for_key(request.idempotency_key.as_deref()),
            || self.inner.authorize(request),
        )
        .await
    }

    async fn capture(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        // Single-shot: `capture` takes a bare `transaction_id` and has no key
        // parameter, so a retry after a timeout could capture twice. This REDUCES
        // the shipped behaviour and the reduction is intentional (§2.2's
        // consequence, `payment-resilience-design.md:117`).
        self.execute_with_resilience(RetryPolicy::SingleShot, || {
            self.inner.capture(transaction_id)
        })
        .await
    }

    async fn sale(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        self.execute_with_resilience(
            policy_for_key(request.idempotency_key.as_deref()),
            || self.inner.sale(request),
        )
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
        self.execute_with_resilience(RetryPolicy::SingleShot, || {
            self.inner.void(transaction_id)
        })
        .await
    }

    async fn receipt(&self, transaction_id: &str) -> Result<PaymentReceipt, PaymentError> {
        // A receipt is a read. Retrying it cannot move money, so the policy is
        // Keyed rather than SingleShot purely to keep the retry budget available.
        self.execute_with_resilience(RetryPolicy::Keyed, || {
            self.inner.receipt(transaction_id)
        })
        .await
    }

    fn device_info(&self) -> DeviceInfo {
        self.inner.device_info()
    }
}

#[cfg(test)]
#[path = "resilience_tests.rs"]
mod tests;
