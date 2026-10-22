//! Query-plan regression probe (QP-01): do the high-traffic production
//! queries SEARCH an index, or do they SCAN a table that grows with
//! transaction volume?
//!
//! The last real defect this class of check found was found BY HAND: before
//! `20261024_refunds_analytics_index.sql` every revenue report read the whole
//! `refunds` table. This module makes that pass systematic rather than
//! opportunistic: `EXPLAIN QUERY PLAN` over a seeded, migrated, ANALYZE'd
//! database, for a CURATED list of queries, asserting that none of them
//! `SCAN`s a LARGE table.
//!
//! # What counts as a defect here
//!
//! LARGE tables grow with transaction volume: `sales`, `sale_lines`,
//! `refunds`, `refund_lines`, `offline_queue`, `audit_log`, `product_activity`,
//! `stock_movements`, `payments`, `kds_orders`. Each row of growth makes a
//! scanning query slower, without bound.
//!
//! SMALL / config tables are allowed to scan: `products`, `settings`, `roles`,
//! `locations`, `currencies`, `kds_order_targets`, `stock_summary`, ... They
//! are bounded by catalogue or configuration size, so a scan is a constant.
//!
//! # Why the seed and the ANALYZE are load-bearing
//!
//! On an EMPTY table SQLite picks a plan arbitrarily - measured on `refunds`
//! while writing `revenue_refund_cte_uses_refunds_currency_created_date_index`
//! in `migrations_tests.rs`: without rows or statistics an assertion about a
//! scan is vacuous, because there is no cost model to disagree with. So every
//! large table is seeded with `SEED_ROWS` rows across a realistic spread of
//! days, statuses, tenants and priorities, and `ANALYZE` runs before any plan
//! is asked for.
//!
//! # Falsifiability - this probe is PROVEN to fail
//!
//! An assertion that cannot fail is worthless, and that exact mistake has been
//! made on this project three times. `forcing_a_scan_fails_the_probe` is the
//! proof, and it is permanent rather than a one-off manual experiment: it
//! takes the SAME SQL the green assertions read, drops all its `WHERE`
//! predicates (which is the shape that scans), and requires the very same
//! detector used by `production_queries_do_not_scan_large_tables` to report
//! the table. If the detector ever stops recognising "SCAN <large table>",
//! that test fails - so a silently toothless probe cannot ship.
//!
//! # Constant-sourced vs copied
//!
//! Reading the production text matters: a plan test against a COPY of a query
//! stays green when the real query is reshaped back into the scanning form.
//! Where the SQL is already hoisted to a `pub(crate) const` the probe imports
//! the constant. Where the SQL is still inline in its method, the probe holds
//! a COPY - every copy is marked "COPIED - keep in sync with" and names the
//! exact `file:line` it duplicates. `copied_query_provenance_is_intact` fails
//! the build when one of those anchors no longer resolves.
//!
//! This is a GATE, not coverage: it names the queries it checks and says
//! nothing about the rest. See the header of `PROBES`.

use kasirmu_core::migrations;
use rusqlite::Connection;

/// Rows seeded into every LARGE table. Large enough that a full scan is
/// measurably the wrong plan, small enough that the whole probe seeds in
/// well under a second.
const SEED_ROWS: i64 = 400;

/// The tables whose size grows with transaction volume. A `SCAN` of any of
/// these is a defect; a scan of anything else is not graded.
///
/// `refund_lines` and `payments` are here because they grow with refund and
/// tender splits respectively; `kds_order_targets` deliberately is NOT, because
/// it is bounded by (order x configured kitchens).
const LARGE_TABLES: &[&str] = &[
    "sales",
    "sale_lines",
    "refunds",
    "refund_lines",
    "offline_queue",
    "audit_log",
    "product_activity",
    "stock_movements",
    "payments",
    "kds_orders",
];

