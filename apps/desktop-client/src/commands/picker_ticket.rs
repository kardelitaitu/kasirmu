//! Picker-ticket commands — thin re-export shim (Wave B / B4a).
//!
//! The HMAC implementation moved verbatim to `kasirmu_bridge::picker`, which is
//! tauri-free and shared with the bridge auth bodies. This module keeps the
//! `crate::commands::picker_ticket` path that `workspaces.rs`, `staff.rs`,
//! `auth.rs` and the sibling test files already import, so extracting the
//! primitives changed no call site.
//!
//! `PICKER_TICKET_TTL_SECS`, `sign_picker_ticket` and `verify_picker_ticket`
//! are re-exported unchanged: ticket format (`{user_id}.{expiry_ts}.{hex}`),
//! the 5-minute TTL and the uniform `None` denial for forged/expired/malformed
//! tickets are defined exactly once, in the bridge.

pub use kasirmu_bridge::picker::{PICKER_TICKET_TTL_SECS, sign_picker_ticket, verify_picker_ticket};
