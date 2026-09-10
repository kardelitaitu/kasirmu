//! Tauri commands for Accounts Payable (Hutang / Beli Tempo — Phase 4 AP of
//! `docs/plans/payment-methods-plan.md`).
//!
//! Desktop-only authoring surface, following the memo / legal-entity
//! "desktop-first authoring IPC" precedent: raising a vendor debt, settling
//! it, and writing it off are back-office Owner actions, not register work,
//! so the tablet shell does not expose them (allowlisted in
//! `scripts/ipc-parity-allowlist.json`). Each command maps 1:1 to a
//! `payables:*` permission key and gates on it before touching data.
//!
//! The staged tenant sentinel is `default` (same as the memo commands); a
//! future tenant claim resolves through the session without changing DTOs.
//!
//! Wave C / C5: the bodies now live in the headless `oz_bridge::payables`
//! module. Each `#[tauri::command]` below keeps its exact name, parameter
//! list, attributes and `Result<_, AppError>` wire contract; it builds a
//! `BridgeCtx` from `AppState` and delegates. The session-scoped `payables:*`
//! gate runs inside the bridge against the global identity DB, in the same
//! order as before. The DTOs moved with the bodies and are re-exported so
//! `use super::*` in `payables_tests.rs` still resolves them.

// Retained for the sibling test module, which reaches these through its glob
// import of this module; the command bodies no longer name them.
#[allow(unused_imports)]
use chrono::Utc;

#[allow(unused_imports)]
use oz_core::money::Currency;

#[allow(unused_imports)]
use oz_core::payable::{NewPayable, Payable, PayableStatus};

#[allow(unused_imports)]
use oz_core::{Money, Store, permissions};

#[allow(unused_imports)]
use serde::{Deserialize, Serialize};

use tauri::State;

#[allow(unused_imports)]
use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::payables::{CreatePayableArgs, MoneyDto, PayableDto, RecordPayablePaymentArgs};

/// Parse the optional status filter for `list_payables_scoped`. Unknown
/// values are rejected (unlike the store's lenient read-back) so a typo in a
/// filter never silently returns the wrong slice.
#[allow(dead_code)] // retained for payables_tests.rs, which calls it directly
fn parse_status_filter(raw: Option<&str>) -> Result<Option<PayableStatus>, AppError> {
    oz_bridge::payables::parse_status_filter(raw).map_err(AppError::from)
}

/// List payables, newest first. `status` optionally filters to one lifecycle
/// state. Requires `payables:view`.
#[tauri::command]
pub async fn list_payables_scoped(
    status: Option<String>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<PayableDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::payables::list_payables_scoped(&ctx, status, &session_token)
        .await
        .map_err(Into::into)
}

/// Raise a payable (a supplier debt). Requires `payables:create`.
#[tauri::command]
pub async fn create_payable_scoped(
    args: CreatePayableArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PayableDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::payables::create_payable_scoped(&ctx, args, &session_token)
        .await
        .map_err(Into::into)
}

/// Record a payment against a payable (partial or full settlement). Requires
/// `payables:settle`. Returns the updated payable; the payment history is a
/// separate read once the UI needs it.
#[tauri::command]
pub async fn record_payable_payment_scoped(
    args: RecordPayablePaymentArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PayableDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::payables::record_payable_payment_scoped(&ctx, args, &session_token)
        .await
        .map_err(Into::into)
}

/// Write off a payable (forgive the remaining balance). Requires
/// `payables:writeoff` — a money-destruction action, terminal and audited.
#[tauri::command]
pub async fn write_off_payable_scoped(
    payable_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PayableDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::payables::write_off_payable_scoped(&ctx, &payable_id, &session_token)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "payables_tests.rs"]
mod tests;
