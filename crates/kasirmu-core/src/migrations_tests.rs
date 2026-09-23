use super::*;

fn fresh() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON").unwrap();
    conn
}

#[test]
fn first_run_applies_all_migrations() {
    let mut conn = fresh();
    run(&mut conn).unwrap();
    let mut stmt = conn.prepare("SELECT id FROM schema_migrations").unwrap();
    let applied: std::collections::HashSet<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    for mig in ALL {
        assert!(
            applied.contains(mig.id),
            "missing applied entry for {}",
            mig.id
        );
    }
}

#[test]
fn second_run_is_idempotent() {
    let mut conn = fresh();
    run(&mut conn).unwrap();
    run(&mut conn).unwrap();
    let mut stmt = conn.prepare("SELECT id FROM schema_migrations").unwrap();
    let applied: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(applied.len(), ALL.len());
}

#[test]
fn migration_creates_sales_table() {
    let mut conn = fresh();
    run(&mut conn).unwrap();
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sales'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(exists, 1, "expected `sales` table after migration");
}

#[test]
fn all_migrations_have_ids() {
    for mig in ALL {
        assert!(!mig.id.is_empty(), "migration id must not be empty");
        assert!(
            mig.id.ends_with(".sql"),
            "migration id should end with .sql"
        );
    }
}

#[test]
fn all_migrations_have_sql_content() {
    for mig in ALL {
        assert!(!mig.sql.is_empty(), "migration {} has empty SQL", mig.id);
    }
}

#[test]
fn all_migration_ids_are_unique() {
    let mut ids: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for mig in ALL {
        assert!(ids.insert(mig.id), "duplicate migration id: {}", mig.id);
    }
}

#[test]
fn fresh_install_and_upgrade_path_produce_identical_schema() {
    // RUST-09/RUST-10: applying all migrations to an empty DB (fresh
    // install) must yield the same schema as applying a prefix of the
    // registry and then upgrading through the remainder (an upgrade from
    // an older release). Compare the full table/column/index surface.
    fn schema_fingerprint(
        conn: &rusqlite::Connection,
    ) -> std::collections::BTreeMap<String, Vec<String>> {
        let mut tables: std::collections::BTreeMap<String, Vec<String>> =
            std::collections::BTreeMap::new();
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .unwrap();
        let names: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        drop(stmt);
        for name in names {
            let mut cols: Vec<String> = Vec::new();
            let mut cstmt = conn
                .prepare(&format!("PRAGMA table_info(\"{name}\")"))
                .unwrap();
            let rows = cstmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, Option<String>>(4)?,
                        r.get::<_, i64>(5)?,
                    ))
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            for (cid, ctype, notnull, dflt, pk) in rows {
                cols.push(format!("{cid}|{ctype}|{notnull}|{dflt:?}|{pk}"));
            }
            tables.insert(name, cols);
        }
        tables
    }

    // Fresh install: run every migration in one pass.
    let mut fresh_conn = fresh();
    run(&mut fresh_conn).unwrap();
    let fresh_schema = schema_fingerprint(&fresh_conn);

    // Upgrade path: apply a prefix of the registry (a plausible older
    // release), then the remainder through the same runner. The
    // consolidated registry holds one migration, so the prefix is empty
    // — mirroring a pre-reset database whose old IDs are no longer
    // tracked — but the split generalizes as migrations are added again.
    let split = ALL.len() / 2;
    let mut upgrade_conn = fresh();
    platform_core::database::run(&mut upgrade_conn, &ALL[..split]).unwrap();
    platform_core::database::run(&mut upgrade_conn, &ALL[split..]).unwrap();
    let upgrade_schema = schema_fingerprint(&upgrade_conn);

    assert_eq!(
        fresh_schema, upgrade_schema,
        "fresh install and upgrade path diverged — schema drift (RUST-09/RUST-10)"
    );
}

/// The checksum the runner stored for one migration.
fn stored_checksum(conn: &rusqlite::Connection, id: &str) -> String {
    conn.query_row(
        "SELECT checksum FROM schema_migrations WHERE id = ?1",
        [id],
        |row| row.get(0),
    )
    .unwrap()
}

/// A comment-only edit to any registered migration must be detected as drift
/// and then re-apply cleanly (DB-02).
///
/// Editing a migration's comments changes its checksum but not its executable
/// SQL. The runner responds by re-applying the script — which, until the
/// statement-level fallback landed, ran the whole script in one batch and so
/// required every statement to be idempotent. SQLite cannot satisfy that for
/// `ALTER TABLE … ADD COLUMN` (no `IF NOT EXISTS` form; 26 of the 58
/// registered migrations use it), so a comment-only edit to any of those files
/// panicked startup with `duplicate column name` even though the schema was
/// already correct.
///
/// The test also asserts the drift was *detected*, because a sweep that
/// silently skipped the drift path would pass without proving anything — a
/// fresh database has no stored checksum, so the commented script is simply
/// applied as new and the fallback is never reached.
#[test]
fn cosmetic_edit_to_any_migration_re_applies_cleanly() {
    // Migrations that cannot be re-applied at all, because they consume the
    // state they transform: one converts a column and then drops the source
    // column, one renames tables and columns, one rebuilds a table while
    // copying a column out of the definition it replaces. Re-running them is
    // impossible by construction, and the repo documents that class as
    // requiring a backup-plus-forward-repair procedure rather than a re-apply
    // (DB-03, see the forward-only contract in `migrations.rs`).
    //
    // Listed so the residual stays explicit and measured: if one of these
    // starts passing, or a migration joins the list, this test fails and the
    // list has to be revisited.
    const NOT_REAPPLIABLE: &[&str] = &[
        "20260831_loyalty_multiplier_fixedpoint.sql",
        "20260906_rename_store_to_location.sql",
        "20260913_memo_locations.sql",
    ];

    // Built once: every iteration must compare the same bytes against the
    // checksum the prefix apply stored.
    let commented: Vec<&'static str> = ALL
        .iter()
        .map(|mig| {
            Box::leak(format!("{}\n-- cosmetic drift probe\n", mig.sql).into_boxed_str())
                as &'static str
        })
        .collect();

    let mut not_reappliable: Vec<String> = Vec::new();
    for index in 0..ALL.len() {
        let id = ALL[index].id;
        // Applying the prefix and then editing its last entry reproduces the
        // real sequence: the migration was applied, and its file was edited
        // afterwards.
        let prefix = &ALL[..=index];
        let drifted: Vec<platform_core::database::Migration> = prefix
            .iter()
            .enumerate()
            .map(|(position, mig)| platform_core::database::Migration {
                id: mig.id,
                // Only the last entry is edited; every earlier one keeps the
                // SQL whose checksum the prefix apply stored, so it is not
                // dragged into the drift path as well.
                sql: if position == index {
                    commented[position]
                } else {
                    mig.sql
                },
            })
            .collect();

        let mut conn = fresh();
        platform_core::database::run(&mut conn, prefix)
            .unwrap_or_else(|err| panic!("applying the prefix up to {id} failed: {err}"));
        let before = stored_checksum(&conn, id);

        match platform_core::database::run(&mut conn, &drifted) {
            Ok(()) => assert_ne!(
                before,
                stored_checksum(&conn, id),
                "the comment-only edit to {id} was not detected as drift — \
                 the re-apply path was skipped, so this case proves nothing"
            ),
            Err(err) => {
                assert!(
                    NOT_REAPPLIABLE.contains(&id),
                    "a comment-only edit to {id} failed the drift re-apply, and it is not a \
                     known one-shot migration: {err}"
                );
                not_reappliable.push(id.to_string());
            }
        }
    }

    assert_eq!(
        not_reappliable, NOT_REAPPLIABLE,
        "the set of migrations that cannot survive a comment-only edit changed"
    );
}

/// An **earlier** migration must still re-apply after **later** ones have moved
/// the schema on.
///
/// The sweep above applies a *prefix* and edits only its last entry, so it can
/// only ever re-apply a migration against the schema that existed when that
/// migration first ran. It cannot express the case where a migration is
/// re-applied long after later migrations changed the tables it touches —
/// which is what drift on an already-applied old migration actually does.
///
/// `20260909_memos.sql` was that case and it panicked startup. It created
/// `idx_memos_location ON memos(location_id)`; `20260913_memo_locations.sql`
/// later drops that column, moving targeting to the `memo_locations` join
/// table. Re-running 20260909 once 20260913 was applied failed with
/// `no such column: location_id` — and because that is not a *duplicate-object*
/// error, DB-02's statement-level fallback never engaged, so the failure was
/// fatal rather than skipped. The index is now created by
/// `20260911_memo_fk_restrict.sql` instead.
#[test]
fn earlier_migration_re_applies_after_later_ones_move_the_schema() {
    const EARLIER: &str = "20260909_memos.sql";
    assert!(
        ALL.iter().any(|mig| mig.id == EARLIER),
        "{EARLIER} is no longer in the registry — update this test's subject"
    );

    let mut conn = fresh();
    platform_core::database::run(&mut conn, ALL)
        .unwrap_or_else(|err| panic!("applying the full registry failed: {err}"));

    // Only the earlier entry is edited. Every later one keeps the SQL whose
    // checksum the full apply stored, so the re-apply is the only thing that
    // runs — and it runs against the *current* schema, not the historical one.
    let drifted: Vec<platform_core::database::Migration> = ALL
        .iter()
        .map(|mig| platform_core::database::Migration {
            id: mig.id,
            sql: if mig.id == EARLIER {
                Box::leak(format!("{}\n-- cosmetic drift probe\n", mig.sql).into_boxed_str())
                    as &'static str
            } else {
                mig.sql
            },
        })
        .collect();

    let before = stored_checksum(&conn, EARLIER);
    platform_core::database::run(&mut conn, &drifted).unwrap_or_else(|err| {
        panic!(
            "re-applying {EARLIER} after the whole registry had been applied failed: {err}. \
             An earlier migration must stay re-appliable once later ones have moved the schema."
        )
    });
    assert_ne!(
        before,
        stored_checksum(&conn, EARLIER),
        "the edit to {EARLIER} was not detected as drift — the re-apply path was skipped, \
         so this case proves nothing"
    );
}

/// COMPLIANCE: every registered migration must survive a drift re-apply against
/// the *final* schema, not only the schema it was born into.
///
/// `cosmetic_edit_to_any_migration_re_applies_cleanly` re-applies a migration
/// against the state right after it ran, and the test above pins one subject.
/// Neither could catch the class that bricked `kasirmu-app` at startup on
/// 21-09-26: `20260813_init.sql` drifted (ADR #56 §2.6 edited it in place), and
/// the re-apply died on the loyalty seed, which names the column
/// `20260831_loyalty_multiplier_fixedpoint.sql` drops — no gate exercised the
/// drift path of every migration against a *fully migrated* database, so the
/// failure surfaced on a merchant's machine instead of here. The init-specific
/// test below pins that incident's exact checksum; this sweep is the general
/// property.
///
/// For every entry the sweep applies the whole registry, edits one entry
/// (comment-only — enough to trigger the checksum drift), and requires the
/// re-apply to succeed. The set that cannot is measured and explicit. A new
/// failure here means the edited migration's statements no longer replay against
/// the final schema: fix the statement (make it idempotent, or move it into the
/// migration that replaces the object it names, as `20260911_memo_fk_restrict.sql`
/// did), or list the migration below with the DB-03 justification for why
/// re-running it is impossible by construction.
#[test]
fn every_migration_re_applies_against_the_final_schema() {
    // Measured over the registry, not assumed. Each entry is a one-shot
    // data/rename migration whose script consumes the state it transforms:
    // `20260831_loyalty_multiplier_fixedpoint.sql` converts a column and then
    // drops the source it reads, `20260906_rename_store_to_location.sql`
    // renames the tables it reads, `20260911_memo_fk_restrict.sql` rebuilds
    // `memos` reading `location_id` — which its successor
    // `20260913_memo_locations.sql` then drops — and `20260913` itself rebuilds
    // a table out of a definition it replaces. The forward-only contract (DB-03,
    // `platform/core/src/database/migrations.rs`) already assigns that class to
    // backup-plus-forward-repair rather than re-apply. A migration joining or
    // leaving this list changes the assert below, so the residual stays
    // explicit and measured.
    //
    // The prefix sweep's residual (`cosmetic_edit_to_any_migration_re_applies_cleanly`)
    // is one entry SHORTER than this one: it re-applies `20260911` against the
    // schema as of `20260911`, where `location_id` still exists. This sweep is
    // the stronger property — replayable against the *final* schema — and the
    // two lists must not be conflated.
    const NOT_REAPPLIABLE_AGAINST_FINAL_SCHEMA: &[&str] = &[
        "20260831_loyalty_multiplier_fixedpoint.sql",
        "20260906_rename_store_to_location.sql",
        "20260911_memo_fk_restrict.sql",
        "20260913_memo_locations.sql",
    ];

    let mut not_reappliable: Vec<String> = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    for (index, entry) in ALL.iter().enumerate() {
        let id = entry.id;
        // Only the entry under test is edited; every other one keeps the SQL
        // whose checksum the full apply stored, so it is not dragged into the
        // drift path as well.
        let drifted: Vec<platform_core::database::Migration> = ALL
            .iter()
            .enumerate()
            .map(|(position, mig)| platform_core::database::Migration {
                id: mig.id,
                sql: if position == index {
                    Box::leak(format!("{}\n-- cosmetic drift probe\n", mig.sql).into_boxed_str())
                        as &'static str
                } else {
                    mig.sql
                },
            })
            .collect();

        let mut conn = fresh();
        // The whole registry first: the re-apply below runs against the *final*
        // schema, exactly as it does for a database whose init script drifted.
        platform_core::database::run(&mut conn, ALL)
            .unwrap_or_else(|err| panic!("applying the full registry failed: {err}"));

        let before = stored_checksum(&conn, id);
        match platform_core::database::run(&mut conn, &drifted) {
            Ok(()) => {
                assert_ne!(
                    before,
                    stored_checksum(&conn, id),
                    "the cosmetic edit to {id} was not detected as drift — the re-apply path \
                     was skipped, so this sweep proves nothing for it"
                );
            }
            Err(err) => {
                not_reappliable.push(id.to_string());
                failures.push(format!("{id}: {err}"));
            }
        }
    }

    // One verdict over the whole registry, so a change to the residual reports
    // the full diff in a single failure instead of one migration at a time.
    // A migration MISSING from the list now fails: fix the statement (make it
    // idempotent, or move it into the migration that replaces the object it
    // names, as `20260911_memo_fk_restrict.sql` did), or add it with the DB-03
    // justification. One PRESENT but now passing should be removed.
    assert_eq!(
        not_reappliable,
        NOT_REAPPLIABLE_AGAINST_FINAL_SCHEMA,
        "the set of migrations that cannot survive drift against the final schema changed. \
         Failures:\n{}",
        failures.join("\n")
    );
}

