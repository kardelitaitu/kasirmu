//! Outbound webhooks (cloud surface only): endpoint registry, sync-push
//! fan-out, and signed delivery through the transactional outbox
//! (ADR #43 D7).
//!
//! Flow: `push_handler` accepts a batch of offline-queue items →
//! [`fanout`] enqueues one `webhook` outbox entry per (item, matching
//! endpoint) pair → the outbox drainer delivers each via
//! [`deliver_webhook`] (HMAC-SHA256-signed POST, retry/backoff/
//! dead-letter inherited from the outbox). Merchants manage endpoints
//! through the admin-key-gated `/api/webhooks` router ([`outbound_router`]).
//!
//! The desktop local API deliberately does NOT embed this module: a
//! loopback POS must not gain unsolicited outbound network paths.
//! Scripts against the desktop surface poll (guide §7.4).

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{delete, get};
use axum::{Json, Router};
use hmac::{Hmac, Mac};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tokio::sync::Mutex;

use crate::outbox::DeliverFuture;

/// Outbox topic distinguishing webhook entries from `email_report`.
pub const TOPIC: &str = "webhook";

/// Queue actions that generate webhook events (v1 vocabulary). The
/// event `type` is the action string itself — one contract, no aliasing.
pub const EVENT_ACTIONS: &[&str] = &[
    "complete_sale",
    "void_sale",
    "refund_sale",
    "product.created",
    "stock.adjusted",
    "stock.movement",
];

/// Wildcard subscription: an endpoint whose `events` list contains this
/// entry receives every [`EVENT_ACTIONS`] event.
pub const WILDCARD: &str = "*";

/// True when `action` is part of the webhook event vocabulary.
pub fn is_event_action(action: &str) -> bool {
    EVENT_ACTIONS.contains(&action)
}

// ── Registry types ────────────────────────────────────────────────────