/// The SQL under test, before it is wrapped in `EXPLAIN QUERY PLAN`.
///
/// Using the production constants where they exist is the point: these are the
/// same characters the product runs. The three revenue CTEs are imported
/// through the crate's own module path (`kasirmu_core::db::reports`), so an
/// edit to any of them lands in this probe with no edit here. The rest are
/// COPIED from the method that builds them and must be kept in sync by hand.
mod production_sql {
    // CONSTANT-SOURCED.
    pub(super) use kasirmu_core::db::reports::{
        DAILY_REVENUE_SQL, MONTHLY_REVENUE_SQL, WEEKLY_REVENUE_SQL,
    };

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/reports/product_sales.rs:173`
    /// (`Store::top_products`; the `{order_clause}` placeholder is resolved
    /// to its revenue branch, the default).
    pub(super) const TOP_PRODUCTS: &str = "SELECT COALESCE(sl.product_id, p.id, sl.sku) AS product_id,
                sl.sku AS sku,
                COALESCE(sl.product_name, p.name, sl.sku) AS name,
                sl.currency AS currency,
                SUM(sl.qty) AS total_qty,
                SUM(sl.line_minor) AS total_minor,
                SUM(COALESCE(sl.cost_minor, p.cost_minor, 0) * sl.qty) AS cogs_minor,
                (SUM(sl.line_minor) - SUM(COALESCE(sl.cost_minor, p.cost_minor, 0) * sl.qty)) AS gross_profit_minor
         FROM sale_lines sl
         JOIN sales s ON sl.sale_id = s.id
         LEFT JOIN products p ON sl.sku = p.sku
         WHERE s.status = 'completed' AND DATE(s.created_at, ?4) BETWEEN ?1 AND ?2
         GROUP BY sl.sku, sl.currency,
                  COALESCE(sl.product_id, p.id, sl.sku),
                  COALESCE(sl.product_name, p.name, sl.sku)
         ORDER BY total_minor DESC, sl.sku
         LIMIT ?3";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/reports/product_sales.rs:391`
    /// (`Store::category_breakdown`).
    pub(super) const CATEGORY_BREAKDOWN: &str =
        "SELECT COALESCE(sl.category_id, p.category_id) AS category_id,
                COALESCE(c.name, 'Uncategorised') AS category_name,
                sl.currency AS currency,
                SUM(sl.line_minor) AS total_minor,
                COUNT(DISTINCT s.id) AS sale_count
         FROM sale_lines sl
         JOIN sales s ON sl.sale_id = s.id
         LEFT JOIN products p ON sl.sku = p.sku
         LEFT JOIN categories c ON c.id = COALESCE(sl.category_id, p.category_id)
         WHERE s.status = 'completed' AND DATE(s.created_at, ?3) BETWEEN ?1 AND ?2
         GROUP BY COALESCE(sl.category_id, p.category_id), sl.currency
         ORDER BY sl.currency, total_minor DESC";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/reports/product_sales.rs:481`
    /// (`Store::inventory_trend`).
    pub(super) const INVENTORY_TREND: &str = "SELECT DATE(s.created_at, ?3) AS date,
                COALESCE(SUM(sl.qty), 0) AS units_sold
         FROM sale_lines sl
         JOIN sales s ON sl.sale_id = s.id
         WHERE s.status = 'completed' AND DATE(s.created_at, ?3) BETWEEN ?1 AND ?2
         GROUP BY DATE(s.created_at, ?3)
         ORDER BY date ASC";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/reports/sales_summary.rs:181`
    /// (`Store::hourly_heatmap`).
    pub(super) const HOURLY_HEATMAP: &str =
        "SELECT CAST(strftime('%w', created_at, ?3) AS INTEGER) AS day_of_week,
                CAST(strftime('%H', created_at, ?3) AS INTEGER) AS hour,
                currency,
                SUM(total_minor) AS total_minor,
                COUNT(*) AS sale_count
         FROM sales
         WHERE status = 'completed' AND DATE(created_at, ?3) BETWEEN ?1 AND ?2
         GROUP BY day_of_week, hour, currency
         ORDER BY day_of_week, hour";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/reports/sales_summary.rs:214`
    /// (`Store::payment_method_breakdown`).
    pub(super) const PAYMENT_METHOD_BREAKDOWN: &str =
        "SELECT COALESCE(payment_method, 'other') AS payment_method,
                currency,
                SUM(total_minor) AS total_minor,
                COUNT(*) AS sale_count
         FROM sales
         WHERE status = 'completed' AND DATE(created_at, ?3) BETWEEN ?1 AND ?2
         GROUP BY payment_method, currency
         ORDER BY currency, total_minor DESC";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/reports/sales_summary.rs:276`
    /// (`Store::voided_items`).
    pub(super) const VOIDED_ITEMS: &str =
        "SELECT COALESCE(p.name, sl.sku) AS name, SUM(sl.qty) AS qty
         FROM sale_lines sl
         JOIN sales s ON sl.sale_id = s.id
         LEFT JOIN products p ON sl.sku = p.sku
         WHERE s.status = 'voided' AND DATE(s.created_at, ?4) BETWEEN ?1 AND ?2
         GROUP BY sl.sku
         ORDER BY qty DESC
         LIMIT ?3";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/offline.rs:147`
    /// (`Store::list_pending_offline`).
    pub(super) const LIST_PENDING_OFFLINE: &str = "SELECT id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id, sale_id
         FROM offline_queue WHERE status = 'pending' ORDER BY created_at ASC";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/offline.rs:175`
    /// (`Store::list_pending_offline_for_push_bounded`).
    pub(super) const LIST_PENDING_OFFLINE_FOR_PUSH_BOUNDED: &str = "SELECT id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id, sale_id
         FROM offline_queue WHERE status = 'pending' ORDER BY priority ASC, created_at ASC, id ASC LIMIT ?1";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/offline.rs:214`
    /// (`Store::list_pending_offline_for_tenant`).
    pub(super) const LIST_PENDING_OFFLINE_FOR_TENANT: &str = "SELECT id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id, sale_id
         FROM offline_queue WHERE status = 'pending' AND tenant_id = ?1 ORDER BY created_at ASC";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/offline.rs:246`
    /// (`Store::list_pending_offline_for_tenant_for_push_bounded`).
    pub(super) const LIST_PENDING_OFFLINE_FOR_TENANT_PUSH_BOUNDED: &str = "SELECT id, action, payload, status, retry_count, last_error, created_at, synced_at, tenant_id, priority, origin_terminal_id, sale_id
         FROM offline_queue WHERE status = 'pending' AND tenant_id = ?1 ORDER BY priority ASC, created_at ASC, id ASC LIMIT ?2";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/offline.rs:202`
    /// (`Store::get_last_synced_at`).
    pub(super) const OFFLINE_LAST_SYNCED_AT: &str =
        "SELECT MAX(synced_at) FROM offline_queue WHERE status = 'synced'";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/offline/enqueue.rs:47`
    /// (`Store::enqueue_offline_dedup`).
    pub(super) const OFFLINE_ENQUEUE_DEDUP_PROBE: &str = "SELECT EXISTS(SELECT 1 FROM offline_queue
          WHERE status = 'pending' AND action = ?1 AND payload = ?2)";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/offline/enqueue.rs:520`
    /// (`Store::has_pending_outbox_row_for_sale`, indexed fast path).
    pub(super) const OFFLINE_OUTBOX_PROBE: &str = "SELECT EXISTS(SELECT 1 FROM offline_queue
          WHERE sale_id = ?1 AND status = 'pending' AND action = ?2)";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/offline/enqueue.rs:532`
    /// (`Store::has_pending_outbox_row_for_sale`, legacy fallback).
    pub(super) const OFFLINE_OUTBOX_LEGACY_FALLBACK: &str =
        "SELECT EXISTS(SELECT 1 FROM offline_queue
          WHERE sale_id IS NULL AND status = 'pending' AND action = ?1 AND instr(payload, ?2) > 0)";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/kds_orders.rs:56`
    /// (`Store::list_kds_orders`, no status filter).
    pub(super) const LIST_KDS_ORDERS: &str = "SELECT id, sale_id, store_id, target_instance_id, status, items_summary, item_count, display_number,
                received_at, started_at, ready_at, served_at,
                prep_time_seconds, kitchen_zone, notes, table_number, priority, ticket_prefix
         FROM kds_orders ORDER BY received_at DESC";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/kds_orders.rs:127`
    /// (`Store::list_kds_orders_for_instance`: the assembled SQL with the
    /// visibility fragment from `instance_visibility_condition_sql` at :93
    /// inlined and `status_filter = Some(..)`).
    pub(super) const LIST_KDS_ORDERS_FOR_INSTANCE: &str = "SELECT id, sale_id, store_id, target_instance_id, status, items_summary, item_count, display_number,
                received_at, started_at, ready_at, served_at,
                prep_time_seconds, kitchen_zone, notes, table_number, priority, ticket_prefix
         FROM kds_orders WHERE status = :status AND (
            (
                NOT EXISTS (
                    SELECT 1 FROM kds_order_targets t
                    WHERE t.kds_order_id = kds_orders.id
                )
                AND (
                    kds_orders.target_instance_id IS NULL
                    OR kds_orders.target_instance_id = :iid
                )
            )
            OR EXISTS (
                SELECT 1 FROM kds_order_targets t2
                WHERE t2.kds_order_id = kds_orders.id
                  AND t2.target_instance_id = :iid
            )
        ) ORDER BY received_at DESC";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/kds_orders.rs:515`
    /// (`Store::get_kds_queue`, no zone filter - the query whose own doc
    /// names `idx_kds_orders_status_received` in `20260904_kds_indexes.sql`).
    pub(super) const GET_KDS_QUEUE: &str = "SELECT id, sale_id, store_id, target_instance_id, status, items_summary, item_count, display_number,
                received_at, started_at, ready_at, served_at,
                prep_time_seconds, kitchen_zone, notes, table_number, priority, ticket_prefix
         FROM kds_orders
         WHERE status IN ('pending', 'preparing', 'ready')
         ORDER BY
            CASE status
                WHEN 'pending' THEN 1
                WHEN 'preparing' THEN 2
                WHEN 'ready' THEN 3
            END,
            received_at ASC";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/audit.rs:693`
    /// (`Store::has_audit_row_for`).
    pub(super) const AUDIT_ROW_PROBE: &str =
        "SELECT EXISTS(SELECT 1 FROM audit_log WHERE action = ?1 AND target_id = ?2)";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/audit.rs:708`
    /// (`Store::list_audit_entries`).
    pub(super) const LIST_AUDIT_ENTRIES: &str =
        "SELECT id, user_id, action, target_type, target_id, details, outcome, created_at
         FROM audit_log ORDER BY created_at DESC LIMIT ?1 OFFSET ?2";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/audit.rs:1046`
    /// (`Store::count_audit_entries_after`).
    pub(super) const COUNT_AUDIT_ENTRIES_AFTER: &str =
        "SELECT COUNT(*) FROM audit_log WHERE created_at > ?1";

    /// COPIED - keep in sync with `crates/kasirmu-core/src/db/audit.rs:955`
    /// (`Store::verify_audit_chain`).
    pub(super) const VERIFY_AUDIT_CHAIN: &str = "SELECT id, user_id, action, target_type, target_id, details, outcome, created_at, previous_hash, hash
         FROM audit_log
         WHERE hash != ''
         ORDER BY created_at ASC, id ASC";

    /// COPIED - keep in sync with
    /// `crates/kasirmu-core/src/db/products_stock_adjust/movements.rs:26`
    /// (`Store::list_stock_movements`).
    pub(super) const LIST_STOCK_MOVEMENTS: &str =
        "SELECT id, item_id, delta, reason, source_terminal_id, source_user_id,
                store_id, created_at
         FROM stock_movements
         WHERE item_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2 OFFSET ?3";

    /// COPIED - keep in sync with
    /// `crates/kasirmu-core/src/db/products_stock_adjust/movements.rs:92`
    /// (`Store::archive_stock_movements`, the archivable-item scan).
    pub(super) const STOCK_MOVEMENTS_ARCHIVABLE_ITEMS: &str = "SELECT DISTINCT item_id
         FROM stock_movements
         WHERE created_at < ?1
           AND reason != 'archive-rollup'
         LIMIT ?2";

    /// COPIED - keep in sync with
    /// `crates/kasirmu-core/src/db/products_stock_adjust/ledger.rs:24`
    /// (the per-item ledger sum).
    pub(super) const STOCK_LEDGER_SUM: &str =
        "SELECT SUM(delta) FROM stock_movements WHERE item_id = ?1";
}