/// The frozen init script must stay re-appliable after a later migration has
/// replaced a column it seeds.
///
/// `20260813_init.sql` seeds the four loyalty tiers with `INSERT OR IGNORE INTO
/// loyalty_tiers (…, earn_multiplier, …)`, and
/// `20260831_loyalty_multiplier_fixedpoint.sql` later converts that column to
/// `earn_multiplier_millionths` and **drops** it. Re-applying the init script
/// against a database that has the whole registry applied therefore fails with
/// `table loyalty_tiers has no column named earn_multiplier` — and because that
/// is not a *duplicate-object* error, DB-02's statement-level fallback never
/// engaged, so the failure was fatal: `kasirmu-app` panicked in its setup hook
/// (`Failed to setup app: … running migrations: … has no column named
/// earn_multiplier`) and could not start.
///
/// Reproduced the way it actually happens rather than by editing a file: the
/// database keeps the checksum of the init script it was *installed* with,
/// while the registry carries today's content. An in-place edit to the init
/// file is what puts every existing database on this path — ADR #56 §2.6
/// option C removed the seeded store, workspaces and subscription, so the drift
/// is real rather than cosmetic.
#[test]
fn init_script_re_applies_after_a_later_migration_replaces_its_seed_column() {
    /// The checksum every database created before the ADR #56 §2.6 in-place
    /// edit carries for the init script. Measured from the repository, not
    /// guessed: it is the blob at `11a6d27cd`, the last revision that changed
    /// the file before §2.6.
    const PRE_ADR56_INIT_CHECKSUM: &str =
        "f86bbbe00608dbd6f6a3cb40a82ee01be69d730763a51349adad92cffc78c013";
    const INIT: &str = "20260813_init.sql";

    let mut conn = fresh();
    run(&mut conn).unwrap_or_else(|err| panic!("applying the full registry failed: {err}"));

    // Precondition, asserted rather than assumed: the drift must be real, or
    // this test proves nothing. If the init script is ever restored to the
    // pre-ADR-56 bytes, fail here instead of passing vacuously.
    let installed = stored_checksum(&conn, INIT);
    assert_ne!(
        installed, PRE_ADR56_INIT_CHECKSUM,
        "the init script is back to the pre-ADR-56 bytes, so this test no longer \
         exercises the drift path — retire it or pick a new subject"
    );

    // Every later migration keeps the checksum its own apply stored, so the
    // init script is the only entry on the drift path.
    conn.execute(
        "UPDATE schema_migrations SET checksum = ?1 WHERE id = ?2",
        rusqlite::params![PRE_ADR56_INIT_CHECKSUM, INIT],
    )
    .unwrap();

    platform_core::database::run(&mut conn, ALL).unwrap_or_else(|err| {
        panic!(
            "re-applying {INIT} against a fully migrated database failed: {err}. An existing \
             database must survive drift in the init script, not panic in the setup hook."
        )
    });
    assert_eq!(
        stored_checksum(&conn, INIT),
        installed,
        "the drift re-apply did not patch the stored checksum"
    );
}

#[test]
fn migrations_create_expected_tables() {
    let mut conn = fresh();
    run(&mut conn).unwrap();

    let expected_tables = [
        "sales",
        "sale_lines",
        "products",
        "categories",
        "inventory",
        "settings",
        "customers",
        "currencies",
        "exchange_rates",
        "tax_rates",
        "audit_log",
        "users",
        "roles",
        "offline_queue",
        "refunds",
        "refund_lines",
        "terminals",
        "product_taxes",
        "held_carts",
        "product_variants",
        "product_recipes",
        "modifier_groups",
        "modifiers",
        "product_modifier_groups",
        "category_taxes",
        "payments",
        "cash_payouts",
        "locations",
        "terminal_feature_overrides",
        "promotions",
        "promotion_applications",
        "loyalty_tiers",
        "loyalty_accounts",
        "loyalty_transactions",
        "gift_cards",
        "gift_card_transactions",
        "suppliers",
        "stock_counts",
        "stock_count_lines",
        "stock_adjustments",
        "purchase_orders",
        "purchase_order_lines",
        "stock_transfers",
        "stock_transfer_lines",
        "terminal_profiles",
        "kds_orders",
        "kds_daily_counters",
        "active_carts",
        "tables",
        "workspaces",
        "workspace_screens",
        "role_workspaces",
        "user_workspaces",
        "workspace_types",
        "workspace_type_screens",
        "workspace_instances",
        "user_workspace_instances",
        "role_workspace_types",
        "login_attempts",
        "user_location_access",
        "legal_entities",
        // ── ADR #18 Phase 1+2 (migrations 078-090) ──
        "inventory_locations",
        "workspace_inventory_locations",
        "inventory_transactions",
        "inventory_transaction_lines",
        "inventory_shifts",
        "stock_thresholds",
        "stock_alert_events",
        // ── ADR #19 Phase 3 (migrations 093-094) ──
        // 093 adds deduction_locations column to sales (no new table).
        // 094 adds deduction_location_id + location_override_at to active_carts (no new table).
        // ── ADR #22 Phase 0d (migration 100) ──
        "setting_updated",
        // ── audit-open-findings SYNC-01 (migration 114) ──
        "sync_pull_state",
        "sync_applied_items",
        "sync_remote_failures",
        // ── ADR #35 D5 (migration 128) ──
        "assignments",
        "assignment_branches",
        "assignment_workspaces",
        // ── Spec 0046b (migration 20260901_product_images) ──
        "product_images",
        // ── Spec 0046b cloud sync (migration 20260901_image_refs) ──
        "image_refs",
        "image_push_queue",
        // ── Accounts Payable / Hutang (migration 20260918_payables) ──
        "payables",
        "payable_payments",
    ];

    for table in &expected_tables {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                rusqlite::params![table],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            exists, 1,
            "expected table `{table}` to exist after migration"
        );
    }
}

/// Count rows matching an arbitrary scalar SQL query.
fn row_count(conn: &rusqlite::Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap()
}

/// Pin the bootstrap seed rows a fresh install depends on. The reset
/// collapsed 131 migrations into one `init.sql`; the original failure mode
/// was that the schema dumped fine but the seed INSERTs were dropped, so
/// domain FK targets such as `workspaces.key = 'retail-pos'` had nothing
/// to reference. This fails if any essential lookup row is removed or renamed.
#[test]
fn seed_data_bootstraps_essential_rows() {
    let mut conn = fresh();
    run(&mut conn).unwrap();

    // Currencies (ISO-4217 lookups).
    for code in ["USD", "IDR"] {
        assert_eq!(
            row_count(
                &conn,
                &format!("SELECT COUNT(*) FROM currencies WHERE code = '{code}'"),
            ),
            1,
            "missing currency seed {code}"
        );
    }

    // ADR #56 §2.6: the 'Default Store' location is NO LONGER seeded, and this
    // assertion was inverted to keep the guarantee rather than the row. A
    // store with no merchant should have no location, so the baseline now
    // ships an EMPTY locations table and provision_device creates the row.
    // The assertion is what stops the fiction creeping back.
    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM locations",),
        0,
        "the baseline must not seed a location for a merchant who does not exist"
    );

    // Loyalty tiers.
    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM loyalty_tiers"),
        4,
        "loyalty tier seeds must survive"
    );

    // Workspaces — `retail-pos` is the legacy cashier workspace that the
    // assignment tests reference by FK.
    for key in [
        "restaurant-pos",
        "store-pos",
        "warehouse",
        "admin",
        "kds",
        "retail-pos",
    ] {
        assert_eq!(
            row_count(
                &conn,
                &format!("SELECT COUNT(*) FROM workspaces WHERE key = '{key}'"),
            ),
            1,
            "missing workspace seed {key}"
        );
    }

    // Workspace types — the lookup rows genuine fixtures need (`workspaces`
    // keys stay pinned in the loop above). The five default *instances* are
    // NOT asserted: ADR #56 §2.6 removed them, and the empty-locations
    // assertion above is what stops the fiction creeping back. A store with
    // no merchant should have no workspaces; provision_device creates them.
    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM workspace_types"),
        6,
        "workspace type seeds must survive"
    );
    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM workspace_instances"),
        0,
        "the baseline must not seed workspace instances for a merchant who does not exist"
    );

    // Navigation screens (workspace + type).
    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM workspace_screens"),
        30,
        "workspace screen seeds must survive"
    );
    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM workspace_type_screens"),
        36,
        "workspace type screen seeds must survive"
    );

    // ADR #56 §2.6: the BOOTSTRAP_FREE subscription row is NO LONGER seeded.
    // A provisioned terminal gets a real signed subscription; an unprovisioned
    // one has no subscription row to verify. An INVERTED assertion keeps the
    // guarantee (no fiction ships) rather than the row.
    assert_eq!(
        row_count(
            &conn,
            "SELECT COUNT(*) FROM tenant_subscription WHERE tenant_id = 'default'",
        ),
        0,
        "the baseline must not seed a sentinel subscription the verifier rejects"
    );
    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM inventory_locations"),
        2,
        "inventory location seeds must survive"
    );
}

/// Pin the consolidated schema surface: 106 tables, 147 indexes (123 in
/// init plus the two per-tenant unique indexes from
/// `20260815_tenant_unique_indexes.sql` plus 4 multi-KDS indexes from
/// `20260820_kds_devices.sql` plus 4 media/EDC indexes from
/// `20260824_media_edc.sql` plus 3 payment indexes from
/// `20260825_payment_infra.sql` plus 2 product-image indexes from
/// `20260901_product_images.sql` plus 1 image-refs index from
/// `20260901_image_refs.sql` plus 1 gift-card redeem idempotency
/// index from `20260901_gift_card_redeem_idempotency.sql` plus 1
/// outbox index from `20260902_outbox.sql` plus 1 webhook-tenant index
/// from `20260903_webhook_endpoints.sql`, plus the legal-entity table and
/// location index from `20260908_legal_entities.sql` — the per-migration breakdown
/// predates the fixed-point rebuild's expression indexes and no longer
/// sums exactly; the total is the contract), 4
/// triggers. (The generated
/// `*.pg.sql` Postgres port is excluded — see
/// [`pg_init_declares_same_table_surface_as_sqlite`].) A count assertion catches a table/index/trigger silently
/// dropping out of `init.sql` — something a name-list check misses when a
/// name changes.
#[test]
fn init_sql_creates_complete_schema_surface() {
    let mut conn = fresh();
    run(&mut conn).unwrap();

    // All migrations applied (init + incremental) yield 117 tables,
    // excluding the runner's `schema_migrations` bookkeeping table.
    // (20260918_payables.sql added the 112th and 113th: payables +
    // payable_payments; 20260922_over_quota_markers.sql added the 114th:
    // over_quota_markers; 20260923_fiscal_numbering.sql added the 115th
    // and 116th: fiscal_schemes + document_number_sequences;
    // 20260924_local_payment_methods.sql added the 117th;
    // 20260925_receipt_formats.sql added the 118th;
    // 20261001_sale_idempotency.sql added the 119th (the Idempotency-Key
    // receipt table for POST /api/v1/sales); 20261002_sync_conflicts.sql
    // and 20261003_sync_entity_vectors.sql are the 120th and 121st. The
    // sync-crdt lane shipped both tables without re-measuring this pin —
    // nothing saw it because dev-ci runs only on pull_request while work
    // lands directly on `0.0.37` (re-pinned by 25dfa46596). This lane's own
    // 20261004_midtrans_transactions.sql is the 122nd, and
    // 20261005_kds_routing_rules.sql — the multi-station KDS routing table,
    // one per terminal, the pin the routing lane shipped without
    // re-measuring — is the 123rd; this assert is where that omission
    // surfaced. 20261006_receipt_hierarchy_code.sql adds the 124th–126th:
    // entity_index_cursors, entity_index_tombstones and
    // receipt_number_counters. 20261007_provisioning.sql adds the 127th:
    // the per-terminal first-run record (ADR #56 §2.1). Count measured, not
    // guessed: the whole
    // registry was replayed through sqlite3 and sqlite_master counted.
    assert_eq!(
        row_count(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'",
        ),
        127,
        "table surface drifted"
    );
    assert_eq!(
        row_count(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'",
        ),
        // 1 terminals-tenant index from `20260912_terminals_tenant.sql` plus
        // 2 memo-locations indexes (location + tenant) from
        // `20260913_memo_locations.sql`, minus the dropped single-location
        // index `idx_memos_location`, plus the partial retention-sweep index
        // `idx_topology_revisions_unpinned` from
        // `20260915_topology_revisions.sql`, plus the assignment-scope index
        // `idx_assignments_scope` from `20260916_role_assignment_scopes.sql`,
        // plus the 5 payables / payable-payments indexes from
        // `20260918_payables.sql` (tenant+status, supplier, partial due-date,
        // payments-by-payable, payments-by-tenant), on top of the previously
        // pinned 155; plus the 2 partial scope indexes from
        // `20260921_tax_rate_scoping.sql` (location, entity — both partial, so
        // neither indexes the constant NULL that every pre-scoping row carries),
        // plus the 3 over_quota_markers indexes (dimension, resource, tenant)
        // from 20260922_over_quota_markers.sql, plus the fiscal-scheme lookup
        // index `idx_fiscal_schemes_entity` from
        // `20260923_fiscal_numbering.sql`, plus the scope lookup index
        // `idx_local_payment_methods_scope` from
        // `20260924_local_payment_methods.sql`, plus the scope lookup index
        // `idx_receipt_formats_scope` from
        // `20260925_receipt_formats.sql`, plus the 3 per-tier default indexes
        // from `20260926_tax_rate_scoped_authoring.sql` minus the table-wide
        // `idx_tax_rates_single_default` it drops (that one refused a second
        // default row across EVERY tenant and tier, which stops being the rule
        // once scope exists) — net +2. (The document_number_sequences
        // and local_payment_methods UNIQUE constraints are NOT counted: SQLite
        // names those indexes `sqlite_autoindex_*` and the query excludes that
        // prefix.) Plus the tenant-keyed partial unique index
        // `idx_locations_tenant_ticket_prefix` from
        // `20260926_location_ticket_prefix.sql` — +1; its WHERE clause keeps
        // the all-empty backfill out of the index entirely. Plus the 2 named
        // indexes from `20261001_sale_idempotency.sql` —
        // `idx_sale_idempotency_tenant_key` (the UNIQUE (tenant_id, key) slot
        // that carries the guard, UNIQUE-in-an-index rather than a composite
        // PRIMARY KEY so a NULL key stays storable for unguarded sales) and
        // `idx_sale_idempotency_sale` — +2. Then the sync-crdt lane added
        // three more without re-measuring (20261002_sync_conflicts.sql and
        // 20261003_sync_entity_vectors.sql — red unobserved because CI runs
        // only on PRs), and 20261004_midtrans_transactions.sql adds the
        // tenant-lookup index `idx_midtrans_transactions_tenant`.
        // 20261005_kds_routing_rules.sql moves this count by exactly zero,
        // by design: the file states the rule set is O(tens) rows per
        // terminal read only by restaurant_pos_id and ships no secondary
        // index, and its TEXT PRIMARY KEY lands as a `sqlite_autoindex_*`
        // this query excludes. Count
        // measured by replaying the registry, as ever.
        // 20261006_receipt_hierarchy_code.sql adds four: the per-tenant
        // index_id uniques on locations/terminals/users and the
        // (tenant_id, display_code) backstop on sales. Its three composite
        // PRIMARY KEYs land as sqlite_autoindex_*, which this query
        // excludes.
        // 20261007_provisioning.sql adds one: idx_provisioning_tenant, the
        // lookup behind the boot gate and provision_device's idempotency
        // guard. Its TEXT PRIMARY KEY lands as sqlite_autoindex_*, excluded
        // here as ever.
        // 20261009_staff_trash.sql adds one: idx_users_trash, the partial
        // index behind the trash listing and the 90-day retention sweep. It is
        // partial (deleted_at IS NOT NULL), so it holds trashed rows only and
        // the live roster pays nothing for it. That file's two ADD COLUMNs move
        // no index count at all.
        // 20261010_role_trash.sql moves this count by zero: it deliberately
        // ships no index (see its header).
        // 20261007_sync_origin_and_effect_key.sql adds one:
        // idx_sync_applied_items_effect_key, the PARTIAL unique index
        // (effect_key IS NOT NULL) that makes a sync receipt per-EFFECT rather
        // than per-item. Partial is the point, not a refinement: every
        // pre-existing row carries a NULL effect_key, and a table-wide unique
        // index would let the first NULL pass and collide every one after it,
        // so the existing ledger could no longer grow. That file's two ADD
        // COLUMNs move no index count at all.
        // 20261011_open_shift_uniqueness.sql adds one: idx_shifts_open_per_user,
        // the PARTIAL unique index on shifts(user_id) WHERE status='open' that
        // moves the open-shift invariant from open_shift's own transaction
        // (4518a2b8) to the schema. Partial is the point: a user accumulates one
        // closed shift per day forever, so a table-wide UNIQUE(user_id) would
        // refuse the second day's shift, while closed rows leave this index
        // entirely. It mirrors idx_inv_shifts_active_per_user_location, which
        // has guarded inventory_shifts the same way since the init schema. That
        // file ships no table and no trigger, so the other two pins stand.
        189,
        "index surface drifted"
    );
    assert_eq!(
        row_count(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'"
        ),
        // 2 trigger pairs (audit + per-tenant-unique) predate the pin; the
        // assignment scope-id pair triggers (insert + update) arrive with
        // `20260916_role_assignment_scopes.sql`. Nothing since: the
        // 20261002–20261005 tables (sync, midtrans, KDS routing) are plain
        // CREATE TABLE/INDEX DDL — no trigger shipped with them.
        // 20261012_stock_summary_qty_nonnegative.sql adds the third pair, +2:
        // `stock_summary_qty_nonnegative_insert` and
        // `..._update`, the CONDITIONAL negative-stock backstop (D11). It is a
        // trigger rather than a CHECK because the flag it defers to lives on
        // `workspace_inventory_locations` and is keyed by location — a
        // cross-row predicate no table CHECK can express. Both arms are
        // needed: the `INSERT ... ON CONFLICT DO UPDATE` shape both writers
        // use fires only the UPDATE arm once the row exists. That file adds no
        // table and no index, so the other two pins stand.
        8,
        "trigger surface drifted"
    );
}