/// A registered webhook endpoint. The signing `secret` is returned only
/// at creation time; listings expose [`WebhookEndpoint::redacted`] views.
#[derive(Debug, Clone, Serialize)]
pub struct WebhookEndpoint {
    pub id: String,
    pub tenant_id: String,
    pub url: String,
    /// Subscribed event actions, or `[WILDCARD]`.
    pub events: Vec<String>,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// One row decoded from `webhook_endpoints` (secret included — internal
/// fan-out use only; never serialize this shape).
#[derive(Debug)]
struct EndpointRow {
    id: String,
    tenant_id: String,
    url: String,
    secret: String,
    events: Vec<String>,
    active: bool,
    created_at: String,
    updated_at: String,
}

impl EndpointRow {
    fn public(&self) -> WebhookEndpoint {
        WebhookEndpoint {
            id: self.id.clone(),
            tenant_id: self.tenant_id.clone(),
            url: self.url.clone(),
            events: self.events.clone(),
            active: self.active,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

/// Validate a webhook target URL: http(s) only, non-empty host, no
/// embedded whitespace, bounded length. (SSRF note: loopback/private
/// targets are allowed — merchants may self-host receivers behind the
/// same host; the admin-key gate is the trust boundary.)
pub fn validate_url(url: &str) -> Result<(), String> {
    if url.len() > 2048 {
        return Err("url too long (max 2048 chars)".into());
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or("url must start with http:// or https://")?;
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .ok_or("url has no host")?;
    if host.is_empty() {
        return Err("url has no host".into());
    }
    if url.chars().any(char::is_whitespace) {
        return Err("url must not contain whitespace".into());
    }
    Ok(())
}

/// Validate an event list: non-empty, each entry `*` or a known action.
pub fn validate_events(events: &[String]) -> Result<(), String> {
    if events.is_empty() {
        return Err("events must not be empty (use [\"*\"] for all)".into());
    }
    for e in events {
        if e != WILDCARD && !is_event_action(e) {
            return Err(format!(
                "unknown event: {e} (vocabulary: {EVENT_ACTIONS:?}, \"*\"))"
            ));
        }
    }
    Ok(())
}

/// Generate a per-endpoint signing secret (32 hex chars from a v4 UUID;
/// 122 CSPRNG bits — HMAC key material, never reused across endpoints).
fn new_secret() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// True when `endpoint` subscribes to `event`.
fn endpoint_matches(endpoint: &EndpointRow, event: &str) -> bool {
    endpoint.active
        && (endpoint.events.iter().any(|e| e == WILDCARD)
            || endpoint.events.iter().any(|e| e == event))
}

// ── Registry CRUD — SQLite ────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn row_to_endpoint(
    id: String,
    tenant_id: String,
    url: String,
    secret: String,
    events_json: String,
    active: i64,
    created_at: String,
    updated_at: String,
) -> EndpointRow {
    let events = serde_json::from_str(&events_json).unwrap_or_else(|_| vec![WILDCARD.to_string()]);
    EndpointRow {
        id,
        tenant_id,
        url,
        secret,
        events,
        active: active != 0,
        created_at,
        updated_at,
    }
}

const ENDPOINT_COLUMNS: &str = "id, tenant_id, url, secret, events, active, created_at, updated_at";

/// Register an endpoint (SQLite backend). Returns the row plus the
/// plaintext secret (shown exactly once).
pub fn create_endpoint_sqlite(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    url: &str,
    events: &[String],
) -> Result<(WebhookEndpoint, String), String> {
    validate_url(url)?;
    validate_events(events)?;
    let id = uuid::Uuid::now_v7().to_string();
    let secret = new_secret();
    let now = chrono::Utc::now().to_rfc3339();
    let events_json = serde_json::to_string(events).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO webhook_endpoints (id, tenant_id, url, secret, events, active, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
        params![id, tenant_id, url, secret, events_json, now],
    )
    .map_err(|e| format!("webhook endpoint insert failed: {e}"))?;
    Ok((
        WebhookEndpoint {
            id,
            tenant_id: tenant_id.to_string(),
            url: url.to_string(),
            events: events.to_vec(),
            active: true,
            created_at: now.clone(),
            updated_at: now,
        },
        secret,
    ))
}

/// List a tenant's endpoints, secrets redacted (SQLite backend).
pub fn list_endpoints_sqlite(
    conn: &rusqlite::Connection,
    tenant_id: &str,
) -> Result<Vec<WebhookEndpoint>, String> {
    let sql = format!(
        "SELECT {ENDPOINT_COLUMNS} FROM webhook_endpoints WHERE tenant_id = ?1 ORDER BY created_at"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("webhook list prepare failed: {e}"))?;
    let rows = stmt
        .query_map(params![tenant_id], |r| {
            Ok(row_to_endpoint(
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
            ))
        })
        .map_err(|e| format!("webhook list query failed: {e}"))?;
    rows.map(|r| r.map_err(|e| e.to_string()).map(|row| row.public()))
        .collect()
}

/// Delete an endpoint by (tenant, id). Returns false when not found.
pub fn delete_endpoint_sqlite(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    id: &str,
) -> Result<bool, String> {
    let n = conn
        .execute(
            "DELETE FROM webhook_endpoints WHERE tenant_id = ?1 AND id = ?2",
            params![tenant_id, id],
        )
        .map_err(|e| format!("webhook delete failed: {e}"))?;
    Ok(n > 0)
}

fn active_endpoints_sqlite(
    conn: &rusqlite::Connection,
    tenant_id: &str,
) -> Result<Vec<EndpointRow>, String> {
    let sql = format!(
        "SELECT {ENDPOINT_COLUMNS} FROM webhook_endpoints WHERE tenant_id = ?1 AND active = 1"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("webhook fanout prepare failed: {e}"))?;
    let rows = stmt
        .query_map(params![tenant_id], |r| {
            Ok(row_to_endpoint(
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
            ))
        })
        .map_err(|e| format!("webhook fanout query failed: {e}"))?;
    rows.map(|r| r.map_err(|e| e.to_string())).collect()
}

// ── Registry CRUD — PostgreSQL ────────────────────────────────────────

/// Register an endpoint (Postgres backend).
pub async fn create_endpoint_pg(
    pool: &deadpool_postgres::Pool,
    tenant_id: &str,
    url: &str,
    events: &[String],
) -> Result<(WebhookEndpoint, String), String> {
    validate_url(url)?;
    validate_events(events)?;
    let id = uuid::Uuid::now_v7().to_string();
    let secret = new_secret();
    let now = chrono::Utc::now().to_rfc3339();
    let events_json = serde_json::to_string(events).map_err(|e| e.to_string())?;
    let client = pool.get().await.map_err(|e| e.to_string())?;
    client
        .execute(
            "INSERT INTO webhook_endpoints (id, tenant_id, url, secret, events, active, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, 1, $6, $6)",
            &[&id, &tenant_id, &url, &secret, &events_json, &now],
        )
        .await
        .map_err(|e| format!("webhook endpoint insert failed: {e}"))?;
    Ok((
        WebhookEndpoint {
            id,
            tenant_id: tenant_id.to_string(),
            url: url.to_string(),
            events: events.to_vec(),
            active: true,
            created_at: now.clone(),
            updated_at: now,
        },
        secret,
    ))
}

/// List a tenant's endpoints (Postgres backend), secrets redacted.
pub async fn list_endpoints_pg(
    pool: &deadpool_postgres::Pool,
    tenant_id: &str,
) -> Result<Vec<WebhookEndpoint>, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {ENDPOINT_COLUMNS} FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at"
    );
    let rows = client
        .query(&sql, &[&tenant_id])
        .await
        .map_err(|e| format!("webhook list query failed: {e}"))?;
    Ok(rows
        .iter()
        .map(|r| {
            row_to_endpoint(
                r.get(0),
                r.get(1),
                r.get(2),
                r.get(3),
                r.get(4),
                r.get::<_, i64>(5),
                r.get(6),
                r.get(7),
            )
            .public()
        })
        .collect())
}

/// Delete an endpoint (Postgres backend). Returns false when not found.
pub async fn delete_endpoint_pg(
    pool: &deadpool_postgres::Pool,
    tenant_id: &str,
    id: &str,
) -> Result<bool, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;
    let n = client
        .execute(
            "DELETE FROM webhook_endpoints WHERE tenant_id = $1 AND id = $2",
            &[&tenant_id, &id],
        )
        .await
        .map_err(|e| format!("webhook delete failed: {e}"))?;
    Ok(n > 0)
}

async fn active_endpoints_pg(
    pool: &deadpool_postgres::Pool,
    tenant_id: &str,
) -> Result<Vec<EndpointRow>, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {ENDPOINT_COLUMNS} FROM webhook_endpoints WHERE tenant_id = $1 AND active = 1"
    );
    let rows = client
        .query(&sql, &[&tenant_id])
        .await
        .map_err(|e| format!("webhook fanout query failed: {e}"))?;
    Ok(rows
        .iter()
        .map(|r| {
            row_to_endpoint(
                r.get(0),
                r.get(1),
                r.get(2),
                r.get(3),
                r.get(4),
                r.get::<_, i64>(5),
                r.get(6),
                r.get(7),
            )
        })
        .collect())
}

