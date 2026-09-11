//! Headless `#[cfg(test)]` harness for building a `BridgeCtx` in tests.
//!
//! Relocated command tests (mounted with `#[cfg(test)] #[path]` inside the
//! bridge modules) construct a context over a fresh migrated database here
//! instead of booting a Tauri `AppState`. The construction recipe mirrors
//! `AppState::for_test` (`apps/desktop-client/src/state.rs`) — every
//! `BridgeCtx` field is constructible without tauri, gtk or a driver
//! registry — and `temp_conn` delegates to the repo's canonical
//! migrated-test-conn helper `oz_core::migrations::fresh_db` (snapshot
//! clone; one `schema_migrations` row per migration).
//!
//! The harness deliberately uses in-memory databases: `tempfile` is not a
//! dependency of this crate and this file's fence forbids manifest edits,
//! so a file-backed temp database cannot be built here. In-memory test
//! connections are the established pattern (`AppState::for_test` and every
//! `oz-core` test module use them).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use oz_core::cache::Cache;
use oz_core::migrations;
use oz_core::session::SessionContext;
use oz_hal::DriverRegistry;
use oz_plugin::PluginManager;
use platform_core::StoreDatabaseManager;
use platform_kernel::Kernel;
use rusqlite::Connection;
use tokio::sync::{Mutex, oneshot};

use crate::ctx::{BridgeCtx, EventSink};

/// Session TTL the harness stamps into contexts: the same 24-hour default
/// `AppState::for_test` uses (production reads `session.ttl_seconds`).
pub const TEST_SESSION_TTL_SECONDS: i64 = 86400;

/// Instance counter disambiguating store directories within one test process.
static NEXT_BRIDGE_ID: AtomicU64 = AtomicU64::new(0);

/// Unique directory under the OS temp dir for `store-<id>.sqlite` files.
///
/// One directory per `TestBridge` keeps parallel test instances from
/// colliding on the same `store-<id>.sqlite` file (the manager creates the
/// directory lazily on first `open_store`). Leftover directories are left
/// for the OS temp cleaner, exactly like `AppState::for_test`'s store files.
fn unique_store_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "oz-bridge-test-{}-{}-{}",
        std::process::id(),
        nanos,
        NEXT_BRIDGE_ID.fetch_add(1, Ordering::Relaxed)
    ))
}

/// Open a fresh, fully migrated connection for a test.
///
/// Delegates to `oz_core::migrations::fresh_db`: an in-memory database with
/// every migration from `oz_core::migrations::ALL` applied (the canonical
/// migrated-test-conn pattern — the first call migrates a snapshot, later
/// calls clone it via the SQLite backup API, so per-test cost is a page
/// copy). Foreign keys are ON; `WAL`/`busy_timeout` PRAGMAs are irrelevant
/// for a single in-memory connection.
///
/// # Panics
///
/// Panics if the database cannot be created — a harness programming error,
/// matching `fresh_db`'s contract.
#[must_use]
pub fn temp_conn() -> Connection {
    migrations::fresh_db()
}

/// Owns the backing state a borrowed `BridgeCtx` points at.
///
/// The bridge crate holds no global state, so a test needs one owner for the
/// `Arc`s / locks behind the context. `TestBridge` builds headless defaults
/// mirroring `AppState::for_test` (empty session map, 24-hour TTL, no-op
/// cache, empty kernel, unregistered terminal, `media_cache_dir: None`); the
/// `with_*` builders override single fields for a specific test. Call
/// `TestBridge::ctx` to borrow a `BridgeCtx` for the duration of a call —
/// keep the `TestBridge` alive for as long as the context is used.
pub struct TestBridge {
    /// Global identity DB (single connection, tokio Mutex).
    db: Arc<Mutex<Connection>>,
    /// Per-store SQLite file manager (unique temp dir per instance).
    db_manager: StoreDatabaseManager,
    /// Token -> SessionContext map (shared Arc; tests mutate it directly).
    sessions: Arc<RwLock<HashMap<String, SessionContext>>>,
    /// Session TTL seconds.
    session_ttl_seconds: i64,
    /// Cache layer for `Store::with_cache` (no-op unless Redis is reachable).
    cache: Arc<dyn Cache>,
    /// Kernel, for domain-event publishing on the event bus.
    kernel: Mutex<Kernel>,
    /// Current terminal identity (None = unregistered).
    terminal_id: Arc<Mutex<Option<String>>>,
    /// Resolved media root (None in headless tests).
    media_cache_dir: Option<PathBuf>,
    /// HMAC key for picker tickets (empty by default; seed it to exercise the
    /// `picker` paths).
    picker_ticket_secret: Vec<u8>,
    /// Empty HAL registry (Wave D fields are injected, never probed by the
    /// relocated suites).
    registry: Arc<DriverRegistry>,
    /// No plugin manager (headless default, mirroring `AppState`).
    plugins: Arc<Mutex<Option<PluginManager>>>,
    /// Event sink: `None` = silent no-op; see `with_emitter`.
    emitter: Option<Arc<dyn EventSink>>,
    /// Unused scanner-cancel slot (hardware tests inject their own).
    scanner_cancel: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    /// Harness-owned topology apply lock. Tests never run topology Applies
    /// concurrently, so an uncontended unit lock is enough to satisfy the
    /// borrow `BridgeCtx` expects.
    topology_apply_lock: Mutex<()>,
}

