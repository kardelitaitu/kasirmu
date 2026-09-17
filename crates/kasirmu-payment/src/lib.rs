/*
last audited DD-MM-YY by DSH-Agent (re-review)
crate: kasirmu-payment | status: SAFE | lint: CLEAN
findings: 0 unsafe blocks (#![deny(unsafe_code)] at crate root). mock.rs lock().unwrap() calls are documented test-double pattern (same as kasirmu-hal). Re-review confirms the 31-08-26 stamp's findings: PAY-2 refund idempotency open, PAY-3 partial refund, PAY-4 stripe decline classification — all pre-existing, unchanged. No new findings.
next: give refund an idempotency key (PAY-2), partial refund (PAY-3), Stripe decline classification (PAY-4) | perf: HTTP async/tokio; mock in-memory atomics
*/
#![deny(unsafe_code)]

//! Payment processor abstraction for OZ-POS.
//!
//! `kasirmu-payment` provides a single trait, [`PaymentProcessor`], with
//! vendor-specific implementations for Stripe, Square, Paddle and QRIS.
//! Switching processors is a config change, not a code change.
//!
//! Card-present terminals are not part of this crate. An EDC terminal is a
//! device, so its trait and drivers live in `kasirmu-hal` beside every other
//! device class — `kasirmu_hal::EdcTerminal`, `kasirmu_hal::drivers::edc`, and a
//! registry category to hold them. This crate keeps the layer above: the
//! acquirers and gateways.
//!
//! # Wiring status — read this before scoring a bug's severity
//!
//! Nothing in `apps/desktop-client` or `apps/mobile-tauri` constructs a
//! [`PaymentRequest`] or calls [`authorize`](PaymentProcessor::authorize).
//! An earlier version of this doc said "the cashier's flow uses the trait",
//! which is not true today — and a sentence like that is what makes a reader
//! grade a latent defect as a live money-path outage.
//!
//! Until ad908e96 the clients took `drivers::edc` from this crate, wired to
//! an armed `MockEdcTerminal`, which is how a card sale could report approval
//! with no terminal present. That path is gone: the commands resolve a
//! terminal from the HAL registry and fail closed when none is configured.
//!
//! Defects in the HTTP gateway drivers are still real and worth fixing — the
//! crate is compiled by CI, has a full wiremock suite, and the integration
//! point is plainly intended. But PAY-2 and COR-31 in those drivers have no
//! production caller yet, so they are prospective. Close them before the
//! wiring lands, not after.
//!
//! # Lifecycle
//!
//! 1. Build a [`PaymentRequest`]
//! 2. Call [`authorize`](PaymentProcessor::authorize) to hold funds
//! 3. Call [`capture`](PaymentProcessor::capture) to complete
//! 4. Optionally [`refund`](PaymentProcessor::refund) or [`void`](PaymentProcessor::void)
//!
//! For simple flows [`sale`](PaymentProcessor::sale) combines step 2 + 3.
//!
//! # Testing
//!
//! Use [`MockPaymentProcessor`](drivers::mock::MockPaymentProcessor) in
//! unit tests. It tracks call counts and can simulate declines and
//! timeouts.
//!
//! ```
//! use kasirmu_payment::{PaymentProcessor, drivers::mock::MockPaymentProcessor};
//! ```

pub mod drivers;
pub mod error;
pub mod processor;
pub mod registry;
pub mod resilience;
pub mod types;
pub mod webhook;

pub use error::{ErrorClass, PaymentError};
pub use processor::PaymentProcessor;
pub use registry::PaymentProcessorRegistry;
pub use resilience::{CircuitBreaker, CircuitState, ResilientProcessor, ResilientProcessorConfig};
pub use types::{PaymentMethod, PaymentReceipt, PaymentRequest, PaymentResult};
pub use webhook::{UnverifiedWebhookGuard, WebhookEvent, WebhookVerifier};

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