/// The analytics report queries filter `status = 'completed'` plus
/// `DATE(created_at) BETWEEN …`, which the plain `idx_sales_created_at`
/// cannot serve (the cast defeats it). `idx_sales_status_created_date` is
/// the expression index built for exactly that shape — prove the SQLite
/// planner actually picks it, so a future query rewrite that silently
/// stops matching (e.g. `strftime` instead of `date()`) fails here.
#[test]
fn analytics_query_uses_status_created_date_index() {
    let mut conn = fresh();
    run(&mut conn).unwrap();

    let mut stmt = conn
        .prepare(
            "EXPLAIN QUERY PLAN
             SELECT DATE(s.created_at) AS date, SUM(s.total_minor) AS total_minor
               FROM sales s
              WHERE s.status = 'completed'
                AND DATE(s.created_at) BETWEEN ?1 AND ?2
              GROUP BY DATE(s.created_at)",
        )
        .unwrap();
    let plan = stmt
        .query_map(["2026-01-01", "2026-12-31"], |r| r.get::<_, String>(3))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
        .join("\n");

    assert!(
        plan.contains("idx_sales_status_created_date"),
        "analytics query did not use idx_sales_status_created_date; plan:\n{plan}"
    );
    // And it must NOT fall back to the plain created_at index, which the
    // cast defeats — the whole point of the expression index.
    assert!(
        !plan.contains("idx_sales_created_at"),
        "analytics query fell back to idx_sales_created_at; plan:\n{plan}"
    );
}

/// Simulate the documented existing-dev-DB upgrade path. A pre-reset
/// database carries legacy `schema_migrations` rows (now absent from the
/// registry) and has already been seeded. Running the incremental
/// migrations must ignore the old IDs, leave existing schema + seed rows
/// untouched (`IF NOT EXISTS` / `INSERT OR IGNORE`), and record every
/// registry migration exactly once.
#[test]
fn existing_db_with_legacy_rows_upgrades_idempotently() {
    /// A pre-reset DB carries this tracking row for a migration the registry no
    /// longer lists — the runner must ignore it, not error. Named once because
    /// it seeds the expectation below as well.
    const LEGACY_ROW: &str = "001_sales.sql";

    let mut conn = fresh();
    run(&mut conn).unwrap();

    conn.execute(
        "INSERT INTO schema_migrations (id, checksum) VALUES (?1, NULL)",
        [LEGACY_ROW],
    )
    .unwrap();

    // User data that must survive the upgrade untouched.
    conn.execute(
        "INSERT INTO locations (id, name) VALUES ('store-x', 'Store X')",
        [],
    )
    .unwrap();

    let tiers_before = row_count(&conn, "SELECT COUNT(*) FROM loyalty_tiers");
    let screens_before = row_count(&conn, "SELECT COUNT(*) FROM workspace_screens");

    // Boot the new code against the existing DB.
    run(&mut conn).unwrap();

    // The legacy row is ignored (still present) and the registry is recorded
    // exactly once — the two coexist. The expectation is **derived from the
    // registry** rather than spelled out: the property under test is that the
    // runner recorded exactly the registry plus that one unrecognised row, once
    // each, and a literal list made every new migration fail this test for a
    // reason that has nothing to do with the upgrade path
    // (`20261008_provisioning_legacy_backfill.sql` did precisely that). Which
    // migrations *exist* is pinned absolutely by
    // `no_registered_migration_ever_disappears` and the list it owns — NOT by
    // `migration_registry_matches_filesystem`, which cannot see a migration that
    // was deleted from the registry and the filesystem together.
    let mut expected: Vec<String> = ALL.iter().map(|mig| mig.id.to_string()).collect();
    expected.push(LEGACY_ROW.to_string());
    // `ORDER BY id` and `Vec<String>` both order by UTF-8 bytes, so the two
    // sequences are comparable without a second pass.
    expected.sort();
    let ids: Vec<String> = conn
        .prepare("SELECT id FROM schema_migrations ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(
        ids, expected,
        "the runner recorded something other than the registry plus the legacy row, \
         or recorded a migration more than once"
    );

    // INSERT OR IGNORE means the re-run did not duplicate seed rows.
    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM loyalty_tiers"),
        tiers_before,
        "seed rows must not be duplicated on upgrade"
    );
    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM workspace_screens"),
        screens_before,
        "screen seed rows must not be duplicated on upgrade"
    );

    // User data survived.
    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM locations WHERE id = 'store-x'"),
        1,
        "user data must survive the upgrade"
    );

    // Schema surface is unchanged after the no-op re-run (123 tables: the
    // 111 pinned before 20260918, plus payables and payable_payments from
    // 20260918, plus over_quota_markers from 20260922, plus fiscal_schemes
    // and document_number_sequences from 20260923, plus
    // local_payment_methods from 20260924, plus receipt_formats from
    // 20260925, plus sale_idempotency from
    // 20261001, plus sync_conflicts from 20261002, plus sync_entity_vectors
    // from 20261003, plus midtrans_transactions from 20261004, plus
    // kds_routing_rules from 20261005, plus entity_index_cursors,
    // entity_index_tombstones and receipt_number_counters from
    // 20261006, plus provisioning from 20261007 — each recorded once,
    // idempotently).
    assert_eq!(
        row_count(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'"
        ),
        127,
        "table surface must be unchanged after upgrade"
    );
}

#[test]
fn store_to_location_rename_preserves_rows_and_foreign_keys() {
    let split = ALL
        .iter()
        .position(|migration| migration.id == "20260906_rename_store_to_location.sql")
        .unwrap();
    let mut conn = fresh();
    platform_core::database::run(&mut conn, &ALL[..split]).unwrap();

    conn.execute(
        "INSERT INTO store_profiles (id, name, is_primary) VALUES ('location-a', 'Location A', 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO roles (id, name) VALUES ('role-location-test', 'Location Test')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id)\n         VALUES ('user-location-test', 'location-test', 'not-used', 'Location Test', 'role-location-test')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO user_store_access (user_id, store_id, access_level)\n         VALUES ('user-location-test', 'location-a', 'operator')",
        [],
    )
    .unwrap();

    platform_core::database::run(&mut conn, &ALL[split..]).unwrap();

    assert_eq!(
        row_count(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'store_profiles'",
        ),
        0
    );
    // ADR #56 §2.6: the baseline no longer seeds a 'Default Store' row, so the
    // only location here is the one THIS test inserts before the rename.
    // (Previously 2 = 1 seeded + 1 inserted.)
    assert_eq!(row_count(&conn, "SELECT COUNT(*) FROM locations"), 1);
    assert_eq!(
        row_count(
            &conn,
            "SELECT COUNT(*) FROM user_location_access WHERE location_id = 'location-a'",
        ),
        1
    );
    // ADR #56 §2.6: the BOOTSTRAP_FREE subscription row and the five
    // default workspace instances are no longer seeded, so there is nothing
    // to rename here — `provision_device` creates both per location. What the
    // FIXTURE asserts now is the harder half of the rename: zero foreign-key
    // violations with no seeded rows to hide behind.
    assert_eq!(
        row_count(
            &conn,
            "SELECT COUNT(*) FROM tenant_subscription WHERE tenant_id = 'default'",
        ),
        0,
        "no sentinel subscription may survive the baseline"
    );
    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM workspace_instances"),
        0,
        "no seeded workspace instances may survive the baseline"
    );
    assert_eq!(
        row_count(
            &conn,
            "SELECT COUNT(*) FROM workspace_screens\n             WHERE workspace_key = 'admin' AND screen_key = 'locations'",
        ),
        1
    );
    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM pragma_foreign_key_check"),
        0,
        "location rename must not leave broken foreign keys",
    );
}

// ── Location tenant isolation (Phase 1 P0: Protect tenant isolation) ──
//
// The 20260907 migration adds `tenant_id` to `locations` and
// `user_location_access` so the cloud Postgres layer can scope location data
// per tenant under RLS. This pins the contract at the SQLite layer: both
// tables must expose the column, the default sentinel must be 'default', and
// an explicit tenant must be preserved.

#[test]
fn location_tables_carry_tenant_id_after_migration() {
    let mut conn = fresh();
    run(&mut conn).unwrap();

    for table in ["locations", "user_location_access"] {
        let cols: Vec<String> = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert!(
            cols.iter().any(|c| c == "tenant_id"),
            "{table} must carry a tenant_id column after the location-tenant migration"
        );
    }

    // ADR #56 §2.6 removed the seeded 'Default Store' row, so nothing resolves
    // to the 'default' sentinel until a location is CREATED — which is the
    // point of the removal: a store with no merchant has no location. The
    // guarantee this now pins is the column DEFAULT, exercised by the insert
    // immediately below rather than by a row the migration happened to ship.
    let default_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM locations WHERE tenant_id = 'default'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        default_rows, 0,
        "the baseline must not seed a location for the default tenant"
    );

    // An insert without an explicit tenant takes the 'default' sentinel.
    conn.execute("INSERT INTO locations (id, name) VALUES ('loc-x', 'X')", [])
        .unwrap();
    let got: String = conn
        .query_row(
            "SELECT tenant_id FROM locations WHERE id = 'loc-x'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        got, "default",
        "implicit tenant_id must default to 'default'"
    );

    // An explicit tenant is preserved verbatim.
    conn.execute(
        "INSERT INTO locations (id, name, tenant_id) VALUES ('loc-y', 'Y', 'tenant-9')",
        [],
    )
    .unwrap();
    let got2: String = conn
        .query_row(
            "SELECT tenant_id FROM locations WHERE id = 'loc-y'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(got2, "tenant-9", "explicit tenant_id must be preserved");
}

// ── Terminal tenant ownership (Phase 1 P0: Protect tenant isolation) ──
//
// The 20260912 migration adds `tenant_id` to `terminals` so "each Terminal
// belongs to one Organization" becomes representable: bound terminals
// backfill from their bound location's tenant, unbound terminals resolve to
// the 'default' sentinel (the state Memo fan-out tests depend on).

