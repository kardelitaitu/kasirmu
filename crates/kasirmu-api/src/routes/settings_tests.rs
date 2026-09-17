use super::*;
use crate::DEFAULT_CORS_ORIGINS;
use crate::router;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower::ServiceExt;

fn state_with(admin_key: Option<&str>) -> AppState {
    AppState {
        db: Arc::new(Mutex::new(kasirmu_core::migrations::fresh_db())),
        pg: None,
        admin_key: admin_key.map(|s| s.to_owned()),
        api_secret: String::new(),
        allow_terminal_credentials: true,
        db_path: ":memory:".into(),
        port: 3099,
        cors_origins: DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
        image_dir: std::path::PathBuf::from("./data/images"),
    }
}

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp
        .into_body()
        .collect()
        .await
        .expect("collect body")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("parse JSON body")
}

fn get_settings(tenant: Option<&str>, admin_key: Option<&str>) -> Request<Body> {
    let uri = match tenant {
        Some(t) => format!("/api/v1/settings?tenant={t}"),
        None => "/api/v1/settings".into(),
    };
    let mut builder = Request::builder().method("GET").uri(uri);
    if let Some(key) = admin_key {
        builder = builder.header("X-Admin-Key", key);
    }
    builder.body(Body::empty()).unwrap()
}

fn put_settings(body: &str, admin_key: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder()
        .method("PUT")
        .uri("/api/v1/settings")
        .header("Content-Type", "application/json");
    if let Some(key) = admin_key {
        builder = builder.header("X-Admin-Key", key);
    }
    builder.body(Body::from(body.to_owned())).unwrap()
}

fn smtp_json() -> String {
    r#"{"host":"smtp.example.com","port":587,"username":"u","password":"secret","from":"r@example.com","use_tls":true}"#.into()
}

fn schedule_json() -> String {
    r#"{"enabled":true,"cadence":"daily","report_types":["daily_revenue"],"recipients":["a@b.c"],"send_at_time":"08:00","timezone":"UTC","lookback_days":7}"#.into()
}

// ── Deserialization semantics ─────────────────────────────────

