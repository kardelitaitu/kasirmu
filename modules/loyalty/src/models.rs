/*
last audited 25-07-26 by RSA-Agent (modules-loyalty slice A: models read)
crate: modules-loyalty | status: SAFE | lint: CLEAN
findings: clean — loyalty tier/account/transaction plus gift-card types; GiftCard has a hand-written redacting Debug
next: none | perf: N/A
Moved 2026-09-28 (ADR-61 / C26): the domain types live in foundation now, so kasirmu-core can
  re-export them without depending on this module. Glob re-exported so every path still resolves,
  including any item no facade names; the unit tests moved with the types.
*/
//! Loyalty and gift-card domain models — re-exported from `foundation`.

pub use foundation::loyalty::*;
