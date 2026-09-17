/*
last audited DD-MM-YY by DSH-Agent
crate: oz-api | status: SAFE | lint: CLEAN
findings: 0 unsafe blocks. 2 production panic-on-invariant calls in tokens.rs — both "HMAC accepts any key length" with fixed-size key input (documented-invariant, same pattern as oz-crypto). Doc-comment example in lib.rs also uses a panic-on-invariant call in a //! block (not production code). Security headers, CORS fail-closed, production-secret validation (API-1). Clean server scaffold.
next: none | perf: N/A
*/

//! OZ-POS OpenAPI REST server.
//!
//! Starts an axum HTTP server on `OZ_API_PORT` (default 3099) with JWT
//! authentication on protected routes. The server runs alongside the
//! Tauri front-end so third-party scripts, kitchen displays, and
//! inventory scanners can query the POS data.
//!
//! # Quick start
//! ```no_run
//! # use oz_api::serve;
//! // In apps/desktop-client/src/main.rs or a background task:
//! let rt = tokio::runtime::Runtime::new().unwrap();
//! rt.block_on(serve()).expect("API server failed to start");
//! ```
//!
//! Then generate a token:
//!
//! ```bash
//! curl -X POST http://localhost:3099/api/v1/tokens \
//!   -H "Content-Type: application/json" \
//!   -d '{"label": "my-script"}'
//! ```
//!
//! Use the token on protected routes:
//!
//! ```bash
//! curl http://localhost:3099/api/v1/products \
//!   -H "Authorization: Bearer <token>"
//! ```

// The shared OpenAPI document (`spec.rs`) is one deeply-nested `json!`
// literal — same requirement as `apps/cloud-server` (main.rs).
#![recursion_limit = "512"]

/// JWT auth middleware and token generation.
pub mod api_audit;
pub mod auth;
/// Postgres data layer for the REST handlers (Phase 1.2).
pub mod pg;
/// Read-tier presets, READ_KEY_MAP, and read-gate middleware (0047 F2–F3).
pub mod read_tiers;
/// Axum route handlers (health, tokens, products, categories, sales).
pub mod routes;
/// Shared OpenAPI 3.1 document (`x-oz-scope`-tagged) served by the cloud
/// server and the desktop local API.
pub mod spec;

use std::sync::Arc;

use axum::{
    Json, Router,
    http::HeaderValue,
    middleware,
    routing::{get, patch, post, put},
};
use rusqlite::Connection;
use tokio::sync::Mutex;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;

/// Shared application state passed to all axum handlers.
///
/// Wraps the SQLite connection in `Arc<Mutex<>>` so axum can cheaply
/// clone it for the [`State`](axum::extract::State) extractor while
/// ensuring only one handler writes to the database at a time.
#[derive(Clone)]
pub struct AppState {
    /// Shared SQLite connection (mutex-guarded for axum handler safety).
    pub db: Arc<Mutex<Connection>>,

    /// Optional Postgres pool (Phase 1.2). When set, backend-aware REST
    /// handlers read/write Postgres; when `None` (dev, tests, SQLite branch)
    /// they keep using the SQLite connection. Only the cloud server sets it.
    pub pg: Option<deadpool_postgres::Pool>,

    /// Admin key that gates `POST /api/v1/tokens` (ADR sync-auth-hardening
    /// P2). `None` = dev mode, the token endpoint stays open.
    pub admin_key: Option<String>,

    /// JWT signing secret for token generation.
    /// Falls back to a dev default when empty.
    pub api_secret: String,

    /// Whether `POST /api/v1/tokens` accepts the terminal
    /// client-credentials path (`client_id` + `client_secret` against
    /// `sync_terminals`). Cloud: true. The desktop local API sets it
    /// false — device credentials are provisioned for the cloud fleet,
    /// and a secret that ever lands in the served DB (restore, scripted
    /// registration) must not silently become a local-API credential
    /// the operator never minted (review MED-5).
    pub allow_terminal_credentials: bool,

    /// Database path (default: `kasir.db`).
    pub db_path: String,

    /// HTTP listen port (default: `3099`).
    pub port: u16,

    /// CORS allowlist (origins that may call this API). An empty list
    /// denies every cross-origin request (fail closed); `"*"` allows any
    /// origin (explicit dev opt-in). Defaults to the documented allowlist
    /// in `docs/archived/2026-08-15-unify-auth-and-sync.md` §11; overridable via `OZ_CORS_ORIGINS`.
    pub cors_origins: Vec<String>,

    /// Directory where content-addressed product images are stored
    /// (spec 0046b §3.4). Resolved from `OZ_IMAGE_DIR` (default
    /// `/data/images` in prod, `./data/images` in dev). Created on startup.
    pub image_dir: std::path::PathBuf,
}

