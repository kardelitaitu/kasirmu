//! Sale endpoints.
/*
last audited 25-07-26 by RSA-Agent (oz-api slice C: sales deep read)
crate: oz-api | status: SAFE | lint: CLEAN
findings: clean — currency inferred from first line and enforced per-line by Cart, checked total (overflow -> 422), header+lines in one tx, typed status transitions; unit prices are client-supplied (automation API contract — any valid token can book sales at arbitrary prices; documented INFO note)
next: none | perf: N/A
*/
//!
//! `POST /api/v1/sales` — create a sale from cart lines, behind the
//! `Idempotency-Key` guard: an opaque client-supplied key, bound to the sale it
//! created, so a retry replays that sale (200 + the original body) instead of
//! booking a second one. Absent, empty or whitespace-only means unguarded and
//! keeps answering 201 with a new sale; the key is never parsed beyond the
//! blank test, never normalised, and never minted server-side. Request content
//! is never a deduplication input. Scope is (tenant_id, key) on both branches
//! — see `crates/kasirmu-core/migrations/20261001_sale_idempotency.sql`.
//! `PATCH /api/v1/sales/{id}/status` — transition sale status.
//! `GET /api/v1/sales/{id}` — get sale detail with line items.

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use oz_core::db::Store;
use oz_core::{Cart, CartLine, CoreError, Money, Sale, SaleStatus, Sku};

use crate::AppState;
use crate::auth::ApiTokenClaims;

// ── Error mapping ─────────────────────────────────────────────────────

fn store_error_response(e: CoreError) -> Response {
    match e {
        CoreError::Validation { message, .. } => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": message})),
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

/// Request body for creating a sale.
#[derive(Deserialize)]
pub struct CreateSaleRequest {
    /// Line items for the sale.
    pub lines: Vec<CreateSaleLine>,
}

/// A single line item in a create-sale request.
#[derive(Deserialize)]
pub struct CreateSaleLine {
    /// Product SKU.
    pub sku: String,
    /// Quantity (must be > 0).
    pub qty: i64,
    /// Unit price for this line.
    pub unit_price: Money,
}

/// Request body for updating sale status.
#[derive(Deserialize)]
pub struct UpdateSaleStatusRequest {
    /// Target status (kebab-case, e.g. `"active"`, `"completed"`, `"voided"`).
    pub status: SaleStatus,
}

/// Response after a status update.
#[derive(Serialize)]
pub struct SaleStatusResponse {
    /// Sale ID.
    pub id: String,
    /// Updated sale status.
    pub status: SaleStatus,
    /// ISO-8601 timestamp of the update.
    pub updated_at: String,
}

// ── Handlers ──────────────────────────────────────────────────────────

// ──────────────────── Idempotency guard ────────────────────

/// Request header carrying the opaque client-supplied idempotency key.
pub const IDEMPOTENCY_KEY_HEADER: &str = "idempotency-key";

/// Longest key the guard accepts, in bytes.
///
/// The key is opaque and never interpreted, so the cap exists only to stop a
/// hostile client turning the receipt table into a blob store.
pub const IDEMPOTENCY_KEY_MAX_LEN: usize = 200;

/// Read the guard key out of the request headers.
///
/// Absent, empty and whitespace-only all yield `None` (unguarded). A present value
/// is used EXACTLY as handed over — no trimming, no case folding, no
/// re-formatting — because a replay is matched by exact equality, and any
/// normalisation here would silently split one client key into two slots. The
/// blank test is the only thing that looks inside the string, which is why an
/// all-whitespace key becomes unguarded instead of a stored key.
fn guard_key(headers: &HeaderMap) -> Option<&str> {
    let raw = headers
        .get(IDEMPOTENCY_KEY_HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.trim().is_empty())?;
    Some(raw)
}

/// Reject a key that cannot be stored, BEFORE any lookup or write.
///
/// Accepts an absent key. A present key must fit `IDEMPOTENCY_KEY_MAX_LEN` bytes and
/// the opaque-token charset; anything else is a 400, because silently ignoring
/// it would hand back a 201 for a request the client believed was protected.
/// Never re-keys and never substitutes a different key for the client.
fn guard_key_reject(key: Option<&str>) -> Option<String> {
    let k = key?;
    if k.len() > IDEMPOTENCY_KEY_MAX_LEN {
        return Some("idempotency key too long".into());
    }
    if !k
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-'))
    {
        return Some("idempotency key must be opaque token characters only".into());
    }
    None
}

/// SQLite half of the guard, on the connection the handler already locks.
///
/// `AppState.db` is one `Arc<Mutex<Connection>>`, so a claim and the ledger write it
/// guards cannot interleave with another request's — the pair is serialised by
/// the lock, and only a genuine slot conflict (an earlier, already-acked
/// request) can make the insert affect zero rows. No race handling is needed
/// here for exactly that reason, and none is invented.
fn claim_sqlite(
    db: &rusqlite::Connection,
    tenant_id: &str,
    key: &str,
    sale_id: &str,
) -> Result<crate::pg::SaleClaim, rusqlite::Error> {
    let tx = db.unchecked_transaction()?;
    let held = tx.execute(
        "INSERT INTO sale_idempotency (tenant_id, key, sale_id) VALUES (?1, ?2, ?3)
         ON CONFLICT (tenant_id, key) DO NOTHING",
        params![tenant_id, key, sale_id],
    )?;
    if held == 1 {
        tx.commit()?;
        return Ok(crate::pg::SaleClaim::Held);
    }
    let winner = tx
        .query_row(
            "SELECT sale_id FROM sale_idempotency WHERE tenant_id = ?1 AND key = ?2",
            params![tenant_id, key],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    tx.commit()?;
    Ok(match winner {
        Some(id) => crate::pg::SaleClaim::Replay(id),
        None => crate::pg::SaleClaim::Held,
    })
}

/// Release a SQLite slot whose sale write failed, so a retry is not locked out
/// by a receipt naming a sale that does not exist.
fn release_sqlite(
    db: &rusqlite::Connection,
    tenant_id: &str,
    key: &str,
    sale_id: &str,
) -> Result<(), rusqlite::Error> {
    let tx = db.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM sale_idempotency WHERE tenant_id = ?1 AND key = ?2 AND sale_id = ?3",
        params![tenant_id, key, sale_id],
    )?;
    tx.commit()
}

/// Record an unguarded sale (no usable key) as a NULL-keyed row: bookkeeping
/// only. NULL is distinct in the unique index in both engines, so such a row
/// can never resolve or block a later request.
fn note_unguarded_sqlite(
    db: &rusqlite::Connection,
    tenant_id: &str,
    sale_id: &str,
) -> Result<(), rusqlite::Error> {
    let tx = db.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO sale_idempotency (tenant_id, key, sale_id) VALUES (?1, NULL, ?2)",
        params![tenant_id, sale_id],
    )?;
    tx.commit()
}

/// Answer a replayed guarded submit with the ORIGINAL sale body and 200.
///
/// Never a second sale and never an error for a key that resolved. The one
/// degenerate case is a slot whose sale row has since been deleted: there is
/// no body to replay, and inventing one would be worse than naming it, so that
/// reads as a 404 while still writing nothing.
async fn sale_receipt(pool: &deadpool_postgres::Pool, tenant_id: &str, sale_id: &str) -> Response {
    match crate::pg::get_sale(pool, tenant_id, sale_id).await {
        Ok(Some(sale)) => (StatusCode::OK, Json(sale)).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "idempotency key holds no readable sale"})),
        )
            .into_response(),
        Err(e) => e.into_response(),
    }
}

