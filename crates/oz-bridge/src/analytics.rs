//! Analytics bridge module (Wave E).
//!
//! Bodies extracted verbatim from
//! apps/desktop-client/src/commands/analytics.rs (Wave E slice E8). The
//! only rewrites are mechanical: `state.*` → `ctx.*` and `AppError::` →
//! `BridgeError::`. Gate order (session resolve → scope-aware gate →
//! global name-map block → store open) and SQL are byte-identical.

use std::collections::HashMap;

use serde::Serialize;

use oz_core::db::Store;
use oz_core::permissions;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// Per-staff analytics row as seen by the front-end.
#[derive(Debug, Serialize)]
pub struct StaffAnalyticsDto {
    /// Staff member id (cashier).
    pub user_id: String,
    /// Display name resolved from the global identity DB.
    pub display_name: String,
    /// Number of shifts opened in the range.
    pub shift_count: i64,
    /// Number of those shifts closed.
    pub closed_shift_count: i64,
    /// Sum of shift `total_sales_minor` in the range.
    pub shift_sales_minor: i64,
    /// Number of completed sales in the range.
    pub sale_count: i64,
    /// Sum of completed `sales.total_minor` in the range.
    pub sale_total_minor: i64,
}

/// Per-day series row for one staff member.
#[derive(Debug, Serialize)]
pub struct StaffAnalyticsDailyDto {
    /// `YYYY-MM-DD`.
    pub day: String,
    /// Completed sales attributed to the staff member that day.
    pub sale_count: i64,
    /// Sum of `sales.total_minor` for those sales.
    pub sale_total_minor: i64,
    /// Shifts opened that day.
    pub shift_count: i64,
    /// Sum of `shifts.total_sales_minor` for those shifts.
    pub shift_sales_minor: i64,
}

/// Per-staff shift + sales summary for the session's store over `[from, to]`.
pub async fn get_staff_analytics_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    from: String,
    to: String,
) -> Result<Vec<StaffAnalyticsDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::ANALYTICS_VIEW)
        .await?;

    // Staff display names live in the GLOBAL identity DB; the aggregates in
    // the store-scoped DB. Resolve the name map before opening the store.
    let display_names: HashMap<String, String> = {
        let db = ctx.lock_global().await;
        let store = Store::new(&db);
        store
            .list_users()?
            .into_iter()
            .map(|u| (u.id, u.display_name))
            .collect()
    };

    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let rows = store.staff_analytics_summary(&from, &to)?;
    drop(db);

    Ok(rows
        .into_iter()
        .map(|r| StaffAnalyticsDto {
            user_id: r.user_id.clone(),
            display_name: display_names.get(&r.user_id).cloned().unwrap_or_else(|| {
                // A user row can be deleted while shifts/sales survive; show
                // the id rather than leaking a fabricated name.
                r.user_id.clone()
            }),
            shift_count: r.shift_count,
            closed_shift_count: r.closed_shift_count,
            shift_sales_minor: r.shift_sales_minor,
            sale_count: r.sale_count,
            sale_total_minor: r.sale_total_minor,
        })
        .collect())
}

/// Per-day shift + sales series for one staff member over `[from, to]`.
pub async fn get_staff_analytics_daily_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    user_id: String,
    from: String,
    to: String,
) -> Result<Vec<StaffAnalyticsDailyDto>, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::ANALYTICS_VIEW)
        .await?;

    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let rows = store.staff_analytics_daily(&user_id, &from, &to)?;
    drop(db);

    Ok(rows
        .into_iter()
        .map(|r| StaffAnalyticsDailyDto {
            day: r.day,
            sale_count: r.sale_count,
            sale_total_minor: r.sale_total_minor,
            shift_count: r.shift_count,
            shift_sales_minor: r.shift_sales_minor,
        })
        .collect())
}
