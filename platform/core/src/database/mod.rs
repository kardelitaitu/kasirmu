//! Database infrastructure — migration runner, connection pool,
//! and store-scoped database manager (ADR #4 Phase 2).

pub mod manager;
pub mod migrations;
pub mod pool;

/// SQL statement text — splitting, tokenizing, the canonical DDL form —
/// and the significance predicate the runner applies per fragment. Private to
/// this module tree: the runner is its only consumer.
mod statements;

/// Whether a statement's effect has already landed, or would not land at all —
/// the two skip proofs the drift re-apply consults. Private to this module
/// tree: the runner is its only consumer.
mod proofs;

pub use manager::StoreDatabaseManager;
pub use migrations::{Migration, rollback, run};
pub use pool::Pool;
