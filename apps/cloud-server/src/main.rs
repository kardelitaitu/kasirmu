//! OZ-POS Cloud Sync Server — headless binary (no Tauri, no WebView).
//!
//! Serves both the REST API (`oz-api` routes) and sync-push/pull endpoints
//! on the same HTTP port. Run in production behind a reverse proxy.
//!
//! # Usage
//!
//! ```bash
//! OZ_DB_PATH=/data/oz-pos.db OZ_API_PORT=3099 oz-cloud-server
//! ```
//!
//! # Environment variables
//!
//! | Variable | Default | Description |
//! |---|---|---|
//! | `OZ_DB_PATH` | `oz-pos.db` | Path to the SQLite database file |
//! | `OZ_API_PORT` | `3099` | HTTP server listen port |
//! | `OZ_ADMIN_KEY` | — | Admin key gating `POST /api/v1/tokens` (ADR sync-auth-hardening P2). When unset the token endpoint stays open (dev mode); set it in production so only callers with the matching `X-Admin-Key` header can mint tokens. |
//! | `OZ_ENFORCE_PLANS` | — | When `1`/`true`/`on`, sync requests from tenants on the `free` plan (or with no plan row) are rejected with `403 plan_required` (ADR sync-plan-gating). When unset, plan gating is off — dev mode keeps working as before. |
//! | `OZ_REDIRECT_ONLY` | — | Run in redirect-only mode (ADR #11). Requires `OZ_SYNC_REDIRECT_URL`. Skips DB, prune, metrics, API — only serves the migration redirect. |
//! | `OZ_SYNC_REDIRECT_URL` | — | New server URL for migration redirect. When set, all `/api/sync/*` requests return `{"error":"server_migrated","new_url":"<url>"}` with HTTP 421. |
//! | `OZ_WORKER_THREADS` | `2` | Tokio runtime worker threads (0 = logical CPU count). Tune higher for multi-tenant deployments under sustained sync load. |
//! | `RUST_LOG` | `info` | Log level filter (e.g. `debug`, `oz_cloud_server=debug`) |

// serde_json's `json!` recurses once per key/value pair, and the OpenAPI
// spec's `paths` object is one long literal (exchange-rates endpoints,
// 2026-08-31, pushed it past the default 128).
#![recursion_limit = "512"]

mod config;
mod db;
mod email;
mod email_pg;
mod image_gc;
mod metrics;
mod openapi;
mod outbound_webhooks;
mod outbox;
mod prune;
mod rate_limit;
mod redirect;
mod redis_backend;
mod shutdown;
mod sync_api;
mod sync_store;
mod webhooks;

use std::sync::Arc;
use std::time::Instant;

use axum::{Json, Router};
use rusqlite::Connection;
use serde::Serialize;
use tokio::sync::Mutex;
use tower::limit::ConcurrencyLimitLayer;
use tracing::info;

use crate::rate_limit::{RateLimiterState, start_rate_limit_cleanup};
use crate::sync_api::{SyncState, sync_router};

/// Short-TTL cache for the health endpoint's `sync_queue_depth` field.
///
/// The Docker healthcheck probes `/health` every 5 s, and each probe runs
/// `SELECT COUNT(*) FROM offline_queue WHERE status = 'pending'` — an
/// indexed scan that grows with the total queue size.  A 10 s cache means
/// consecutive probes within a burst reuse the same depth without hitting
/// the DB, while the `db_connected` ping stays live (the healthcheck's
/// primary purpose).
#[derive(Clone, Default)]
pub struct HealthDepthCache(Arc<Mutex<Option<(Instant, i64)>>>);

impl HealthDepthCache {
    const TTL: std::time::Duration = std::time::Duration::from_secs(10);

    async fn cached(&self) -> Option<i64> {
        let guard = self.0.lock().await;
        guard
            .as_ref()
            .filter(|(at, _)| at.elapsed() < Self::TTL)
            .map(|(_, count)| *count)
    }

    async fn store(&self, depth: i64) {
        let mut guard = self.0.lock().await;
        *guard = Some((Instant::now(), depth));
    }
}

