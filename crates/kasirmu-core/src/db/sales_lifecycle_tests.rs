//! Unit tests for the shortfall-resolved settlement door (complete_sale_with_resolved_shortfalls).
//!
//! In-transaction audit row coverage (PCI 10.2.1): the audit row is
//! written at the outbox seat, inside the settlement transaction, so it
//! commits or rolls back with the sale, and AuditLogHandler's
//! has_audit_row_for probe keeps the post-commit handler from doubling it.

use super::*;
use crate::migrations;
use crate::{Cart, CartLine, Sku};
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

fn audit_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))
        .unwrap()
}

fn sale_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
        .unwrap()
}

/// Seed a stocked retail product at the canonical default location, so the
/// door's Phase-1 stock check passes without shortfalls.
/// A file-backed migrated DB, for the two-connection race below.
///
/// Mirrors `gift_cards_tests::fresh_file`: the in-memory `fresh()` cannot be
/// opened twice, and a race needs two real connections on one file.
fn fresh_file(dir: &std::path::Path) -> Connection {
    std::fs::create_dir_all(dir).unwrap();
    let path = dir.join("kasir.db");
    let mut file_conn = Connection::open(&path).unwrap();
    {
        let template = migrations::fresh_db();
        let backup = rusqlite::backup::Backup::new(&template, &mut file_conn).unwrap();
        backup
            .run_to_completion(10, std::time::Duration::from_millis(0), None)
            .unwrap();
    }
    file_conn
        .pragma_update(None, "journal_mode", "WAL")
        .unwrap();
    file_conn
        .pragma_update(None, "busy_timeout", "5000")
        .unwrap();
    file_conn
}

fn seed_stocked_product(conn: &Connection, sku: &str) {
    let product_id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT OR IGNORE INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES (?1, ?2, ?2, 1000, 'USD', 'retail')",
        rusqlite::params![product_id, sku],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO inventory_locations (id, name, type) VALUES (?1, 'Default', 'store')",
        rusqlite::params![crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO stock_summary (item_id, location_id, qty) VALUES (?1, ?2, 10)",
        rusqlite::params![
            product_id,
            crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID
        ],
    )
    .unwrap();
}

fn single_line_sale(sku: &str, actor: Option<&str>) -> Sale {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new(sku), 1, price(1000)))
        .unwrap();
    let mut sale = Sale::from_cart(&cart).unwrap();
    sale.user_id = actor.map(std::string::ToString::to_string);
    sale
}

fn tender(amount_minor: i64) -> Vec<crate::PaymentSplitArg> {
    vec![crate::PaymentSplitArg {
        method: "cash".into(),
        amount_minor,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }]
}

/// Two halves with the SAME idempotency key: the second payments insert
/// always collides with idx_payments_idempotency_key, which fails the whole
/// transaction AFTER the audit seat - the rollback property, testable
/// because the seat precedes the payment inserts.
fn tender_with_colliding_keys(total: i64) -> Vec<crate::PaymentSplitArg> {
    let half = total / 2;
    let mk = |amount_minor: i64| crate::PaymentSplitArg {
        method: "cash".into(),
        amount_minor,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: Some("dup-key".into()),
    };
    vec![mk(half), mk(total - half)]
}

// ── In-transaction audit row (door seat) ────────────────────────

/// HEAD-failure: FAILS AGAINST HEAD. Before this change this door wrote no
/// audit row (the handler wrote it later, off-transaction), so the
/// audit_count assertion sees 0 at HEAD and 1 here.
#[test]
fn shortfall_settlement_writes_one_audit_row_with_real_actor() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "SHORTFALL-SKU");
    let sale = single_line_sale("SHORTFALL-SKU", Some("cashier-2"));

    s.complete_sale_with_resolved_shortfalls(
        &sale,
        None,
        &tender(1000),
        "cashier-2",
        None,
        &[],
        &[],
    )
    .unwrap();

    assert_eq!(audit_count(&conn), 1);
    let entries = store(&conn).list_audit_entries(10, 0).unwrap();
    assert_eq!(entries[0].action, "sale.completed");
    // PCI 10.2.1: the REAL actor, not the handler's empty string.
    assert_eq!(entries[0].user_id, "cashier-2");
    assert_eq!(entries[0].target_type.as_deref(), Some("sale"));
    assert_eq!(entries[0].target_id.as_deref(), Some(sale.id.as_str()));
    assert_eq!(entries[0].outcome, "success");
}

