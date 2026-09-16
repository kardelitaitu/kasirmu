use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serial_test::serial;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use tower::ServiceExt;

fn fresh_db() -> rusqlite::Connection {
    oz_core::migrations::fresh_db()
}

fn test_state() -> CloudServerState {
    CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: Instant::now(),
        health_depth_cache: crate::HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    }
}

fn test_state_with_stripe(secret: &str) -> CloudServerState {
    CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: Instant::now(),
        health_depth_cache: crate::HealthDepthCache::default(),
        stripe_webhook_secret: Some(secret.to_owned()),
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    }
}

fn test_state_with_square(secret: &str, url: &str) -> CloudServerState {
    CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: None,
        started_at: Instant::now(),
        health_depth_cache: crate::HealthDepthCache::default(),
        stripe_webhook_secret: None,
        square_webhook_signature_key: Some(secret.to_owned()),
        square_webhook_url: Some(url.to_owned()),
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    }
}

fn test_router() -> Router {
    let state = test_state();
    webhooks_router(state)
}

/// Seed a payment with a specific gateway_reference so the webhook
/// handler can look up the sale.
fn seed_payment(conn: &rusqlite::Connection, gateway_ref: &str, sale_id: &str) {
    // First seed a sale
    conn.execute(
        "INSERT OR IGNORE INTO sales (id, total_minor, currency, line_count, status, created_at)
         VALUES (?1, 1000, 'USD', 1, 'pending', '2026-07-01T00:00:00Z')",
        params![sale_id],
    )
    .ok();

    conn.execute(
        "INSERT OR IGNORE INTO payments (id, sale_id, method, amount_minor, currency,
                                          gateway_reference, gateway_status, created_at)
         VALUES (?1, ?2, 'card', 1000, 'USD', ?3, 'requires_capture', '2026-07-01T00:00:00Z')",
        params![uuid::Uuid::now_v7().to_string(), sale_id, gateway_ref],
    )
    .unwrap();
}

/// Build a valid Stripe signature for the given payload and secret.
///
/// Uses the CURRENT unix timestamp: the verifier enforces a ±5 minute
/// freshness window (CS-2 fix), so a fixed historical timestamp would be
/// rejected as stale.
fn stripe_signature(payload: &[u8], secret: &str) -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();
    let mut signed_bytes = Vec::with_capacity(timestamp.len() + 1 + payload.len());
    signed_bytes.extend_from_slice(timestamp.as_bytes());
    signed_bytes.push(b'.');
    signed_bytes.extend_from_slice(payload);

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(&signed_bytes);
    let expected = hex::encode(mac.finalize().into_bytes());
    format!("t={},v1={}", timestamp, expected)
}

// ── Stripe signature verification ─────────────────────────────

#[test]
fn verify_stripe_signature_valid() {
    let secret = "whsec_test_secret_key_12345";
    let payload = b"{\"type\":\"payment_intent.succeeded\"}";
    let header = stripe_signature(payload, secret);
    assert!(verify_stripe_signature(payload, &header, secret));
}

#[test]
fn verify_stripe_signature_invalid() {
    let secret = "whsec_test_secret_key_12345";
    let payload = b"{\"type\":\"payment_intent.succeeded\"}";
    let header = "t=1719000000,v1=invalid_signature_hex";
    assert!(!verify_stripe_signature(payload, header, secret));
}

#[test]
fn verify_stripe_signature_wrong_secret() {
    let secret = "whsec_correct_secret";
    let wrong_secret = "whsec_wrong_secret";
    let payload = b"test_payload";
    let header = stripe_signature(payload, secret);
    assert!(!verify_stripe_signature(payload, &header, wrong_secret));
}

#[test]
fn verify_stripe_signature_malformed_header() {
    let secret = "whsec_test";
    assert!(!verify_stripe_signature(
        b"{}",
        "not-a-valid-header",
        secret
    ));
    assert!(!verify_stripe_signature(b"{}", "v1=abc123", secret));
    assert!(!verify_stripe_signature(b"{}", "t=123", secret));
    assert!(!verify_stripe_signature(b"{}", "", secret));
}

// ── Square signature verification ─────────────────────────────

#[test]
fn verify_square_signature_valid() {
    let secret = "sq0csp-test-signature-key";
    let payload = b"{\"merchant_id\":\"m_001\",\"type\":\"payment.updated\"}";
    let url = "https://example.com/api/webhooks/square";
    let timestamp = "2026-07-01T12:00:00Z";

    let signed = format!(
        "{}.{}.{}",
        url,
        std::str::from_utf8(payload).unwrap(),
        timestamp
    );

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(signed.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());

    assert!(verify_square_signature(
        payload, &expected, url, secret, timestamp
    ));
}

#[test]
fn verify_square_signature_invalid() {
    let secret = "sq0csp-test-key";
    assert!(!verify_square_signature(
        b"{}",
        "invalid_signature",
        "https://example.com",
        secret,
        "2026-07-01T12:00:00Z"
    ));
}

// ── Stripe payment ID extraction ──────────────────────────────

#[test]
fn extract_stripe_payment_id_from_intent() {
    let obj = serde_json::json!({
        "id": "pi_3NcdefghIJklmnOPQRSTUvwx",
        "amount": 1000,
        "status": "succeeded"
    });
    assert_eq!(
        extract_stripe_payment_id(&obj).unwrap(),
        "pi_3NcdefghIJklmnOPQRSTUvwx"
    );
}

