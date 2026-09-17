//! Product endpoints.
/*
last audited 25-07-26 by RSA-Agent (oz-api slice C: products deep read)
crate: oz-api | status: SAFE | lint: CLEAN
findings: clean dual-backend dispatch; tenant stamping via follow-up UPDATE with documented warn-only degrade (SQLite path); patch_stock uses the atomic Store adjust (previous_qty read is display-only); unknown tenant claim maps to "default" (legacy tokens) - INFO; typed CoreError→HTTP mapping
next: none | perf: N/A
*/
//!
//! `GET /api/v1/products` — list all products.
//! `GET /api/v1/products/:sku` — product detail including stock quantity.
//! `POST /api/v1/products` — create a new product.
//! `PATCH /api/v1/products/:sku/stock` — adjust stock quantity.

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use kasirmu_core::db::Store;
use kasirmu_core::{CoreError, ProductWithDetails};

use crate::AppState;
use crate::auth::ApiTokenClaims;
use crate::routes::tokens::require_admin_write;

// ── Error mapping ─────────────────────────────────────────────────────

/// Convert a [`CoreError`] from the Store into an HTTP response.
fn store_error_response(e: CoreError) -> Response {
    match e {
        CoreError::Validation { message, .. } => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": message})),
        )
            .into_response(),
        CoreError::Conflict { .. } => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "resource already exists"})),
        )
            .into_response(),
        CoreError::NotFound { .. } => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "not found"})),
        )
            .into_response(),
        e => {
            tracing::error!("unexpected store error: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

// ── Request / Response types ──────────────────────────────────────────

/// Response body for the list-products endpoint (spec 0046b §3.4).
/// Wraps the product array with the server-side `missing_hashes` nudge
/// so the desktop knows exactly which hashes the cloud still lacks.
#[derive(Serialize)]
pub struct ListProductsResponse {
    /// The tenant's products with category name, stock, and image assignments.
    pub products: Vec<ProductWithDetails>,
    /// Hashes referenced by the tenant's products but absent from the
    /// cloud's image store (`image_refs`). Desktop pushes these first.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub missing_hashes: Vec<String>,
}

/// Request body for creating a new product.
#[derive(Deserialize)]
pub struct CreateProductRequest {
    /// Unique product SKU.
    pub sku: String,
    /// Product display name.
    pub name: String,
    /// Base unit price.
    pub price: kasirmu_core::Money,
    /// Optional category ID.
    pub category_id: Option<String>,
    /// Optional barcode string.
    pub barcode: Option<String>,
    /// Initial stock quantity (>= 0). If omitted or zero, no inventory row is inserted.
    pub initial_stock: Option<i64>,
}

/// Request body for adjusting stock.
#[derive(Deserialize)]
pub struct PatchStockRequest {
    /// Positive to restock, negative to sell.
    pub delta: i64,
}

/// Response after a successful stock adjustment.
#[derive(Serialize)]
pub struct PatchStockResponse {
    /// The product SKU that was adjusted.
    pub sku: String,
    /// Stock quantity before the adjustment.
    pub previous_qty: i64,
    /// Stock quantity after the adjustment.
    pub new_qty: i64,
}

// ── Handlers ──────────────────────────────────────────────────────────

/// List the authenticated tenant's products, ordered by name, with category
/// name, stock, and the `missing_hashes` nudge (spec 0046b §3.4).
pub async fn list_products(
    State(state): State<AppState>,
    Extension(claims): Extension<ApiTokenClaims>,
) -> Response {
    if let Some(pool) = &state.pg {
        let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");
        return match crate::pg::list_products(pool, tenant_id).await {
            Ok(products) => {
                // ADVISORY, deliberately: `missing_hashes` is a push-priority
                // nudge only — the desktop uploads what its OWN queue holds
                // (platform/sync/src/image_push.rs `peek_push_batch`), and this
                // list merely reorders it — so a failed lookup must not take the
                // product listing down with it. The cost is that an empty list
                // here is AMBIGUOUS: "nothing is missing" or "the lookup
                // failed". The warning is how you tell them apart; keep it loud.
                let missing = match crate::pg::list_missing_hashes(
                    pool,
                    tenant_id,
                    &collect_image_hashes(&products),
                )
                .await
                {
                    Ok(missing) => missing,
                    Err(e) => {
                        tracing::warn!(
                            tenant_id,
                            operation = "pg::list_missing_hashes",
                            error = %e,
                            "products list: missing-hash lookup failed, omitting the nudge (advisory: desktop falls back to queue order)"
                        );
                        Vec::new()
                    }
                };
                Json(ListProductsResponse {
                    products,
                    missing_hashes: missing,
                })
                .into_response()
            }
            Err(e) => e.into_response(),
        };
    }
    let db = state.db.lock().await;
    let store = Store::new(&db);

    match store.list_products() {
        Ok(products) => {
            let hashes = collect_image_hashes(&products);
            let hash_refs: Vec<&str> = hashes.iter().map(String::as_str).collect();
            // Same advisory contract as the PG branch above: an empty list here
            // means either "nothing is missing" or "the lookup failed", and the
            // warning is the only way to tell them apart.
            let missing = match store.missing_hashes("default", &hash_refs) {
                Ok(missing) => missing.into_iter().map(str::to_owned).collect(),
                Err(e) => {
                    tracing::warn!(
                        operation = "Store::missing_hashes",
                        error = %e,
                        "products list: missing-hash lookup failed, omitting the nudge (advisory: desktop falls back to queue order)"
                    );
                    Vec::new()
                }
            };
            Json(ListProductsResponse {
                products,
                missing_hashes: missing,
            })
            .into_response()
        }
        Err(e) => store_error_response(e),
    }
}

/// Collect every content hash referenced by the products' image assignments.
fn collect_image_hashes(products: &[ProductWithDetails]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for p in products {
        for img in &p.images {
            if seen.insert(img.hash.clone()) {
                out.push(img.hash.clone());
            }
        }
    }
    out
}

/// Get a single product by SKU, including category name and stock.
///
/// Returns JSON `null` when the product is not found.
pub async fn get_product(
    State(state): State<AppState>,
    Extension(claims): Extension<ApiTokenClaims>,
    Path(sku): Path<String>,
) -> Response {
    if let Some(pool) = &state.pg {
        let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");
        return match crate::pg::get_product(pool, tenant_id, &sku).await {
            Ok(Some(p)) => Json(Some(p)).into_response(),
            Ok(None) => Json(None as Option<ProductWithDetails>).into_response(),
            Err(e) => e.into_response(),
        };
    }
    let db = state.db.lock().await;
    let store = Store::new(&db);

    match store.get_product(&sku) {
        Ok(Some(p)) => Json(Some(p)).into_response(),
        Ok(None) => Json(None as Option<ProductWithDetails>).into_response(),
        Err(e) => store_error_response(e),
    }
}

/// Create a new product.
///
/// Accepts a `CreateProductRequest` JSON body. Validation (empty SKU,
/// empty name, negative price, negative stock) is handled by the Store,
/// returning 400 on failure. Returns 201 with the created product.
///
/// The `tenant_id` from the JWT claims is stamped on the product row
/// so the cloud server's snapshot endpoint can scope products per tenant.
pub async fn create_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<ApiTokenClaims>,
    Json(body): Json<CreateProductRequest>,
) -> Response {
    // D1 residual (API-4): product creation mutates money-relevant master
    // data — gate on the operator admin key + reject terminal credentials.
    if let Err(resp) = require_admin_write(&headers, &claims, state.admin_key.as_deref()) {
        return resp;
    }

    let initial_stock = body.initial_stock.unwrap_or(0);
    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");

    if let Some(pool) = &state.pg {
        return match crate::pg::create_product(
            pool,
            tenant_id,
            &body.sku,
            &body.name,
            body.price,
            body.category_id.as_deref(),
            body.barcode.as_deref(),
            initial_stock,
        )
        .await
        {
            Ok(detail) => (StatusCode::CREATED, Json(detail)).into_response(),
            Err(e) => e.into_response(),
        };
    }

    let db = state.db.lock().await;
    let store = Store::new(&db);

    // Quota: enforce the tier's product cap (subscription-tiers.md
    // §Numeric Limits) against the same SQLite fallback DB. The cloud DB
    // carries the tenant_subscription row (mirrored by the generated PG
    // schema), so the effective tier resolves here directly. An unknown
    // or tampered subscription fails closed at the Free cap.
    let tier = kasirmu_core::TenantSubscription::load(&db, tenant_id)
        .ok()
        .flatten()
        .map(|sub| match sub.verify_signature() {
            Ok(()) => sub.effective_tier(),
            Err(_) => kasirmu_core::SubscriptionTier::Free,
        })
        .unwrap_or(kasirmu_core::SubscriptionTier::Free);
    if let Err(e) = store.enforce_product_quota(&tier) {
        // 402 Payment Required — the resource exists; the tier does not
        // cover it. Matches the SubscriptionLimitExceeded messaging the
        // IPC layer surfaces with an upgrade CTA.
        return (
            StatusCode::PAYMENT_REQUIRED,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response();
    }

    match store.create_product(
        &body.sku,
        &body.name,
        body.price,
        body.category_id.as_deref(),
        body.barcode.as_deref(),
        initial_stock,
        None,
    ) {
        Ok(product) => {
            // Stamp tenant_id from the JWT so snapshot filtering works.
            if let Err(e) = db.execute(
                "UPDATE products SET tenant_id = ?1 WHERE sku = ?2",
                rusqlite::params![tenant_id, body.sku],
            ) {
                tracing::warn!(
                    tenant_id = tenant_id,
                    sku = %body.sku,
                    error = %e,
                    "failed to stamp tenant_id on product — snapshot scoping may be affected"
                );
            }
            let detail = ProductWithDetails {
                product,
                category_name: None,
                stock_qty: if initial_stock > 0 {
                    Some(initial_stock)
                } else {
                    None
                },
                popularity_score: 0.0,
                images: Vec::new(),
            };
            (StatusCode::CREATED, Json(detail)).into_response()
        }
        Err(e) => store_error_response(e),
    }
}

/// Adjust stock for a product by SKU.
///
/// Accepts `{ "delta": +/-N }`. The Store handles validation, the
/// `checked_add` / `>=0` guard, and the atomic upsert. Returns 200
/// with previous and new quantities.
///
/// Status codes:
/// - 200 — stock adjusted successfully
/// - 404 — product not found
/// - 422 — adjustment would cause negative stock
#[allow(deprecated)]
pub async fn patch_stock(
    State(state): State<AppState>,
    headers: HeaderMap,
    Extension(claims): Extension<ApiTokenClaims>,
    Path(sku): Path<String>,
    Json(body): Json<PatchStockRequest>,
) -> Response {
    // D1 residual (API-4): stock adjustment mutates money-relevant master
    // data — gate on the operator admin key + reject terminal credentials.
    if let Err(resp) = require_admin_write(&headers, &claims, state.admin_key.as_deref()) {
        return resp;
    }

    if let Some(pool) = &state.pg {
        let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");
        return match crate::pg::adjust_stock(pool, tenant_id, &sku, body.delta).await {
            Ok(adj) => {
                let response = PatchStockResponse {
                    sku,
                    previous_qty: adj.previous_qty,
                    new_qty: adj.new_qty,
                };
                Json(response).into_response()
            }
            Err(crate::pg::PgError::Validation(_)) => {
                // Oversell or overflow -> 422 with details.
                (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    Json(serde_json::json!({
                        "error": "adjustment would cause negative stock",
                        "previous_qty": null,
                        "delta": body.delta,
                    })),
                )
                    .into_response()
            }
            Err(e) => e.into_response(),
        };
    }

    let db = state.db.lock().await;
    let store = Store::new(&db);

    // Read previous stock while we still have it.
    let product = match store.get_product(&sku) {
        Ok(Some(p)) => p,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "product not found"})),
            )
                .into_response();
        }
        Err(e) => return store_error_response(e),
    };
    let previous_qty = product.stock_qty.unwrap_or(0);

    match store.adjust_stock(&sku, body.delta) {
        Ok(new_qty) => {
            let response = PatchStockResponse {
                sku,
                previous_qty,
                new_qty,
            };
            Json(response).into_response()
        }
        Err(CoreError::Validation { .. }) => {
            // Oversell or overflow -> 422 with details.
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({
                    "error": "adjustment would cause negative stock",
                    "previous_qty": previous_qty,
                    "delta": body.delta,
                })),
            )
                .into_response()
        }
        Err(e) => store_error_response(e),
    }
}

#[cfg(test)]
#[path = "products_tests.rs"]
mod tests;