#[test]
fn terminals_carry_tenant_id_after_migration() {
    // Split at the terminal-tenant migration: seed pre-migration rows into the
    // legacy schema (no tenant_id on terminals yet), then let the backfill run.
    let split = ALL
        .iter()
        .position(|m| m.id == "20260912_terminals_tenant.sql")
        .expect("terminals-tenant migration present in registry");
    let mut conn = fresh();
    platform_core::database::run(&mut conn, &ALL[..split]).unwrap();

    // One non-default-tenant location, one terminal bound to it, one unbound.
    conn.execute(
        "INSERT INTO locations (id, name, tenant_id) VALUES ('loc-t9', 'T9', 'tenant-9')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO terminals (id, name, device_id, bound_location_id)
         VALUES ('term-bound', 'Bound', 'dev-bound', 'loc-t9')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO terminals (id, name, device_id) VALUES ('term-free', 'Free', 'dev-free')",
        [],
    )
    .unwrap();

    platform_core::database::run(&mut conn, &ALL[split..]).unwrap();

    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(terminals)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert!(
        cols.iter().any(|c| c == "tenant_id"),
        "terminals must carry a tenant_id column after the terminal-tenant migration"
    );

    // A bound terminal inherits its bound location's tenant (the backfill).
    let bound: String = conn
        .query_row(
            "SELECT tenant_id FROM terminals WHERE id = 'term-bound'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        bound, "tenant-9",
        "bound terminal must inherit its bound location's tenant"
    );

    // An unbound terminal resolves to the 'default' sentinel — the state the
    // Memo Organization fan-out depends on for legacy unbound terminals.
    let unbound: String = conn
        .query_row(
            "SELECT tenant_id FROM terminals WHERE id = 'term-free'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        unbound, "default",
        "unbound terminal must resolve to the default tenant"
    );

    // Post-migration writes: implicit inserts take the 'default' sentinel...
    conn.execute(
        "INSERT INTO terminals (id, name, device_id) VALUES ('term-new', 'New', 'dev-new')",
        [],
    )
    .unwrap();
    let implicit: String = conn
        .query_row(
            "SELECT tenant_id FROM terminals WHERE id = 'term-new'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        implicit, "default",
        "implicit tenant_id must default to 'default'"
    );

    // ...and an explicit tenant is preserved verbatim.
    conn.execute(
        "INSERT INTO terminals (id, name, device_id, tenant_id)
         VALUES ('term-explicit', 'Explicit', 'dev-explicit', 'tenant-3')",
        [],
    )
    .unwrap();
    let explicit: String = conn
        .query_row(
            "SELECT tenant_id FROM terminals WHERE id = 'term-explicit'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(explicit, "tenant-3", "explicit tenant_id must be preserved");
}

#[test]
fn legal_entity_migration_creates_defaults_and_moves_locations() {
    // Isolate the LE migration by id, not by "last entry" — later migrations
    // (e.g. memos) are appended after it, so `ALL.len() - 1` would apply the
    // wrong migration. Splitting at the LE index applies everything up to but
    // not including LE, then LE (and anything after) in the second run.
    let split = ALL
        .iter()
        .position(|m| m.id == "20260908_legal_entities.sql")
        .expect("legal_entities migration present in registry");
    let mut conn = fresh();
    platform_core::database::run(&mut conn, &ALL[..split]).unwrap();

    conn.execute(
        "INSERT INTO locations (id, name, tenant_id) VALUES ('tenant-2-location', 'Tenant 2 Location', 'tenant-2')",
        [],
    )
    .unwrap();

    platform_core::database::run(&mut conn, &ALL[split..]).unwrap();

    let entities: Vec<(String, String, String)> = conn
        .prepare("SELECT id, tenant_id, name FROM legal_entities ORDER BY tenant_id")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .map(|row| row.unwrap())
        .collect();

    // ADR #56 §2.6: the baseline no longer seeds a 'Default Store' location,
    // so there is no `default`-tenant location for the LE migration to give a
    // default legal entity to. Only the location THIS test inserts gets one.
    // That is the correct post-removal behaviour, not a regression: a tenant
    // with no location has no legal entity until provisioning creates both.
    assert_eq!(
        entities,
        vec![(
            "tenant-2:default-legal-entity".to_string(),
            "tenant-2".to_string(),
            "Default Legal Entity".to_string(),
        )]
    );

    let location_entities: Vec<(String, String)> = conn
        .prepare(
            "SELECT id, legal_entity_id FROM locations
             WHERE id IN ('default', 'tenant-2-location') ORDER BY id",
        )
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(|row| row.unwrap())
        .collect();
    // Same consequence as above: no seeded 'default' location means no
    // 'default' row to link. ADR #56 §2.6.
    assert_eq!(
        location_entities,
        vec![(
            "tenant-2-location".to_string(),
            "tenant-2:default-legal-entity".to_string(),
        )]
    );

    assert_eq!(
        row_count(&conn, "SELECT COUNT(*) FROM pragma_foreign_key_check"),
        0,
        "legal entity migration must preserve foreign-key integrity",
    );
}

// ── Store-scoped isolation (DB-04 end-state) ───────────────────
//
// The consolidated schema carries a store_id FK on products, customers,
// sales and sale_lines (ON DELETE SET NULL). These tests audit the
// end-state contract: a store-scoped read or write must never leak across
// stores and must never touch the NULL global sentinel.

/// Run `SELECT id FROM {table} WHERE store_id = ?1` — the canonical
/// store-scoped query shape — and return the matching row ids.
fn scoped_row_ids(conn: &rusqlite::Connection, table: &str, store: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id FROM {table} WHERE store_id = ?1 ORDER BY id"
        ))
        .unwrap();
    stmt.query_map(rusqlite::params![store], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

/// Run `SELECT id FROM {table} WHERE store_id IS NULL` — the explicit
/// global-scope predicate that is the ONLY way NULL-sentinel rows are
/// reachable — and return the matching row ids.
fn global_row_ids(conn: &rusqlite::Connection, table: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id FROM {table} WHERE store_id IS NULL ORDER BY id"
        ))
        .unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

/// Seed the shared cross-store audit fixture: two store profiles
/// (migration 025 already seeds 'default') plus rows owned by
/// store-a, store-b, and the NULL global sentinel on every ADR #4
/// scoped table. Used by both the SELECT and UPDATE audit tests so
/// the fixtures cannot drift apart. `payment_method`/`course` are
/// seeded for the UPDATE test's mutable-column sweep but are inert
/// for the SELECT test.
fn seed_cross_store_fixture(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT INTO locations (id, name)
             VALUES ('store-a', 'Store A'), ('store-b', 'Store B');
         INSERT INTO products (id, sku, name, price_minor, currency, product_type, store_id)
             VALUES ('p-a', 'SKU-A', 'A', 100, 'USD', 'retail', 'store-a'),
                    ('p-b', 'SKU-B', 'B', 100, 'USD', 'retail', 'store-b'),
                    ('p-null', 'SKU-N', 'Global', 100, 'USD', 'retail', NULL);
         INSERT INTO customers (id, name, store_id)
             VALUES ('c-a', 'Cust A', 'store-a'),
                    ('c-b', 'Cust B', 'store-b'),
                    ('c-null', 'Cust Global', NULL);
         INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method, store_id)
             VALUES ('s-a', 100, 'USD', 1, 'completed', 'cash', 'store-a'),
                    ('s-b', 100, 'USD', 1, 'completed', 'cash', 'store-b'),
                    ('s-null', 100, 'USD', 1, 'completed', 'cash', NULL);
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position, course, store_id)
             VALUES ('sl-a', 's-a', 'SKU-A', 1, 100, 100, 'USD', 1, 'starter', 'store-a'),
                    ('sl-b', 's-b', 'SKU-B', 1, 100, 100, 'USD', 1, 'starter', 'store-b'),
                    ('sl-null', 's-null', 'SKU-N', 1, 100, 100, 'USD', 1, 'starter', NULL);",
    )
    .unwrap();
}

#[test]
fn store_scoped_query_never_returns_null_or_other_store_rows() {
    // DB-04 query-level audit. Migration 117's FK guarantees a non-NULL
    // store_id always references a real store_profile, but the audit
    // also pins the QUERY contract: `WHERE store_id = 'x'` must return
    // exactly store x's rows — never the NULL global-sentinel rows
    // (migration 069's "unscoped / legacy / global shared" state) and
    // never another store's rows. A scoped caller that forgets nothing
    // gets clean isolation at the predicate level too.
    let mut conn = fresh();
    run(&mut conn).unwrap();

    // Seed the shared cross-store fixture (store-a / store-b / NULL
    // rows on all four ADR #4 scoped tables).
    seed_cross_store_fixture(&conn);

    // The audit: a store-a scoped query returns EXACTLY the store-a
    // row on every table — no NULL sentinel, no store-b leakage.
    for (table, expected) in [
        ("products", vec!["p-a"]),
        ("customers", vec!["c-a"]),
        ("sales", vec!["s-a"]),
        ("sale_lines", vec!["sl-a"]),
    ] {
        let ids = scoped_row_ids(&conn, table, "store-a");
        assert_eq!(
            ids, expected,
            "{table} store-a scoped query must return only store-a rows, got: {ids:?}"
        );
    }

    // Mirror for store-b — isolation must hold in both directions.
    for (table, expected) in [
        ("products", vec!["p-b"]),
        ("customers", vec!["c-b"]),
        ("sales", vec!["s-b"]),
        ("sale_lines", vec!["sl-b"]),
    ] {
        let ids = scoped_row_ids(&conn, table, "store-b");
        assert_eq!(
            ids, expected,
            "{table} store-b scoped query must return only store-b rows, got: {ids:?}"
        );
    }

    // NULL-sentinel rows are reachable ONLY through the explicit
    // global predicate (store_id IS NULL), never through a scoped
    // query — that is the contract that keeps unscoped rows from
    // leaking into a single store's view.
    for (table, expected) in [
        ("products", vec!["p-null"]),
        ("customers", vec!["c-null"]),
        ("sales", vec!["s-null"]),
        ("sale_lines", vec!["sl-null"]),
    ] {
        let ids = global_row_ids(&conn, table);
        assert_eq!(
            ids, expected,
            "{table} global-sentinel query must return only NULL rows, got: {ids:?}"
        );
    }

    // FK ownership integrity (migration 117): a store_id with no
    // matching locations row is rejected at the database layer,
    // so a scoped query can never be pointed at a phantom store.
    let ghost = conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, store_id)
         VALUES ('p-ghost', 'SKU-GHOST', 'Ghost', 100, 'USD', 'retail', 'ghost-store')",
        [],
    );
    assert!(
        ghost.is_err(),
        "store_id referencing a missing store_profile must fail the 117 FK"
    );

    // Re-running migrations stays idempotent (module convention).
    run(&mut conn).unwrap();
}

#[test]
fn store_deletion_reverts_scoped_rows_to_null_sentinel() {
    // ON DELETE SET NULL contract (migration 117): deleting a store
    // profile must neither block on historical domain rows (RESTRICT)
    // nor destroy them (CASCADE) — their store_id reverts to the NULL
    // global sentinel. The rows stay globally visible and a scoped
    // query for the deleted store returns nothing.
    let mut conn = fresh();
    run(&mut conn).unwrap();
    conn.execute(
        "INSERT INTO locations (id, name) VALUES ('store-a', 'Store A')",
        [],
    )
    .unwrap();
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, store_id)
             VALUES ('p-a', 'SKU-A', 'A', 100, 'USD', 'retail', 'store-a'),
                    ('p-null', 'SKU-N', 'Global', 100, 'USD', 'retail', NULL);
         INSERT INTO sales (id, total_minor, currency, line_count, status, store_id)
             VALUES ('s-a', 100, 'USD', 1, 'completed', 'store-a');",
    )
    .unwrap();

    conn.execute("DELETE FROM locations WHERE id = 'store-a'", [])
        .unwrap();

    // Scoped query for the deleted store returns nothing…
    assert_eq!(
        scoped_row_ids(&conn, "products", "store-a"),
        Vec::<String>::new(),
        "scoped query for a deleted store must return no rows"
    );
    // …but the rows themselves survived, reverted to the NULL sentinel.
    let sid: Option<String> = conn
        .query_row("SELECT store_id FROM products WHERE id = 'p-a'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(
        sid.is_none(),
        "store-a product must revert to NULL sentinel"
    );
    let sale_sid: Option<String> = conn
        .query_row("SELECT store_id FROM sales WHERE id = 's-a'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(
        sale_sid.is_none(),
        "store-a sale must revert to NULL sentinel"
    );
    // The NULL sentinel row is untouched and the FK surface is clean.
    assert_eq!(
        global_row_ids(&conn, "products"),
        vec!["p-a", "p-null"],
        "reverted row must join the global scope"
    );
    let fk_check: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(fk_check, 0, "no FK violations after SET NULL reversion");

    // Re-running migrations stays idempotent (module convention).
    run(&mut conn).unwrap();
}

