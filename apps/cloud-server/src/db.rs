/*
last audited 25-07-26 by RSA-Agent (cloud-server slice A: verified; merges prior 19-07-26 stamp)
crate: cloud-server | status: SAFE | lint: CLEAN
findings: clean — sharded token buckets with per-route configs and background cleanup; unwraps carry SAFETY comments on static metric names; panic guards are deliberate pool-type mismatches; sweep found no SQL interpolation. Prior 19-07-26 stamp: 6 unsafe blocks in cfg(test) only (std::env::set_var/remove_var, Rust 2024 edition) with SAFETY comments
next: none | perf: N/A
*/

//! Database abstraction for the cloud server.
//!
//! Supports two backends determined by environment variables:
//!
//! - **SQLite** (default): `OZ_DB_PATH` env var (defaults to `kasir.db`)
//! - **PostgreSQL**: `DATABASE_URL` env var (must start with `postgres://`)
//!
//! # Usage
//!
//! ```no_run
//! let pool = DbPool::from_env().await?;
//! let conn = pool.get().await?;
//! ```

use std::str::FromStr;
use std::sync::Arc;

use crate::config::CloudServerConfig;

use tokio::sync::Mutex;
use tracing::{info, warn};

/// A pooled database connection, either SQLite (behind a Mutex) or
/// PostgreSQL (via deadpool).
///
/// Cluster-wide advisory lock key used to serialize PG_INIT schema apply
/// and cutover role mutations across parallel test processes (and two
/// app instances booting simultaneously). Value = ASCII "OZTESTSQ".
pub(crate) const SCHEMA_LOCK_KEY: i64 = 0x4f5a_5445_5354_5351;

#[derive(Clone, Debug)]
pub enum DbPool {
    /// SQLite connection wrapped in `Arc<Mutex<>>` (compatible with
    /// `CloudServerState` and existing handlers).
    Sqlite(Arc<Mutex<rusqlite::Connection>>),
    /// PostgreSQL connection pool from deadpool-postgres.
    Postgres(deadpool_postgres::Pool),
}

impl DbPool {
    /// Create a new `DbPool` from a [`CloudServerConfig`].
    ///
    /// Resolution order:
    /// 1. If `database_url` starts with `postgres://` or `postgresql://`,
    ///    connect to PostgreSQL.
    /// 2. Otherwise, open SQLite from `db_path`.
    pub async fn from_config(config: &CloudServerConfig) -> Result<Self, DbError> {
        Self::from_config_with_retries(config, 5).await
    }

    /// Like [`from_config`] but with a caller-chosen PG retry budget.
    /// Production uses the default (5) via [`from_config`]; tests asserting a
    /// connection failure on a dead port pass `1` to skip the backoff sleeps.
    pub(crate) async fn from_config_with_retries(
        config: &CloudServerConfig,
        max_attempts: u32,
    ) -> Result<Self, DbError> {
        if let Some(ref url) = config.database_url
            && (url.starts_with("postgres://") || url.starts_with("postgresql://"))
        {
            return Self::connect_postgres_with_retries(
                url,
                config.require_tls,
                config.db_pool_size,
                config.apply_schema,
                max_attempts,
            )
            .await;
        }
        Self::connect_sqlite(&config.db_path)
    }

    /// Create a pool from the environment (used by tests that set env vars).
    /// Production code should go through [`CloudServerConfig`].
    #[cfg(test)]
    pub async fn from_env() -> Result<Self, DbError> {
        Self::from_env_with_retries(5).await
    }

    /// Like [`from_env`] but with a caller-chosen retry budget for the
    /// underlying `connect_postgres`. Tests asserting a connection failure
    /// on a dead port should pass `max_attempts: 1` to avoid 30+ seconds
    /// of backoff sleeps.
    #[cfg(test)]
    pub async fn from_env_with_retries(max_attempts: u32) -> Result<Self, DbError> {
        let config =
            CloudServerConfig::from_env().expect("CloudServerConfig::from_env failed in test");
        Self::from_config_with_retries(&config, max_attempts).await
    }

