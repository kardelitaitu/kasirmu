//! Route-level matrix for the Idempotency-Key guard on POST /api/v1/sales.
//!
//! Drives the real router over one shared migrated in-memory database, so every
//! case lands on the pg: None (SQLite) branch - the only branch reachable
//! without a live Postgres pool. Each case reads the sale_idempotency table back
//! too, because the receipt rows are where the contract is decided: a NULL key
//! for every unguarded submit, exactly one row per guarded sale, and uniqueness
//! scoped to (tenant_id, key) so one tenant cannot reach across.
//!
//! The Postgres branch runs the same statements plus an ON CONFLICT read-back
//! (crate::pg::claim_sale_idempotency). AppState.db is one Arc<Mutex<Connection>>,
//! so two in-flight requests are serialised by that lock: the concurrent case
//! proves one sale, no 500, and sends the loser through the replay path - it is
//! NOT two transactions racing on one unique index, which needs a live pool and
//! is not claimed here.

use super::*;
use crate::auth;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use std::sync::Arc;
use tower::ServiceExt;

/// The router plus a handle on the same database behind it.
struct Ctx {
    app: axum::Router,
    db: Arc<tokio::sync::Mutex<rusqlite::Connection>>,
}

/// Build a router over a fresh migrated database.
fn ctx() -> Ctx {
    let state = AppState::test(kasirmu_core::migrations::fresh_db());
    let db = state.db.clone();
    Ctx {
        app: crate::router(state),
        db,
    }
}

/// A non-expired token, optionally carrying a tenant claim.
fn token(tenant: Option<&str>) -> String {
    auth::create_token("terminal-1", Some(1), tenant, None)
        .unwrap()
        .token
}

/// A one-line basket, assembled through serde_json so nothing needs escaping.
fn basket(sku: &str, units: i64) -> String {
    serde_json::json!({
        "lines": [{
            "sku": sku,
            "qty": 1,
            "unit_price": { "minor_units": units, "currency": "USD" }
        }]
    })
    .to_string()
}

/// POST one basket, with or without the guard header.
fn post(tenant: Option<&str>, key: Option<&str>, payload: &str) -> Request<Body> {
    let auth_header = format!("Bearer {}", token(tenant));
    let mut b = Request::builder()
        .method("POST")
        .uri("/api/v1/sales")
        .header("content-type", "application/json")
        .header("authorization", auth_header);
    if let Some(k) = key {
        b = b.header("idempotency-key", k);
    }
    b.body(Body::from(payload.to_owned())).unwrap()
}

/// Collect a response body as JSON.
async fn json_of(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

/// One submit through the router: status, sale id (empty if the body has none),
/// and the whole body.
async fn submit(
    ctx: &Ctx,
    tenant: Option<&str>,
    key: Option<&str>,
    sku: &str,
    units: i64,
) -> (StatusCode, String, serde_json::Value) {
    let resp = ctx
        .app
        .clone()
        .oneshot(post(tenant, key, &basket(sku, units)))
        .await
        .unwrap();
    let status = resp.status();
    let json = json_of(resp).await;
    let id = json["id"].as_str().unwrap_or_default().to_string();
    (status, id, json)
}

/// How many sales the ledger holds.
async fn sales(ctx: &Ctx) -> i64 {
    let db = ctx.db.lock().await;
    db.query_row("SELECT count(*) FROM sales", [], |r| r.get::<_, i64>(0))
        .unwrap()
}

/// Every receipt row as (sale_id, key).
async fn receipts(ctx: &Ctx) -> Vec<(String, Option<String>)> {
    let db = ctx.db.lock().await;
    let mut stmt = db
        .prepare("SELECT sale_id, key FROM sale_idempotency ORDER BY sale_id")
        .unwrap();

    stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
    })
    .unwrap()
    .collect::<Result<Vec<_>, rusqlite::Error>>()
    .unwrap()
}

// ────────────────────── The matrix ──────────────────────

