//! Customer management commands — list, get, create, update, delete.
//!
//! Wave B / B1: the bodies now live in the headless `oz_bridge::customers`
//! module (backed by `oz_core::db::Store`). Each `#[tauri::command]` below
//! keeps its exact name, parameter list and `Result<_, AppError>` return so
//! the registered IPC surface and the serialized error shape are unchanged; it
//! borrows a `BridgeCtx` from `AppState`, calls the bridge, and maps
//! `BridgeError` back to `AppError` variant-for-variant. The DTOs moved with
//! the bodies and are re-exported so `use super::*` in `customers_tests.rs`
//! still resolves them, and the two module helpers stay here as thin
//! `AppError`-returning adapters under the extraction contract.
//!
//! The mixed gate shapes are deliberately unchanged: the five legacy commands
//! still authorize the caller-supplied `user_id` against the GLOBAL identity
//! DB with the non-scope-aware `Store::require_permission`, the session-scoped
//! writes/read/search/history commands gate through `require_customer_permission`
//! on that same global DB, and `get_customer_scoped` alone keeps the
//! scope-aware `require_permission_for_session` (ADR #35 D5) it always had.

// Retained for the sibling test module, which reaches these through
// `use super::*`; the command bodies themselves no longer name them.
#[allow(unused_imports)]
use foundation::validate_not_empty;
#[allow(unused_imports)]
use oz_core::Customer;
#[allow(unused_imports)]
use oz_core::db::Store;
#[allow(unused_imports)]
use oz_core::permissions;
#[allow(unused_imports)]
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use oz_bridge::customers::{
    CreateCustomerArgs, CreateCustomerScopedArgs, CustomerDto, CustomerHistoryDto,
    CustomerLoyaltySummaryDto, CustomerSaleSummaryDto, CustomerSearchPage, DeleteCustomerArgs,
    UpdateCustomerArgs, UpdateCustomerScopedArgs,
};

/// Verify a customer permission against the global identity database.
///
/// Thin adapter over `oz_bridge::customers::require_customer_permission`: the
/// name, parameter list and `Result<_, AppError>` type are unchanged so the
/// gate stays reachable through `AppState`.
#[allow(dead_code)] // retained by the Wave-B extraction contract for sibling tests
async fn require_customer_permission(
    state: &AppState,
    user_id: &str,
    permission: &str,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::customers::require_customer_permission(&ctx, user_id, permission)
        .await
        .map_err(AppError::from)
}

/// Validate fields shared by customer create and update commands.
///
/// Thin adapter over `oz_bridge::customers::validate_customer_fields`.
#[allow(dead_code)] // retained by the Wave-B extraction contract for sibling tests
fn validate_customer_fields(
    name: &str,
    email: Option<&str>,
    phone: Option<&str>,
) -> Result<(), AppError> {
    oz_bridge::customers::validate_customer_fields(name, email, phone).map_err(AppError::from)
}

// ── List customers ──────────────────────────────────────────────────

#[tauri::command]
/// List customers.
///
/// **Deprecated for multi-store (ADR #7):** Use `list_customers_scoped`.
pub async fn list_customers(state: State<'_, AppState>) -> Result<Vec<CustomerDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::customers::list_global(&ctx)
        .await
        .map_err(Into::into)
}

/// List customers for the store resolved from a session token. ADR #7.
///
/// CRM-02: gated on `customers:view` like every other customer read — the
/// frontend registers the screen as manager-only, but the UI role gate is
/// not a security boundary; the command must enforce the declared
/// permission itself.
#[tauri::command]
pub async fn list_customers_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CustomerDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::customers::list_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

// ── Get single customer ─────────────────────────────────────────────

#[tauri::command]
/// Get customer.
pub async fn get_customer(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<CustomerDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::customers::get_global(&ctx, &id)
        .await
        .map_err(Into::into)
}

// ── Create customer ─────────────────────────────────────────────────

