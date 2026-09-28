/*
last audited 25-07-26 by RSA-Agent (modules-sales slice A: models deep read)
crate: modules-sales | status: SAFE | lint: CLEAN
findings: clean — Sale/SaleLine/Refund/RefundLine plus held-cart and reporting row types
next: none | perf: N/A
Moved 2026-09-28 (ADR-61 / C26): the domain types live in foundation now, so kasirmu-core can
  re-export them without depending on this module. Glob re-exported so every path still resolves,
  including the row types no facade names; the unit tests moved with the types.
*/
//! Sales domain models — re-exported from `foundation`.

pub use foundation::sales::*;