/// Resolve the image storage directory from `OZ_IMAGE_DIR`.
///
/// Defaults to `/data/images` (the Northflank persistent volume mount in
/// production) and `./data/images` in dev when the env var is unset.
pub fn image_dir_from_env() -> std::path::PathBuf {
    match std::env::var("OZ_IMAGE_DIR") {
        Ok(v) if !v.trim().is_empty() => std::path::PathBuf::from(v),
        _ if std::env::var("OZ_PRODUCTION")
            .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "on" | "ON"))
            .unwrap_or(false) =>
        {
            std::path::PathBuf::from("/data/images")
        }
        _ => std::path::PathBuf::from("./data/images"),
    }
}

/// Default CORS allowlist — the documented origins in
/// `docs/archived/2026-08-15-unify-auth-and-sync.md`
/// §11: the website (global + Indonesia), the website dev server, and the
/// Tauri POS app. The Tauri webview origin differs per platform: `tauri://`
/// on macOS/Linux, `http://tauri.localhost` on Windows (WebView2) — both are
/// listed so the unified cloud server's `/api/health` answers the activation
/// screen's direct webview fetch on every OS.
pub const DEFAULT_CORS_ORIGINS: [&str; 4] = [
    "https://kasir.mu",
    "http://localhost:4321",
    "tauri://localhost",
    "http://tauri.localhost",
];

/// Parse `OZ_CORS_ORIGINS` (comma-separated) into an origin list.
///
/// - unset / absent → the documented [`DEFAULT_CORS_ORIGINS`] allowlist
/// - `"*"` → allow-all (explicit opt-in for local dev with arbitrary ports)
/// - blank → empty list (deny every cross-origin request — fail closed)
/// - otherwise → trimmed, de-duplicated non-empty entries
pub fn parse_cors_origins(env: Option<String>) -> Vec<String> {
    let mut origins: Vec<String> = match env {
        Some(v) if v.trim() == "*" => vec!["*".to_string()],
        Some(v) => v
            .split(',')
            .map(|o| o.trim().to_string())
            .filter(|o| !o.is_empty())
            .collect(),
        None => DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
    };
    // Full dedup preserving first-seen order — `Vec::dedup` only
    // collapses ADJACENT runs, so "a,b,a" used to keep both `a`s
    // despite the doc promising a de-duplicated list.
    let mut seen = std::collections::HashSet::new();
    origins.retain(|o| seen.insert(o.clone()));
    origins
}

/// Build the CORS layer from an origin allowlist.
///
/// `"*"` → any origin (explicit dev opt-in); otherwise only listed origins
/// are echoed back; an empty list denies every cross-origin request.
pub fn build_cors(origins: &[String]) -> CorsLayer {
    let cors = CorsLayer::new().allow_methods(Any).allow_headers(Any);
    if origins.iter().any(|o| o == "*") {
        return cors.allow_origin(Any);
    }
    let values: Vec<HeaderValue> = origins
        .iter()
        .filter_map(|o| o.parse::<HeaderValue>().ok())
        .collect();
    cors.allow_origin(AllowOrigin::list(values))
}

/// Resolve the CORS origins from `OZ_CORS_ORIGINS` (see [`parse_cors_origins`]).
/// Convenience for `serve()` and the cloud server's router.
pub fn cors_origins_from_env() -> Vec<String> {
    parse_cors_origins(std::env::var("OZ_CORS_ORIGINS").ok())
}

/// The `Strict-Transport-Security` value — only in production (browsers
/// ignore HSTS over plain HTTP, but keeping it out of dev avoids surprises
/// with local HTTP servers). Pure so tests need no env mutation.
pub fn security_header_value(production: bool) -> Option<&'static str> {
    production.then_some("max-age=31536000")
}