use production_sql::*;

/// One probe: the production query, where it lives, and the bound parameters
/// its placeholders expect.
struct Probe {
    /// Stable name used in failure messages.
    name: &'static str,
    /// `file:line` of the production query - the constant's definition for a
    /// constant-sourced probe, the copied statement for a copied one.
    origin: &'static str,
    /// The SQL, exactly as the product prepares it.
    sql: &'static str,
    /// Values for `?1`, `?2`, ... in order, as text (SQLite compares the TEXT
    /// columns these placeholders bind to lexically either way).
    binds: &'static [&'static str],
    /// The query's own `alias -> table` map. SQLite names an aliased table by
    /// its alias in the plan, so without this `SCAN s1` could not be attributed
    /// to `sales`. An alias that is missing here simply fails to match a LARGE
    /// table name, so the cost of forgetting one is a missed scan, never a
    /// false alarm - `forcing_a_scan_fails_the_probe` exists to keep that
    /// direction honest.
    aliases: &'static [(&'static str, &'static str)],
    /// The names bound by the query's own `WITH` clause. A `SCAN <cte>` is a
    /// nested loop over an already-computed result, not a table read, so these
    /// names are excluded from grading.
    ctes: &'static [&'static str],
}

/// The curated probe list - 27 production queries, deliberately not 300.
///
/// COVERED: the three time-bucketed revenue reports; the product/category
/// breakdowns and the inventory trend; the operational sales rollups (heatmap,
/// tender split, voided items); the offline-queue listers and its idempotency
/// probes (dedup + outbox, indexed path and legacy fallback); the KDS ticket
/// listers; the audit-log reads and the hash-chain walk; the stock-movement
/// history, the archive sweeper and the per-item ledger sum.
///
/// NOT COVERED (by design - this is a gate, not a census): everything else in
/// `crates/kasirmu-core/src/db/`, including the dynamic `WHERE` builders in
/// `audit::list_audit_entries_page` / `list_audit_entries_export_filtered`
/// (whose text is assembled per call), the report queries in
/// `sales_summary.rs` past line 276 (baskets, customer mix, discounts, table
/// turnover), the popularity/analytics aggregates over `product_activity`,
/// `payments` readers, the shifts/settlement joins, and every writer.
/// Extend the list by copying the SQL and naming the file:line -
/// `copied_query_provenance_is_intact` keeps the anchor honest.
const PROBES: &[Probe] = &[
    Probe {
        name: "daily_revenue",
        origin: "crates/kasirmu-core/src/db/reports/revenue.rs:125 (DAILY_REVENUE_SQL, CONSTANT)",
        sql: DAILY_REVENUE_SQL,
        binds: &["2026-01-01", "2026-12-31", "-0 hours"],
        aliases: &[
            ("s1", "sales"),
            ("s2", "sales"),
            ("sl2", "sale_lines"),
            ("rf1", "refunds"),
        ],
        ctes: &["s", "rg", "r"],
    },
    Probe {
        name: "weekly_revenue",
        origin: "crates/kasirmu-core/src/db/reports/revenue.rs:184 (WEEKLY_REVENUE_SQL, CONSTANT)",
        sql: WEEKLY_REVENUE_SQL,
        binds: &["2026-01-01", "2026-12-31", "-0 hours"],
        aliases: &[
            ("s1", "sales"),
            ("s2", "sales"),
            ("sl2", "sale_lines"),
            ("rf1", "refunds"),
        ],
        ctes: &["s", "rg", "r"],
    },
    Probe {
        name: "monthly_revenue",
        origin: "crates/kasirmu-core/src/db/reports/revenue.rs:244 (MONTHLY_REVENUE_SQL, CONSTANT)",
        sql: MONTHLY_REVENUE_SQL,
        binds: &["2026-01-01", "2026-12-31", "-0 hours"],
        aliases: &[
            ("s1", "sales"),
            ("s2", "sales"),
            ("sl2", "sale_lines"),
            ("rf1", "refunds"),
        ],
        ctes: &["s", "rg", "r"],
    },
    Probe {
        name: "top_products",
        origin: "crates/kasirmu-core/src/db/reports/product_sales.rs:173",
        sql: TOP_PRODUCTS,
        binds: &["2026-01-01", "2026-12-31", "20", "-0 hours"],
        aliases: &[("sl", "sale_lines"), ("s", "sales")],
        ctes: &[],
    },
    Probe {
        name: "category_breakdown",
        origin: "crates/kasirmu-core/src/db/reports/product_sales.rs:391",
        sql: CATEGORY_BREAKDOWN,
        binds: &["2026-01-01", "2026-12-31", "-0 hours"],
        aliases: &[("sl", "sale_lines"), ("s", "sales")],
        ctes: &[],
    },
    Probe {
        name: "inventory_trend",
        origin: "crates/kasirmu-core/src/db/reports/product_sales.rs:481",
        sql: INVENTORY_TREND,
        binds: &["2026-01-01", "2026-12-31", "-0 hours"],
        aliases: &[("sl", "sale_lines"), ("s", "sales")],
        ctes: &[],
    },
    Probe {
        name: "hourly_heatmap",
        origin: "crates/kasirmu-core/src/db/reports/sales_summary.rs:181",
        sql: HOURLY_HEATMAP,
        binds: &["2026-01-01", "2026-12-31", "-0 hours"],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "payment_method_breakdown",
        origin: "crates/kasirmu-core/src/db/reports/sales_summary.rs:214",
        sql: PAYMENT_METHOD_BREAKDOWN,
        binds: &["2026-01-01", "2026-12-31", "-0 hours"],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "voided_items",
        origin: "crates/kasirmu-core/src/db/reports/sales_summary.rs:276",
        sql: VOIDED_ITEMS,
        binds: &["2026-01-01", "2026-12-31", "20", "-0 hours"],
        aliases: &[("sl", "sale_lines"), ("s", "sales")],
        ctes: &[],
    },
    Probe {
        name: "list_pending_offline",
        origin: "crates/kasirmu-core/src/db/offline.rs:147",
        sql: LIST_PENDING_OFFLINE,
        binds: &[],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "list_pending_offline_for_push_bounded",
        origin: "crates/kasirmu-core/src/db/offline.rs:175",
        sql: LIST_PENDING_OFFLINE_FOR_PUSH_BOUNDED,
        binds: &["100"],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "list_pending_offline_for_tenant",
        origin: "crates/kasirmu-core/src/db/offline.rs:214",
        sql: LIST_PENDING_OFFLINE_FOR_TENANT,
        binds: &["default"],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "list_pending_offline_for_tenant_for_push_bounded",
        origin: "crates/kasirmu-core/src/db/offline.rs:246",
        sql: LIST_PENDING_OFFLINE_FOR_TENANT_PUSH_BOUNDED,
        binds: &["default", "100"],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "get_last_synced_at",
        origin: "crates/kasirmu-core/src/db/offline.rs:202",
        sql: OFFLINE_LAST_SYNCED_AT,
        binds: &[],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "enqueue_offline_dedup (idempotency probe)",
        origin: "crates/kasirmu-core/src/db/offline/enqueue.rs:47",
        sql: OFFLINE_ENQUEUE_DEDUP_PROBE,
        binds: &["complete_sale", "{\"sale_id\":\"seed-sale-7\"}"],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "has_pending_outbox_row_for_sale (indexed fast path)",
        origin: "crates/kasirmu-core/src/db/offline/enqueue.rs:520",
        sql: OFFLINE_OUTBOX_PROBE,
        binds: &["seed-sale-7", "complete_sale"],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "has_pending_outbox_row_for_sale (legacy fallback)",
        origin: "crates/kasirmu-core/src/db/offline/enqueue.rs:532",
        sql: OFFLINE_OUTBOX_LEGACY_FALLBACK,
        binds: &["complete_sale", "\"sale_id\":\"seed-sale-7\""],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "list_kds_orders",
        origin: "crates/kasirmu-core/src/db/kds_orders.rs:56",
        sql: LIST_KDS_ORDERS,
        binds: &[],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "list_kds_orders_for_instance",
        origin: "crates/kasirmu-core/src/db/kds_orders.rs:127",
        sql: LIST_KDS_ORDERS_FOR_INSTANCE,
        binds: &["instance-1", "pending"],
        aliases: &[],
        ctes: &[],
    },
    // HONEST LIMIT, measured (not inferred). `get_kds_queue` is SEARCHed
    // through idx_kds_orders_status_received only while the live set is a
    // SMALL fraction of kds_orders - which is the real operating condition,
    // because served and cancelled tickets accumulate forever while the board
    // holds one service period. With the active set above roughly 20-30% of
    // the table SQLite correctly prefers a full scan, and this probe will then
    // report it: that is a true statement about the query, that its plan
    // depends on retention keeping the live set small. Measured on the same
    // query: empty table -> SEARCH (idx_kds_orders_status_received); 240 of
    // 400 rows live -> SCAN kds_orders; 20 of 400 live -> SEARCH.
    Probe {
        name: "get_kds_queue",
        origin: "crates/kasirmu-core/src/db/kds_orders.rs:515",
        sql: GET_KDS_QUEUE,
        binds: &[],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "has_audit_row_for",
        origin: "crates/kasirmu-core/src/db/audit.rs:693",
        sql: AUDIT_ROW_PROBE,
        binds: &["sale.void", "seed-sale-3"],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "list_audit_entries",
        origin: "crates/kasirmu-core/src/db/audit.rs:708",
        sql: LIST_AUDIT_ENTRIES,
        binds: &["50", "0"],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "count_audit_entries_after",
        origin: "crates/kasirmu-core/src/db/audit.rs:1046",
        sql: COUNT_AUDIT_ENTRIES_AFTER,
        binds: &["2026-06-01T00:00:00.000Z"],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "verify_audit_chain",
        origin: "crates/kasirmu-core/src/db/audit.rs:955",
        sql: VERIFY_AUDIT_CHAIN,
        binds: &[],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "list_stock_movements",
        origin: "crates/kasirmu-core/src/db/products_stock_adjust/movements.rs:26",
        sql: LIST_STOCK_MOVEMENTS,
        binds: &["seed-product-3", "100", "0"],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "archive_stock_movements (archivable items)",
        origin: "crates/kasirmu-core/src/db/products_stock_adjust/movements.rs:92",
        sql: STOCK_MOVEMENTS_ARCHIVABLE_ITEMS,
        binds: &["2026-07-01T00:00:00.000Z", "50"],
        aliases: &[],
        ctes: &[],
    },
    Probe {
        name: "stock ledger sum",
        origin: "crates/kasirmu-core/src/db/products_stock_adjust/ledger.rs:24",
        sql: STOCK_LEDGER_SUM,
        binds: &["seed-product-3"],
        aliases: &[],
        ctes: &[],
    },
];

