/*
last audited 25-07-26 by RSA-Agent
crate: kasirmu-payment | status: SAFE | lint: CLEAN
findings: RwLock catalogue sound; build_from_config PLANNED stub fails closed (PAY-12); "config change not code change" promise not yet real — drivers constructed directly by callers
next: implement build_from_config when registry wiring lands | perf: N/A
*/
//! Payment processor registry — PLANNED (stub).
//!
//! The runtime catalogue of available payment processors, mirroring
//! `kasirmu_hal::DriverRegistry`. Commands reach a processor through the
//! registry (e.g. `registry.processor("stripe")`) and never construct a
//! specific driver directly, so switching gateways is a config change
//! (see the `payment_gateways` table), not a code change.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::PaymentProcessor;
use crate::error::{ErrorClass, PaymentError};

/// Shared, mutable catalogue of payment processors.
#[derive(Default)]
pub struct PaymentProcessorRegistry {
    processors: RwLock<HashMap<String, Arc<dyn PaymentProcessor>>>,
    method_fallbacks: RwLock<HashMap<String, Vec<Arc<dyn PaymentProcessor>>>>,
}

impl PaymentProcessorRegistry {
    /// Construct an empty registry. Use [`Self::register`] to add drivers.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a processor under `name` (e.g. `"stripe"`). Overwrites
    /// any previous entry with the same name.
    pub async fn register(&self, name: &str, processor: Arc<dyn PaymentProcessor>) {
        self.processors
            .write()
            .await
            .insert(name.to_owned(), processor);
    }

    /// Look up a processor by name. Returns `None` if not registered.
    pub async fn processor(&self, name: &str) -> Option<Arc<dyn PaymentProcessor>> {
        self.processors.read().await.get(name).cloned()
    }

    /// Snapshot of registered processor names.
    pub async fn processor_names(&self) -> Vec<String> {
        self.processors.read().await.keys().cloned().collect()
    }

    /// Register an ordered list of fallback processors for a payment method / rail
    /// (e.g. `"qris"` -> `[midtrans_qris, qris_manual]`).
    pub async fn register_method_fallback(
        &self,
        method: &str,
        chain: Vec<Arc<dyn PaymentProcessor>>,
    ) {
        self.method_fallbacks
            .write()
            .await
            .insert(method.to_owned(), chain);
    }

    /// Get the ordered list of fallback processors registered for `method`.
    pub async fn method_processors(&self, method: &str) -> Vec<Arc<dyn PaymentProcessor>> {
        self.method_fallbacks
            .read()
            .await
            .get(method)
            .cloned()
            .unwrap_or_default()
    }

    /// Execute a payment operation across the configured fallback chain for `method`.
    ///
    /// Tries each processor in order. If a processor encounters a transient error
    /// or failure, moves to the next processor in the chain.
    pub async fn execute_with_fallback<T, F, Fut>(
        &self,
        method: &str,
        operation: F,
    ) -> Result<T, PaymentError>
    where
        F: Fn(Arc<dyn PaymentProcessor>) -> Fut,
        Fut: Future<Output = Result<T, PaymentError>>,
    {
        let chain = self.method_processors(method).await;
        if chain.is_empty() {
            return Err(PaymentError::Unsupported(format!(
                "no payment processors configured for method '{method}'"
            )));
        }

        let mut last_error = None;
        for processor in chain {
            match operation(processor).await {
                Ok(val) => return Ok(val),
                Err(err) => {
                    let class = err.classify();
                    // On terminal decline or bad card, do not silently switch processor
                    if class == ErrorClass::Terminal && !matches!(err, PaymentError::Unsupported(_))
                    {
                        return Err(err);
                    }
                    last_error = Some(err);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| {
            PaymentError::Unsupported(format!("all fallback processors failed for '{method}'"))
        }))
    }

    /// Build a processor from a gateway configuration.
    ///
    /// **PLANNED:** currently returns [`PaymentError::Unsupported`] for
    /// every gateway. The real implementation will read the gateway's
    /// `config_json` (api key, sandbox flag) and construct the matching
    /// driver (Stripe, Square, Midtrans/QRIS, Paddle, or an EDC terminal).
    pub async fn build_from_config(
        &self,
        name: &str,
    ) -> Result<Arc<dyn PaymentProcessor>, PaymentError> {
        let _ = name;
        Err(PaymentError::Unsupported(
            "PaymentProcessorRegistry::build_from_config — PLANNED, not implemented yet".into(),
        ))
    }
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;
