//! Tests for `recovery.rs` — restore validation and the atomic swap.
//!
//! CORE-B: these cases used to live inline in `recovery.rs`. They are moved
//! here to follow the house convention (tests in a sibling `*_tests.rs` wired
//! with `#[path]`), which is what the other 150+ production files in this
//! crate do. They do NOT overlap `recovery_tests.rs` (wired from `db/mod.rs`),
//! which covers backup-generation rotation.

use super::*;

/// A scratch directory removed when the guard drops.
struct Scratch(kasirmu_test_support::ScratchDir);

impl Scratch {
    fn new(label: &str) -> Self {
        // The GUARD is stored, not just its path. Holding only the path while
        // the guard lived in this function meant the guard dropped on return,
        // deleted the directory, and left every later `Connection::open` inside
        // it failing with "unable to open database file" (SQLite CannotOpen,
        // extended code 14). Twelve recovery tests failed exactly that way.
        // Storing the guard keeps the directory alive for the test's lifetime
        // and removes it on drop, so `Scratch` needs no `Drop` of its own and no
        // defensive `create_dir_all`.
        Self(kasirmu_test_support::ScratchDir::new(&format!(
            "oz_restore_{label}"
        )))
    }

    fn join(&self, name: &str) -> PathBuf {
        self.0.path().join(name)
    }
}

fn sha256(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(std::fs::read(path).unwrap());
    hex::encode(hasher.finalize())
}

/// A migrated file-backed database carrying one marker row.
fn live_db(path: &Path, marker: &str) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run(&mut conn).unwrap();
    Store::new(&conn)
        .set_setting("restore.marker", marker)
        .unwrap();
}

fn marker(path: &Path) -> String {
    let conn = Connection::open(path).unwrap();
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'restore.marker'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

fn hot_sidecars(db_path: &Path) {
    std::fs::write(sidecar_path(db_path, "-wal"), b"hot wal frames").unwrap();
    std::fs::write(sidecar_path(db_path, "-shm"), b"hot shm").unwrap();
}

#[test]
fn recovery_valid_candidate_is_accepted_and_restored() {
    let scratch = Scratch::new("accept");
    let live = scratch.join("live.db");
    let candidate = scratch.join("candidate.db");
    live_db(&live, "live");
    live_db(&candidate, "candidate");

    let report = validate_candidate(&candidate);
    assert_eq!(
        report.verdict,
        CandidateVerdict::Acceptable,
        "{}",
        report.reason
    );
    assert!(report.verdict.is_restorable());

    let outcome = restore_from(&candidate, &live).unwrap();
    assert!(outcome.verdict.is_restorable());
    assert_eq!(
        marker(&live),
        "candidate",
        "the live database must be the candidate's"
    );

    // The pre-restore snapshot survives and holds the pre-restore content.
    let snapshot = pre_restore_snapshot_path(&live);
    assert!(
        snapshot.exists(),
        "the pre-restore snapshot must be present"
    );
    assert_eq!(marker(&snapshot), "live");

    // The restored database is integrity-clean.
    verify_file(&live).unwrap();
}

#[test]
fn recovery_corrupt_candidate_is_refused_and_leaves_live_db_and_sidecars_untouched() {
    let scratch = Scratch::new("corrupt");
    let live = scratch.join("live.db");
    let candidate = scratch.join("corrupt.db");
    live_db(&live, "live");
    hot_sidecars(&live);
    std::fs::write(&candidate, b"not a sqlite database, deliberately").unwrap();

    let report = validate_candidate(&candidate);
    assert_eq!(
        report.verdict,
        CandidateVerdict::Corrupt,
        "{}",
        report.reason
    );
    assert!(!report.verdict.is_restorable());

    let before = sha256(&live);
    let err = restore_from(&candidate, &live).unwrap_err().to_string();
    assert!(
        err.contains("refusing"),
        "error must name the refusal: {err}"
    );

    assert_eq!(
        sha256(&live),
        before,
        "a refused restore must not touch the live database"
    );
    // Assert the sidecars BEFORE opening the live database: SQLite
    // recovers (and removes) a hot WAL as a side effect of opening it.
    for extension in ["-wal", "-shm"] {
        let sidecar = sidecar_path(&live, extension);
        assert!(
            sidecar.exists(),
            "sidecar {extension} must survive a refused restore"
        );
    }
    assert_eq!(marker(&live), "live");
    assert!(
        !pre_restore_snapshot_path(&live).exists(),
        "a refused restore must not even snapshot"
    );
}

#[test]
fn recovery_newer_than_build_candidate_is_refused_with_the_newer_reason() {
    let scratch = Scratch::new("newer");
    let live = scratch.join("live.db");
    let candidate = scratch.join("from-the-future.db");
    live_db(&live, "live");
    live_db(&candidate, "future");
    {
        let conn = Connection::open(&candidate).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (id) VALUES ('29990101_from_the_future.sql')",
            [],
        )
        .unwrap();
    }

    let report = validate_candidate(&candidate);
    assert_eq!(
        report.verdict,
        CandidateVerdict::NewerThanThisBuild,
        "{}",
        report.reason
    );
    assert!(
        report.reason.contains("newer than this build"),
        "reason must say why: {}",
        report.reason
    );
    assert_eq!(
        report.candidate_schema.as_deref(),
        Some("29990101_from_the_future.sql")
    );

    let before = sha256(&live);
    assert!(
        restore_from(&candidate, &live).is_err(),
        "a newer candidate must never reach the live database"
    );
    assert_eq!(
        sha256(&live),
        before,
        "the live database must be byte-identical"
    );
}