impl TestBridge {
    /// Build a bridge with the canonical headless defaults.
    ///
    /// Mirrors `AppState::for_test` field-for-field: in-memory migrated
    /// global DB, per-store manager over a unique temp directory, empty
    /// session map, 24-hour TTL, no-op cache, empty kernel, no terminal.
    ///
    /// # Panics
    ///
    /// Panics if the migrated database cannot be created (see `temp_conn`).
    #[must_use]
    pub fn new() -> Self {
        Self {
            db: Arc::new(Mutex::new(temp_conn())),
            db_manager: StoreDatabaseManager::new(unique_store_dir(), migrations::ALL),
            sessions: Arc::new(RwLock::new(HashMap::new())),
            session_ttl_seconds: TEST_SESSION_TTL_SECONDS,
            // "redis://127.0.0.1/" is unreachable in tests: create_cache
            // falls back to the no-op cache (same default as AppState::for_test).
            cache: oz_core::cache::create_cache("redis://127.0.0.1/", 300),
            kernel: Mutex::new(Kernel::new()),
            terminal_id: Arc::new(Mutex::new(None)),
            media_cache_dir: None,
            picker_ticket_secret: Vec::new(),
            registry: Arc::new(DriverRegistry::new()),
            plugins: Arc::new(Mutex::new(None)),
            emitter: None,
            scanner_cancel: Arc::new(Mutex::new(None)),
            topology_apply_lock: Mutex::new(()),
        }
    }

    /// Replace the global identity DB with a caller-provided connection.
    ///
    /// Mirrors `AppState::for_test_with_conn`: lets authorization tests seed
    /// exact rows and keeps them independent of the default in-memory DB.
    #[must_use]
    pub fn with_conn(mut self, conn: Connection) -> Self {
        self.db = Arc::new(Mutex::new(conn));
        self
    }

    /// Replace the per-store manager (mirrors `AppState::for_test_with_db_manager`).
    #[must_use]
    pub fn with_db_manager(mut self, db_manager: StoreDatabaseManager) -> Self {
        self.db_manager = db_manager;
        self
    }

    /// Borrow the per-store manager (scoped tests seed store DBs through it).
    #[must_use]
    pub fn db_manager(&self) -> &StoreDatabaseManager {
        &self.db_manager
    }

    /// Point `media_cache_dir` at a real directory (products-images tests).
    #[must_use]
    #[allow(dead_code)] // retained TestBridge builder - harness API, not dead
    pub fn with_media_cache_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.media_cache_dir = Some(dir.into());
        self
    }

    /// Seed the picker-ticket HMAC key (picker/auth ticket tests).
    #[must_use]
    pub fn with_picker_ticket_secret(mut self, secret: Vec<u8>) -> Self {
        self.picker_ticket_secret = secret;
        self
    }

    /// Override the session TTL (expiry tests pass `0` or a negative value).
    #[must_use]
    #[allow(dead_code)] // retained TestBridge builder - harness API, not dead
    pub fn with_session_ttl(mut self, seconds: i64) -> Self {
        self.session_ttl_seconds = seconds;
        self
    }

    /// Clone of the session map handle, for inserting sessions before a call
    /// (the same post-construction mutation `AppState.session_store` allows).
    #[must_use]
    /// Read-only access to the headless HAL registry (tests register mock
    /// drivers before handing out a `BridgeCtx`).
    pub fn registry(&self) -> &DriverRegistry {
        &self.registry
    }

    pub fn sessions(&self) -> Arc<RwLock<HashMap<String, SessionContext>>> {
        Arc::clone(&self.sessions)
    }

    /// Install a UI event sink (Wave D kds/hardware emit-path tests).
    #[must_use]
    #[allow(dead_code)] // retained TestBridge builder - harness API, not dead
    pub fn with_emitter(mut self, sink: Arc<dyn EventSink>) -> Self {
        self.emitter = Some(sink);
        self
    }

    /// Borrow a headless `BridgeCtx` over this bridge's state.
    ///
    /// The context borrows from `&self`, so it must not outlive the
    /// `TestBridge`; borrow it per call like a command shim does.
    #[must_use]
    pub fn ctx(&self) -> BridgeCtx<'_> {
        BridgeCtx {
            db: &self.db,
            db_manager: &self.db_manager,
            sessions: &self.sessions,
            session_ttl_seconds: self.session_ttl_seconds,
            cache: &self.cache,
            kernel: &self.kernel,
            terminal_id: &self.terminal_id,
            media_cache_dir: self.media_cache_dir.clone(),
            picker_ticket_secret: self.picker_ticket_secret.clone(),
            registry: &self.registry,
            plugins: &self.plugins,
            emitter: self.emitter.clone(),
            scanner_cancel: &self.scanner_cancel,
            topology_apply_lock: &self.topology_apply_lock,
        }
    }
}

impl Default for TestBridge {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::BridgeError;

    /// The harness constructs a real `BridgeCtx` headless, and the context's
    /// session path works: an empty session map rejects an unknown token with
    /// `InvalidSession` (sync — no tokio runtime needed).
    #[test]
    fn harness_constructs_headless_bridge_ctx() {
        let bridge = TestBridge::new();
        let ctx = bridge.ctx();
        assert!(matches!(
            ctx.resolve_session("no-such-token"),
            Err(BridgeError::InvalidSession)
        ));
    }

    /// `temp_conn` returns a connection with every migration applied
    /// (one `schema_migrations` row per entry in `migrations::ALL`).
    #[test]
    fn temp_conn_is_fully_migrated() {
        let conn = temp_conn();
        let applied: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("schema_migrations table readable");
        assert_eq!(applied, migrations::ALL.len() as i64);
    }
}