// ── Fan-out ───────────────────────────────────────────────────────────

/// One accepted sync-push item, pre-filtered to event actions.
pub struct AcceptedItem<'a> {
    pub item_id: &'a str,
    pub action: &'a str,
    pub payload: &'a str,
    pub created_at: &'a str,
}

/// Enqueue one `webhook` outbox entry per (item, matching endpoint)
/// pair, dispatching on the active data backend.
///
/// Atomicity note (v1): this runs in its own transaction immediately
/// AFTER the push batch committed — a crash in the window between loses
/// the fan-out for that batch (the items themselves are durable and
/// visible via pull). Same-transaction enqueue would require threading
/// the endpoint lookup into `push_batch`'s fast/fallback paths; not
/// worth the coupling until delivery proves loss-sensitive.
///
/// Returns the number of outbox entries enqueued.
pub async fn fanout(
    db: &Arc<Mutex<rusqlite::Connection>>,
    pg: &Option<deadpool_postgres::Pool>,
    tenant_id: &str,
    items: &[AcceptedItem<'_>],
) -> Result<usize, String> {
    if items.is_empty() {
        return Ok(0);
    }
    match pg {
        Some(pool) => {
            let endpoints = active_endpoints_pg(pool, tenant_id).await?;
            fanout_inner(items, &endpoints, |payload| {
                let pool = pool.clone();
                Box::pin(async move {
                    let mut client = pool.get().await.map_err(|e| e.to_string())?;
                    let tx = client.transaction().await.map_err(|e| e.to_string())?;
                    crate::outbox::enqueue_pg(&tx, TOPIC, &payload, 5, 0).await?;
                    tx.commit().await.map_err(|e| e.to_string())?;
                    Ok(())
                })
            })
            .await
        }
        None => {
            let endpoints = {
                let conn = db.lock().await;
                active_endpoints_sqlite(&conn, tenant_id)?
            };
            fanout_inner(items, &endpoints, |payload| {
                let db = db.clone();
                Box::pin(async move {
                    let conn = db.lock().await;
                    crate::outbox::enqueue_sqlite(&conn, TOPIC, &payload, 5, 0)?;
                    Ok(())
                })
            })
            .await
        }
    }
}

/// Backend-agnostic fan-out core: build payloads, call `enqueue` per match.
async fn fanout_inner<F, Fut>(
    items: &[AcceptedItem<'_>],
    endpoints: &[EndpointRow],
    enqueue: F,
) -> Result<usize, String>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let mut count = 0usize;
    for item in items {
        if !is_event_action(item.action) {
            continue;
        }
        // Parse the queue payload as JSON; malformed payloads still fan
        // out with the raw string under `data_raw` so receivers never
        // lose an event to a serialization accident.
        let data: serde_json::Value = serde_json::from_str(item.payload)
            .unwrap_or_else(|_| serde_json::json!({ "data_raw": item.payload }));
        for ep in endpoints {
            if !endpoint_matches(ep, item.action) {
                continue;
            }
            let payload = serde_json::json!({
                "url": ep.url,
                "secret": ep.secret,
                "event": item.action,
                "event_id": uuid::Uuid::now_v7().to_string(),
                "item_id": item.item_id,
                "occurred_at": item.created_at,
                "tenant_id": ep.tenant_id,
                "data": data,
            })
            .to_string();
            enqueue(payload).await?;
            count += 1;
        }
    }
    Ok(count)
}

// ── Delivery ──────────────────────────────────────────────────────────

/// Compute the `X-OZ-Signature` value for a delivery body:
/// `sha256=<hex HMAC-SHA256(key = secret, msg = body)>`.
pub fn signature(secret: &str, body: &[u8]) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length"); // INVARIANT: HMAC keys are any-length
    mac.update(body);
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}

