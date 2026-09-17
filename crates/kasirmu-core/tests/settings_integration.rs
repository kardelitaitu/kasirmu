//! Integration tests for the settings module — config persistence,
//! default values, updates, feature flags, batch operations, and
//! edge cases with data.
//!
//! Tests exercise the full persistence layer via [`kasirmu_core::Settings`]
//! (which wraps `platform_core::settings::Settings`) and the Store API
//! against an in-memory SQLite database.

#![allow(deprecated)]

use kasirmu_core::{Feature, FeatureRegistry, Settings, Store, migrations};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────

fn setup() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

// ── Typed store configuration ────────────────────────────────────────

#[test]
fn store_name_default_is_none() {
    let conn = setup();
    assert_eq!(Settings::get_store_name(&conn).unwrap(), None);
}

#[test]
fn set_and_get_store_name() {
    let conn = setup();
    Settings::set_store_name(&conn, "Acme POS").unwrap();
    assert_eq!(
        Settings::get_store_name(&conn).unwrap(),
        Some("Acme POS".into())
    );
}

#[test]
fn set_store_name_overwrites() {
    let conn = setup();
    Settings::set_store_name(&conn, "Old Name").unwrap();
    Settings::set_store_name(&conn, "New Name").unwrap();
    assert_eq!(
        Settings::get_store_name(&conn).unwrap(),
        Some("New Name".into())
    );
}

#[test]
fn store_address_default_is_none() {
    let conn = setup();
    assert_eq!(Settings::get_store_address(&conn).unwrap(), None);
}

#[test]
fn set_and_get_store_address() {
    let conn = setup();
    Settings::set_store_address(&conn, "123 Main St, City, State 12345").unwrap();
    assert_eq!(
        Settings::get_store_address(&conn).unwrap(),
        Some("123 Main St, City, State 12345".into())
    );
}

#[test]
fn store_tax_id_default_is_none() {
    let conn = setup();
    assert_eq!(Settings::get_store_tax_id(&conn).unwrap(), None);
}

#[test]
fn set_and_get_store_tax_id() {
    let conn = setup();
    Settings::set_store_tax_id(&conn, "12-3456789").unwrap();
    assert_eq!(
        Settings::get_store_tax_id(&conn).unwrap(),
        Some("12-3456789".into())
    );
}

#[test]
fn default_currency_default_is_none() {
    let conn = setup();
    assert_eq!(Settings::get_default_currency(&conn).unwrap(), None);
}

#[test]
fn set_and_get_default_currency() {
    let conn = setup();
    Settings::set_default_currency(&conn, "EUR").unwrap();
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap(),
        Some("EUR".into())
    );
}

// ── All typed settings coexist ───────────────────────────────────────

#[test]
fn all_typed_settings_roundtrip() {
    let conn = setup();

    Settings::set_store_name(&conn, "My Store").unwrap();
    Settings::set_store_address(&conn, "456 Oak Ave").unwrap();
    Settings::set_store_tax_id(&conn, "TAX-999").unwrap();
    Settings::set_default_currency(&conn, "GBP").unwrap();

    assert_eq!(
        Settings::get_store_name(&conn).unwrap(),
        Some("My Store".into())
    );
    assert_eq!(
        Settings::get_store_address(&conn).unwrap(),
        Some("456 Oak Ave".into())
    );
    assert_eq!(
        Settings::get_store_tax_id(&conn).unwrap(),
        Some("TAX-999".into())
    );
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap(),
        Some("GBP".into())
    );
}

// ── Receipt display settings ─────────────────────────────────────────

#[test]
fn receipt_show_currency_default_false() {
    let conn = setup();
    assert!(!Settings::get_receipt_show_currency(&conn).unwrap());
}

#[test]
fn receipt_show_currency_true_then_false() {
    let conn = setup();
    Settings::set_receipt_show_currency(&conn, true).unwrap();
    assert!(Settings::get_receipt_show_currency(&conn).unwrap());

    Settings::set_receipt_show_currency(&conn, false).unwrap();
    assert!(!Settings::get_receipt_show_currency(&conn).unwrap());
}

#[test]
fn receipt_decimal_separator_default_dot() {
    let conn = setup();
    assert_eq!(
        Settings::get_receipt_decimal_separator(&conn).unwrap(),
        "dot"
    );
}

#[test]
fn receipt_decimal_separator_roundtrip() {
    let conn = setup();
    Settings::set_receipt_decimal_separator(&conn, "comma").unwrap();
    assert_eq!(
        Settings::get_receipt_decimal_separator(&conn).unwrap(),
        "comma"
    );

    Settings::set_receipt_decimal_separator(&conn, "none").unwrap();
    assert_eq!(
        Settings::get_receipt_decimal_separator(&conn).unwrap(),
        "none"
    );

    // Back to dot.
    Settings::set_receipt_decimal_separator(&conn, "dot").unwrap();
    assert_eq!(
        Settings::get_receipt_decimal_separator(&conn).unwrap(),
        "dot"
    );
}

#[test]
fn receipt_show_tax_default_true() {
    let conn = setup();
    assert!(Settings::get_receipt_show_tax(&conn).unwrap());
}

#[test]
fn receipt_show_tax_true_then_false() {
    let conn = setup();
    assert!(Settings::get_receipt_show_tax(&conn).unwrap());

    Settings::set_receipt_show_tax(&conn, false).unwrap();
    assert!(!Settings::get_receipt_show_tax(&conn).unwrap());

    Settings::set_receipt_show_tax(&conn, true).unwrap();
    assert!(Settings::get_receipt_show_tax(&conn).unwrap());
}

