//! Resilient circuit breaker and timeout decorator for [`EdcTerminal`].
//!
//! Wraps any [`EdcTerminal`] driver to provide fail-fast protection against
//! repeated hardware timeouts, communication errors, and slow network gateways.
//!
//! # States
//! - [`CircuitState::Closed`]: Normal operation; calls pass through to the inner terminal.
//! - [`CircuitState::Open`]: Consecutive timeouts reached threshold; calls fail fast immediately.
//! - [`CircuitState::HalfOpen`]: Cooldown elapsed; exactly one probe is admitted to test recovery.

use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use kasirmu_core::Money;
use tokio::sync::RwLock;

use crate::error::HalError;
use crate::traits::edc::{EdcPaymentResult, EdcSettlementResult, EdcTerminal, TerminalStatus};
use crate::types::DeviceInfo;

/// State of the EDC circuit breaker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    /// Normal operation: calls pass through to the terminal.
    Closed,
    /// Terminal is down / failing: calls fail fast immediately.
    Open,
    /// Testing if terminal has recovered: single trial admitted.
    HalfOpen,
}

/// Configuration options for [`ResilientEdcTerminal`].
#[derive(Debug, Clone)]
pub struct ResilientEdcConfig {
    /// Number of consecutive transient timeouts/failures to trip breaker (default: 3).
    pub failure_threshold: u32,
    /// Cooldown window before testing recovery in HalfOpen (default: 15s).
    pub cooldown_duration: Duration,
    /// Timeout ceiling on each terminal operation (default: 30s).
    pub timeout_duration: Duration,
}

impl Default for ResilientEdcConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 3,
            cooldown_duration: Duration::from_secs(15),
            timeout_duration: Duration::from_secs(30),
        }
    }
}

#[derive(Debug)]
struct BreakerState {
    state: CircuitState,
    consecutive_failures: u32,
    opened_at: Option<Instant>,
    probe_in_flight: bool,
}

/// Decorator providing circuit-breaking and timeout protection for an [`EdcTerminal`].
pub struct ResilientEdcTerminal {
    inner: Arc<dyn EdcTerminal>,
    config: ResilientEdcConfig,
    breaker: RwLock<BreakerState>,
}

impl ResilientEdcTerminal {
    /// Wrap `inner` with default resilience settings.
    pub fn new(inner: Arc<dyn EdcTerminal>) -> Self {
        Self::with_config(inner, ResilientEdcConfig::default())
    }

    /// Wrap `inner` with custom configuration.
    pub fn with_config(inner: Arc<dyn EdcTerminal>, config: ResilientEdcConfig) -> Self {
        Self {
            inner,
            config,
            breaker: RwLock::new(BreakerState {
                state: CircuitState::Closed,
                consecutive_failures: 0,
                opened_at: None,
                probe_in_flight: false,
            }),
        }
    }

    /// Current circuit state.
    pub async fn state(&self) -> CircuitState {
        let mut guard = self.breaker.write().await;
        if guard.state == CircuitState::Open
            && guard
                .opened_at
                .is_some_and(|opened| opened.elapsed() >= self.config.cooldown_duration)
        {
            guard.state = CircuitState::HalfOpen;
            guard.probe_in_flight = false;
        }
        guard.state
    }

    /// Check if request is allowed through the breaker.
    async fn allow_request(&self) -> Result<(), HalError> {
        let mut guard = self.breaker.write().await;
        if guard.state == CircuitState::Open
            && guard
                .opened_at
                .is_some_and(|opened| opened.elapsed() >= self.config.cooldown_duration)
        {
            guard.state = CircuitState::HalfOpen;
            guard.probe_in_flight = false;
        }
        match guard.state {
            CircuitState::Closed => Ok(()),
            CircuitState::HalfOpen => {
                if guard.probe_in_flight {
                    return Err(HalError::Timeout(0));
                }
                guard.probe_in_flight = true;
                Ok(())
            }
            CircuitState::Open => Err(HalError::Timeout(0)),
        }
    }

    async fn record_success(&self) {
        let mut guard = self.breaker.write().await;
        guard.consecutive_failures = 0;
        guard.state = CircuitState::Closed;
        guard.opened_at = None;
        guard.probe_in_flight = false;
    }

    async fn record_failure(&self, is_transient: bool) {
        if !is_transient {
            return;
        }
        let mut guard = self.breaker.write().await;
        guard.consecutive_failures = guard.consecutive_failures.saturating_add(1);
        if guard.state == CircuitState::HalfOpen
            || guard.consecutive_failures >= self.config.failure_threshold
        {
            guard.state = CircuitState::Open;
            guard.opened_at = Some(Instant::now());
            guard.probe_in_flight = false;
        }
    }

    fn is_transient(err: &HalError) -> bool {
        matches!(
            err,
            HalError::Timeout(_) | HalError::Disconnected | HalError::Io(_)
        )
    }

    /// Reference to the wrapped inner terminal.
    pub fn inner(&self) -> &Arc<dyn EdcTerminal> {
        &self.inner
    }
}