/// Constant-time signature check (receiver-side reference implementation
/// for tests and docs).
#[allow(dead_code)] // exercised by tests; documents what receivers should do
pub fn verify_signature(secret: &str, body: &[u8], header: &str) -> bool {
    let expected = signature(secret, body);
    constant_time_eq(expected.as_bytes(), header.as_bytes())
}

#[allow(dead_code)] // companion of verify_signature
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut acc = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        acc |= x ^ y;
    }
    acc == 0
}

/// Deliver one `webhook` outbox entry (ADR #43 D7 dispatcher arm).
///
/// The payload is self-contained (url/secret/event/data embedded at
/// fan-out time), so delivery needs no registry lookup — endpoint
/// deletion stops NEW events, never in-flight retries.
pub fn deliver_webhook(payload: &str) -> DeliverFuture {
    let payload = payload.to_owned();
    Box::pin(async move {
        let parsed: serde_json::Value =
            serde_json::from_str(&payload).map_err(|e| format!("webhook payload parse: {e}"))?;
        let url = parsed["url"]
            .as_str()
            .ok_or("webhook payload missing url")?;
        let secret = parsed["secret"]
            .as_str()
            .ok_or("webhook payload missing secret")?;
        let event = parsed["event"]
            .as_str()
            .ok_or("webhook payload missing event")?;

        let body = serde_json::json!({
            "id": parsed["event_id"],
            "type": event,
            "occurred_at": parsed["occurred_at"],
            "tenant_id": parsed["tenant_id"],
            "data": parsed["data"],
        })
        .to_string();
        let sig = signature(secret, body.as_bytes());

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| format!("webhook client build: {e}"))?;
        let resp = client
            .post(url)
            .header("Content-Type", "application/json")
            .header("X-OZ-Event", event)
            .header("X-OZ-Event-Id", parsed["event_id"].as_str().unwrap_or(""))
            .header("X-OZ-Signature", sig)
            .body(body)
            .send()
            .await
            .map_err(|e| format!("webhook POST {url} failed: {e}"))?;
        let status = resp.status();
        if status.is_success() || status.is_redirection() {
            Ok(())
        } else {
            Err(format!("webhook {url} responded {status}"))
        }
    })
}