#[test]
fn receipt_footer_default_empty() {
    let conn = setup();
    assert_eq!(Settings::get_receipt_footer(&conn).unwrap(), "");
}

#[test]
fn receipt_footer_roundtrip() {
    let conn = setup();
    Settings::set_receipt_footer(&conn, "Thank you for shopping!").unwrap();
    assert_eq!(
        Settings::get_receipt_footer(&conn).unwrap(),
        "Thank you for shopping!"
    );

    // Set to empty clears it.
    Settings::set_receipt_footer(&conn, "").unwrap();
    assert_eq!(Settings::get_receipt_footer(&conn).unwrap(), "");
}

#[test]
fn receipt_paper_width_default_standard() {
    let conn = setup();
    assert_eq!(
        Settings::get_receipt_paper_width(&conn).unwrap(),
        "standard"
    );
}

#[test]
fn receipt_paper_width_narrow() {
    let conn = setup();
    Settings::set_receipt_paper_width(&conn, "narrow").unwrap();
    assert_eq!(Settings::get_receipt_paper_width(&conn).unwrap(), "narrow");
}

// ── Cloud sync settings ──────────────────────────────────────────────

#[test]
fn sync_server_url_default_none() {
    let conn = setup();
    assert_eq!(Settings::get_sync_server_url(&conn).unwrap(), None);
}

#[test]
fn sync_server_url_roundtrip() {
    let conn = setup();
    Settings::set_sync_server_url(&conn, "https://sync.example.com/api").unwrap();
    assert_eq!(
        Settings::get_sync_server_url(&conn).unwrap(),
        Some("https://sync.example.com/api".into())
    );
}

#[test]
fn sync_api_key_default_none() {
    let conn = setup();
    assert_eq!(Settings::get_sync_api_key(&conn).unwrap(), None);
}

#[test]
fn sync_api_key_roundtrip() {
    let conn = setup();
    Settings::set_sync_api_key(&conn, "sk_test_abc123_def456").unwrap();
    assert_eq!(
        Settings::get_sync_api_key(&conn).unwrap(),
        Some("sk_test_abc123_def456".into())
    );
}

#[test]
fn sync_enabled_default_false() {
    let conn = setup();
    assert!(!Settings::is_sync_enabled(&conn).unwrap());
}

#[test]
fn sync_enabled_toggle() {
    let conn = setup();
    Settings::set_sync_enabled(&conn, true).unwrap();
    assert!(Settings::is_sync_enabled(&conn).unwrap());

    Settings::set_sync_enabled(&conn, false).unwrap();
    assert!(!Settings::is_sync_enabled(&conn).unwrap());
}

#[test]
fn sync_settings_independent_of_store_settings() {
    let conn = setup();

    // Mix sync and store settings.
    Settings::set_store_name(&conn, "My Store").unwrap();
    Settings::set_sync_server_url(&conn, "https://sync.example.com").unwrap();
    Settings::set_sync_enabled(&conn, true).unwrap();
    Settings::set_default_currency(&conn, "USD").unwrap();
    Settings::set_sync_api_key(&conn, "sk-123").unwrap();

    assert_eq!(
        Settings::get_store_name(&conn).unwrap(),
        Some("My Store".into())
    );
    assert_eq!(
        Settings::get_sync_server_url(&conn).unwrap(),
        Some("https://sync.example.com".into())
    );
    assert!(Settings::is_sync_enabled(&conn).unwrap());
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap(),
        Some("USD".into())
    );
    assert_eq!(
        Settings::get_sync_api_key(&conn).unwrap(),
        Some("sk-123".into())
    );
}

// ── Feature flags via Settings ───────────────────────────────────────

#[test]
fn load_features_empty_db_returns_empty() {
    let conn = setup();
    let reg = Settings::load_features(&conn).unwrap();
    assert_eq!(reg.count(), 0);
}

#[test]
fn save_and_load_features() {
    let conn = setup();
    let reg = FeatureRegistry::simple_retail();
    Settings::save_features(&conn, &reg).unwrap();
    let loaded = Settings::load_features(&conn).unwrap();
    assert_eq!(loaded, reg);
}

#[test]
fn save_features_replaces_previous() {
    let conn = setup();

    let simple = FeatureRegistry::simple_retail();
    Settings::save_features(&conn, &simple).unwrap();

    let full = FeatureRegistry::full_store();
    Settings::save_features(&conn, &full).unwrap();

    let loaded = Settings::load_features(&conn).unwrap();
    assert_eq!(
        loaded, full,
        "full store features should replace simple retail"
    );
}

#[test]
fn save_features_with_full_store() {
    let conn = setup();
    let reg = FeatureRegistry::full_store();
    Settings::save_features(&conn, &reg).unwrap();
    let loaded = Settings::load_features(&conn).unwrap();

    // Full store has 24 features (from the preset).
    assert!(loaded.count() >= 20);
    assert!(loaded.is_enabled(Feature::SimpleRetail));
    assert!(loaded.is_enabled(Feature::CardPayment));
    assert!(loaded.is_enabled(Feature::StaffLogin));
    assert!(loaded.is_enabled(Feature::Analytics));
    assert!(loaded.is_enabled(Feature::Reporting));
}

#[test]
fn prune_stale_features_removes_old_flags() {
    let conn = setup();
    let reg = FeatureRegistry::simple_retail();
    Settings::save_features(&conn, &reg).unwrap();

    // Inject a stale feature flag.
    Settings::set(&conn, "feature.stale-flag", "1").unwrap();

    let removed = Settings::prune_stale_features(&conn, &reg).unwrap();
    assert_eq!(removed, 1, "should remove the stale flag");

    // The stale flag should be gone.
    let all = Settings::load_all(&conn).unwrap();
    assert!(
        !all.iter().any(|(k, _)| k == "feature.stale-flag"),
        "stale flag should have been removed"
    );

    // The current features should still be present.
    let loaded = Settings::load_features(&conn).unwrap();
    assert_eq!(loaded, reg);
}

