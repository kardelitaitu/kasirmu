/*
last audited 25-07-26 by RSA-Agent (modules-tax slice A: models deep read)
crate: modules-tax | status: SAFE | lint: CLEAN
findings: exemplary — TAX-05 integer-only rounding with HalfUp default (jurisdiction-defensible) and legacy Truncate documented for backward comp…
next: none | perf: N/A
Moved 2026-09-28 (ADR-61 / C26): RoundingMode and TaxRate live in foundation now, so kasirmu-core can
  re-export them without depending on this module. Re-exported here so every
  modules_tax::models::* path still resolves; the unit tests moved with the types.
*/
//! Tax domain models — re-exported from `foundation`.

pub use foundation::tax::{RoundingMode, TaxRate};