/// The status a seeded KDS ticket carries: mostly history, a few live.
///
/// 90% served, 5% cancelled, and the remaining ~5% split across the three live
/// states. See the call site for why the mix is load-bearing.
fn kds_status(i: i64) -> &'static str {
    match i % 20 {
        0 => "cancelled",
        1 => "pending",
        2 => "preparing",
        3 => "ready",
        _ => "served",
    }
}

/// A migrated, seeded, ANALYZE'd in-memory database.
///
/// Seeding runs in ONE transaction, mirroring the production rule that SQLite
/// writes happen inside a transaction.
fn seeded_connection() -> Connection {
    let conn = migrations::fresh_db();

    {
        let tx = conn
            .unchecked_transaction()
            .expect("opening the seed transaction on a migrated in-memory DB");
        for i in 0..SEED_ROWS {
            // Spread across a year so DATE() buckets, week truncation and
            // month buckets all have several rows each - the planner needs
            // real selectivity to reason about.
            let created_at = format!(
                "2026-{:02}-{:02}T{:02}:{:02}:00.000Z",
                (i % 12) + 1,
                (i % 28) + 1,
                i % 24,
                i % 60
            );
            let status = match i % 5 {
                0 => "voided",
                1 => "pending",
                _ => "completed",
            };
            let currency = if i % 3 == 0 { "MUR" } else { "USD" };
            let tenant = if i % 4 == 0 { "tenant-b" } else { "default" };
            let product = format!("seed-product-{}", i % 40);
            let sale_id = format!("seed-sale-{i}");

            tx.execute(
                "INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at,
                                    payment_method, tenant_id)
                 VALUES (?1, ?2, ?3, 1, ?4, ?5, ?5, ?6, ?7)",
                rusqlite::params![
                    sale_id,
                    1000i64 + i * 7,
                    currency,
                    status,
                    created_at,
                    match i % 4 {
                        0 => "cash",
                        1 => "card",
                        2 => "qris",
                        _ => "ewallet",
                    },
                    tenant,
                ],
            )
            .expect("seeding sales");
            tx.execute(
                "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency,
                                         line_position, cost_minor, tenant_id, product_id, product_name,
                                         category_id)
                 VALUES (?1, ?2, ?3, 1, 1000, 1000, ?4, 1, 500, ?5, ?3, ?3, ?6)",
                rusqlite::params![
                    format!("seed-line-{i}"),
                    sale_id,
                    product,
                    currency,
                    tenant,
                    format!("seed-category-{}", i % 6),
                ],
            )
            .expect("seeding sale_lines");
            tx.execute(
                "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
                 VALUES (?1, 'seed-user', ?2, 'sale', ?3, '{}', ?4, ?5)",
                rusqlite::params![
                    format!("seed-audit-{i}"),
                    match i % 3 {
                        0 => "sale.void",
                        1 => "sale.refund",
                        _ => "settings.change",
                    },
                    sale_id,
                    if i % 9 == 0 { "failure" } else { "success" },
                    created_at,
                ],
            )
            .expect("seeding audit_log");
            tx.execute(
                "INSERT INTO offline_queue (id, action, payload, status, created_at, tenant_id, priority,
                                            sale_id, synced_at)
                 VALUES (?1, 'complete_sale', ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    format!("seed-queue-{i}"),
                    format!("{{\"sale_id\":\"{sale_id}\"}}"),
                    match i % 3 {
                        0 => "pending",
                        1 => "synced",
                        _ => "failed",
                    },
                    created_at,
                    tenant,
                    i % 3,
                    // A tenth of the rows carry no sale_id: the legacy shape
                    // the backward-compatible fallback probe exists for.
                    if i % 10 == 0 {
                        None
                    } else {
                        Some(sale_id.clone())
                    },
                    if i % 3 == 1 {
                        Some(created_at.clone())
                    } else {
                        None
                    },
                ],
            )
            .expect("seeding offline_queue");
            tx.execute(
                "INSERT INTO kds_orders (id, sale_id, status, received_at, kitchen_zone, table_number,
                                         target_instance_id, store_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'seed-store')",
                rusqlite::params![
                    format!("seed-kds-{i}"),
                    sale_id,
                    // A KITCHEN BOARD IS MOSTLY HISTORY: one day's live
                    // tickets against months of served and cancelled ones.
                    // This distribution is 90% served, 5% cancelled, ~5% live.
                    // It is load-bearing, and measured: with the uniform
                    // i % 5 cycle (60% of rows "live") SQLite correctly
                    // abandons idx_kds_orders_status_received for a full scan,
                    // because scanning 400 rows is cheaper than 240 index
                    // seeks. A fixture that models a permanently jammed
                    // kitchen would make this probe grade the fixture.
                    kds_status(i),
                    created_at,
                    Some(format!("seed-zone-{}", i % 4)),
                    if i % 2 == 0 {
                        Some(format!("T{}", i % 20))
                    } else {
                        None
                    },
                    if i % 6 == 0 {
                        None
                    } else {
                        Some("instance-1".to_owned())
                    },
                ],
            )
            .expect("seeding kds_orders");
            tx.execute(
                "INSERT INTO refunds (id, sale_id, total_minor, currency, processed_by, created_at)
                 VALUES (?1, ?2, 500, ?3, ?4, ?5)",
                rusqlite::params![
                    format!("seed-refund-{i}"),
                    sale_id,
                    currency,
                    format!("seed-user-{}", i % 2),
                    created_at,
                ],
            )
            .expect("seeding refunds");
            tx.execute(
                "INSERT INTO refund_lines (id, refund_id, sale_line_id, sku, qty, unit_minor, line_minor,
                                           currency, created_at)
                 VALUES (?1, ?2, ?3, ?4, 1, 500, 500, ?5, ?6)",
                rusqlite::params![
                    format!("seed-refund-line-{i}"),
                    format!("seed-refund-{i}"),
                    format!("seed-line-{i}"),
                    product,
                    currency,
                    created_at,
                ],
            )
            .expect("seeding refund_lines");
            tx.execute(
                "INSERT INTO payments (id, sale_id, method, amount_minor, currency, created_at,
                                       idempotency_key)
                 VALUES (?1, ?2, ?3, 1000, ?4, ?5, ?6)",
                rusqlite::params![
                    format!("seed-payment-{i}"),
                    sale_id,
                    if i % 2 == 0 { "cash" } else { "card" },
                    currency,
                    created_at,
                    format!("seed-idem-{i}"),
                ],
            )
            .expect("seeding payments");
            tx.execute(
                "INSERT INTO product_activity (id, sku, event_type, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    format!("seed-activity-{i}"),
                    product,
                    if i % 2 == 0 { "search" } else { "edit" },
                    created_at,
                ],
            )
            .expect("seeding product_activity");
            tx.execute(
                "INSERT INTO stock_movements (id, item_id, delta, reason, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    format!("seed-movement-{i}"),
                    product,
                    if i % 2 == 0 { 1i64 } else { -1i64 },
                    if i % 7 == 0 { "restock" } else { "sale" },
                    created_at,
                ],
            )
            .expect("seeding stock_movements");
        }
        tx.commit().expect("committing the seed transaction");
    }

    // Without statistics SQLite prices every alternative against defaults and
    // the plan under test is a coin flip - see the module docs.
    conn.execute_batch("ANALYZE")
        .expect("ANALYZE on the seeded database");

    conn
}