/// HEAD-failure: explicitly NOT a HEAD-failure - passes at HEAD trivially
/// (HEAD wrote no audit row). Guards the rollback property of the
/// shortfall door's audit seat, mirroring the checkout door.
#[test]
fn shortfall_settlement_rollback_leaves_no_audit_row() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "SF-ROLLBACK-SKU");
    let sale = single_line_sale("SF-ROLLBACK-SKU", Some("cashier-2"));

    let err = s
        .complete_sale_with_resolved_shortfalls(
            &sale,
            None,
            &tender_with_colliding_keys(1000),
            "cashier-2",
            None,
            &[],
            &[],
        )
        .unwrap_err();

    assert!(err.to_string().contains("idempotency_key"));
    assert_eq!(audit_count(&conn), 0);
    assert_eq!(sale_count(&conn), 0);
}

// ── C4 S2: the void and payment producers (transactional outbox) ──

fn queue_rows(conn: &Connection, action: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM offline_queue WHERE action = ?1",
        rusqlite::params![action],
        |r| r.get(0),
    )
    .unwrap()
}

/// A committed void must leave EXACTLY ONE `void_sale` queue row carrying the
/// sale id the pull-side arm compare-and-sets on. Nothing in production
/// enqueued this action before: a void made on one terminal never reached the
/// others.
#[test]
fn void_sale_writes_one_void_outbox_row() {
    let conn = fresh();
    let s = store(&conn);
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("VOID-OUTBOX"), 1, price(1000)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, crate::SaleStatus::Active)
        .unwrap();

    s.void_sale(&sale.id, "user-2", "customer request").unwrap();

    assert_eq!(queue_rows(&conn, "void_sale"), 1);
    let (payload, tenant, priority): (String, String, i32) = conn
        .query_row(
            "SELECT payload, tenant_id, priority FROM offline_queue WHERE action = 'void_sale'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(priority, 0, "Critical");
    assert_eq!(tenant, "default", "tenant read from the sale row");
    let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(v["sale_id"], serde_json::json!(sale.id));
    assert!(v.get("origin").is_none());
}

/// A void that LOSES the compare-and-set must write no queue row: the CAS
/// branch rolls back before the outbox seat. A completed sale is the case the
/// status graph forbids - pushing a void for it would void a paid sale on
/// every other terminal.
#[test]
fn refused_void_writes_no_outbox_row() {
    let conn = fresh();
    let s = store(&conn);
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("VOID-REFUSED"), 1, price(1000)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();
    s.update_sale_status(&sale.id, crate::SaleStatus::Active)
        .unwrap();
    s.update_sale_status(&sale.id, crate::SaleStatus::Completed)
        .unwrap();

    let err = s.void_sale(&sale.id, "user-2", "too late").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
    assert_eq!(
        queue_rows(&conn, "void_sale"),
        0,
        "a refused void must leave no outbox row"
    );
}

