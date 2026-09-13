/*
last audited 25-07-26 by RSA-Agent (cloud-server slice A: webhooks deep read; CS-1 + CS-2 FIXED 25-07-26)
crate: cloud-server | status: SAFE | lint: CLEAN
findings: CS-1 FIXED — both webhook verifiers now decode the provided hex and verify in constant time via hmac verify_slice against the raw bytes (was: hex string equality, a timing oracle on internet-facing endpoints). CS-2 FIXED — Stripe verification now rejects timestamps with skew beyond 5 minutes, closing the replay window once idempotency rows are pruned. Remaining (unchanged): unauthenticated router verified solely via HMAC (by design), event idempotency gate, subscription lifecycle routing, 5xx metric middleware
next: none | perf: N/A
*/
//! Webhook receiver — accepts payment events from Stripe, Square, and
//! Midtrans, verifies their signatures, and routes them:
//!
//! - **Stripe subscription lifecycle events** (`customer.subscription.*`,
//!   `checkout.session.completed`, `invoice.paid`) update the tenant's
//!   sync plan via `set_tenant_plan` (ADR sync-plan-gating) — a paid
//!   subscription upgrades the tenant to `pro`, cancellation downgrades
//!   to `free`.
//! - **Payment events** (`payment_intent.*`, `charge.*`, Square
//!   payments) write a `finalize_sale` action to the `offline_queue` for
//!   the local POS terminal to pick up via sync.
//!
//! # Endpoints
//!
//! - `POST /api/webhooks/stripe` — Stripe events (subscriptions + payments)
//! - `POST /api/webhooks/square` — Square charge/Payment events
//! - `POST /api/webhooks/midtrans` — Midtrans QRIS transaction notifications
//!   (settles via the `midtrans_transactions` ledger, NOT the
//!   `gateway_reference` JOIN — the ledger resolves the sale even when the
//!   device has not synced yet; see `midtrans_ledger.rs`)
//!
//! # Configuration
//!
//! | Variable | Required | Description |
//! |---|---|---|
//! | `STRIPE_WEBHOOK_SECRET` | For Stripe endpoint | Stripe webhook signing secret |
//! | `SQUARE_WEBHOOK_SIGNATURE_KEY` | For Square endpoint | Square webhook signature key |
//! | `SQUARE_WEBHOOK_URL` | For Square endpoint | Public webhook URL (used in signature verification) |
//! | `MIDTRANS_SERVER_KEY` | For Midtrans endpoint | Server key; the notification signature is recomputed as SHA512(`order_id + status_code + gross_amount + server_key`) |
//!
//! # Flow
//!
//! 1. Gateway sends event → server verifies HMAC signature
//! 2. Routes by event type (subscription → plan update, else payment)
//! 3. Subscription: resolves the tenant (metadata or `stripe_customers`
//!    mapping) and calls `Store::set_tenant_plan`
//! 4. Payment: looks up matching payment record via `gateway_reference`
//!    and creates an `offline_queue` `finalize_sale` action so the next
//!    sync cycle finalizes the pending sale

use axum::{
    Router, extract::State, http::StatusCode, middleware, response::Response, routing::post,
};
use hmac::{Hmac, Mac};
use rusqlite::params;
use sha2::Sha256;
use sha2::{Digest, Sha512};

use crate::CloudServerState;
use crate::midtrans_ledger::LedgerDb;

/// HMAC-SHA256 type alias for webhook signature verification.
type HmacSha256 = Hmac<Sha256>;

/// Build the webhooks router (unauthenticated — Stripe/Square/Midtrans
/// verify themselves via signatures, not JWT).
///
/// A response-status middleware counts every 5xx into
/// `webhook_5xx_total` — webhooks are the payment-authenticity boundary,
/// so a server-side failure (misconfigured secret, DB error, bad event
/// shape) is an operator-visible signal that payment/plan state may be
/// stale.
pub fn webhooks_router(state: CloudServerState) -> Router {
    Router::new()
        .route("/api/webhooks/stripe", post(stripe_webhook_handler))
        .route("/api/webhooks/square", post(square_webhook_handler))
        .route("/api/webhooks/midtrans", post(midtrans_webhook_handler))
        .layer(middleware::from_fn(count_webhook_5xx))
        .with_state(state)
}

/// Axum middleware that counts 5xx responses from the webhook handlers
/// into the `webhook_5xx_total` Prometheus counter.
async fn count_webhook_5xx(request: axum::extract::Request, next: middleware::Next) -> Response {
    let response = next.run(request).await;
    if response.status().is_server_error() {
        crate::metrics::WEBHOOK_5XX_TOTAL.inc();
    }
    response
}

