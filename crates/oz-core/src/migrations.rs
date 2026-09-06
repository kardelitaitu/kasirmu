/*
last audited 25-07-26 by RSA-Agent (oz-core slice B1: migrations)
crate: oz-core | status: SAFE | lint: CLEAN
findings: forward-only contract documented; registry<->filesystem parity test pins completeness; test fresh_db snapshots via backup API with justified unwraps (test-harness scope); note: "// SAFETY:" comments here annotate safe code — recurring mislabel pattern (COR-6, with PAY-10)
next: reword COR-6 comments | perf: N/A
*/
//! Migration definitions for OZ-POS.
//!
//! Migrations are `.sql` files under `crates/oz-core/migrations/`. They are
//! embedded at compile time via [`include_str!`] and run in the
//! compile-time array order of [`ALL`](crate::migrations::ALL) on first startup by the generic
//! runner in `platform-core`. The array order is canonical — not
//! lexicographic filename order — and the registry↔filesystem parity test
//! `migration_registry_matches_filesystem` ensures every `.sql` file has
//! exactly one registry entry.
//!
//! # Forward-only contract
//!
//! Production migrations are **forward-only**. They must be written so that
//! re-running them is a no-op (the runner tracks applied IDs), and they are
//! never reversed in the field: destructive/data migrations require a
//! backup-plus-forward-repair procedure, never ad-hoc down SQL (DB-03).
//! The generic [`platform_core::database::rollback`] helper exists for
//! synthetic/test tables only — the core registry carries no down SQL.

use platform_core::database::Migration;