/// Shared application state for the cloud server.
///
/// Provides the database connection and any additional server-wide state.
#[derive(Clone)]
pub struct CloudServerState {
    /// Database connection wrapped for axum's `State` extractor.
    pub db: Arc<Mutex<Connection>>,
    /// Optional Postgres pool (Phase 1.2). `Some` on the Postgres branch;
    /// the health handler reads the sync queue from it instead of the
    /// (empty, in-memory) SQLite fallback.
    pub pg: Option<deadpool_postgres::Pool>,
    /// Instant captured at startup for uptime calculation.
    pub started_at: Instant,
    /// Short-TTL cache for the health endpoint's sync queue depth, so the
    /// Docker healthcheck's 5s probes don't each run a `COUNT(*)` scan.
    pub health_depth_cache: HealthDepthCache,
    /// P5-3: Stripe webhook signing secret (loaded from `STRIPE_WEBHOOK_SECRET` env var).
    pub stripe_webhook_secret: Option<String>,
    /// P5-3: Square webhook signature key (loaded from `SQUARE_WEBHOOK_SIGNATURE_KEY` env var).
    pub square_webhook_signature_key: Option<String>,
    /// P5-3: Public Square webhook URL (loaded from `SQUARE_WEBHOOK_URL` env var).
    pub square_webhook_url: Option<String>,
}

/// Read the Tokio worker-thread count from `OZ_WORKER_THREADS`.
///
/// Defaults to 2 (the historical value, conservative for a cheap single
/// instance). `0` maps to the machine's logical CPU count
/// (`available_parallelism`). Unparseable values fall back to 2 with a
/// warning so a bad env var can never crash startup.
fn worker_threads_from_env() -> usize {
    parse_worker_threads(std::env::var("OZ_WORKER_THREADS"))
}

/// Pure parsing half of [`worker_threads_from_env`], split out so tests can
/// exercise the env semantics without mutating process env vars.
fn parse_worker_threads(raw: Result<String, std::env::VarError>) -> usize {
    match raw {
        Ok(v) => match v.trim().parse::<usize>() {
            Ok(0) => std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(2),
            Ok(n) => n,
            Err(_) => {
                tracing::warn!(
                    value = %v,
                    "OZ_WORKER_THREADS is not a valid usize — falling back to 2"
                );
                2
            }
        },
        Err(_) => 2,
    }
}

/// Connect the optional Redis backend (ADR #43 D4).
///
/// Returns `Some(backend)` when `OZ_REDIS_URL` is set and reachable, and
/// `None` when the URL is unset, the connection was refused, or the URL is
/// malformed — in every `None` case the server keeps working with the
/// in-process snapshot cache and rate limiter (single-instance shape).
async fn connect_redis(url: Option<&str>) -> Option<crate::redis_backend::RedisBackend> {
    match url {
        Some(url) => match crate::redis_backend::RedisBackend::connect(url).await {
            Ok(Some(backend)) => Some(backend),
            Ok(None) => None, // unreachable — fallback logged by connect()
            Err(e) => {
                tracing::warn!(error = %e, "Redis disabled — falling back to in-process");
                None
            }
        },
        None => None,
    }
}

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let worker_threads = worker_threads_from_env();
    tracing::info!(worker_threads, "starting tokio multi-thread runtime");
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(worker_threads)
        .enable_all()
        .build()?;
    runtime.block_on(async_main())
}

