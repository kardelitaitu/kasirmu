use super::*;
use rusqlite::Connection;

fn fresh() -> Connection {
    kasirmu_core::migrations::fresh_db()
}

fn seed_terminal(conn: &Connection, id: &str, name: &str, device_id: &str, is_active: bool) {
    conn.execute(
        "INSERT INTO terminals (id, name, device_id, is_active) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, name, device_id, is_active as i64],
    )
    .unwrap();
}

#[test]
fn get_terminal_returns_none_for_missing() {
    let conn = fresh();
    let repo = TerminalRepository::new(&conn);
    assert!(repo.get_terminal("nope").unwrap().is_none());
}

#[test]
fn get_terminal_roundtrip() {
    let conn = fresh();
    seed_terminal(&conn, "t-1", "POS-1", "dev-abc", true);
    let repo = TerminalRepository::new(&conn);

    let t = repo.get_terminal("t-1").unwrap().unwrap();
    assert_eq!(t.id, "t-1");
    assert_eq!(t.name, "POS-1");
    assert_eq!(t.device_id, "dev-abc");
    assert!(t.is_active);
}

#[test]
fn get_terminal_inactive() {
    let conn = fresh();
    seed_terminal(&conn, "t-1", "Offline", "dev-xyz", false);
    let repo = TerminalRepository::new(&conn);

    let t = repo.get_terminal("t-1").unwrap().unwrap();
    assert!(!t.is_active);
}

#[test]
fn get_terminal_with_optional_fields() {
    let conn = fresh();
    conn.execute(
        "INSERT INTO terminals (id, name, device_id, terminal_secret, is_active, metadata)
         VALUES ('t-2', 'POS-2', 'dev-2', 's3cret', 1, '{\"version\":2}')",
        [],
    )
    .unwrap();
    let repo = TerminalRepository::new(&conn);

    let t = repo.get_terminal("t-2").unwrap().unwrap();
    assert_eq!(t.terminal_secret.as_deref(), Some("s3cret"));
    assert_eq!(t.metadata.as_deref(), Some("{\"version\":2}"));
}

// ── P3.2/P3.5: the repository is namespace-checked ──────────────────────

/// The wrap must not have widened the module's reach: its own table passes the
/// ownership check, a foreign table through the same handle is refused.
#[test]
fn the_repository_is_scoped_to_its_own_namespace() {
    use kasirmu_core::db::Store;
    use kasirmu_core::db::namespaced::{Grants, ModuleId, NamespaceError, NamespacedStore};

    let conn = fresh();
    let ns = NamespacedStore::new(Store::new(&conn), ModuleId("terminal"), Grants::none());

    ns.own()
        .query(
            "SELECT id FROM terminals WHERE id = ?1",
            rusqlite::params!["t"],
            |row| row.get::<_, String>(0),
        )
        .expect("terminal must be allowed to read its own table");

    let err = ns
        .own()
        .query("SELECT id FROM sales", [], |row| row.get::<_, String>(0))
        .unwrap_err();
    assert!(
        matches!(err, NamespaceError::Foreign { ref table, .. } if table == "sales"),
        "expected Foreign on sales, got {err:?}"
    );
}