#[test]
fn prune_stale_features_noop_when_no_stale() {
    let conn = setup();
    let reg = FeatureRegistry::full_store();
    Settings::save_features(&conn, &reg).unwrap();
    let removed = Settings::prune_stale_features(&conn, &reg).unwrap();
    assert_eq!(removed, 0, "no stale flags to remove");
}

#[test]
fn prune_stale_ignores_non_feature_settings() {
    let conn = setup();
    let reg = FeatureRegistry::simple_retail();
    Settings::save_features(&conn, &reg).unwrap();

    // Inject some non-feature settings and a stale feature flag.
    Settings::set_store_name(&conn, "Test Store").unwrap();
    Settings::set(&conn, "feature.old-flag", "1").unwrap();
    Settings::set_default_currency(&conn, "JPY").unwrap();

    let removed = Settings::prune_stale_features(&conn, &reg).unwrap();
    assert_eq!(removed, 1, "only the stale feature flag should be removed");

    // Non-feature settings should survive.
    assert_eq!(
        Settings::get_store_name(&conn).unwrap(),
        Some("Test Store".into())
    );
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap(),
        Some("JPY".into())
    );
}

// ── Feature flags + store settings coexist ───────────────────────────

#[test]
fn feature_flags_and_store_settings_coexist_in_load_all() {
    let conn = setup();
    let reg = FeatureRegistry::simple_retail();
    Settings::save_features(&conn, &reg).unwrap();
    Settings::set_store_name(&conn, "Coexistence Store").unwrap();
    Settings::set_store_address(&conn, "789 Pine Rd").unwrap();
    Settings::set_sync_enabled(&conn, true).unwrap();

    let all = Settings::load_all(&conn).unwrap();

    // Should contain feature rows.
    assert!(
        all.iter().any(|(k, _)| k.starts_with("feature.")),
        "load_all should include feature flag rows"
    );

    // Should contain store settings.
    assert!(
        all.iter().any(|(k, _)| k == "store.name"),
        "load_all should include store.name"
    );
    assert!(
        all.iter().any(|(k, _)| k == "store.address"),
        "load_all should include store.address"
    );
    assert!(
        all.iter().any(|(k, _)| k == "sync_enabled"),
        "load_all should include sync_enabled"
    );
}

// ── Batch operations ─────────────────────────────────────────────────

#[test]
fn load_all_empty_db() {
    let conn = setup();
    let all = Settings::load_all(&conn).unwrap();
    assert!(all.is_empty(), "empty DB should return empty settings");
}

#[test]
fn set_batch_inserts_and_overwrites() {
    let conn = setup();
    let rows: Vec<(String, String)> = vec![
        ("key.a".into(), "value-a".into()),
        ("key.b".into(), "value-b".into()),
    ];
    Settings::set_batch(&conn, &rows).unwrap();

    assert_eq!(
        Settings::get(&conn, "key.a").unwrap(),
        Some("value-a".into())
    );
    assert_eq!(
        Settings::get(&conn, "key.b").unwrap(),
        Some("value-b".into())
    );

    // Overwrite one key and add a new one.
    let rows2: Vec<(String, String)> = vec![
        ("key.a".into(), "updated-a".into()),
        ("key.c".into(), "value-c".into()),
    ];
    Settings::set_batch(&conn, &rows2).unwrap();

    assert_eq!(
        Settings::get(&conn, "key.a").unwrap(),
        Some("updated-a".into())
    );
    assert_eq!(
        Settings::get(&conn, "key.b").unwrap(),
        Some("value-b".into())
    );
    assert_eq!(
        Settings::get(&conn, "key.c").unwrap(),
        Some("value-c".into())
    );
}

#[test]
fn load_all_ordered_by_key() {
    let conn = setup();
    let rows: Vec<(String, String)> = vec![
        ("z".into(), "last".into()),
        ("a".into(), "first".into()),
        ("m".into(), "middle".into()),
    ];
    Settings::set_batch(&conn, &rows).unwrap();

    let all = Settings::load_all(&conn).unwrap();
    assert_eq!(all.len(), 3);
    assert_eq!(all[0].0, "a");
    assert_eq!(all[1].0, "m");
    assert_eq!(all[2].0, "z");
}

#[test]
fn set_batch_empty_vec_is_noop() {
    let conn = setup();
    Settings::set_batch(&conn, &[]).unwrap();
    assert_eq!(Settings::load_all(&conn).unwrap().len(), 0);
}

#[test]
fn set_batch_large_number_of_settings() {
    let conn = setup();
    let rows: Vec<(String, String)> = (0..100)
        .map(|i| (format!("key.{i}"), format!("value.{i}")))
        .collect();
    Settings::set_batch(&conn, &rows).unwrap();

    let all = Settings::load_all(&conn).unwrap();
    assert_eq!(all.len(), 100, "all 100 settings should be stored");

    // Verify a few values.
    assert_eq!(
        Settings::get(&conn, "key.0").unwrap(),
        Some("value.0".into())
    );
    assert_eq!(
        Settings::get(&conn, "key.50").unwrap(),
        Some("value.50".into())
    );
    assert_eq!(
        Settings::get(&conn, "key.99").unwrap(),
        Some("value.99".into())
    );
}

// ── Large / edge-case values ─────────────────────────────────────────