/// The `EXPLAIN QUERY PLAN` output for `sql`, one row per plan step, joined
/// with newlines.
///
/// Binding by INDEX because a query built for the product may use either
/// `?1`-style or `:name`-style placeholders; index binds address both in
/// order of appearance, which keeps this helper free of per-query knowledge.
fn plan_for(conn: &Connection, sql: &str, binds: &[&str]) -> Vec<PlanStep> {
    let explain = format!("EXPLAIN QUERY PLAN {sql}");
    let mut stmt = conn
        .prepare(&explain)
        .unwrap_or_else(|e| panic!("preparing the plan failed: {e}\nSQL:\n{sql}"));
    let placeholder_count = stmt.parameter_count();
    assert_eq!(
        placeholder_count,
        binds.len(),
        "the probe binds {bound} value(s) for {placeholder_count} placeholder(s); the query changed shape and the probe's binds must follow it\nSQL:\n{sql}",
        bound = binds.len(),
    );
    // Columns 0 and 1 are the step id and its parent id; 2 is unused; 3 is the
    // human-readable detail. The parent link is what lets a step be attributed
    // to the RIGHT loop - "SCAN X" directly under "CORRELATED SCALAR SUBQUERY"
    // means something different from one at the top level.
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(binds.iter().map(|b| b.to_string())),
            |r| {
                Ok(PlanStep {
                    _id: r.get::<_, i64>(0)?,
                    _parent: r.get::<_, i64>(1)?,
                    detail: r.get::<_, String>(3)?,
                })
            },
        )
        .unwrap_or_else(|e| panic!("running the plan failed: {e}\nSQL:\n{sql}"));
    rows.collect::<Result<Vec<_>, _>>()
        .unwrap_or_else(|e| panic!("reading the plan failed: {e}\nSQL:\n{sql}"))
}