/// Outbox dispatcher for the SQLite drainer: route by topic.
/// (The email arm lives in `email::deliver_outbox_entry`; this wraps it
/// so main.rs can pass a single function pointer.)
pub fn deliver_outbox_entry_sqlite(
    conn: Arc<Mutex<rusqlite::Connection>>,
    topic: &str,
    payload: &str,
) -> DeliverFuture {
    match topic {
        TOPIC => deliver_webhook(payload),
        _ => crate::email::deliver_outbox_entry(conn, topic, payload),
    }
}

/// Outbox dispatcher for the Postgres drainer. `email_report` never
/// enters the outbox on the PG branch (`email_pg` sends synchronously),
/// so only `webhook` is routable here.
pub fn deliver_outbox_entry_pg(
    _pool: deadpool_postgres::Pool,
    topic: &str,
    payload: &str,
) -> DeliverFuture {
    match topic {
        TOPIC => deliver_webhook(payload),
        other => {
            let other = other.to_owned();
            Box::pin(async move { Err(format!("unknown outbox topic: {other}")) })
        }
    }
}

// ── Admin API ─────────────────────────────────────────────────────────

/// Query/body shapes. Tenant defaults to "default" (single-tenant dev;
/// multi-tenant merchants pass it explicitly — the admin key is the
/// global operator credential).
#[derive(Deserialize)]
struct TenantQuery {
    #[serde(default = "default_tenant")]
    tenant_id: String,
}

#[derive(Deserialize)]
struct CreateBody {
    #[serde(default = "default_tenant")]
    tenant_id: String,
    url: String,
    #[serde(default)]
    events: Option<Vec<String>>,
}

fn default_tenant() -> String {
    "default".into()
}

/// State for the admin-key-gated registry routes.
#[derive(Clone)]
pub struct OutboundState {
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub pg: Option<deadpool_postgres::Pool>,
    pub admin_key: Option<String>,
}

/// Build the `/api/webhooks` admin router (GET list, POST create,
/// DELETE by id). Gated by `X-Admin-Key` exactly like the token mint
/// admin path: enforced when configured, open in dev mode.
pub fn outbound_router(state: OutboundState) -> Router {
    Router::new()
        .route("/api/webhooks", get(list_handler).post(create_handler))
        .route("/api/webhooks/{id}", delete(delete_handler))
        .with_state(state)
}

