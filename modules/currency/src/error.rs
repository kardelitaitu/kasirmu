/*
last audited 25-07-26 by RSA-Agent (modules-currency slice A: error verified)
crate: modules-currency | status: SAFE | lint: CLEAN
findings: clean thiserror currency error taxonomy
next: none | perf: N/A
*/
//! Error type for the currency/exchange-rate domain.
//!
//! The taxonomy itself moved to `platform-core` (ADR-61 / C26, 2026-09-28), so
//! that `kasirmu-core` can name it without depending on this module. It is
//! re-exported rather than deleted so every existing
//! `modules_currency::CurrencyError` path keeps resolving, including this
//! crate's own tests and `kasirmu-core`'s error conversions.

pub use platform_core::CurrencyError;
