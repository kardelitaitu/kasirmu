//! Re-export shim: the email report scheduler now lives in `kasirmu_notification`.
//!
//! The implementation moved to `crates/kasirmu-notification/src/email_scheduler.rs`
//! so the daemon can build and run headless. The module declaration in `lib.rs`
//! still points here, so every call site
//! (`crate::email_scheduler::run_scheduler_loop`) compiles unchanged. Tests
//! moved with the implementation to the owning crate.

pub use kasirmu_notification::email_scheduler::*;
