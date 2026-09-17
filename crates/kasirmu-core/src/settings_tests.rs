use super::*;
use crate::migrations;

fn fresh() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrations::run(&mut conn).unwrap();
    conn
}

// ── Raw get / set / remove ───────────────────────────────────

#[test]
fn get_returns_none_for_missing_key() {
    let conn = fresh();
    assert_eq!(Settings::get(&conn, "nope").unwrap(), None);
}

#[test]
fn set_and_get_roundtrip() {
    let conn = fresh();
    Settings::set(&conn, "test.key", "hello").unwrap();
    assert_eq!(
        Settings::get(&conn, "test.key").unwrap(),
        Some("hello".into())
    );
}

#[test]
fn set_overwrites_existing() {
    let conn = fresh();
    Settings::set(&conn, "k", "v1").unwrap();
    Settings::set(&conn, "k", "v2").unwrap();
    assert_eq!(Settings::get(&conn, "k").unwrap(), Some("v2".into()));
}

#[test]
fn remove_existing_key() {
    let conn = fresh();
    Settings::set(&conn, "k", "v").unwrap();
    assert!(Settings::remove(&conn, "k").unwrap());
    assert_eq!(Settings::get(&conn, "k").unwrap(), None);
}

#[test]
fn remove_missing_key_returns_false() {
    let conn = fresh();
    assert!(!Settings::remove(&conn, "nope").unwrap());
}

// ── Batch ────────────────────────────────────────────────────

#[test]
fn set_batch_inserts_multiple() {
    let conn = fresh();
    let rows: Vec<(String, String)> = vec![("a".into(), "1".into()), ("b".into(), "2".into())];
    Settings::set_batch(&conn, &rows).unwrap();
    assert_eq!(Settings::get(&conn, "a").unwrap(), Some("1".into()));
    assert_eq!(Settings::get(&conn, "b").unwrap(), Some("2".into()));
}

#[test]
fn load_all_returns_all_rows() {
    let conn = fresh();
    Settings::set(&conn, "a", "1").unwrap();
    Settings::set(&conn, "b", "2").unwrap();
    let all = Settings::load_all(&conn).unwrap();
    // currency.default is seeded by init migration
    assert!(all.len() >= 2);
    assert!(all.contains(&("a".into(), "1".into())));
    assert!(all.contains(&("b".into(), "2".into())));
}

// ── Feature flags ────────────────────────────────────────────

#[test]
fn load_features_from_empty_db() {
    let conn = fresh();
    let reg = Settings::load_features(&conn).unwrap();
    assert_eq!(reg.count(), 0);
}

#[test]
fn save_and_load_features_roundtrip() {
    let conn = fresh();
    let reg = FeatureRegistry::simple_retail();
    Settings::save_features(&conn, &reg).unwrap();
    let loaded = Settings::load_features(&conn).unwrap();
    assert_eq!(loaded, reg);
}

#[test]
fn save_features_preserves_non_feature_settings() {
    let conn = fresh();
    Settings::set_store_name(&conn, "My Store").unwrap();
    Settings::set_default_currency(&conn, "IDR").unwrap();

    let reg = FeatureRegistry::simple_retail();
    Settings::save_features(&conn, &reg).unwrap();

    assert_eq!(
        Settings::get_store_name(&conn).unwrap(),
        Some("My Store".into())
    );
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap(),
        Some("IDR".into())
    );
}

#[test]
fn prune_stale_features_removes_old_flags() {
    let conn = fresh();
    let reg = FeatureRegistry::simple_retail();
    let rows = reg.to_settings_rows();

    let mut all_rows = rows.clone();
    all_rows.push(("feature.old-flag".into(), "1".into()));
    Settings::set_batch(&conn, &all_rows).unwrap();

    let removed = Settings::prune_stale_features(&conn, &reg).unwrap();
    assert_eq!(removed, 1);
    let loaded = Settings::load_features(&conn).unwrap();
    assert_eq!(loaded, reg);
}

#[test]
fn prune_stale_features_noop_when_no_stale() {
    let conn = fresh();
    let reg = FeatureRegistry::simple_retail();
    Settings::save_features(&conn, &reg).unwrap();

    let removed = Settings::prune_stale_features(&conn, &reg).unwrap();
    assert_eq!(removed, 0);
    let loaded = Settings::load_features(&conn).unwrap();
    assert_eq!(loaded, reg);
}

// ── Typed store config ───────────────────────────────────────

#[test]
fn store_name_default_is_none() {
    let conn = fresh();
    assert_eq!(Settings::get_store_name(&conn).unwrap(), None);
}

#[test]
fn set_and_get_store_name() {
    let conn = fresh();
    Settings::set_store_name(&conn, "Acme POS").unwrap();
    assert_eq!(
        Settings::get_store_name(&conn).unwrap(),
        Some("Acme POS".into())
    );
}

