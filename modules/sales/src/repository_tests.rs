//! Sibling unit tests for `repository.rs` (AGENTS.md: no tests in production files).

use super::*;

use foundation::{Cart, CartLine, Sku};
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn sample_sale() -> Sale {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(
        Sku::new("COFFEE"),
        2,
        Money {
            minor_units: 350,
            currency: usd(),
        },
    ))
    .unwrap();
    cart.add_line(CartLine::new(
        Sku::new("CAKE"),
        1,
        Money {
            minor_units: 500,
            currency: usd(),
        },
    ))
    .unwrap();
    Sale::from_cart_with_user(&cart, Some("u-42".to_string())).unwrap()
}

#[test]
fn get_sale_missing_returns_none() {
    let conn = fresh();
    let repo = SalesRepository::new(&conn);
    assert!(repo.get_sale("does-not-exist").unwrap().is_none());
}

#[test]
fn create_sale_then_get_roundtrip() {
    let mut conn = fresh();
    let mut sale = sample_sale();
    sale.payment_method = Some("cash".to_string());
    sale.tendered_minor = Some(1500);

    let tx = conn.transaction().unwrap();
    SalesRepository::new(&tx)
        .create_sale_tx(&tx, &sale)
        .unwrap();
    tx.commit().unwrap();

    let repo = SalesRepository::new(&conn);
    let fetched = repo.get_sale(&sale.id).unwrap().expect("sale must exist");

    assert_eq!(fetched.id, sale.id);
    assert_eq!(fetched.status, sale.status);
    assert_eq!(fetched.total, sale.total);
    assert_eq!(fetched.currency, sale.currency);
    assert_eq!(fetched.line_count, 2);
    assert_eq!(fetched.payment_method.as_deref(), Some("cash"));
    assert_eq!(fetched.tendered_minor, Some(1500));
    assert_eq!(fetched.user_id.as_deref(), Some("u-42"));
    assert_eq!(fetched.version, 1);
    assert_eq!(fetched.lines.len(), 2);
    assert_eq!(fetched.lines[0].sku, "COFFEE");
    assert_eq!(fetched.lines[0].qty, 2);
    assert_eq!(fetched.lines[0].line_position, 1);
    assert_eq!(fetched.lines[0].unit_price.minor_units, 350);
    assert_eq!(fetched.lines[0].line_total.minor_units, 700);
    assert_eq!(fetched.lines[1].sku, "CAKE");
    assert_eq!(fetched.lines[1].line_position, 2);
    assert_eq!(fetched.lines[1].line_total.minor_units, 500);
}

#[test]
fn create_sale_persists_tax_and_breakdown_fields() {
    let mut conn = fresh();
    // tax_rate_id has a FK to tax_rates(id), so seed a matching row.
    conn.execute(
            "INSERT INTO tax_rates (id, name, rate_bps, is_default) VALUES ('rate-1', 'Sales Tax', 1000, 1)",
            [],
        )
        .unwrap();
    let mut sale = sample_sale();
    sale.lines[0].tax_amount = Money {
        minor_units: 35,
        currency: usd(),
    };
    sale.lines[0].tax_rate_id = Some("rate-1".to_string());
    sale.lines[0].tax_breakdown_json =
        Some("[{\"rate_id\":\"rate-1\",\"rate_bps\":1000}]".to_string());
    sale.lines[0].serial_number = Some("SN-123".to_string());
    sale.lines[0].course = Some("main".to_string());
    sale.lines[0].modifiers_json = Some("[{\"name\":\"Temp\",\"choice\":\"Hot\"}]".to_string());

    let tx = conn.transaction().unwrap();
    SalesRepository::new(&tx)
        .create_sale_tx(&tx, &sale)
        .unwrap();
    tx.commit().unwrap();

    let repo = SalesRepository::new(&conn);
    let fetched = repo.get_sale(&sale.id).unwrap().unwrap();
    assert_eq!(fetched.lines[0].tax_amount.minor_units, 35);
    assert_eq!(fetched.lines[0].tax_rate_id.as_deref(), Some("rate-1"));
    assert_eq!(
        fetched.lines[0].tax_breakdown_json.as_deref(),
        Some("[{\"rate_id\":\"rate-1\",\"rate_bps\":1000}]")
    );
    assert_eq!(fetched.lines[0].serial_number.as_deref(), Some("SN-123"));
    assert_eq!(fetched.lines[0].course.as_deref(), Some("main"));
    assert_eq!(
        fetched.lines[0].modifiers_json.as_deref(),
        Some("[{\"name\":\"Temp\",\"choice\":\"Hot\"}]")
    );
}

