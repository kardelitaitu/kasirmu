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


    /// A stand-in domain error for the query_try tests: it can be built from the
    /// two errors the namespace layer produces, exactly like a module's own error.
    #[derive(Debug)]
    // The Db/Ns variants are only ever constructed by the `?`/map_err
    // conversions below; keeping them wrapped is the point of the test.
    #[allow(dead_code)]
    enum DemoError {
        Db(rusqlite::Error),
        Ns(NamespaceError),
        Domain(&'static str),
    }

    impl From<rusqlite::Error> for DemoError {
        fn from(e: rusqlite::Error) -> Self {
            Self::Db(e)
        }
    }

    impl From<NamespaceError> for DemoError {
        fn from(e: NamespaceError) -> Self {
            Self::Ns(e)
        }
    }

    #[test]
    fn query_try_surfaces_a_domain_rejection() {
        // The whole point of query_try: a mapper may fail closed with the module's
        // OWN error, which plain query (pinned to rusqlite::Result) cannot express.
        let conn = mem();
        conn.execute("INSERT INTO sales (id, total_minor) VALUES ('s1', 1)", [])
            .expect("seed a row so the mapper actually runs");
        let ns = NamespacedStore::new(Store::new(&conn), SALES, Grants::none());
        let err = ns
            .own()
            .query_try("SELECT total_minor FROM sales", [], |_row| {
                Err::<i64, DemoError>(DemoError::Domain("not a valid value"))
            })
            .unwrap_err();
        assert!(
            matches!(err, DemoError::Domain("not a valid value")),
            "{err:?}"
        );
    }

    #[test]
    fn query_try_still_checks_the_namespace() {
        // The check runs before the mapper: a foreign table is refused with the
        // module error (via From<NamespaceError>), not silently queried.
        let conn = mem();
        let ns = NamespacedStore::new(Store::new(&conn), SALES, Grants::none());
        let err = ns
            .own()
            .query_try::<i64, _, _, DemoError>("SELECT id FROM customers", [], |r| Ok(r.get(0)?))
            .unwrap_err();
        assert!(
            matches!(err, DemoError::Ns(NamespaceError::Foreign { ref table, .. }) if table == "customers"),
            "{err:?}"
        );
    }

    #[test]
    fn query_try_passes_rows_through() {
        let conn = mem();
        let ns = NamespacedStore::new(Store::new(&conn), SALES, Grants::none());
        let rows = ns
            .own()
            .query_try::<i64, _, _, DemoError>("SELECT total_minor FROM sales", [], |r| {
                Ok(r.get(0)?)
            })
            .expect("own-table read");
        assert!(rows.is_empty());
    }

    #[test]
    fn grants_from_capabilities_reads_only_foreign_read_actions() {
        let caps = vec![
            "read:inventory".to_string(),
            "read:sales".to_string(),
            "write:sales".to_string(),
            "subscribe:sale.completed".to_string(),
            "read:reporting".to_string(),
        ];
        let grants = Grants::from_capabilities(ModuleId("reporting"), &caps);
        assert!(grants.allows(ModuleId("inventory")));
        assert!(grants.allows(ModuleId("sales")));
        // The module's own id is not a foreign grant.
        assert!(!grants.allows(ModuleId("reporting")));
        assert_eq!(grants.modules().len(), 2);
    }

    #[test]
    fn grants_from_capabilities_ignores_a_self_read_and_non_read_actions() {
        let caps = vec![
            "read:terminal".to_string(),
            "write:terminal".to_string(),
            "subscribe:terminal.updated".to_string(),
        ];
        let grants = Grants::from_capabilities(ModuleId("terminal"), &caps);
        assert!(grants.modules().is_empty(), "{grants:?}");
    }

    #[test]
    fn grants_from_capabilities_lets_a_granted_read_pass_and_refuses_an_ungranted_one() {
        let conn = mem();
        conn.execute_batch("CREATE TABLE customers (id TEXT PRIMARY KEY);")
            .expect("create customers");
        let caps = vec!["read:crm".to_string()];
        let ns = NamespacedStore::new(
            Store::new(&conn),
            SALES,
            Grants::from_capabilities(SALES, &caps),
        );
        // `customers` is owned by `crm` and now granted.
        ns.read(ModuleId("crm"))
            .expect("granted foreign read")
            .query("SELECT id FROM customers", [], |r| r.get::<_, String>(0))
            .expect("granted foreign query");
        // `loyalty` was not granted, so the handle itself is refused.
        let err = ns
            .read(ModuleId("loyalty"))
            .expect_err("an ungranted module must not yield a handle");
        assert!(
            matches!(err, NamespaceError::NotGranted { module } if module == ModuleId("loyalty")),
            "{err:?}"
        );
    }
}

#[test]
fn grants_from_manifest_json_reads_the_capabilities_array() {
    let manifest = serde_json::json!({
        "id": "reporting",
        "capabilities": ["read:inventory", "read:sales", "read:reporting", "write:reporting"]
    })
    .to_string();
    let grants = Grants::from_manifest_json(ModuleId("reporting"), &manifest);
    assert!(grants.allows(ModuleId("inventory")));
    assert!(grants.allows(ModuleId("sales")));
    assert!(!grants.allows(ModuleId("reporting")), "own read is not a grant");
    assert_eq!(grants.modules().len(), 2);
}

#[test]
fn grants_from_manifest_json_fails_closed_without_capabilities() {
    let manifest = serde_json::json!({ "id": "crm", "dependencies": [] }).to_string();
    let grants = Grants::from_manifest_json(ModuleId("crm"), &manifest);
    assert_eq!(grants.modules().len(), 0);

    let malformed = Grants::from_manifest_json(ModuleId("crm"), "not json");
    assert_eq!(malformed.modules().len(), 0);
}

#[test]
fn a_manifest_derived_grant_lets_a_declared_dependency_read_pass() {
    // The real reporting manifest declares read:inventory, so a store built
    // from it may read inventory's tables but nothing else.
    let manifest = include_str!("../../../../modules/reporting/manifest.json");
    let grants = Grants::from_manifest_json(ModuleId("reporting"), manifest);
    assert!(grants.allows(ModuleId("inventory")));
    assert!(grants.allows(ModuleId("sales")));
    assert!(!grants.allows(ModuleId("loyalty")));
}