async fn async_main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // ── tokio-console (RUSTFLAGS="--cfg tokio_unstable" + feature "console") ─
    // console-subscriber panics if tokio was not built with `tokio_unstable`,
    // so the init is gated on BOTH the feature and the cfg — `--all-features`
    // without RUSTFLAGS must not crash startup.
    #[cfg(all(feature = "console", tokio_unstable))]
    {
        console_subscriber::init();
        tracing::info!("tokio-console subscriber initialised");
    }
    #[cfg(not(all(feature = "console", tokio_unstable)))]
    {
        tracing::debug!(
            "tokio-console disabled — compile with `--features console` + RUSTFLAGS=\"--cfg tokio_unstable\" to enable"
        );
    }

    // ── Configuration ────────────────────────────────────────────────
    let config =
        config::CloudServerConfig::from_env().map_err(|e| format!("invalid configuration: {e}"))?;

    // ── Logging ──────────────────────────────────────────────────────
    match config.log_format {
        config::LogFormat::Json => {
            oz_logging::try_init_json().map_err(|e| format!("logging init_json failed: {e}"))?;
        }
        config::LogFormat::Plain => {
            oz_logging::try_init().map_err(|e| format!("logging init failed: {e}"))?;
        }
    }

    // One line, presence only: which portable key derivation this process
    // picked. Emitted at boot because a re-keyed deployment is silent by
    // default, and the value itself is never read or logged here.
    if oz_core::crypto::master_key_derivation_active() {
        tracing::warn!(
            "portable credential derivation: master-key path ACTIVE (see portable_derivation_uses_master_key on /health)"
        );
    }

    // ── Config validation (--validate-config skips the server) ───────
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--validate-config") {
        info!("running config validation only (--validate-config)");
        match oz_core::config_validator::validate_config() {
            Ok(()) => {
                info!("all configuration checks passed");
                std::process::exit(0);
            }
            Err(errors) => {
                for err in &errors {
                    tracing::error!(%err, "configuration error");
                }
                eprintln!(
                    "Configuration validation failed with {} error(s):",
                    errors.len()
                );
                for err in &errors {
                    eprintln!("  • {err}");
                }
                std::process::exit(1);
            }
        }
    }

    // ── Startup config validation ───────────────────────────────────
    // Check critical env vars before the server starts. Failures are
    // logged as warnings (non-blocking) because the server may still
    // function with SQLite defaults if DATABASE_URL is misconfigured.
    if let Err(errors) = oz_core::config_validator::validate_config() {
        for err in &errors {
            tracing::warn!(%err, "configuration warning");
        }
    }

    // ── Redirect-only mode (ADR #11) ──────────────────────────────────
    // When OZ_REDIRECT_ONLY is set, skip all infrastructure (DB, prune,
    // metrics, API) and run a minimal server that only returns the
    // migration redirect. This keeps the old VPS cheap during the
    // 15-30 day migration window.
    if config.redirect_only {
        info!("running in redirect-only mode (ADR #11)");
        let redirect_url = config
            .sync_redirect_url
            .clone()
            // SAFETY: redirect_only mode validates sync_redirect_url at
            // construction, so the URL is always present here — SAFETY.
            .expect("validated at construction");
        let redirect_router = Router::new()
            .fallback(|| async { axum::http::StatusCode::MISDIRECTED_REQUEST })
            .layer(axum::middleware::from_fn_with_state(
                Some(redirect_url),
                redirect::redirect_middleware,
            ));
        serve(redirect_router, config).await?;
        return Ok(());
    }

    // ── Database ─────────────────────────────────────────────────────
    // Supports both SQLite (OZ_DB_PATH) and PostgreSQL (DATABASE_URL).
    // SQLite is the default backend.
    info!("starting database connection (this may take up to 60s on first boot)...");
    let pool = db::DbPool::from_config(&config)
        .await
        .map_err(|e| format!("failed to initialise database: {e}"))?;
    info!("database connection established");

    match &pool {
        db::DbPool::Sqlite(conn) => {
            info!("running with SQLite backend");
            let state = CloudServerState {
                db: conn.clone(),
                pg: None,
                started_at: Instant::now(),
                health_depth_cache: HealthDepthCache::default(),
                stripe_webhook_secret: config.stripe_webhook_secret.clone(),
                square_webhook_signature_key: config.square_webhook_signature_key.clone(),
                square_webhook_url: config.square_webhook_url.clone(),
            };
            // Start the background prune loop (ADR #6 Q4 / P-1 Ledger Retention).
            prune::start_prune_loop(conn.clone());

            // Start the background image GC loop (spec 0046b §3.4/§3.7) —
            // sweeps orphaned `image_refs` (refcount = 0, 24h grace) and
            // deletes the corresponding files from the image volume.
            image_gc::start_image_gc_loop(conn.clone(), oz_api::image_dir_from_env());

            // P55-3: Start the scheduled report sender loop.
            email::start_report_sender_loop(conn.clone());

            // ADR #43 D7: outbox drainer for async email/webhook delivery.
            // The report sender now enqueues into the outbox; this task
            // drains pending entries and sends with retry/backoff.
            // Outbound webhooks (2026-09-03) share the same pipeline via
            // the `webhook` topic — dispatch routes by topic.
            outbox::start_drainer_sqlite(
                conn.clone(),
                &crate::outbound_webhooks::deliver_outbox_entry_sqlite,
            );

            // P8-1: Per-tenant rate limiter state + background cleanup.
            // ADR #43 D4: prefer the shared Redis token bucket when a
            // backend is configured; the in-process shards remain the
            // fallback.
            let rate_limiter = match connect_redis(config.redis_url.as_deref()).await {
                Some(redis) => RateLimiterState::with_redis(redis),
                None => RateLimiterState::new(),
            };
            start_rate_limit_cleanup(rate_limiter.clone());

            let app = build_router(state, rate_limiter, &config, None);
            serve(app, config).await?;
        }
        db::DbPool::Postgres(pg_pool) => {
            info!("running with PostgreSQL backend");
            // The oz-api REST handlers dispatch on `state.pg` (Some →
            // Postgres data layer, None → the SQLite `Store` path), so the
            // API layer reads/writes Postgres here. The in-memory SQLite is
            // only a never-touched fallback for handlers that were never
            // ported (health is PG-aware) — production data never lands in
            // it.
            let conn = db::DbPool::connect_sqlite_in_memory()
                .map_err(|e| format!("failed to create in-memory SQLite for API: {e}"))?;
            let state = CloudServerState {
                db: conn.sqlite_conn(),
                pg: Some(pg_pool.clone()),
                started_at: Instant::now(),
                health_depth_cache: HealthDepthCache::default(),
                stripe_webhook_secret: config.stripe_webhook_secret.clone(),
                square_webhook_signature_key: config.square_webhook_signature_key.clone(),
                square_webhook_url: config.square_webhook_url.clone(),
            };

            // P8-1: Per-tenant rate limiter state + background cleanup.
            let rate_limiter = match connect_redis(config.redis_url.as_deref()).await {
                Some(redis) => RateLimiterState::with_redis(redis),
                None => RateLimiterState::new(),
            };
            start_rate_limit_cleanup(rate_limiter.clone());

            // Phase 1.5: P-1 offline-queue retention on Postgres (the SQLite
            // prune loop does not run on this branch).
            prune::start_prune_loop_pg(pg_pool.clone());

            // Phase 1.5: scheduled report sender on Postgres (the SQLite
            // loop reads the same settings/analytics surface via rusqlite).
            email_pg::start_report_sender_loop_pg(pg_pool.clone());

            // Outbound webhooks: the PG outbox drainer (previously built
            // but unwired — email never uses the outbox on this branch).
            outbox::start_drainer_pg(
                pg_pool.clone(),
                &crate::outbound_webhooks::deliver_outbox_entry_pg,
            );

            let app = build_router(state, rate_limiter, &config, Some(pg_pool.clone()));
            serve(app, config).await?;
        }
    }
    Ok(())
}

