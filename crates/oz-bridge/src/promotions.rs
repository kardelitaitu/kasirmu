//! Promotion command bodies (Wave D / D4b) — the tauri-free half of
//! `apps/desktop-client/src/commands/promotions.rs`.
//!
//! Promotion-rule CRUD, application against sales, and per-sale listing.
//! Note the deliberate gate asymmetry preserved verbatim from the shell:
//! `list`/`get`/`get_sale_promotions` resolve the store WITHOUT a
//! session gate, while `create`/`update`/`delete`/`apply` resolve
//! the session, gate on the promotion permission, and open the store db
//! directly via `ctx.db_manager.open_store` (parity-neutrality — the
//! shell's `state.db_manager.open_store` path, not `resolve_scope`).
//! The apply pipeline keeps the PROMO-3/4 atomic comment and the
//! `chrono::Utc::now()` clock at the call site.

use serde::Deserialize;

use oz_core::permissions;
use oz_core::{Promotion, PromotionApplication, Store};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

#[derive(Debug, Deserialize)]
/// Createpromotionargs.
pub struct CreatePromotionArgs {
    /// Display name.
    pub name: String,
    #[serde(default)]
    /// Human-readable description.
    pub description: String,
    /// Promo Type.
    pub promo_type: String,
    /// Value Minor.
    pub value_minor: i64,
    /// Min Qty.
    pub min_qty: Option<i64>,
    /// Trigger Sku.
    pub trigger_sku: Option<String>,
    /// Reward Sku.
    pub reward_sku: Option<String>,
    /// Reward Qty.
    pub reward_qty: Option<i64>,
    /// Starts At.
    pub starts_at: Option<String>,
    /// Ends At.
    pub ends_at: Option<String>,
    #[serde(default)]
    /// Min Order Minor.
    pub min_order_minor: i64,
    /// ID of the associated category.
    pub category_id: Option<String>,
    #[serde(default = "default_true")]
    /// Whether this record is active.
    pub active: bool,
}

fn default_true() -> bool {
    true
}

/// List promotions for the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] and [`BridgeError::Core`] on store
/// errors. Deliberately NOT permission-gated — preserved verbatim from
/// the shell.
pub async fn list_promotions_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<Promotion>, BridgeError> {
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let promos = store.list_promotions()?;
    drop(db);
    Ok(promos)
}

/// Get a promotion from the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] and [`BridgeError::Core`] on store
/// errors. Deliberately NOT permission-gated — preserved verbatim from
/// the shell.
pub async fn get_promotion_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<Option<Promotion>, BridgeError> {
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let promo = store.get_promotion(id)?;
    drop(db);
    Ok(promo)
}

/// Create a promotion in the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `promotions:create`,
/// [`BridgeError::Internal`] when the store db cannot be opened, and
/// [`BridgeError::Core`] on store errors.
pub async fn create_promotion_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: &CreatePromotionArgs,
) -> Result<Promotion, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PROMOTIONS_CREATE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let promo = Promotion {
        id: uuid::Uuid::now_v7().to_string(),
        name: args.name.clone(),
        description: args.description.clone(),
        promo_type: args.promo_type.clone(),
        value_minor: args.value_minor,
        min_qty: args.min_qty,
        trigger_sku: args.trigger_sku.clone(),
        reward_sku: args.reward_sku.clone(),
        reward_qty: args.reward_qty,
        starts_at: args.starts_at.clone(),
        ends_at: args.ends_at.clone(),
        min_order_minor: args.min_order_minor,
        category_id: args.category_id.clone(),
        active: args.active,
        created_at: now.clone(),
        updated_at: now,
    };

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.create_promotion(&promo)?;
    drop(db);
    Ok(result)
}

/// Update a promotion in the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `promotions:edit`,
/// [`BridgeError::Internal`] when the store db cannot be opened, and
/// [`BridgeError::Core`] on store errors.
pub async fn update_promotion_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    promotion: Promotion,
) -> Result<Promotion, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PROMOTIONS_EDIT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let mut p = promotion;
    p.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.update_promotion(&p)?;
    drop(db);
    Ok(result)
}

/// Delete a promotion in the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `promotions:delete`,
/// [`BridgeError::Internal`] when the store db cannot be opened, and
/// [`BridgeError::Core`] on store errors.
pub async fn delete_promotion_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PROMOTIONS_DELETE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.delete_promotion(id)?;
    drop(db);
    Ok(())
}

/// Apply a promotion in the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`],
/// [`BridgeError::PermissionDenied`] without `promotions:apply`,
/// [`BridgeError::Internal`] when the store db cannot be opened, and
/// the [`apply_promotion_unchecked`] error surface on store errors.
pub async fn apply_promotion_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sale_id: &str,
    promotion_id: &str,
) -> Result<PromotionApplication, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::PROMOTIONS_APPLY)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let result = apply_promotion_unchecked(&db, sale_id, promotion_id)?;
    drop(db);
    Ok(result)
}

/// Apply a promotion against a store-scoped database connection.
/// Scoped commands authorize the session against the global identity DB
/// before opening the store connection, then call this business path.
///
/// # Errors
///
/// [`BridgeError::Core`] on store errors (the engine-computed discount,
/// dedup guard, application row, and sale-total reduction run as one
/// transaction inside core).
pub fn apply_promotion_unchecked(
    db: &rusqlite::Connection,
    sale_id: &str,
    promotion_id: &str,
) -> Result<PromotionApplication, BridgeError> {
    // Atomic pipeline (PROMO-3/4): engine-computed discount, dedup guard,
    // application row, and the sale-total reduction — one transaction.
    Store::new(db)
        .apply_promotion_to_sale(sale_id, promotion_id, chrono::Utc::now())
        .map_err(Into::into)
}

/// Get sale promotions from the store resolved from a session token. ADR #7.
///
/// # Errors
///
/// [`BridgeError::InvalidSession`] and [`BridgeError::Core`] on store
/// errors. Deliberately NOT permission-gated — preserved verbatim from
/// the shell.
pub async fn get_sale_promotions_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    sale_id: &str,
) -> Result<Vec<PromotionApplication>, BridgeError> {
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let apps = store.get_promotion_applications_for_sale(sale_id)?;
    drop(db);
    Ok(apps)
}
