/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B1: migrations)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: forward-only contract documented; registry<->filesystem parity test pins completeness; test fresh_db snapshots via backup API with justified unwraps (test-harness scope); note: "// SAFETY:" comments here annotate safe code — recurring mislabel pattern (COR-6, with PAY-10)
next: reword COR-6 comments | perf: N/A
*/
//! Migration definitions for OZ-POS.
//!
//! Migrations are `.sql` files under `crates/kasirmu-core/migrations/`. They are
//! embedded at compile time via [`include_str!`] and run in the
//! compile-time array order of [`ALL`](crate::migrations::ALL) on first startup by the generic
//! runner in `platform-core`. The array order is canonical — not
//! lexicographic filename order — and the registry↔filesystem parity test
//! `migration_registry_matches_filesystem` ensures every `.sql` file has
//! exactly one registry entry. That test proves the two sides **agree**; it
//! cannot see an id that was removed from both at once. The ids that must never
//! disappear are pinned absolutely by `MUST_STAY_REGISTERED` in the test module:
//! adding a migration needs no edit there, dropping one does.
//!
//! # Forward-only contract
//!
//! Production migrations are **forward-only**. They must be written so that
//! re-running them is a no-op (the runner tracks applied IDs), and they are
//! never reversed in the field: destructive/data migrations require a
//! backup-plus-forward-repair procedure, never ad-hoc down SQL (DB-03).
//! The generic [`platform_core::database::rollback`] helper exists for
//! synthetic/test tables only — the core registry carries no down SQL.
//!
//! The no-op requirement is a convention, not a precondition of the drift
//! path: when an applied migration's file is edited, the runner re-applies the
//! script and tolerates the statements whose effect is provably already
//! present, so the unguarded `ALTER TABLE … ADD COLUMN` form — which SQLite
//! gives no `IF NOT EXISTS` for — survives a comment-only edit. What it cannot
//! rescue is a migration that consumes the state it transforms (a column
//! converted and then dropped, a table renamed), which is the DB-03 class
//! above. `cosmetic_edit_to_any_migration_re_applies_cleanly` in
//! `migrations_tests.rs` pins which migrations are in which set.

use platform_core::database::Migration;