/// A split settlement must write ONE `payment.recorded` row PER SPLIT, each
/// carrying the payment id and its idempotency key when present - the two
/// identities the pull-side arm probes.
#[test]
fn split_settlement_writes_one_payment_outbox_row_per_split() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "PAY-OUTBOX");
    let mut sale = single_line_sale("PAY-OUTBOX", Some("cashier-3"));
    sale.total = price(1000);

    let splits = vec![
        crate::PaymentSplitArg {
            method: "cash".into(),
            amount_minor: 400,
            gateway_reference: None,
            gateway_status: None,
            gateway_response: None,
            idempotency_key: Some("idem-cash".into()),
        },
        crate::PaymentSplitArg {
            method: "card".into(),
            amount_minor: 600,
            gateway_reference: Some("gw-ref-1".into()),
            gateway_status: Some("approved".into()),
            gateway_response: None,
            idempotency_key: None,
        },
    ];
    s.complete_sale_deduction_with_locations_and_estimate(
        &sale,
        None,
        &[],
        &splits,
        "cashier-3",
        None,
        &[],
        false,
    )
    .unwrap();

    assert_eq!(
        queue_rows(&conn, "payment.recorded"),
        2,
        "one row per split"
    );
    let payment_ids: Vec<String> = conn
        .prepare("SELECT id FROM payments WHERE sale_id = ?1 ORDER BY method")
        .unwrap()
        .query_map(rusqlite::params![&sale.id], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(payment_ids.len(), 2);

    // Keyed by method rather than sorted: "card" sorts before "cash", which
    // would make the two assertions below depend on that accident.
    let mut by_method: std::collections::HashMap<String, serde_json::Value> = conn
        .prepare("SELECT payload FROM offline_queue WHERE action = 'payment.recorded'")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|r| {
            let v: serde_json::Value = serde_json::from_str(&r.unwrap()).unwrap();
            (v["method"].as_str().unwrap().to_string(), v)
        })
        .collect();
    assert_eq!(by_method.len(), 2, "one row per distinct split");

    let cash = by_method.remove("cash").expect("cash split row");
    assert_eq!(cash["method"], serde_json::json!("cash"));
    assert_eq!(cash["sale_id"], serde_json::json!(sale.id));
    assert_eq!(cash["amount_minor"], serde_json::json!(400));
    assert_eq!(cash["currency"], serde_json::json!("USD"));
    assert_eq!(cash["idempotency_key"], serde_json::json!("idem-cash"));
    assert!(
        payment_ids.contains(&cash["id"].as_str().unwrap().to_string()),
        "the payload names the payments row it describes"
    );
    assert!(cash.get("origin").is_none());

    let card = by_method.remove("card").expect("card split row");
    assert_eq!(card["method"], serde_json::json!("card"));
    assert_eq!(card["amount_minor"], serde_json::json!(600));
    assert_eq!(card["gateway_reference"], serde_json::json!("gw-ref-1"));
    assert_eq!(card["gateway_status"], serde_json::json!("approved"));
    assert_eq!(
        card["idempotency_key"],
        serde_json::Value::Null,
        "absent key stays null, never an invented one"
    );
    assert!(payment_ids.contains(&card["id"].as_str().unwrap().to_string()));
}

/// The rollback proof for the payment producer: the same UNIQUE collision the
/// sale outbox seat is tested against rolls the queue rows back with the sale.
#[test]
fn rolled_back_settlement_writes_no_payment_outbox_row() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "PAY-ROLLBACK");
    let sale = single_line_sale("PAY-ROLLBACK", Some("cashier-4"));

    let err = s
        .complete_sale_deduction_with_locations_and_estimate(
            &sale,
            None,
            &[],
            &tender_with_colliding_keys(1000),
            "cashier-4",
            None,
            &[],
            false,
        )
        .unwrap_err();
    assert!(err.to_string().contains("idempotency_key"));

    assert_eq!(
        queue_rows(&conn, "payment.recorded"),
        0,
        "a rolled-back settlement must leave no payment outbox row"
    );
    assert_eq!(sale_count(&conn), 0);
}
// ── MSL-28: a failed recipe read must not silently skip the deduction ──