/// All migrations in the order they should be applied.
///
/// The list is exhaustive at compile time; adding a new migration means
/// adding a new entry here AND a new file in `crates/oz-core/migrations/`.
///
pub const ALL: &[Migration] = &[
    Migration {
        id: "20260813_init.sql",
        sql: include_str!("../migrations/20260813_init.sql"),
    },
    Migration {
        id: "20260814_tenant_uniqueness.sql",
        sql: include_str!("../migrations/20260814_tenant_uniqueness.sql"),
    },
    Migration {
        id: "20260815_tenant_unique_indexes.sql",
        sql: include_str!("../migrations/20260815_tenant_unique_indexes.sql"),
    },
    Migration {
        id: "20260814_offline_queue_index.sql",
        sql: include_str!("../migrations/20260814_offline_queue_index.sql"),
    },
    Migration {
        id: "20260814_sale_lines_tenant.sql",
        sql: include_str!("../migrations/20260814_sale_lines_tenant.sql"),
    },
    Migration {
        id: "20260814_sales_tenant.sql",
        sql: include_str!("../migrations/20260814_sales_tenant.sql"),
    },
    Migration {
        id: "20260814_sent_reports.sql",
        sql: include_str!("../migrations/20260814_sent_reports.sql"),
    },
    Migration {
        id: "20260814_sent_reports_tenant.sql",
        sql: include_str!("../migrations/20260814_sent_reports_tenant.sql"),
    },
    Migration {
        id: "20260814_analytics_index.sql",
        sql: include_str!("../migrations/20260814_analytics_index.sql"),
    },
    Migration {
        id: "20260820_kds_devices.sql",
        sql: include_str!("../migrations/20260820_kds_devices.sql"),
    },
    Migration {
        id: "20260821_tender_currency.sql",
        sql: include_str!("../migrations/20260821_tender_currency.sql"),
    },
    Migration {
        id: "20260822_sale_charges.sql",
        sql: include_str!("../migrations/20260822_sale_charges.sql"),
    },
    Migration {
        id: "20260822_kds_counter_store.sql",
        sql: include_str!("../migrations/20260822_kds_counter_store.sql"),
    },
    Migration {
        id: "20260823_po_receive_state.sql",
        sql: include_str!("../migrations/20260823_po_receive_state.sql"),
    },
    Migration {
        id: "20260824_media_edc.sql",
        sql: include_str!("../migrations/20260824_media_edc.sql"),
    },
    Migration {
        id: "20260825_payment_infra.sql",
        sql: include_str!("../migrations/20260825_payment_infra.sql"),
    },
    Migration {
        id: "20260826_sale_line_snapshots.sql",
        sql: include_str!("../migrations/20260826_sale_line_snapshots.sql"),
    },
    Migration {
        id: "20260827_refunds_tenant.sql",
        sql: include_str!("../migrations/20260827_refunds_tenant.sql"),
    },
    Migration {
        id: "20260831_loyalty_multiplier_fixedpoint.sql",
        sql: include_str!("../migrations/20260831_loyalty_multiplier_fixedpoint.sql"),
    },
    Migration {
        id: "20260831_per_tenant_unique_rebuild.sql",
        sql: include_str!("../migrations/20260831_per_tenant_unique_rebuild.sql"),
    },
    Migration {
        id: "20260901_gift_card_redeem_idempotency.sql",
        sql: include_str!("../migrations/20260901_gift_card_redeem_idempotency.sql"),
    },
    Migration {
        id: "20260901_image_refs.sql",
        sql: include_str!("../migrations/20260901_image_refs.sql"),
    },
    Migration {
        id: "20260901_product_images.sql",
        sql: include_str!("../migrations/20260901_product_images.sql"),
    },
    Migration {
        id: "20260902_outbox.sql",
        sql: include_str!("../migrations/20260902_outbox.sql"),
    },
    Migration {
        id: "20260902_snapshot_versions.sql",
        sql: include_str!("../migrations/20260902_snapshot_versions.sql"),
    },
    Migration {
        id: "20260903_webhook_endpoints.sql",
        sql: include_str!("../migrations/20260903_webhook_endpoints.sql"),
    },
    Migration {
        id: "20260904_kds_indexes.sql",
        sql: include_str!("../migrations/20260904_kds_indexes.sql"),
    },
    Migration {
        id: "20260906_rename_store_to_location.sql",
        sql: include_str!("../migrations/20260906_rename_store_to_location.sql"),
    },
    Migration {
        id: "20260907_add_location_tenant_id.sql",
        sql: include_str!("../migrations/20260907_add_location_tenant_id.sql"),
    },
    Migration {
        id: "20260908_legal_entities.sql",
        sql: include_str!("../migrations/20260908_legal_entities.sql"),
    },
    Migration {
        id: "20260909_memos.sql",
        sql: include_str!("../migrations/20260909_memos.sql"),
    },
    Migration {
        id: "20260910_memo_child_tenant_id.sql",
        sql: include_str!("../migrations/20260910_memo_child_tenant_id.sql"),
    },
    Migration {
        id: "20260911_memo_fk_restrict.sql",
        sql: include_str!("../migrations/20260911_memo_fk_restrict.sql"),
    },
    Migration {
        id: "20260912_terminals_tenant.sql",
        sql: include_str!("../migrations/20260912_terminals_tenant.sql"),
    },
    Migration {
        id: "20260913_memo_locations.sql",
        sql: include_str!("../migrations/20260913_memo_locations.sql"),
    },
    Migration {
        id: "20260914_memo_retention.sql",
        sql: include_str!("../migrations/20260914_memo_retention.sql"),
    },
    Migration {
        id: "20260915_topology_revisions.sql",
        sql: include_str!("../migrations/20260915_topology_revisions.sql"),
    },
];

/// Postgres DDL for the full schema, parallel to the SQLite `init.sql`.
///
/// Generated from `20260813_init.sql` by
/// `scripts/generate-pg-migration.py` (types mapped, foreign-key table
/// order topologically sorted, SQLite triggers rewritten as plpgsql). The
/// cloud server's `DbPool::connect_postgres` applies this instead of the
/// SQLite registry; it is idempotent (`IF NOT EXISTS`, `ON CONFLICT DO
/// NOTHING`, `CREATE OR REPLACE`).
pub const PG_INIT: &str = include_str!("../migrations/20260813_init.pg.sql");