#[test]
fn store_scoped_update_never_mutates_other_store_or_null_rows() {
    // DB-04 UPDATE-path audit. Migration 117's FK guards writes as
    // well as reads: a store-scoped UPDATE (`WHERE store_id = 'x'`)
    // must touch exactly store x's rows, and SQLite's three-valued
    // logic (`NULL = 'x'` is never TRUE) structurally excludes the
    // NULL-sentinel rows — so unscoped/global data is write-protected
    // from scoped writers exactly as it is from scoped readers.
    let mut conn = fresh();
    run(&mut conn).unwrap();

    // Seed the shared cross-store fixture (store-a / store-b / NULL
    // rows on all four ADR #4 scoped tables).
    seed_cross_store_fixture(&conn);

    // Sweep all four tables: a store-a scoped UPDATE must affect
    // exactly one row (the store-a row) and leave the store-b row and
    // the NULL-sentinel row byte-identical.
    for (table, mutcol, a_id, b_id, null_id, _a_old, b_old, null_old, new_val) in [
        (
            "products",
            "name",
            "p-a",
            "p-b",
            "p-null",
            "A",
            "B",
            "Global",
            "Renamed-A",
        ),
        (
            "customers",
            "name",
            "c-a",
            "c-b",
            "c-null",
            "Cust A",
            "Cust B",
            "Cust Global",
            "Renamed-A",
        ),
        (
            "sales",
            "payment_method",
            "s-a",
            "s-b",
            "s-null",
            "cash",
            "cash",
            "cash",
            "card",
        ),
        (
            "sale_lines",
            "course",
            "sl-a",
            "sl-b",
            "sl-null",
            "starter",
            "starter",
            "starter",
            "main",
        ),
    ] {
        let affected = conn
            .execute(
                &format!("UPDATE {table} SET {mutcol} = ?1 WHERE store_id = 'store-a'"),
                rusqlite::params![new_val],
            )
            .unwrap();
        assert_eq!(
            affected, 1,
            "{table} store-a scoped UPDATE must affect exactly the store-a row"
        );
        let cell = |id: &str| -> String {
            conn.query_row(
                &format!("SELECT {mutcol} FROM {table} WHERE id = ?1"),
                rusqlite::params![id],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(cell(a_id), new_val, "{table} store-a row must be updated");
        assert_eq!(
            cell(b_id),
            b_old,
            "{table} store-b row must be untouched by a store-a scoped UPDATE"
        );
        assert_eq!(
            cell(null_id),
            null_old,
            "{table} NULL-sentinel row must be untouched by a store-a scoped UPDATE"
        );
    }

    // The FK guards UPDATE writes too: reassigning a row to a store
    // that does not exist is rejected, while reverting to NULL (the
    // documented global sentinel) stays legal.
    let ghost = conn.execute(
        "UPDATE products SET store_id = 'ghost-store' WHERE id = 'p-a'",
        [],
    );
    assert!(
        ghost.is_err(),
        "reassigning a row to a missing store_profile must fail the 117 FK"
    );
    conn.execute("UPDATE products SET store_id = NULL WHERE id = 'p-a'", [])
        .unwrap();
    let sid: Option<String> = conn
        .query_row("SELECT store_id FROM products WHERE id = 'p-a'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(
        sid.is_none(),
        "reverting a row to the NULL sentinel is legal"
    );

    // Re-running migrations stays idempotent (module convention).
    run(&mut conn).unwrap();
}

#[test]
fn store_scoped_upsert_never_hijacks_other_store_or_null_rows() {
    // DB-04 upsert-path audit. An `INSERT ... ON CONFLICT(id) DO
    // UPDATE` is the standard idempotent write (cart/offline/sync all
    // use it), but without a scope guard it would silently mutate a
    // row owned by ANOTHER store on conflict — the row is matched by
    // primary key, not by ownership. This test pins the guarded form:
    // `DO UPDATE ... WHERE {table}.store_id = 'store-a'` turns a
    // cross-store conflict into a no-op (affected = 0) instead of a
    // hijack. The NULL-sentinel row is protected the same way, and a
    // fresh insert still lands in the writer's own store.
    let mut conn = fresh();
    run(&mut conn).unwrap();

    seed_cross_store_fixture(&conn);

    // 1. A store-a scoped upsert that CONFLICTS with a store-b row must
    //    NOT overwrite it — the WHERE guard evaluates false and the
    //    statement becomes a no-op, leaving store-b's row intact.
    let hijack = conn
        .execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, product_type, store_id)
             VALUES ('p-b', 'SKU-B', 'Hijacked', 100, 'USD', 'retail', 'store-a')
             ON CONFLICT(id) DO UPDATE SET name = excluded.name
             WHERE products.store_id = 'store-a'",
            [],
        )
        .unwrap();
    assert_eq!(
        hijack, 0,
        "scoped upsert conflicting with a store-b row must be a no-op, not a hijack"
    );
    let name_b: String = conn
        .query_row("SELECT name FROM products WHERE id = 'p-b'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        name_b, "B",
        "store-b row must be untouched by a store-a scoped upsert"
    );
    let sid_b: String = conn
        .query_row("SELECT store_id FROM products WHERE id = 'p-b'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        sid_b, "store-b",
        "store-b row must keep its ownership after a conflicting scoped upsert"
    );

    // 2. Same guard protects the NULL-sentinel row from a scoped upsert.
    let null_hijack = conn
        .execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, product_type, store_id)
             VALUES ('p-null', 'SKU-N', 'Hijacked', 100, 'USD', 'retail', 'store-a')
             ON CONFLICT(id) DO UPDATE SET name = excluded.name
             WHERE products.store_id = 'store-a'",
            [],
        )
        .unwrap();
    assert_eq!(
        null_hijack, 0,
        "scoped upsert conflicting with the NULL-sentinel row must be a no-op"
    );
    let name_null: String = conn
        .query_row("SELECT name FROM products WHERE id = 'p-null'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        name_null, "Global",
        "NULL-sentinel row must be untouched by a store-a scoped upsert"
    );
    let sid_null: Option<String> = conn
        .query_row(
            "SELECT store_id FROM products WHERE id = 'p-null'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        sid_null.is_none(),
        "NULL-sentinel row must keep store_id NULL"
    );

    // 3. A store-a scoped upsert that conflicts with the writer's OWN
    //    store-a row DOES update it — the guard is satisfied and the
    //    legitimate idempotent-write path still works.
    let mine = conn
        .execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, product_type, store_id)
             VALUES ('p-a', 'SKU-A', 'Updated-A', 100, 'USD', 'retail', 'store-a')
             ON CONFLICT(id) DO UPDATE SET name = excluded.name
             WHERE products.store_id = 'store-a'",
            [],
        )
        .unwrap();
    assert_eq!(
        mine, 1,
        "scoped upsert on the writer's own store-a row must update it"
    );
    let name_a: String = conn
        .query_row("SELECT name FROM products WHERE id = 'p-a'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        name_a, "Updated-A",
        "store-a row must receive its own scoped upsert"
    );

    // 4. A store-a scoped upsert that is a fresh insert (no conflict)
    //    creates the new row owned by store-a.
    let fresh = conn
        .execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, product_type, store_id)
             VALUES ('p-new', 'SKU-NEW', 'New A', 100, 'USD', 'retail', 'store-a')
             ON CONFLICT(id) DO UPDATE SET name = excluded.name
             WHERE products.store_id = 'store-a'",
            [],
        )
        .unwrap();
    assert_eq!(
        fresh, 1,
        "fresh scoped upsert must insert the new store-a row"
    );
    let new_sid: String = conn
        .query_row(
            "SELECT store_id FROM products WHERE id = 'p-new'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        new_sid, "store-a",
        "fresh upsert row must be owned by store-a"
    );

    // 5. The 117 FK still guards the upsert insert path: a scoped
    //    upsert cannot create a row owned by a non-existent store.
    let ghost = conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type, store_id)
         VALUES ('p-ghost', 'SKU-GHOST', 'Ghost', 100, 'USD', 'retail', 'ghost-store')
         ON CONFLICT(id) DO UPDATE SET name = excluded.name
         WHERE products.store_id = 'store-a'",
        [],
    );
    assert!(
        ghost.is_err(),
        "upsert referencing a missing store_profile must fail the 117 FK"
    );

    // Re-running migrations stays idempotent (module convention).
    run(&mut conn).unwrap();
}

#[test]
fn cross_store_transaction_mixed_writes_stay_scoped_and_atomic() {
    // DB-04 transaction audit. Multi-statement transactions are the
    // real write path (products.rs / sales.rs use
    // `unchecked_transaction()` everywhere), so the audit must prove:
    //
    //   (a) a committed transaction that mixes store-a, store-b, and
    //       explicit-global writes keeps every write inside its own
    //       ownership class — a store-a scoped statement can never
    //       mutate store-b rows or the NULL sentinel even when both
    //       run in the same transaction, and the NULL row is reachable
    //       only through the explicit `store_id IS NULL` predicate;
    //   (b) atomicity: if any statement fails, the whole transaction
    //       rolls back — a NULL-sentinel row (or any row) is never
    //       left half-mutated by a partially-applied transaction.
    let mut conn = fresh();
    run(&mut conn).unwrap();

    seed_cross_store_fixture(&conn);

    // ── (a) Committed mixed transaction stays in-scope ────────────
    conn.execute("BEGIN", []).unwrap();
    let a = conn
        .execute(
            "UPDATE products SET name = 'Tx-A' WHERE store_id = 'store-a'",
            [],
        )
        .unwrap();
    assert_eq!(
        a, 1,
        "store-a scoped UPDATE inside tx must affect exactly 1 row"
    );
    let b = conn
        .execute(
            "UPDATE products SET name = 'Tx-B' WHERE store_id = 'store-b'",
            [],
        )
        .unwrap();
    assert_eq!(
        b, 1,
        "store-b scoped UPDATE inside tx must affect exactly 1 row"
    );
    // Explicit global write — the ONLY way the NULL sentinel is
    // reachable, and a deliberate opt-in rather than a scoped leak.
    let g = conn
        .execute(
            "UPDATE products SET name = 'Tx-Global' WHERE store_id IS NULL",
            [],
        )
        .unwrap();
    assert_eq!(
        g, 1,
        "explicit global UPDATE must affect exactly the NULL-sentinel row"
    );
    conn.execute("COMMIT", []).unwrap();

    // Post-commit: every row holds exactly its own write.
    let name_a: String = conn
        .query_row("SELECT name FROM products WHERE id = 'p-a'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(name_a, "Tx-A", "store-a row must receive its own tx write");
    let name_b: String = conn
        .query_row("SELECT name FROM products WHERE id = 'p-b'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(name_b, "Tx-B", "store-b row must receive its own tx write");
    let name_null: String = conn
        .query_row("SELECT name FROM products WHERE id = 'p-null'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        name_null, "Tx-Global",
        "NULL-sentinel row must receive only the explicit global write"
    );

    // ── (b) Failed transaction rolls back atomically ──────────────
    // A statement that violates the 117 FK fails mid-transaction;
    // ROLLBACK must restore EVERY prior write, so no row — including
    // the NULL sentinel — is left half-mutated.
    conn.execute("BEGIN", []).unwrap();
    conn.execute(
        "UPDATE products SET name = 'ShouldRollBack-A' WHERE store_id = 'store-a'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE products SET name = 'ShouldRollBack-Null' WHERE store_id IS NULL",
        [],
    )
    .unwrap();
    let fail = conn.execute(
        "UPDATE products SET store_id = 'ghost-store' WHERE id = 'p-a'",
        [],
    );
    assert!(
        fail.is_err(),
        "FK-violating statement must fail inside the transaction"
    );
    conn.execute("ROLLBACK", []).unwrap();

    // After rollback the DB is byte-identical to the pre-(b) state:
    // the store-a row and the NULL-sentinel row both revert to their
    // committed (a) values, and the FK surface is clean.
    let rb_a: String = conn
        .query_row("SELECT name FROM products WHERE id = 'p-a'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        rb_a, "Tx-A",
        "store-a write must be rolled back — no half-mutated state"
    );
    let rb_null: String = conn
        .query_row("SELECT name FROM products WHERE id = 'p-null'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        rb_null, "Tx-Global",
        "NULL-sentinel write must be rolled back — never left half-mutated"
    );
    let rb_b: String = conn
        .query_row("SELECT name FROM products WHERE id = 'p-b'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(rb_b, "Tx-B", "store-b write must survive untouched");
    let fk_check: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(fk_check, 0, "no FK violations after rollback");

    // Re-running migrations stays idempotent (module convention).
    run(&mut conn).unwrap();
}

#[test]
fn pg_init_declares_same_table_surface_as_sqlite() {
    // The Postgres port must cover every table the SQLite registry
    // produces (the init plus every incremental migration — e.g.
    // `sent_reports` lives in 20260814_sent_reports.sql) and must not
    // leak SQLite-only dialect through the generator.

    /// Strip `--` line and `/* */` block comments, quote-aware.
    ///
    /// Needed because the counter below is a **substring** count and
    /// `20260813_init.pg.sql` discusses the phrase in its own header prose.
    /// Without this, the counter reads comments as declarations.
    fn strip_sql_comments(sql: &str) -> String {
        let mut out = String::with_capacity(sql.len());
        let mut chars = sql.chars().peekable();
        let (mut in_quote, mut in_line, mut in_block) = (false, false, false);
        while let Some(c) = chars.next() {
            if in_line {
                if c == '\n' {
                    in_line = false;
                    out.push('\n');
                }
                continue;
            }
            if in_block {
                if c == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    in_block = false;
                }
                continue;
            }
            if in_quote {
                out.push(c);
                if c == '\'' {
                    in_quote = false;
                }
                continue;
            }
            match c {
                '\'' => {
                    in_quote = true;
                    out.push(c);
                }
                '-' if chars.peek() == Some(&'-') => {
                    chars.next();
                    in_line = true;
                }
                '/' if chars.peek() == Some(&'*') => {
                    chars.next();
                    in_block = true;
                }
                _ => out.push(c),
            }
        }
        out
    }

    /// Count `CREATE TABLE` **declarations**, not mentions.
    ///
    /// Measured 2026-09-18: this test failed on `main` reporting `128` against
    /// `126`, and the whole of the "drift" was **two comment lines** in
    /// `20260813_init.pg.sql` (`:21` *"— Postgres: CREATE TABLE IF NOT EXISTS
    /// skips the table whole…"* and `:210` *"— CREATE TABLE IF NOT EXISTS is
    /// idempotent for TABLES…"*). Both surfaces in fact declared **126**; the
    /// instrument was counting prose. The count assertion itself is deliberate
    /// and stays (see `init_sql_creates_complete_schema_surface` — a count
    /// catches a silent drop that a name-list check misses), so the fix is to
    /// the instrument, not to the assertion. Quote-awareness matters in the
    /// dangerous direction: a naive `split("--")` on a line containing
    /// `DEFAULT '--'` would truncate *before* a declaration and hide it,
    /// turning a real drift into a pass.
    fn table_count(sql: &str) -> usize {
        strip_sql_comments(sql)
            .matches("CREATE TABLE IF NOT EXISTS")
            .count()
    }
    let sqlite_surface: String = ALL.iter().map(|m| m.sql).collect::<Vec<_>>().join("\n");
    assert_eq!(
        table_count(PG_INIT),
        table_count(&sqlite_surface),
        "Postgres DDL table count drifted from the SQLite registry — regenerate scripts/generate-pg-migration.py"
    );
    // Same instrument discipline as `table_count`: this asserts the Postgres
    // **DDL** carries no SQLite dialect, so it must not read comments either.
    // Today all five tokens are absent from the file entirely (measured
    // 2026-09-18, so this change is behaviour-preserving), but a future header
    // comment explaining *"we deliberately emit no PRAGMA here"* would have
    // false-failed the gate — the same class of instrument defect as the count
    // above, one comment away from firing.
    let pg_ddl = strip_sql_comments(PG_INIT);
    for leftover in [
        "strftime",
        "AUTOINCREMENT",
        "PRAGMA",
        "INSERT OR IGNORE",
        ") STRICT",
    ] {
        assert!(
            !pg_ddl.contains(leftover),
            "Postgres DDL still contains SQLite dialect: {leftover:?}"
        );
    }
}

/// Every migration the registry has ever shipped must still be registered: the
/// registry may grow, never shrink.
///
/// This is a **subset** check, so adding a migration never fails it and needs no
/// edit here — but deleting a migration file *together with* its registry entry
/// does fail. On exactly that mutation (registry entry deleted, `.sql` deleted)
/// both assertions that look like coverage stayed **green**:
///
/// * `migration_registry_matches_filesystem` asserts file→registry parity and
///   equal counts; both sides lose the same id, so it still holds.
/// * `existing_db_with_legacy_rows_upgrades_idempotently` derives its expected
///   list from `ALL`, so its expectation shrinks along with the deletion.
///
/// A migration that some feature test looks up by id in `ALL` has a second net
/// (the two tests below that split on `20261008` do, via `expect`), but one
/// without such a test would disappear silently. Every id is therefore pinned
/// absolutely here, which covers the classes nothing else reaches — including
/// migrations that change no table count and so leave the `127`-table assertion
/// untouched: `20261008_provisioning_legacy_backfill.sql` is DML only and is
/// exactly that shape. New migrations belong in the registry, not in this list —
/// it is a record of what must not vanish, not of what exists.
const MUST_STAY_REGISTERED: &[&str] = &[
    "20260813_init.sql",
    "20260814_tenant_uniqueness.sql",
    "20260815_tenant_unique_indexes.sql",
    "20260814_offline_queue_index.sql",
    "20260814_sale_lines_tenant.sql",
    "20260814_sales_tenant.sql",
    "20260814_sent_reports.sql",
    "20260814_sent_reports_tenant.sql",
    "20260814_analytics_index.sql",
    "20260820_kds_devices.sql",
    "20260821_tender_currency.sql",
    "20260822_sale_charges.sql",
    "20260822_kds_counter_store.sql",
    "20260823_po_receive_state.sql",
    "20260824_media_edc.sql",
    "20260825_payment_infra.sql",
    "20260826_sale_line_snapshots.sql",
    "20260827_refunds_tenant.sql",
    "20260831_loyalty_multiplier_fixedpoint.sql",
    "20260831_per_tenant_unique_rebuild.sql",
    "20260901_gift_card_redeem_idempotency.sql",
    "20260901_image_refs.sql",
    "20260901_product_images.sql",
    "20260902_outbox.sql",
    "20260902_snapshot_versions.sql",
    "20260903_webhook_endpoints.sql",
    "20260904_kds_indexes.sql",
    "20260906_rename_store_to_location.sql",
    "20260907_add_location_tenant_id.sql",
    "20260908_legal_entities.sql",
    "20260909_memos.sql",
    "20260910_memo_child_tenant_id.sql",
    "20260911_memo_fk_restrict.sql",
    "20260912_terminals_tenant.sql",
    "20260913_memo_locations.sql",
    "20260914_memo_retention.sql",
    "20260915_topology_revisions.sql",
    "20260916_role_assignment_scopes.sql",
    "20260917_assignment_backfill_org_wide.sql",
    "20260918_payables.sql",
    "20260919_regional_configuration.sql",
    "20260920_audit_retention.sql",
    "20260921_tax_rate_scoping.sql",
    "20260922_over_quota_markers.sql",
    "20260923_fiscal_numbering.sql",
    "20260924_local_payment_methods.sql",
    "20260925_receipt_formats.sql",
    "20260926_tax_rate_scoped_authoring.sql",
    "20260926_location_ticket_prefix.sql",
    "20260927_kds_ticket_prefix_stamp.sql",
    "20260928_document_kind_check.sql",
    "20260929_tax_rate_rounding_mode.sql",
    "20260930_sales_tax_estimate_note.sql",
    "20261001_sale_idempotency.sql",
    "20261002_sync_conflicts.sql",
    "20261003_sync_entity_vectors.sql",
    "20261004_midtrans_transactions.sql",
    "20261005_kds_routing_rules.sql",
    "20261006_receipt_hierarchy_code.sql",
    "20261007_provisioning.sql",
    "20261008_provisioning_legacy_backfill.sql",
];

/// A migration that disappears is a schema change nobody reviewed.
#[test]
fn no_registered_migration_ever_disappears() {
    let registered: std::collections::HashSet<&str> = ALL.iter().map(|mig| mig.id).collect();
    let missing: Vec<&str> = MUST_STAY_REGISTERED
        .iter()
        .copied()
        .filter(|id| !registered.contains(id))
        .collect();
    assert!(
        missing.is_empty(),
        "these migrations were registered and no longer are: {missing:#?}. A registry may grow, \
         never shrink — a migration that disappears changes what a fresh install produces and can \
         never be re-applied to an existing database. If the removal is deliberate, land it with \
         MUST_STAY_REGISTERED edited in the same commit."
    );
}

#[test]
fn migration_registry_matches_filesystem() {
    // DB-01: the registry is the source of truth. Every `.sql` file under
    // crates/kasirmu-core/migrations/ must have EXACTLY ONE registry entry,
    // and every registry entry must resolve to a real file. A new SQL
    // file that is never registered (or a registered entry whose file
    // was deleted) silently changes what fresh installs vs upgrades
    // produce, so this must fail at test time.
    //
    // `*.pg.sql` files are the generated Postgres ports of the SQLite
    // registry and are applied separately by the cloud server, so they
    // are not registry entries and are excluded here.
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
    let mut files: Vec<String> = std::fs::read_dir(&dir)
        .expect("migrations directory must exist")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".sql") && !n.ends_with(".pg.sql"))
        .collect();
    files.sort();

    let mut registered: Vec<&str> = ALL.iter().map(|m| m.id).collect();
    registered.sort_unstable();

    // Every file on disk must be registered exactly once.
    let mut seen_files: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for file in &files {
        assert!(
            ALL.iter().any(|m| m.id == file),
            "DB-01: migration file {file} exists on disk but has NO registry entry in ALL — add it or the runner will skip it"
        );
        assert!(
            seen_files.insert(file),
            "DB-01: migration file {file} is registered more than once"
        );
    }

    // Every registry entry must have a real file on disk.
    for id in &registered {
        assert!(
            files.iter().any(|f| f == id),
            "DB-01: registry entry {id} has no matching file in migrations/ — remove the entry or restore the file"
        );
    }

    assert_eq!(
        files.len(),
        registered.len(),
        "DB-01: registry/file parity broken — {} files vs {} registered entries",
        files.len(),
        registered.len()
    );
}