/// SQLite twin of `sale_receipt`: same 200, same original body.
fn sale_receipt_sqlite(store: &Store, sale_id: &str) -> Response {
    match store.get_sale(sale_id) {
        Ok(Some(sale)) => (StatusCode::OK, Json(sale)).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "idempotency key holds no readable sale"})),
        )
            .into_response(),
        Err(e) => store_error_response(e),
    }
}

/// Create a sale from cart lines.
/// Accepts `{ "lines": [{ "sku": "...", "qty": N, "unit_price": {...} }, ...] }`.
/// Builds a `Cart`, converts to `Sale` via the domain type, and persists
/// header + lines in a single transaction. Returns 201 with the full sale.
///
/// When `Idempotency-Key` carries an opaque key, the slot is claimed BEFORE any
/// write: the request that wins the slot creates the sale and answers 201, and
/// any later request with the same (tenant_id, key) is answered 200 with the
/// ORIGINAL sale body read back through `get_sale` — never an error, never a
/// second sale. Absent, empty or whitespace-only leaves the create unguarded.
pub async fn create_sale(
    State(state): State<AppState>,
    Extension(claims): Extension<ApiTokenClaims>,
    headers: HeaderMap,
    Json(body): Json<CreateSaleRequest>,
) -> Response {
    let key = guard_key(&headers);
    if let Some(reject) = guard_key_reject(key) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": reject})),
        )
            .into_response();
    }
    if body.lines.is_empty() {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({"error": "sale must have at least one line"})),
        )
            .into_response();
    }

    // Infer the currency from the first line; all subsequent lines must match.
    let first = &body.lines[0];
    let mut cart = Cart::new(first.unit_price.currency);

    for line in &body.lines {
        let cl = CartLine::new(Sku::new(&line.sku), line.qty, line.unit_price);
        if let Err(e) = cart.add_line(cl) {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    }

    let sale = match Sale::from_cart(&cart) {
        Some(s) => s,
        None => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({"error": "cart total overflow"})),
            )
                .into_response();
        }
    };

    let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");

    // Both branches resolve the guard BEFORE any ledger write, and both scope
    // it to (tenant_id, key), so the two surfaces answer identically.
    if let Some(pool) = &state.pg {
        if let Some(k) = key {
            match crate::pg::claim_sale_idempotency(pool, tenant_id, k, &sale.id).await {
                Ok(crate::pg::SaleClaim::Held) => {}
                Ok(crate::pg::SaleClaim::Replay(held)) => {
                    return sale_receipt(pool, tenant_id, &held).await;
                }
                Err(e) => return e.into_response(),
            }
        }
        return match crate::pg::create_sale(pool, tenant_id, &sale).await {
            Ok(()) => {
                if key.is_none() {
                    // The sale is written; a failed receipt note must not
                    // turn a booked sale into an error.
                    if let Err(e) =
                        crate::pg::record_unguarded_sale(pool, tenant_id, &sale.id).await
                    {
                        tracing::warn!("unguarded sale receipt note failed: {e}");
                    }
                }
                (StatusCode::CREATED, Json(sale)).into_response()
            }
            Err(e) => {
                if let Some(k) = key
                    && let Err(release) =
                        crate::pg::release_sale_idempotency(pool, tenant_id, k, &sale.id).await
                {
                    tracing::warn!("failed to release an unused idempotency slot: {release}");
                }
                e.into_response()
            }
        };
    }

    let db = state.db.lock().await;
    let store = Store::new(&db);

    if let Some(k) = key {
        match claim_sqlite(&db, tenant_id, k, &sale.id) {
            Ok(crate::pg::SaleClaim::Held) => {}
            Ok(crate::pg::SaleClaim::Replay(held)) => {
                return sale_receipt_sqlite(&store, &held);
            }
            Err(e) => return store_error_response(e.into()),
        }
    }

    match store.create_sale(&sale) {
        Ok(()) => {
            if key.is_none()
                && let Err(e) = note_unguarded_sqlite(&db, tenant_id, &sale.id)
            {
                tracing::warn!("unguarded sale receipt note failed: {e}");
            }
            (StatusCode::CREATED, Json(sale)).into_response()
        }
        Err(e) => {
            if let Some(k) = key
                && let Err(release) = release_sqlite(&db, tenant_id, k, &sale.id)
            {
                tracing::warn!("failed to release an unused idempotency slot: {release}");
            }
            store_error_response(e)
        }
    }
}

