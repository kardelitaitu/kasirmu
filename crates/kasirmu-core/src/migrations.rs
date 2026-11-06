/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice B1: migrations)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: forward-only contract documented; registry<->filesystem parity test pins completeness; test fresh_db snapshots via backup API with justified unwraps (test-harness scope); note: "// SAFETY:" comments here annotate safe code — recurring mislabel pattern (COR-6, with PAY-10)
next: none | perf: N/A
COR-6 FIXED 2026-10-04 — the six `// SAFETY:` comments in the snapshot/parity test
helpers annotate `.unwrap()` on safe calls (in-memory SQLite opens, a Mutex
lock, a backup copy), not unsafe blocks, so they are now `// `.unwrap()`
reason:` comments; `grep SAFETY` in this file finds only real unsafe.
*/
//! Migration definitions for kasir.mu.
//!
//! Migrations are `.sql` files under `crates/kasirmu-core/migrations/`. They are
//! embedded at compile time via [`include_str!`] and run in the
//! compile-time array order of `ALL` (crate::migrations::ALL) on first startup by the generic
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
    // KDS pairing tokens become single-use. Appended at the registry tail so
    // no earlier migration reorders.
    Migration {
        id: "20261013_kds_pairing_consumption.sql",
        sql: include_str!("../migrations/20261013_kds_pairing_consumption.sql"),
    },
    // ...and then removed entirely: nothing verified them. See the migration.
    Migration {
        id: "20261014_kds_drop_pairing_tokens.sql",
        sql: include_str!("../migrations/20261014_kds_drop_pairing_tokens.sql"),
    },
    // Same shape as the drop above: a secret nothing could verify. See the migration.
    Migration {
        id: "20261015_gift_cards_drop_pin.sql",
        sql: include_str!("../migrations/20261015_gift_cards_drop_pin.sql"),
    },
    // Cross-database FK removal on shifts: under multi-store isolation (ADR #4 /
    // #7 / #35), users and terminals live in the global identity DB (kasir.db)
    // while shifts lives in store-scoped databases. The FK constraints to empty
    // store-db tables caused SQLite foreign key violations on shift creation.
    Migration {
        id: "20261016_shifts_drop_cross_db_fks.sql",
        sql: include_str!("../migrations/20261016_shifts_drop_cross_db_fks.sql"),
    },
    // ADR-64 (D1 & D5): payments.method and payments.gateway_status closed sets.
    Migration {
        id: "20261017_payments_method_check.sql",
        sql: include_str!("../migrations/20261017_payments_method_check.sql"),
    },
    // ADR-64 (D4) vocabulary REPAIR: 20261017 shipped 'chargeback' and omitted
    // the decided 'voided', 'disputed' and 'unconfirmed'. This restates the
    // constraint over the decision's own set. Date 20261018 sorts last, and the
    // change is a constraint rebuild over an unread column, so it reorders
    // nothing.
    Migration {
        id: "20261018_gateway_status_adr64_vocabulary.sql",
        sql: include_str!("../migrations/20261018_gateway_status_adr64_vocabulary.sql"),
    },
    // Audit log cryptographic chain hashing for tamper detection (P1): adds
    // `previous_hash` and `hash` to `audit_log`. Date 20261019 sorts last and
    // only adds columns, so it re-applies cleanly under the statement-level
    // drift fallback.
    Migration {
        id: "20261019_audit_chain_hash.sql",
        sql: include_str!("../migrations/20261019_audit_chain_hash.sql"),
    },
    // Constrain products.product_type to ('retail', 'restaurant', 'service').
    // Rebuilds products table with CHECK constraint.
    Migration {
        id: "20261020_product_type_check.sql",
        sql: include_str!("../migrations/20261020_product_type_check.sql"),
    },
    // Accounts Receivable (Piutang / Jual Tempo / Kasbon) — Phase 3 of
    // payment-methods-plan.md (§1.5 & §2c). Adds `receivables` and
    // `receivable_payments` tables, mirroring the payables schema, plus
    // `credit_limit_minor` on `customers`.
    Migration {
        id: "20261021_receivables.sql",
        sql: include_str!("../migrations/20261021_receivables.sql"),
    },
    // O-M04: indexed sale_id and (status, action) on offline_queue for O(1) point-probe
    // idempotency checks during checkout settlement.
    Migration {
        id: "20261023_offline_queue_sale_id.sql",
        sql: include_str!("../migrations/20261023_offline_queue_sale_id.sql"),
    },
    // Measured defect: the daily/weekly/monthly revenue CTEs filter
    // `DATE(refunds.created_at, tz) BETWEEN ?1 AND ?2`, which no existing index
    // serves, so every revenue report scanned the whole refunds table. Adds the
    // expression index idx_refunds_currency_created_date mirroring
    // 20260814_analytics_index.sql's precedent for sales, plus
    // idx_refunds_processed_by_created_at for the bare-created_at range the
    // shift-close reconciliation uses. Two indexes, no table and no trigger, so
    // the index-surface pin in migrations_tests.rs moves 196 -> 198. Appended at
    // the registry tail so no earlier migration reorders.
    Migration {
        id: "20261024_refunds_analytics_index.sql",
        sql: include_str!("../migrations/20261024_refunds_analytics_index.sql"),
    },
    // O-M68: covering range index for unrestricted window popularity recompute.
    // Turns SCAN product_activity USING INDEX idx_product_activity_sku into
    // SEARCH product_activity USING COVERING INDEX idx_product_activity_created_at.
    Migration {
        id: "20261025_product_activity_created_at.sql",
        sql: include_str!("../migrations/20261025_product_activity_created_at.sql"),
    },
    // ADR-66 (Centralized Topology Authoring Phase 1): metadata columns on topology_revisions
    // (org_id, actor, key_id, signature, base_revision) for signed revision replication.
    Migration {
        id: "20261026_topology_revisions_metadata.sql",
        sql: include_str!("../migrations/20261026_topology_revisions_metadata.sql"),
    },
    // O-M69: covering index for the outcome-filtered audit screen. No existing
    // audit_log index led with `outcome`, so ADDING that predicate to the page
    // query dropped the index-only walk for a full scan plus a temp sort —
    // filtering was slower than not filtering (measured, 5,000 rows + ANALYZE).
    // One index, no table and no trigger, so the surface pin moves 199 -> 200.
    Migration {
        id: "20261027_audit_log_outcome_created.sql",
        sql: include_str!("../migrations/20261027_audit_log_outcome_created.sql"),
    },
    // O-M04 follow-up: the legacy branch of the outbox idempotency probe.
    // 20261023 added `sale_id` WITHOUT backfilling, so every row written before
    // it is NULL forever and reachable only through the `sale_id IS NULL` branch,
    // which scanned because idx_offline_queue_sale_pending is partial on
    // `sale_id IS NOT NULL`. This partial index serves exactly that set.
    // One index, no table and no trigger, so the surface pin moves 200 -> 201.
    Migration {
        id: "20261028_offline_queue_legacy_sale_probe.sql",
        sql: include_str!("../migrations/20261028_offline_queue_legacy_sale_probe.sql"),
    },
    // O-M04 follow-up: backfill `sale_id` for rows that predate the column. 20261023
    // added it without populating it, so those rows could never reach the indexed
    // branch. Guarded by a closing-quote check so a naive substr cannot write garbage;
    // anything left NULL keeps working through the legacy substring branch.
    // No new index, no table, no trigger — the surface pin is unchanged.
    Migration {
        id: "20261029_offline_queue_sale_id_backfill.sql",
        sql: include_str!("../migrations/20261029_offline_queue_sale_id_backfill.sql"),
    },
    // Gift card tender unblocking (owner-question-gift-card-tender.md Q1 Option A):
    // widens payments.method CHECK to include 'gift_card'. Rebuilds payments
    // table keeping both indexes (idx_payments_idempotency_key, idx_payments_sale_id).
    Migration {
        id: "20261107_payments_gift_card_method.sql",
        sql: include_str!("../migrations/20261107_payments_gift_card_method.sql"),
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
/// Seed the rows a PROVISIONED store has: a location, a legal entity, the standard
/// workspace instances and a free tenant subscription.
///
/// # CALL THIS INSTEAD OF WRITING THE INSERTS A SECOND TIME
///
/// Two attempts to hand-write these rows (in `tests/payment_failure_integration.rs`,
/// 2026-10-01) both died on constraints - first `NOT NULL: workspace_instances.description`,
/// then `FOREIGN KEY constraint failed` - because the SQL was written against
/// `20260813_init.sql`, whose `workspace_instances` still declares `store_id`.
///
/// **The init SQL is the PRE-migration shape.** `20260906_rename_store_to_location.sql:18`
/// does `ALTER TABLE workspace_instances RENAME COLUMN store_id TO location_id`, so the
/// schema actually applied has `location_id` - which is what this seed correctly uses.
/// Reading init.sql and stopping is what sends an author wrong; it is the FIRST migration,
/// not the current one.
///
/// # AND NOTE THE IDS
///
/// The workspaces this seeds are `default-store-pos`, `default-restaurant-pos`,
/// `default-warehouse`, `default-admin`, `default-kds` - never a bare `default`. Callers
/// that resolve a primary location through `sales_checkout.rs` (which defaults its
/// `workspace_instance_id` to the literal `"default"`) still need to bind one of these
/// under that id; see the re-key in `tests/payment_failure_integration.rs`. Seeding is
/// necessary, and on its own not sufficient, for that path.
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

/// Restore the bootstrap Free subscription row on a `local` terminal that has none.
///
/// # The defect this repairs
///
/// ADR #56 §2.6 option C removed the schema's `BOOTSTRAP_FREE` seed and assigned
/// every row it used to ship — location, workspaces, subscription — to
/// `provision_device`'s single transaction (`20260813_init.sql:1399-1410` and
/// `:1512-1520`, both of which state it in the schema's own words). That function
/// writes the first two and never wrote the third, so a `local` terminal is
/// provisioned into a state the product then treats as unlicensed:
///
/// * the capabilities read fails closed on the absent row
///   (`entitlements.rs`, `SubscriptionLoader for Store`: `Ok(None)` → `None`),
/// * which projects `state: 'unavailable'`,
/// * which is not in `WorkspaceHome.toolLock`'s open set (`active`/`grace`/
///   `loading`), so the FIRST gate rejects every tool before the tier check is
///   ever reached,
/// * and every card renders "Subscription inactive".
///
/// The row `provision_device` is missing is the row this writes. Doing it here as
/// well as there is deliberate, not redundant: this repairs installs provisioned
/// *before* that write existed. §2.6's own justification for not shipping a
/// repair migration was §1.7's "no install base exists" — a claim that stops being
/// true the first time a merchant's database is provisioned.
///
/// # Three guards, each load-bearing
///
/// 1. **A `local` terminal, not any terminal.** ADR-56 §2.4 makes `local` the
///    default and a supported permanent Free tier; it has no licence server, so
///    this sentinel row is the only row it can ever have. A `linked` install's
///    entitlement is the server's grant, and a missing row there is an anomaly
///    that must keep failing closed — writing Free would also risk pre-empting
///    the real grant.
/// 2. **Only when the row is ABSENT.** A present row is left exactly as it is,
///    verified or not, so this can never launder a bad signature. That is the
///    whole difference between repairing an absent row and becoming a licence
///    bypass.
/// 3. **`INSERT OR IGNORE`.** Idempotent under a concurrent launch, which this
///    file permits: the tablet shares `kasir.db` with the bridge, the sync daemon
///    and any second process a dev machine left running.
///
/// # Returns
///
/// `Ok(true)` when this call wrote the row, `Ok(false)` when it was not needed or
/// not applicable — so a caller can log the repair without a second read.
///
/// # Errors
///
/// Returns [`crate::CoreError`] when `provisioning` or `tenant_subscription`
/// cannot be read or written. A startup caller should warn and continue: a failed
/// repair leaves the install exactly as it was — a locked terminal, not a broken
/// one — and refusing to boot over a repair step is the worse failure.
pub fn ensure_bootstrap_subscription(
    conn: &rusqlite::Connection,
) -> Result<bool, crate::CoreError> {
    let is_local: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM provisioning WHERE mode = 'local')",
        [],
        |row| row.get(0),
    )?;
    if !is_local {
        return Ok(false);
    }

    let has_row: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM tenant_subscription WHERE tenant_id = 'default')",
        [],
        |row| row.get(0),
    )?;
    if has_row {
        return Ok(false);
    }

    // The row is the one `seed_provisioned_baseline` writes, pinned column by
    // column by `the_reconcile_writes_the_row_the_baseline_seeds` — so this is a
    // pinned copy of that row rather than a second source of truth for it.
    let written = conn.execute(
        "INSERT OR IGNORE INTO tenant_subscription \
         (tenant_id, tier_key, status, expires_at, max_locations, max_pos_instances, \
         allowed_types_json, signature) \
         VALUES ('default', 'free', 'active', NULL, 1, 1, \
         '[\"store-pos\", \"restaurant-pos\", \"admin\"]', 'BOOTSTRAP_FREE')",
        [],
    )?;
    Ok(written > 0)
}

