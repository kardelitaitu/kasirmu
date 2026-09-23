use super::*;
use crate::Money;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
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

/// One product at version 1, price 350, with a distinctive
/// `price_updated_at` stamp so a rename can be told from a reprice.
fn seed(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at, price_updated_at) VALUES
            ('prod-1', 'DRINK-001', 'Espresso', 350, 'USD', NULL, NULL, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');",
    )
    .unwrap();
}

/// The four columns a rejected `update_product` must not have touched.
fn row(conn: &Connection) -> (String, i64, i64, String) {
    conn.query_row(
        "SELECT name, price_minor, version, updated_at FROM products WHERE sku = 'DRINK-001'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .unwrap()
}

// ── C18 (slice P1.8): the update is one transaction ──────────────────

/// The invariant the CAS exists for: a writer whose read has been overtaken
/// is refused, and the winner's row survives verbatim.
///
/// Writer 1 reads version 1 and wins. Writer 2 still holds the version 1 it
/// read — its state has moved between its read and its write — so the CAS
/// predicate must reject it rather than let the stale name and price land on
/// top of the committed ones.
#[test]
fn update_product_refuses_a_stale_version_and_leaves_the_row_untouched() {
    let conn = fresh();
    seed(&conn);
    let s = Store::new(&conn);

    let first = s
        .update_product(
            "DRINK-001",
            "Espresso",
            price(400),
            None,
            None,
            None,
            Some(1),
        )
        .unwrap();
    assert_eq!(first.version, 2);
    assert_eq!(first.price.minor_units, 400);

    let err = s
        .update_product(
            "DRINK-001",
            "Espresso Clobbered",
            price(99),
            None,
            None,
            None,
            Some(1),
        )
        .unwrap_err();
    assert!(
        matches!(&err, CoreError::Conflict { entity, field } if *entity == "product" && *field == "version"),
        "a write against a version that has moved must be refused with the conflict, got: {err:?}"
    );

    let (name, minor, version, _) = row(&conn);
    assert_eq!(
        name, "Espresso",
        "the refused write must not have renamed the row"
    );
    assert_eq!(
        minor, 400,
        "the refused write must not have moved the price"
    );
    assert_eq!(
        version, 2,
        "the refused write must not have bumped the version"
    );
}

/// A failed update leaves the row byte-identical — both failure modes.
#[test]
fn a_failed_update_leaves_the_row_untouched() {
    let conn = fresh();
    seed(&conn);
    let s = Store::new(&conn);
    let before = row(&conn);

    let err = s
        .update_product("DRINK-001", "X", price(1), None, None, None, Some(7))
        .unwrap_err();
    assert!(
        matches!(&err, CoreError::Conflict { field, .. } if *field == "version"),
        "got: {err:?}"
    );
    assert_eq!(
        row(&conn),
        before,
        "a conflict must leave the row untouched"
    );

    let err = s
        .update_product("NOPE", "X", price(1), None, None, None, None)
        .unwrap_err();
    assert!(
        matches!(&err, CoreError::NotFound { entity, .. } if *entity == "product"),
        "got: {err:?}"
    );
    assert_eq!(
        row(&conn),
        before,
        "a not-found must leave the row untouched"
    );
}

/// The merged single statement must keep the unconditional arm working:
/// `expected_version = None` writes regardless of the row's version.
#[test]
fn update_product_without_an_expected_version_updates_unconditionally() {
    let conn = fresh();
    seed(&conn);
    let s = Store::new(&conn);

    // Move the version first, so a predicate that was accidentally kept
    // would refuse this write.
    s.update_product(
        "DRINK-001",
        "Espresso",
        price(400),
        None,
        None,
        None,
        Some(1),
    )
    .unwrap();

    let p = s
        .update_product(
            "DRINK-001",
            "Ristretto",
            price(425),
            None,
            None,
            Some("retail"),
            None,
        )
        .unwrap();
    assert_eq!(p.name, "Ristretto");
    assert_eq!(p.price.minor_units, 425);
    assert_eq!(p.version, 3);

    let stored_type: String = conn
        .query_row(
            "SELECT product_type FROM products WHERE sku = 'DRINK-001'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored_type, "retail");
}

/// The `price_updated_at` CASE travels with the single statement: a rename
/// that leaves the price alone must not restamp it, a reprice must.
#[test]
fn update_product_moves_price_updated_at_only_when_the_price_moves() {
    let conn = fresh();
    seed(&conn);
    let s = Store::new(&conn);
    let fixture = "2025-01-01T00:00:00.000Z";

    let renamed = s
        .update_product(
            "DRINK-001",
            "Espresso Lungo",
            price(350),
            None,
            None,
            None,
            Some(1),
        )
        .unwrap();
    assert_eq!(
        renamed.price_updated_at, fixture,
        "a rename must not restamp price_updated_at"
    );

    let repriced = s
        .update_product(
            "DRINK-001",
            "Espresso Lungo",
            price(375),
            None,
            None,
            None,
            Some(2),
        )
        .unwrap();
    assert_ne!(
        repriced.price_updated_at, fixture,
        "a price change must restamp price_updated_at"
    );
}