#[test]
fn long_string_value_roundtrip() {
    let conn = setup();
    let long = "A".repeat(10_000);
    Settings::set(&conn, "long.value", &long).unwrap();
    let loaded = Settings::get(&conn, "long.value").unwrap().unwrap();
    assert_eq!(loaded.len(), 10_000);
    assert_eq!(loaded, long);
}

#[test]
fn unicode_value_roundtrip() {
    let conn = setup();
    let unicode = "日本語 Español العربية 🎉 你好 Привет";
    Settings::set(&conn, "unicode.test", unicode).unwrap();
    assert_eq!(
        Settings::get(&conn, "unicode.test").unwrap(),
        Some(unicode.into())
    );
}

#[test]
fn empty_value_roundtrip() {
    let conn = setup();
    Settings::set(&conn, "empty.val", "").unwrap();
    assert_eq!(Settings::get(&conn, "empty.val").unwrap(), Some("".into()));
}

#[test]
fn key_with_special_characters() {
    let conn = setup();
    Settings::set(&conn, "key.with.dots", "dots").unwrap();
    Settings::set(&conn, "key_with_underscores", "underscores").unwrap();
    Settings::set(&conn, "key-with-dashes", "dashes").unwrap();
    Settings::set(&conn, "key/with/slashes", "slashes").unwrap();

    assert_eq!(
        Settings::get(&conn, "key.with.dots").unwrap(),
        Some("dots".into())
    );
    assert_eq!(
        Settings::get(&conn, "key_with_underscores").unwrap(),
        Some("underscores".into())
    );
    assert_eq!(
        Settings::get(&conn, "key-with-dashes").unwrap(),
        Some("dashes".into())
    );
    assert_eq!(
        Settings::get(&conn, "key/with/slashes").unwrap(),
        Some("slashes".into())
    );
}

// ── Remove operations ────────────────────────────────────────────────

#[test]
fn remove_existing_setting() {
    let conn = setup();
    Settings::set(&conn, "temp.key", "temp-value").unwrap();
    assert!(Settings::remove(&conn, "temp.key").unwrap());
    assert_eq!(Settings::get(&conn, "temp.key").unwrap(), None);
}

#[test]
fn remove_nonexistent_returns_false() {
    let conn = setup();
    assert!(!Settings::remove(&conn, "nonexistent.key").unwrap());
}

#[test]
fn remove_typed_setting_restores_default() {
    let conn = setup();
    Settings::set_store_name(&conn, "Temp Name").unwrap();
    Settings::remove(&conn, "store.name").unwrap();
    assert_eq!(Settings::get_store_name(&conn).unwrap(), None);
}

#[test]
fn remove_idempotent() {
    let conn = setup();
    Settings::set(&conn, "k", "v").unwrap();
    assert!(Settings::remove(&conn, "k").unwrap());
    assert!(!Settings::remove(&conn, "k").unwrap());
}

// ── Overwrite operations ─────────────────────────────────────────────

#[test]
fn overwrite_with_same_value() {
    let conn = setup();
    Settings::set(&conn, "k", "same").unwrap();
    Settings::set(&conn, "k", "same").unwrap();
    assert_eq!(Settings::get(&conn, "k").unwrap(), Some("same".into()));
}

#[test]
fn overwrite_typed_setting_with_same_value() {
    let conn = setup();
    Settings::set_store_name(&conn, "Store").unwrap();
    Settings::set_store_name(&conn, "Store").unwrap();
    assert_eq!(
        Settings::get_store_name(&conn).unwrap(),
        Some("Store".into())
    );
}

// ── Store delegation (via Store API) ─────────────────────────────────

#[test]
fn store_get_set_setting() {
    let conn = setup();
    let s = store(&conn);
    assert_eq!(s.get_setting("my.key").unwrap(), None);
    s.set_setting("my.key", "hello").unwrap();
    assert_eq!(s.get_setting("my.key").unwrap(), Some("hello".into()));
}

#[test]
fn store_features_roundtrip() {
    let conn = setup();
    let s = store(&conn);
    let reg = FeatureRegistry::simple_retail();
    s.save_features(&reg).unwrap();
    let loaded = s.load_features().unwrap();
    assert_eq!(loaded, reg);
}

#[test]
fn store_name_via_store_api() {
    let conn = setup();
    let s = store(&conn);
    assert_eq!(s.get_store_name().unwrap(), None);
    s.set_store_name("Store API").unwrap();
    assert_eq!(s.get_store_name().unwrap(), Some("Store API".into()));
}

#[test]
fn store_namespace_isolation() {
    let conn = setup();

    // Settings with similar key prefixes should not interfere.
    Settings::set(&conn, "store.name", "Store A").unwrap();
    Settings::set(&conn, "store.name.version2", "Store B").unwrap();

    assert_eq!(
        Settings::get(&conn, "store.name").unwrap(),
        Some("Store A".into())
    );
    assert_eq!(
        Settings::get(&conn, "store.name.version2").unwrap(),
        Some("Store B".into())
    );
}

// ── Global Currency display settings ───────────────────────────────────

#[test]
fn currency_format_default_is_symbol() {
    let conn = setup();
    assert_eq!(Settings::get_currency_format(&conn).unwrap(), "symbol");
}

#[test]
fn currency_format_roundtrip() {
    let conn = setup();
    Settings::set_currency_format(&conn, "code").unwrap();
    assert_eq!(Settings::get_currency_format(&conn).unwrap(), "code");

    Settings::set_currency_format(&conn, "symbol").unwrap();
    assert_eq!(Settings::get_currency_format(&conn).unwrap(), "symbol");
}

#[test]
fn currency_symbol_position_default_is_prefix() {
    let conn = setup();
    assert_eq!(
        Settings::get_currency_symbol_position(&conn).unwrap(),
        "prefix"
    );
}

