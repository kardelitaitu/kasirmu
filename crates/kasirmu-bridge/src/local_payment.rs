//! Local payment-method command bodies (the market rail surface).
//!
//! Wave F: extracted byte-for-byte from
//! `apps/desktop-tauri/src/commands/local_payment.rs`. Only the mechanical
//! `state.*` → `ctx.*` receiver swaps and `AppError::` → `BridgeError::`
//! renames were applied; gate kind and order (session gate then the
//! ADR #47 location-resource gate), the single store lock with no drop
//! (read-after-write on the same guard), SQL and error strings are unchanged.

use kasirmu_core::db::assignments::ScopeType;
use kasirmu_core::db::payment_methods::{EffectivePaymentRail, NewPaymentRail};
use kasirmu_core::{Store, permissions};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// One rail in the card's replace-set submission.
///
/// Wire contract (fixed 2026-09-13): the UI has sent **snake_case**
/// (`rail_code`, `is_enabled`) since slice 6 (c549f7e5ab), but this DTO
/// carried `rename_all = "camelCase"` from the same commit, so the
/// settings card's save path could never deserialize against a real
/// backend — `missing field 'railCode'` on every submission. The rename
/// is removed so the DTO matches the wire the only caller actually
/// sends; the camelCase form is accepted too via aliases, so a desktop
/// or tablet caller that already adopted the (never-wire-proven)
/// camelCase shape keeps working. No test deserialized the wire shape
/// before, which is why this survived three shells since Sep 9.
#[derive(Debug, serde::Deserialize)]
pub struct LocalPaymentRailArgs {
    /// Stable rail code (e.g. `qris`, `va-bca`).
    #[serde(alias = "railCode")]
    pub rail_code: String,
    /// Display label.
    pub label: String,
    /// Whether the scope offers the rail.
    #[serde(alias = "isEnabled")]
    pub is_enabled: bool,
    /// Per-rail market metadata (JSON object). Credential-shaped keys are
    /// rejected by the core write path.
    #[serde(default)]
    pub parameters: String,
}

/// Read the effective payment-rail surface for one location of the
/// session's store (regional slice 6).
///
/// Resolves the session's store database (ADR #7) and checks `settings:read`
/// inline. The read walks entity → location per rail with provenance — the
/// same chain semantics as the regional read. An unlinked or unknown
/// location answers an empty list (no market, no invented rails).
pub async fn get_local_payment_methods_scoped(
    ctx: &BridgeCtx<'_>,
    location_id: &str,
    session_token: &str,
) -> Result<Vec<EffectivePaymentRail>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_READ)
        .await?;
    let conn = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    Ok(store.local_payment_methods_for_location(location_id)?)
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
pub async fn set_local_payment_methods_scoped(
    ctx: &BridgeCtx<'_>,
    location_id: &str,
    rails: Vec<LocalPaymentRailArgs>,
    session_token: &str,
) -> Result<Vec<EffectivePaymentRail>, BridgeError> {
    let (session, conn) = ctx.resolve_scope(session_token)?;
    ctx.require_session_permission(&session, permissions::SETTINGS_EDIT)
        .await?;
    ctx.require_permission_for_session_resource(
        &session,
        permissions::SETTINGS_EDIT,
        ScopeType::Location,
        location_id,
    )
    .await?;
    let submitted: Vec<NewPaymentRail> = rails
        .into_iter()
        .map(|r| NewPaymentRail {
            rail_code: r.rail_code,
            label: r.label,
            is_enabled: r.is_enabled,
            parameters: r.parameters,
        })
        .collect();
    let conn = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&conn);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    store.replace_local_payment_methods("location", location_id, &submitted, &now)?;
    Ok(store.local_payment_methods_for_location(location_id)?)
}

#[cfg(test)]
#[path = "local_payment_tests.rs"]
mod tests;