/// Stripe webhook event payload (minimal — we only need `type` and `id`).
#[derive(serde::Deserialize, Debug)]
struct StripeEvent {
    /// Unique event identifier for idempotency (Stripe redelivers webhooks).
    id: String,
    /// Event type (e.g. `payment_intent.succeeded`, `charge.captured`).
    r#type: String,
    /// Event data payload.
    data: StripeEventData,
}

#[derive(serde::Deserialize, Debug)]
struct StripeEventData {
    /// The object that triggered the event.
    object: serde_json::Value,
}

/// Square webhook event payload (minimal).
#[derive(serde::Deserialize, Debug)]
struct SquareEvent {
    /// Merchant ID
    #[allow(dead_code)]
    merchant_id: String,
    /// Event type (e.g. `payment.updated`, `payment.created`).
    r#type: String,
    /// Event ID
    #[allow(dead_code)]
    event_id: String,
    /// Event data
    data: SquareEventData,
}

#[derive(serde::Deserialize, Debug)]
struct SquareEventData {
    /// The object type that triggered the event.
    #[serde(rename = "type")]
    #[allow(dead_code)]
    object_type: String,
    /// Object ID (the payment/charge ID).
    id: String,
}

/// Extract the payment intent ID from a Stripe event object.
fn extract_stripe_payment_id(object: &serde_json::Value) -> Option<String> {
    // payment_intent.succeeded → object.id = "pi_xxx"
    // charge.captured → object.payment_intent = "pi_xxx"
    if let Some(id) = object
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|id| id.starts_with("pi_"))
    {
        return Some(id.to_owned());
    }
    // Try payment_intent field on charge objects
    if let Some(pi) = object
        .get("payment_intent")
        .and_then(|v| v.as_str())
        .filter(|pi| pi.starts_with("pi_"))
    {
        return Some(pi.to_owned());
    }
    None
}

/// Stripe event types that carry subscription lifecycle state.
///
/// These update the tenant's sync plan (ADR sync-plan-gating); all other
/// events (payment_intent.*, charge.*, …) finalise a sale.
fn is_subscription_event(event_type: &str) -> bool {
    matches!(
        event_type,
        "customer.subscription.created"
            | "customer.subscription.updated"
            | "customer.subscription.deleted"
            | "checkout.session.completed"
            | "invoice.paid"
    )
}

/// The sync plan a subscription event implies, from the subscription status.
///
/// - `active` / `trialing` / `past_due` → `Pro` (paid or in grace)
/// - `canceled` / `unpaid` / `incomplete_expired` → `Free` (no access)
/// - anything else (e.g. `incomplete`) → `None`, meaning "leave the plan
///   unchanged" — the tenant keeps its current plan until a clearer state.
fn plan_for_subscription_status(status: Option<&str>) -> Option<oz_core::TenantPlan> {
    match status {
        Some("active" | "trialing" | "past_due") => Some(oz_core::TenantPlan::Pro),
        Some("canceled" | "unpaid" | "incomplete_expired") => Some(oz_core::TenantPlan::Free),
        _ => None,
    }
}