#[test]
fn field_null_semantics() {
    #[derive(Deserialize)]
    struct S {
        #[serde(default, deserialize_with = "deserialize_field")]
        a: Option<Field<String>>,
    }
    let s: S = serde_json::from_str(r#"{"a":null}"#).unwrap();
    assert!(
        matches!(s.a, Some(Field::Null)),
        "explicit null must be Some(Field::Null), got: {:?}",
        s.a
    );
    let s: S = serde_json::from_str(r#"{}"#).unwrap();
    assert!(s.a.is_none(), "missing field must deserialize as None");
    let s: S = serde_json::from_str(r#"{"a":"x"}"#).unwrap();
    assert!(matches!(s.a, Some(Field::Value(_))));
}

// ── Admin gating ──────────────────────────────────────────────

#[tokio::test]
async fn settings_require_admin_key_when_configured() {
    let app = router(state_with(Some("sekret")));
    let resp = app.clone().oneshot(get_settings(None, None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let resp = app
        .clone()
        .oneshot(get_settings(None, Some("wrong")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let resp = app
        .oneshot(get_settings(None, Some("sekret")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn settings_open_in_dev_mode() {
    let app = router(state_with(None));
    let resp = app.oneshot(get_settings(None, None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

// ── GET default state ─────────────────────────────────────────

#[tokio::test]
async fn get_settings_returns_empty_effective_view() {
    let app = router(state_with(None));
    let resp = app.oneshot(get_settings(None, None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["tenant"], "default");
    assert!(json["store_name"].is_null());
    assert!(json["smtp_config"].is_null());
    assert!(json["report_schedule"].is_null());
    assert!(json["last_report_sent_at"].is_null());
}

#[tokio::test]
async fn get_settings_invalid_tenant_returns_400() {
    let app = router(state_with(None));
    let resp = app
        .oneshot(get_settings(Some("bad%20tenant!"), None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "invalid_tenant");
}

// ── PUT round-trip + scoping ──────────────────────────────────

#[tokio::test]
async fn put_then_get_round_trips_typed_config() {
    let app = router(state_with(None));
    let body = format!(
        r#"{{"smtp_config":{},"report_schedule":{},"store_name":"Cloud Store"}}"#,
        smtp_json(),
        schedule_json()
    );
    let resp = app
        .clone()
        .oneshot(put_settings(&body, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["tenant"], "default");
    assert_eq!(json["store_name"], "Cloud Store");
    assert_eq!(json["smtp_config"]["host"], "smtp.example.com");
    assert_eq!(json["smtp_config"]["password"], "secret");
    assert_eq!(json["report_schedule"]["cadence"], "daily");

    let resp = app.oneshot(get_settings(None, None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["store_name"], "Cloud Store");
    assert_eq!(json["smtp_config"]["host"], "smtp.example.com");
    // Password is decrypted on read, so the round-trip is lossless.
    assert_eq!(json["smtp_config"]["password"], "secret");
    assert_eq!(json["report_schedule"]["cadence"], "daily");
}

#[tokio::test]
async fn password_is_encrypted_at_rest() {
    // Call the handler directly so we can inspect the raw settings row.
    let state = state_with(None);
    let req = PutSettingsRequest {
        tenant: None,
        store_name: None,
        smtp_config: Some(Field::Value(serde_json::from_str(&smtp_json()).unwrap())),
        report_schedule: None,
    };
    let resp = put_settings_handler(State(state.clone()), HeaderMap::new(), Json(req))
        .await
        .into_response();
    assert_eq!(resp.status(), StatusCode::OK);

    let db = state.db.lock().await;
    let raw: String = db
        .query_row(
            "SELECT value FROM settings WHERE key = 'smtp_config:default'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        !raw.contains("secret"),
        "password must be encrypted at rest, got: {raw}"
    );
    let stored: SmtpConfig = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        kasirmu_core::crypto::decrypt_smtp_at_rest(stored.password.as_deref().unwrap()).unwrap(),
        "secret"
    );
}

#[tokio::test]
async fn scoped_keys_are_written_suffix_form() {
    let app = router(state_with(None));
    let body = r#"{"tenant":"tenant-b","store_name":"B Store"}"#;
    let resp = app.clone().oneshot(put_settings(body, None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["tenant"], "tenant-b");
    assert_eq!(json["store_name"], "B Store");

    // tenant-b's override must not leak into default's effective view.
    let resp = app
        .oneshot(get_settings(Some("default"), None))
        .await
        .unwrap();
    let json = body_json(resp).await;
    assert!(json["store_name"].is_null(), "scoped key must not leak");
}

#[tokio::test]
async fn scoped_key_falls_back_to_bare() {
    // The endpoint always writes scoped keys, so the bare-key fallback
    // matters for legacy deployments — seed a bare row directly (as
    // pre-endpoint provisioning would have) and read a tenant with no
    // scoped override.
    let conn = kasirmu_core::migrations::fresh_db();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('store.name', 'Legacy Store')",
        [],
    )
    .unwrap();
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        pg: None,
        admin_key: None,
        api_secret: String::new(),
        allow_terminal_credentials: true,
        db_path: ":memory:".into(),
        port: 3099,
        cors_origins: DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
        image_dir: std::path::PathBuf::from("./data/images"),
    };
    let app = router(state);

    let resp = app
        .oneshot(get_settings(Some("tenant-x"), None))
        .await
        .unwrap();
    let json = body_json(resp).await;
    assert_eq!(
        json["store_name"], "Legacy Store",
        "missing scoped key must fall back to the bare key"
    );
}

#[tokio::test]
async fn null_deletes_scoped_override() {
    let app = router(state_with(None));
    let resp = app
        .clone()
        .oneshot(put_settings(
            r#"{"tenant":"tenant-b","store_name":"B Store"}"#,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // null → delete the scoped override; falls back to bare (absent).
    let resp = app
        .clone()
        .oneshot(put_settings(
            r#"{"tenant":"tenant-b","store_name":null}"#,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert!(
        json["store_name"].is_null(),
        "deleted override must read null"
    );
}

// ── SMTP keep-on-blank merge (the third door) ─────────────────
//
// spec/paths.rs:294 promises "A field that is ABSENT is left untouched".
// That holds per TOP-LEVEL field and did NOT hold per SMTP SUB-field: the
// handler serialized the whole SmtpConfig and wrote it through
// Store::set_setting, and SmtpConfig has no serde defaults while
// `password` is an Option — so a PUT that supplied host/port/from/use_tls
// and omitted password validated clean and persisted password null,
// destroying the secret the live report loop reads back.

/// An SMTP blob carrying exactly the fields the caller supplied. `None`
/// means the key is ABSENT from the JSON, which is what a client that never
/// rendered the field posts — and `SmtpConfig` declares no serde defaults, so
/// absent and `null` both deserialize to `None` on the way in.
fn smtp_blob(host: &str, port: u16, username: Option<&str>, password: Option<&str>) -> String {
    let mut fields = vec![
        format!(r#""host":"{host}""#),
        format!(r#""port":{port}"#),
        r#""from":"r@example.com""#.to_string(),
        r#""use_tls":true"#.to_string(),
    ];
    if let Some(u) = username {
        fields.push(format!(r#""username":"{u}""#));
    }
    if let Some(p) = password {
        fields.push(format!(r#""password":"{p}""#));
    }
    format!("{{{}}}", fields.join(","))
}

async fn put_raw(state: &AppState, body: &str) -> axum::response::Response {
    let req: PutSettingsRequest = serde_json::from_str(body).expect("valid request JSON");
    put_settings_handler(State(state.clone()), HeaderMap::new(), Json(req))
        .await
        .into_response()
}

async fn raw_smtp_row(state: &AppState, key: &str) -> Option<String> {
    let db = state.db.lock().await;
    db.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .ok()
}

fn decrypted_password(raw: &str) -> Option<String> {
    let stored: SmtpConfig = serde_json::from_str(raw).ok()?;
    stored
        .password
        .as_deref()
        .map(kasirmu_core::crypto::decrypt_smtp_at_rest)
        .and_then(Result::ok)
}

#[tokio::test]
async fn put_omitting_smtp_password_preserves_the_stored_secret() {
    let state = state_with(None);
    // Provision a relay WITH a secret.
    let body = format!(r#"{{"smtp_config":{}}}"#, smtp_json());
    let resp = put_raw(&state, &body).await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        decrypted_password(&raw_smtp_row(&state, "smtp_config:default").await.unwrap()),
        Some("secret".into()),
        "the first write must store the secret"
    );

    // Now move the relay, omitting the password entirely.
    let body = format!(
        r#"{{"smtp_config":{},"store_name":"Renamed"}}"#,
        smtp_blob("smtp2.example.com", 465, None, None)
    );
    let resp = put_raw(&state, &body).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    // The fields that WERE supplied still update...
    assert_eq!(json["smtp_config"]["host"], "smtp2.example.com");
    assert_eq!(json["smtp_config"]["port"], 465);
    assert_eq!(json["store_name"], "Renamed");
    // ...and the absent sub-field survives, both in the response and in the row.
    assert_eq!(json["smtp_config"]["password"], "secret");
    let raw = raw_smtp_row(&state, "smtp_config:default").await.unwrap();
    assert_eq!(
        decrypted_password(&raw),
        Some("secret".into()),
        "an absent password must not blank the stored secret; row: {raw}"
    );
    assert!(
        !raw.contains("secret"),
        "the carried-over secret stays encrypted at rest, got: {raw}"
    );
}

#[tokio::test]
async fn put_supplying_smtp_password_still_overwrites_it() {
    // Control: a merge that never wrote would look exactly like a merge that
    // works. A genuinely supplied password must still replace the old one.
    let state = state_with(None);
    put_raw(&state, &format!(r#"{{"smtp_config":{}}}"#, smtp_json())).await;
    let rotated = smtp_blob("smtp.example.com", 587, Some("u"), Some("rotated"));
    let body = format!(r#"{{"smtp_config":{}}}"#, rotated);
    let resp = put_raw(&state, &body).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["smtp_config"]["password"], "rotated");
    let raw = raw_smtp_row(&state, "smtp_config:default").await.unwrap();
    assert_eq!(
        decrypted_password(&raw),
        Some("rotated".into()),
        "a supplied password must replace the stored one; row: {raw}"
    );
}

#[tokio::test]
async fn put_empty_smtp_password_clears_it() {
    // Keep-on-blank is not keep-forever: an explicit empty string is the
    // documented "clear it", distinct from an absent field.
    let state = state_with(None);
    put_raw(&state, &format!(r#"{{"smtp_config":{}}}"#, smtp_json())).await;
    let clearing = smtp_blob("smtp.example.com", 587, Some("u"), Some(""));
    let resp = put_raw(&state, &format!(r#"{{"smtp_config":{}}}"#, clearing)).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let raw = raw_smtp_row(&state, "smtp_config:default").await.unwrap();
    assert_eq!(
        decrypted_password(&raw),
        None,
        "an explicit empty password must clear the stored one; row: {raw}"
    );
}

#[tokio::test]
async fn put_omitting_smtp_username_preserves_the_stored_account_and_secret() {
    // The merge was password-only, and SmtpConfig has TWO optional fields.
    // A relay account is not a secret, but a password with no account
    // authenticates as nobody: the pair is one credential and the card can
    // read neither back, because the whole key is deny-listed.
    let state = state_with(None);
    let provision = format!(
        r#"{{"smtp_config":{}}}"#,
        smtp_blob(
            "smtp.example.com",
            587,
            Some("relay-account"),
            Some("secret")
        )
    );
    put_raw(&state, &provision).await;

    // Move the relay, omitting BOTH optional fields.
    let body = format!(
        r#"{{"smtp_config":{}}}"#,
        smtp_blob("smtp2.example.com", 465, None, None)
    );
    let resp = put_raw(&state, &body).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    // The supplied fields still move — that is the control inside the fix.
    assert_eq!(json["smtp_config"]["host"], "smtp2.example.com");
    assert_eq!(json["smtp_config"]["port"], 465);
    assert_eq!(json["smtp_config"]["use_tls"], true);
    // And both absent fields survive, in the response...
    assert_eq!(json["smtp_config"]["username"], "relay-account");
    assert_eq!(json["smtp_config"]["password"], "secret");
    // ...and in the row the sender reads.
    let raw = raw_smtp_row(&state, "smtp_config:default").await.unwrap();
    let stored: SmtpConfig = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        stored.username.as_deref(),
        Some("relay-account"),
        "an absent username must not blank the stored account; row: {raw}"
    );
    assert_eq!(
        decrypted_password(&raw),
        Some("secret".into()),
        "an absent password must not blank the stored secret; row: {raw}"
    );
}

#[tokio::test]
async fn put_supplying_smtp_username_still_overwrites_it() {
    // Control: a carry-over that never let a supplied value through would pass
    // the test above. A genuinely supplied account still replaces the old one.
    let state = state_with(None);
    let provision = format!(
        r#"{{"smtp_config":{}}}"#,
        smtp_blob("smtp.example.com", 587, Some("old-account"), Some("secret"))
    );
    put_raw(&state, &provision).await;
    let body = format!(
        r#"{{"smtp_config":{}}}"#,
        smtp_blob("smtp.example.com", 587, Some("new-account"), Some("secret"))
    );
    let resp = put_raw(&state, &body).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let json = body_json(resp).await;
    assert_eq!(json["smtp_config"]["username"], "new-account");
    let raw = raw_smtp_row(&state, "smtp_config:default").await.unwrap();
    let stored: SmtpConfig = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        stored.username.as_deref(),
        Some("new-account"),
        "a supplied username must replace the stored one; row: {raw}"
    );
}

#[tokio::test]
async fn put_rejects_smtp_config_the_cloud_sender_cannot_send() {
    // The report loop refuses to send anything that fails SmtpConfig::validate
    // (apps/cloud-server/src/email.rs:50), so every shape below was already
    // unsendable the moment it was stored — the handler accepted it and left
    // the tenant with a config that fails at send time instead of a 400 at
    // the console.
    for (label, blob) in [
        (
            "smtp_host must not be empty",
            r#"{"host":"","port":587,"from":"r@example.com","use_tls":true}"#,
        ),
        (
            "smtp_port must be between 1 and 65535",
            r#"{"host":"smtp.example.com","port":0,"from":"r@example.com","use_tls":true}"#,
        ),
        (
            "smtp_from must not be empty",
            r#"{"host":"smtp.example.com","port":587,"from":"   ","use_tls":true}"#,
        ),
        (
            "smtp_from must be a valid email",
            r#"{"host":"smtp.example.com","port":587,"from":"not-an-email","use_tls":true}"#,
        ),
    ] {
        let state = state_with(None);
        let body = format!(r#"{{"smtp_config":{blob}}}"#);
        let resp = put_raw(&state, &body).await;
        assert_eq!(
            resp.status(),
            StatusCode::BAD_REQUEST,
            "{label} must be rejected, not stored"
        );
        let json = body_json(resp).await;
        assert_eq!(json["error"], "invalid_smtp_config", "{label}");
        assert!(
            raw_smtp_row(&state, "smtp_config:default").await.is_none(),
            "{label} must write nothing at all"
        );
    }
}

// ── Validation ────────────────────────────────────────────────

#[tokio::test]
async fn put_rejects_malformed_smtp_config() {
    let app = router(state_with(None));
    let resp = app
        .oneshot(put_settings(r#"{"smtp_config":{"host":123}}"#, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "invalid_smtp_config");
}

#[tokio::test]
async fn put_rejects_malformed_schedule() {
    let app = router(state_with(None));
    let resp = app
        .oneshot(put_settings(r#"{"report_schedule":{"cadence":42}}"#, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "invalid_report_schedule");
}

#[tokio::test]
async fn put_rejects_empty_store_name() {
    let app = router(state_with(None));
    let resp = app
        .oneshot(put_settings(r#"{"store_name":"   "}"#, None))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "invalid_store_name");
}

#[tokio::test]
async fn put_rejects_invalid_tenant() {
    let app = router(state_with(None));
    let resp = app
        .oneshot(put_settings(
            r#"{"tenant":"bad tenant!","store_name":"X"}"#,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let json = body_json(resp).await;
    assert_eq!(json["error"], "invalid_tenant");
}

// ── Postgres integration ──────────────────────────────────────

/// Build a deadpool pool from `OZ_TEST_PG_URL` (falling back to the
/// local dev container) and apply the schema. `None` when unreachable.
async fn test_pool() -> Option<deadpool_postgres::Pool> {
    use deadpool_postgres::Manager;
    use std::str::FromStr;
    let url = std::env::var("OZ_TEST_PG_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:15432/postgres".into());
    let config = tokio_postgres::Config::from_str(&url).expect("valid postgres URL");
    let manager = Manager::new(config, tokio_postgres::NoTls);
    let pool = deadpool_postgres::Pool::builder(manager)
        .max_size(5)
        .build()
        .expect("pool build");
    match pool.get().await {
        Ok(client) => {
            if let Err(e) = client.batch_execute(kasirmu_core::migrations::PG_INIT).await {
                eprintln!("PG settings integration: schema apply failed: {e:?}");
                return None;
            }
            Some(pool)
        }
        Err(e) => {
            eprintln!("PG settings integration: pool get failed: {e}");
            None
        }
    }
}

/// PG round-trip: PUT writes `{base}:{tenant}` keys that the cloud
/// report loop's scoped reads resolve, per tenant, with the SMTP
/// password encrypted at rest.
#[tokio::test]
async fn pg_integration_settings_provision_per_tenant() {
    let Some(pool) = test_pool().await else {
        eprintln!("PG settings integration test skipped: no Postgres");
        return;
    };
    let ns = format!("pg-settings-test-{}", uuid::Uuid::now_v7());
    // Clean any leftovers from a crashed previous run (namespaced).
    {
        let client = pool.get().await.unwrap();
        client
            .batch_execute(&format!(
                "DELETE FROM settings WHERE key LIKE 'smtp_config:%{ns}%'
                  OR key LIKE 'report_schedule:%{ns}%'
                  OR key LIKE 'store.name:%{ns}%'"
            ))
            .await
            .unwrap();
    }
    let query_pool = pool.clone();
    let state = AppState {
        db: Arc::new(Mutex::new(kasirmu_core::migrations::fresh_db())),
        pg: Some(pool),
        admin_key: Some("sekret".into()),
        api_secret: String::new(),
        allow_terminal_credentials: true,
        db_path: ":memory:".into(),
        port: 3099,
        cors_origins: DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
        image_dir: std::path::PathBuf::from("./data/images"),
    };
    let app = router(state);
    let tenant_b = format!("{ns}-b");

    // Write tenant-b's SMTP + schedule via the admin endpoint.
    let body = format!(
        r#"{{"tenant":"{tenant_b}","store_name":"B Cloud Store","smtp_config":{},"report_schedule":{}}}"#,
        smtp_json(),
        schedule_json()
    );
    let resp = app
        .clone()
        .oneshot(put_settings(&body, Some("sekret")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "PUT must succeed on PG");
    let json = body_json(resp).await;
    assert_eq!(json["tenant"], tenant_b);
    assert_eq!(json["store_name"], "B Cloud Store");
    assert_eq!(json["smtp_config"]["host"], "smtp.example.com");
    assert_eq!(json["smtp_config"]["password"], "secret");

    // The scoped key is stored in suffix form and the password is
    // encrypted at rest.
    let client = query_pool.get().await.unwrap();
    let row = client
        .query_one(
            "SELECT value FROM settings WHERE key = $1",
            &[&format!("smtp_config:{tenant_b}")],
        )
        .await
        .expect("scoped smtp_config row must exist");
    let stored: String = row.get(0);
    assert!(
        !stored.contains("secret"),
        "password must be encrypted at rest, got: {stored}"
    );

    // default's view must not include tenant-b's override. The shared
    // dev DB may legitimately hold a bare `smtp_config` (provisioned for
    // `default`, e.g. by the cloud-server email-loop PG test running in
    // a parallel binary), so assert the actual isolation invariant —
    // tenant-b's values must never surface — rather than bare-key
    // absence (the fallback is supposed to read the bare key).
    let resp = app
        .clone()
        .oneshot(get_settings(Some("default"), Some("sekret")))
        .await
        .unwrap();
    let json = body_json(resp).await;
    assert_ne!(
        json["store_name"], "B Cloud Store",
        "tenant-b's scoped config must not leak into default"
    );
    assert_ne!(
        json["smtp_config"]["host"], "smtp.example.com",
        "tenant-b's scoped config must not leak into default"
    );

    // And tenant-b reads its own effective config back.
    let resp = app
        .oneshot(get_settings(Some(&tenant_b), Some("sekret")))
        .await
        .unwrap();
    let json = body_json(resp).await;
    assert_eq!(json["store_name"], "B Cloud Store");
    assert_eq!(json["smtp_config"]["host"], "smtp.example.com");
}

// ── Shape guard: the scoped key space vs the credential deny list ──────────
//
// This lane is NOT guarded by the credential refusal. `apply_ops_sqlite`
// writes through `Store::set_setting` into the unguarded `Settings::set`
// (`platform/core/src/settings/raw.rs:37`): it never asks
// `cleartext_credential_refusal` and never asks the ingest policy, so nothing
// on the write path consults the deny list. What keeps a credential out of it
// is the SHAPE of the key it can construct — three fixed Rust bases joined by
// a `:` to a tenant id that arrives from an HTTP request and is filtered by
// `validate::valid_tenant` to `[A-Za-z0-9_-]{1,64}`. And
// `crates/kasirmu-local-api/src/lib.rs:319` mounts this SAME router on loopback, so
// a renderer-adjacent surface is standing on that one regex. Widen the tenant
// charset, or give this route a fourth field with a fourth base, and the cases
// below are the thing that notices: a red test, not a third door that writes a
// credential row in cleartext and stays green. They are not duplicated by the
// deny-list tests elsewhere — that list is exact equality on a whole
// normalised key, so it can only ever catch a key this lane is able to SPELL.

use kasirmu_core::settings::keys::{SECRET_KEY_DENY_LIST, is_secret_setting_key, normalised_candidate};

/// The bases this route writes, named by the same constants the handlers use
/// so a rename moves the case instead of rotting it.
const SHAPE_BASES: &[&str] = &[
    STORE_NAME_SETTINGS_KEY,
    SMTP_CONFIG_SETTINGS_KEY,
    REPORT_SCHEDULE_SETTINGS_KEY,
];

/// Tenant ids that all pass `valid_tenant` — including the two deny-listed
/// spellings that the charset happens to admit as bare words, which is the
/// point: they are harmless ONLY because a base and a `:` always sit in front
/// of them.
const SHAPE_TENANTS: &[&str] = &[
    "default",
    "tenant-a",
    "tenant_b",
    "T1",
    "0",
    "smtp_config",
    "sync_api_key",
    "store",
    "name",
    "api_key",
    "tenant-with-a-long-but-still-legal-name-0123456789",
];

/// Sweep the whole key space this lane can build: base × legal tenant.
#[test]
fn scoped_setting_key_cannot_spell_a_deny_listed_credential() {
    let mut offenders: Vec<String> = Vec::new();
    let mut built = 0usize;
    for tenant in SHAPE_TENANTS {
        // A tenant carrying the namespace separator is no longer a tenant: it
        // is half a credential key. Name the member it spells, using the ONE
        // fold in the tree, before anything else — this is the construction the
        // charset is there to make unbuildable.
        if tenant.contains('.') {
            let spelled = if is_secret_setting_key(tenant) {
                format!(" and IS the deny-listed key {tenant}")
            } else {
                String::new()
            };
            offenders.push(format!(
                "fixture {tenant:?} carries the `.` namespace separator{spelled}"
            ));
        }
        if !valid_tenant(tenant) {
            offenders.push(format!(
                "fixture {tenant:?} is refused by valid_tenant, so it is not a key this lane can build"
            ));
        }
        for base in SHAPE_BASES {
            let key = scoped_key(base, tenant);
            built += 1;
            if SECRET_KEY_DENY_LIST.contains(&key.as_str()) {
                offenders.push(format!("{base} + {tenant:?} -> {key} (exact member)"));
            }
            // Folded equality, through keys::normalised_candidate — the same
            // fold is_secret_setting_key applies, reused rather than rewritten.
            let folded = normalised_candidate(&key);
            if SECRET_KEY_DENY_LIST.contains(&folded.as_str()) {
                offenders.push(format!("{base} + {tenant:?} -> {key} folds to {folded}"));
            }
            if is_secret_setting_key(&key) != SECRET_KEY_DENY_LIST.contains(&folded.as_str()) {
                offenders.push(format!("{key}: the shared predicate and the list disagree"));
            }
        }
    }
    assert_eq!(built, SHAPE_BASES.len() * SHAPE_TENANTS.len());
    assert!(
        offenders.is_empty(),
        "the settings route builds keys from a fixed base plus an HTTP tenant segment; these constructions reach the credential deny list: {offenders:?}"
    );
}

/// Every deny-listed credential except a named few is out of the tenant
/// namespace ONLY because the charset rejects `.`.
#[test]
fn tenant_charset_is_what_keeps_dot_namespaced_credentials_unreachable() {
    for member in SECRET_KEY_DENY_LIST {
        if member.contains('.') {
            assert!(
                !valid_tenant(member),
                "{member}: deny-listed credentials are dot-namespaced, and a dot in the tenant namespace is exactly the character that would let an HTTP path segment complete a credential key — this member would become writable through the settings route"
            );
        }
    }
    let mut reachable: Vec<&str> = SECRET_KEY_DENY_LIST
        .iter()
        .copied()
        .filter(|m| valid_tenant(m))
        .collect();
    reachable.sort_unstable();
    assert_eq!(
        reachable,
        vec!["smtp_config", "sync_api_key", "sync_terminal_secret"],
        "the charset admits these deny-listed spellings as a bare tenant segment; the route is safe only because it always joins a base in front of them, so a fourth field that ever writes a tenant UNSCOPED turns one of these into a cleartext credential row. Widen [A-Za-z0-9_-] and this list grows toward the whole deny list"
    );
}

/// The rest of the shape, refused: empty (the bare-key fallback), over the
/// length cap, and anything carrying a separator or a control byte.
#[test]
fn tenant_validator_refuses_empty_overlong_separator_and_control_tenants() {
    for tenant in ["", " ", "\t", "\n", "\u{a0}"] {
        assert!(
            !valid_tenant(tenant),
            "{tenant:?}: an empty or whitespace-only tenant must not resolve to the BARE key — scoped_key_falls_back_to_bare shows readers already treat bare as this tenant's config"
        );
    }
    assert!(valid_tenant(&"t".repeat(64)), "64 is the cap, not 63");
    assert!(
        !valid_tenant(&"t".repeat(65)),
        "a 65-char tenant must be refused; the cap is what bounds the key space the sweep above can enumerate"
    );
    for tenant in [
        "a:b",
        "smtp_config:sync_api_key",
        "a/b",
        "a\\b",
        "a?b",
        "a#b",
        "a%b",
        "a:b@c",
        "a..b",
        "a;b",
        "\0",
        "\u{1}",
    ] {
        assert!(
            !valid_tenant(tenant),
            "{tenant:?}: a separator, control byte or scope colon in a tenant lets the segment carry its own key structure"
        );
    }
}

/// The positive control, so a validator that refused everything could not
/// pass this file: one ordinary tenant is accepted and its keys are ordinary.
#[test]
fn an_ordinary_tenant_is_accepted_and_its_scoped_keys_are_not_refused() {
    let tenant = "tenant-a";
    assert!(valid_tenant(tenant), "the happy path must stay open");
    assert_eq!(
        scoped_key(SMTP_CONFIG_SETTINGS_KEY, tenant),
        "smtp_config:tenant-a",
        "the scope separator is `:` — if it ever becomes `.`, the dotted-tenant assertions above stop describing the only defence this lane has"
    );
    for base in SHAPE_BASES {
        let key = scoped_key(base, tenant);
        assert!(
            !is_secret_setting_key(&key),
            "{key}: an ordinary tenant must be able to save its settings at all"
        );
    }
}