/// LOYALTY-01: the fixed-point migration must recover the owner's intended
/// decimal from the corrupted REAL column (1.4 was stored as
/// 1.3999999999999999111; ROUND(×1e6) gives back 1_400_000), drop the old
/// column, and re-arm the validation triggers on the new one.
#[test]
fn loyalty_multiplier_backfill_from_legacy_real_column() {
    let conn = fresh();
    // Pre-migration schema, verbatim from init.sql:310.
    conn.execute_batch(
        "CREATE TABLE loyalty_tiers (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            min_points  INTEGER NOT NULL DEFAULT 0,
            points_per_unit INTEGER NOT NULL DEFAULT 10,
            earn_multiplier REAL NOT NULL DEFAULT 1.0,
            colour      TEXT NOT NULL DEFAULT '#6b7280',
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        INSERT INTO loyalty_tiers (id, name, earn_multiplier) VALUES
            ('t-one',   'One',   1.0),
            ('t-gold',  'Gold',  1.25),
            ('t-flip',  'Flip',  1.4),
            ('t-drift', 'Drift', 1.07);",
    )
    .unwrap();

    conn.execute_batch(include_str!(
        "../migrations/20260831_loyalty_multiplier_fixedpoint.sql"
    ))
    .unwrap();

    let get: Vec<(String, i64)> = conn
        .prepare("SELECT id, earn_multiplier_millionths FROM loyalty_tiers ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(
        get,
        vec![
            ("t-drift".to_string(), 1_070_000),
            ("t-flip".to_string(), 1_400_000),
            ("t-gold".to_string(), 1_250_000),
            ("t-one".to_string(), 1_000_000),
        ],
        "backfill must recover the intended decimal for every ≤6-digit multiplier"
    );

    // The old column is gone…
    let cols: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('loyalty_tiers')")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert!(!cols.contains(&"earn_multiplier".to_string()));

    // …and the recreated triggers guard the new column.
    let err = conn.execute(
        "INSERT INTO loyalty_tiers (id, name, earn_multiplier_millionths, colour)
         VALUES ('t-bad', 'Bad', 0, '#6b7280')",
        [],
    );
    assert!(
        err.is_err(),
        "zero multiplier must be rejected by the trigger"
    );
}

/// LOYALTY-01: fresh installs run init.sql (seeds REAL multipliers) and then the
/// fixed-point migration — the seeded tiers must land on exact millionths.
#[test]
fn loyalty_seeded_tiers_carry_exact_millionths() {
    let mut conn = fresh();
    run(&mut conn).unwrap();
    let mut stmt = conn
        .prepare("SELECT id, earn_multiplier_millionths FROM loyalty_tiers ORDER BY id")
        .unwrap();
    let rows: Vec<(String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(
        rows,
        vec![
            ("tier-bronze".to_string(), 1_000_000),
            ("tier-gold".to_string(), 1_500_000),
            ("tier-platinum".to_string(), 2_000_000),
            ("tier-silver".to_string(), 1_250_000),
        ]
    );
}

/// The 20260815 composite indexes documented per-tenant SKU/username
/// uniqueness, but the inline global `UNIQUE` from the reverted init.sql
/// survived on both tables and dominated it — two tenants could never
/// share a SKU/username, and the sync upserts (`ON CONFLICT
/// (tenant_id, sku)`) failed with a bare constraint error instead of
/// resolving. The rebuild migration must: allow cross-tenant duplicates,
/// still reject same-tenant duplicates, make the upsert pattern resolve,
/// and leave every inbound FK intact (defer_foreign_keys rebuild with 10
/// referencing tables on each side).
#[test]
fn per_tenant_unique_rebuild_restores_documented_intent() {
    let mut conn = fresh();
    run(&mut conn).unwrap();

    // The parent DROP + RENAME must not strand a single inbound FK.
    let fk_violations: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(fk_violations, 0, "rebuild broke referential integrity");

    // Cross-tenant duplicate SKU: allowed (was rejected pre-rebuild).
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
         VALUES ('p-a', 'SKU1', 'A', 100, 'IDR', 't-A')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
         VALUES ('p-b', 'SKU1', 'B', 100, 'IDR', 't-B')",
        [],
    )
    .unwrap();
    // Same-tenant duplicate: still rejected by the composite index.
    let dup = conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
         VALUES ('p-c', 'SKU1', 'C', 100, 'IDR', 't-A')",
        [],
    );
    assert!(dup.is_err(), "same-tenant SKU must stay unique");
    // The sync_client upsert pattern resolves against the composite index.
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id)
         VALUES ('p-a', 'SKU1', 'A-updated', 100, 'IDR', 't-A')
         ON CONFLICT (tenant_id, sku) DO UPDATE SET name = 'A-updated'",
        [],
    )
    .unwrap();
    let name: String = conn
        .query_row("SELECT name FROM products WHERE id = 'p-a'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(name, "A-updated");

    // Users: same story on username.
    conn.execute("INSERT INTO roles (id, name) VALUES ('role-t', 'T')", [])
        .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, tenant_id)
         VALUES ('u-a', 'cashier', 'h', 'A', 'role-t', 't-A')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, tenant_id)
         VALUES ('u-b', 'cashier', 'h', 'B', 'role-t', 't-B')",
        [],
    )
    .unwrap();
    let dup_user = conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, tenant_id)
         VALUES ('u-c', 'cashier', 'h', 'C', 'role-t', 't-A')",
        [],
    );
    assert!(dup_user.is_err(), "same-tenant username must stay unique");

    // The rebuilt tables kept the non-unique guardrails too, and carry NO
    // inline constraint-derived unique index (origin 'u' = the old global
    // `sku UNIQUE`; its absence is the actual fix).
    let no_inline_unique: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_index_list('products') WHERE origin = 'u'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        no_inline_unique, 0,
        "inline global UNIQUE constraints must be gone from the rebuilt products table"
    );
}

// The 20260913 migration replaces the single-location targeting column
// (`memos.location_id`) with the `memo_locations` join table, so one Location
// Memo can target several locations at once (Phase 3). Zero targeting rows is
// the new representation of "Organization Memo".

#[test]
fn memo_location_column_becomes_a_join_table() {
    // Split at the join-table migration: seed pre-migration memos into the
    // legacy schema (which still has the location_id column), then verify the
    // migration carries the targeting over and drops the column.
    let split = ALL
        .iter()
        .position(|m| m.id == "20260913_memo_locations.sql")
        .expect("memo-locations migration present in registry");
    let mut conn = fresh();
    platform_core::database::run(&mut conn, &ALL[..split]).unwrap();

    // One Location Memo (location_id set) and one Organization Memo (NULL),
    // each with a published revision and a recipient row, so the rebuild's
    // copy really is a full copy.
    conn.execute(
        "INSERT INTO locations (id, name, tenant_id) VALUES ('loc-old', 'Old', 'default')",
        [],
    )
    .unwrap();
    // The recipient FK needs its terminal to exist (terminal_id → terminals
    // RESTRICT, per the 20260911 policy).
    conn.execute(
        "INSERT INTO terminals (id, name, device_id) VALUES ('term-x', 'Term X', 'term-x-dev')",
        [],
    )
    .unwrap();
    for (id, location) in [("memo-loc", Some("loc-old")), ("memo-org", None)] {
        conn.execute(
            "INSERT INTO memos (id, tenant_id, location_id, author_user_id, author_role,
                                title, body, status, duration)
             VALUES (?1, 'default', ?2, 'user-1', 'admin', 'T', 'B', 'draft', '24h')",
            rusqlite::params![id, location],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO memo_revisions (id, memo_id, tenant_id, revision, title, body,
                                         published_at, published_by)
             VALUES (?1 || '-rev', ?1, 'default', 1, 'T', 'B', '2026-09-07T00:00:00.000Z', 'user-1')",
            rusqlite::params![id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO memo_recipients (id, memo_id, tenant_id, terminal_id, delivery_status)
             VALUES (?1 || '-r', ?1, 'default', 'term-x', 'pending')",
            rusqlite::params![id],
        )
        .unwrap();
    }

    platform_core::database::run(&mut conn, &ALL[split..]).unwrap();

    // The column is gone and the join table exists.
    let memos_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(memos)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert!(
        !memos_cols.iter().any(|c| c == "location_id"),
        "memos.location_id must be replaced by the join table"
    );
    let tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='memo_locations'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(tables, 1, "memo_locations must exist after the migration");

    // The Location Memo carried its targeting over; the Organization memo has
    // no targeting rows (the new representation of organization-wide).
    let targeted: Vec<String> = conn
        .prepare("SELECT location_id FROM memo_locations WHERE memo_id = 'memo-loc'")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(targeted, vec!["loc-old".to_string()]);
    let org_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memo_locations WHERE memo_id = 'memo-org'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        org_rows, 0,
        "an Organization memo must have no targeting rows"
    );

    // The rebuild is a full copy: revision + recipient rows survived for both
    // memos, and the carried memo fields are intact.
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM memos", [], |r| r.get(0))
        .unwrap();
    assert_eq!(total, 2, "both memos survive the rebuild");
    let revisions: i64 = conn
        .query_row("SELECT COUNT(*) FROM memo_revisions", [], |r| r.get(0))
        .unwrap();
    assert_eq!(revisions, 2, "revision rows survive the rebuild");
    let recipients: i64 = conn
        .query_row("SELECT COUNT(*) FROM memo_recipients", [], |r| r.get(0))
        .unwrap();
    assert_eq!(recipients, 2, "recipient rows survive the rebuild");
    let (status, duration): (String, String) = conn
        .query_row(
            "SELECT status, duration FROM memos WHERE id = 'memo-loc'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(status, "draft");
    assert_eq!(duration, "24h");
}

#[test]
fn memo_location_fks_follow_the_20260911_policy() {
    let mut conn = fresh();
    run(&mut conn).unwrap();
    conn.execute(
        "INSERT INTO locations (id, name, tenant_id) VALUES ('loc-fk', 'FK', 'default')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO memos (id, tenant_id, author_user_id, author_role, title, body, status, duration)
         VALUES ('memo-fk', 'default', 'user-1', 'admin', 'T', 'B', 'draft', '24h')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO memo_locations (memo_id, location_id, tenant_id)
         VALUES ('memo-fk', 'loc-fk', 'default')",
        [],
    )
    .unwrap();

    // RESTRICT on location_id (the 20260911 decision, inherited): a Location
    // that a Memo still targets cannot be silently deleted.
    let del_loc = conn.execute("DELETE FROM locations WHERE id = 'loc-fk'", []);
    assert!(
        del_loc.is_err(),
        "deleting a Location that a Memo targets must be blocked (RESTRICT)"
    );

    // CASCADE on memo_id (the true-child edge): deleting the memo removes its
    // targeting rows, exactly like memo_revisions/memo_recipients.
    conn.execute("DELETE FROM memos WHERE id = 'memo-fk'", [])
        .unwrap();
    let left: i64 = conn
        .query_row("SELECT COUNT(*) FROM memo_locations", [], |r| r.get(0))
        .unwrap();
    assert_eq!(left, 0, "targeting rows go with their memo (CASCADE)");

    // And the now-unreferenced Location is deletable again (no over-block).
    conn.execute("DELETE FROM locations WHERE id = 'loc-fk'", [])
        .expect("a location with no remaining memo targeting must be deletable");
}