/// Resolve the OZ-POS tenant for a subscription event.
///
/// Prefers the `tenant_id` metadata set on the Checkout Session / subscription
/// (Stripe forwards object metadata onto the subscription). Falls back to the
/// `stripe_customers` mapping for events that carry only a customer id
/// (`invoice.paid`, `customer.subscription.deleted`, …). Returns `None` when
/// the tenant cannot be determined.
async fn resolve_subscription_tenant(
    state: &CloudServerState,
    object: &serde_json::Value,
) -> Result<Option<String>, (StatusCode, String)> {
    // 1. Metadata: data.object.metadata.tenant_id
    if let Some(tenant) = object
        .get("metadata")
        .and_then(|m| m.get("tenant_id"))
        .and_then(|v| v.as_str())
    {
        // Also (re)record the customer mapping while we have it — later
        // events (invoice.paid, deleted) carry only the customer id.
        if let Some(customer) = object.get("customer").and_then(|v| v.as_str()) {
            if let Some(pool) = &state.pg {
                // The tenant is known here (from metadata), so the mapping
                // write runs as `oz_app` scoped to the tenant (RLS-enforced).
                let mut client = pool.get().await.map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to record stripe customer mapping: {e}"),
                    )
                })?;
                let tx = client.transaction().await.map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to record stripe customer mapping: {e}"),
                    )
                })?;
                // RLS: scope to the tenant (LOCAL — auto-resets on commit).
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
                    .await
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("failed to record stripe customer mapping: {e}"),
                        )
                    })?;
                tx.execute(
                    "INSERT INTO stripe_customers (stripe_customer_id, tenant_id, updated_at)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (stripe_customer_id) DO UPDATE SET
                        tenant_id = excluded.tenant_id,
                        updated_at = excluded.updated_at",
                    &[
                        &customer,
                        &tenant,
                        &chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    ],
                )
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to record stripe customer mapping: {e}"),
                    )
                })?;
                tx.commit().await.map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to record stripe customer mapping: {e}"),
                    )
                })?;
            } else {
                let conn = state.db.lock().await;
                oz_core::Store::new(&conn)
                    .set_stripe_customer(customer, tenant)
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("failed to record stripe customer mapping: {e}"),
                        )
                    })?;
            }
        }
        return Ok(Some(tenant.to_owned()));
    }

    // 2. Mapping table via the customer id.
    if let Some(customer) = object.get("customer").and_then(|v| v.as_str()) {
        let tenant = if let Some(pool) = &state.pg {
            let mut client = pool.get().await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to look up stripe customer mapping: {e}"),
                )
            })?;
            let tx = client.transaction().await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to look up stripe customer mapping: {e}"),
                )
            })?;
            // Pre-tenant resolution read: the tenant is the answer, so it
            // runs under the dedicated BYPASSRLS role (auto-resets on
            // commit, so the pooled connection never keeps the bypass).
            // Scope it only when the session user is actually a member
            // (post-cutover `oz_app`); pre-cutover the app connects as the
            // table owner, which is not a member and bypasses RLS until
            // FORCE is applied — the unscoped read below is exactly the
            // owner's behaviour in that window.
            let is_resolver_member: bool = tx
                .query_one(
                    "SELECT EXISTS(
                        SELECT 1 FROM pg_roles r
                        JOIN pg_auth_members m ON m.roleid = r.oid
                        WHERE r.rolname = 'oz_webhook_resolver'
                          AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                     )",
                    &[],
                )
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to check webhook resolver membership: {e}"),
                    )
                })?
                .get(0);
            if is_resolver_member {
                tx.execute("SET LOCAL ROLE oz_webhook_resolver", &[])
                    .await
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("failed to scope webhook resolution read: {e}"),
                        )
                    })?;
            }
            let row = tx
                .query_opt(
                    "SELECT tenant_id FROM stripe_customers WHERE stripe_customer_id = $1",
                    &[&customer],
                )
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to look up stripe customer mapping: {e}"),
                    )
                })?;
            tx.commit().await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to look up stripe customer mapping: {e}"),
                )
            })?;
            row.map(|r| r.get::<_, String>(0))
        } else {
            let conn = state.db.lock().await;
            oz_core::Store::new(&conn)
                .get_tenant_for_stripe_customer(customer)
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to look up stripe customer mapping: {e}"),
                    )
                })?
        };
        return Ok(tenant);
    }

    Ok(None)
}

