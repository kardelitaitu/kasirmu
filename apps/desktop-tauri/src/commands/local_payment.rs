//! Local payment method commands (regional slice 6, saas-2 design slice
//! queue #6) — the market rail surface, entity → location.
//!
//! Wire contract: the core `EffectivePaymentRail` model is returned as-is
//! (camelCase serde — the shape the dev-mock and the card mirror).
//!
//! TWO AXES LIVE HERE NOW, and they must not be conflated (corrected
//! 2026-10-01). This doc previously said the module "never touches
//! `payment_gateways`" and that "the write path rejects credential-shaped
//! parameter keys outright". BOTH were true when written and are FALSE of this
//! file since `a5212ca5f` added the four `payment_gateways` commands here. The
//! claim was security-shaped, so leaving it would have told the next reader that
//! credentials cannot cross this module — they do, by design, on one axis:
//!
//!   * MARKET RAIL (`*_payment_methods*`): which rails a market/site offers is a
//!     MARKET fact and `supports_qris` is a TIER answer (license layer). The write
//!     path really does reject credential-shaped parameter keys outright, because
//!     a rail carries no secrets.
//!   * GATEWAY CREDENTIALS (`*_payment_gateway*`): the opposite by purpose. The
//!     write path takes a `config_json` that CONTAINS plaintext credentials and
//!     core encrypts it at rest under a domain-separated key
//!     (`kasirmu-crypto`, `PAYMENT_GATEWAY_AT_REST_DOMAIN`). Core validates only
//!     that the value is a JSON object — it is not a scrubber, and must not be read
//!     as one.
//!
//! So a credential reaching this module is EXPECTED on the gateway axis and a
//! DEFECT on the rail axis. What is not expected is the two being documented as
//! one thing.
//!
//! Read: `settings:read` (any operator can see the rail surface).
//! Write: `settings:edit` + the ADR #47 location-resource gate — the
//! location layer is what the card edits; the legal-entity layer is
//! managed through the same command with the entity scope resolved by
//! later management surfaces.

// Wave F: the bodies moved to kasirmu_bridge::local_payment. The gate pair keeps
// its original order (session gate then the ADR #47 location-resource gate)
// inside the bridge fn.

#[allow(unused_imports)] // sibling local_payment_tests.rs depends on it
use kasirmu_core::db::assignments::ScopeType;
use kasirmu_core::db::payment_methods::EffectivePaymentRail;
#[allow(unused_imports)] // sibling local_payment_tests.rs depends on it
use kasirmu_core::{Store, permissions};
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

pub use kasirmu_bridge::local_payment::LocalPaymentRailArgs;

/// Read the effective payment-rail surface for one location of the
/// session's store (regional slice 6).
///
/// Resolves the session's store database (ADR #7) and checks `settings:read`
/// inline. The read walks entity → location per rail with provenance — the
/// same chain semantics as the regional read. An unlinked or unknown
/// location answers an empty list (no market, no invented rails).
#[tauri::command]
pub async fn get_local_payment_methods_scoped(
    location_id: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<EffectivePaymentRail>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::local_payment::get_local_payment_methods_scoped(
        &ctx,
        &location_id,
        &session_token,
    )
    .await
    .map_err(Into::into)
}

/// Replace the location's rail list (the card's whole-list write,
/// transactional) and return the freshly effective surface (read-after-
/// write, same connection) so the card re-renders provenance without a
/// second round-trip.
///
/// Checks `settings:edit` scoped to the location resource (ADR #47).
/// Validation happens in core — credential-shaped parameter keys, blank
/// codes/labels, duplicates — inside the same transaction that rewrites
/// the rows; this command adds no validation of its own.
#[tauri::command]
pub async fn set_local_payment_methods_scoped(
    location_id: String,
    rails: Vec<LocalPaymentRailArgs>,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<EffectivePaymentRail>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::local_payment::set_local_payment_methods_scoped(
        &ctx,
        &location_id,
        rails,
        &session_token,
    )
    .await
    .map_err(Into::into)
}

pub use kasirmu_bridge::local_payment::{PaymentGatewayConfig, SetPaymentGatewayArgs};

/// Read a single payment gateway configuration for the session's store.
#[tauri::command]
pub async fn get_payment_gateway_config_scoped(
    gateway_name: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Option<PaymentGatewayConfig>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::local_payment::get_payment_gateway_config_scoped(
        &ctx,
        &gateway_name,
        &session_token,
    )
    .await
    .map_err(Into::into)
}

/// List all payment gateway configurations for the session's store.
#[tauri::command]
pub async fn list_payment_gateways_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<PaymentGatewayConfig>, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::local_payment::list_payment_gateways_scoped(&ctx, &session_token)
        .await
        .map_err(Into::into)
}

/// Upsert a payment gateway configuration for the session's store.
#[tauri::command]
pub async fn set_payment_gateway_config_scoped(
    args: SetPaymentGatewayArgs,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<PaymentGatewayConfig, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::local_payment::set_payment_gateway_config_scoped(&ctx, args, &session_token)
        .await
        .map_err(Into::into)
}

/// Delete a payment gateway configuration for the session's store.
#[tauri::command]
pub async fn delete_payment_gateway_scoped(
    gateway_name: String,
    session_token: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let ctx = state.bridge_ctx();
    kasirmu_bridge::local_payment::delete_payment_gateway_scoped(
        &ctx,
        &gateway_name,
        &session_token,
    )
    .await
    .map_err(Into::into)
}