#[async_trait]
impl EdcTerminal for ResilientEdcTerminal {
    async fn status(&self) -> Result<TerminalStatus, HalError> {
        self.allow_request().await?;
        let res =
            match tokio::time::timeout(self.config.timeout_duration, self.inner.status()).await {
                Ok(inner_res) => inner_res,
                Err(_) => Err(HalError::Timeout(
                    self.config.timeout_duration.as_millis() as u32
                )),
            };
        match &res {
            Ok(_) => self.record_success().await,
            Err(e) => self.record_failure(Self::is_transient(e)).await,
        }
        res
    }

    async fn authorize(&self, amount: Money, reference: Option<&str>) -> Result<String, HalError> {
        self.allow_request().await?;
        let res = match tokio::time::timeout(
            self.config.timeout_duration,
            self.inner.authorize(amount, reference),
        )
        .await
        {
            Ok(inner_res) => inner_res,
            Err(_) => Err(HalError::Timeout(
                self.config.timeout_duration.as_millis() as u32
            )),
        };
        match &res {
            Ok(_) => self.record_success().await,
            Err(e) => self.record_failure(Self::is_transient(e)).await,
        }
        res
    }

    async fn capture(&self, transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        self.allow_request().await?;
        let res = match tokio::time::timeout(
            self.config.timeout_duration,
            self.inner.capture(transaction_id),
        )
        .await
        {
            Ok(inner_res) => inner_res,
            Err(_) => Err(HalError::Timeout(
                self.config.timeout_duration.as_millis() as u32
            )),
        };
        match &res {
            Ok(_) => self.record_success().await,
            Err(e) => self.record_failure(Self::is_transient(e)).await,
        }
        res
    }

    async fn sale(
        &self,
        amount: Money,
        reference: Option<&str>,
    ) -> Result<EdcPaymentResult, HalError> {
        self.allow_request().await?;
        let res = match tokio::time::timeout(
            self.config.timeout_duration,
            self.inner.sale(amount, reference),
        )
        .await
        {
            Ok(inner_res) => inner_res,
            Err(_) => Err(HalError::Timeout(
                self.config.timeout_duration.as_millis() as u32
            )),
        };
        match &res {
            Ok(_) => self.record_success().await,
            Err(e) => self.record_failure(Self::is_transient(e)).await,
        }
        res
    }

    async fn refund(
        &self,
        transaction_id: &str,
        amount: Option<Money>,
    ) -> Result<EdcPaymentResult, HalError> {
        self.allow_request().await?;
        let res = match tokio::time::timeout(
            self.config.timeout_duration,
            self.inner.refund(transaction_id, amount),
        )
        .await
        {
            Ok(inner_res) => inner_res,
            Err(_) => Err(HalError::Timeout(
                self.config.timeout_duration.as_millis() as u32
            )),
        };
        match &res {
            Ok(_) => self.record_success().await,
            Err(e) => self.record_failure(Self::is_transient(e)).await,
        }
        res
    }

    async fn void(&self, transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        self.allow_request().await?;
        let res = match tokio::time::timeout(
            self.config.timeout_duration,
            self.inner.void(transaction_id),
        )
        .await
        {
            Ok(inner_res) => inner_res,
            Err(_) => Err(HalError::Timeout(
                self.config.timeout_duration.as_millis() as u32
            )),
        };
        match &res {
            Ok(_) => self.record_success().await,
            Err(e) => self.record_failure(Self::is_transient(e)).await,
        }
        res
    }

    async fn settle(&self) -> Result<EdcSettlementResult, HalError> {
        self.allow_request().await?;
        let res =
            match tokio::time::timeout(self.config.timeout_duration, self.inner.settle()).await {
                Ok(inner_res) => inner_res,
                Err(_) => Err(HalError::Timeout(
                    self.config.timeout_duration.as_millis() as u32
                )),
            };
        match &res {
            Ok(_) => self.record_success().await,
            Err(e) => self.record_failure(Self::is_transient(e)).await,
        }
        res
    }

    async fn inquiry(&self, invoice: &str) -> Result<EdcPaymentResult, HalError> {
        self.allow_request().await?;
        let res =
            match tokio::time::timeout(self.config.timeout_duration, self.inner.inquiry(invoice))
                .await
            {
                Ok(inner_res) => inner_res,
                Err(_) => Err(HalError::Timeout(
                    self.config.timeout_duration.as_millis() as u32
                )),
            };
        match &res {
            Ok(_) => self.record_success().await,
            Err(e) => self.record_failure(Self::is_transient(e)).await,
        }
        res
    }

    async fn print_receipt(&self, transaction_id: &str) -> Result<Vec<u8>, HalError> {
        self.allow_request().await?;
        let res = match tokio::time::timeout(
            self.config.timeout_duration,
            self.inner.print_receipt(transaction_id),
        )
        .await
        {
            Ok(inner_res) => inner_res,
            Err(_) => Err(HalError::Timeout(
                self.config.timeout_duration.as_millis() as u32
            )),
        };
        match &res {
            Ok(_) => self.record_success().await,
            Err(e) => self.record_failure(Self::is_transient(e)).await,
        }
        res
    }

    fn device_info(&self) -> DeviceInfo {
        self.inner.device_info()
    }
}

#[cfg(test)]
#[path = "resilient_tests.rs"]
mod tests;