/// Handle a subscription lifecycle event by setting the tenant's sync plan.
///
/// Returns `{"status":"ignored"}` (200) when the tenant cannot be resolved
/// so Stripe stops retrying, and `{"status":"accepted","plan":…}` on
/// success.
async fn handle_subscription_event(
    state: &CloudServerState,
    event: &StripeEvent,
) -> Result<axum::Json<serde_json::Value>, (StatusCode, String)> {
    let tenant_id = match resolve_subscription_tenant(state, &event.data.object).await? {
        Some(t) => t,
        None => {
            tracing::warn!(event_type = %event.r#type, "subscription event with unresolvable tenant — ignoring");
            record_event_processed(state, &event.id, "stripe", Some(&event.r#type)).await;
            return Ok(axum::Json(serde_json::json!({
                "status": "ignored",
                "event_type": event.r#type,
            })));
        }
    };

    // checkout.session.completed and invoice.paid imply an active
    // subscription even though their object carries no status field.
    let plan = match event.r#type.as_str() {
        "checkout.session.completed" | "invoice.paid" => Some(oz_core::TenantPlan::Pro),
        "customer.subscription.deleted" => Some(oz_core::TenantPlan::Free),
        _ => plan_for_subscription_status(event.data.object.get("status").and_then(|v| v.as_str())),
    };

    let Some(plan) = plan else {
        tracing::debug!(event_type = %event.r#type, tenant_id, "subscription status leaves plan unchanged");
        record_event_processed(state, &event.id, "stripe", Some(&event.r#type)).await;
        return Ok(axum::Json(serde_json::json!({
            "status": "accepted",
            "tenant_id": tenant_id,
            "plan": "unchanged",
            "event_type": event.r#type,
        })));
    };

    if let Some(pool) = &state.pg {
        oz_api::pg::set_tenant_plan(pool, &tenant_id, plan)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to set tenant plan: {e}"),
                )
            })?;
    } else {
        let conn = state.db.lock().await;
        oz_core::Store::new(&conn)
            .set_tenant_plan(&tenant_id, plan)
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to set tenant plan: {e}"),
                )
            })?;
        drop(conn);
    }

    tracing::info!(tenant_id, plan = plan.as_db_str(), event_type = %event.r#type, "stripe subscription updated tenant plan");
    record_event_processed(state, &event.id, "stripe", Some(&event.r#type)).await;

    Ok(axum::Json(serde_json::json!({
        "status": "accepted",
        "tenant_id": tenant_id,
        "plan": plan.as_db_str(),
        "event_type": event.r#type,
    })))
}

/// Verify a Stripe webhook signature.
///
/// Stripe sends `Stripe-Signature: t=<timestamp>,v1=<signature>`.
/// The signature is HMAC-SHA256 of `<timestamp>.<payload>`.
/// See: <https://docs.stripe.com/webhooks/signatures>
fn verify_stripe_signature(payload: &[u8], signature_header: &str, secret: &str) -> bool {
    // Parse the signature header: t=...,v1=...
    let mut timestamp = None;
    let mut signature = None;
    for part in signature_header.split(',') {
        if let Some((key, value)) = part.split_once('=') {
            match key.trim() {
                "t" => timestamp = Some(value.trim()),
                "v1" => signature = Some(value.trim()),
                _ => {}
            }
        }
    }

    let (ts, sig) = match (timestamp, signature) {
        (Some(t), Some(s)) => (t, s),
        _ => return false,
    };

    // CS-2 fix: reject stale timestamps (Stripe guidance: ±5 minutes) so a
    // captured valid payload+signature cannot be replayed indefinitely once
    // its idempotency row has been pruned.
    let ts_unix: i64 = match ts.parse() {
        Ok(v) => v,
        Err(_) => return false,
    };
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    if (now_unix - ts_unix).abs() > 300 {
        return false;
    }

    // Build the signed payload: timestamp + "." + raw body
    let mut signed_bytes = Vec::with_capacity(ts.len() + 1 + payload.len());
    signed_bytes.extend_from_slice(ts.as_bytes());
    signed_bytes.push(b'.');
    signed_bytes.extend_from_slice(payload);

    // Compute expected HMAC
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(&signed_bytes);

    // CS-1 fix: verify in constant time against the RAW bytes via
    // `verify_slice` instead of comparing hex strings with `==` (a
    // short-circuiting compare is a timing oracle on internet-facing
    // endpoints). Hex decoding also validates the signature format.
    let provided = match hex::decode(sig) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    mac.verify_slice(&provided).is_ok()
}

/// Verify a Square webhook signature.
///
/// Square sends `x-square-hmacsha256-signature: <signature>`.
/// The signature is HMAC-SHA256 of `<webhook_url>.<body>.<timestamp>`.
/// See: <https://developer.squareup.com/docs/webhooks/step-verify>
fn verify_square_signature(
    payload: &[u8],
    signature_header: &str,
    webhook_url: &str,
    secret: &str,
    timestamp: &str,
) -> bool {
    let body_str = std::str::from_utf8(payload).unwrap_or("");
    let signed_payload = format!("{}.{}.{}", webhook_url, body_str, timestamp);

    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(signed_payload.as_bytes());

    // CS-1 fix: constant-time verification against the raw bytes (see the
    // Stripe verifier above for rationale).
    let provided = match hex::decode(signature_header) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    mac.verify_slice(&provided).is_ok()
}

/// `POST /api/webhooks/stripe` — receive Stripe payment events.
async fn stripe_webhook_handler(
    State(state): State<CloudServerState>,
    headers: axum::http::HeaderMap,
    body_bytes: axum::body::Bytes,
) -> Result<axum::Json<serde_json::Value>, (StatusCode, String)> {
    // 1. Extract Stripe-Signature header
    let signature_header = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "missing Stripe-Signature header".into(),
            )
        })?;

    // 2. Read the webhook secret from state (loaded from env at startup)
    let secret = state.stripe_webhook_secret.as_deref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "STRIPE_WEBHOOK_SECRET not configured".into(),
        )
    })?;

    // 3. Verify signature
    if !verify_stripe_signature(&body_bytes, signature_header, secret) {
        return Err((StatusCode::UNAUTHORIZED, "invalid webhook signature".into()));
    }

    // 4. Parse event
    let event: StripeEvent = serde_json::from_slice(&body_bytes)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid event body: {e}")))?;

    // 4b. Idempotency: skip already-processed events.
    //     Stripe guarantees at-least-once delivery; redelivered events
    //     must not double-count a subscription upgrade or payment capture.
    if event_already_processed(&state, &event.id).await {
        tracing::debug!(event_id = %event.id, event_type = %event.r#type, "webhook already processed — skipping");
        return Ok(axum::Json(serde_json::json!({
            "status": "already_processed",
            "event_id": event.id,
            "event_type": event.r#type,
        })));
    }

    // 5. Subscription lifecycle events update the tenant's sync plan
    //    (ADR sync-plan-gating) instead of finalising a sale.
    if is_subscription_event(&event.r#type) {
        return handle_subscription_event(&state, &event).await;
    }

    // 6. Extract payment intent ID
    let payment_id = extract_stripe_payment_id(&event.data.object).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "could not extract payment intent ID from event".into(),
        )
    })?;

    // 7. Look up the sale (and its owner tenant) by gateway_reference
    let (sale_id, tenant_id) = lookup_sale_by_gateway_reference(&state, &payment_id).await?;

    // 8. Queue a finalize_sale action under the sale's tenant
    enqueue_finalize_sale(&state, &sale_id, &tenant_id).await?;

    tracing::info!(payment_id, sale_id, tenant_id, event_type = %event.r#type, "stripe webhook processed");
    record_event_processed(&state, &event.id, "stripe", Some(&event.r#type)).await;

    Ok(axum::Json(serde_json::json!({
        "status": "accepted",
        "sale_id": sale_id,
        "event_type": event.r#type,
    })))
}

/// `POST /api/webhooks/square` — receive Square payment events.
async fn square_webhook_handler(
    State(state): State<CloudServerState>,
    headers: axum::http::HeaderMap,
    body_bytes: axum::body::Bytes,
) -> Result<axum::Json<serde_json::Value>, (StatusCode, String)> {
    // 1. Extract Square signature header
    let signature_header = headers
        .get("x-square-hmacsha256-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "missing x-square-hmacsha256-signature header".into(),
            )
        })?;

    // 2. Extract timestamp header
    let timestamp = headers
        .get("x-square-timestamp")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                "missing x-square-timestamp header".into(),
            )
        })?;

    // 3. Read the webhook signature key from state (loaded from env at startup)
    let secret = state
        .square_webhook_signature_key
        .as_deref()
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "SQUARE_WEBHOOK_SIGNATURE_KEY not configured".into(),
            )
        })?;

    // 4. Read the webhook URL from state (loaded from env at startup)
    let webhook_url = state.square_webhook_url.as_deref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "SQUARE_WEBHOOK_URL not configured".into(),
        )
    })?;

    // 5. Verify signature
    if !verify_square_signature(
        &body_bytes,
        signature_header,
        webhook_url,
        secret,
        timestamp,
    ) {
        return Err((StatusCode::UNAUTHORIZED, "invalid webhook signature".into()));
    }

    // 6. Parse event
    let event: SquareEvent = serde_json::from_slice(&body_bytes)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid event body: {e}")))?;

    // 6b. Idempotency: skip already-processed events
    if square_event_already_processed(&state, &event.event_id).await {
        tracing::debug!(event_id = %event.event_id, event_type = %event.r#type, "square webhook already processed — skipping");
        return Ok(axum::Json(serde_json::json!({
            "status": "already_processed",
            "event_id": event.event_id,
            "event_type": event.r#type,
        })));
    }

    // Square uses payment IDs (not pi_xxx prefix). Use the data.id directly.
    let payment_id = event.data.id.clone();

    // 7. Look up the sale (and its owner tenant) by gateway_reference
    let (sale_id, tenant_id) = lookup_sale_by_gateway_reference(&state, &payment_id).await?;

    // 8. Queue a finalize_sale action under the sale's tenant
    enqueue_finalize_sale(&state, &sale_id, &tenant_id).await?;

    tracing::info!(payment_id, sale_id, tenant_id, event_type = %event.r#type, "square webhook processed");
    record_event_processed(&state, &event.event_id, "square", Some(&event.r#type)).await;

    Ok(axum::Json(serde_json::json!({
        "status": "accepted",
        "sale_id": sale_id,
        "event_type": event.r#type,
    })))
}

// ── Webhook idempotency helpers ─────────────────────────────────────
/// Check whether a webhook event has already been processed.
///
/// Pure check -- does not insert. The recording happens in
/// [`record_event_processed`] after all side effects succeed.
/// Read `processed_webhooks` dedup state, backend-aware.
///
/// Returns `true` when the event id already has a row. Backend failures
/// degrade to `false` ("not processed") exactly like the historical SQLite
/// path — a dedup miss is at-least-once, which the webhook contract already
/// tolerates; the subsequent `record_event_processed` upsert is a no-op on
/// conflict.
async fn event_already_processed(state: &CloudServerState, event_id: &str) -> bool {
    if let Some(pool) = &state.pg {
        let Ok(client) = pool.get().await else {
            return false;
        };
        return client
            .query_one(
                "SELECT EXISTS(SELECT 1 FROM processed_webhooks WHERE event_id = $1)",
                &[&event_id],
            )
            .await
            .map(|r| r.get::<_, bool>(0))
            .unwrap_or(false);
    }
    let conn = state.db.lock().await;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM processed_webhooks WHERE event_id = ?1",
            rusqlite::params![event_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    count > 0
}

/// Like [`event_already_processed`] but for Square events.
async fn square_event_already_processed(state: &CloudServerState, event_id: &str) -> bool {
    event_already_processed(state, event_id).await
}

/// Record a webhook event as successfully processed.
///
/// Called after all side effects (plan update, sale finalization) have
/// succeeded. If the row was already inserted by [`event_already_processed`]
/// this is a no-op.
async fn record_event_processed(
    state: &CloudServerState,
    event_id: &str,
    provider: &str,
    event_type: Option<&str>,
) {
    if let Some(pool) = &state.pg {
        if let Ok(client) = pool.get().await {
            let _ = client
                .execute(
                    "INSERT INTO processed_webhooks (event_id, provider, event_type) VALUES ($1, $2, $3)
                     ON CONFLICT (event_id) DO NOTHING",
                    &[&event_id, &provider, &event_type],
                )
                .await;
        }
        return;
    }
    let conn = state.db.lock().await;
    let _ = conn.execute(
        "INSERT OR IGNORE INTO processed_webhooks (event_id, provider, event_type) VALUES (?1, ?2, ?3)",
        rusqlite::params![event_id, provider, event_type],
    );
}

/// Midtrans transaction notification (QRIS). Field shapes follow the
/// Core-API notification body; `gross_amount` is a STRING exactly as
/// Midtrans signs it ("15000.00") — deserializing it as a number would
/// re-canonicalize away the trailing zeros and break the signature, so the
/// type is deliberately strict (a numeric body fails with 400, and no
/// settlement can ride a malformed notification into `finalize_sale`).
#[derive(serde::Deserialize, Debug)]
struct MidtransNotification {
    /// Our ledger primary key (derived by the driver from the caller's
    /// idempotency key or a UUIDv7 tail).
    order_id: String,
    /// Gateway transaction id (recorded, not needed for routing).
    #[allow(dead_code)]
    transaction_id: Option<String>,
    /// Lifecycle status: `pending`, `authorize`, `capture`, `settlement`,
    /// `expire`, `cancel`, `refund`, `void`.
    transaction_status: String,
    /// Numeric status code as sent (part of the signed preimage).
    #[serde(default)]
    transaction_status_code: Option<String>,
    /// Signed amount string, verbatim (part of the signed preimage).
    #[serde(default)]
    gross_amount: Option<String>,
    /// Currency (QRIS: IDR).
    #[allow(dead_code)]
    #[serde(default)]
    currency: Option<String>,
    /// Hex SHA512 signature to verify.
    #[serde(default)]
    signature_key: Option<String>,
    /// Declared signature scheme; anything but `sha512` is unverifiable.
    #[allow(dead_code)]
    #[serde(default)]
    signature_type: Option<String>,
}

/// Verify a Midtrans notification signature:
/// `SHA512(order_id + status_code + gross_amount + server_key)` hex.
///
/// NOTE the deliberate difference from Stripe/Square: the preimage is the
/// CONCATENATED FIELDS, not the raw body, and the scheme is a bare digest —
/// the server key is folded into the preimage rather than used as an HMAC
/// key. Do not copy the sibling verifiers' shape. Constant time is still
/// required (CS-1 discipline): decode the provided hex and fold-compare the
/// raw digest bytes; the hex decode doubles as format validation.
fn verify_midtrans_signature(
    order_id: &str,
    status_code: &str,
    gross_amount: &str,
    server_key: &str,
    provided_hex: &str,
) -> bool {
    let mut digest = Sha512::new();
    digest.update(order_id.as_bytes());
    digest.update(status_code.as_bytes());
    digest.update(gross_amount.as_bytes());
    digest.update(server_key.as_bytes());
    let expected = digest.finalize();

    let Ok(provided) = hex::decode(provided_hex.trim()) else {
        return false;
    };
    if provided.len() != expected.len() {
        return false;
    }
    let mut acc: u8 = 0;
    for (a, b) in expected.iter().zip(provided.iter()) {
        acc |= a ^ b;
    }
    acc == 0
}

/// Parse a Midtrans amount string into IDR minor units (exp-0, whole
/// Rupiah — the PAY-1 convention the driver settled on). Accepts `"15000"`,
/// `"15000.00"`; REJECTS non-zero fractions and malformed input rather than
/// zeroing them (the old PAY-1 bug class).
fn midtrans_gross_to_minor(raw: &str) -> Option<i64> {
    let raw = raw.trim();
    match raw.split_once('.') {
        Some((int, frac)) => {
            if frac != "00" {
                return None;
            }
            int.parse::<i64>().ok()
        }
        None => raw.parse::<i64>().ok(),
    }
}

/// `POST /api/webhooks/midtrans` — settlement notification for a QRIS
/// charge issued through `payment_api`.
///
/// Resolution goes through the `midtrans_transactions` ledger, NOT the
/// `gateway_reference` JOIN the Stripe/Square arms use: a customer can pay
/// seconds after the QR renders, long before the device's sync push lands
/// `payments`/`sales` in the cloud. The ledger was written at ISSUE time, so
/// settlement resolves even on the first notification after a fast scan.
///
/// Failure policy (deliberate, recorded in the work order): signature
/// failures answer 401 (stop retries, alert); unknown-but-genuine
/// signatures answer 200 `ignored` (verified payload for an order never
/// issued here — stale pruned row or environment leak; nothing settleable
/// exists, and 5xx would only invite notification hammering).
async fn midtrans_webhook_handler(
    State(state): State<CloudServerState>,
    body_bytes: axum::body::Bytes,
) -> Result<axum::Json<serde_json::Value>, (StatusCode, String)> {
    let server_key = state.midtrans_server_key.as_deref().ok_or((
        StatusCode::INTERNAL_SERVER_ERROR,
        "MIDTRANS_SERVER_KEY not configured".into(),
    ))?;

    let event: MidtransNotification = serde_json::from_slice(&body_bytes)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid notification body: {e}")))?;

    if let Some(t) = &event.signature_type
        && !t.eq_ignore_ascii_case("sha512")
    {
        return Err((
            StatusCode::UNAUTHORIZED,
            format!("unsupported signature_type '{t}'"),
        ));
    }
    let provided = event.signature_key.as_deref().ok_or((
        StatusCode::UNAUTHORIZED,
        "missing signature_key".into(),
    ))?;

    let status_code = event.transaction_status_code.as_deref().unwrap_or("");
    let gross = event.gross_amount.as_deref().unwrap_or("");
    if !verify_midtrans_signature(
        &event.order_id,
        status_code,
        gross,
        server_key,
        provided,
    ) {
        tracing::warn!(
            order_id = %event.order_id,
            transaction_status = %event.transaction_status,
            "midtrans webhook: signature verification failed"
        );
        return Err((StatusCode::UNAUTHORIZED, "invalid webhook signature".into()));
    }

    let ledger = LedgerDb {
        db: state.db.clone(),
        pg: state.pg.clone(),
    };
    let entry = ledger
        .lookup(&event.order_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let Some(entry) = entry else {
        tracing::info!(
            order_id = %event.order_id,
            transaction_status = %event.transaction_status,
            "midtrans webhook: verified but no ledger row — ignored"
        );
        return Ok(axum::Json(serde_json::json!({
            "status": "ignored", "reason": "unmatched_order_id",
        })));
    };

    let status = event.transaction_status.to_ascii_lowercase();
    let settle_like = status == "settlement" || status == "capture";

    if settle_like {
        // Amount policy (fail closed): a settlement whose signed amount
        // disagrees with what we asked to charge is an incident, not a
        // rounding debate — record it and DO NOT finalize.
        let minor_ok = match event.gross_amount.as_deref().map(midtrans_gross_to_minor) {
            Some(Some(v)) => v == entry.amount_minor,
            Some(None) => false, // malformed fraction/garbage in a signed field
            None => false,       // settlement without a signed amount
        };
        if !minor_ok {
            tracing::error!(
                order_id = %event.order_id,
                tenant_id = %entry.tenant_id,
                sale_id = %entry.sale_id,
                expected_minor = entry.amount_minor,
                received = ?event.gross_amount,
                "MIDTRANS AMOUNT MISMATCH — settlement NOT enqueued; reconcile manually"
            );
            ledger
                .mark_status(&event.order_id, &entry.tenant_id, "amount_mismatch")
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            return Ok(axum::Json(serde_json::json!({
                "status": "recorded", "reason": "amount_mismatch",
            })));
        }
        if entry.status == "settlement" || entry.status == "capture" || entry.status == "amount_mismatch" {
            // Sequential duplicate (the common redelivery) — the ledger
            // status is the idempotency gate. Fully concurrent duplicates
            // (both reads before either write) may double-enqueue; the
            // device's finalize is a no-op on an already-finalized sale,
            // and a lost enqueue would be strictly worse than a duplicate.
            return Ok(axum::Json(serde_json::json!({
                "status": "already_processed", "order_id": event.order_id,
            })));
        }
        // Enqueue FIRST, then mark: an enqueue failure returns 5xx so the
        // gateway retries the notification (ledger still says `issued`, so
        // the retry re-runs this path) — whereas marking settled first and
        // losing the enqueue would silently eat a paid sale forever.
        enqueue_finalize_sale(&state, &entry.sale_id, &entry.tenant_id).await?;
        ledger
            .mark_status(&event.order_id, &entry.tenant_id, &status)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        Ok(axum::Json(serde_json::json!({
            "status": "finalization_queued",
            "order_id": event.order_id,
            "sale_id": entry.sale_id,
        })))
    } else {
        // Non-settling lifecycle updates (`expire`, `cancel`, `refund`,
        // `pending`, `authorize`, …): recorded verbatim, never finalized.
        // `mark_status` refuses to downgrade a settled row, so a late
        // `expire` after `settlement` becomes an observable anomaly instead
        // of a rewrite.
        if entry.status == "settlement" || entry.status == "capture" {
            tracing::error!(
                order_id = %event.order_id,
                late_status = %status,
                "midtrans: non-settling notification for an already settled order — anomaly"
            );
        }
        ledger
            .mark_status(&event.order_id, &entry.tenant_id, &status)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        Ok(axum::Json(serde_json::json!({
            "status": "recorded",
            "order_id": event.order_id,
            "transaction_status": status,
        })))
    }
}

/// Look up a sale by its `gateway_reference` in the payments table.
async fn lookup_sale_by_gateway_reference(
    state: &CloudServerState,
    gateway_ref: &str,
) -> Result<(String, String), (StatusCode, String)> {
    // Returns `(sale_id, tenant_id)` so the caller can enqueue the
    // finalize action under the sale's owner.
    let row: Option<(String, String)> = if let Some(pool) = &state.pg {
        let Ok(mut client) = pool.get().await else {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to acquire database connection".into(),
            ));
        };
        let Ok(tx) = client.transaction().await else {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to acquire database transaction".into(),
            ));
        };
        // Pre-tenant resolution read (same reasoning as
        // `resolve_subscription_tenant`): scope to the dedicated BYPASSRLS
        // role only when the session user is a member (post-cutover
        // `oz_app`); the owner window runs unscoped.
        let is_resolver_member: bool = tx
            .query_one(
                "SELECT EXISTS(
                    SELECT 1 FROM pg_roles r
                    JOIN pg_auth_members m ON m.roleid = r.oid
                    WHERE r.rolname = 'oz_webhook_resolver'
                      AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                 )",
                &[],
            )
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to check webhook resolver membership: {e}"),
                )
            })?
            .get(0);
        if is_resolver_member {
            tx.execute("SET LOCAL ROLE oz_webhook_resolver", &[])
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("failed to scope webhook resolution read: {e}"),
                    )
                })?;
        }
        let row = tx
            .query_opt(
                "SELECT p.sale_id, s.tenant_id FROM payments p\n                 JOIN sales s ON p.sale_id = s.id\n                 WHERE p.gateway_reference = $1 LIMIT 1",
                &[&gateway_ref],
            )
            .await
            .ok()
            .flatten()
            .map(|r| (r.get::<_, String>(0), r.get::<_, String>(1)));
        let _ = tx.commit().await;
        row
    } else {
        let conn = state.db.lock().await;
        conn.query_row(
            "SELECT p.sale_id, s.tenant_id FROM payments p\n             JOIN sales s ON p.sale_id = s.id\n             WHERE p.gateway_reference = ?1 LIMIT 1",
            params![gateway_ref],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .ok()
    };

    row.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            format!("no sale found for gateway reference: {gateway_ref}"),
        )
    })
}

