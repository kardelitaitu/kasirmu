use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

fn seed_tax_rate(
    conn: &Connection,
    id: &str,
    name: &str,
    rate_bps: i64,
    is_default: bool,
    is_active: bool,
) {
    conn.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_active) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, name, rate_bps, is_default as i64, is_active as i64],
    )
    .unwrap();
}

#[test]
fn get_tax_rate_returns_none_for_missing() {
    let conn = fresh();
    let repo = TaxRepository::new(&conn);
    assert!(repo.get_tax_rate("nope").unwrap().is_none());
}

#[test]
fn get_tax_rate_roundtrip() {
    let conn = fresh();
    seed_tax_rate(&conn, "t-1", "VAT", 2100, true, true);
    let repo = TaxRepository::new(&conn);

    let rate = repo.get_tax_rate("t-1").unwrap().unwrap();
    assert_eq!(rate.name, "VAT");
    assert_eq!(rate.rate_bps, 2100);
    assert!(rate.is_default);
    // is_inclusive parsed successfully (bool field roundtrips)
}

#[test]
fn get_tax_rate_filters_inactive() {
    let conn = fresh();
    seed_tax_rate(&conn, "t-1", "Archived", 1000, false, false);
    let repo = TaxRepository::new(&conn);
    // TAX-03: archived rates should be hidden
    assert!(repo.get_tax_rate("t-1").unwrap().is_none());
}

#[test]
fn list_tax_rates_empty() {
    let conn = fresh();
    let repo = TaxRepository::new(&conn);
    assert!(repo.list_tax_rates().unwrap().is_empty());
}

#[test]
fn list_tax_rates_returns_only_active() {
    let conn = fresh();
    seed_tax_rate(&conn, "t-1", "Active Tax", 1000, false, true);
    seed_tax_rate(&conn, "t-2", "Archived Tax", 2000, false, false);
    let repo = TaxRepository::new(&conn);

    let rates = repo.list_tax_rates().unwrap();
    assert_eq!(rates.len(), 1);
    assert_eq!(rates[0].name, "Active Tax");
}

#[test]
fn list_tax_rates_ordered_by_name() {
    let conn = fresh();
    seed_tax_rate(&conn, "t-1", "Zebra Tax", 1000, false, true);
    seed_tax_rate(&conn, "t-2", "Alpha Tax", 2000, false, true);
    let repo = TaxRepository::new(&conn);

    let rates = repo.list_tax_rates().unwrap();
    assert_eq!(rates.len(), 2);
    assert_eq!(rates[0].name, "Alpha Tax");
    assert_eq!(rates[1].name, "Zebra Tax");
}

// ── P3.2/P3.5: the repository is namespace-checked ──────────────────────

/// The wrap must not have widened the module's reach: its own table passes the
/// ownership check, a foreign table through the same handle is refused.
#[test]
fn the_repository_is_scoped_to_its_own_namespace() {
    use kasirmu_core::db::Store;
    use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespaceError, NamespacedStore};

    let conn = fresh();
    let ns = NamespacedStore::new(Store::new(&conn), ModuleId("tax"), Grants::none());

    ns.own()
        .query("SELECT 1 FROM tax_rates", [], |row| row.get::<_, i64>(0))
        .expect("tax must be allowed to read tax_rates");

    let err = ns
        .own()
        .query("SELECT 1 FROM sales", [], |row| row.get::<_, i64>(0))
        .unwrap_err();
    assert!(
        matches!(err, NamespaceError::Foreign { ref table, .. } if table == "sales"),
        "expected Foreign on sales, got {err:?}"
    );
}