    /// Detect paths that are obviously non-Linux: a Windows drive-letter
    /// prefix (`C:/…`, `C:\…`), a bare drive letter (`C:…`), or a
    /// backslash separator. On Unix targets the cloud server can never
    /// legitimately use such a path — the usual cause is Git Bash (MSYS)
    /// path conversion mangling a `docker run -e OZ_DB_PATH=…` argument.
    ///
    /// The detector itself is platform-independent so it can be unit-tested
    /// everywhere; only the rejection in [`Self::connect_sqlite`] is Unix-
    /// gated (Windows native dev runs legitimately use Windows paths).
    fn looks_like_windows_path(path: &str) -> bool {
        let bytes = path.as_bytes();
        let drive_letter = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
        drive_letter || path.contains('\\')
    }

    /// Connect to a SQLite database at the given path.
    pub fn connect_sqlite(path: &str) -> Result<Self, DbError> {
        // The cloud server is deployed as a Linux container, so a
        // Windows-style `OZ_DB_PATH` can never be valid there — it is almost
        // always a Git Bash (MSYS) path-conversion artifact from
        // `docker run -e OZ_DB_PATH=/tmp/...` (see
        // docs/operations/docker-deployment.md). Fail fast with an actionable
        // message instead of rusqlite's cryptic `unable to open database
        // file`. No-op on Windows native builds, where Windows paths are
        // legitimate (dev runs and unit tests use them).
        if cfg!(unix) && Self::looks_like_windows_path(path) {
            return Err(DbError::Config(format!(
                "OZ_DB_PATH is set to {path:?}, which looks like a Windows path but the cloud \
                 server runs on Linux. This is usually a Git Bash path-conversion artifact: \
                 prefix the docker run command with `MSYS_NO_PATHCONV=1` or pass a container \
                 path such as /data/kasir.db"
            )));
        }
        let mut conn = rusqlite::Connection::open(path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        oz_core::migrations::run(&mut conn)?;
        info!(db = %path, "SQLite database opened and migrations applied");
        Ok(Self::Sqlite(Arc::new(Mutex::new(conn))))
    }

    /// Create an in-memory SQLite database (for tests).
    pub fn connect_sqlite_in_memory() -> Result<Self, DbError> {
        let mut conn = rusqlite::Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        oz_core::migrations::run(&mut conn)?;
        info!("In-memory SQLite database initialized");
        Ok(Self::Sqlite(Arc::new(Mutex::new(conn))))
    }

    /// Connect to a PostgreSQL database via connection URL.
    ///
    /// When `require_tls` is set, the URL must specify `sslmode=require`;
    /// otherwise startup fails rather than allowing a plaintext fallback.
    /// `pool_size` bounds the deadpool connection pool (max open connections).
    /// `max_attempts` controls the connectivity retry budget (5 for production
    /// to handle PG addon startup; tests asserting a connection failure use 1
    /// to avoid 30+ seconds of backoff sleeps).
    ///
    /// When `apply_schema` is true (the default), the full schema (`PG_INIT`)
    /// is applied at startup. Set it to false (via `OZ_APPLY_SCHEMA=0`) for
    /// the post-cutover deployment shape, where the app runs as the
    /// restricted `oz_app` role that only has DML grants — re-running the DDL
    /// would fail with `permission denied for schema public`. The schema is
    /// then applied once by the migration tool as the table owner.
    ///
    /// This is the production entry point (5-attempt retry budget). The
    /// crate is a binary, so the only callers inside the crate are the test
    /// suite; `connect_postgres_with_retries` exists for tests that assert a
    /// failure without burning the backoff sleeps.
    #[cfg_attr(not(test), allow(dead_code))]
    pub async fn connect_postgres(
        url: &str,
        require_tls: bool,
        pool_size: usize,
        apply_schema: bool,
    ) -> Result<Self, DbError> {
        Self::connect_postgres_with_retries(url, require_tls, pool_size, apply_schema, 5).await
    }

    /// Like [`connect_postgres`] but with a caller-chosen retry budget.
    /// Tests that assert a connection failure should pass `max_attempts: 1`
    /// to avoid the 30+ seconds of backoff sleeps the production retry loop
    /// burns on a dead port.
    pub(crate) async fn connect_postgres_with_retries(
        url: &str,
        require_tls: bool,
        pool_size: usize,
        apply_schema: bool,
        max_attempts: u32,
    ) -> Result<Self, DbError> {
        use deadpool_postgres::{Manager, ManagerConfig, RecyclingMethod};

        let config = tokio_postgres::Config::from_str(url)
            .map_err(|e| DbError::Config(format!("invalid DATABASE_URL: {e}")))?;

        if require_tls && config.get_ssl_mode() != tokio_postgres::config::SslMode::Require {
            return Err(DbError::Config(
                "OZ_DB_REQUIRE_TLS=1 requires DATABASE_URL to set `sslmode=require`; \
                 refusing to connect with a plaintext fallback"
                    .into(),
            ));
        }

        let mgr_config = ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        };
        // TLS via rustls. tokio-postgres honours the connection string's
        // `sslmode` (`disable` | `prefer` | `require`, default `prefer`), so a
        // local plaintext Postgres keeps working while production sets
        // `sslmode=require` for an encrypted connection. Roots come from the
        // platform trust store (ca-certificates in the container image).
        let mut roots = rustls::RootCertStore::empty();
        let native = rustls_native_certs::load_native_certs();
        if !native.errors.is_empty() {
            warn!(
                errors = ?native.errors,
                "some native root certificates failed to load"
            );
        }
        for cert in native.certs {
            roots
                .add(cert)
                .map_err(|e| DbError::Config(format!("failed to add root certificate: {e}")))?;
        }
        let tls_config = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let tls = tokio_postgres_rustls::MakeRustlsConnect::new(tls_config);

        let manager = Manager::from_config(config, tls, mgr_config);

        let pool = deadpool_postgres::Pool::builder(manager)
            .max_size(pool_size)
            // The timeouts need a runtime to sleep on. deadpool's default
            // `rt_tokio_1` feature provides TokioRuntime; binding it here
            // makes the timeout options actually enforceable.
            .runtime(deadpool_postgres::Runtime::Tokio1)
            // Bound the wait for a pool slot: deadpool defaults to an
            // UNBOUNDED wait, so a stalled DB (slow query holding all
            // connections, PG addon hiccup) would hang every request
            // indefinitely — queue buildup, health-check timeout, container
            // restart. Fail fast after 5s instead (the doc's §7.2 "5-20ms
            // typical wait" becomes an upper bound, not a hope).
            .wait_timeout(Some(std::time::Duration::from_secs(5)))
            // Bound connection establishment: a flaky addon must not let a
            // new-connection attempt hang the requesting handler forever.
            .create_timeout(Some(std::time::Duration::from_secs(10)))
            // Bound the recycle (is_closed) check so a wedged pooled
            // connection can't stall checkout. Note: deadpool 0.12 has no
            // max_lifetime/idle_timeout (added in 0.13+); stale connections
            // closed by the PG addon are already caught reactively by
            // RecyclingMethod::Fast's per-checkout is_closed() probe.
            .recycle_timeout(Some(std::time::Duration::from_secs(5)))
            .build()
            .map_err(|e| DbError::Pool(e.to_string()))?;

        // Verify connectivity with retry loop.
        // PostgreSQL addon may take 30-60s to become ready after deploy.
        // Retry with exponential backoff: 2s, 4s, 8s, 16s, 30s (max 5 attempts = ~60s total).
        let mut last_err = String::new();
        let mut connected = false;
        for attempt in 1..=max_attempts {
            let delay_secs = std::cmp::min(2u64.pow(attempt), 30);
            info!(attempt, delay_secs, "attempting PostgreSQL connection");

            match tokio::time::timeout(std::time::Duration::from_secs(10), pool.get()).await {
                Ok(Ok(client)) => {
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(5),
                        client.execute("SELECT 1", &[]),
                    )
                    .await
                    {
                        Ok(Ok(_)) => {
                            info!(attempt, "PostgreSQL connection verified");
                            connected = true;
                            break;
                        }
                        Ok(Err(e)) => {
                            last_err = format!("SELECT 1 failed: {e}");
                            warn!(attempt, %last_err, "connection test failed");
                        }
                        Err(_) => {
                            last_err = "SELECT 1 timed out after 5s".into();
                            warn!(attempt, "connection test timed out");
                        }
                    }
                }
                Ok(Err(e)) => {
                    last_err = format!("pool.get() failed: {e}");
                    warn!(attempt, %last_err, "failed to get connection from pool");
                }
                Err(_) => {
                    last_err = "pool.get() timed out after 10s".into();
                    warn!(attempt, "connection attempt timed out");
                }
            }

            if attempt < max_attempts {
                info!(attempt, delay_secs, "retrying after delay");
                tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;
            }
        }

