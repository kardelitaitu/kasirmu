/*
last audited 25-07-26 by RSA-Agent (modules-terminal slice A: models deep read)
crate: modules-terminal | status: SAFE | lint: CLEAN
findings: MSL-9 CLOSED 2026-09-27 (DSH credential-Debug pass) — Terminal no longer derives Debug; the manual impl below redacts terminal_secret
next: none | perf: N/A
Moved 2026-09-28 (ADR-61 / C26): Terminal and TerminalId live in foundation now, redacting Debug
  included, so kasirmu-core can re-export them without depending on this module. Re-exported here
  so every modules_terminal::models::* path still resolves; the unit tests moved with the types.
*/
//! Terminal domain models — re-exported from `foundation`.

pub use foundation::terminal::{Terminal, TerminalId};