#[test]
fn ticket_prefix_column_exists_and_backfills_empty_after_upgrade() {
    // Upgrade path (W2-A, D16): a database that predates the
    // ticket-prefix migration must come out of `run` with the column
    // present and every pre-existing row backfilled to the ''
    // no-prefix sentinel -- the partial unique index's WHERE clause
    // keeps that all-empty state index-legal, so the upgrade cannot
    // fail on existing data.
    let split = ALL
        .iter()
        .position(|m| m.id == "20260926_location_ticket_prefix.sql")
        .expect("ticket_prefix migration present in registry");
    let mut conn = fresh();
    platform_core::database::run(&mut conn, &ALL[..split]).unwrap();

    // A pre-existing row, written before the column existed.
    conn.execute(
        "INSERT INTO locations (id, name, tenant_id) VALUES ('legacy-loc', 'Legacy', 'default')",
        [],
    )
    .unwrap();

    platform_core::database::run(&mut conn, &ALL[split..]).unwrap();

    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(locations)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert!(
        cols.iter().any(|c| c == "ticket_prefix"),
        "locations must carry ticket_prefix after the upgrade"
    );

    let (backfilled, existing): (String, i64) = conn
        .query_row(
            "SELECT ticket_prefix, COUNT(*) FROM locations WHERE id = 'legacy-loc'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(existing, 1);
    assert_eq!(
        backfilled, "",
        "a pre-existing row must backfill to the '' no-prefix sentinel"
    );

    // The tenant-keyed partial unique index exists (f4a763aca lesson:
    // never a tenant-coupling UNIQUE over the bare column).
    let idx: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index'
             AND name = 'idx_locations_tenant_ticket_prefix'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(idx, 1, "the tenant-keyed partial unique index must exist");
}

#[test]
fn tax_rate_rounding_mode_column_pins_the_statutory_set() {
    // E1-1 (owner ruling 2026-09-10): the statutory rounding directive is a
    // per-rate column. '' = no statutory directive, so the store preference
    // applies and existing rows are unchanged; 'half_up' / 'truncate' are
    // modules_tax::models::RoundingMode's serde snake_case names (the enum's
    // rename_all, mirrored by wire_name()), so a value written through core
    // can never fail this CHECK. The schema refuses every other spelling -
    // including the plausible-but-wrong Rust-variant casings.
    let mut conn = fresh();
    run(&mut conn).unwrap();

    let (col_type, notnull, dflt): (String, i64, Option<String>) = conn
        .query_row(
            "SELECT type, \"notnull\", dflt_value FROM pragma_table_info('tax_rates')
             WHERE name = 'rounding_mode'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("tax_rates must carry rounding_mode after the migration");
    assert_eq!(col_type, "TEXT");
    assert_eq!(notnull, 1, "the directive column is NOT NULL");
    assert_eq!(
        dflt.as_deref(),
        Some("''"),
        "no directive defaults to the '' sentinel, so preference applies"
    );

    // A row written without naming the column lands on the sentinel.
    conn.execute(
        "INSERT INTO tax_rates (id, name, rate_bps) VALUES ('r-default', 'PBN 10%', 1000)",
        [],
    )
    .unwrap();
    let mode: String = conn
        .query_row(
            "SELECT rounding_mode FROM tax_rates WHERE id = 'r-default'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(mode, "", "an unwritten rounding_mode must read back as ''");

    // The full statutory set is accepted.
    for (id, mode) in [("r-half-up", "half_up"), ("r-truncate", "truncate")] {
        conn.execute(
            &format!(
                "INSERT INTO tax_rates (id, name, rate_bps, rounding_mode) VALUES ('{id}', 'PBN 10%', 1000, '{mode}')"
            ),
            [],
        )
        .unwrap_or_else(|e| panic!("'{mode}' must satisfy the CHECK: {e}"));
    }

    // Anything outside the set is refused. 'round_half_up' is the shape of a
    // plausible-but-wrong spelling (Rust-variant casing) that must never open
    // a silent third mode - the same failure class the document_kind CHECK
    // closes.
    for bad in ["round_half_up", "HALF_UP", "bankers"] {
        let attempted = conn.execute(
            &format!(
                "INSERT INTO tax_rates (id, name, rate_bps, rounding_mode) VALUES ('r-bad-{bad}', 'PBN 10%', 1000, '{bad}')"
            ),
            [],
        );
        assert!(attempted.is_err(), "'{bad}' must be refused by the CHECK");
    }
}

#[test]
fn sales_tax_estimate_note_column_pins_the_audit_stamp_shape() {
    // F2-4 (T1 dossier D64 slice 4): the per-sale audit stamp for a tax
    // computed against a non-fresh estimate. The column is NULLABLE by
    // design — legacy rows are unstamped (they were computed live under the
    // old path), and a missing stamp must never read as a claim — so there
    // is deliberately NO default and NO backfill: the absence IS the
    // answer. Pins mirror the rounding_mode pin's shape, minus the CHECK
    // (a free-text stamp accepts arbitrary content; there is no closed
    // vocabulary to enforce).
    let mut conn = fresh();
    run(&mut conn).unwrap();

    let (col_type, notnull, dflt): (String, i64, Option<String>) = conn
        .query_row(
            "SELECT type, \"notnull\", dflt_value FROM pragma_table_info('sales')
             WHERE name = 'tax_estimate_note'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("sales must carry tax_estimate_note after the migration");
    assert_eq!(col_type, "TEXT");
    assert_eq!(notnull, 0, "the stamp must be nullable — NULL = unstamped");
    assert!(
        dflt.is_none(),
        "no default: an unwritten stamp must land on NULL, not on a sentinel"
    );

    // A sale inserted WITHOUT naming the column reads back NULL — the
    // unstamped state the legacy-path invariant requires.
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count) VALUES ('s-no-stamp', 1000, 'USD', 1)",
        [],
    )
    .unwrap();
    let stamp: Option<String> = conn
        .query_row(
            "SELECT tax_estimate_note FROM sales WHERE id = 's-no-stamp'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        stamp.is_none(),
        "an unwritten tax_estimate_note must read back as NULL"
    );

    // Arbitrary text is accepted — the stamp is a free-text audit note
    // (client claim + core-verified delta), not a constrained vocabulary.
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count, tax_estimate_note) VALUES
         ('s-stamped', 1000, 'USD', 1, 'estimated 1200; verified 1180 (delta 20)')",
        [],
    )
    .unwrap();
    let stamped: String = conn
        .query_row(
            "SELECT tax_estimate_note FROM sales WHERE id = 's-stamped'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stamped, "estimated 1200; verified 1180 (delta 20)");

    // And the column survives an insert that omits it entirely — the shape
    // every pre-F2-5 writer keeps using until the stamping half lands.
    conn.execute(
        "INSERT INTO sales (id, total_minor, currency, line_count) VALUES ('s-legacy-shape', 500, 'USD', 1)",
        [],
    )
    .unwrap();
    let omitted: Option<String> = conn
        .query_row(
            "SELECT tax_estimate_note FROM sales WHERE id = 's-legacy-shape'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(omitted.is_none());
}

/// ADR #56 §2.1: a terminal the PRE-#56 wizard set up must read as provisioned
/// after 20261008, and a fresh install must stay unprovisioned.
///
/// Two independent defects are pinned here, and they are the two halves of the
/// same bug. 20261007 created `provisioning` with no backfill, so a legacy
/// device has no row and `get_first_run_state` answers `Unprovisioned`
/// (kasirmu-bridge/src/setup.rs:238-249) — an already-set-up device re-enters
/// onboarding on every boot. And the flow it lands in was invisible, because
/// the provisioning flow stylesheet animated `fade-up` without defining the keyframes:
/// `opacity: 0` plus a never-running `forwards` animation. The CSS half is a
/// stylesheet and no Rust test can see it; the SQL half is what this asserts.
///
/// The signal is `store.show_setup_wizard = 'false'`, written by exactly the two
/// retired commands (`complete_setup` step 7, `dismiss_setup_wizard`) and by
/// nothing else — no migration seeds a `settings` row, and `provision_device`
/// deliberately does not write it. Each leg below therefore fails if the backfill
/// is widened to a predicate that cannot prove the legacy scheme ran.
#[test]
fn legacy_setup_backfills_a_provisioning_row_only_for_terminals_the_wizard_set_up() {
    // Apply everything UP TO the migration under test, plant the legacy state the
    // wizard left behind, then let the runner apply this migration exactly once —
    // the real upgrade sequence, rather than a re-apply of an already-applied
    // script. Indexed by id, not by `ALL.len() - 1` (the convention
    // `legal_entity_migration_creates_defaults_and_moves_locations` records).
    let split = ALL
        .iter()
        .position(|m| m.id == "20261008_provisioning_legacy_backfill.sql")
        .expect("the legacy backfill migration is present in the registry");
    let mut conn = fresh();
    platform_core::database::run(&mut conn, &ALL[..split]).unwrap();

    // A registered terminal, as the legacy auto-register wrote it
    // (`terminals.device_id` IS the hostname the shell gates on).
    conn.execute(
        "INSERT INTO terminals (id, name, device_id) VALUES ('t-legacy', 'Legacy POS', 'legacy-host')",
        [],
    )
    .unwrap();
    // A second terminal on the SAME install, to prove the backfill is keyed per
    // terminal rather than writing one row for the whole database.
    conn.execute(
        "INSERT INTO terminals (id, name, device_id) VALUES ('t-fresh', 'Other POS', 'fresh-host')",
        [],
    )
    .unwrap();

    // The legacy-only signal the retired `complete_setup` / `dismiss_setup_wizard`
    // pair wrote. Nothing else in the tree writes this key.
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('store.show_setup_wizard', 'false')",
        [],
    )
    .unwrap();

    // The runner applies 20261008 now, once, against the legacy state above.
    platform_core::database::run(&mut conn, ALL).unwrap();

    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM provisioning", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        rows, 2,
        "one row per REGISTERED terminal — the backfill is keyed per terminal, not per install"
    );

    let (mode, region, tenant, owner, device, location): (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT mode, home_region, tenant_id, owner_user_id, device_id, location_id
             FROM provisioning WHERE terminal_id = 'legacy-host'",
            [],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(
        mode, "local",
        "the legacy install had no licence-server tenant; 'local' is §2.4's default"
    );
    assert_eq!(region, "global", "§Q6: 'no residency commitment yet'");
    assert!(
        tenant.is_none(),
        "§2.1: the local 'default' literal is a DIFFERENT namespace and must not be written here"
    );
    assert!(
        owner.is_none(),
        "the legacy owner is not identifiable from SQL; claiming one would be a guess"
    );
    assert!(
        device.is_none(),
        "device_id is a credential id the legacy install never had"
    );
    assert!(
        location.is_none(),
        "the terminal was unbound, so the correlated subquery yields NULL rather than a dangling id"
    );

    // The gate the shell actually reads: a row for this terminal.
    assert!(
        crate::Store::new(&conn)
            .is_provisioned("legacy-host")
            .unwrap(),
        "ADR #56 §2.1: this is the fact that stops a set-up device re-entering onboarding"
    );
}

/// The counter-example that makes the test above worth having: a device with NO
/// legacy signal must get NO row, however many terminals it has registered.
///
/// A wrong backfill that marks a genuinely-new device as provisioned is strictly
/// worse than the bug it fixes, so this leg is the one that fails first if the
/// predicate is ever widened (dropping the `settings` EXISTS, defaulting the
/// value comparison, or seeding the key from a migration).
#[test]
fn a_terminal_without_the_legacy_signal_is_never_backfilled() {
    let split = ALL
        .iter()
        .position(|m| m.id == "20261008_provisioning_legacy_backfill.sql")
        .expect("the legacy backfill migration is present in the registry");
    let mut conn = fresh();
    platform_core::database::run(&mut conn, &ALL[..split]).unwrap();

    conn.execute(
        "INSERT INTO terminals (id, name, device_id) VALUES ('t-new', 'New POS', 'new-host')",
        [],
    )
    .unwrap();

    // On a fresh install the key is simply ABSENT, which is the state this leg
    // pins: no row, so the flow still runs.
    platform_core::database::run(&mut conn, ALL).unwrap();

    assert!(
        !crate::Store::new(&conn).is_provisioned("new-host").unwrap(),
        "a terminal with no legacy signal must stay Unprovisioned — a forged row is the worse failure"
    );

    // Same conclusion from the other direction: a present-but-not-'false' value
    // is the wizard's "show me" state, not a completion.
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('store.show_setup_wizard', 'true')",
        [],
    )
    .unwrap();
    platform_core::database::run(&mut conn, ALL).unwrap();
    assert!(
        !crate::Store::new(&conn).is_provisioned("new-host").unwrap(),
        "only 'false' is the dismissal the retired commands wrote; 'true' must not backfill"
    );

    // And the `store.setup_complete` key the CLI writes is a DIFFERENT key — it
    // must not be mistaken for the legacy dismissal either.
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('store.setup_complete', 'true')",
        [],
    )
    .unwrap();
    platform_core::database::run(&mut conn, ALL).unwrap();
    assert!(
        !crate::Store::new(&conn).is_provisioned("new-host").unwrap(),
        "store.setup_complete is not the legacy dismissal key and must not backfill"
    );
}

// ── COR-27 / C18 P1.3: the open-shift invariant at the DATABASE level ──

/// The registry position of the migration under test, so the pre-index leg
/// below is expressed as "everything except this migration" rather than as a
/// brittle \`ALL.len() - 1\`.
fn open_shift_uniqueness_position() -> usize {
    ALL.iter()
        .position(|m| m.id == "20261011_open_shift_uniqueness.sql")
        .expect("20261011_open_shift_uniqueness.sql must be registered")
}

/// The migration's own SQL, read from the registry — never re-typed here, so
/// the test cannot drift from the file it pins.
fn open_shift_uniqueness_sql() -> &'static str {
    ALL[open_shift_uniqueness_position()].sql
}

/// One user, so a raw \`shifts\` INSERT has a row for its FK to resolve.
fn seed_shift_user(conn: &rusqlite::Connection, user_id: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO roles (id, name) VALUES ('role-osu', 'Open Shift Test')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id)
         VALUES (?1, ?2, 'not-used', 'Open Shift Test', 'role-osu')",
        rusqlite::params![user_id, format!("u-{user_id}")],
    )
    .unwrap();
}