        if !connected {
            return Err(DbError::Connection(format!(
                "failed to connect to PostgreSQL after {max_attempts} attempts: {last_err}"
            )));
        }

        // Apply the full schema — the Postgres port of the SQLite init
        // migration (93 tables, indexes, triggers, seed rows). `batch_execute`
        // sends the whole script as one simple-query message, which Postgres
        // executes in a single implicit transaction, so the migration is
        // atomic as well as idempotent (`IF NOT EXISTS` / `ON CONFLICT DO
        // NOTHING` / `CREATE OR REPLACE`). Skipped when `apply_schema` is
        // false — the post-cutover restricted role (`oz_app`) only has DML
        // grants, so the DDL re-apply would fail; the migration tool applies
        // the schema once as the owner instead.
        if apply_schema {
            // Get a fresh client for schema migration.
            let migrate_client =
                tokio::time::timeout(std::time::Duration::from_secs(10), pool.get())
                    .await
                    .map_err(|_| {
                        DbError::Migration("failed to get client for migration: timeout".into())
                    })?
                    .map_err(|e| {
                        DbError::Migration(format!("failed to get client for migration: {e}"))
                    })?;

            // Schema migration can take 10-30s on first boot. Timeout at 60s
            // to prevent indefinite hang if the migration script has issues.
            // Serialize the DDL with a cluster-wide advisory lock: under
            // nextest every PG integration test runs in its own process and
            // several apply PG_INIT to the SAME base DB concurrently, which
            // raced catalog DDL (the recurring flake); the same race exists
            // between two app instances booting at once. The lock is
            // session-scoped, so a crashed process releases it automatically.
            migrate_client
                .batch_execute(&format!("SELECT pg_advisory_lock({SCHEMA_LOCK_KEY});"))
                .await
                .map_err(|e| DbError::Migration(format!("failed to take schema lock: {e}")))?;
            let apply = tokio::time::timeout(
                std::time::Duration::from_secs(60),
                migrate_client.batch_execute(oz_core::migrations::PG_INIT),
            )
            .await
            .map_err(|_| DbError::Migration("schema migration timed out after 60s".into()))?
            .map_err(|e| DbError::Migration(e.to_string()));
            let _ = migrate_client
                .batch_execute(&format!("SELECT pg_advisory_unlock({SCHEMA_LOCK_KEY});"))
                .await;
            apply?;
            info!("PostgreSQL database connected and full schema applied");
        } else {
            info!("PostgreSQL database connected (schema application skipped: OZ_APPLY_SCHEMA=0)");
        }
        Ok(Self::Postgres(pool))
    }

    /// Get a raw SQLite connection reference, if this is a SQLite pool.
    /// Panics if called on a PostgreSQL pool.
    pub fn sqlite_conn(&self) -> Arc<Mutex<rusqlite::Connection>> {
        match self {
            Self::Sqlite(conn) => conn.clone(),
            Self::Postgres(_) => {
                panic!("called sqlite_conn() on a PostgreSQL pool")
            }
        }
    }

    /// Get a PostgreSQL client from the pool, if this is a PG pool.
    /// Panics if called on a SQLite pool.
    #[allow(dead_code)]
    pub async fn pg_client(&self) -> Result<deadpool_postgres::Client, DbError> {
        match self {
            Self::Postgres(pool) => pool
                .get()
                .await
                .map_err(|e| DbError::Connection(e.to_string())),
            Self::Sqlite(_) => {
                panic!("called pg_client() on a SQLite pool")
            }
        }
    }

    /// Returns `true` if this is a PostgreSQL pool.
    #[allow(dead_code)]
    pub fn is_postgres(&self) -> bool {
        matches!(self, Self::Postgres(_))
    }

    /// Returns `true` if this is a SQLite pool.
    #[allow(dead_code)]
    pub fn is_sqlite(&self) -> bool {
        matches!(self, Self::Sqlite(_))
    }
}

/// Errors that can occur during database setup.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    /// A SQLite-specific error occurred.
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// An error from the `oz-core` crate.
    #[error("Core error: {0}")]
    Core(#[from] oz_core::error::CoreError),

    /// Invalid or missing configuration.
    #[error("Configuration error: {0}")]
    Config(String),

    /// Failed to create or configure the connection pool.
    #[error("Pool creation error: {0}")]
    Pool(String),

    /// Failed to establish a database connection.
    #[error("Connection error: {0}")]
    Connection(String),

    /// A database migration step failed.
    #[error("Migration error: {0}")]
    Migration(String),
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "db_tests.rs"]
mod tests;