/// Get a single sale by id, including all line items.
///
/// Returns JSON `null` when the sale is not found.
pub async fn get_sale(
    State(state): State<AppState>,
    Extension(claims): Extension<ApiTokenClaims>,
    Path(id): Path<String>,
) -> Response {
    if let Some(pool) = &state.pg {
        let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");
        return match crate::pg::get_sale(pool, tenant_id, &id).await {
            Ok(Some(sale)) => Json(Some(sale)).into_response(),
            Ok(None) => Json(None as Option<Sale>).into_response(),
            Err(e) => e.into_response(),
        };
    }
    let db = state.db.lock().await;
    let store = Store::new(&db);

    match store.get_sale(&id) {
        Ok(Some(sale)) => Json(Some(sale)).into_response(),
        Ok(None) => Json(None as Option<Sale>).into_response(),
        Err(e) => store_error_response(e),
    }
}

/// Transition a sale's status.
///
/// Accepts `{ "status": "active|completed|voided" }`. Validates the
/// state machine transition. Returns 200 with the updated sale on
/// success, 404 if the sale doesn't exist, 422 for invalid transitions.
pub async fn update_sale_status(
    State(state): State<AppState>,
    Extension(claims): Extension<ApiTokenClaims>,
    Path(id): Path<String>,
    Json(body): Json<UpdateSaleStatusRequest>,
) -> Response {
    if let Some(pool) = &state.pg {
        let tenant_id = claims.tenant_id.as_deref().unwrap_or("default");
        return match crate::pg::update_sale_status(pool, tenant_id, &id, body.status).await {
            Ok(sale) => {
                let resp = SaleStatusResponse {
                    id: sale.id,
                    status: sale.status,
                    updated_at: sale.updated_at,
                };
                Json(resp).into_response()
            }
            Err(crate::pg::PgError::Validation(message)) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({"error": message})),
            )
                .into_response(),
            Err(e) => e.into_response(),
        };
    }

    let db = state.db.lock().await;
    let store = Store::new(&db);

    match store.update_sale_status(&id, body.status) {
        Ok(sale) => {
            let resp = SaleStatusResponse {
                id: sale.id,
                status: sale.status,
                updated_at: sale.updated_at,
            };
            Json(resp).into_response()
        }
        Err(CoreError::Validation { message, .. }) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({"error": message})),
        )
            .into_response(),
        Err(e) => store_error_response(e),
    }
}

#[cfg(test)]
#[path = "sales_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "sales_idempotency_tests.rs"]
mod idempotency_tests;