/// Start the HTTP server on the configured port with graceful shutdown.
///
/// Listens for SIGTERM (Docker/K8s) or Ctrl+C. On receiving the signal:
/// 1. Stops accepting new connections
/// 2. Drains in-flight connections with a 30-second timeout
/// 3. Logs the shutdown and exits cleanly
async fn serve(
    app: Router,
    config: config::CloudServerConfig,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let port = config.port;

    // RUST-07: a port bind failure (e.g. port already in use) is a recoverable
    // operational error and now propagates to main instead of panicking.
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .map_err(|e| format!("failed to bind port {port}: {e}"))?;
    info!(port, "OZ-POS cloud server listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown::shutdown_signal())
        .await
        .map_err(|e| format!("server exited with error: {e}"))?;

    // Drain in-flight connections with a grace period.
    // After the shutdown signal, axum stops accepting new connections
    // and waits for existing requests to complete. This additional
    // sleep gives any last-second requests time to finish before the
    // process exits and background tasks are dropped.
    const DRAIN_TIMEOUT_SECS: u64 = 30;
    info!(
        drain_timeout_secs = DRAIN_TIMEOUT_SECS,
        "server stopped accepting connections, draining in-flight requests"
    );
    tokio::time::sleep(std::time::Duration::from_secs(DRAIN_TIMEOUT_SECS)).await;
    info!("graceful shutdown complete");
    Ok(())
}

/// Build the combined router: REST API + sync endpoints.
/// Response from the health endpoint (P8-3: enhanced with DB ping and queue depth).
#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    db: String,
    uptime_seconds: u64,
    /// Whether the database is reachable (actual ping, not static).
    db_connected: bool,
    /// Database ping latency in microseconds.
    db_latency_us: u64,
    /// Number of items in the sync queue with status `pending`.
    sync_queue_depth: i64,
    /// ISO-8601 timestamp of the most recent sync activity, or null.
    last_sync_at: Option<String>,
    /// Which portable key derivation THIS process selected: true when the
    /// at-rest credential families derive through the master key, false when
    /// they derive through the legacy static path.
    ///
    /// A selection report only. It carries no value, no length and no digest
    /// of anything, and it is not a security assertion in either direction.
    /// Note what false does and does not mean: this process is not using a
    /// master key, which is NOT the claim that no such variable was set - a
    /// malformed value selects legacy for exactly the reason the derivation
    /// falls back.
    ///
    /// Publishable because the operator already controls the setting: knowing
    /// which path a running service chose discloses nothing they do not know,
    /// while its absence is what leaves them unable to explain why five
    /// credential families stopped decrypting.
    portable_derivation_uses_master_key: bool,
}

