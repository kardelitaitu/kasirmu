/*
last audited 25-07-26 by RSA-Agent (modules-inventory slice A: models deep read)
crate: modules-inventory | status: SAFE | lint: CLEAN
findings: clean — Sku/Barcode/Money newtypes; canonical default location UUID documented; ADR #36 D1/D2 local-only fields
next: none | perf: N/A
Moved 2026-09-28 (ADR-61 / C26): the domain types live in foundation now, so kasirmu-core can
  re-export them without depending on this module. Glob re-exported so every moved item — including
  the ones no facade names, like ProductWithDetails — stays reachable at this path; the unit tests
  moved with the types.
*/
//! Inventory and product domain models — re-exported from `foundation`.

pub use foundation::inventory::*;
