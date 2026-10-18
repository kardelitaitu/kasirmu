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
//! [`is_restaurant_pos_workspace`] gates **all five commands** fail-closed against the
//! session type_key, never the request bill_type.
//!
//! ⚠️ THE LIST OF GATED COMMANDS IS THE POINT OF THIS PARAGRAPH, and it used to name
//! only two of the five. When it said "gates creation AND listing" that was accurate and
//! it made the other three look unremarkable — which is how `list_held_carts_scoped`
//! came to serve a retail terminal the restaurant's open bills (round 302), and then how
//! `get_held_cart_scoped` and `delete_held_cart_scoped` came to serve and *destroy* them
//! by id (round 303). A doc that understates the enforcement is how the next command
//! gets added without it.
//!
//! The five, and the shape of each gate:
//!
//! | Command | Gate |
//! |---|---|
//! | [`hold_cart_scoped`] | refuses an `open_bill` from a non-restaurant session |
//! | [`list_held_carts_scoped`] | non-restaurant sessions get `open_bill` rows excluded |
//! | [`list_open_bills_scoped`] | restaurant sessions only |
//! | [`get_held_cart_scoped`] | [`refuse_cross_vertical_open_bill`] on the id |
//! | [`delete_held_cart_scoped`] | the same, checked BEFORE the delete |
//!
//! **A SIXTH COMMAND MUST PICK ITS SHAPE FROM THIS TABLE.** Three of the five are only
//! reachable through an id, so "it is not in the list" is not a defence — that was the
//! exact reasoning that left two of them open.

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
    if let Some(emitter) = &ctx.emitter {
        emitter.emit("tabs:changed", serde_json::Value::Null);
    }
    Ok(HoldCartResult { id })
}

/// List held carts for the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
///
/// # Terminal identity
///
/// **Open bills are excluded for every workspace that is not Restaurant POS.** An open
/// bill is that vertical's concept — the restaurant cart reads them as "Open Bills"
/// while a retail cart reads this command as "Held Carts" — so a store-pos session
/// asking for its held carts must not receive the restaurant's open tabs.
///
/// ⚠️ This was MEASURED against the unfiltered query before the fix:
///
/// ```text
/// PROBE total=1 open_bills_visible=1 our_id_visible=true
/// ```
///
/// The two commands that look like the boundary were both already gated —
/// [`hold_cart_scoped`] refuses to create an open bill off a restaurant terminal, and
/// [`list_open_bills_scoped`] refuses to list them. This one sat between them with
/// neither, and the only thing hiding it was a front-end filter
/// (retail POS: `carts.filter((c) => c.bill_type === 'hold')`) — a UI
/// convenience, not an authorization boundary. Any other caller of this command
/// inherited none of it.
///
/// Restaurant POS itself is unchanged: it receives every row, because the open bills
/// are its own.
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

    // The exclusion is applied HERE, where the session's vertical is known, rather than
    // by each caller — see the doc above for the measurement that made it necessary.
    let carts = if is_restaurant_pos_workspace(&session) {
        store.list_held_carts()?
    } else {
        store.list_held_carts_excluding_open_bills()?
    };
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

/// Refuse an `open_bill` id to a session that is not Restaurant POS.
///
/// The BY-ID counterpart of the list gate in [`list_held_carts_scoped`]. Creation and
/// listing were gated; reading and deleting by id were not, so a retail terminal could
/// fetch a restaurant's open bill — `cart_data` included — and then destroy it. Measured
/// before the fix:
///
/// ```text
/// PROBE get_ok=true leaked=Some("{\"secret\":true}") delete_ok=true restaurant_still_has_it=false
/// ```
///
/// The id is not secret (UUIDv7 is guess-resistant, not access-controlled), and relying on
/// the caller not having one is the same reasoning round 302 rejected for the list: a
/// front-end filter is not a boundary, and the next caller inherits none of it.
///
/// # Errors
///
/// `PermissionDenied` when the row exists, is an `open_bill`, and the session is not
/// Restaurant POS. A plain `hold` is unrestricted in every vertical — the gate is about the
/// restaurant concept, not about held carts in general.
fn refuse_cross_vertical_open_bill(
    store: &Store<'_>,
    session: &kasirmu_core::session::SessionContext,
    id: &str,
) -> Result<(), BridgeError> {
    if is_restaurant_pos_workspace(session) {
        return Ok(());
    }
    // A missing row is not a breach: `get` answers `None` and `delete` is a no-op, both
    // of which are already the callers' expectations for an unknown id.
    let Some(row) = store.get_held_cart(id)? else {
        return Ok(());
    };
    if row.bill_type == BILL_TYPE_OPEN_BILL {
        return Err(BridgeError::PermissionDenied(format!(
            "workspace '{}' may not access an open bill; only '{}' may",
            session.type_key,
            kasirmu_core::workspace_type::RESTAURANT_POS
        )));
    }
    Ok(())
}

/// Get a held cart from the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
///
/// # Terminal identity
///
/// An `open_bill` is refused to every non-Restaurant-POS session — see
/// `refuse_cross_vertical_open_bill` (private to this module).
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

    refuse_cross_vertical_open_bill(&store, &session, &id)?;
    let cart = store.get_held_cart(&id)?;
    drop(db);
    Ok(cart)
}

/// Delete a held cart in the store resolved from a session token. ADR #7.
///
/// Requires `SALES_PROCESS` permission.
///
/// # Terminal identity
///
/// An `open_bill` is refused to every non-Restaurant-POS session, checked before the
/// delete so a refusal is not destructive — see `refuse_cross_vertical_open_bill`.
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

    // Checked BEFORE the delete, so a refused call leaves the row untouched rather than
    // removing it and reporting afterwards.
    refuse_cross_vertical_open_bill(&store, &session, &id)?;
    store.delete_held_cart(&id)?;
    drop(db);
    tracing::info!(held_cart_id = %id, "held cart deleted (scoped)");
    if let Some(emitter) = &ctx.emitter {
        emitter.emit("tabs:changed", serde_json::Value::Null);
    }
    Ok(())
}