/// `GET /metrics` — Prometheus metrics endpoint.
/// Public, no auth required (same as /health).
async fn metrics_handler() -> String {
    crate::metrics::render_metrics_cached()
}

/// `GET /health` — public health check, no auth required.
///
/// Performs an actual DB ping, reports sync queue depth, last sync
/// timestamp, and uptime. Used by the Tauri app's ConnectionStatus
/// component and by Docker healthchecks.
///
/// All DB queries are performed in a single lock acquisition to
/// minimise contention with concurrent sync handlers (P8-3).
async fn health_handler(
    axum::extract::State(state): axum::extract::State<CloudServerState>,
) -> Json<HealthResponse> {
    let uptime = state.started_at.elapsed().as_secs();

    // P8-3: all DB queries in a single lock acquisition. On the Postgres
    // branch the queue depth / last-sync are read from the real database
    // (the in-memory SQLite fallback is empty by design).
    let (db_connected, db_latency_us, sync_queue_depth, last_sync_at, db_kind) = if let Some(pool) =
        &state.pg
    {
        let db_start = std::time::Instant::now();
        // The health endpoint must fail fast under pool saturation:
        // the Docker healthcheck has its own --timeout=5s, so waiting
        // the full 5s builder wait_timeout here would let the
        // container be marked unhealthy during a burst. Bound the
        // health-path wait to 2s — a degraded "db_connected: false"
        // response is better than a container restart.
        let (connected, last) =
            match tokio::time::timeout(std::time::Duration::from_secs(2), pool.get()).await {
                Ok(Ok(client)) => {
                    let last = client
                        .query_one(
                            "SELECT MAX(synced_at) FROM offline_queue \
                             WHERE synced_at IS NOT NULL",
                            &[],
                        )
                        .await
                        .map(|r| r.get::<_, Option<String>>(0))
                        .unwrap_or(None);
                    (true, last)
                }
                // Timeout (2s guard) OR deadpool error → degraded health.
                Ok(Err(_)) => (false, None),
                Err(_) => (false, None),
            };
        let latency = db_start.elapsed().as_micros() as u64;

        // The queue-depth COUNT (indexed scan) is served from a 10s
        // cache — the healthcheck probes every 5s, so consecutive
        // probes reuse the same depth instead of re-scanning the
        // queue. The live DB ping above is what the healthcheck
        // actually needs; depth is informational.
        let depth = match state.health_depth_cache.cached().await {
            Some(d) => d,
            None => {
                let fresh = if connected {
                    match tokio::time::timeout(std::time::Duration::from_secs(2), pool.get()).await
                    {
                        Ok(Ok(client)) => client
                            .query_one(
                                "SELECT COUNT(*) FROM offline_queue WHERE status = 'pending'",
                                &[],
                            )
                            .await
                            .map(|r| r.get::<_, i64>(0))
                            .unwrap_or(0),
                        _ => 0,
                    }
                } else {
                    0
                };
                state.health_depth_cache.store(fresh).await;
                fresh
            }
        };

        (connected, latency, depth, last, "postgres")
    } else {
        let db_start = std::time::Instant::now();
        let conn = state.db.lock().await;

        let ping_result = conn.query_row("SELECT 1", [], |_| Ok(()));
        let latency = db_start.elapsed().as_micros() as u64;
        let connected = ping_result.is_ok();

        // Same 10s depth cache on the SQLite branch.
        let depth = match state.health_depth_cache.cached().await {
            Some(d) => d,
            None => {
                let fresh = conn
                    .query_row(
                        "SELECT COUNT(*) FROM offline_queue WHERE status = 'pending'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap_or(0);
                state.health_depth_cache.store(fresh).await;
                fresh
            }
        };

        let last = conn
            .query_row(
                "SELECT MAX(synced_at) FROM offline_queue WHERE synced_at IS NOT NULL",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap_or(None);

        (connected, latency, depth, last, "sqlite")
    };

    // P8-3: record health check Prometheus metrics.
    crate::metrics::HEALTH_CHECKS_TOTAL.inc();
    if !db_connected {
        crate::metrics::HEALTH_CHECK_FAILURES_TOTAL.inc();
    }
    crate::metrics::HEALTH_DB_LATENCY_MICROS.observe(db_latency_us as f64);

    Json(HealthResponse {
        status: if db_connected { "ok" } else { "degraded" },
        version: env!("CARGO_PKG_VERSION"),
        db: db_kind.into(),
        uptime_seconds: uptime,
        db_connected,
        db_latency_us,
        sync_queue_depth,
        last_sync_at,
        // Read per request, never cached: the answer describes the process
        // that is answering, and it costs one env read plus one hex decode.
        portable_derivation_uses_master_key: oz_core::crypto::master_key_derivation_active(),
    })
}

/// Build the combined router: REST API + sync endpoints + rate limiting.
///
/// `pg` is the optional Postgres pool for the sync data layer (Phase 1.2).
/// When set, push/pull/status/snapshot/plan read and write Postgres; when
/// `None`, the sync function keeps using the shared SQLite connection.
/// Request correlation ID middleware.
///
/// Reads incoming `x-request-id` header or generates a new UUID v7 if missing.
/// Attaches the ID to request headers and injects it into response headers
/// for end-to-end request traceability across POS client and server logs.
pub async fn request_id_middleware(
    mut request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let req_id = request
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());

    if let Ok(val) = axum::http::HeaderValue::from_str(&req_id) {
        request.headers_mut().insert("x-request-id", val.clone());
    }

    let mut response = next.run(request).await;
    if let Ok(val) = axum::http::HeaderValue::from_str(&req_id) {
        response.headers_mut().insert("x-request-id", val);
    }
    response
}

/// Build the combined router: REST API + sync endpoints + rate limiting + correlation ID middleware.
///
/// `pg` is the optional Postgres pool for the sync data layer (Phase 1.2).
/// When set, push/pull/status/snapshot/plan read and write Postgres; when
/// `None`, the sync function keeps using the shared SQLite connection.
pub fn build_router(
    state: CloudServerState,
    rate_limiter: RateLimiterState,
    config: &config::CloudServerConfig,
    pg: Option<deadpool_postgres::Pool>,
) -> Router {
    // CORS allowlist shared with the oz-api router
    // (docs/archived/2026-08-15-unify-auth-and-sync.md
    // §11): documented defaults, overridable via OZ_CORS_ORIGINS.
    let cors_origins = oz_api::cors_origins_from_env();
    let cors = oz_api::build_cors(&cors_origins);

    // Build the oz-api router (products, categories, sales, health, tokens).
    let api_state = oz_api::AppState {
        db: state.db.clone(),
        // Phase 1.2: the REST handlers read/write Postgres on the cloud
        // branch instead of the in-memory SQLite fallback.
        pg: pg.clone(),
        // ADR sync-auth-hardening P2: gate token minting with the admin key
        // when configured; open in dev mode when unset.
        admin_key: config.admin_key.clone(),
        api_secret: config.api_secret.clone().unwrap_or_default(),
        allow_terminal_credentials: true,
        db_path: config.db_path.clone(),
        port: config.port,
        cors_origins: cors_origins.clone(),
        // Spec 0046b §3.4: content-addressed image store on the Northflank
        // volume (default `/data/images` in prod, `./data/images` in dev).
        image_dir: oz_api::image_dir_from_env(),
    };
    let api_router = oz_api::router(api_state);

    // P8-3: Rate-limit token minting per client IP. This needs its own clone
    // of the limiter because /api/v1/tokens runs BEFORE auth (it mints the
    // JWT), so the per-tenant limiter has no claims to key on.
    let token_rate_limiter = rate_limiter.clone();

    // Clone state for the health endpoint BEFORE SyncState::from consumes the original.
    let health_state = state.clone();

    // Build the sync router (push/pull endpoints) from sync_api module.
    // P8-1: Share the same RateLimiterState with the cleanup task.
    let mut sync_state = SyncState::from_with_rate_limiter(state.clone(), rate_limiter);
    sync_state.pg = pg;
    let sync_router = sync_router(sync_state, config.enforce_plans);

    // Build the webhook router (unauthenticated — HMAC signature verification).
    let webhook_router = webhooks::webhooks_router(state.clone());

    // Outbound webhook endpoint registry (admin-key gated). Built from a
    // clone BEFORE SyncState::from consumes the state.
    let outbound_router = outbound_webhooks::outbound_router(outbound_webhooks::OutboundState {
        db: state.db.clone(),
        pg: state.pg.clone(),
        admin_key: config.admin_key.clone(),
    });

    // P-2: Per-route-group concurrency limits prevent sync bursts
    // from starving the product/sales/health API routes.
    // API: 10 concurrent, sync: 40 concurrent.
    let api_router = api_router
        .layer(ConcurrencyLimitLayer::new(10))
        .layer(axum::middleware::from_fn(
            crate::rate_limit::token_rate_limit_middleware,
        ))
        .layer(axum::Extension(token_rate_limiter));
    let sync_router = sync_router.layer(ConcurrencyLimitLayer::new(40));

    // OpenAPI documentation routes — Swagger UI + Scalar + raw OpenAPI JSON.
    let docs_router = Router::new()
        .route(
            "/api/openapi.json",
            axum::routing::get(openapi::openapi_json_handler),
        )
        .route("/api/docs", axum::routing::get(openapi::swagger_ui_handler))
        .route(
            "/api/docs/scalar",
            axum::routing::get(openapi::scalar_ui_handler),
        );

    Router::new()
        .route("/health", axum::routing::get(health_handler))
        .route("/api/health", axum::routing::get(health_handler))
        .route("/metrics", axum::routing::get(metrics_handler))
        .with_state(health_state)
        .merge(docs_router)
        .merge(api_router)
        .merge(sync_router)
        .merge(webhook_router)
        .merge(outbound_router)
        .layer(axum::middleware::from_fn_with_state(
            config.sync_redirect_url.clone(),
            redirect::redirect_middleware,
        ))
        // NOTE: gzip compression is handled by Caddy (Caddyfile:104).
        // The Rust CompressionLayer was removed to save ~0.01 core CPU.
        .layer(cors)
        .layer(axum::middleware::from_fn(
            oz_api::security_headers_middleware,
        ))
        .layer(axum::middleware::from_fn(request_id_middleware))
} // ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "main_tests.rs"]
mod tests;
