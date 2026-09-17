/*
last audited 25-07-26 by RSA-Agent
crate: oz-payment | status: SAFE | lint: CLEAN
findings: feature gates paddle/edc honest; live drivers mock/stripe/square/qris always compiled
next: none | perf: N/A
*/
//! Driver implementations for payment processors.
//!
//! - `mock` — in-memory mock for testing and offline demo
//! - `stripe` — live Stripe PaymentIntents integration
//! - `square` — live Square Payments API integration
//! - `qris` — Midtrans QRIS (Indonesian QR code standard)
//! - `paddle` — Paddle Billing integration (PLANNED — stub)
//!
//! Card-present terminals are not here. An EDC terminal is a device, so its
//! trait and drivers live in `oz-hal` alongside every other device class;
//! see `crates/oz-hal/src/traits/edc.rs`. What stays in this crate is the
//! processor layer — the acquirers and gateways above.

pub mod mock;
pub mod qris;
pub mod square;
pub mod stripe;

/// Paddle Billing payment processor — PLANNED (stub).
#[cfg(feature = "paddle")]
pub mod paddle;