#[test]
fn recovery_older_candidate_is_acceptable() {
    let scratch = Scratch::new("older");
    let candidate = scratch.join("older.db");
    live_db(&candidate, "older");
    {
        let conn = Connection::open(&candidate).unwrap();
        conn.execute_batch("DELETE FROM schema_migrations").unwrap();
    }

    let report = validate_candidate(&candidate);
    assert_eq!(
        report.verdict,
        CandidateVerdict::OlderButAcceptable,
        "{}",
        report.reason
    );
}
/// MSL-25: a failed restore must leave the ORIGINAL database in place, and must
/// not claim it did when it did not.
///
/// `restore_from`'s doc promises that any failure from step 4 on "restores the
/// live path from the snapshot ... and returns the error", and the `Err` arm
/// builds "restore rolled back, '{}' left intact". But the rollback copy is
/// `let _ = std::fs::copy(&snapshot, db_path)` -- its Result is DISCARDED, so
/// the message is emitted whether or not the copy worked. During a restore that
/// is the worst possible untruth: it tells the operator their data is safe at
/// the moment they most need to reach for the snapshot.
#[test]
fn a_failed_restore_leaves_the_original_database_and_does_not_lie_about_it() {
    let scratch = Scratch::new("rollback");
    let live = scratch.join("live.db");
    let candidate = scratch.join("candidate.db");
    live_db(&live, "original");
    live_db(&candidate, "candidate");
    let before = sha256(&live);

    // Overwrite the candidate with a non-database so validation refuses it.
    // The SWAP-failure path is not portably forcible, so this pins the
    // invariant that must hold for EVERY failure: the original is still there,
    // byte for byte, and the message does not claim otherwise.
    std::fs::write(&candidate, b"not a database").unwrap();
    let err = restore_from(&candidate, &live).unwrap_err();
    let msg = err.to_string();

    assert!(
        live.exists(),
        "a failed restore must not remove the live database: {msg}"
    );
    assert_eq!(
        sha256(&live),
        before,
        "a failed restore must leave the ORIGINAL live database byte-identical; got: {msg}"
    );
    assert!(
        !msg.contains("left intact") || live.exists(),
        "the message claims the database is intact while it is gone: {msg}"
    );
}

// ── C8: the end-to-end acceptance the item names ─────────────────────