fn unauthorized() -> axum::response::Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({ "error": "admin_key_required" })),
    )
        .into_response()
}

fn admin_ok(headers: &HeaderMap, state: &OutboundState) -> bool {
    kasirmu_api::routes::tokens::admin_key_authorised(headers, state.admin_key.as_deref())
}

async fn list_handler(
    State(state): State<OutboundState>,
    headers: HeaderMap,
    Query(q): Query<TenantQuery>,
) -> axum::response::Response {
    if !admin_ok(&headers, &state) {
        return unauthorized();
    }
    let result = match &state.pg {
        Some(pool) => list_endpoints_pg(pool, &q.tenant_id).await,
        None => {
            let conn = state.db.lock().await;
            list_endpoints_sqlite(&conn, &q.tenant_id)
        }
    };
    match result {
        Ok(endpoints) => (
            StatusCode::OK,
            Json(serde_json::json!({ "endpoints": endpoints })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
    }
}

async fn create_handler(
    State(state): State<OutboundState>,
    headers: HeaderMap,
    Json(body): Json<CreateBody>,
) -> axum::response::Response {
    if !admin_ok(&headers, &state) {
        return unauthorized();
    }
    let events = body.events.unwrap_or_else(|| vec![WILDCARD.to_string()]);
    let result = match &state.pg {
        Some(pool) => create_endpoint_pg(pool, &body.tenant_id, &body.url, &events).await,
        None => {
            let conn = state.db.lock().await;
            create_endpoint_sqlite(&conn, &body.tenant_id, &body.url, &events)
        }
    };
    match result {
        Ok((endpoint, secret)) => (
            StatusCode::CREATED,
            Json(serde_json::json!({
                "endpoint": endpoint,
                "secret": secret,
                "note": "the secret is shown exactly once — store it now",
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
    }
}

async fn delete_handler(
    State(state): State<OutboundState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(q): Query<TenantQuery>,
) -> axum::response::Response {
    if !admin_ok(&headers, &state) {
        return unauthorized();
    }
    let result = match &state.pg {
        Some(pool) => delete_endpoint_pg(pool, &q.tenant_id, &id).await,
        None => {
            let conn = state.db.lock().await;
            delete_endpoint_sqlite(&conn, &q.tenant_id, &id)
        }
    };
    match result {
        // Idempotent delete: 204 whether or not the row existed (a
        // missing endpoint is already in the desired state). The store
        // fns still report found/not-found for callers that care.
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response(),
    }
}

/// Extract (item_id, action, payload, created_at) for accepted items and
/// run [`fanout`], logging (never failing) on error — a webhook fan-out
/// failure must not turn a successful push into a 500.
pub async fn fanout_from_outcomes(
    db: &Arc<Mutex<rusqlite::Connection>>,
    pg: &Option<deadpool_postgres::Pool>,
    tenant_id: &str,
    items: &[kasirmu_core::offline::OfflineQueueItem],
    outcomes: &[platform_sync::transport::PushOutcome],
) {
    let accepted: Vec<AcceptedItem<'_>> = items
        .iter()
        .zip(outcomes.iter())
        .filter(|(_, o)| matches!(o, platform_sync::transport::PushOutcome::Accepted))
        .filter(|(i, _)| is_event_action(&i.action))
        .map(|(i, _)| AcceptedItem {
            item_id: &i.id,
            action: &i.action,
            payload: &i.payload,
            created_at: &i.created_at,
        })
        .collect();
    if accepted.is_empty() {
        return;
    }
    match fanout(db, pg, tenant_id, &accepted).await {
        Ok(n) if n > 0 => {
            tracing::debug!("webhook fan-out: enqueued {n} deliveries for tenant {tenant_id}")
        }
        Ok(_) => {}
        Err(e) => tracing::warn!("webhook fan-out failed for tenant {tenant_id}: {e}"),
    }
}

#[cfg(test)]
#[path = "outbound_webhooks_tests.rs"]
mod tests;