#[test]
fn set_and_get_default_currency() {
    let conn = fresh();
    Settings::set_default_currency(&conn, "EUR").unwrap();
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap(),
        Some("EUR".into())
    );
}

#[test]
fn tax_rounding_mode_defaults_to_half_up() {
    let conn = fresh();
    assert_eq!(
        Settings::get_tax_rounding_mode(&conn).unwrap(),
        RoundingMode::HalfUp
    );
}

#[test]
fn set_and_get_tax_rounding_mode_roundtrip() {
    let conn = fresh();
    Settings::set_tax_rounding_mode(&conn, RoundingMode::Truncate).unwrap();
    assert_eq!(
        Settings::get_tax_rounding_mode(&conn).unwrap(),
        RoundingMode::Truncate
    );
    Settings::set_tax_rounding_mode(&conn, RoundingMode::HalfUp).unwrap();
    assert_eq!(
        Settings::get_tax_rounding_mode(&conn).unwrap(),
        RoundingMode::HalfUp
    );
}

#[test]
fn set_tax_rounding_mode_str_rejects_unknown_value() {
    let conn = fresh();
    assert!(Settings::set_tax_rounding_mode_str(&conn, "bankers").is_err());
    // Valid values still round-trip.
    Settings::set_tax_rounding_mode_str(&conn, "truncate").unwrap();
    assert_eq!(
        Settings::get_tax_rounding_mode(&conn).unwrap(),
        RoundingMode::Truncate
    );
}

#[test]
fn tax_rounding_mode_unknown_wire_value_falls_back_to_half_up() {
    let conn = fresh();
    Settings::set(&conn, "tax.rounding_mode", "half_even").unwrap();
    assert_eq!(
        Settings::get_tax_rounding_mode(&conn).unwrap(),
        RoundingMode::HalfUp
    );
}

#[test]
fn wire_name_matches_serde_snake_case() {
    assert_eq!(RoundingMode::HalfUp.wire_name(), "half_up");
    assert_eq!(RoundingMode::Truncate.wire_name(), "truncate");
}

/// `kasirmu_core::Settings::set()` does NOT touch the `setting_updated`
/// delta table. This documents the architectural gap — the Tauri
/// command layer calls `Settings::set()` which bypasses the delta
/// ledger. When the commands are migrated to use `set_tracked`,
/// this test should be updated to assert the opposite.
#[test]
fn set_does_not_write_delta() {
    let conn = fresh();
    // Minimal schema — indexes from migration 100_setting_updated.sql
    // are omitted since this test only counts rows.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS setting_updated (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            key         TEXT    NOT NULL,
            value       TEXT    NOT NULL,
            terminal_id TEXT    NOT NULL DEFAULT 'unknown',
            version     INTEGER NOT NULL,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )",
    )
    .unwrap();

    Settings::set(&conn, "test.delta.gap", "should-not-appear-in-delta").unwrap();

    // The settings table gets the value.
    assert_eq!(
        Settings::get(&conn, "test.delta.gap").unwrap(),
        Some("should-not-appear-in-delta".into())
    );

    // But the delta table should have zero rows — set() doesn't write deltas.
    let delta_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM setting_updated", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        delta_count, 0,
        "Settings::set() should NOT write to setting_updated"
    );
}

/// After ADR #22 Phase 0d, `kasirmu_core::Settings` delegates
/// `set_tracked` and `get_version` to `platform_core::Settings`.
/// Verify the delegation layer works end-to-end.
#[test]
fn set_tracked_delegation_writes_delta() {
    let conn = fresh();
    // Create the delta table inline (matching set_does_not_write_delta pattern).
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS setting_updated (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            key         TEXT    NOT NULL,
            value       TEXT    NOT NULL,
            terminal_id TEXT    NOT NULL DEFAULT 'unknown',
            version     INTEGER NOT NULL,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )",
    )
    .unwrap();
    Settings::set_tracked(&conn, "deleg.k", "deleg-v", "term-del").unwrap();
    assert_eq!(
        Settings::get(&conn, "deleg.k").unwrap(),
        Some("deleg-v".into())
    );
    assert_eq!(
        Settings::get_version(&conn, "deleg.k", "term-del").unwrap(),
        Some(1)
    );
}

/// `write_delta` delegation: standalone delta write without
/// updating the settings table.
#[test]
fn write_delta_delegation_works() {
    let conn = fresh();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS setting_updated (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            key         TEXT    NOT NULL,
            value       TEXT    NOT NULL,
            terminal_id TEXT    NOT NULL DEFAULT 'unknown',
            version     INTEGER NOT NULL,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )",
    )
    .unwrap();
    Settings::write_delta(&conn, "w.k", "w-v", "term-w").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "w.k", "term-w").unwrap(),
        Some(1)
    );
}
