/*
last audited 25-07-26 by RSA-Agent (modules-crm slice A: models verified)
crate: modules-crm | status: SAFE | lint: CLEAN
findings: clean — Customer with validated Email/Phone newtypes from foundation contact module; unwraps test-only
next: none | perf: N/A
Moved 2026-09-28 (ADR-61 / C26): Customer and its impl live in foundation now, so kasirmu-core can
  re-export the type without depending on this module. Re-exported here so every
  modules_crm::models::Customer path still resolves; the unit tests moved with the type.
*/
//! CRM domain models — Customer, re-exported from `foundation`.

pub use foundation::customer::Customer;