/// Render plan steps as the newline-joined text a reader sees.
fn plan_text(steps: &[PlanStep]) -> String {
    steps
        .iter()
        .map(|s| s.detail.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

/// One row of `EXPLAIN QUERY PLAN`: the planner's own description of a step.
///
/// Only column 3 is kept. Columns 0/1 (step id and parent id) are read while
/// building the vector so the query compiles against the real schema, but no
/// grading rule depends on the tree shape.
struct PlanStep {
    /// The planner's description of this step (column 3).
    detail: String,
    /// Step id (column 0) - part of the plan row, unused by the classifier.
    _id: i64,
    /// Enclosing step id (column 1) - part of the plan row, unused.
    _parent: i64,
}

/// Operations that mean the step's TABLE (not merely its index) is read in
/// full.
///
/// SQLite has TWO spellings and both are the defect this probe grades:
///
/// * `SCAN <alias>` - a full table scan (no index at all);
/// * `SCAN <alias> USING COVERING INDEX <i>` - every column the query needs is
///   in the index, so SQLite walks the WHOLE index and never touches the table.
///   It is still one pass over every row that has ever existed in the table;
///   a narrower walk is not a cheaper ALGORITHM, and the table's growth is
///   still paid in full. The existing in-crate plan test draws the same line
///   in its own words: `SCAN rf1 USING INDEX ...` "is the whole index and NOT
///   the table" is what it DID allow, for a query that also filters by
///   currency - grading it here as a scan would be a false positive on a
///   governed query. This probe is stricter on purpose: it grades the cost of
///   the walk, not which b-tree was walked.
const COVERING_INDEX_MARKER: &str = "USING COVERING INDEX";

/// `SCAN <alias> USING INDEX <i>` - a walk of the whole index WITH table
/// lookups for the columns it does not carry. Not graded: it is the ordering
/// the query asked for, produced without a sort, and the planner only
/// chooses it when the index order matches the `ORDER BY`.
const ORDERED_INDEX_WALK_MARKER: &str = "USING INDEX";

/// A step that reads its SOURCE in full: the source name and the full detail.
///
/// The source is the LHS identifier of a `SCAN` step: an alias, a table name,
/// or a CTE name.
fn full_read_source<'a>(step: &'a PlanStep) -> Option<(&'a str, &'a str)> {
    let detail = step.detail.trim();
    let rest = detail.strip_prefix("SCAN ")?;
    // Split on whitespace AND commas: SQLite writes `SCAN r LEFT-JOIN` and, in a
    // star-join, `SCAN s1, s2`, so the source is the first bare identifier.
    let source = rest.split([' ', ',']).find(|token| !token.is_empty())?;
    Some((source, detail))
}

/// True when the step walks the source WITHOUT an index at all.
fn step_is_a_bare_scan(step: &PlanStep) -> bool {
    full_read_source(step).is_some_and(|(_, detail)| {
        !detail.contains(ORDERED_INDEX_WALK_MARKER) && !detail.contains(COVERING_INDEX_MARKER)
    })
}

/// True when the step walks a COVERING index - every column the query needs is
/// in the index, so SQLite passes over every row of the table (or CTE) without
/// a table lookup.
fn step_is_a_covering_walk(step: &PlanStep) -> bool {
    full_read_source(step).is_some_and(|(_, detail)| detail.contains(COVERING_INDEX_MARKER))
}

/// The table name a plan step names, mapped back through the query's aliases.
///
/// `None` when the source is a CTE, because a `SCAN rg` over a materialised
/// result is a nested loop over rows already computed - it is not a read of
/// any table, and its cost was already paid by the query that BUILT the CTE.
/// `aliases` is the query's own `alias -> table` map; the fallback is the
/// token itself, which is right when there is no alias.
fn resolve_table(token: &str, aliases: &[(&str, &str)], ctes: &[&str]) -> Option<String> {
    // The CTE check comes FIRST, and the order is load-bearing: the revenue
    // CTEs reuse the letter `s` both as a CTE name and as an alias for
    // `sales` inside their own bodies, so an alias-first lookup answered
    // `SCAN s` (a scan of the materialised CTE) with `sales`. Measured: that
    // false positive fired on all three revenue reports at once.
    if ctes.contains(&token) {
        return None;
    }
    if let Some((_, table)) = aliases.iter().find(|(alias, _)| *alias == token) {
        return Some((*table).to_owned());
    }
    Some(token.to_owned())
}

/// Every LARGE table whose table (or whole covering index) the plan passes
/// over, reported as `table (step)`.
///
/// The classifier sits on the SAFE side of every ambiguity: a CTE name is not
/// a table, a `SEARCH` is never a read, and an ordered index walk is not a
/// read. So the cost of a missing alias or a missing CTE name is a MISSED
/// scan, never a false alarm - `forcing_a_scan_fails_the_probe` exists so that
/// being blind in that direction cannot quietly mean finding nothing, ever.
fn scanned_large_tables(
    steps: &[PlanStep],
    aliases: &[(&str, &str)],
    ctes: &[&str],
) -> Vec<String> {
    let mut found: Vec<String> = steps
        .iter()
        .filter(|step| step_is_a_bare_scan(step) || step_is_a_covering_walk(step))
        .filter_map(|step| {
            let (source, detail) = full_read_source(step)?;
            let table = resolve_table(source, aliases, ctes)?;
            LARGE_TABLES
                .contains(&table.as_str())
                .then(|| format!("{table} ({detail})"))
        })
        .collect();
    found.sort();
    found.dedup();
    found
}

/// Indent a plan so it reads as a block inside a failure message.
fn indented(plan: &str) -> String {
    plan.lines()
        .map(|line| format!("      {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// THE GATE. No probed production query may `SCAN` a large table.
///
/// The failure message quotes the offending plan, because the next reader
/// needs to know WHY SQLite chose it, not just that it did.
#[test]
fn production_queries_do_not_scan_large_tables() {
    let conn = seeded_connection();

    // A vacuous probe is the failure mode this file exists to avoid: if the
    // seed did not land, an empty table plans however SQLite likes and every
    // assertion below passes for the wrong reason.
    for table in LARGE_TABLES {
        let rows: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap_or_else(|e| panic!("counting {table} failed: {e}"));
        assert!(
            rows >= SEED_ROWS,
            "{table} holds {rows} rows after seeding, expected {SEED_ROWS}; the seed is incomplete and a plan assertion over it would be vacuous",
        );
    }

    let mut offenders: Vec<String> = Vec::new();
    for probe in PROBES {
        let steps = plan_for(&conn, probe.sql, probe.binds);
        let scanned = scanned_large_tables(&steps, probe.aliases, probe.ctes);
        if !scanned.is_empty() {
            offenders.push(format!(
                "  {name} ({origin})\n    reads in full: {tables}\n    plan:\n{plan}\n",
                name = probe.name,
                origin = probe.origin,
                tables = scanned.join(", "),
                plan = indented(&plan_text(&steps)),
            ));
        }
    }

    assert!(
        offenders.is_empty(),
        "{count} of {total} probed queries SCAN a large table; every row of transaction growth makes them slower:\n\n{body}",
        count = offenders.len(),
        total = PROBES.len(),
        body = offenders.join("\n"),
    );
}

/// FALSIFICATION - the permanent proof that
/// `production_queries_do_not_scan_large_tables` can fail.
///
/// It re-runs a real probe (the daily revenue report, whose refunds CTE is
/// exactly the query this project got wrong once) with every `WHERE`
/// predicate stripped. That is the shape that scans, and the SAME detector
/// the gate uses must name the scanned table. If the detector ever goes deaf
/// - a changed plan-string format, a renamed table, a `LARGE_TABLES` entry
/// dropped - this test fails instead of the gate quietly passing everything.
///
/// The strips are asserted to have actually removed predicates first: on a
/// query with no `WHERE` the mutation would be a no-op and this proof would
/// be as vacuous as the assertions it is meant to defend.
#[test]
fn forcing_a_scan_fails_the_probe() {
    let conn = seeded_connection();

    let probe = PROBES
        .iter()
        .find(|p| p.name == "daily_revenue")
        .expect("the daily_revenue probe is part of PROBES");

    // Baseline: the UNMUTATED query must be clean, otherwise the proof below
    // would be showing a pre-existing defect rather than the mutation.
    let baseline = plan_for(&conn, probe.sql, probe.binds);
    assert!(
        scanned_large_tables(&baseline, probe.aliases, probe.ctes).is_empty(),
        "the daily_revenue probe already scans before mutation, so the falsification below would prove nothing; plan:\n{plan}",
        plan = plan_text(&baseline),
    );

    // Strip the predicates at both levels that matter: the sales CTE's window
    // (top level) and the refunds CTE's window (inside `rg AS (...)`). Both are
    // needed - the refunds scan is the defect this class of check found.
    let mut mutated = String::with_capacity(probe.sql.len());
    let mut removed = 0usize;
    for line in probe.sql.lines() {
        if line.trim_start().starts_with("WHERE ") {
            removed += 1;
            continue;
        }
        mutated.push_str(line);
        mutated.push('\n');
    }
    assert!(
        removed >= 2,
        "stripping WHERE lines removed {removed} predicate(s); the mutation is a no-op, so this falsification proves nothing",
    );

    let forced = plan_for(&conn, &mutated, probe.binds);
    let scanned = scanned_large_tables(&forced, probe.aliases, probe.ctes);
    assert!(
        !scanned.is_empty(),
        "a predicate-free {name} did NOT register as a read of a large table; the detector is blind and the gate cannot fail; forced plan:\n{plan}",
        name = probe.name,
        plan = plan_text(&forced),
    );
}

/// Every COPIED probe's `origin` still resolves: the file it names exists,
/// and the line number is a real line in it.
///
/// A copy is only honest while its anchor is real. This catches the drift that
/// makes a copy worthless: the method moves to another file, the module is
/// split again, and the `keep in sync with ...` comment now names nothing - at
/// which point nobody can tell whether the copy is stale.
///
/// CONSTANT-sourced probes are exempt by construction: the compiler already
/// fails if the constant moves or changes shape.
#[test]
fn copied_query_provenance_is_intact() {
    // `origin` strings are repo-relative, so they are resolved against the
    // WORKSPACE root: the crate manifest directory is `<root>/crates/kasirmu-core`.
    const WORKSPACE_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../");
    let mut broken: Vec<String> = Vec::new();
    for probe in PROBES {
        if probe.origin.contains("CONSTANT") {
            continue;
        }
        let Some((path, line)) = probe.origin.split_once(':') else {
            broken.push(format!(
                "{}: origin {} names no file:line",
                probe.name, probe.origin
            ));
            continue;
        };
        let Ok(line_number) = line.parse::<usize>() else {
            broken.push(format!(
                "{}: origin {} does not end in a line number",
                probe.name, probe.origin
            ));
            continue;
        };
        match std::fs::read_to_string(format!("{WORKSPACE_ROOT}{path}")) {
            Err(e) => broken.push(format!(
                "{}: origin file {path} is unreadable ({e})",
                probe.name
            )),
            Ok(text) => {
                let lines = text.lines().count();
                if line_number == 0 || line_number > lines {
                    broken.push(format!(
                        "{}: origin {path}:{line_number} is past the end of a {lines}-line file",
                        probe.name
                    ));
                }
            }
        }
    }
    assert!(
        broken.is_empty(),
        "copied-query provenance drifted:\n  {}",
        broken.join("\n  ")
    );
}