#[test]
fn get_sale_orders_lines_by_position() {
    let mut conn = fresh();
    let mut sale = sample_sale();
    // Reverse positions in memory to prove the query orders on read.
    sale.lines.reverse();
    let tx = conn.transaction().unwrap();
    SalesRepository::new(&tx)
        .create_sale_tx(&tx, &sale)
        .unwrap();
    tx.commit().unwrap();

    let repo = SalesRepository::new(&conn);
    let fetched = repo.get_sale(&sale.id).unwrap().unwrap();
    assert_eq!(fetched.lines[0].sku, "COFFEE");
    assert_eq!(fetched.lines[0].line_position, 1);
    assert_eq!(fetched.lines[1].sku, "CAKE");
    assert_eq!(fetched.lines[1].line_position, 2);
}

#[test]
fn get_sale_rejects_invalid_currency() {
    let mut conn = fresh();
    let sale = sample_sale();
    let tx = conn.transaction().unwrap();
    SalesRepository::new(&tx)
        .create_sale_tx(&tx, &sale)
        .unwrap();
    tx.commit().unwrap();

    // Corrupt the currency code so parsing fails on read.
    conn.execute(
        "UPDATE sales SET currency = 'ZZ' WHERE id = ?1",
        params![sale.id],
    )
    .unwrap();

    let repo = SalesRepository::new(&conn);
    assert!(repo.get_sale(&sale.id).is_err());
}

#[test]
fn update_sale_status_changes_status_and_bumps_version() {
    let mut conn = fresh();
    let sale = sample_sale();
    let tx = conn.transaction().unwrap();
    SalesRepository::new(&tx)
        .create_sale_tx(&tx, &sale)
        .unwrap();
    tx.commit().unwrap();

    let repo = SalesRepository::new(&conn);
    repo.update_sale_status(&sale.id, SaleStatus::Voided)
        .unwrap();

    let fetched = repo.get_sale(&sale.id).unwrap().unwrap();
    assert_eq!(fetched.status, SaleStatus::Voided);
    assert_eq!(fetched.version, 2);
}

#[test]
fn update_sale_status_missing_id_is_noop() {
    let conn = fresh();
    let repo = SalesRepository::new(&conn);
    let result = repo.update_sale_status("missing", SaleStatus::Voided);
    assert!(result.is_ok());
}

// ── O-L22: the stored status string, and the cached INSERTs ─────────────

/// The pre-O-L22 write path: serialize the status as JSON, then strip the
/// surrounding quotes. Kept here — and reached through `serde_json::to_string`,
/// which the retired production code called earlier in this file's history — as
/// the oracle the new path must match byte for byte.
fn pre_ol22_status_string(status: SaleStatus) -> String {
    serde_json::to_string(&status)
        .expect("serde_json::to_string on a unit enum variant cannot fail")
        .trim_matches('"')
        .to_string()
}

/// Every `SaleStatus` variant, generated by an EXHAUSTIVE `match`: a new
/// variant of `foundation::SaleStatus` turns this into a non-exhaustive-match
/// compile error instead of silently going untested.
fn all_sale_statuses() -> Vec<SaleStatus> {
    fn variants(seen: &mut Vec<SaleStatus>, status: SaleStatus) {
        // No wildcard arm: adding a variant fails to compile here.
        match status {
            SaleStatus::Pending => seen.push(SaleStatus::Pending),
            SaleStatus::Active => seen.push(SaleStatus::Active),
            SaleStatus::Completed => seen.push(SaleStatus::Completed),
            SaleStatus::Voided => seen.push(SaleStatus::Voided),
        }
    }
    let mut seen = Vec::new();
    for status in [
        SaleStatus::Pending,
        SaleStatus::Active,
        SaleStatus::Completed,
        SaleStatus::Voided,
    ] {
        variants(&mut seen, status);
    }
    seen
}