/// 1. First guarded submit: writes the sale, answers 201, stores the key.
#[tokio::test]
async fn first_submit_creates_a_sale() {
    let ctx = ctx();
    let (status, id, json) = submit(&ctx, None, Some("attempt-1"), "COFFEE", 350).await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(!id.is_empty(), "the response names a real sale");
    assert_eq!(json["status"], "pending");
    assert_eq!(json["total"]["minor_units"], 350);
    assert_eq!(sales(&ctx).await, 1);
    assert_eq!(receipts(&ctx).await, vec![(id, Some("attempt-1".into()))]);
}

/// 2. Two submits of one key in flight together: exactly one sale, one 201 and
/// one 200, never a 500. The shared connection mutex serialises them, so the
/// loser arrives at an already-held slot and is answered with the receipt.
#[tokio::test]
async fn concurrent_same_key_yields_one_sale_and_no_500() {
    let ctx = ctx();
    let key = "attempt-2";
    let a = ctx
        .app
        .clone()
        .oneshot(post(None, Some(key), &basket("COFFEE", 350)));
    let b = ctx
        .app
        .clone()
        .oneshot(post(None, Some(key), &basket("COFFEE", 350)));
    let (ra, rb) = tokio::join!(a, b);
    let mut codes = [ra.unwrap().status(), rb.unwrap().status()];
    codes.sort_by_key(|c| c.as_u16());
    assert_eq!(
        codes,
        [StatusCode::OK, StatusCode::CREATED],
        "one submit creates, the other replays, neither errors"
    );
    assert_eq!(sales(&ctx).await, 1, "exactly one sale for one key");
    assert_eq!(receipts(&ctx).await.len(), 1);
}

/// 3. Same key twice sequentially, after the first ack came back: 200 with the
/// ORIGINAL sale body, not the retried basket.
#[tokio::test]
async fn same_key_sequentially_replays_the_same_id() {
    let ctx = ctx();
    let (first, first_id, first_json) = submit(&ctx, None, Some("attempt-3"), "COFFEE", 350).await;
    let (again, again_id, again_json) = submit(&ctx, None, Some("attempt-3"), "BAGEL", 999).await;
    assert_eq!(first, StatusCode::CREATED);
    assert_eq!(again, StatusCode::OK);
    assert_eq!(again_id, first_id);
    assert_eq!(again_json, first_json, "the receipt is the original sale");
    assert_eq!(sales(&ctx).await, 1);
}

/// 4. Two distinct keys are two sales, even for one identical basket.
#[tokio::test]
async fn two_distinct_keys_create_two_sales() {
    let ctx = ctx();
    let (s1, id1, _) = submit(&ctx, None, Some("attempt-4a"), "COFFEE", 350).await;
    let (s2, id2, _) = submit(&ctx, None, Some("attempt-4b"), "COFFEE", 350).await;
    assert_eq!(s1, StatusCode::CREATED);
    assert_eq!(s2, StatusCode::CREATED);
    assert_ne!(id1, id2, "content is never a deduplication input");
    assert_eq!(sales(&ctx).await, 2);
    assert_eq!(receipts(&ctx).await.len(), 2);
}

/// 5. The third-party regression guard: an ABSENT header stays unguarded, so
/// two identical unguarded submits are two sales and two 201s.
#[tokio::test]
async fn absent_key_creates_two_sales() {
    let ctx = ctx();
    let (s1, id1, _) = submit(&ctx, None, None, "COFFEE", 350).await;
    let (s2, id2, _) = submit(&ctx, None, None, "COFFEE", 350).await;
    assert_eq!(s1, StatusCode::CREATED);
    assert_eq!(s2, StatusCode::CREATED, "no header means no guard");
    assert_ne!(id1, id2);
    assert_eq!(sales(&ctx).await, 2);
    let rows = receipts(&ctx).await;
    assert_eq!(rows.len(), 2);
    assert!(
        rows.iter().all(|(_, k)| k.is_none()),
        "unguarded sales store NULL, which never matches"
    );
}