#[test]
fn currency_symbol_position_roundtrip() {
    let conn = setup();
    Settings::set_currency_symbol_position(&conn, "suffix").unwrap();
    assert_eq!(
        Settings::get_currency_symbol_position(&conn).unwrap(),
        "suffix"
    );

    Settings::set_currency_symbol_position(&conn, "prefix").unwrap();
    assert_eq!(
        Settings::get_currency_symbol_position(&conn).unwrap(),
        "prefix"
    );
}

#[test]
fn currency_decimal_separator_default_is_dot() {
    let conn = setup();
    assert_eq!(
        Settings::get_currency_decimal_separator(&conn).unwrap(),
        "dot"
    );
}

#[test]
fn currency_decimal_separator_roundtrip() {
    let conn = setup();
    Settings::set_currency_decimal_separator(&conn, "comma").unwrap();
    assert_eq!(
        Settings::get_currency_decimal_separator(&conn).unwrap(),
        "comma"
    );

    Settings::set_currency_decimal_separator(&conn, "dot").unwrap();
    assert_eq!(
        Settings::get_currency_decimal_separator(&conn).unwrap(),
        "dot"
    );
}

#[test]
fn currency_thousands_separator_default_is_comma() {
    let conn = setup();
    assert_eq!(
        Settings::get_currency_thousands_separator(&conn).unwrap(),
        "comma"
    );
}

#[test]
fn currency_thousands_separator_roundtrip() {
    let conn = setup();
    Settings::set_currency_thousands_separator(&conn, "space").unwrap();
    assert_eq!(
        Settings::get_currency_thousands_separator(&conn).unwrap(),
        "space"
    );

    Settings::set_currency_thousands_separator(&conn, "none").unwrap();
    assert_eq!(
        Settings::get_currency_thousands_separator(&conn).unwrap(),
        "none"
    );

    Settings::set_currency_thousands_separator(&conn, "comma").unwrap();
    assert_eq!(
        Settings::get_currency_thousands_separator(&conn).unwrap(),
        "comma"
    );
}

#[test]
fn all_global_currency_settings_coexist() {
    let conn = setup();
    Settings::set_currency_format(&conn, "code").unwrap();
    Settings::set_currency_symbol_position(&conn, "suffix").unwrap();
    Settings::set_currency_decimal_separator(&conn, "comma").unwrap();
    Settings::set_currency_thousands_separator(&conn, "space").unwrap();

    assert_eq!(Settings::get_currency_format(&conn).unwrap(), "code");
    assert_eq!(
        Settings::get_currency_symbol_position(&conn).unwrap(),
        "suffix"
    );
    assert_eq!(
        Settings::get_currency_decimal_separator(&conn).unwrap(),
        "comma"
    );
    assert_eq!(
        Settings::get_currency_thousands_separator(&conn).unwrap(),
        "space"
    );
}

// ── Default currency backward compatibility ────────────────────────────

#[test]
fn get_default_currency_falls_back_to_old_key() {
    let conn = setup();
    let s = store(&conn);

    // Write only the old key, new key absent.
    s.set_setting("store.default_currency", "JPY").unwrap();
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap(),
        Some("JPY".into())
    );
}

#[test]
fn get_default_currency_prefers_new_key() {
    let conn = setup();
    let s = store(&conn);

    // Write both old and new keys.
    s.set_setting("currency.default", "EUR").unwrap();
    s.set_setting("store.default_currency", "JPY").unwrap();
    // New key must take precedence.
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap(),
        Some("EUR".into())
    );
}

#[test]
fn set_default_currency_writes_new_key_and_cleans_up_old_key() {
    let conn = setup();
    let s = store(&conn);

    // Set old key, then set via the typed API.
    s.set_setting("store.default_currency", "GBP").unwrap();
    Settings::set_default_currency(&conn, "USD").unwrap();

    // New key should be written.
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap(),
        Some("USD".into())
    );
    assert_eq!(
        Settings::get(&conn, "currency.default").unwrap(),
        Some("USD".into())
    );
    // Old key must be cleaned up.
    assert_eq!(
        Settings::get(&conn, "store.default_currency").unwrap(),
        None
    );
}

#[test]
fn default_currency_roundtrip_via_store_api() {
    let conn = setup();
    let s = store(&conn);

    assert_eq!(s.get_default_currency().unwrap(), None);
    s.set_default_currency("CAD").unwrap();
    assert_eq!(s.get_default_currency().unwrap(), Some("CAD".into()));
}

// ── Global currency settings via Store API ─────────────────────────────

#[test]
fn currency_settings_via_store_api() {
    let conn = setup();
    let s = store(&conn);

    // Defaults.
    assert_eq!(s.get_currency_format().unwrap(), "symbol");
    assert_eq!(s.get_currency_symbol_position().unwrap(), "prefix");
    assert_eq!(s.get_currency_decimal_separator().unwrap(), "dot");
    assert_eq!(s.get_currency_thousands_separator().unwrap(), "comma");

    // Set all via Store.
    s.set_currency_format("code").unwrap();
    s.set_currency_symbol_position("suffix").unwrap();
    s.set_currency_decimal_separator("comma").unwrap();
    s.set_currency_thousands_separator("space").unwrap();

    // Verify.
    assert_eq!(s.get_currency_format().unwrap(), "code");
    assert_eq!(s.get_currency_symbol_position().unwrap(), "suffix");
    assert_eq!(s.get_currency_decimal_separator().unwrap(), "comma");
    assert_eq!(s.get_currency_thousands_separator().unwrap(), "space");
}

// ── Currency settings coexistence with store settings ──────────────────