/// 1. A fresh database accepts the index, and it is the PARTIAL one — the
///    \`WHERE status = 'open'\` clause is in the stored SQL, so closed shifts
///    are outside the constraint (a table-wide UNIQUE would refuse the second
///    day's shift). \`migration_surface_pins\` covers the count; this pins the
///    shape.
#[test]
fn open_shift_uniqueness_index_is_partial_on_open_status() {
    let mut conn = fresh();
    run(&mut conn).unwrap();

    let sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_shifts_open_per_user'",
            [],
            |r| r.get(0),
        )
        .expect("idx_shifts_open_per_user must exist after the full registry runs");

    let normalized = sql.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(
        normalized.contains("UNIQUE INDEX"),
        "the guard must be UNIQUE, got: {sql}"
    );
    assert!(
        normalized.contains("shifts(user_id)"),
        "the guard must be keyed on shifts(user_id), got: {sql}"
    );
    assert!(
        normalized.contains("WHERE status = 'open'"),
        "the guard must be PARTIAL on status='open'; without that clause a user could \
         never open a second day's shift, got: {sql}"
    );
}

/// 2. THE GUARD BITES, proved through raw SQL so it is the INDEX under test and
///    not \`Store::open_shift\`.
///
///    Leg A is the negative control and the reason this test is honest: the same
///    statement runs against a database built from the registry WITHOUT this
///    migration and SUCCEEDS there. So the refusal in leg B comes from the index
///    and from nothing else in the schema. Leg B then requires the raw INSERT to
///    be refused and pins both exemptions the partial clause exists for: another
///    user, and the same user after the first shift is closed.
#[test]
fn open_shift_uniqueness_index_bites_on_raw_sql() {
    const DUPLICATE_INSERT: &str = "INSERT INTO shifts (id, user_id) VALUES (?1, ?2)";

    // ── Leg A: BEFORE the index exists, the raw duplicate is ACCEPTED. ──
    {
        let mut conn = fresh();
        let split = open_shift_uniqueness_position();
        platform_core::database::run(&mut conn, &ALL[..split]).unwrap();
        seed_shift_user(&conn, "user-open");

        conn.execute(DUPLICATE_INSERT, rusqlite::params!["shift-a", "user-open"])
            .expect("pre-index control: nothing in the schema forbids this row");
        conn.execute(DUPLICATE_INSERT, rusqlite::params!["shift-b", "user-open"])
            .expect("pre-index control: this second open shift is the defect being closed");

        let open: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM shifts WHERE user_id = 'user-open' AND status = 'open'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            open, 2,
            "the negative control must actually reproduce the defect"
        );
    }

    // ── Leg B: WITH the index, the same raw statement is refused. ──
    let mut conn = fresh();
    run(&mut conn).unwrap();
    seed_shift_user(&conn, "user-open");
    seed_shift_user(&conn, "user-other");

    // The first open shift is written with no explicit status at all, so this
    // also pins that the column DEFAULT (and the CHECK constraint's spelling) is
    // exactly the literal the index's WHERE clause matches. A WHERE clause that
    // did not match the rows writers actually produce would pass a naive test
    // but fail here.
    conn.execute(DUPLICATE_INSERT, rusqlite::params!["shift-a", "user-open"])
        .unwrap();

    let err = conn
        .execute(DUPLICATE_INSERT, rusqlite::params!["shift-b", "user-open"])
        .expect_err("a second open shift for the same user must be refused by the INDEX");
    assert!(
        matches!(
            &err,
            rusqlite::Error::SqliteFailure(e, _) if e.code == rusqlite::ErrorCode::ConstraintViolation
        ),
        "expected a UNIQUE constraint violation, got: {err}"
    );
    assert!(
        err.to_string().contains("shifts.user_id"),
        "the refusal must name the guarded column, got: {err}"
    );

    // Exemption 1: another user is untouched by the constraint.
    conn.execute(DUPLICATE_INSERT, rusqlite::params!["shift-c", "user-other"])
        .expect("the guard is per user, not global");

    // Exemption 2: closing the first shift releases the user — a closed row
    // leaves the partial index entirely.
    conn.execute(
        "UPDATE shifts SET status = 'closed' WHERE id = 'shift-a'",
        [],
    )
    .unwrap();
    conn.execute(DUPLICATE_INSERT, rusqlite::params!["shift-d", "user-open"])
        .expect("a closed shift must not block the next open for that user");

    let open: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM shifts WHERE user_id = 'user-open' AND status = 'open'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        open, 1,
        "one open shift per user, after the refusals and the exemptions"
    );
}

/// 3. THE MIGRATION CANNOT BRICK AN EXISTING STORE.
///
///    A store written before \`open_shift\` was atomic can already hold two open
///    shifts for one user. If the CREATE ran against that state it would fail,
///    and the app would not start — so the reconciliation must close the extras
///    FIRST. This test builds the FINAL schema (the whole registry), plants the
///    duplicate exactly as such a store would hold it, and then re-applies this
///    migration's own statements — the same replay the drift path performs on a
///    real database whose migration file was edited, and the only order in which
///    the reconciliation sees the final schema.
#[test]
fn open_shift_uniqueness_migration_reconciles_pre_existing_duplicates() {
    let mut conn = fresh();
    run(&mut conn).unwrap();
    seed_shift_user(&conn, "user-legacy");

    // Simulate the pre-fix store: drop the guard, then write the duplicate.
    conn.execute("DROP INDEX idx_shifts_open_per_user", [])
        .unwrap();
    conn.execute_batch(
        "INSERT INTO shifts (id, user_id, opened_at, created_at, updated_at, status) VALUES
           ('legacy-old', 'user-legacy', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 'open'),
           ('legacy-new', 'user-legacy', '2025-01-02T00:00:00.000Z', '2025-01-02T00:00:00.000Z', '2025-01-02T00:00:00.000Z', 'open');",
    )
    .unwrap();

    // Re-apply the migration: it must reconcile and then build the index.
    conn.execute_batch(open_shift_uniqueness_sql())
        .expect("the migration must not fail on a store that already holds duplicates");

    // The survivor is the most recently opened row — deterministic.
    let survivors: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM shifts WHERE user_id = 'user-legacy' AND status = 'open'")
            .unwrap();
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    };
    assert_eq!(
        survivors,
        vec!["legacy-new".to_string()],
        "the most recently opened shift must survive, deterministically"
    );

    // The loser is closed, NOT deleted, and no figure is invented: the counted
    // cash columns stay NULL (the schema's own "never counted" signal) and the
    // reason is stamped into notes.
    let (status, closing, expected, difference, notes): (
        String,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        String,
    ) = conn
        .query_row(
            "SELECT status, closing_balance_minor, expected_cash_minor, cash_difference_minor, notes
               FROM shifts WHERE id = 'legacy-old'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();
    assert_eq!(status, "closed", "the loser is closed rather than dropped");
    assert_eq!(closing, None, "no closing balance may be invented");
    assert_eq!(expected, None, "no expected cash may be invented");
    assert_eq!(difference, None, "no cash difference may be invented");
    assert!(
        notes.contains("auto-closed"),
        "the reconciliation must leave an auditable reason, got: {notes}"
    );

    // And the index the reconciliation exists to protect is in place, so a
    // third duplicate is refused.
    let err = conn
        .execute(
            "INSERT INTO shifts (id, user_id) VALUES ('legacy-third', 'user-legacy')",
            [],
        )
        .expect_err("the index must exist after the re-apply");
    assert!(
        matches!(err, rusqlite::Error::SqliteFailure(_, _)),
        "expected a constraint violation, got: {err}"
    );
}
/// C10b / D11: the negative-stock backstop, and the reason it is a TRIGGER.
///
/// The condition is a cross-row predicate — "may THIS location hold a negative
/// qty?" is answered by `workspace_inventory_locations.allow_negative_stock`, a
/// different table keyed by `location_id`. No table CHECK can express that, and
/// the unconditional `CHECK (qty >= 0)` the review proposed was measured to be
/// WRONG: it silently re-enables the Layer-1 guard the flag exists to opt out
/// of, failing `negative_stock_event_fires_when_allow_negative_enabled`.
///
/// Both directions, both through RAW SQL, so the TRIGGER is under test and not
/// `Store::adjust_stock_at_location_with_reason`:
///
/// * a binding that did NOT opt in is REFUSED (the backstop bites), on the
///   INSERT arm AND on the UPDATE arm — the latter is what the upsert both
///   writers use actually fires once the row exists;
/// * a binding that DID opt in is ACCEPTED (the feature still works);
/// * a location with NO binding at all is ACCEPTED, which is the refinement
///   that keeps `deactivate_inventory_location_with_negative_stock_errors`
///   passing: the flag is a per-BINDING opt-out, so a location with no binding
///   has no opt-out to violate, and Rust Layer 1 already refuses negatives on
///   that path.
#[test]
fn stock_summary_negative_guard_is_conditional_on_the_binding() {
    let mut conn = fresh();
    run(&mut conn).unwrap();

    // A product, and three locations: bound-without-opt-in, bound-with-opt-in,
    // and unbound. Locations are created through the real API so the fixture
    // matches what a store actually holds (it writes no binding).
    let s = crate::db::Store::new(&conn);
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES ('prod-c10b', 'SKU-C10B', 'C10b', 100, 'USD', 'retail')",
        [],
    )
    .unwrap();
    let bound_no = s
        .create_inventory_location("Bound No", "store", "")
        .unwrap();
    let bound_yes = s
        .create_inventory_location("Bound Yes", "store", "")
        .unwrap();
    let unbound = s.create_inventory_location("Unbound", "store", "").unwrap();

    // A workspace instance plus one binding per bound location. The instance's
    // `location_id` is the STORE profile (NOT NULL FK), not an inventory
    // location — the same shape `db/inventory_tests.rs:61` uses.
    conn.execute(
        "INSERT OR IGNORE INTO workspace_types (key, name) VALUES ('retail', 'Retail POS')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO locations (id, name) VALUES ('loc-c10b', 'C10b Site')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO workspace_instances (id, type_key, location_id, name) \
         VALUES ('ws-c10b', 'retail', 'loc-c10b', 'C10b')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO workspace_inventory_locations \
             (id, instance_id, location_id, is_primary, allow_negative_stock, sort_order) \
         VALUES ('wil-c10b-no', 'ws-c10b', ?1, 0, 0, 0), \
                ('wil-c10b-yes', 'ws-c10b', ?2, 0, 1, 1)",
        rusqlite::params![bound_no, bound_yes],
    )
    .unwrap();

    const INSERT_NEGATIVE: &str = "INSERT INTO stock_summary (item_id, location_id, qty) \
                                   VALUES ('prod-c10b', ?1, ?2)";

    // -- Direction 1: the backstop BITES on a binding that did not opt in. --
    let err = conn
        .execute(INSERT_NEGATIVE, rusqlite::params![&bound_no, -3])
        .expect_err("a negative qty at a non-opted-in binding must be refused by the TRIGGER");
    assert!(
        matches!(
            &err,
            rusqlite::Error::SqliteFailure(e, _) if e.code == rusqlite::ErrorCode::ConstraintViolation
        ),
        "expected a constraint violation, got: {err}"
    );
    assert!(
        err.to_string().contains("allow_negative_stock"),
        "the refusal must name the flag it defers to, got: {err}"
    );

    // The UPDATE arm: seed a non-negative row, then drive it below zero. This
    // is the `INSERT ... ON CONFLICT DO UPDATE` shape the writers use.
    conn.execute(INSERT_NEGATIVE, rusqlite::params![&bound_no, 1])
        .expect("a non-negative qty is always allowed");
    let err = conn
        .execute(
            "UPDATE stock_summary SET qty = -1 WHERE item_id = 'prod-c10b' AND location_id = ?1",
            rusqlite::params![&bound_no],
        )
        .expect_err("driving an existing row below zero must be refused by the UPDATE arm");
    assert!(
        err.to_string().contains("allow_negative_stock"),
        "the UPDATE arm must give the same refusal, got: {err}"
    );

    // -- Direction 2: the feature still works. --
    conn.execute(INSERT_NEGATIVE, rusqlite::params![&bound_yes, -3])
        .expect("a binding that opted in must still be able to hold negative stock");
    // ...including through the upsert, which fires only the UPDATE arm.
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES ('prod-c10b', ?1, -9) \
         ON CONFLICT(item_id, location_id) DO UPDATE SET qty = excluded.qty",
        rusqlite::params![&bound_yes],
    )
    .expect("the opted-in upsert must pass");

    // -- The refinement: no binding means no opt-out to violate. --
    conn.execute(INSERT_NEGATIVE, rusqlite::params![&unbound, -3])
        .expect(
            "a location with NO binding has no opt-out to violate; refusing here would \
             break deactivate_inventory_location_with_negative_stock_errors",
        );

    let stored: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = 'prod-c10b' AND location_id = ?1",
            rusqlite::params![&bound_yes],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, -9, "the opted-in value must be stored verbatim");
}

/// C10b / D11: the trigger is the CONDITIONAL form, not the blanket CHECK the
/// review proposed — pinned by reading the schema, so a later edit that
/// "simplifies" it to an unconditional `qty >= 0` fails here rather than in
/// production. Also pins that no blanket repair rode along: existing negative
/// rows are legitimate oversells (D11) and must survive the migration.
#[test]
fn stock_summary_negative_guard_is_not_an_unconditional_check() {
    let mut conn = fresh();
    run(&mut conn).unwrap();

    // The table DDL must NOT carry a blanket CHECK on qty.
    let table_sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stock_summary'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        !table_sql.contains("qty >= 0"),
        "an unconditional CHECK would re-enable the guard allow_negative_stock \
         exists to opt out of, got: {table_sql}"
    );

    // Both arms exist and both defer to the binding.
    for name in [
        "stock_summary_qty_nonnegative_insert",
        "stock_summary_qty_nonnegative_update",
    ] {
        let sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?1",
                rusqlite::params![name],
                |r| r.get(0),
            )
            .unwrap_or_else(|e| panic!("{name} must exist after the registry runs: {e}"));
        let normalized = sql.split_whitespace().collect::<Vec<_>>().join(" ");
        assert!(
            normalized.contains("NEW.qty < 0"),
            "{name} must be conditional on a negative NEW.qty, got: {sql}"
        );
        assert!(
            normalized.contains("allow_negative_stock = 1"),
            "{name} must defer to the binding opt-in, got: {sql}"
        );
        assert!(
            normalized.contains("workspace_inventory_locations"),
            "{name} must consult the binding table, got: {sql}"
        );
    }

    // No blanket repair: a pre-existing negative row is an oversell, not
    // corruption, and nothing in the migration may rewrite it.
    let quarantine_tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' \
               AND name = 'stock_summary_negative_quarantine'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        quarantine_tables, 0,
        "D11: no quarantine table — existing negatives are legitimate and are never repaired"
    );
}
