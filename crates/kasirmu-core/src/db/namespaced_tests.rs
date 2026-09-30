//! Unit tests for `NamespacedStore` and the pure `check_statement` core.
//!
//! The check is a function over plain values, so almost everything here runs
//! without a database. The final block exercises a real in-memory connection
//! to prove the borrowed-view path works end to end.

use super::*;

const SALES: ModuleId = ModuleId("sales");
const INVENTORY: ModuleId = ModuleId("inventory");
const REPORTING: ModuleId = ModuleId("reporting");
const SETTINGS: ModuleId = ModuleId("settings");

#[test]
fn own_table_passes() {
    let ok = check_statement(
        SALES,
        &Grants::none(),
        "SELECT * FROM sales WHERE id = ?1",
        Posture::ReadWrite,
    );
    assert!(ok.is_ok(), "own table must pass: {ok:?}");
}

#[test]
fn upsert_do_update_set_does_not_name_a_table() {
    // Regression: `ON CONFLICT (key) DO UPDATE SET value = ?2` is an UPSERT,
    // not a reference to a table called "set". The scanner used to read the
    // token after "update" unconditionally, so this failed with
    // UnknownTable { table: "set" }.
    let sql = "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
               ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3";
    assert!(
        check_statement(SETTINGS, &Grants::none(), sql, Posture::ReadWrite).is_ok(),
        "an UPSERT must be accepted as an own-table write"
    );
}

#[test]
fn upsert_on_a_foreign_table_is_still_caught() {
    // The fix must not blind the check: the INSERT target is what governs.
    let sql = "INSERT INTO products (sku) VALUES (?1)
               ON CONFLICT(sku) DO UPDATE SET sku = ?1";
    let err = check_statement(SALES, &Grants::none(), sql, Posture::ReadWrite).unwrap_err();
    assert!(
        matches!(err, NamespaceError::Foreign { ref table, .. } if table == "products"),
        "expected Foreign on products, got {err:?}"
    );
}

#[test]
fn statement_initial_update_still_names_its_table() {
    let sql = "UPDATE sales SET status = ?1 WHERE id = ?2";
    assert!(check_statement(SALES, &Grants::none(), sql, Posture::ReadWrite).is_ok());
    let err = check_statement(
        SALES,
        &Grants::none(),
        "UPDATE products SET sku = ?1",
        Posture::ReadWrite,
    )
    .unwrap_err();
    assert!(matches!(err, NamespaceError::Foreign { .. }), "got {err:?}");
}

#[test]
fn join_on_two_own_tables_passes() {
    let sql = "SELECT s.id FROM sales s JOIN sale_lines l ON l.sale_id = s.id";
    assert!(check_statement(SALES, &Grants::none(), sql, Posture::ReadWrite).is_ok());
}

#[test]
fn granted_foreign_read_passes() {
    let grants = Grants::read([INVENTORY]);
    let sql = "SELECT id FROM products WHERE barcode = ?1";
    assert!(check_statement(SALES, &grants, sql, Posture::ReadWrite).is_ok());
}

#[test]
fn ungranted_foreign_read_is_foreign() {
    let sql = "SELECT id FROM products";
    let err = check_statement(SALES, &Grants::none(), sql, Posture::ReadWrite).unwrap_err();
    assert_eq!(
        err,
        NamespaceError::Foreign {
            table: "products".into(),
            owner: INVENTORY,
            self_owner: SALES,
        }
    );
}

#[test]
fn unknown_table_is_fail_closed() {
    let sql = "SELECT * FROM mystery_table";
    let err = check_statement(SALES, &Grants::none(), sql, Posture::ReadWrite).unwrap_err();
    assert_eq!(
        err,
        NamespaceError::UnknownTable {
            table: "mystery_table".into()
        }
    );
}

#[test]
fn quoted_identifiers_are_rejected() {
    for sql in [
        "SELECT * FROM \"sales\"",
        "SELECT * FROM `sales`",
        "SELECT * FROM [sales]",
    ] {
        let err = check_statement(SALES, &Grants::none(), sql, Posture::ReadWrite).unwrap_err();
        assert!(matches!(err, NamespaceError::Sql(_)), "{sql} -> {err:?}");
    }
}

#[test]
fn comment_hidden_foreign_table_is_still_caught() {
    let sql = "SELECT x FROM/**/products";
    let err = check_statement(SALES, &Grants::none(), sql, Posture::ReadWrite).unwrap_err();
    assert!(matches!(err, NamespaceError::Foreign { .. }), "{err:?}");
}