#[test]
fn currency_settings_independent_of_store_settings() {
    let conn = setup();
    let s = store(&conn);

    // Mix store and global currency settings.
    s.set_store_name("Shop One").unwrap();
    s.set_default_currency("GBP").unwrap();
    s.set_currency_format("code").unwrap();
    s.set_currency_symbol_position("suffix").unwrap();
    s.set_store_address("10 High St").unwrap();

    // Store settings preserved.
    assert_eq!(s.get_store_name().unwrap(), Some("Shop One".into()));
    assert_eq!(s.get_store_address().unwrap(), Some("10 High St".into()));

    // Currency settings preserved.
    assert_eq!(s.get_default_currency().unwrap(), Some("GBP".into()));
    assert_eq!(s.get_currency_format().unwrap(), "code");
    assert_eq!(s.get_currency_symbol_position().unwrap(), "suffix");
}

// ── Currency settings with shift lifecycle ─────────────────────────────

fn seed_users_for_shift(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-staff', 'Staff', 'Staff role', '[]',
             '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id,
                           created_at, updated_at) VALUES
            ('user-alice', 'alice', 'hash1', 'Alice', 'role-staff',
             '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');",
    )
    .unwrap();
}

#[test]
fn currency_settings_accessible_before_shift_open() {
    let conn = setup();
    seed_users_for_shift(&conn);
    let s = store(&conn);

    // Set global currency settings before opening a shift.
    s.set_default_currency("EUR").unwrap();
    s.set_currency_format("code").unwrap();
    s.set_currency_decimal_separator("comma").unwrap();

    // Open shift.
    let shift = s.open_shift("user-alice", None, 500).unwrap();
    assert_eq!(shift.status, "open");

    // Currency settings must remain accessible and unchanged during the shift.
    assert_eq!(s.get_default_currency().unwrap(), Some("EUR".into()));
    assert_eq!(s.get_currency_format().unwrap(), "code");
    assert_eq!(s.get_currency_decimal_separator().unwrap(), "comma");

    // Close shift.
    let closed = s.close_shift(&shift.id, 800, None).unwrap();
    assert!(closed.is_closed());

    // Currency settings must survive after closing the shift.
    assert_eq!(s.get_default_currency().unwrap(), Some("EUR".into()));
    assert_eq!(s.get_currency_format().unwrap(), "code");
}

#[test]
fn change_currency_setting_during_open_shift() {
    let conn = setup();
    seed_users_for_shift(&conn);
    let s = store(&conn);

    s.set_default_currency("USD").unwrap();

    // Open shift.
    let shift = s.open_shift("user-alice", None, 1000).unwrap();
    assert_eq!(s.get_default_currency().unwrap(), Some("USD".into()));

    // Change the default currency mid-shift (e.g. switch to IDR).
    s.set_default_currency("IDR").unwrap();
    assert_eq!(s.get_default_currency().unwrap(), Some("IDR".into()));

    // Other currency formatting settings remain independent.
    s.set_currency_symbol_position("suffix").unwrap();
    assert_eq!(s.get_currency_symbol_position().unwrap(), "suffix");
    assert_eq!(s.get_currency_format().unwrap(), "symbol"); // still default

    // Close shift.
    let closed = s.close_shift(&shift.id, 1500, None).unwrap();
    assert!(closed.is_closed());

    // Changes must persist after close.
    assert_eq!(s.get_default_currency().unwrap(), Some("IDR".into()));
    assert_eq!(s.get_currency_symbol_position().unwrap(), "suffix");
}

#[test]
fn multiple_shifts_preserve_currency_settings() {
    let conn = setup();
    seed_users_for_shift(&conn);
    let s = store(&conn);

    // Set currency at the start.
    s.set_default_currency("GBP").unwrap();

    // ── Shift 1 ──────────────────────────────────────────────────
    let s1 = s.open_shift("user-alice", None, 100).unwrap();
    assert_eq!(s.get_default_currency().unwrap(), Some("GBP".into()));
    let c1 = s.close_shift(&s1.id, 200, None).unwrap();
    assert!(c1.is_closed());

    // Currency setting survives shift 1.
    assert_eq!(s.get_default_currency().unwrap(), Some("GBP".into()));

    // ── Shift 2 ──────────────────────────────────────────────────
    let s2 = s.open_shift("user-alice", None, 300).unwrap();
    assert_eq!(s.get_default_currency().unwrap(), Some("GBP".into()));
    let c2 = s.close_shift(&s2.id, 400, None).unwrap();
    assert!(c2.is_closed());

    // Currency setting survives shift 2.
    assert_eq!(s.get_default_currency().unwrap(), Some("GBP".into()));
}

#[test]
fn currency_settings_survive_load_all_across_shift_ops() {
    let conn = setup();
    seed_users_for_shift(&conn);
    let s = store(&conn);

    // Set a mix of store + global currency settings.
    s.set_store_name("Currency Shop").unwrap();
    s.set_default_currency("JPY").unwrap();
    s.set_currency_format("code").unwrap();
    s.set_currency_thousands_separator("none").unwrap();

    // Open + close a shift.
    let shift = s.open_shift("user-alice", None, 5000).unwrap();
    s.close_shift(&shift.id, 5000, None).unwrap();

    // load_all must contain both store settings and currency settings.
    let all = Settings::load_all(&conn).unwrap();
    assert!(
        all.iter().any(|(k, _)| k == "store.name"),
        "load_all must include store.name"
    );
    assert!(
        all.iter().any(|(k, _)| k == "currency.default"),
        "load_all must include currency.default"
    );
    assert!(
        all.iter().any(|(k, _)| k == "currency.format"),
        "load_all must include currency.format"
    );
    assert!(
        all.iter().any(|(k, _)| k == "currency.thousands_separator"),
        "load_all must include currency.thousands_separator"
    );
}