#[tauri::command]
/// Create customer.
///
/// **Deprecated for multi-store UI paths (ADR #7):** Use
/// [`create_customer_scoped`] so the session selects the store and user.
pub async fn create_customer(
    args: CreateCustomerArgs,
    state: State<'_, AppState>,
) -> Result<CustomerDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::customers::create_global(&ctx, &args)
        .await
        .map_err(Into::into)
}

// ── Update customer ─────────────────────────────────────────────────

#[tauri::command]
/// Update customer.
///
/// **Deprecated for multi-store UI paths (ADR #7):** Use
/// [`update_customer_scoped`] so the session selects the store and user.
pub async fn update_customer(
    args: UpdateCustomerArgs,
    state: State<'_, AppState>,
) -> Result<CustomerDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::customers::update_global(&ctx, &args)
        .await
        .map_err(Into::into)
}

// ── Delete customer ─────────────────────────────────────────────────

#[tauri::command]
/// Delete customer.
///
/// **Deprecated for multi-store UI paths (ADR #7):** Use
/// [`delete_customer_scoped`] so the session selects the store and user.
pub async fn delete_customer(
    args: DeleteCustomerArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::customers::delete_global(&ctx, &args)
        .await
        .map_err(Into::into)
}

// ── Store-scoped mutations (ADR #7) ─────────────────────────────────

/// Create a customer in the store resolved from a session token.
///
/// The session supplies both the store database and authenticated user;
/// no caller-provided user ID is accepted. ADR #7.
#[tauri::command]
pub async fn create_customer_scoped(
    session_token: String,
    args: CreateCustomerScopedArgs,
    state: State<'_, AppState>,
) -> Result<CustomerDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::customers::create_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Update a customer in the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn update_customer_scoped(
    session_token: String,
    args: UpdateCustomerScopedArgs,
    state: State<'_, AppState>,
) -> Result<CustomerDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::customers::update_scoped(&ctx, &session_token, &args)
        .await
        .map_err(Into::into)
}

/// Delete a customer from the store resolved from a session token. ADR #7.
#[tauri::command]
pub async fn delete_customer_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::customers::delete_scoped(&ctx, &session_token, &id)
        .await
        .map_err(Into::into)
}

// ── Search (CUST-06) ──────────────────────────────────────────────

/// Search customers in the store resolved from a session token. ADR #7.
///
/// CUST-06: the query runs server-side (LIKE over name/email/phone) with a
/// bounded page size so the renderer never holds the full customer list.
#[tauri::command]
pub async fn search_customers_scoped(
    session_token: String,
    query: String,
    limit: Option<u64>,
    offset: Option<u64>,
    state: State<'_, AppState>,
) -> Result<CustomerSearchPage, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::customers::search_scoped(&ctx, &session_token, &query, limit, offset)
        .await
        .map_err(Into::into)
}

// ── Customer history (CUST-05) ────────────────────────────────────

/// Get the read-only history for a customer (CUST-05). ADR #7.
///
/// Scoped to the session's store and gated on `customers:view`. Sales are
/// bounded (max 100/page) so a heavy-spending customer cannot bloat the
/// renderer.
#[tauri::command]
pub async fn get_customer_history_scoped(
    session_token: String,
    customer_id: String,
    limit: Option<u64>,
    offset: Option<u64>,
    state: State<'_, AppState>,
) -> Result<CustomerHistoryDto, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::customers::history_scoped(&ctx, &session_token, &customer_id, limit, offset)
        .await
        .map_err(Into::into)
}

// ── Scoped variants (ADR #7) ────────────────────────────────────

/// Scoped variant of `get_customer` (ADR #7).
#[tauri::command]
pub async fn get_customer_scoped(
    id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<CustomerDto>, AppError> {
    // F-017: enforce per-domain permission on this scoped command.
    let ctx = state.bridge_ctx();
    oz_bridge::customers::get_scoped(&ctx, &id, &session_token)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "customers_tests.rs"]
mod tests;