/// Apply every unapplied migration and configure runtime PRAGMAs.
///
/// After migrations, sets WAL journal mode + busy_timeout for better
/// concurrent-read performance and multi-connection safety, and enables
/// foreign key enforcement (SQLite defaults to OFF). These are idempotent
/// — safe to call on every startup.
pub fn run(conn: &mut rusqlite::Connection) -> Result<(), crate::CoreError> {
    platform_core::database::run(conn, ALL)?;
    // WAL mode enables concurrent reads while a write is in progress.
    // busy_timeout prevents "database is locked" errors when multiple
    // connections contend for the write lock (default is 0 = immediate fail).
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "busy_timeout", "5000")?;
    // synchronous=NORMAL is safe in WAL mode (the WAL itself provides
    // durability) and yields 2–3× faster writes than the default FULL.
    // For a local POS database, only a power loss or hard shutdown
    // (without fsync) loses the most recent transaction, which the
    // offline queue recovers from.
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    // Enable foreign key enforcement. SQLite defaults to OFF — the setting
    // is per-connection, so we must set it on every connection open.
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

/// Create a fresh in-memory database with all migrations already applied.
///
/// Uses a [`std::sync::LazyLock`]ed pre-migrated snapshot connection.
/// The first call runs all migrations once; subsequent calls clone the
/// snapshot via SQLite's page-level [`rusqlite::backup::Backup`] API —
/// orders of magnitude faster than re-running `execute_batch` per test.
///
/// # Panics
///
/// Panics if the database cannot be created.
#[doc(hidden)]
pub fn fresh_db() -> rusqlite::Connection {
    use std::sync::{LazyLock, Mutex};

    /// Pre-migrated snapshot — built once, cloned for every test.
    static SNAPSHOT: LazyLock<Mutex<rusqlite::Connection>> = LazyLock::new(|| {
        use std::sync::OnceLock;

        fn cached_sql() -> &'static str {
            static SQL: OnceLock<String> = OnceLock::new();
            SQL.get_or_init(|| {
                let mut buf = String::with_capacity(48_000);
                buf.push_str("PRAGMA foreign_keys = ON;\n");
                buf.push_str(
                    "CREATE TABLE IF NOT EXISTS schema_migrations (\n\
                     id         TEXT PRIMARY KEY,\n\
                     applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),\n\
                     checksum   TEXT\n\
                     );\n",
                );
                for mig in ALL {
                    buf.push_str("BEGIN;\n");
                    buf.push_str(mig.sql);
                    buf.push('\n');
                    buf.push_str("INSERT INTO schema_migrations (id) VALUES ('");
                    buf.push_str(mig.id);
                    buf.push_str("');\n");
                    buf.push_str("COMMIT;\n");
                }
                buf
            })
        }

        let conn = rusqlite::Connection::open_in_memory().unwrap(); // SAFETY: in-memory test DB open cannot fail; failure is a harness programming error (see fresh_db # Panics)
        conn.execute_batch(cached_sql()).unwrap(); // SAFETY: SQL is compile-time embedded from `ALL`; syntax errors fail the test suite, not a live process
        Mutex::new(conn)
    });

    let mut fresh = rusqlite::Connection::open_in_memory().unwrap(); // SAFETY: in-memory test DB open cannot fail (fresh_db # Panics)
    {
        let snapshot = SNAPSHOT.lock().unwrap(); // SAFETY: lock is only poisoned if the snapshot init closure panicked, which is a test harness bug
        let backup = rusqlite::backup::Backup::new(&snapshot, &mut fresh).unwrap(); // SAFETY: both connections are valid in-memory SQLite handles; Backup::new cannot fail
        backup
            .run_to_completion(100, std::time::Duration::from_millis(0), None)
            .unwrap(); // SAFETY: page copy between two in-memory DBs cannot fail at runtime
    } // drop Backup (releases &mut fresh borrow), then drop MutexGuard
    fresh
}

#[cfg(test)]
#[path = "migrations_tests.rs"]
mod tests;