/// `complete_sale_with_resolved_shortfalls` read the recipe with
/// `.unwrap_or_default()`, so a DB failure became "this product has no recipe".
/// That flips `has_recipe` false, and when the product also does not
/// `tracks_inventory`, `needs_stock` is false and the line is NOT deducted — a
/// sale settles with inventory under-reported and no error anywhere.
///
/// The CHECKOUT path reads the same function and propagates:
/// `sales_checkout.rs:259` is `self.get_recipe_ingredients(pid)?`. Two doors,
/// one read, opposite failure policies.
#[test]
fn a_failed_recipe_read_does_not_silently_skip_the_deduction() {
    let conn = fresh();
    let s = store(&conn);
    seed_stocked_product(&conn, "RECIPE-FAIL-SKU");

    // The swallow only bites for a product whose stock comes SOLELY from its
    // recipe: `tracks_inventory` is true for retail/restaurant/both and false only
    // for `service`, so a service product with a recipe is the case where
    // `has_recipe` is the only thing making `needs_stock` true.
    let parent: String = conn
        .query_row(
            "SELECT id FROM products WHERE sku = 'RECIPE-FAIL-SKU'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    conn.execute(
        "UPDATE products SET product_type = 'service' WHERE id = ?1",
        rusqlite::params![parent],
    )
    .unwrap();
    // An ingredient that DOES track stock, so the recipe is the only reason to
    // deduct anything at all.
    let ing_id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, product_type) \
         VALUES (?1, 'ING-FAIL-SKU', 'Ingredient', 100, 'USD', 'retail')",
        rusqlite::params![ing_id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty) VALUES (?1, ?2, 10)",
        rusqlite::params![ing_id, crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO product_recipes (id, parent_product_id, ingredient_product_id, \
         quantity_required, unit) VALUES (?1, ?2, ?3, 2, 'unit')",
        rusqlite::params![uuid::Uuid::now_v7().to_string(), parent, ing_id],
    )
    .unwrap();

    let sale = single_line_sale("RECIPE-FAIL-SKU", Some("cashier-2"));

    // Force the recipe read to fail for a reason that is NOT "no recipe":
    // rename the table it selects from.
    conn.execute_batch("ALTER TABLE product_recipes RENAME TO product_recipes_hidden;")
        .unwrap();

    let result = s.complete_sale_with_resolved_shortfalls(
        &sale,
        None,
        &tender(1000),
        "cashier-2",
        None,
        &[],
        &[],
    );

    // The read failure must PROPAGATE, exactly as the checkout door does: the
    // operator gets the real cause instead of a settled sale that quietly
    // skipped its deduction.
    let err = result.expect_err(
        "a failed recipe read must fail the settlement, not settle it without deducting",
    );
    assert!(
        err.to_string().contains("product_recipes"),
        "the propagated error must name the real cause, got: {err}"
    );

    // And nothing was written: the settlement rolled back with the failure, so the
    // ingredient still holds its original 10.
    let ing_qty: i64 = conn
        .query_row(
            "SELECT qty FROM stock_summary WHERE item_id = \
             (SELECT id FROM products WHERE sku = 'ING-FAIL-SKU') AND location_id = ?1",
            rusqlite::params![crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        ing_qty, 10,
        "a failed settlement must not have deducted anything"
    );
}
/// COR-8: the in-transaction CAS must refuse a void that lost the race.
///
/// `void_sale` reads the sale OUTSIDE its transaction, so the `status != active`
/// pre-check cannot see a transition that lands in between. The `UPDATE ...
/// WHERE id = ?2 AND status = 'active'` predicate is what actually closes that,
/// with `rows == 0` mapped to `Conflict`. Nothing exercised that branch before:
/// the existing refusal test (`refused_void_writes_no_outbox_row`) trips the
/// PRE-check, which reports `Validation { field: "status" }` — a different arm.
///
/// The shape is the one MSL-78 also had: a real fix with no test defending it,
/// where deleting the `AND status = 'active'` predicate would leave the suite
/// green while a completed (paid, points-awarded) sale could be overwritten to
/// voided. Needs a real second connection, hence the file-backed DB.
#[test]
fn void_sale_race_reports_the_conflict_rather_than_overwriting_a_completed_sale() {
    let dir = std::env::temp_dir().join(format!("oz_void_race_{}", uuid::Uuid::now_v7()));
    let db_path = dir.join("kasir.db");
    let sale_id = {
        let conn = fresh_file(&dir);
        let mut cart = Cart::new(usd());
        cart.add_line(CartLine::new(Sku::new("VOID-RACE"), 1, price(1000)))
            .unwrap();
        let sale = Sale::from_cart(&cart).unwrap();
        store(&conn).create_sale(&sale).unwrap();
        store(&conn)
            .update_sale_status(&sale.id, crate::SaleStatus::Active)
            .unwrap();
        sale.id
    };

    // B stages the completing transition and holds the write lock, so A's
    // `void_sale` gets past its out-of-transaction pre-check (the row is still
    // `active` when A reads it) and THEN blocks on the UPDATE.
    let (staged_tx, staged_rx) = std::sync::mpsc::channel();
    let rival = {
        let db_path = db_path.clone();
        let sale_id = sale_id.clone();
        std::thread::spawn(move || {
            let conn_b = Connection::open(&db_path).unwrap();
            conn_b.pragma_update(None, "busy_timeout", "5000").unwrap();
            let tx = conn_b.unchecked_transaction().unwrap();
            let rows = tx
                .execute(
                    "UPDATE sales SET status = 'completed' WHERE id = ?1",
                    rusqlite::params![sale_id],
                )
                .unwrap();
            assert_eq!(rows, 1, "the rival must stage the sale it is completing");
            staged_tx.send(()).unwrap();
            // B releases on its own timer: A is blocked inside `void_sale`.
            std::thread::sleep(std::time::Duration::from_millis(300));
            tx.commit().unwrap();
        })
    };
    staged_rx.recv().unwrap();

    let conn_a = Connection::open(&db_path).unwrap();
    conn_a.pragma_update(None, "busy_timeout", "5000").unwrap();
    let outcome = store(&conn_a).void_sale(&sale_id, "user-2", "too late");
    rival.join().unwrap();

    // The race was LOST, so the CAS matched zero rows and reported the conflict.
    assert!(matches!(
        outcome,
        Err(CoreError::Conflict { entity: "sale", .. })
    ));

    // B's transition survived: the void must not have overwritten it.
    let status: String = conn_a
        .query_row(
            "SELECT status FROM sales WHERE id = ?1",
            rusqlite::params![sale_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "completed", "the loser must not win the column");

    drop(conn_a);
    let _ = std::fs::remove_dir_all(&dir);
}

// ── Phase 5 P5.1: the cross-vertical write contract ────────────────────

/// Tables `sales_lifecycle.rs` writes that it does not own. This is the core-owned
/// analogue of `Module::namespace_grants()`: the sale-lifecycle path runs in core,
/// so no `NamespacedStore` sees its statements, and this list is what keeps a new
/// cross-vertical write from slipping in unannounced.
///
/// `payments` is NOT here: Phase 5 P5.4 assigned it to `sales` in
/// `modules/ownership.json`, so the settlement INSERT (:555) is an own-table write.
/// `customers` remains the one foreign write (crm-owned); P5.3 routes it behind the
/// crm seam, at which point this list empties.
const FOREIGN_WRITES: &[&str] = &["customers"];

/// Module dependencies of `sales` that a foreign write's owner must appear in.
/// Mirrors `dependencies` in `modules/sales/manifest.json`; P5.3 adds `crm` there.
const MODULE_DEPENDENCIES: &[&str] = &["inventory", "crm"];

/// Every table this path writes that it does not own must be owned by a module
/// the sales module declares as a dependency. Adding a foreign write without
/// declaring its owner (here or in modules/sales/manifest.json) fails this test,
/// which is the whole point of the declaration: the sale lifecycle runs in core,
/// so this is the only place a new cross-vertical write gets caught.
///
/// Since P5.4 every such table must be mapped: an unmapped table is a governance
/// gap, not an allowed case.
#[test]
fn the_foreign_writes_name_owners_that_sales_declares() {
    use crate::db::ownership::owner_of;
    for table in FOREIGN_WRITES {
        let owner = owner_of(table).unwrap_or_else(|| {
            panic!(
                "sale lifecycle writes '{table}', which no module owns in modules/ownership.json"
            )
        });
        assert!(
            MODULE_DEPENDENCIES.contains(&owner),
            "sale lifecycle writes '{table}', owned by '{owner}', but sales does not declare that dependency"
        );
    }
}

/// The declaration is not vacuous: it must name the foreign write the path still
/// performs (`customers` accrual). `payments` left this list in P5.4 when it
/// became sales-owned.
#[test]
fn the_foreign_write_declaration_is_not_empty() {
    assert!(FOREIGN_WRITES.contains(&"customers"));
    // P5.4: payments is sales-owned now, so it must NOT be a foreign write.
    assert!(!FOREIGN_WRITES.contains(&"payments"));
    assert_eq!(
        crate::db::ownership::owner_of("payments"),
        Some("sales"),
        "P5.4 assigned payments to sales; a re-home must update this declaration"
    );
}
