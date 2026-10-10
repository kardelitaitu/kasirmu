//! Held-bill and open-bill command bodies for the POS bridge (Wave D / D1a).
//!
//! The self-contained "Hold Orders" seam of `pos.rs`: the hold/open-bill DTOs,
//! the open-bill workspace gate and the five held-cart commands. Out-of-module
//! dependencies are [`crate::error::BridgeError`], [`crate::ctx::BridgeCtx`] and
//! `kasirmu_core` domain types only; every call lands on `Store` or on
//! `kasirmu_core::workspace_type`.
//!
//! Key types: [`HoldCartArgs`]/[`HoldCartResult`] and [`BILL_TYPE_OPEN_BILL`].
//! Main functions: [`hold_cart_scoped`], [`list_held_carts_scoped`],
//! [`list_open_bills_scoped`], [`get_held_cart_scoped`], [`delete_held_cart_scoped`].
//!
//! Invariant: an open bill is a Restaurant POS concept, so
//! [`is_restaurant_pos_workspace`] gates creation AND listing fail-closed
//! against the session type_key, never the request bill_type.

use serde::{Deserialize, Serialize};

use kasirmu_core::db::Store;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// The `bill_type` value marking a held cart as an open bill.
pub const BILL_TYPE_OPEN_BILL: &str = "open_bill";

/// True when the session is bound to the Restaurant POS workspace vertical.
///
/// The vertical is read from `session.type_key` — validated by `create_session`
/// against the licence's `allowed_types` and fixed for the session's lifetime —
/// which is what makes it a sound basis for an authorization decision, unlike
/// [`HoldCartArgs::bill_type`], which arrives afresh on every call and was
/// previously trusted exactly as sent.
///
/// Named `…_workspace`, not `is_restaurant_pos`, to keep it distinct from
/// `SessionContext::restaurant_pos_id`: that field is a **terminal id** (the
/// ADR #40 peer-terminal binding used to resolve the effective store), not a
/// vertical. The two are unrelated and only the name distinguishes them.
///
/// An open bill is a Restaurant POS concept: its only reader,
/// `list_open_bills_scoped`, is reached from the restaurant terminal alone, and
/// the shared `PaymentModal` offers it as the "Open Bill" tender. Every other
/// vertical — [`kasirmu_core::workspace_type::STORE_POS`], `kds`, `warehouse`,
/// `admin` — is refused.
pub fn is_restaurant_pos_workspace(session: &kasirmu_core::session::SessionContext) -> bool {
    kasirmu_core::workspace_type::is_restaurant_pos_type(&session.type_key)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Holdcartargs.
pub struct HoldCartArgs {
    /// Label.
    pub label: String,
    /// Cart Data.
    #[serde(alias = "cart_data")]
    pub cart_data: String,
    /// Item Count.
    #[serde(alias = "item_count")]
    pub item_count: i64,
    /// Total amount in minor currency units.
    #[serde(alias = "total_minor")]
    pub total_minor: i64,
    /// ISO-4217 currency code.
    pub currency: String,
    #[serde(default = "default_bill_type", alias = "bill_type")]
    /// Bill Type.
    pub bill_type: String,
    /// Customer Name.
    #[serde(default, alias = "customer_name")]
    pub customer_name: Option<String>,
    /// ADR-19 §6.3: deduction location UUID locked at cart-start time.
    /// When restoring a held cart, the caller should pass the same
    /// `deduction_location_id` that was stored when the cart was held.
    #[serde(default, alias = "deduction_location_id")]
    pub deduction_location_id: Option<String>,
}

/// Serde default for HoldCartArgs::bill_type: a plain hold, not an open bill.
pub fn default_bill_type() -> String {
    "hold".to_string()
}

#[derive(Debug, Serialize)]
/// Holdcartresult.
pub struct HoldCartResult {
    /// Unique identifier.
    pub id: String,
}

/// Hold a cart in the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
///
/// # Terminal identity
///
/// `bill_type` is checked against the caller's workspace type rather than
/// trusted. `open_bill` is a Restaurant POS concept, so a session whose
/// `type_key` is not [`kasirmu_core::workspace_type::RESTAURANT_POS`] is refused fail-closed. Before
/// this check the value was written through as sent, which let the retail
/// terminal create an open bill — reachable through the shared `PaymentModal`,
/// whose Open Bill tender was not workspace-gated. A plain `hold` stays
/// available to every terminal.
pub async fn hold_cart_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: HoldCartArgs,
) -> Result<HoldCartResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;
    if args.bill_type == BILL_TYPE_OPEN_BILL && !is_restaurant_pos_workspace(&session) {
        return Err(BridgeError::PermissionDenied(format!(
            "workspace '{}' may not create an open bill; only '{}' may",
            session.type_key,
            kasirmu_core::workspace_type::RESTAURANT_POS
        )));
    }
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let id = store.hold_cart(
        &args.label,
        &args.cart_data,
        args.item_count,
        args.total_minor,
        &args.currency,
        &args.bill_type,
        args.customer_name.as_deref(),
        args.deduction_location_id.as_deref(),
    )?;
    drop(db);
    tracing::info!(held_cart_id = %id, label = %args.label, "cart held (scoped)");
    Ok(HoldCartResult { id })
}

/// List held carts for the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
pub async fn list_held_carts_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<kasirmu_core::db::HeldCartRow>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let carts = store.list_held_carts()?;
    drop(db);
    Ok(carts)
}

/// List open bills for the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
///
/// # Terminal identity
///
/// Restaurant POS only. An open bill is that terminal's own concept — the
/// restaurant cart reads it as "Open Bills" while the retail cart reads
/// `list_held_carts_scoped` as "Held Carts" — so a session whose `type_key` is
/// not [`kasirmu_core::workspace_type::RESTAURANT_POS`] is refused rather than served an empty list,
/// which would read as "there are none" instead of "this is not your terminal".
pub async fn list_open_bills_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<kasirmu_core::db::HeldCartRow>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;
    if !is_restaurant_pos_workspace(&session) {
        return Err(BridgeError::PermissionDenied(format!(
            "workspace '{}' may not list open bills; only '{}' may",
            session.type_key,
            kasirmu_core::workspace_type::RESTAURANT_POS
        )));
    }
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let carts = store.list_open_bills()?;
    drop(db);
    Ok(carts)
}

/// Get a held cart from the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
pub async fn get_held_cart_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: String,
) -> Result<Option<kasirmu_core::db::HeldCartFull>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    let cart = store.get_held_cart(&id)?;
    drop(db);
    Ok(cart)
}

/// Delete a held cart in the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
pub async fn delete_held_cart_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: String,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);

    store.delete_held_cart(&id)?;
    drop(db);
    tracing::info!(held_cart_id = %id, "held cart deleted (scoped)");
    Ok(())
}