/// Enqueue a `finalize_sale` action into the offline_queue so the local
/// terminal can complete the pending sale via sync.
async fn enqueue_finalize_sale(
    state: &CloudServerState,
    sale_id: &str,
    tenant_id: &str,
) -> Result<(), (StatusCode, String)> {
    let id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let payload = serde_json::json!({
        "sale_id": sale_id,
    })
    .to_string();

    if let Some(pool) = &state.pg {
        // The tenant is known here (from the sale lookup), so the write runs
        // as `oz_app` scoped to the tenant (RLS-enforced).
        let mut client = pool.get().await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to enqueue finalize_sale: {e}"),
            )
        })?;
        let tx = client.transaction().await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to enqueue finalize_sale: {e}"),
            )
        })?;
        // RLS: scope to the tenant (LOCAL — auto-resets on commit).
        tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to enqueue finalize_sale: {e}"),
                )
            })?;
        tx.execute(
            "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id)
             VALUES ($1, $2, $3, 'pending', $4, $5)",
            &[&id, &"finalize_sale", &payload, &now, &tenant_id],
        )
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to enqueue finalize_sale: {e}"),
            )
        })?;
        tx.commit().await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to enqueue finalize_sale: {e}"),
            )
        })?;
        return Ok(());
    }

    let conn = state.db.lock().await;
    conn.execute(
        "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id)
         VALUES (?1, ?2, ?3, 'pending', ?4, ?5)",
        params![id, "finalize_sale", payload, now, tenant_id],
    )
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to enqueue finalize_sale: {e}"),
        )
    })?;

    Ok(())
}

#[cfg(test)]
#[path = "webhooks_tests.rs"]
mod tests;
