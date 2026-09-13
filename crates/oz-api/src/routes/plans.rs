//! Tenant plan administration (ADR sync-plan-gating).
//!
//! `PUT /api/v1/tenants/{tenant_id}/plan` — set a tenant's cloud sync plan.
//! Gated by the same `OZ_ADMIN_KEY` as token minting (P2): when the admin
//! key is configured, the `X-Admin-Key` header must match; in dev mode
//! (no admin key) the endpoint is open so local setups can assign plans.

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use oz_core::TenantPlan;
use oz_core::db::Store;

use crate::AppState;
use crate::auth::ApiTokenClaims;
use crate::routes::tokens::admin_key_authorised;
use crate::routes::validate::valid_tenant;

/// Request body for setting a tenant's plan.
#[derive(Deserialize)]
pub struct SetPlanRequest {
    /// `free` or `pro`. Unknown values are rejected (fail closed).
    pub plan: String,
}

/// `GET /api/v1/tenants/me/plan` — read the caller's own sync plan.
///
/// The tenant is taken from the JWT claims (never the URL, so a tenant
/// cannot spoof another tenant's plan state). A tenant with no plan row is
/// reported as `free` — the same fail-closed default the sync
/// `plan_middleware` applies, so the panel shows the effective plan.
/// Unlike the sync router this endpoint is NOT plan-gated: a free tenant
/// must be able to read its own plan to render the upgrade prompt.
pub async fn get_my_plan_handler(
    State(state): State<AppState>,
    Extension(claims): Extension<ApiTokenClaims>,
) -> Response {
    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");

    let plan = if let Some(pool) = &state.pg {
        match crate::pg::get_tenant_plan(pool, tenant_id).await {
            Ok(Some(plan)) => plan,
            Ok(None) => TenantPlan::Free,
            Err(e) => {
                tracing::error!(error = %e, tenant_id, "reading tenant plan failed");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "plan_read_failed"})),
                )
                    .into_response();
            }
        }
    } else {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        match store.get_tenant_plan(tenant_id) {
            Ok(Some(plan)) => plan,
            Ok(None) => TenantPlan::Free,
            Err(e) => {
                tracing::error!(error = %e, tenant_id, "reading tenant plan failed");
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "plan_read_failed"})),
                )
                    .into_response();
            }
        }
    };

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "tenant_id": tenant_id,
            "plan": plan.as_db_str(),
        })),
    )
        .into_response()
}

/// `PUT /api/v1/tenants/{tenant_id}/plan` — assign or change a tenant's plan.
///
/// Returns 401 when an admin key is configured but missing/mismatched, 400
/// for an unknown plan name, 200 with the stored plan on success.
pub async fn set_tenant_plan_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(tenant_id): Path<String>,
    Json(body): Json<SetPlanRequest>,
) -> Response {
    if !admin_key_authorised(&headers, state.admin_key.as_deref()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid_admin_key"})),
        )
            .into_response();
    }

    if !valid_tenant(&tenant_id) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid_tenant", "tenant": tenant_id})),
        )
            .into_response();
    }

    let plan = match body.plan.as_str() {
        "free" => TenantPlan::Free,
        "pro" => TenantPlan::Pro,
        other => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "unknown_plan",
                    "plan": other,
                    "supported": ["free", "pro"],
                })),
            )
                .into_response();
        }
    };

    if let Some(pool) = &state.pg {
        return match crate::pg::set_tenant_plan(pool, &tenant_id, plan).await {
            Ok(()) => (
                StatusCode::OK,
                Json(serde_json::json!({
                    "tenant_id": tenant_id,
                    "plan": plan.as_db_str(),
                })),
            )
                .into_response(),
            Err(e) => {
                tracing::error!(error = %e, tenant_id = %tenant_id, "setting tenant plan failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "plan_update_failed"})),
                )
                    .into_response()
            }
        };
    }

    let db = state.db.lock().await;
    let store = Store::new(&db);
    match store.set_tenant_plan(&tenant_id, plan) {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "tenant_id": tenant_id,
                "plan": plan.as_db_str(),
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, tenant_id = %tenant_id, "setting tenant plan failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "plan_update_failed"})),
            )
                .into_response()
        }
    }
}

#[cfg(test)]
#[path = "plans_tests.rs"]
mod tests;