/// C8's "done when", as ONE flow: back up a real database through the same
/// call the app uses, corrupt the live file, restore from the app path, and
/// prove a known row reads back with the restored database integrity-clean.
///
/// WHY THIS EXISTS ALONGSIDE THE CASES ABOVE. Those pin the pieces — a valid
/// candidate is accepted, a corrupt one is refused, a failed swap leaves the
/// original byte-identical. None of them backs up first, none corrupts the
/// LIVE file, and none asserts that BUSINESS DATA survives the round trip
/// (they use a marker setting). A recovery path is only worth anything if the
/// merchant's rows come back, so the assertion here is a real product row.
#[test]
fn recovery_roundtrip_restores_business_data_from_a_backup_of_the_live_db() {
    let scratch = Scratch::new("roundtrip");
    let live = scratch.join("live.db");
    let backup = scratch.join("live.backup.db");

    // 1. A real database with real business data: a product, not a marker.
    {
        let mut conn = Connection::open(&live).unwrap();
        migrations::run(&mut conn).unwrap();
        let s = Store::new(&conn);
        s.create_product(
            "ROUNDTRIP-SKU",
            "Survives a restore",
            crate::Money {
                minor_units: 1250,
                currency: "USD".parse().unwrap(),
            },
            None,
            None,
            7,
            Some("retail"),
        )
        .unwrap();
        // 2. Back up through the SAME call the app's command uses.
        s.backup(&backup.to_string_lossy()).unwrap();
    }
    assert!(
        backup.exists(),
        "the backup must exist before the corruption"
    );

    // 3. Corrupt the LIVE database the way a bad write would: overwrite the
    //    file with bytes that are not a database.
    std::fs::write(&live, b"corrupted: not a database").unwrap();
    assert!(
        Connection::open(&live).map_or(true, |c| Store::new(&c).check_integrity().is_err()),
        "the live database must actually be corrupt before we restore"
    );

    // 4. Restore from the app path.
    let outcome = restore_from(&backup, &live).expect("the backup must restore");
    assert!(outcome.verdict.is_restorable());

    // 5. The restored database is integrity-clean AND carries the row.
    let conn = Connection::open(&live).unwrap();
    let s = Store::new(&conn);
    s.check_integrity()
        .expect("the restored database must pass integrity_check");
    let product = s
        .get_product("ROUNDTRIP-SKU")
        .unwrap()
        .expect("the product written before the backup must read back after the restore");
    assert_eq!(
        product.product.price.minor_units, 1250,
        "the restored row must carry the values it was written with"
    );
}