/// Security headers applied to every response
/// (`docs/archived/2026-08-15-unify-auth-and-sync.md` §11):
/// `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
/// `Content-Security-Policy: default-src 'self'`, and — when
/// `OZ_PRODUCTION=1` — `Strict-Transport-Security: max-age=31536000`.
pub async fn security_headers_middleware(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let mut response = next.run(request).await;
    let production = std::env::var("OZ_PRODUCTION")
        .map(|v| matches!(v.as_str(), "1" | "true" | "on" | "yes"))
        .unwrap_or(false);
    let headers = response.headers_mut();
    headers.insert(
        "X-Content-Type-Options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("X-Frame-Options", HeaderValue::from_static("DENY"));
    headers.insert(
        "Content-Security-Policy",
        HeaderValue::from_static("default-src 'self'"),
    );
    if let Some(v) = security_header_value(production) {
        headers.insert("Strict-Transport-Security", HeaderValue::from_static(v));
    }
    response
}

impl AppState {
    /// Create an AppState suitable for tests with an in-memory database.
    /// Uses sensible defaults for all non-db fields.
    #[cfg(test)]
    pub fn test(conn: rusqlite::Connection) -> Self {
        Self {
            db: Arc::new(Mutex::new(conn)),
            pg: None,
            admin_key: None,
            api_secret: String::new(),
            allow_terminal_credentials: true,
            db_path: ":memory:".into(),
            port: 3099,
            cors_origins: DEFAULT_CORS_ORIGINS.iter().map(|s| s.to_string()).collect(),
            image_dir: std::path::PathBuf::from("./data/images"),
        }
    }
}

/// Build the API router with all routes and middleware.
///
/// Public routes (no auth):
/// - `GET /api/v1/health`
///
/// Token management (gated by `OZ_ADMIN_KEY` when configured — ADR
/// sync-auth-hardening P2; open in dev mode):
/// - `POST /api/v1/tokens`
///
/// Protected routes (JWT required):
/// - `GET /api/v1/products`
/// - `GET /api/v1/products/:sku`
/// - `GET /api/v1/categories`
/// - `POST /api/v1/memos/sync` / `GET /api/v1/memos/active`
pub fn router(state: AppState) -> Router {
    router_with_openapi(state, None, None)
}

/// [`router`] with an optional pre-built OpenAPI document served
/// publicly at `GET /api/openapi.json`, and an optional write-audit
/// sink (desktop local API; see [`api_audit`]).
///
/// The document is a value (not a builder closure) because the desktop
/// local API computes it once at bind time — it needs the actual bound
/// port for `servers[0].url`. Registering it here rather than at the
/// call site keeps the route INSIDE the CORS / security-headers / trace
/// layer scope that wraps every other route (review MED-4: a route
/// appended to the returned `Router<()>` escapes all three).
pub fn router_with_openapi(
    state: AppState,
    openapi_json: Option<serde_json::Value>,
    audit: Option<std::sync::Arc<dyn api_audit::AuditSink>>,
) -> Router {
    let cors = build_cors(&state.cors_origins);
    // Slim middleware state: one Arc clone per protected request instead
    // of a full AppState clone (the original moves into `.with_state`
    // at the end).
    let auth_state = auth::AuthState {
        secret: Arc::new(state.api_secret.clone()),
    };

    let public = Router::new()
        .route("/api/v1/health", get(routes::health::health))
        .route("/api/v1/tokens", post(routes::tokens::create_token_handler))
        .route(
            "/api/v1/terminals",
            post(routes::terminals::register_terminal_handler),
        )
        .route(
            "/api/v1/tenants/{tenant_id}/plan",
            put(routes::plans::set_tenant_plan_handler),
        )
        .route(
            "/api/v1/settings",
            get(routes::settings::get_settings_handler).put(routes::settings::put_settings_handler),
        );
    let public = match openapi_json {
        Some(spec) => public.route(
            "/api/openapi.json",
            get(move || {
                let spec = spec.clone();
                async move { Json(spec) }
            }),
        ),
        None => public,
    };

    let protected = Router::new()
        .route(
            "/api/v1/products",
            get(routes::products::list_products).post(routes::products::create_product),
        )
        .route("/api/v1/products/{sku}", get(routes::products::get_product))
        .route(
            "/api/v1/products/{sku}/stock",
            patch(routes::products::patch_stock),
        )
        .route(
            "/api/v1/categories",
            get(routes::categories::list_categories),
        )
        .route(
            "/api/v1/tax-rates",
            post(routes::tax_rates::create_tax_rate),
        )
        .route(
            "/api/v1/exchange-rates",
            get(routes::exchange_rates::list_rates).post(routes::exchange_rates::create_rate),
        )
        .route(
            "/api/v1/exchange-rates/latest",
            get(routes::exchange_rates::list_latest_rates),
        )
        .route(
            "/api/v1/exchange-rates/latest/{from}/{to}",
            get(routes::exchange_rates::latest_rate),
        )
        .route(
            "/api/v1/exchange-rates/{id}",
            axum::routing::delete(routes::exchange_rates::delete_rate),
        )
        .route(
            "/api/v1/tenants/me/plan",
            get(routes::plans::get_my_plan_handler),
        )
        .route("/api/v1/users", post(routes::users::create_user))
        .route(
            "/api/v1/memos/sync",
            post(routes::memos::sync_memos_handler),
        )
        .route(
            "/api/v1/memos/active",
            get(routes::memos::list_active_memos_handler),
        )
        .route(
            "/api/v1/memos/{memo_id}/ack",
            post(routes::memos::ack_memo_handler),
        )
        .route("/api/v1/sales", post(routes::sales::create_sale))
        .route("/api/v1/sales/{id}", get(routes::sales::get_sale))
        .route(
            "/api/v1/sales/{id}/status",
            patch(routes::sales::update_sale_status),
        )
        .route(
            "/api/v1/images",
            put(routes::images::put_image).post(routes::images::put_image_batch),
        )
        .route("/api/v1/images:pack", get(routes::images::get_image_pack))
        .route(
            "/api/v1/images:missing",
            get(routes::images::get_image_missing),
        )
        .route("/api/v1/images/{hash16}", get(routes::images::get_image))
        // Read-tier gate runs INSIDE auth (auth inserts claims first, then
        // this gates GETs against them) — spec 0047 F3.
        .layer(middleware::from_fn(read_tiers::read_gate_middleware));

    // Write-audit runs INSIDE auth (added before the auth layer, so auth
    // stays outermost and 401s never reach it) and needs the validated
    // claims from request extensions.
    let protected = match audit {
        Some(sink) => protected.layer(middleware::from_fn_with_state(
            sink,
            api_audit::audit_middleware,
        )),
        None => protected,
    };

    let protected = protected.layer(middleware::from_fn_with_state(
        auth_state,
        auth::auth_middleware_with_state,
    ));

    Router::new()
        .merge(public)
        .merge(protected)
        .with_state(state)
        .layer(cors)
        .layer(middleware::from_fn(security_headers_middleware))
        .layer(TraceLayer::new_for_http())
}

/// Validate production-mode secret requirements (API-1 fix).
///
/// Returns `Err` when production mode is enabled but a required secret is
/// missing, so a misconfigured public server refuses to serve instead of
/// falling back to the hard-coded dev signing secret (known-constant JWT
/// forgery) or running an open token mint (no admin key). Mirrors the
/// cloud-server boot gate (`OZ_PRODUCTION=1 requires ...`).
fn validate_production_secrets(
    production: bool,
    api_secret: Option<&str>,
    admin_key: Option<&str>,
) -> Result<(), String> {
    if !production {
        return Ok(());
    }
    if api_secret.is_none_or(|s| s.trim().is_empty()) {
        return Err(
            "OZ_PRODUCTION=1 requires OZ_API_SECRET to be set (no dev-secret fallback)".into(),
        );
    }
    if admin_key.is_none_or(|k| k.trim().is_empty()) {
        return Err("OZ_PRODUCTION=1 requires OZ_ADMIN_KEY to be set (no open token mint)".into());
    }
    Ok(())
}

/// Start the server, binding to the port from `OZ_API_PORT` (default 3099).
///
/// Opens the SQLite database at `OZ_DB_PATH` (default `kasir.db`), runs
/// migrations, and blocks on the server loop. Spawn in a background
/// `tokio::task` if the caller needs to continue.
///
/// RUST-07: startup failures (DB open, migration, bind) are returned as
/// [`Result`] instead of panicking, so the caller can log and exit with a
/// structured error rather than a process-fatal panic.
pub async fn serve() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db_path = std::env::var("OZ_DB_PATH").unwrap_or_else(|_| "kasir.db".into());
    let mut conn = Connection::open(&db_path)
        .map_err(|e| format!("failed to open API database at {db_path}: {e}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("enabling foreign_keys: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("enabling WAL: {e}"))?;
    oz_core::migrations::run(&mut conn).map_err(|e| format!("running migrations: {e}"))?;

    let admin_key = std::env::var("OZ_ADMIN_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty());
    let api_secret_env = std::env::var("OZ_API_SECRET").ok();
    let production = std::env::var("OZ_PRODUCTION")
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "on" | "ON"))
        .unwrap_or(false);
    // API-1 fix: refuse to serve a misconfigured production deployment
    // before any request can hit the dev-secret fallback.
    validate_production_secrets(production, api_secret_env.as_deref(), admin_key.as_deref())
        .map_err(|e| format!("startup rejected: {e}"))?;
    let image_dir = image_dir_from_env();
    // Spec 0046b §3.4: create the image byte-store directory on startup —
    // no entrypoint change needed (the Northflank volume is already mounted).
    std::fs::create_dir_all(&image_dir)
        .map_err(|e| format!("creating image directory {}: {e}", image_dir.display()))?;
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        pg: None,
        admin_key,
        api_secret: api_secret_env.unwrap_or_default(),
        allow_terminal_credentials: true,
        db_path: db_path.clone(),
        port: std::env::var("OZ_API_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3099),
        cors_origins: cors_origins_from_env(),
        image_dir,
    };

    let port = state.port;

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .map_err(|e| format!("failed to bind API port {port}: {e}"))?;
    info!(port, "OZ-POS API server listening");
    axum::serve(listener, router(state))
        .await
        .map_err(|e| format!("API server exited with error: {e}"))?;
    Ok(())
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