// ── Migration correctness: old → new key ─────────────────────────────

// ── Namespace isolation: currency.* vs store.* vs receipt.* ───────────

#[test]
fn currency_keys_isolated_from_store_keys() {
    let conn = setup();
    let s = store(&conn);

    // Set across three namespaces.
    s.set_store_name("Shop").unwrap();
    s.set_default_currency("AUD").unwrap();
    s.set_currency_format("code").unwrap();
    s.set_currency_decimal_separator("comma").unwrap();

    // Remove a store key — currency keys must survive.
    Settings::remove(&conn, "store.name").unwrap();
    assert_eq!(s.get_default_currency().unwrap(), Some("AUD".into()));
    assert_eq!(s.get_currency_format().unwrap(), "code");
    assert_eq!(s.get_currency_decimal_separator().unwrap(), "comma");

    // Remove a currency key — other currency keys must survive.
    Settings::remove(&conn, "currency.format").unwrap();
    assert_eq!(s.get_default_currency().unwrap(), Some("AUD".into()));
    // After removal, format falls back to default.
    assert_eq!(s.get_currency_format().unwrap(), "symbol");
}

#[test]
fn currency_keys_isolated_from_receipt_keys() {
    let conn = setup();
    let s = store(&conn);

    s.set_currency_decimal_separator("comma").unwrap();
    // Receipt decimal separator is a separate setting.
    kasirmu_core::Settings::set_receipt_decimal_separator(&conn, "dot").unwrap();

    // They must not interfere.
    assert_eq!(s.get_currency_decimal_separator().unwrap(), "comma");
    assert_eq!(
        kasirmu_core::Settings::get_receipt_decimal_separator(&conn).unwrap(),
        "dot"
    );

    // Remove receipt key — currency key must survive.
    Settings::remove(&conn, "receipt.decimal_separator").unwrap();
    assert_eq!(s.get_currency_decimal_separator().unwrap(), "comma");
}

#[test]
fn load_all_never_contains_old_default_currency_key() {
    let conn = setup();
    let s = store(&conn);

    // Use the typed API (which writes to the new key and cleans the old one).
    s.set_default_currency("NZD").unwrap();

    let all = Settings::load_all(&conn).unwrap();
    assert!(
        !all.iter().any(|(k, _)| k == "store.default_currency"),
        "load_all must never include the old store.default_currency key after typed set"
    );
    assert!(
        all.iter().any(|(k, _)| k == "currency.default"),
        "load_all must include currency.default after typed set"
    );
}

#[test]
fn direct_raw_write_to_old_key_does_not_affect_new_key_reads() {
    let conn = setup();
    let s = store(&conn);

    // Someone writes directly to the old key (e.g. raw SQL).
    Settings::set(&conn, "store.default_currency", "CHF").unwrap();

    // If new key is absent, get_default_currency falls back.
    assert_eq!(s.get_default_currency().unwrap(), Some("CHF".into()));

    // But load_all will show the old key.
    let all = Settings::load_all(&conn).unwrap();
    assert!(
        all.iter().any(|(k, _)| k == "store.default_currency"),
        "old key must appear in load_all when written directly"
    );

    // Once we write via typed API, the old key must be cleaned up.
    s.set_default_currency("SEK").unwrap();
    assert!(
        !Settings::load_all(&conn)
            .unwrap()
            .iter()
            .any(|(k, _)| k == "store.default_currency"),
        "typed set must clean up old key"
    );
    assert_eq!(s.get_default_currency().unwrap(), Some("SEK".into()));
}

// ── Overwrite protection: store settings don't clobber currency ──────

#[test]
fn overwrite_store_settings_preserves_currency_settings() {
    let conn = setup();
    let s = store(&conn);

    // Set currency settings.
    s.set_default_currency("KRW").unwrap();
    s.set_currency_format("code").unwrap();
    s.set_currency_symbol_position("suffix").unwrap();

    // Overwrite store settings (simulating the bulk set_store_settings flow).
    Settings::set_store_name(&conn, "New Name").unwrap();
    Settings::set_store_address(&conn, "New Address").unwrap();
    Settings::set_store_tax_id(&conn, "NEW-TAX").unwrap();
    Settings::set_store_branch(&conn, "Downtown").unwrap();
    // Note: NOT calling set_default_currency here — simulating a store-only update.

    // Currency settings must be unchanged.
    assert_eq!(s.get_default_currency().unwrap(), Some("KRW".into()));
    assert_eq!(s.get_currency_format().unwrap(), "code");
    assert_eq!(s.get_currency_symbol_position().unwrap(), "suffix");
}

#[test]
fn overwrite_currency_settings_preserves_store_settings() {
    let conn = setup();
    let s = store(&conn);

    // Set store settings.
    s.set_store_name("Original Store").unwrap();
    s.set_store_address("123 Main St").unwrap();

    // Set currency settings.
    s.set_default_currency("MXN").unwrap();
    s.set_currency_format("symbol").unwrap();

    // Overwrite currency settings.
    s.set_default_currency("CAD").unwrap();
    s.set_currency_format("code").unwrap();

    // Store settings must be unchanged.
    assert_eq!(s.get_store_name().unwrap(), Some("Original Store".into()));
    assert_eq!(s.get_store_address().unwrap(), Some("123 Main St".into()));
}

// ── Setup wizard lifecycle ───────────────────────────────────────────