/// All migrations in the order they should be applied.
///
/// The list is exhaustive at compile time; adding a new migration means
/// adding a new entry here AND a new file in `crates/kasirmu-core/migrations/`.
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
    Migration {
        id: "20260916_role_assignment_scopes.sql",
        sql: include_str!("../migrations/20260916_role_assignment_scopes.sql"),
    },
    Migration {
        id: "20260917_assignment_backfill_org_wide.sql",
        sql: include_str!("../migrations/20260917_assignment_backfill_org_wide.sql"),
    },
    Migration {
        id: "20260918_payables.sql",
        sql: include_str!("../migrations/20260918_payables.sql"),
    },
    Migration {
        id: "20260919_regional_configuration.sql",
        sql: include_str!("../migrations/20260919_regional_configuration.sql"),
    },
    Migration {
        id: "20260920_audit_retention.sql",
        sql: include_str!("../migrations/20260920_audit_retention.sql"),
    },
    Migration {
        id: "20260921_tax_rate_scoping.sql",
        sql: include_str!("../migrations/20260921_tax_rate_scoping.sql"),
    },
    Migration {
        id: "20260922_over_quota_markers.sql",
        sql: include_str!("../migrations/20260922_over_quota_markers.sql"),
    },
    Migration {
        id: "20260923_fiscal_numbering.sql",
        sql: include_str!("../migrations/20260923_fiscal_numbering.sql"),
    },
    Migration {
        id: "20260924_local_payment_methods.sql",
        sql: include_str!("../migrations/20260924_local_payment_methods.sql"),
    },
    Migration {
        id: "20260925_receipt_formats.sql",
        sql: include_str!("../migrations/20260925_receipt_formats.sql"),
    },
    Migration {
        id: "20260926_tax_rate_scoped_authoring.sql",
        sql: include_str!("../migrations/20260926_tax_rate_scoped_authoring.sql"),
    },
    Migration {
        id: "20260926_location_ticket_prefix.sql",
        sql: include_str!("../migrations/20260926_location_ticket_prefix.sql"),
    },
    // W2-A consumer: freeze the branch ticket prefix on each KDS ticket at
    // creation, so renaming a location cannot retitle chits already printed.
    Migration {
        id: "20260927_kds_ticket_prefix_stamp.sql",
        sql: include_str!("../migrations/20260927_kds_ticket_prefix_stamp.sql"),
    },
    // W5-B: a statutory series is identified by (entity, kind); the kind was
    // free TEXT, so a typo opened a parallel series at zero instead of failing.
    // Core now parses DocumentKind and this closes the same set in the schema.
    Migration {
        id: "20260928_document_kind_check.sql",
        sql: include_str!("../migrations/20260928_document_kind_check.sql"),
    },
    // E1-1 (owner ruling 2026-09-10): the statutory rounding directive rides
    // the rate row. '' = no statutory directive (the preference applies); the
    // two non-empty values are RoundingMode's serde snake_case names, so
    // storage and wire share one spelling. Registry-chronological date
    // (c3f5920cf precedent): the work is 09-10, but 20260926 REBUILDS
    // tax_rates and its INSERT..SELECT copies an enumerated column list,
    // so anything applied before it would be silently dropped — the file
    // must sort AFTER the last tax_rates DDL writer. A future rebuild of
    // this table must carry rounding_mode through both its column lists;
    // the migrations_tests pin enforces exactly that.
    Migration {
        id: "20260929_tax_rate_rounding_mode.sql",
        sql: include_str!("../migrations/20260929_tax_rate_rounding_mode.sql"),
    },
    // F2-4 (T1 dossier D64 slice 4): the per-sale audit stamp for a tax
    // computed against a non-fresh estimate. NULL = unstamped — legacy rows
    // were computed live and a missing stamp must never read as a claim, so
    // there is deliberately no backfill and no default. Date 20260930 sorts
    // after the last sales DDL writer (20260923_fiscal_numbering, which is
    // an ADD COLUMN, not a rebuild — no sales rebuild exists in the
    // registry); the same never-date-before-the-last-DDL-writer rule E1-1
    // recorded applies, and a future sales rebuild must carry
    // tax_estimate_note through both its column lists (the migrations_tests
    // pin enforces exactly that).
    Migration {
        id: "20260930_sales_tax_estimate_note.sql",
        sql: include_str!("../migrations/20260930_sales_tax_estimate_note.sql"),
    },
    // Tenant-scoped idempotency guard for POST /api/v1/sales: an opaque
    // client-supplied Idempotency-Key header bound to the sale it created,
    // keyed on (tenant_id, key) so one tenant can never resolve or block
    // another tenant's key. Absent or blank keys store NULL and therefore
    // never match, so the unguarded path stays byte-for-byte the current
    // behaviour (new sale, 201). Uniqueness lives in an explicit UNIQUE index
    // rather than a composite PRIMARY KEY so the NULL-key rows stay
    // insertable, and there is no FK on sale_id because the claim row is
    // written before the sale it guards. Date 20261001 sorts after the last
    // sales DDL writer and touches no sales column.
    Migration {
        id: "20261001_sale_idempotency.sql",
        sql: include_str!("../migrations/20261001_sale_idempotency.sql"),
    },
    // Durable record of concurrently diverged sync mutations. Stores the full
    // version vectors rather than a scalar clock, because "concurrent" is
    // exactly what a scalar cannot express. Date 20261002 sorts last and only
    // creates a new table, so it is order-independent.
    Migration {
        id: "20261002_sync_conflicts.sql",
        sql: include_str!("../migrations/20261002_sync_conflicts.sql"),
    },
    // Server-side version vector per entity: the "what have we already seen"
    // half of a concurrency comparison. Concurrency is a property of a pair of
    // mutations, so it cannot be decided from the pushed item alone. Date
    // 20261003 sorts last and only creates a new table.
    Migration {
        id: "20261003_sync_entity_vectors.sql",
        sql: include_str!("../migrations/20261003_sync_entity_vectors.sql"),
    },
    // Cloud-side Midtrans QRIS issue ledger: resolves order_id ->
    // (tenant, sale) at webhook time WITHOUT depending on the device having
    // synced its sale — the race the existing gateway_reference JOIN-based
    // resolver cannot cross. No FK on sale_id for the same claim-before-sale
    // reason 20261001_sale_idempotency records. Date 20261004 sorts last and
    // only creates a new table.
    Migration {
        id: "20261004_midtrans_transactions.sql",
        sql: include_str!("../migrations/20261004_midtrans_transactions.sql"),
    },
    // Dynamic KDS routing rules (todo-kds-agents-1.md backend slice): an
    // explicit per-line station assignment composed on top of the frozen
    // zone router — burger→Kitchen / cocktail→Bar splits without touching
    // catalog data. Date 20261005 sorts last and only creates a new table.
    Migration {
        id: "20261005_kds_routing_rules.sql",
        sql: include_str!("../migrations/20261005_kds_routing_rules.sql"),
    },
    // Receipt hierarchy code (docs/plans/receipt-hierarchy-code.md): index
    // ids on location/terminal/user plus the continuous receipt counter.
    // Date 20261006 sorts last and only adds columns and new tables, so it
    // re-applies cleanly under the statement-level drift fallback.
    Migration {
        id: "20261006_receipt_hierarchy_code.sql",
        sql: include_str!("../migrations/20261006_receipt_hierarchy_code.sql"),
    },
    // First-run provisioning record (ADR #56 §2.1): one row per terminal, whose
    // presence is the 'this device is set up' fact that replaces three
    // independently-read booleans. Date 20261007 sorts last and only creates a
    // new table, so it re-applies cleanly under the statement-level drift
    // fallback.
    Migration {
        id: "20261007_provisioning.sql",
        sql: include_str!("../migrations/20261007_provisioning.sql"),
    },
    // ADR #56 §2.1 backfill: 20261007 created `provisioning` with no rows, so
    // every terminal set up by the PRE-#56 wizard reads as Unprovisioned and is
    // re-routed into onboarding on every boot. This one writes the missing row
    // from the legacy-only `store.show_setup_wizard = 'false'` signal, keyed on
    // `terminals.device_id` — the only SQL-readable spelling of the hostname the
    // shell gates on. Date 20261008 sorts last and only INSERTs rows, so it
    // re-applies cleanly under the statement-level drift fallback.
    Migration {
        id: "20261008_provisioning_legacy_backfill.sql",
        sql: include_str!("../migrations/20261008_provisioning_legacy_backfill.sql"),
    },
    // Staff trash: soft delete plus a 90-day retention window (ADR-#58-adjacent
    // staff lifecycle). Two nullable columns on `users` and a partial index.
    // `ADD COLUMN` has no `IF NOT EXISTS` in SQLite, so the columns stand on the
    // drift path's tolerance for statements whose effect is provably already
    // present — the same ground the `tenant_id` and `tender_currency` columns
    // stand on — while the index is guarded outright. Date 20261009 sorts last.
    Migration {
        id: "20261009_staff_trash.sql",
        sql: include_str!("../migrations/20261009_staff_trash.sql"),
    },
    // Custom roles join the same trash. Two nullable columns on `roles`, and
    // deliberately no index: that table is O(tens) and read whole, so a scan for
    // trashed rows is free and a partial index would be decoration. The purge
    // for roles is a real DELETE (no personal data, and the delete guard has
    // already proved nothing references the row) — see the file header. Date
    // 20261010 sorts last.
    Migration {
        id: "20261010_role_trash.sql",
        sql: include_str!("../migrations/20261010_role_trash.sql"),
    },
    // C3 slice S1 (schema only, no behaviour yet): the origin stamp a terminal
    // needs to recognise its OWN pushed mutation, and the per-effect receipt
    // that replaces the delivery-only `sync_applied_items` ledger. Two nullable
    // columns and one PARTIAL unique index — no backfill, because a guessed
    // origin would suppress a legitimate deduction. The unguarded `ADD COLUMN`
    // form stands on the drift path's `pragma_table_info` fallback (20261009
    // precedent); the index is guarded outright. Appended after the registry
    // tail so the id 20261007 does not reorder anything — it touches no column
    // any earlier migration reads.
    Migration {
        id: "20261007_sync_origin_and_effect_key.sql",
        sql: include_str!("../migrations/20261007_sync_origin_and_effect_key.sql"),
    },
    // COR-27 / C18 P1.3: the open-shift invariant moves from one function to the
    // schema — a PARTIAL unique index on shifts(user_id) WHERE status='open',
    // mirroring idx_inv_shifts_active_per_user_location on inventory_shifts. The
    // migration also reconciles any pre-existing duplicate open shifts (closing
    // all but the most recent, deterministically) so the CREATE cannot fail on a
    // store written before 4518a2b8 made open_shift atomic. One named index, so
    // the index-surface pin in migrations_tests.rs moves 188 -> 189; no table is
    // added. Appended after the registry tail so no earlier migration reorders.
    Migration {
        id: "20261011_open_shift_uniqueness.sql",
        sql: include_str!("../migrations/20261011_open_shift_uniqueness.sql"),
    },
    // C10b under owner decision D11: the negative-stock backstop on
    // `stock_summary`, enforced CONDITIONALLY on the location binding's
    // `allow_negative_stock` opt-in. NOT a CHECK: an unconditional `qty >= 0`
    // silently re-enables the Layer-1 guard that flag exists to opt out of,
    // which was measured (it failed
    // `negative_stock_event_fires_when_allow_negative_enabled`). Two triggers
    // (INSERT + UPDATE) because the upsert both writers use fires only the
    // latter once the row exists. No table, index or row changes, so the table
    // pin (127) and index pin (189) stand; the TRIGGER pin moves 6 -> 8.
    // Appended after the registry tail so no earlier migration reorders.
    Migration {
        id: "20261012_stock_summary_qty_nonnegative.sql",
        sql: include_str!("../migrations/20261012_stock_summary_qty_nonnegative.sql"),
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

/// Seed the baseline rows ADR #56 §2.6 stopped shipping, for tests.
///
/// The §2.6 removal deleted three things the baseline migration used to seed
/// unconditionally: the `Default Store` location, the five `default-*`
/// workspace instances, and the `BOOTSTRAP_FREE` tenant subscription. Those
/// rows are now created by `provision_device` in one transaction, because a
/// store with no merchant should have no location and no workspaces.
///
/// Tests that exercise layers BELOW provisioning still need a provisioned
/// store to run against, so this reproduces exactly what provisioning
/// produces. It is the single place those rows are rebuilt, so the five
/// workspace ids stay identical wherever a test asserts on them by name.
///
/// Deliberately NOT part of `fresh_db`: a test of first-run behaviour must
/// see an UNPROVISIONED database, and seeding here by default would
/// re-introduce the fiction §2.6 removed.
#[doc(hidden)]
pub fn seed_provisioned_baseline(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT INTO locations (id, name, is_primary) VALUES ('default', 'Default Store', 1);
         INSERT INTO legal_entities (id, tenant_id, name, legal_name) VALUES ('default:default-legal-entity', 'default', 'Default Legal Entity', 'Default Legal Entity');
         UPDATE locations SET legal_entity_id = 'default:default-legal-entity' WHERE id = 'default';
         INSERT INTO workspace_instances (id, type_key, location_id, name, description, colour, status, last_accessed_at) VALUES
            ('default-restaurant-pos', 'restaurant-pos', 'default', 'Restaurant POS', 'Cashier terminal for restaurant ordering', NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            ('default-store-pos', 'store-pos', 'default', 'Store POS', 'Cashier terminal for retail', NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            ('default-warehouse', 'warehouse', 'default', 'Warehouse', 'Product and stock management', NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            ('default-admin', 'admin', 'default', 'Admin', 'System administration', NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            ('default-kds', 'kds', 'default', 'Kitchen Display', 'Kitchen order queue display', NULL, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
         INSERT INTO tenant_subscription (tenant_id, tier_key, status, expires_at, max_locations, max_pos_instances, allowed_types_json, signature)
         VALUES ('default', 'free', 'active', NULL, 1, 1, '[\"store-pos\", \"restaurant-pos\", \"admin\"]', 'BOOTSTRAP_FREE');"
    )
    // INVARIANT: hardcoded valid SQL batch executed against a freshly-migrated baseline DB.
    .expect("seed_provisioned_baseline failed");
}

/// Create a fresh in-memory database with all migrations already applied.
///
/// Uses a [`std::sync::LazyLock`]ed pre-migrated snapshot connection.
/// The first call runs all migrations once; subsequent calls clone the
/// snapshot via SQLite's page-level [`rusqlite::backup::Backup`] API —
/// orders of magnitude faster than re-running `execute_batch` per test.
///
/// The returned connection carries the same per-connection PRAGMAs
/// [`run`] applies (see there for why each exists), except
/// `journal_mode = WAL`: an in-memory database cannot use WAL — SQLite
/// reports it as `memory` and keeps it — so that mode is deliberately
/// not set here. `synchronous`, `busy_timeout` and `foreign_keys` are
/// per-connection settings, not stored in the file, so the migrated
/// snapshot does not carry them into the clone and they must be set on
/// every returned connection. Without the busy timeout a contended test
/// connection fails instantly instead of waiting, which is how a
/// concurrency test can pass without ever exercising the wait.
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

    // Mirror the per-connection PRAGMAs `run` applies. WAL is impossible
    // for `:memory:` (SQLite pins it to `memory`), so only the three
    // per-connection settings are reproduced.
    fresh
        .pragma_update(None, "busy_timeout", "5000")
        .expect("busy_timeout on a fresh test DB cannot fail");
    fresh
        .pragma_update(None, "synchronous", "NORMAL")
        .expect("synchronous on a fresh test DB cannot fail");
    fresh
        .pragma_update(None, "foreign_keys", "ON")
        .expect("foreign_keys on a fresh test DB cannot fail");
    fresh
}

#[cfg(test)]
#[path = "migrations_tests.rs"]
mod tests;