/// 6. Empty and whitespace-only keys behave exactly like an absent one, and no
/// row is stored under a blank or synthetic key — notably never a ':0' form.
#[tokio::test]
async fn blank_or_whitespace_key_behaves_as_absent() {
    let ctx = ctx();
    for key in ["", "   ", "\t"] {
        let (status, _, _) = submit(&ctx, None, Some(key), "COFFEE", 350).await;
        assert_eq!(status, StatusCode::CREATED, "blank key must not guard");
    }
    assert_eq!(sales(&ctx).await, 3);
    let rows = receipts(&ctx).await;
    assert_eq!(rows.len(), 3);
    assert!(
        rows.iter().all(|(_, k)| k.is_none()),
        "a blank key must never reach the table as a value"
    );
    let db = ctx.db.lock().await;
    let n: i64 = db
        .query_row(
            "SELECT count(*) FROM sale_idempotency WHERE key IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    drop(db);
    assert_eq!(n, 0, "no non-null key row of any kind was written");
}

/// 7. Tenant isolation on one key: neither resolves to the other's sale nor
/// blocks it. Both create; each replays only its own.
#[tokio::test]
async fn same_key_from_two_tenants_neither_resolves_nor_blocks() {
    let ctx = ctx();
    let (sa, ida, _) = submit(&ctx, Some("tenant-a"), Some("shared-key"), "COFFEE", 350).await;
    let (sb, idb, _) = submit(&ctx, Some("tenant-b"), Some("shared-key"), "COFFEE", 350).await;
    assert_eq!(sa, StatusCode::CREATED);
    assert_eq!(sb, StatusCode::CREATED, "tenant B must not be blocked by A");
    assert_ne!(ida, idb, "A must not resolve to B's sale");
    assert_eq!(sales(&ctx).await, 2);
    let (ra, replay_a, _) = submit(&ctx, Some("tenant-a"), Some("shared-key"), "COFFEE", 350).await;
    let (rb, replay_b, _) = submit(&ctx, Some("tenant-b"), Some("shared-key"), "COFFEE", 350).await;
    assert_eq!(ra, StatusCode::OK);
    assert_eq!(replay_a, ida, "A replays A's sale");
    assert_eq!(rb, StatusCode::OK);
    assert_eq!(replay_b, idb, "B replays B's sale");
    assert_eq!(sales(&ctx).await, 2, "still only the two original sales");
}

// ────────────────────── Header parsing ──────────────────────

/// Blank means unguarded, and unguarded is never a rejection.
#[test]
fn guard_key_absent_or_blank_is_unguarded() {
    let mut h = HeaderMap::new();
    assert_eq!(guard_key(&h), None, "absent header is unguarded");
    for raw in ["", " ", "\t ", "   \t"] {
        h.insert(
            IDEMPOTENCY_KEY_HEADER,
            axum::http::HeaderValue::from_str(raw).unwrap(),
        );
        assert_eq!(guard_key(&h), None, "blank {raw:?} is unguarded");
        assert!(guard_key_reject(guard_key(&h)).is_none());
    }
}

/// An opaque key is taken verbatim: no trimming, no folding, no re-mint.
#[test]
fn guard_key_is_taken_verbatim() {
    let mut h = HeaderMap::new();
    h.insert(
        IDEMPOTENCY_KEY_HEADER,
        axum::http::HeaderValue::from_str("a-1.B_2:c").unwrap(),
    );
    assert_eq!(guard_key(&h), Some("a-1.B_2:c"));
}

/// A present key that cannot be stored is rejected, never repaired.
#[test]
fn guard_key_rejects_unstorable_values() {
    let ok = ["abc", "A1", "a.b", "a_b", "a:b", "a-b"];
    for k in ok {
        assert!(
            guard_key_reject(Some(k)).is_none(),
            "{k:?} must be accepted"
        );
    }
    let long = "x".repeat(IDEMPOTENCY_KEY_MAX_LEN);
    assert!(guard_key_reject(Some(long.as_str())).is_none());
    let too_long = "x".repeat(IDEMPOTENCY_KEY_MAX_LEN + 1);
    assert!(
        guard_key_reject(Some(too_long.as_str())).is_some(),
        "cap is enforced"
    );
    let bad = ["has space", "sl/ash", "quo\"te", "a\u{1F600}", "semi;colon"];
    for k in bad {
        assert!(
            guard_key_reject(Some(k)).is_some(),
            "{k:?} must be rejected"
        );
    }
    assert!(guard_key_reject(None).is_none(), "absent is never an error");
}