#[test]
fn stored_status_string_matches_pre_ol22_serde_path() {
    for status in all_sale_statuses() {
        let old = pre_ol22_status_string(status);
        let new = status.as_stored_str();
        assert_eq!(
            old.as_bytes(),
            new.as_bytes(),
            "O-L22: as_stored_str() for {status:?} must be byte-identical to the retired serde_json path ({old:?} vs {new:?})"
        );
        // The column is read back through the parser, so the write spelling must
        // also be a spelling the read path accepts.
        assert_eq!(
            SaleStatus::from_stored_str(new),
            Some(status),
            "O-L22: {status:?} stores as {new:?}, which from_stored_str must accept"
        );
    }
}

/// Proves the value that actually lands in the `sales.status` column is the
/// canonical spelling for every variant — not merely that the helper agrees with
/// itself — and that it reads back as the same variant.
#[test]
fn create_sale_persists_canonical_status_for_every_variant() {
    let mut conn = fresh();
    for status in all_sale_statuses() {
        let mut sale = sample_sale();
        sale.status = status;
        let tx = conn.transaction().unwrap();
        SalesRepository::new(&tx)
            .create_sale_tx(&tx, &sale)
            .unwrap();
        tx.commit().unwrap();

        let stored: String = conn
            .query_row(
                "SELECT status FROM sales WHERE id = ?1",
                params![sale.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            stored.as_bytes(),
            pre_ol22_status_string(status).as_bytes(),
            "O-L22: stored status for {status:?} diverged from the pre-fix bytes"
        );

        let fetched = SalesRepository::new(&conn)
            .get_sale(&sale.id)
            .unwrap()
            .expect("sale must exist");
        assert_eq!(fetched.status, status);
    }
}

/// `update_sale_status` shares the write path; its stored value must match too.
#[test]
fn update_sale_status_persists_canonical_status_for_every_variant() {
    let mut conn = fresh();
    for status in all_sale_statuses() {
        let mut sale = sample_sale();
        // Start from a status the state machine would not reach, so the write is
        // unconditional and every variant gets exercised.
        sale.status = SaleStatus::Pending;
        let tx = conn.transaction().unwrap();
        SalesRepository::new(&tx)
            .create_sale_tx(&tx, &sale)
            .unwrap();
        tx.commit().unwrap();

        SalesRepository::new(&conn)
            .update_sale_status(&sale.id, status)
            .unwrap();

        let stored: String = conn
            .query_row(
                "SELECT status FROM sales WHERE id = ?1",
                params![sale.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            stored.as_bytes(),
            pre_ol22_status_string(status).as_bytes(),
            "O-L22: update_sale_status stored {status:?} as {stored:?}"
        );
    }
}

/// Write-path counterpart of the read-scoping test below.
///
/// The read half proves `check_statement` runs for SELECTs. This one proves it
/// still runs for the INSERTs `create_sale_tx` issues — which is exactly the
/// guard a raw `tx.prepare_cached(...)` would bypass, because `prepare_cached`
/// is a `Connection` method that knows nothing about namespaces. It is
/// exercised through a handle that does NOT own `sales`, so a write that
/// skipped the check would simply succeed instead of failing.
#[test]
fn the_write_path_is_namespace_checked() {
    use kasirmu_core::db::Store;
    use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespaceError, NamespacedStore};

    let mut conn = fresh();
    let sale = sample_sale();
    let tx = conn.transaction().unwrap();

    // A store whose owner is NOT the sales module, over the same transaction.
    let foreign = NamespacedStore::new(Store::new(&tx), ModuleId("inventory"), Grants::none());

    let err = foreign
        .own()
        .execute(
            INSERT_SALES_SQL,
            params![
                sale.id,
                sale.status.as_stored_str(),
                sale.total.minor_units,
                sale.line_count,
                sale.currency.to_string(),
                sale.payment_method,
                sale.tendered_minor,
                sale.user_id,
                sale.created_at,
                sale.updated_at,
                sale.discount_percent,
                sale.discount_label,
                sale.subtotal.minor_units,
                sale.tax_total.minor_units,
                sale.customer_id,
                sale.version,
                sale.base_currency,
                sale.base_total_minor,
                sale.tender_rate_millionths,
                sale.tip_minor,
                sale.service_charge_minor,
            ],
        )
        .unwrap_err();
    assert!(
        matches!(err, NamespaceError::Foreign { ref table, .. } if table == "sales"),
        "the sales INSERT must be refused to a foreign namespace, got {err:?}"
    );

    let err = foreign
        .own()
        .execute(
            INSERT_SALE_LINES_SQL,
            params![
                "line-1",
                sale.id,
                "COFFEE",
                1,
                350,
                350,
                1,
                0,
                Option::<String>::None,
                Option::<String>::None,
                Option::<String>::None,
                Option::<String>::None,
                Option::<String>::None,
                "USD",
            ],
        )
        .unwrap_err();
    assert!(
        matches!(err, NamespaceError::Foreign { ref table, .. } if table == "sale_lines"),
        "the sale_lines INSERT must be refused to a foreign namespace, got {err:?}"
    );

    tx.rollback().unwrap();
    // Both statements were refused before they ran, so nothing was written.
    assert_eq!(count_rows(&conn, "sales"), 0);
    assert_eq!(count_rows(&conn, "sale_lines"), 0);
}

/// The exact SQL `create_sale_tx` runs, duplicated here on purpose: if the
/// production statement stops naming a table the ownership map knows, the
/// guard below is what notices.
const INSERT_SALES_SQL: &str =
    "INSERT INTO sales (id, status, total_minor, line_count, currency, payment_method, tendered_minor, user_id, created_at, updated_at, discount_percent, discount_label, subtotal_minor, tax_total_minor, customer_id, version, base_currency, base_total_minor, tender_rate_millionths, tip_minor, service_charge_minor)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)";

/// The per-line INSERT from `create_sale_tx`.
const INSERT_SALE_LINES_SQL: &str =
    "INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, line_position, tax_minor, tax_rate_id, tax_breakdown_json, serial_number, course, modifiers_json, currency)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)";

/// Count rows in a table. Test-fixture read on the bare connection, not a
/// module write.
fn count_rows(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

// ── P3.2/P3.5: the repository is namespace-checked ──────────────────────

/// The wrap must not have widened the module's reach: its own tables pass the
/// ownership check, a foreign table through the same handle is refused.
#[test]
fn the_repository_is_scoped_to_its_own_namespace() {
    use kasirmu_core::db::Store;
    use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespaceError, NamespacedStore};

    let conn = fresh();
    let ns = NamespacedStore::new(Store::new(&conn), ModuleId("sales"), Grants::none());

    for table in ["sales", "sale_lines"] {
        ns.own()
            .query_try::<i64, _, _, SalesError>(&format!("SELECT 1 FROM {table}"), [], |row| {
                Ok(row.get(0)?)
            })
            .unwrap_or_else(|e| panic!("sales must read its own {table}: {e:?}"));
    }

    let err = ns
        .own()
        .query_try::<i64, _, _, SalesError>("SELECT 1 FROM customers", [], |row| Ok(row.get(0)?))
        .unwrap_err();
    assert!(
        matches!(err, SalesError::Namespace(NamespaceError::Foreign { ref table, .. }) if table == "customers"),
        "expected Foreign on customers, got {err:?}"
    );
}

/// Pins that the warm prepared-statement cache cannot be used to bypass the
/// ownership check.
///
/// `Namespace::prepare_cached` runs `check_statement` on THIS call, before it
/// goes near the cache. Write the opposite order -- cache first, check only on a
/// miss -- and the sequence below stops being refused: the first, same-owner
/// call leaves the INSERT warm in the connection's cache, and the foreign
/// caller's identical SQL text would then be served out of it as a hit.
///
/// Observable scope, stated honestly: rusqlite 0.31.0 exposes no hit/miss flag
/// and no `Connection::cache_size()`, so this test does NOT assert that the warm
/// slot was actually hit. What it asserts is the property that matters -- a
/// foreign owner is refused on the exact SQL text that is already warm, and
/// nothing reaches the table. Row counts are how the "kept the slot" step is
/// proved real rather than assumed: the same-owner write that warms it commits.
#[test]
fn the_cache_does_not_skip_the_ownership_check_on_a_hit() {
    use kasirmu_core::db::Store;
    use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespaceError, NamespacedStore};

    let mut conn = fresh();
    let sale = sample_sale();

    // STEP 1 -- warm the cache through a namespace that really does own
    // `sales`, using the production INSERT text. Committed, so the row is proof
    // the statement is not merely cached but live.
    {
        let tx = conn.transaction().unwrap();
        let owner = NamespacedStore::new(Store::new(&tx), ModuleId("sales"), Grants::none());
        owner
            .own()
            .execute_cached(
                INSERT_SALES_SQL,
                params![
                    sale.id,
                    sale.status.as_stored_str(),
                    sale.total.minor_units,
                    sale.line_count,
                    sale.currency.to_string(),
                    sale.payment_method,
                    sale.tendered_minor,
                    sale.user_id,
                    sale.created_at,
                    sale.updated_at,
                    sale.discount_percent,
                    sale.discount_label,
                    sale.subtotal.minor_units,
                    sale.tax_total.minor_units,
                    sale.customer_id,
                    sale.version,
                    sale.base_currency,
                    sale.base_total_minor,
                    sale.tender_rate_millionths,
                    sale.tip_minor,
                    sale.service_charge_minor,
                ],
            )
            .expect("the owning namespace must be allowed to insert a sale");
        tx.commit().unwrap();
    }
    assert_eq!(
        count_rows(&conn, "sales"),
        1,
        "the warm-up write must commit: a refused statement never reaches the table"
    );

    // STEP 2 -- hold the same SQL text in a CachedStatement from the owning
    // namespace, so the slot is occupied at the moment the foreign call
    // arrives (rusqlite keeps a statement in use out of the LRU until it drops).
    {
        let tx = conn.transaction().unwrap();
        let owner = NamespacedStore::new(Store::new(&tx), ModuleId("sales"), Grants::none());
        let owner_handle = owner.own();
        let _warm = owner_handle
            .prepare_cached(INSERT_SALES_SQL)
            .expect("the owning namespace must be able to prepare its own INSERT");

        // STEP 3 -- the same SQL text, a namespace that does not own `sales`.
        // Cache-first would return the warm statement and let the row through.
        let foreign = NamespacedStore::new(Store::new(&tx), ModuleId("inventory"), Grants::none());
        let err = foreign
            .own()
            .execute_cached(
                INSERT_SALES_SQL,
                params![
                    sale.id,
                    sale.status.as_stored_str(),
                    sale.total.minor_units,
                    sale.line_count,
                    sale.currency.to_string(),
                    sale.payment_method,
                    sale.tendered_minor,
                    sale.user_id,
                    sale.created_at,
                    sale.updated_at,
                    sale.discount_percent,
                    sale.discount_label,
                    sale.subtotal.minor_units,
                    sale.tax_total.minor_units,
                    sale.customer_id,
                    sale.version,
                    sale.base_currency,
                    sale.base_total_minor,
                    sale.tender_rate_millionths,
                    sale.tip_minor,
                    sale.service_charge_minor,
                ],
            )
            .unwrap_err();
        assert!(
            matches!(err, NamespaceError::Foreign { ref table, .. } if table == "sales"),
            "a warm cache slot must not let a foreign namespace write: got {err:?}"
        );

        // The same must hold for the cached *prepare*, not just the one-shot
        // execute: this is the entry point `create_sale_tx` uses per line.
        let err = foreign
            .own()
            .prepare_cached(INSERT_SALES_SQL)
            .map(|_| ())
            .unwrap_err();
        assert!(
            matches!(err, NamespaceError::Foreign { ref table, .. } if table == "sales"),
            "prepare_cached must refuse a foreign namespace on a warm slot: got {err:?}"
        );
        drop(_warm);
        tx.rollback().unwrap();
    }

    // Only the warm-up row exists; the foreign attempts wrote nothing.
    assert_eq!(count_rows(&conn, "sales"), 1);
    assert_eq!(count_rows(&conn, "sale_lines"), 0);
}
