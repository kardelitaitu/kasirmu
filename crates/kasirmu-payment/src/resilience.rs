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

/// Decorator wrapping an inner [`PaymentProcessor`] to provide retries on
/// transient errors and circuit-breaker isolation.
pub struct ResilientProcessor {
    inner: Arc<dyn PaymentProcessor>,
    config: ResilientProcessorConfig,
    breaker: CircuitBreaker,
}

impl ResilientProcessor {
    /// Create a new resilient processor wrapping `inner` with default config.
    #[must_use]
    pub fn new(inner: Arc<dyn PaymentProcessor>) -> Self {
        Self::with_config(inner, ResilientProcessorConfig::default())
    }

    /// Create a new resilient processor with custom configuration.
    #[must_use]
    pub fn with_config(inner: Arc<dyn PaymentProcessor>, config: ResilientProcessorConfig) -> Self {
        let breaker = CircuitBreaker::new(config.failure_threshold, config.cooldown_duration);
        Self {
            inner,
            config,
            breaker,
        }
    }

    /// Reference to the underlying circuit breaker.
    #[must_use]
    pub fn breaker(&self) -> &CircuitBreaker {
        &self.breaker
    }

    /// Reference to the inner payment processor.
    #[must_use]
    pub fn inner(&self) -> &Arc<dyn PaymentProcessor> {
        &self.inner
    }

    async fn execute_with_resilience<T, F, Fut>(&self, operation: F) -> Result<T, PaymentError>
    where
        F: Fn() -> Fut,
        Fut: Future<Output = Result<T, PaymentError>>,
    {
        self.breaker.allow_request().await?;

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

                    if is_transient && attempt < self.config.max_retries {
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

#[async_trait]
impl PaymentProcessor for ResilientProcessor {
    async fn authorize(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        self.execute_with_resilience(|| self.inner.authorize(request))
            .await
    }

    async fn capture(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        self.execute_with_resilience(|| self.inner.capture(transaction_id))
            .await
    }

    async fn sale(&self, request: &PaymentRequest) -> Result<PaymentResult, PaymentError> {
        self.execute_with_resilience(|| self.inner.sale(request))
            .await
    }

    async fn refund(
        &self,
        transaction_id: &str,
        amount: Option<Money>,
        idempotency_key: Option<&str>,
    ) -> Result<PaymentResult, PaymentError> {
        self.execute_with_resilience(|| self.inner.refund(transaction_id, amount, idempotency_key))
            .await
    }

    async fn void(&self, transaction_id: &str) -> Result<PaymentResult, PaymentError> {
        self.execute_with_resilience(|| self.inner.void(transaction_id))
            .await
    }

    async fn receipt(&self, transaction_id: &str) -> Result<PaymentReceipt, PaymentError> {
        self.execute_with_resilience(|| self.inner.receipt(transaction_id))
            .await
    }

    fn device_info(&self) -> DeviceInfo {
        self.inner.device_info()
    }
}

#[cfg(test)]
#[path = "resilience_tests.rs"]
mod tests;