/// `<workspace>/target/test-scratch`, created if absent.
///
/// A local copy of the walk-up in `kasirmu-test-support`, because that crate is a
/// DEV-dependency and `fresh_db` is reachable from the library. Reusing the same
/// path matters: the test-support fixtures and this snapshot cache must share one
/// root, or the gitignore that covers `target/` stops describing reality.
///
/// Create a fresh in-memory database with all migrations already applied.
///
/// Uses a [`std::sync::LazyLock`]ed pre-migrated snapshot connection.
/// The first call runs all migrations once; subsequent calls clone the
/// snapshot via SQLite's page-level [`rusqlite::backup::Backup`] API —
/// orders of magnitude faster than re-running `execute_batch` per test.
///
/// The snapshot is behind a `Mutex` and that is load-bearing, not an
/// oversight. `rusqlite::Connection` is `Send` but deliberately not `Sync`,
/// and `Backup::new` takes a `RefCell` borrow on its source
/// (`from.db.borrow_mut()`, rusqlite 0.31 `backup.rs:213`), so two threads
/// handing out clones through one shared `&Connection` would race that
/// `RefCell`. **An `RwLock` is not an optimisation here, it is a data race.**
///
/// Measured 2026-09-28, recorded so this is not "optimised" again on a
/// guess: the 68-migration chain costs ~305 ms to apply and one clone costs
/// ~3 ms of a 2 024 KiB snapshot, but 384 clones spread over N threads get
/// *slower* past two threads — 1.15 s at 1 thread, 0.76 s at 2, 2.18 s at 8,
/// 3.75 s at 32. Replacing this `Mutex` with a per-thread source did not
/// lift that ceiling; it measured ~15% worse at 4+ threads. Whatever caps
/// parallel DB construction sits below this function — most likely SQLite's
/// global allocation mutex — so this lock is not what is holding the suite
/// up, and swapping the 66-odd surviving `run` call sites over to
/// `fresh_db()` needs no prerequisite work here.
///
/// RE-CONFIRMED at suite scale 2026-10-23, because the note above was written
/// from a microbenchmark and someone had already tried to raise the thread count
/// once. `kasirmu-bridge`'s full suite, 1542 tests, is the end-to-end version of
/// the same curve: **1395-1471 s at libtest's default 32 threads, 355.95 s at 4**
/// (identical 1542 passed / 0 failed). Per-module, `kds::` alone: 42.79 s at 1
/// thread, 31.17 s at 2, **26.37 s at 4**, 50.80 s at 8, 92.90 s at 32. The
/// modules that hurt are exactly the ones that construct many `TestBridge`s —
/// every `TestBridge::new()` clones this snapshot — while the 332-test
/// `topology` module, which mostly does not, finishes in 9.66 s serial and is
/// unaffected. `.config/nextest.toml` now pins `test-threads = 4` on
/// `[profile.default]` so the ceiling is applied instead of rediscovered.
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

    // A file-backed snapshot in the scratch root, shared ACROSS PROCESSES.
    //
    // Why this exists: nextest forks one process per TEST, so the in-memory
    // static below is rebuilt in every one of them. MEASURED 2026-10-23 on
    // kasirmu-core (82 migrations): running the migration chain costs 440.66 ms
    // while cloning an existing snapshot costs 1.05 ms -- a 420x difference.
    // A full nextest run therefore paid that chain per test: 294.89 s under
    // nextest against 65.10 s under cargo test --test-threads=4, for the same
    // 3674 tests. The file cache is the fix: build once, reuse everywhere.
    //
    // The cache is keyed by a fingerprint of the migration set, so a changed
    // migration produces a different file and never reads a stale schema.
    // A corrupt or unreadable file falls back to rebuilding rather than failing.
    let snapshot_file = test_db_snapshot::snapshot_cache_path();

    // The in-process snapshot, still the fastest path when it is warm: one
    // process running many tests (what cargo test does) pays nothing here.
    static SNAPSHOT: LazyLock<Mutex<rusqlite::Connection>> =
        LazyLock::new(|| Mutex::new(test_db_snapshot::build_snapshot_conn()));

    // INVARIANT: opening an in-memory SQLite database allocates a private pager and
    // touches no file, so the only failure modes (I/O, path, permissions) cannot occur
    // here. A panic would mean the SQLite library itself is unusable, in which case no
    // test in this crate could run anyway.
    let mut fresh = rusqlite::Connection::open_in_memory().unwrap();

    if snapshot_file.is_file() {
        // Fast path: clone from the shared file.
        let src = if let Ok(c) = rusqlite::Connection::open(&snapshot_file) {
            c
        } else {
            // A torn or locked file must not fail a test: rebuild it.
            let _ = std::fs::remove_file(&snapshot_file);
            test_db_snapshot::build_snapshot_conn()
        };
        {
            let backup = rusqlite::backup::Backup::new(&src, &mut fresh)
                .expect("backup from the cached snapshot cannot fail");
            backup
                .run_to_completion(100, std::time::Duration::from_millis(0), None)
                .expect("page copy from the cached snapshot cannot fail");
        }
    } else {
        // Cold cache: build the snapshot, then persist it for other processes.
        // INVARIANT: this Mutex is never held across code that can panic while holding
        // it -- the guarded body only runs a rusqlite backup, whose failures are handled
        // by the `expect`s below rather than by unwinding. A poisoned lock here therefore
        // means an earlier test panicked mid-backup, and taking the poison is the correct
        // signal rather than something to silently work around.
        let snapshot = SNAPSHOT.lock().unwrap();
        {
            let backup = rusqlite::backup::Backup::new(&snapshot, &mut fresh)
                .expect("backup from the in-memory snapshot cannot fail");
            backup
                .run_to_completion(100, std::time::Duration::from_millis(0), None)
                .expect("page copy from the in-memory snapshot cannot fail");
        }
        drop(snapshot);

        // Write the file for the next process. Best-effort: a read-only scratch
        // root costs speed, never correctness, and the next caller retries.
        test_db_snapshot::write_snapshot_file(&snapshot_file);
    }

    // Mirror the per-connection PRAGMAs `run` applies. WAL is impossible
    // for :memory: (SQLite pins it to memory), so only the three
    // per-connection settings are reproduced. Without the busy timeout a
    // contended test connection fails instantly instead of waiting, which is
    // how a concurrency test can pass without ever exercising the wait.
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

/// The disk cache behind `fresh_db`; that module carries the measurements
/// and the reason it is separate from the constructor.
#[path = "test_db_snapshot.rs"]
mod test_db_snapshot;

#[cfg(test)]
#[path = "migrations_tests.rs"]
mod tests;
