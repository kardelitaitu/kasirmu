//! Database infrastructure — migration runner, connection pool,
//! and store-scoped database manager (ADR #4 Phase 2).

pub mod manager;
pub mod migrations;
pub mod pool;

/// SQL statement text and the already-satisfied proof the drift re-apply uses.
/// Private to this module tree: the runner is its only consumer.
mod statements;

pub use manager::StoreDatabaseManager;
pub use migrations::{Migration, rollback, run};
pub use pool::Pool;
