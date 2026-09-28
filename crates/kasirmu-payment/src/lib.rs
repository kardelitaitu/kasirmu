/*
last audited 26-09-26 by DSH (stamp corrected: findings + next were stale in the DANGEROUS direction)
crate: kasirmu-payment | status: SAFE | lint: CLEAN
findings: 0 unsafe blocks (#![deny(unsafe_code)] at crate root). mock.rs lock().unwrap() calls are documented test-double pattern (same as kasirmu-hal). PAY-2/PAY-3/PAY-4 are CLOSED, not open — the previous text here (and in the 31-08-26 re-review before it) called all three "open, unchanged", which was true when first written and false by 2026-09-26. Evidence, each verified this pass: PAY-2 refund idempotency — `RefundRequest.idempotency_key` (types.rs:52) is threaded through the trait (processor.rs:102-107) and honoured by all three IMPLEMENTED drivers (qris.rs:689, stripe.rs:465 via idempotency_key_for at :242, square.rs:439 via :341), each pinned by a test (qris_tests.rs:105, stripe_tests.rs:21/:293, square_tests.rs:186); the only driver ignoring it is Paddle, which is a PLANNED stub that returns Unsupported for every method (paddle.rs:111-120). PAY-3 partial refund — `refund` takes `amount: Option<Money>`, documented "If `amount` is `None` the full amount is refunded" (processor.rs:93). PAY-4 Stripe decline classification — the code-based mapping was fixed and documented in stripe.rs:300-324. This is the SAME defect PAY-C recorded for the `next:` field of drivers/qris.rs, corrected there on 2026-09-25 and left standing one file up.
next: none for PAY-2/PAY-3/PAY-4 (all closed above; see PAY-C). Genuinely open in this crate: webhook.rs verifiers are a fail-closed stub (PAY-11) and registry.rs build_from_config is a PLANNED stub (PAY-12) — both are deliberate, both fail closed, neither is a correctness hole. | perf: HTTP async/tokio; mock in-memory atomics
*/
#![deny(unsafe_code)]
// `rustdoc::private_intra_doc_links` is allowed crate-wide here, and ONLY that
// lint. `QrisProcessor::capture` documents its per-call poll budget by naming
// the private constants that define it (`MAX_POLL_ATTEMPTS`,
// `POLL_INTERVAL_MS`, `QRIS_EXPIRY_SECS`) — a reader checking "how long can
// this call block" is better served by the number than by a prose restatement.
// `rustdoc::broken_intra_doc_links` is deliberately NOT allowed, so a link to
// an item that does not exist still fails the build. Precedent:
// `kasirmu-crypto/src/lib.rs`, `platform/core/src/lib.rs`.
#![allow(rustdoc::private_intra_doc_links)]

//! Payment processor abstraction for kasir.mu.
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
//! Nothing in `apps/desktop-tauri` or `apps/mobile-tauri` constructs a
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
