//! Authentication utilities — delegates to `platform-core`.
//!
//! Re-exports the hash/verify functions and `LoginSession` from the
//! platform-core auth module.

pub use platform_core::auth::{LoginSession, hash_pin, verify_pin};

// Multi-terminal: authentication is terminal-agnostic. Each terminal
// creates its own session with a unique terminal_id via staff_login.
// The LoginSession carries terminal_id for per-terminal access control.
// Two terminals can authenticate the same user independently.