#[test]
fn extract_stripe_payment_id_from_charge() {
    let obj = serde_json::json!({
        "id": "ch_3NcdefghIJklmnOPQRSTUvwx",
        "payment_intent": "pi_3NcdefghIJklmnOPQRSTUvwx",
        "amount": 1000,
    });
    assert_eq!(
        extract_stripe_payment_id(&obj).unwrap(),
        "pi_3NcdefghIJklmnOPQRSTUvwx"
    );
}

#[test]
fn extract_stripe_payment_id_non_stripe_id() {
    let obj = serde_json::json!({"id": "evt_001"});
    assert!(extract_stripe_payment_id(&obj).is_none());
}

#[test]
fn extract_stripe_payment_id_no_payment_intent() {
    let obj = serde_json::json!({"id": "ch_001"});
    assert!(extract_stripe_payment_id(&obj).is_none());
}

// ── Sale lookup ───────────────────────────────────────────────

#[tokio::test]
async fn lookup_sale_by_gateway_ref_found() {
    let state = test_state();
    {
        let conn = state.db.lock().await;
        seed_payment(&conn, "pi_test_123", "sale-001");
    }
    let (sale_id, tenant_id) = lookup_sale_by_gateway_reference(&state, "pi_test_123")
        .await
        .unwrap();
    assert_eq!(sale_id, "sale-001");
    assert_eq!(
        tenant_id, "default",
        "unscoped seeded sale belongs to default"
    );
}

#[tokio::test]
async fn lookup_sale_by_gateway_ref_not_found() {
    let state = test_state();
    let result = lookup_sale_by_gateway_reference(&state, "pi_nonexistent").await;
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().0, StatusCode::NOT_FOUND);
}

// ── Webhook endpoint integration ──────────────────────────────

