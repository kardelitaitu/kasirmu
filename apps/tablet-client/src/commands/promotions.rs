//! Promotion management commands (tablet mirror).

use serde::Deserialize;
use tauri::{State, command};

use oz_core::{Promotion, PromotionApplication, Store};

use crate::commands::authz::{require_permission_for_session, require_permission_for_user};
use crate::error::AppError;
use crate::state::AppState;

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

#[command]
/// List promotions.
pub async fn list_promotions(state: State<'_, AppState>) -> Result<Vec<Promotion>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    Ok(store.list_promotions()?)
}

#[command]
/// Get promotion.
pub async fn get_promotion(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Promotion>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    Ok(store.get_promotion(&id)?)
}

#[command]
/// Create promotion.
pub async fn create_promotion(
    user_id: String,
    args: CreatePromotionArgs,
    state: State<'_, AppState>,
) -> Result<Promotion, AppError> {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let promo = Promotion {
        id: uuid::Uuid::now_v7().to_string(),
        name: args.name,
        description: args.description,
        promo_type: args.promo_type,
        value_minor: args.value_minor,
        min_qty: args.min_qty,
        trigger_sku: args.trigger_sku,
        reward_sku: args.reward_sku,
        reward_qty: args.reward_qty,
        starts_at: args.starts_at,
        ends_at: args.ends_at,
        min_order_minor: args.min_order_minor,
        category_id: args.category_id,
        active: args.active,
        created_at: now.clone(),
        updated_at: now,
    };

    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &user_id, oz_core::permissions::PROMOTIONS_CREATE)?;
    Ok(store.create_promotion(&promo)?)
}

#[command]
/// Update promotion.
pub async fn update_promotion(
    user_id: String,
    promotion: Promotion,
    state: State<'_, AppState>,
) -> Result<Promotion, AppError> {
    let mut p = promotion;
    p.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &user_id, oz_core::permissions::PROMOTIONS_EDIT)?;
    Ok(store.update_promotion(&p)?)
}

#[command]
/// Delete promotion.
pub async fn delete_promotion(
    user_id: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &user_id, oz_core::permissions::PROMOTIONS_DELETE)?;
    Ok(store.delete_promotion(&id)?)
}

/// Shared promotion-application pipeline: engine-computed discount, dedup
/// guard, application row, and the sale-total reduction — one transaction
/// in oz-core (single source of truth, PROMO-3/4/7).
fn run_apply_promotion_unchecked(
    db: &rusqlite::Connection,
    sale_id: &str,
    promotion_id: &str,
) -> Result<PromotionApplication, AppError> {
    Store::new(db)
        .apply_promotion_to_sale(sale_id, promotion_id, chrono::Utc::now())
        .map_err(AppError::from)
}

#[command]
/// Apply promotion.
pub async fn apply_promotion(
    user_id: String,
    sale_id: String,
    promotion_id: String,
    state: State<'_, AppState>,
) -> Result<PromotionApplication, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);

    require_permission_for_user(&store, &user_id, oz_core::permissions::PROMOTIONS_APPLY)?;

    run_apply_promotion_unchecked(&db, &sale_id, &promotion_id)
}

#[command]
/// Get sale promotions.
pub async fn get_sale_promotions(
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PromotionApplication>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    Ok(store.get_promotion_applications_for_sale(&sale_id)?)
}

/// Session-scoped variant of `list_promotions`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_promotions_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<Promotion>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    Ok(store.list_promotions()?)
}

/// Session-scoped variant of `get_promotion`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_promotion_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Promotion>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    Ok(store.get_promotion(&id)?)
}

/// Session-scoped variant of `create_promotion`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn create_promotion_scoped(
    session_token: String,
    args: CreatePromotionArgs,
    state: State<'_, AppState>,
) -> Result<Promotion, AppError> {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let promo = Promotion {
        id: uuid::Uuid::now_v7().to_string(),
        name: args.name,
        description: args.description,
        promo_type: args.promo_type,
        value_minor: args.value_minor,
        min_qty: args.min_qty,
        trigger_sku: args.trigger_sku,
        reward_sku: args.reward_sku,
        reward_qty: args.reward_qty,
        starts_at: args.starts_at,
        ends_at: args.ends_at,
        min_order_minor: args.min_order_minor,
        category_id: args.category_id,
        active: args.active,
        created_at: now.clone(),
        updated_at: now,
    };

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::PROMOTIONS_CREATE)
        .await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    Ok(store.create_promotion(&promo)?)
}

/// Session-scoped variant of `update_promotion`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_promotion_scoped(
    session_token: String,
    promotion: Promotion,
    state: State<'_, AppState>,
) -> Result<Promotion, AppError> {
    let mut p = promotion;
    p.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::PROMOTIONS_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    Ok(store.update_promotion(&p)?)
}

/// Session-scoped variant of `delete_promotion`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn delete_promotion_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::PROMOTIONS_DELETE)
        .await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    Ok(store.delete_promotion(&id)?)
}

/// Session-scoped variant of `apply_promotion`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn apply_promotion_scoped(
    session_token: String,
    sale_id: String,
    promotion_id: String,
    state: State<'_, AppState>,
) -> Result<PromotionApplication, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::PROMOTIONS_APPLY)
        .await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    // The `Store` binding this line replaced existed only to serve the
    // permission check; the gate now runs on the session before the lock is
    // taken, and the apply itself goes through `run_apply_promotion_unchecked`.
    run_apply_promotion_unchecked(db, &sale_id, &promotion_id)
}

/// Session-scoped variant of `get_sale_promotions`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_sale_promotions_scoped(
    session_token: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PromotionApplication>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    Ok(store.get_promotion_applications_for_sale(&sale_id)?)
}

#[cfg(test)]
#[path = "promotions_tests.rs"]
mod tests;