#[test]
fn setup_writes_global_currency_key() {
    let conn = setup();
    let store = Store::new(&conn);

    // Simulate what complete_setup does.
    let registry = kasirmu_core::FeatureRegistry::simple_retail();
    store.save_features(&registry).unwrap();
    kasirmu_core::Settings::prune_stale_features(&conn, &registry).unwrap();
    kasirmu_core::Settings::set(
        &conn,
        kasirmu_core::settings::keys::STORE_PRESET,
        "simple-retail",
    )
    .unwrap();
    kasirmu_core::Settings::set(&conn, kasirmu_core::settings::keys::SETUP_COMPLETE, "1").unwrap();
    kasirmu_core::Settings::set_default_currency(&conn, "EUR").unwrap();
    kasirmu_core::Settings::set(&conn, kasirmu_core::settings::keys::SHOW_SETUP_WIZARD, "false").unwrap();

    // The currency must be stored under the global key, not the store key.
    assert_eq!(
        kasirmu_core::Settings::get(&conn, "currency.default").unwrap(),
        Some("EUR".into()),
        "setup must write to the global currency.default key"
    );
    assert_eq!(
        kasirmu_core::Settings::get(&conn, "store.default_currency").unwrap(),
        None,
        "setup must not leave the old store.default_currency key"
    );

    // All other setup keys must coexist.
    assert_eq!(
        kasirmu_core::Settings::get(&conn, kasirmu_core::settings::keys::STORE_PRESET).unwrap(),
        Some("simple-retail".into())
    );
    assert_eq!(
        kasirmu_core::Settings::get(&conn, kasirmu_core::settings::keys::SETUP_COMPLETE).unwrap(),
        Some("1".into())
    );
}

// ─── Comprehensive namespace roundtrip ────────────────────────────────

#[test]
fn all_currency_keys_have_distinct_namespaces() {
    let conn = setup();
    let s = store(&conn);

    // Set every currency-related key through its typed API.
    s.set_default_currency("PLN").unwrap();
    s.set_currency_format("code").unwrap();
    s.set_currency_symbol_position("suffix").unwrap();
    s.set_currency_decimal_separator("comma").unwrap();
    s.set_currency_thousands_separator("space").unwrap();

    // Load all and verify distinct keys.
    let all = Settings::load_all(&conn).unwrap();
    let currency_keys: Vec<&str> = all
        .iter()
        .map(|(k, _)| k.as_str())
        .filter(|k| k.starts_with("currency."))
        .collect();

    assert!(currency_keys.contains(&"currency.default"));
    assert!(currency_keys.contains(&"currency.format"));
    assert!(currency_keys.contains(&"currency.symbol_position"));
    assert!(currency_keys.contains(&"currency.decimal_separator"));
    assert!(currency_keys.contains(&"currency.thousands_separator"));
    assert_eq!(currency_keys.len(), 5, "exactly 5 currency.* keys");

    // No non-currency keys leak into the currency namespace.
    assert!(
        !currency_keys
            .iter()
            .any(|k| k.starts_with("currency.default.")),
        "no sub-keys should exist under currency.default"
    );
    assert!(
        !currency_keys
            .iter()
            .any(|k| k.starts_with("currency.format.")),
        "no sub-keys should exist under currency.format"
    );
}

#[test]
fn set_default_currency_idempotent_same_value_roundtrip() {
    let conn = setup();
    let s = store(&conn);

    s.set_default_currency("USD").unwrap();
    s.set_default_currency("USD").unwrap();
    s.set_default_currency("USD").unwrap();

    assert_eq!(s.get_default_currency().unwrap(), Some("USD".into()));
    // No old key after repeated sets.
    assert_eq!(
        kasirmu_core::Settings::get(&conn, "store.default_currency").unwrap(),
        None
    );
}

#[test]
fn default_currency_remove_restores_fallback() {
    let conn = setup();
    let s = store(&conn);

    // Write old key and new key.
    s.set_setting("store.default_currency", "DKK").unwrap();
    s.set_setting("currency.default", "NOK").unwrap();
    assert_eq!(s.get_default_currency().unwrap(), Some("NOK".into()));

    // Remove the new key — fallback must kick in.
    kasirmu_core::Settings::remove(&conn, "currency.default").unwrap();
    assert_eq!(
        s.get_default_currency().unwrap(),
        Some("DKK".into()),
        "must fall back to old key when new key is removed"
    );
}

#[test]
fn default_currency_both_keys_absent_returns_none() {
    let conn = setup();
    let s = store(&conn);

    assert_eq!(s.get_default_currency().unwrap(), None);

    // Setting then removing.
    s.set_default_currency("USD").unwrap();
    kasirmu_core::Settings::remove(&conn, "currency.default").unwrap();
    assert_eq!(s.get_default_currency().unwrap(), None);
}

// ── Currency settings survive full Store lifecycle ────────────────────

#[test]
fn currency_settings_persist_after_feature_save() {
    let conn = setup();
    let s = store(&conn);

    s.set_default_currency("SGD").unwrap();
    s.set_currency_format("code").unwrap();

    // Save features (uses set_batch internally — must not clobber currency).
    let reg = kasirmu_core::FeatureRegistry::simple_retail();
    s.save_features(&reg).unwrap();

    assert_eq!(s.get_default_currency().unwrap(), Some("SGD".into()));
    assert_eq!(s.get_currency_format().unwrap(), "code");
}

#[test]
fn currency_settings_persist_after_prune_stale_features() {
    let conn = setup();
    let s = store(&conn);

    s.set_default_currency("HKD").unwrap();
    s.set_currency_symbol_position("suffix").unwrap();

    // Prune stale features.
    let reg = kasirmu_core::FeatureRegistry::simple_retail();
    kasirmu_core::Settings::prune_stale_features(&conn, &reg).unwrap();

    assert_eq!(s.get_default_currency().unwrap(), Some("HKD".into()));
    assert_eq!(s.get_currency_symbol_position().unwrap(), "suffix");
}