#[tokio::test]
async fn stripe_webhook_missing_signature_returns_400() {
    let app = test_router();
    let req = Request::builder()
        .method("POST")
        .uri("/api/webhooks/stripe")
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_test","amount":1000}}}"#))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn stripe_webhook_invalid_signature_returns_401() {
    let state = test_state_with_stripe("whsec_test_secret");
    let app = webhooks_router(state);
    let req = Request::builder()
        .method("POST")
        .uri("/api/webhooks/stripe")
        .header("Content-Type", "application/json")
        .header("Stripe-Signature", "t=1719000000,v1=invalid_sig")
        .body(Body::from(r#"{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_test","amount":1000}}}"#))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn stripe_webhook_valid_signature_happy_path() {
    let secret = "whsec_test_webhook_secret_123";

    let state = test_state_with_stripe(secret);
    let sale_id = "sale-webhook-001";
    {
        let conn = state.db.lock().await;
        seed_payment(&conn, "pi_3NcdefghIJklmnOPQRSTUvwx", sale_id);
    }

    let app = webhooks_router(state.clone());

    let payload = br#"{"id":"evt_test_happy","type":"payment_intent.succeeded","data":{"object":{"id":"pi_3NcdefghIJklmnOPQRSTUvwx","amount":1000,"status":"succeeded"}}}"#;
    let signature = stripe_signature(payload, secret);

    let req = Request::builder()
        .method("POST")
        .uri("/api/webhooks/stripe")
        .header("Content-Type", "application/json")
        .header("Stripe-Signature", &signature)
        .body(Body::from(payload.to_vec()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["status"], "accepted");
    assert_eq!(json["sale_id"], sale_id);

    // Verify offline_queue item was created
    {
        let conn = state.db.lock().await;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM offline_queue WHERE action = 'finalize_sale'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "should have enqueued one finalize_sale action");
    }
}

// ── Subscription lifecycle → tenant plan (ADR sync-plan-gating) ──

/// Send a signed Stripe subscription event through the router.
async fn post_stripe_subscription(
    state: &CloudServerState,
    event_type: &str,
    object: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let app = webhooks_router(state.clone());
    let secret = state.stripe_webhook_secret.clone().unwrap();
    let payload = serde_json::json!({
        "id": format!("evt_test_{}", uuid::Uuid::now_v7()),
        "type": event_type,
        "data": { "object": object },
    });
    let bytes = serde_json::to_vec(&payload).unwrap();
    let signature = stripe_signature(&bytes, &secret);

    let req = Request::builder()
        .method("POST")
        .uri("/api/webhooks/stripe")
        .header("Content-Type", "application/json")
        .header("Stripe-Signature", &signature)
        .body(Body::from(bytes))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value =
        serde_json::from_slice(&body_bytes).unwrap_or(serde_json::json!({}));
    (status, json)
}

fn tenant_plan(state: &CloudServerState, tenant_id: &str) -> Option<oz_core::TenantPlan> {
    let conn = state.db.try_lock().unwrap();
    oz_core::Store::new(&conn)
        .get_tenant_plan(tenant_id)
        .unwrap()
}

#[tokio::test]
async fn subscription_created_upgrades_tenant_to_pro() {
    let state = test_state_with_stripe("whsec_sub_test");
    let (status, json) = post_stripe_subscription(
        &state,
        "customer.subscription.created",
        serde_json::json!({
            "id": "sub_abc",
            "customer": "cus_123",
            "status": "active",
            "metadata": { "tenant_id": "tenant-a" },
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["status"], "accepted");
    assert_eq!(json["plan"], "pro");
    assert_eq!(
        tenant_plan(&state, "tenant-a"),
        Some(oz_core::TenantPlan::Pro),
        "paid subscription must upgrade the tenant's sync plan"
    );
}

#[tokio::test]
async fn subscription_created_records_customer_mapping() {
    let state = test_state_with_stripe("whsec_sub_test");
    post_stripe_subscription(
        &state,
        "customer.subscription.created",
        serde_json::json!({
            "id": "sub_abc",
            "customer": "cus_123",
            "status": "active",
            "metadata": { "tenant_id": "tenant-a" },
        }),
    )
    .await;
    let conn = state.db.try_lock().unwrap();
    let tenant = oz_core::Store::new(&conn)
        .get_tenant_for_stripe_customer("cus_123")
        .unwrap();
    assert_eq!(tenant, Some("tenant-a".to_string()));
}

#[tokio::test]
async fn subscription_deleted_downgrades_tenant_to_free_via_mapping() {
    let state = test_state_with_stripe("whsec_sub_test");
    // Seed: tenant-a is pro, and we know the customer mapping from the
    // original checkout (deleted events carry only the customer id).
    {
        let conn = state.db.try_lock().unwrap();
        let store = oz_core::Store::new(&conn);
        store
            .set_tenant_plan("tenant-a", oz_core::TenantPlan::Pro)
            .unwrap();
        store.set_stripe_customer("cus_123", "tenant-a").unwrap();
    }
    let (status, json) = post_stripe_subscription(
        &state,
        "customer.subscription.deleted",
        serde_json::json!({ "id": "sub_abc", "customer": "cus_123" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["status"], "accepted");
    assert_eq!(json["plan"], "free");
    assert_eq!(
        tenant_plan(&state, "tenant-a"),
        Some(oz_core::TenantPlan::Free),
        "cancelled subscription must downgrade the tenant's sync plan"
    );
}

#[tokio::test]
async fn checkout_completed_upgrades_tenant_to_pro() {
    let state = test_state_with_stripe("whsec_sub_test");
    let (status, json) = post_stripe_subscription(
        &state,
        "checkout.session.completed",
        serde_json::json!({
            "id": "cs_abc",
            "customer": "cus_456",
            "subscription": "sub_abc",
            "metadata": { "tenant_id": "tenant-b" },
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["plan"], "pro");
    assert_eq!(
        tenant_plan(&state, "tenant-b"),
        Some(oz_core::TenantPlan::Pro)
    );
}

#[tokio::test]
async fn invoice_paid_renews_pro_via_customer_mapping() {
    let state = test_state_with_stripe("whsec_sub_test");
    {
        let conn = state.db.try_lock().unwrap();
        oz_core::Store::new(&conn)
            .set_stripe_customer("cus_789", "tenant-c")
            .unwrap();
    }
    // invoice.paid carries only the customer id — resolve via mapping.
    let (status, json) = post_stripe_subscription(
        &state,
        "invoice.paid",
        serde_json::json!({ "id": "in_abc", "customer": "cus_789", "subscription": "sub_abc" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["plan"], "pro");
    assert_eq!(
        tenant_plan(&state, "tenant-c"),
        Some(oz_core::TenantPlan::Pro)
    );
}

#[tokio::test]
async fn subscription_updated_canceled_downgrades_tenant() {
    let state = test_state_with_stripe("whsec_sub_test");
    {
        let conn = state.db.try_lock().unwrap();
        oz_core::Store::new(&conn)
            .set_tenant_plan("tenant-a", oz_core::TenantPlan::Pro)
            .unwrap();
    }
    let (status, _) = post_stripe_subscription(
        &state,
        "customer.subscription.updated",
        serde_json::json!({
            "id": "sub_abc",
            "customer": "cus_123",
            "status": "canceled",
            "metadata": { "tenant_id": "tenant-a" },
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        tenant_plan(&state, "tenant-a"),
        Some(oz_core::TenantPlan::Free),
        "a canceled subscription must downgrade the plan"
    );
}

#[tokio::test]
async fn subscription_event_unknown_tenant_is_ignored_with_200() {
    let state = test_state_with_stripe("whsec_sub_test");
    let (status, json) = post_stripe_subscription(
        &state,
        "customer.subscription.created",
        serde_json::json!({
            "id": "sub_abc",
            "customer": "cus_unknown",
            "status": "active",
            "metadata": {},
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "unresolvable events must 200 so Stripe stops retrying"
    );
    assert_eq!(json["status"], "ignored");
}

#[tokio::test]
async fn stripe_webhook_sale_not_found_returns_404() {
    let secret = "whsec_test_secret";

    let state = test_state_with_stripe(secret);
    let app = webhooks_router(state);

    let payload = br#"{"id":"evt_test_404","type":"payment_intent.succeeded","data":{"object":{"id":"pi_unknown","amount":1000}}}"#;
    let signature = stripe_signature(payload, secret);

    let req = Request::builder()
        .method("POST")
        .uri("/api/webhooks/stripe")
        .header("Content-Type", "application/json")
        .header("Stripe-Signature", &signature)
        .body(Body::from(payload.to_vec()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn square_webhook_missing_signature_returns_400() {
    let app = test_router();
    let req = Request::builder()
        .method("POST")
        .uri("/api/webhooks/square")
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{"merchant_id":"m_001","type":"payment.updated","event_id":"evt_001","data":{"type":"payment","id":"pmt_001"}}"#))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn square_webhook_valid_signature_happy_path() {
    let secret = "sq0csp-test-webhook-key";
    let url = "https://example.com/api/webhooks/square";

    let state = test_state_with_square(secret, url);
    let sale_id = "sale-square-001";
    {
        let conn = state.db.lock().await;
        seed_payment(&conn, "pmt_square_001", sale_id);
    }

    let app = webhooks_router(state.clone());

    let payload = br#"{"merchant_id":"m_001","type":"payment.updated","event_id":"evt_001","data":{"type":"payment","id":"pmt_square_001"}}"#;
    let timestamp = "2026-07-01T12:00:00Z";

    // Build Square signature
    let body_str = std::str::from_utf8(payload).unwrap();
    let signed = format!("{}.{}.{}", url, body_str, timestamp);
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(signed.as_bytes());
    let signature = hex::encode(mac.finalize().into_bytes());

    let req = Request::builder()
        .method("POST")
        .uri("/api/webhooks/square")
        .header("Content-Type", "application/json")
        .header("x-square-hmacsha256-signature", &signature)
        .header("x-square-timestamp", timestamp)
        .body(Body::from(payload.to_vec()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["status"], "accepted");
    assert_eq!(json["sale_id"], sale_id);

    // Verify offline_queue item was created
    {
        let conn = state.db.lock().await;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM offline_queue WHERE action = 'finalize_sale'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "should have enqueued one finalize_sale action");
    }
}

/// Integration test against a live Postgres (the same Docker service
/// `db.rs` uses, port 15432). Skips when unreachable, so the suite stays
/// green on machines without a running Postgres.
#[tokio::test]
async fn pg_integration_webhooks_read_write_postgres() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let pool = match crate::db::DbPool::connect_postgres(&url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG webhooks integration test skipped: {e}");
            return;
        }
    };
    let state = CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: Some(pool.clone()),
        started_at: Instant::now(),
        health_depth_cache: crate::HealthDepthCache::default(),
        stripe_webhook_secret: Some("whsec_test".into()),
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let tenant = format!("pg-webhook-{}", uuid::Uuid::now_v7());
    let sale_id = format!("sale-{}", uuid::Uuid::now_v7());
    let gateway_ref = format!("pi_pg_{}", uuid::Uuid::now_v7());
    let event_id = format!("evt_pg_{}", uuid::Uuid::now_v7());

    // ── Dedup helpers ──
    assert!(!event_already_processed(&state, &event_id).await);
    assert!(!square_event_already_processed(&state, &event_id).await);
    record_event_processed(
        &state,
        &event_id,
        "stripe",
        Some("payment_intent.succeeded"),
    )
    .await;
    assert!(event_already_processed(&state, &event_id).await);
    assert!(square_event_already_processed(&state, &event_id).await);

    // ── Payment → sale lookup + finalize_sale enqueue ──
    {
        let client = pool.get().await.unwrap();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        client
            .execute(
                "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, tenant_id)
                 VALUES ($1, 700, 'USD', 1, 'pending', $2, $2, $3)",
                &[&sale_id, &now, &tenant],
            )
            .await
            .unwrap();
        client
            .execute(
                "INSERT INTO payments (id, sale_id, method, amount_minor, currency, created_at, gateway_reference)
                 VALUES ($1, $2, 'card', 700, 'USD', $3, $4)",
                &[
                    &format!("pay-{tenant}"),
                    &sale_id,
                    &now,
                    &gateway_ref,
                ],
            )
            .await
            .unwrap();
    }
    let (found, found_tenant) = lookup_sale_by_gateway_reference(&state, &gateway_ref)
        .await
        .expect("sale must resolve via gateway reference");
    assert_eq!(found, sale_id);
    assert_eq!(found_tenant, tenant, "lookup must return the sale's tenant");
    assert!(matches!(
        lookup_sale_by_gateway_reference(&state, "pi_missing").await,
        Err((StatusCode::NOT_FOUND, _))
    ));

    enqueue_finalize_sale(&state, &sale_id, &tenant)
        .await
        .expect("enqueue_finalize_sale");
    {
        let client = pool.get().await.unwrap();
        let row = client
            .query_opt(
                "SELECT tenant_id FROM offline_queue WHERE action = 'finalize_sale' AND payload LIKE $1",
                &[&format!("%{sale_id}%")],
            )
            .await
            .unwrap();
        let row = row.expect("one finalize_sale must be enqueued on Postgres");
        let queued_tenant: String = row.get(0);
        assert_eq!(
            queued_tenant, tenant,
            "finalize_sale must be enqueued under the sale's tenant"
        );
    }

    // ── Tenant resolution (metadata → mapping) ──
    let with_metadata = serde_json::json!({
        "id": "sub_pg",
        "customer": format!("cus_pg_{}", uuid::Uuid::now_v7()),
        "status": "active",
        "metadata": { "tenant_id": tenant },
    });
    let resolved = resolve_subscription_tenant(&state, &with_metadata)
        .await
        .expect("metadata resolve");
    assert_eq!(resolved.as_deref(), Some(tenant.as_str()));

    let customer_only = serde_json::json!({ "customer": with_metadata["customer"] });
    let resolved = resolve_subscription_tenant(&state, &customer_only)
        .await
        .expect("mapping resolve");
    assert_eq!(resolved.as_deref(), Some(tenant.as_str()));

    // ── Full subscription event → tenant plan upgraded ──
    let event = StripeEvent {
        id: format!("evt_upgrade_{}", uuid::Uuid::now_v7()),
        r#type: "customer.subscription.created".into(),
        data: StripeEventData {
            object: serde_json::json!({
                "id": "sub_pg",
                "customer": "cus_upgrade",
                "status": "active",
                "metadata": { "tenant_id": tenant },
            }),
        },
    };
    let resp = handle_subscription_event(&state, &event)
        .await
        .expect("handle_subscription_event");
    assert_eq!(resp.0["plan"], "pro");
    assert_eq!(
        oz_api::pg::get_tenant_plan(&pool, &tenant)
            .await
            .expect("get_tenant_plan"),
        Some(oz_core::TenantPlan::Pro)
    );

    // ── Clean up so a shared dev DB stays tidy ──
    {
        let client = pool.get().await.unwrap();
        client
            .execute(
                "DELETE FROM offline_queue WHERE payload LIKE $1",
                &[&format!("%{sale_id}%")],
            )
            .await
            .unwrap();
        client
            .execute("DELETE FROM payments WHERE sale_id = $1", &[&sale_id])
            .await
            .unwrap();
        client
            .execute("DELETE FROM sales WHERE id = $1", &[&sale_id])
            .await
            .unwrap();
        client
            .execute(
                "DELETE FROM stripe_customers WHERE tenant_id = $1",
                &[&tenant],
            )
            .await
            .unwrap();
        client
            .execute("DELETE FROM tenant_plans WHERE tenant_id = $1", &[&tenant])
            .await
            .unwrap();
        client
            .execute(
                "DELETE FROM processed_webhooks WHERE event_id = $1",
                &[&event_id],
            )
            .await
            .unwrap();
    }
}

/// Integration test: the full webhook path works as the restricted
/// `oz_app` role after the RLS cutover.
///
/// Webhook handlers are signature-authenticated but NOT tenant-
/// authenticated: they must resolve the tenant from the data (the
/// `stripe_customers` mapping, or the `payments → sales` join) before
/// any tenant-scoped write. Under FORCE RLS as `oz_app` (a non-owner)
/// those resolution reads would return zero rows, so the handlers run
/// them in a transaction scoped to the dedicated BYPASSRLS role
/// (`oz_webhook_resolver`), and every write after resolution runs with
/// `SET LOCAL oz.tenant_id`.
///
/// Runs on a throwaway database (created + dropped here) so the
/// committed cutover cannot race the other PG integration tests on a
/// shared dev DB. Skips when Postgres is unreachable or the URL role
/// lacks `CREATE DATABASE` (the established pattern).
///
/// Serialized with the email RLS tests: the real cutover script creates
/// cluster-wide roles (oz_app, oz_webhook_resolver, oz_email_discovery)
/// that the email tests also create/drop — concurrent CREATE/DROP ROLE
/// on the shared cluster races.
#[tokio::test]
#[serial(pg_rls_cutover)]
async fn pg_integration_webhooks_restricted_role_after_cutover() {
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    // Admin connection is raw (apply_schema = false): it only sweeps
    // stale databases/roles and creates the throwaway DB, so it must not
    // re-apply PG_INIT to the shared base DB (concurrent catalog DDL
    // across parallel PG test binaries is a flake source).
    let pool = match crate::db::DbPool::connect_postgres(&url, false, 20, false).await {
        Ok(crate::db::DbPool::Postgres(pool)) => pool,
        Ok(_) => unreachable!("connect_postgres with a postgres:// URL returns Postgres"),
        Err(e) => {
            eprintln!("PG webhook RLS test skipped: {e}");
            return;
        }
    };
    let admin = pool.get().await.expect("admin client");

    // ── Throwaway database (isolated from the shared dev DB) ──
    // Sweep any stale throwaway DBs a crashed run left behind (only this
    // test creates `oz_wh_rls_%`), then drop a leftover resolver role
    // whose grants died with those DBs.
    let stale: Vec<String> = admin
        .query(
            "SELECT datname FROM pg_database WHERE datname LIKE 'oz_wh_rls_%'",
            &[],
        )
        .await
        .expect("stale database query")
        .iter()
        .map(|r| r.get::<_, String>(0))
        .collect();
    for d in &stale {
        admin
            .batch_execute(&format!("DROP DATABASE IF EXISTS {d} WITH (FORCE);"))
            .await
            .expect("drop stale test database");
    }
    // NOTE: `oz_webhook_resolver` is deliberately NOT dropped here. It is
    // a cluster-wide role that the real cutover script (`rls-cutover.sql`,
    // executed below) creates on the shared cluster; under nextest each
    // test runs in its own process, so dropping it from this stale-cleanup
    // raced a concurrent test that was mid-flight creating/using it (the
    // observed flake: "tuple concurrently updated" / deadlock). The cutover
    // creates it idempotently (`IF NOT EXISTS`) and it owns nothing, so it
    // is safe to leave in place across test runs.
    let db_name = format!("oz_wh_rls_{}", std::process::id());
    if let Err(e) = admin
        .execute(&format!("CREATE DATABASE {db_name}"), &[])
        .await
    {
        eprintln!("PG webhook RLS test skipped: cannot CREATE DATABASE ({e})");
        return;
    }

    // URL for the throwaway DB (swap the path segment, keep any query).
    let (base, query) = match url.split_once('?') {
        Some((b, q)) => (b, Some(q)),
        None => (url.as_str(), None),
    };
    let (head, _old_db) = base
        .rsplit_once('/')
        .expect("URL must have a database path");
    let db_url = match query {
        Some(q) => format!("{head}/{db_name}?{q}"),
        None => format!("{head}/{db_name}"),
    };

    // Full schema + RLS appendix (ENABLE ROW LEVEL SECURITY + policy).
    let schema_pool = match crate::db::DbPool::connect_postgres(&db_url, false, 20, true).await {
        Ok(crate::db::DbPool::Postgres(p)) => p,
        _ => unreachable!("schema pool is postgres"),
    };
    let owner = schema_pool.get().await.expect("owner client");

    // ── The real cutover script: roles + FORCE (committed; idempotent) ──
    const CUTOVER: &str = include_str!("../../../scripts/rls-cutover.sql");
    owner
        .batch_execute(CUTOVER)
        .await
        .expect("cutover script should execute");
    owner
        .batch_execute("ALTER ROLE oz_app LOGIN PASSWORD 'oz_app_test_pw';")
        .await
        .expect("enable oz_app login should succeed");

    // ── Seed as owner. FORCE applies to the owner too now, so scope the
    //    seeding transaction to the tenant. ──
    let ns = format!("wh-rls-{}", std::process::id());
    let tenant = format!("{ns}-ten");
    let sale_id = format!("sale-{}", uuid::Uuid::now_v7());
    let gateway_ref = format!("pi_{ns}");
    let customer = format!("cus_{ns}");
    let event_id = format!("evt_{ns}");
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    {
        let mut client = schema_pool.get().await.expect("seed client");
        let tx = client.transaction().await.expect("seed tx");
        tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
            .await
            .expect("seed GUC");
        tx.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at, tenant_id)
             VALUES ($1, 700, 'USD', 1, 'pending', $2, $2, $3)",
            &[&sale_id, &now, &tenant],
        )
        .await
        .expect("seed sale");
        tx.execute(
            "INSERT INTO payments (id, sale_id, method, amount_minor, currency, created_at, gateway_reference)
             VALUES ($1, $2, 'card', 700, 'USD', $3, $4)",
            &[&format!("pay-{ns}"), &sale_id, &now, &gateway_ref],
        )
        .await
        .expect("seed payment");
        tx.commit().await.expect("seed commit");
    }

    // ── Proof 1: RLS is genuinely live for oz_app (no GUC → zero rows) ──
    {
        let (raw, conn) = tokio_postgres::connect(&db_url, tokio_postgres::NoTls)
            .await
            .expect("dedicated probe connection");
        tokio::spawn(async move {
            let _ = conn.await;
        });
        raw.batch_execute("SET ROLE oz_app")
            .await
            .expect("SET ROLE oz_app should succeed");
        let visible: i64 = raw
            .query_one("SELECT COUNT(*) FROM sales", &[])
            .await
            .expect("count should succeed")
            .get(0);
        assert_eq!(
            visible, 0,
            "RLS must hide sales rows from oz_app without the GUC"
        );
    }

    // ── The app pool: connects AS the restricted role ──
    let scheme_end = url.find("://").expect("URL has a scheme") + 3;
    let at = url.find('@').expect("URL has credentials");
    let app_url = format!(
        "{}oz_app:oz_app_test_pw@{}",
        &db_url[..scheme_end],
        &db_url[at + 1..]
    );
    let app_pool = {
        use deadpool_postgres::Manager;
        use std::str::FromStr;
        let config = tokio_postgres::Config::from_str(&app_url).expect("valid app URL");
        let manager = Manager::new(config, tokio_postgres::NoTls);
        deadpool_postgres::Pool::builder(manager)
            .max_size(2)
            .build()
            .expect("app pool build")
    };

    let state = CloudServerState {
        db: Arc::new(Mutex::new(fresh_db())),
        pg: Some(app_pool.clone()),
        started_at: Instant::now(),
        health_depth_cache: crate::HealthDepthCache::default(),
        stripe_webhook_secret: Some("whsec_rls_test".into()),
        square_webhook_signature_key: None,
        square_webhook_url: None,
        midtrans_server_key: None,
        midtrans_sandbox: false,
        midtrans_qris_acquirer: None,
    };
    let app = webhooks_router(state.clone());
    let secret = "whsec_rls_test";

    // ── Proof 2: payment webhook — resolve sale → enqueue under tenant ──
    let payload = format!(
        r#"{{"id":"{event_id}","type":"payment_intent.succeeded","data":{{"object":{{"id":"{gateway_ref}","amount":700}}}}}}"#
    );
    let signature = stripe_signature(payload.as_bytes(), secret);
    let req = Request::builder()
        .method("POST")
        .uri("/api/webhooks/stripe")
        .header("Content-Type", "application/json")
        .header("Stripe-Signature", &signature)
        .body(Body::from(payload.clone()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["status"], "accepted");
    assert_eq!(json["sale_id"], sale_id);

    // The finalize_sale enqueue landed under the sale's tenant (the
    // write ran as oz_app with the GUC — the offline_queue row is
    // visible to the owner only with the same tenant GUC).
    {
        let mut client = schema_pool.get().await.expect("queue client");
        let tx = client.transaction().await.expect("queue tx");
        tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
            .await
            .expect("queue GUC");
        let row = tx
            .query_opt(
                "SELECT action, tenant_id FROM offline_queue WHERE payload LIKE $1",
                &[&format!("%{sale_id}%")],
            )
            .await
            .expect("queue query")
            .expect("one finalize_sale must be enqueued");
        assert_eq!(row.get::<_, String>(0), "finalize_sale");
        assert_eq!(row.get::<_, String>(1), tenant);
        tx.commit().await.expect("queue commit");
    }

    // ── Proof 3: redelivery is deduplicated (dedup runs as oz_app) ──
    let req = Request::builder()
        .method("POST")
        .uri("/api/webhooks/stripe")
        .header("Content-Type", "application/json")
        .header("Stripe-Signature", &signature)
        .body(Body::from(payload))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["status"], "already_processed");

    // ── Proof 4: subscription event — resolve tenant, update plan, and
    //    record the stripe_customers mapping (all writes as oz_app) ──
    let sub_payload = format!(
        r#"{{"id":"evt_sub_{ns}","type":"customer.subscription.created","data":{{"object":{{"id":"sub_{ns}","customer":"{customer}","status":"active","metadata":{{"tenant_id":"{tenant}"}}}}}}}}"#
    );
    let signature = stripe_signature(sub_payload.as_bytes(), secret);
    let req = Request::builder()
        .method("POST")
        .uri("/api/webhooks/stripe")
        .header("Content-Type", "application/json")
        .header("Stripe-Signature", &signature)
        .body(Body::from(sub_payload))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["plan"], "pro");
    assert_eq!(
        oz_api::pg::get_tenant_plan(&schema_pool, &tenant)
            .await
            .expect("get_tenant_plan"),
        Some(oz_core::TenantPlan::Pro)
    );
    {
        let mut client = schema_pool.get().await.expect("mapping client");
        let tx = client.transaction().await.expect("mapping tx");
        tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
            .await
            .expect("mapping GUC");
        let mapped: Option<String> = tx
            .query_opt(
                "SELECT tenant_id FROM stripe_customers WHERE stripe_customer_id = $1",
                &[&customer],
            )
            .await
            .expect("mapping query")
            .map(|r| r.get(0));
        assert_eq!(
            mapped.as_deref(),
            Some(tenant.as_str()),
            "the metadata-path mapping upsert must land"
        );
        tx.commit().await.expect("mapping commit");
    }

    // ── Cleanup: drop every handle, then the throwaway database, and
    //    restore the shared cluster's role state ──
    drop(state);
    drop(app_pool);
    drop(owner);
    drop(schema_pool);
    drop(pool);
    admin
        .batch_execute(&format!("DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"))
        .await
        .expect("drop throwaway database should succeed");
    // The resolver role's grants died with the throwaway database and its
    // oz_app membership is auto-revoked on drop — remove it so no
    // residue lingers in the shared cluster. oz_app predates this test
    // (it is the documented deployment role); restore it to the
    // cutover's canonical NOLOGIN state.
    admin
        .batch_execute("ALTER ROLE oz_app NOLOGIN;")
        .await
        .expect("role cleanup should succeed");
    // `oz_webhook_resolver` is deliberately left in place — see the NOTE at
    // the stale-role cleanup above. Dropping it here would race concurrent
    // tests that use it; the cutover re-creates it idempotently (`IF NOT
    // EXISTS`) on the next run.
}

// ── Midtrans QRIS notifications (agents-1 Phase 1.2) ─────────────────

use sha2::{Digest, Sha512};

const MID_KEY: &str = "MID-server-test-key-SECRET";

/// Recompute a notification signature the documented Midtrans way:
/// SHA512 over the concatenated `order_id + status_code + gross_amount + key`.
fn midtrans_sig(order_id: &str, code: &str, gross: &str, key: &str) -> String {
    let mut d = Sha512::new();
    d.update(order_id.as_bytes());
    d.update(code.as_bytes());
    d.update(gross.as_bytes());
    d.update(key.as_bytes());
    hex::encode(d.finalize())
}

fn midtrans_state() -> CloudServerState {
    let mut s = test_state();
    s.midtrans_server_key = Some(MID_KEY.to_string());
    s
}

async fn issue_order(state: &CloudServerState, order_id: &str, amount_minor: i64) {
    let l = LedgerDb {
        db: state.db.clone(),
        pg: None,
    };
    l.record_issue(order_id, "tenant-Q", "sale-Q", amount_minor, "IDR")
        .await
        .unwrap();
}

async fn notify(state: CloudServerState, body: serde_json::Value) -> axum::response::Response {
    webhooks_router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/webhooks/midtrans")
                .header("Content-Type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

fn settlement_body(order_id: &str, gross: &str, sig: &str) -> serde_json::Value {
    serde_json::json!({
        "transaction_id": "txn-x",
        "transaction_status": "settlement",
        "transaction_status_code": "200",
        "order_id": order_id,
        "gross_amount": gross,
        "currency": "IDR",
        "payment_type": "qris",
        "signature_type": "sha512",
        "signature_key": sig,
    })
}

async fn queue_depth(state: &CloudServerState) -> i64 {
    let conn = state.db.lock().await;
    conn.query_row(
        "SELECT COUNT(*) FROM offline_queue WHERE action = 'finalize_sale'",
        [],
        |r| r.get::<_, i64>(0),
    )
    .unwrap()
}

#[tokio::test]
async fn midtrans_settlement_enqueues_finalize() {
    let state = midtrans_state();
    issue_order(&state, "QRIS-w1", 15000).await;
    let sig = midtrans_sig("QRIS-w1", "200", "15000.00", MID_KEY);
    let resp = notify(state.clone(), settlement_body("QRIS-w1", "15000.00", &sig)).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json: serde_json::Value =
        serde_json::from_slice(&resp.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(json["status"], "finalization_queued");
    assert_eq!(queue_depth(&state).await, 1);
    let l = LedgerDb {
        db: state.db.clone(),
        pg: None,
    };
    assert_eq!(
        l.lookup("QRIS-w1").await.unwrap().unwrap().status,
        "settlement"
    );
}

#[tokio::test]
async fn midtrans_duplicate_notification_is_idempotent() {
    let state = midtrans_state();
    issue_order(&state, "QRIS-w2", 12000).await;
    let sig = midtrans_sig("QRIS-w2", "200", "12000.00", MID_KEY);
    let resp = notify(state.clone(), settlement_body("QRIS-w2", "12000.00", &sig)).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let resp2 = notify(state.clone(), settlement_body("QRIS-w2", "12000.00", &sig)).await;
    let json2: serde_json::Value =
        serde_json::from_slice(&resp2.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(json2["status"], "already_processed");
    assert_eq!(
        queue_depth(&state).await,
        1,
        "duplicate must not double-enqueue"
    );
}

#[tokio::test]
async fn midtrans_bad_signature_is_401_and_records_nothing() {
    let state = midtrans_state();
    issue_order(&state, "QRIS-w3", 10000).await;
    let resp = notify(
        state.clone(),
        settlement_body(
            "QRIS-w3",
            "10000.00",
            &midtrans_sig("QRIS-w3", "200", "10000.00", "WRONG-KEY"),
        ),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(queue_depth(&state).await, 0);
    let l = LedgerDb {
        db: state.db.clone(),
        pg: None,
    };
    assert_eq!(l.lookup("QRIS-w3").await.unwrap().unwrap().status, "issued");
}

#[tokio::test]
async fn midtrans_amount_mismatch_never_finalizes() {
    // A correctly signed settlement whose amount differs from what was
    // issued is an incident: journal it, do NOT finalize on it.
    let state = midtrans_state();
    issue_order(&state, "QRIS-w4", 15000).await;
    let sig = midtrans_sig("QRIS-w4", "200", "99999.00", MID_KEY);
    let resp = notify(state.clone(), settlement_body("QRIS-w4", "99999.00", &sig)).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json: serde_json::Value =
        serde_json::from_slice(&resp.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(json["reason"], "amount_mismatch");
    assert_eq!(queue_depth(&state).await, 0);
    let l = LedgerDb {
        db: state.db.clone(),
        pg: None,
    };
    assert_eq!(
        l.lookup("QRIS-w4").await.unwrap().unwrap().status,
        "amount_mismatch"
    );
}

#[tokio::test]
async fn midtrans_unknown_order_is_ignored_with_200() {
    let state = midtrans_state();
    let sig = midtrans_sig("QRIS-ghost", "200", "5000.00", MID_KEY);
    let resp = notify(
        state.clone(),
        settlement_body("QRIS-ghost", "5000.00", &sig),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json: serde_json::Value =
        serde_json::from_slice(&resp.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(json["status"], "ignored");
    assert_eq!(queue_depth(&state).await, 0);
}

#[tokio::test]
async fn midtrans_expire_records_but_never_finalizes() {
    let state = midtrans_state();
    issue_order(&state, "QRIS-w5", 20000).await;
    let sig = midtrans_sig("QRIS-w5", "203", "20000.00", MID_KEY);
    let resp = notify(
        state.clone(),
        serde_json::json!({
            "order_id": "QRIS-w5",
            "transaction_status": "expire",
            "transaction_status_code": "203",
            "gross_amount": "20000.00",
            "signature_type": "sha512",
            "signature_key": sig,
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(queue_depth(&state).await, 0);
    let l = LedgerDb {
        db: state.db.clone(),
        pg: None,
    };
    assert_eq!(l.lookup("QRIS-w5").await.unwrap().unwrap().status, "expire");
}

#[tokio::test]
async fn midtrans_unconfigured_key_fails_closed() {
    // No MIDTRANS_SERVER_KEY in state: nothing is settleable, and the
    // handler must not fall through to an unverified path.
    let state = test_state();
    let sig = midtrans_sig("QRIS-w6", "200", "1.00", MID_KEY);
    let resp = notify(state.clone(), settlement_body("QRIS-w6", "1.00", &sig)).await;
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[test]
fn midtrans_gross_parse_policy() {
    // Signed amount strings map 1:1; fractions and garbage never silently
    // become a number (the PAY-1 bug class).
    assert_eq!(midtrans_gross_to_minor("15000.00"), Some(15000));
    assert_eq!(midtrans_gross_to_minor("15000"), Some(15000));
    assert_eq!(midtrans_gross_to_minor(" 15000.00 "), Some(15000));
    assert_eq!(midtrans_gross_to_minor("15000.50"), None);
    assert_eq!(midtrans_gross_to_minor("abc"), None);
    assert_eq!(midtrans_gross_to_minor(""), None);
}