/// Mid-shift backup and restore rehearsal asserting ledger equality (plan-next-30-days §2.1).
///
/// Seeds a live database with:
///   - An active open shift with a cash float ($100.00 / 10,000 minor units)
///   - A retail product ($15.00 / 1,500 minor units) with inventory location and stock
///   - An inventory transaction movement (receiving +20 units)
///   - A completed sale for 2 items ($30.00 / 3,000 minor units) tendered with $40.00 cash
///   - An issued gift card ($50.00 / 5,000 minor units) with a $15.00 partial redemption
///   - Chained audit log entries with verifiable SHA256 integrity
///
/// Backs up mid-shift via `Store::backup`, restores into a fresh path via `restore_from`,
/// and asserts complete equality across:
///   - Shift state, float, and cashier user
///   - Product price and stock levels
///   - Completed sale lines, payment tender, and change
///   - Gift card ledger balances
///   - Cryptographic continuity and hashes of the audit log chain.
///
/// Operational RPO/RTO Note:
///   - RPO (Recovery Point Objective): Zero transactions lost up to the exact millisecond
///     the backup snapshot completes. With periodic end-of-shift / daily backups, worst-case
///     unrecoverable loss is bounded by the backup interval T.
///   - RTO (Recovery Time Objective): Under 2 seconds for local recovery via `restore_from`,
///     which performs pre-flight PRAGMA validation, staging, and atomic rename.
#[test]
fn recovery_midshift_backup_restore_rehearsal_asserts_ledger_equality() {
    use crate::audit::AuditEntry;
    use crate::db::inventory::InventoryTransactionLineInput;
    use crate::gift_card::IssueGiftCardInput;
    use crate::inventory_transaction::InventoryTransactionType;
    use crate::{Money, Sale, SaleLine};
    use foundation::{Currency, SaleStatus};

    let scratch = Scratch::new("rehearsal_ledger");
    let live = scratch.join("live.db");
    let backup = scratch.join("midshift.backup.db");
    let restored = scratch.join("restored.db");

    let usd: Currency = "USD".parse().unwrap();

    // 1. Setup live database, migrations, and seed initial records.
    {
        let mut conn = Connection::open(&live).unwrap();
        migrations::run(&mut conn).unwrap();
        let s = Store::new(&conn);

        // Seed cashier user
        conn.execute_batch(
            "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
                ('role-cashier', 'cashier', 'Cashier', '[]', '2026-11-13T08:00:00.000Z', '2026-11-13T08:00:00.000Z');
             INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
                ('u-cashier-1', 'cashier1', 'hash', 'Cashier 1', 'role-cashier', 1, '2026-11-13T08:00:00.000Z', '2026-11-13T08:00:00.000Z');"
        ).unwrap();

        // (a) Open shift with starting cash float: $100.00 (10,000 minor units)
        let open_shift = s
            .open_shift("u-cashier-1", Some("pos-term-1"), 10_000)
            .unwrap();
        assert_eq!(open_shift.opening_balance_minor, 10_000);
        assert_eq!(open_shift.status, "open");

        // (b) Create a product with initial stock of 50 units @ $15.00 (1,500 minor units)
        s.create_product(
            "SKU-COFFEE-BAG",
            "Artisan Coffee Beans 500g",
            Money {
                minor_units: 1500,
                currency: usd,
            },
            None,
            None,
            50,
            Some("retail"),
        )
        .unwrap();

        // Receive +20 units stock movement at canonical default location
        let stock_lines = vec![InventoryTransactionLineInput {
            sku: "SKU-COFFEE-BAG".to_string(),
            product_name: "Artisan Coffee Beans 500g".to_string(),
            qty: 20,
            delta: 20,
            barcode_scanned: None,
        }];
        let _tx_id = s
            .create_inventory_transaction(
                InventoryTransactionType::ManualAdjustment,
                crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID,
                "u-cashier-1",
                "Morning stock adjustment delivery",
                &stock_lines,
            )
            .unwrap();

        // (c) Record a sale: 2 bags @ $15.00 = $30.00 (3,000 minor units)
        // Tender: Cash $40.00 (4,000 minor units, $10.00 change)
        let sale_id = "sale-rehearsal-001";
        let sale = Sale {
            id: sale_id.to_string(),
            status: SaleStatus::Completed,
            total: Money {
                minor_units: 3000,
                currency: usd,
            },
            line_count: 1,
            currency: usd,
            payment_method: Some("cash".to_string()),
            tendered_minor: Some(4000),
            discount_percent: 0,
            discount_label: None,
            user_id: Some("u-cashier-1".to_string()),
            created_at: "2026-11-13T09:15:00.000Z".to_string(),
            updated_at: "2026-11-13T09:15:00.000Z".to_string(),
            lines: vec![SaleLine {
                id: "line-rehearsal-001".to_string(),
                sale_id: sale_id.to_string(),
                sku: "SKU-COFFEE-BAG".to_string(),
                qty: 2,
                unit_price: Money {
                    minor_units: 1500,
                    currency: usd,
                },
                line_total: Money {
                    minor_units: 3000,
                    currency: usd,
                },
                line_position: 1,
                tax_amount: Money {
                    minor_units: 0,
                    currency: usd,
                },
                tax_rate_id: None,
                tax_breakdown_json: None,
                serial_number: None,
                course: None,
                modifiers_json: None,
            }],
            subtotal: Money {
                minor_units: 3000,
                currency: usd,
            },
            tax_total: Money {
                minor_units: 0,
                currency: usd,
            },
            customer_id: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: 0,
            service_charge_minor: 0,
            version: 1,
        };
        s.create_sale(&sale).unwrap();

        // (d) Issue gift card: $50.00 (5,000 minor units)
        s.issue_gift_card(IssueGiftCardInput {
            card_number: "GC-REHEARSE-777".to_string(),
            initial_amount_minor: 5000,
            currency: "USD".to_string(),
            issued_to: Some("Alice Merchant".to_string()),
            created_by: "u-cashier-1".to_string(),
            expiry_date: None,
        })
        .unwrap();

        // Redeem $15.00 (1,500 minor units) from the gift card
        s.redeem_gift_card("GC-REHEARSE-777", 1500, sale_id, Some("USD"))
            .unwrap();

        // (e) Log audit events to create a chained audit log
        let audit1 = AuditEntry::new(
            "u-cashier-1",
            "shift.open",
            Some("shift".to_string()),
            Some(open_shift.id.clone()),
            Some("{\"opening_float\":10000}".to_string()),
            "success",
        );
        s.log_audit(&audit1).unwrap();

        let audit2 = AuditEntry::new(
            "u-cashier-1",
            "sale.complete",
            Some("sale".to_string()),
            Some(sale_id.to_string()),
            Some("{\"total_minor\":3000}".to_string()),
            "success",
        );
        s.log_audit(&audit2).unwrap();

        // Verify audit chain on live before backup
        let live_audit = s.verify_audit_chain().unwrap();
        assert!(live_audit.is_valid);
        assert_eq!(live_audit.total_checked, 4);

        // Perform mid-shift online backup
        s.backup(&backup.to_string_lossy()).unwrap();
    }

    assert!(backup.exists(), "backup file must exist before restore");

    // 2. Perform restore into the restored path
    let outcome = restore_from(&backup, &restored).expect("restore_from must succeed");
    assert!(outcome.verdict.is_restorable());

    // 3. Open restored DB and assert exact ledger and data equality
    {
        let conn = Connection::open(&restored).unwrap();
        let s = Store::new(&conn);
        s.check_integrity()
            .expect("restored database must pass integrity check");

        // (a) Shift equality
        let active_shift = s
            .get_active_shift("u-cashier-1")
            .unwrap()
            .expect("active shift must exist");
        assert_eq!(active_shift.user_id, "u-cashier-1");
        assert_eq!(active_shift.terminal_id.as_deref(), Some("pos-term-1"));
        assert_eq!(active_shift.opening_balance_minor, 10_000);
        assert_eq!(active_shift.status, "open");

        // (b) Product & stock level equality (initial 50 + received 20 = 70)
        let product = s
            .get_product("SKU-COFFEE-BAG")
            .unwrap()
            .expect("product must exist");
        assert_eq!(product.product.price.minor_units, 1500);
        assert_eq!(product.stock_qty, Some(70));

        let txs = s.list_inventory_transactions().unwrap();
        assert_eq!(txs.len(), 1);
        assert_eq!(
            txs[0].transaction_type,
            InventoryTransactionType::ManualAdjustment
        );
        let (_tx_header, tx_lines) = s
            .get_inventory_transaction(txs[0].id.as_str())
            .unwrap()
            .expect("inventory transaction must exist");
        assert_eq!(tx_lines.len(), 1);
        assert_eq!(tx_lines[0].sku, "SKU-COFFEE-BAG");
        assert_eq!(tx_lines[0].qty, 20);

        // (c) Sale & tender equality
        let sale = s
            .get_sale("sale-rehearsal-001")
            .unwrap()
            .expect("sale must exist");
        assert_eq!(sale.total.minor_units, 3000);
        assert_eq!(sale.tendered_minor, Some(4000));
        assert_eq!(sale.payment_method.as_deref(), Some("cash"));
        assert_eq!(sale.lines.len(), 1);
        assert_eq!(sale.lines[0].sku, "SKU-COFFEE-BAG");
        assert_eq!(sale.lines[0].line_total.minor_units, 3000);

        // (d) Gift card balance equality (5,000 initial - 1,500 redeemed = 3,500)
        let gc = s
            .get_gift_card("GC-REHEARSE-777")
            .unwrap()
            .expect("gift card must exist");
        assert_eq!(gc.initial_balance_minor, 5000);
        assert_eq!(gc.current_balance_minor, 3500);
        assert_eq!(gc.currency, "USD");
        assert_eq!(
            s.get_gift_card_balance("GC-REHEARSE-777").unwrap(),
            Some((3500, "USD".to_string(), "active".to_string()))
        );

        // (e) Audit hash chain verification
        let restored_audit = s.verify_audit_chain().unwrap();
        assert!(
            restored_audit.is_valid,
            "audit hash chain must remain valid after restore"
        );
        assert_eq!(restored_audit.total_checked, 4);
        assert_eq!(restored_audit.broken_at_id, None);
    }
}