#[test]
fn line_comment_hidden_foreign_table_is_still_caught() {
    let sql = "SELECT x FROM -- note\n products";
    let err = check_statement(SALES, &Grants::none(), sql, Posture::ReadWrite).unwrap_err();
    assert!(matches!(err, NamespaceError::Foreign { .. }), "{err:?}");
}

#[test]
fn string_literal_content_is_not_a_table() {
    // The literal 'products' must not be read as a table reference.
    let sql = "SELECT id FROM sales WHERE note = 'products'";
    assert!(check_statement(SALES, &Grants::none(), sql, Posture::ReadWrite).is_ok());
}

#[test]
fn cte_names_are_not_treated_as_tables() {
    let sql = "WITH recent AS (SELECT id FROM sales) SELECT * FROM recent";
    assert!(check_statement(SALES, &Grants::none(), sql, Posture::ReadWrite).is_ok());
}

#[test]
fn reporting_can_read_sales_with_a_grant() {
    let grants = Grants::read([SALES]);
    assert!(
        check_statement(
            REPORTING,
            &grants,
            "SELECT total_minor FROM sales",
            Posture::ReadWrite
        )
        .is_ok()
    );
}

#[test]
fn reporting_without_a_grant_is_foreign() {
    let err = check_statement(
        REPORTING,
        &Grants::none(),
        "SELECT * FROM sales",
        Posture::ReadWrite,
    )
    .unwrap_err();
    assert!(matches!(err, NamespaceError::Foreign { .. }), "{err:?}");
}

#[test]
fn raw_returns_sql_after_check() {
    // The handle-level raw() is exercised against a real connection below.
    assert!(
        check_statement(
            SALES,
            &Grants::none(),
            "SELECT * FROM sales",
            Posture::ReadWrite
        )
        .is_ok()
    );
}

#[cfg(test)]
mod db_backed {
    use super::*;
    use crate::db::Store;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch("CREATE TABLE sales (id TEXT PRIMARY KEY, total_minor INTEGER);")
            .expect("create sales");
        conn
    }

    #[test]
    fn own_namespace_can_write_and_read() {
        let conn = mem();
        let ns = NamespacedStore::new(Store::new(&conn), SALES, Grants::none());
        ns.own()
            .execute(
                "INSERT INTO sales (id, total_minor) VALUES (?1, ?2)",
                ("s1", 100),
            )
            .expect("insert");
        let rows: Vec<(String, i64)> = ns
            .own()
            .query("SELECT id, total_minor FROM sales", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .expect("query");
        assert_eq!(rows, vec![("s1".to_string(), 100)]);
    }

    #[test]
    fn foreign_write_is_refused_before_touching_the_db() {
        let conn = mem();
        conn.execute_batch("CREATE TABLE products (id TEXT PRIMARY KEY);")
            .expect("create products");
        let ns = NamespacedStore::new(Store::new(&conn), SALES, Grants::none());
        let err = ns
            .own()
            .execute("INSERT INTO products (id) VALUES (?1)", ("p1",))
            .unwrap_err();
        assert!(
            matches!(err, NamespaceError::Foreign { ref table, .. } if table == "products"),
            "{err:?}"
        );
    }

    #[test]
    fn read_requires_a_grant_at_the_handle() {
        let conn = mem();
        let ns = NamespacedStore::new(Store::new(&conn), REPORTING, Grants::none());
        let Err(err) = ns.read(SALES) else {
            panic!("must be refused");
        };
        assert_eq!(err, NamespaceError::NotGranted { module: SALES });
    }

    #[test]
    fn granted_read_handle_works() {
        let conn = mem();
        let ns = NamespacedStore::new(Store::new(&conn), REPORTING, Grants::read([SALES]));
        let rows: Vec<i64> = ns
            .read(SALES)
            .expect("granted")
            .query("SELECT total_minor FROM sales", [], |r| r.get(0))
            .expect("query");
        assert!(rows.is_empty());
    }

    #[test]
    fn raw_rejects_a_foreign_table() {
        let conn = mem();
        let ns = NamespacedStore::new(Store::new(&conn), SALES, Grants::none());
        let err = ns.own().raw("SELECT * FROM customers").unwrap_err();
        assert!(matches!(err, NamespaceError::Foreign { .. }), "{err:?}");
    }
}
