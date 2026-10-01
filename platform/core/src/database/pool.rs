//! Simple connection pool.
/*
last audited 25-07-26 by RSA-Agent (platform-core slice E: pool deep read)
crate: platform-core | status: SAFE | lint: CLEAN
findings: clean single-connection Mutex pool with WAL/FK pragmas, poison-safe lock mapping, Send+Sync asserted by test
next: none | perf: correct for SQLite write serialization
*/
//!
//! kasir.mu uses SQLite, which does not benefit from a multi-connection
//! pool (write concurrency is serialised at the file level). This pool
//! wraps a single [`rusqlite::Connection`] behind a [`Mutex`] so that
//! multiple threads can safely access the database.
//!
//! If the application moves to a client-server database (PostgreSQL,
//! MySQL), swap this implementation for `deadpool` or `r2d2`.

use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::error::PlatformError;

/// A thread-safe wrapper around a single [`rusqlite::Connection`].
/// # Example
/// ```ignore
/// let pool = Pool::open("pos.db")?;
/// let conn = pool.conn()?;
/// conn.execute("SELECT 1", [])?;
/// ```
#[derive(Clone)]
pub struct Pool {
    inner: Arc<Mutex<Connection>>,
}

impl Pool {
    /// Open a new database file and wrap it in a pool.
    ///
    /// Runs `PRAGMA journal_mode = WAL` and
    /// `PRAGMA foreign_keys = ON` on the underlying connection.
    pub fn open(path: &str) -> Result<Self, PlatformError> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self {
            inner: Arc::new(Mutex::new(conn)),
        })
    }

    /// Open an in-memory database (for testing).
    pub fn open_in_memory() -> Result<Self, PlatformError> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self {
            inner: Arc::new(Mutex::new(conn)),
        })
    }

    /// Acquire the lock and return a guard to the underlying connection.
    ///
    /// The lock is released when the guard is dropped.
    pub fn conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>, PlatformError> {
        self.inner
            .lock()
            .map_err(|e| PlatformError::Internal(format!("failed to lock database mutex: {e}")))
    }
}

#[cfg(test)]
#[path = "pool_tests.rs"]
mod tests;
