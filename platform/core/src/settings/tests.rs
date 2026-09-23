use super::test_helpers::fresh;
use super::*;
use rusqlite::{Connection, params};

// â”€â”€ Raw get / set / remove â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Batch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    assert_eq!(all.len(), 2);
    assert!(all.contains(&("a".into(), "1".into())));
    assert!(all.contains(&("b".into(), "2".into())));
}

#[test]
fn set_batch_empty_vec() {
    let conn = fresh();
    Settings::set_batch(&conn, &[]).unwrap();
    assert_eq!(Settings::load_all(&conn).unwrap().len(), 0);
}

#[test]
fn set_batch_overwrites_existing_keys() {
    let conn = fresh();
    Settings::set(&conn, "k", "old").unwrap();
    let rows = vec![("k".into(), "new".into())];
    Settings::set_batch(&conn, &rows).unwrap();
    assert_eq!(Settings::get(&conn, "k").unwrap(), Some("new".into()));
}

// â”€â”€ Typed store config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
fn remove_idempotent() {
    let conn = fresh();
    Settings::set(&conn, "k", "v").unwrap();
    assert!(Settings::remove(&conn, "k").unwrap());
    assert!(!Settings::remove(&conn, "k").unwrap());
}

#[test]
fn load_all_empty_table() {
    let conn = fresh();
    let all = Settings::load_all(&conn).unwrap();
    assert!(all.is_empty());
}

#[test]
fn set_store_address_roundtrip() {
    let conn = fresh();
    Settings::set_store_address(&conn, "123 Main St").unwrap();
    assert_eq!(
        Settings::get_store_address(&conn).unwrap(),
        Some("123 Main St".into())
    );
}

#[test]
fn set_store_tax_id_roundtrip() {
    let conn = fresh();
    Settings::set_store_tax_id(&conn, "TAX-12345").unwrap();
    assert_eq!(
        Settings::get_store_tax_id(&conn).unwrap(),
        Some("TAX-12345".into())
    );
}

#[test]
fn get_store_address_default_none() {
    let conn = fresh();
    assert_eq!(Settings::get_store_address(&conn).unwrap(), None);
}

#[test]
fn get_store_tax_id_default_none() {
    let conn = fresh();
    assert_eq!(Settings::get_store_tax_id(&conn).unwrap(), None);
}

#[test]
fn get_default_currency_default_none() {
    let conn = fresh();
    assert_eq!(Settings::get_default_currency(&conn).unwrap(), None);
}

// â”€â”€ Global Currency settings tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn currency_format_default_is_symbol() {
    let conn = fresh();
    assert_eq!(Settings::get_currency_format(&conn).unwrap(), "symbol");
}

#[test]
fn set_and_get_currency_format() {
    let conn = fresh();
    Settings::set_currency_format(&conn, "code").unwrap();
    assert_eq!(Settings::get_currency_format(&conn).unwrap(), "code");
}

#[test]
fn currency_symbol_position_default_is_prefix() {
    let conn = fresh();
    assert_eq!(
        Settings::get_currency_symbol_position(&conn).unwrap(),
        "prefix"
    );
}

#[test]
fn set_and_get_currency_symbol_position() {
    let conn = fresh();
    Settings::set_currency_symbol_position(&conn, "suffix").unwrap();
    assert_eq!(
        Settings::get_currency_symbol_position(&conn).unwrap(),
        "suffix"
    );
}

#[test]
fn currency_decimal_separator_default_is_dot() {
    let conn = fresh();
    assert_eq!(
        Settings::get_currency_decimal_separator(&conn).unwrap(),
        "dot"
    );
}

#[test]
fn set_and_get_currency_decimal_separator() {
    let conn = fresh();
    Settings::set_currency_decimal_separator(&conn, "comma").unwrap();
    assert_eq!(
        Settings::get_currency_decimal_separator(&conn).unwrap(),
        "comma"
    );
}

#[test]
fn currency_thousands_separator_default_is_comma() {
    let conn = fresh();
    assert_eq!(
        Settings::get_currency_thousands_separator(&conn).unwrap(),
        "comma"
    );
}

#[test]
fn set_and_get_currency_thousands_separator() {
    let conn = fresh();
    Settings::set_currency_thousands_separator(&conn, "space").unwrap();
    assert_eq!(
        Settings::get_currency_thousands_separator(&conn).unwrap(),
        "space"
    );
}

#[test]
fn get_default_currency_falls_back_to_old_key() {
    let conn = fresh();
    // Write old key, new key absent
    Settings::set(&conn, keys::OLD_DEFAULT_CURRENCY, "JPY").unwrap();
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap(),
        Some("JPY".into())
    );
}

#[test]
fn get_default_currency_prefers_new_key() {
    let conn = fresh();
    Settings::set(&conn, keys::DEFAULT_CURRENCY, "EUR").unwrap();
    Settings::set(&conn, keys::OLD_DEFAULT_CURRENCY, "JPY").unwrap();
    // New key takes precedence
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap(),
        Some("EUR".into())
    );
}

#[test]
fn set_default_currency_cleans_up_old_key() {
    let conn = fresh();
    Settings::set(&conn, keys::OLD_DEFAULT_CURRENCY, "GBP").unwrap();
    Settings::set_default_currency(&conn, "USD").unwrap();
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap(),
        Some("USD".into())
    );
    // Old key should be gone
    assert_eq!(
        Settings::get(&conn, keys::OLD_DEFAULT_CURRENCY).unwrap(),
        None
    );
}

// â”€â”€ Receipt settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn receipt_show_currency_default_false() {
    let conn = fresh();
    assert!(!Settings::get_receipt_show_currency(&conn).unwrap());
}

#[test]
fn set_receipt_show_currency_true() {
    let conn = fresh();
    Settings::set_receipt_show_currency(&conn, true).unwrap();
    assert!(Settings::get_receipt_show_currency(&conn).unwrap());
}

#[test]
fn set_receipt_show_currency_false() {
    let conn = fresh();
    Settings::set_receipt_show_currency(&conn, true).unwrap();
    Settings::set_receipt_show_currency(&conn, false).unwrap();
    assert!(!Settings::get_receipt_show_currency(&conn).unwrap());
}

#[test]
fn receipt_decimal_separator_default_dot() {
    let conn = fresh();
    assert_eq!(
        Settings::get_receipt_decimal_separator(&conn).unwrap(),
        "dot"
    );
}

#[test]
fn set_receipt_decimal_separator_comma() {
    let conn = fresh();
    Settings::set_receipt_decimal_separator(&conn, "comma").unwrap();
    assert_eq!(
        Settings::get_receipt_decimal_separator(&conn).unwrap(),
        "comma"
    );
}

#[test]
fn receipt_show_tax_default_true() {
    let conn = fresh();
    assert!(Settings::get_receipt_show_tax(&conn).unwrap());
}

#[test]
fn set_receipt_show_tax_false() {
    let conn = fresh();
    Settings::set_receipt_show_tax(&conn, false).unwrap();
    assert!(!Settings::get_receipt_show_tax(&conn).unwrap());
}

#[test]
fn receipt_footer_default_empty() {
    let conn = fresh();
    assert_eq!(Settings::get_receipt_footer(&conn).unwrap(), "");
}

#[test]
fn set_receipt_footer() {
    let conn = fresh();
    Settings::set_receipt_footer(&conn, "Thank you!").unwrap();
    assert_eq!(Settings::get_receipt_footer(&conn).unwrap(), "Thank you!");
}

#[test]
fn receipt_paper_width_default_standard() {
    let conn = fresh();
    assert_eq!(
        Settings::get_receipt_paper_width(&conn).unwrap(),
        "standard"
    );
}

#[test]
fn set_receipt_paper_width_narrow() {
    let conn = fresh();
    Settings::set_receipt_paper_width(&conn, "narrow").unwrap();
    assert_eq!(Settings::get_receipt_paper_width(&conn).unwrap(), "narrow");
}

#[test]
fn receipt_show_table_number_default_false() {
    let conn = fresh();
    assert!(!Settings::get_receipt_show_table_number(&conn).unwrap());
}

#[test]
fn set_receipt_show_table_number_true() {
    let conn = fresh();
    Settings::set_receipt_show_table_number(&conn, true).unwrap();
    assert!(Settings::get_receipt_show_table_number(&conn).unwrap());
}

#[test]
fn set_receipt_show_table_number_false() {
    let conn = fresh();
    Settings::set_receipt_show_table_number(&conn, true).unwrap();
    Settings::set_receipt_show_table_number(&conn, false).unwrap();
    assert!(!Settings::get_receipt_show_table_number(&conn).unwrap());
}

// â”€â”€ Sync settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€-

#[test]
fn sync_server_url_default_none() {
    let conn = fresh();
    assert_eq!(Settings::get_sync_server_url(&conn).unwrap(), None);
}

#[test]
fn set_sync_server_url() {
    let conn = fresh();
    Settings::set_sync_server_url(&conn, "https://sync.example.com").unwrap();
    assert_eq!(
        Settings::get_sync_server_url(&conn).unwrap(),
        Some("https://sync.example.com".into())
    );
}

#[test]
fn set_sync_server_url_empty_keeps_row() {
    // Clearing the sync URL must write an empty row, never delete it:
    // get() then returns Some("") (row present) instead of None (row
    // absent) — the exact discriminator should_auto_provision relies on
    // to tell "cleared + disabled" from "never configured".
    let conn = fresh();
    Settings::set_sync_server_url(&conn, "").unwrap();
    assert_eq!(
        Settings::get_sync_server_url(&conn).unwrap(),
        Some("".into())
    );
}

#[test]
fn clear_sync_server_url_overwrites_not_deletes() {
    // Row-presence contract for auto-provision: setting a real URL then
    // clearing it must leave a row with an empty value (Some("")) — never
    // fall back to None, which would look like a fresh install and
    // re-trigger provisioning on the next debug launch.
    let conn = fresh();
    Settings::set_sync_server_url(&conn, "https://sync.example.com").unwrap();
    Settings::set_sync_server_url(&conn, "").unwrap();
    assert_eq!(
        Settings::get_sync_server_url(&conn).unwrap(),
        Some("".into())
    );
}

#[test]
fn sync_api_key_default_none() {
    let conn = fresh();
    assert_eq!(Settings::get_sync_api_key(&conn).unwrap(), None);
}

#[test]
fn set_sync_api_key() {
    let conn = fresh();
    Settings::set_sync_api_key(&conn, "sk-test123").unwrap();
    assert_eq!(
        Settings::get_sync_api_key(&conn).unwrap(),
        Some("sk-test123".into())
    );
}

#[test]
fn sync_enabled_default_false() {
    let conn = fresh();
    assert!(!Settings::is_sync_enabled(&conn).unwrap());
}

#[test]
fn set_sync_enabled() {
    let conn = fresh();
    Settings::set_sync_enabled(&conn, true).unwrap();
    assert!(Settings::is_sync_enabled(&conn).unwrap());
    Settings::set_sync_enabled(&conn, false).unwrap();
    assert!(!Settings::is_sync_enabled(&conn).unwrap());
}

#[test]
fn get_unknown_key_returns_none() {
    let conn = fresh();
    assert_eq!(
        Settings::get(&conn, "completely.unknown.key").unwrap(),
        None
    );
}

#[test]
fn set_empty_value() {
    let conn = fresh();
    Settings::set(&conn, "empty.key", "").unwrap();
    assert_eq!(Settings::get(&conn, "empty.key").unwrap(), Some("".into()));
}

// â”€â”€ Exchange Rate Auto-Sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn rate_sync_enabled_default_false() {
    let conn = fresh();
    assert!(!Settings::is_rate_sync_enabled(&conn).unwrap());
}

#[test]
fn set_rate_sync_enabled() {
    let conn = fresh();
    Settings::set_rate_sync_enabled(&conn, true).unwrap();
    assert!(Settings::is_rate_sync_enabled(&conn).unwrap());
    Settings::set_rate_sync_enabled(&conn, false).unwrap();
    assert!(!Settings::is_rate_sync_enabled(&conn).unwrap());
}

#[test]
fn rate_sync_api_key_default_none() {
    let conn = fresh();
    assert_eq!(Settings::get_rate_sync_api_key(&conn).unwrap(), None);
}

#[test]
fn set_rate_sync_api_key() {
    let conn = fresh();
    Settings::set_rate_sync_api_key(&conn, "my-key").unwrap();
    assert_eq!(
        Settings::get_rate_sync_api_key(&conn).unwrap(),
        Some("my-key".into())
    );
}

#[test]
fn rate_sync_interval_default_360() {
    let conn = fresh();
    assert_eq!(Settings::get_rate_sync_interval(&conn).unwrap(), "360");
}

#[test]
fn set_rate_sync_interval() {
    let conn = fresh();
    Settings::set_rate_sync_interval(&conn, "60").unwrap();
    assert_eq!(Settings::get_rate_sync_interval(&conn).unwrap(), "60");
}

#[test]
fn rate_sync_base_currency_default_usd() {
    let conn = fresh();
    assert_eq!(Settings::get_rate_sync_base_currency(&conn).unwrap(), "USD");
}

#[test]
fn set_rate_sync_base_currency() {
    let conn = fresh();
    Settings::set_rate_sync_base_currency(&conn, "EUR").unwrap();
    assert_eq!(Settings::get_rate_sync_base_currency(&conn).unwrap(), "EUR");
}

#[test]
fn overwrite_with_same_value() {
    let conn = fresh();
    Settings::set(&conn, "k", "same").unwrap();
    Settings::set(&conn, "k", "same").unwrap();
    assert_eq!(Settings::get(&conn, "k").unwrap(), Some("same".into()));
}

// â”€â”€ Bug: get_redis_cache_ttl silent parse failure â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn get_redis_cache_ttl_returns_error_on_invalid_value() {
    let conn = fresh();
    Settings::set(&conn, keys::REDIS_CACHE_TTL, "not-a-number").unwrap();
    let result = Settings::get_redis_cache_ttl(&conn);
    assert!(
        result.is_err(),
        "invalid TTL value 'not-a-number' must return error, \
         not silently default to 300"
    );
}

#[test]
fn get_redis_cache_ttl_default_is_300() {
    let conn = fresh();
    assert_eq!(Settings::get_redis_cache_ttl(&conn).unwrap(), 300);
}

#[test]
fn get_redis_cache_ttl_valid_value() {
    let conn = fresh();
    Settings::set(&conn, keys::REDIS_CACHE_TTL, "600").unwrap();
    assert_eq!(Settings::get_redis_cache_ttl(&conn).unwrap(), 600);
}

// â”€â”€ Delta ledger tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Helper that creates the `setting_updated` table needed by delta tests.
fn fresh_with_delta() -> Connection {
    let conn = fresh();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS setting_updated (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            key         TEXT    NOT NULL,
            value       TEXT    NOT NULL,
            terminal_id TEXT    NOT NULL DEFAULT 'unknown',
            version     INTEGER NOT NULL,
            created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
         CREATE INDEX IF NOT EXISTS idx_setting_updated_key_version
             ON setting_updated(key, version DESC);
         CREATE INDEX IF NOT EXISTS idx_setting_updated_terminal
             ON setting_updated(terminal_id, created_at DESC);",
    )
    .unwrap();
    conn
}

#[test]
fn write_delta_creates_row_with_version_one() {
    let conn = fresh_with_delta();
    Settings::write_delta(&conn, "receipt.footer", "Thanks!", "term-a").unwrap();
    let v = Settings::get_version(&conn, "receipt.footer", "term-a").unwrap();
    assert_eq!(v, Some(1));
}

#[test]
fn write_delta_increments_version_per_key_terminal() {
    let conn = fresh_with_delta();
    // Write twice to same (key, terminal) â€” versions 1, 2.
    Settings::write_delta(&conn, "receipt.footer", "v1", "term-a").unwrap();
    Settings::write_delta(&conn, "receipt.footer", "v2", "term-a").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "receipt.footer", "term-a").unwrap(),
        Some(2)
    );
}

#[test]
fn write_delta_different_keys_track_separate_versions() {
    let conn = fresh_with_delta();
    // Different keys should both start at version 1.
    Settings::write_delta(&conn, "store.name", "Shop", "term-a").unwrap();
    Settings::write_delta(&conn, "receipt.footer", "Bye", "term-a").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "store.name", "term-a").unwrap(),
        Some(1)
    );
    assert_eq!(
        Settings::get_version(&conn, "receipt.footer", "term-a").unwrap(),
        Some(1)
    );
}

#[test]
fn write_delta_different_terminals_track_separate_versions() {
    let conn = fresh_with_delta();
    // Same key, different terminals â€” independent version counters.
    Settings::write_delta(&conn, "receipt.footer", "v-a", "term-a").unwrap();
    Settings::write_delta(&conn, "receipt.footer", "v-b", "term-b").unwrap();
    Settings::write_delta(&conn, "receipt.footer", "v-a2", "term-a").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "receipt.footer", "term-a").unwrap(),
        Some(2)
    );
    assert_eq!(
        Settings::get_version(&conn, "receipt.footer", "term-b").unwrap(),
        Some(1)
    );
}

#[test]
fn get_version_returns_none_for_missing() {
    let conn = fresh_with_delta();
    assert_eq!(
        Settings::get_version(&conn, "nonexistent", "term-a").unwrap(),
        None
    );
}

#[test]
fn set_tracked_writes_setting_and_delta_atomically() {
    let conn = fresh_with_delta();
    Settings::set_tracked(&conn, "receipt.footer", "Hello!", "term-a").unwrap();
    // Setting should be stored.
    assert_eq!(
        Settings::get(&conn, "receipt.footer").unwrap(),
        Some("Hello!".into())
    );
    // Delta should be version 1.
    assert_eq!(
        Settings::get_version(&conn, "receipt.footer", "term-a").unwrap(),
        Some(1)
    );
}

#[test]
fn set_tracked_overwrites_and_increments_version() {
    let conn = fresh_with_delta();
    Settings::set_tracked(&conn, "k", "v1", "term-a").unwrap();
    Settings::set_tracked(&conn, "k", "v2", "term-a").unwrap();
    assert_eq!(Settings::get(&conn, "k").unwrap(), Some("v2".into()));
    assert_eq!(
        Settings::get_version(&conn, "k", "term-a").unwrap(),
        Some(2)
    );
}

#[test]
fn set_batch_tracked_writes_all_deltas() {
    let conn = fresh_with_delta();
    let rows: Vec<(String, String)> = vec![
        ("receipt.footer".into(), "Batch1".into()),
        ("store.name".into(), "Batch2".into()),
    ];
    Settings::set_batch_tracked(&conn, &rows, "term-a").unwrap();

    assert_eq!(
        Settings::get(&conn, "receipt.footer").unwrap(),
        Some("Batch1".into())
    );
    assert_eq!(
        Settings::get(&conn, "store.name").unwrap(),
        Some("Batch2".into())
    );
    assert_eq!(
        Settings::get_version(&conn, "receipt.footer", "term-a").unwrap(),
        Some(1)
    );
    assert_eq!(
        Settings::get_version(&conn, "store.name", "term-a").unwrap(),
        Some(1)
    );
}

#[test]
fn set_tracked_is_idempotent_same_value_same_version() {
    let conn = fresh_with_delta();
    Settings::set_tracked(&conn, "k", "same", "term-a").unwrap();
    Settings::set_tracked(&conn, "k", "same", "term-a").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "k", "term-a").unwrap(),
        Some(2)
    );
}

// â”€â”€ Delta ledger resilience & edge cases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Verify that `set_tracked` still persists the setting value even when
/// the `setting_updated` table does not exist (delta write fails).
/// The ADR specifies delta loss is non-fatal â€” the settings table write
/// must succeed regardless.
#[test]
fn set_tracked_survives_missing_delta_table() {
    // Fresh DB WITHOUT the `setting_updated` table.
    let conn = fresh();
    let result = Settings::set_tracked(&conn, "receipt.footer", "NoDelta!", "term-a");
    // Should succeed â€” delta failure is caught and logged, not propagated.
    assert!(result.is_ok());
    // The setting value must still be persisted.
    assert_eq!(
        Settings::get(&conn, "receipt.footer").unwrap(),
        Some("NoDelta!".into())
    );
    // The delta write must have failed â€” version lookup will fail
    // because the `setting_updated` table does not exist.
    assert!(Settings::get_version(&conn, "receipt.footer", "term-a").is_err());
}

/// Empty terminal_id is valid â€” `set_tracked` should not panic or error.
#[test]
fn set_tracked_empty_terminal_id() {
    let conn = fresh_with_delta();
    Settings::set_tracked(&conn, "store.name", "Shop", "").unwrap();
    assert_eq!(
        Settings::get(&conn, "store.name").unwrap(),
        Some("Shop".into())
    );
    assert_eq!(
        Settings::get_version(&conn, "store.name", "").unwrap(),
        Some(1)
    );
}

/// `set_batch_tracked` with an empty slice is a no-op â€” no panic, no error.
#[test]
fn set_batch_tracked_empty_batch() {
    let conn = fresh_with_delta();
    let rows: Vec<(String, String)> = vec![];
    Settings::set_batch_tracked(&conn, &rows, "term-a").unwrap();
    assert_eq!(Settings::load_all(&conn).unwrap().len(), 0);
}

/// Delta writes handle special characters in keys and values
/// (Unicode, quotes, backslashes).
#[test]
fn write_delta_special_characters() {
    let conn = fresh_with_delta();
    let key = "store.name";
    let value = "Caf\u{00e9} \"OZ\" â€” 100% natural";
    Settings::write_delta(&conn, key, value, "term-\u{2603}").unwrap();
    // The version should be 1 â€” special chars don't affect SQL execution.
    assert_eq!(
        Settings::get_version(&conn, key, "term-\u{2603}").unwrap(),
        Some(1)
    );
}

/// Prove that `write_delta()` works when called from within an outer
/// transaction. rusqlite converts the nested BEGIN to a SAVEPOINT,
/// so the delta write is atomic within the outer transaction.
#[test]
fn write_delta_works_inside_outer_transaction() {
    let conn = fresh_with_delta();
    // Start an outer transaction.
    let outer_tx = conn.unchecked_transaction().unwrap();
    // Call `write_delta()` â€” it internally creates another
    // `unchecked_transaction()` which becomes a SAVEPOINT.
    Settings::write_delta(&conn, "store.name", "nested-val", "term-nest").unwrap();
    // Commit the outer transaction.
    outer_tx.commit().unwrap();
    // Delta must be visible.
    assert_eq!(
        Settings::get_version(&conn, "store.name", "term-nest").unwrap(),
        Some(1)
    );
}

/// Prove that a `write_delta()` inside an outer transaction that gets
/// rolled back also rolls back the delta â€” confirming the SAVEPOINT
/// is nested within the outer transaction.
#[test]
fn write_delta_rolls_back_with_outer_transaction() {
    let conn = fresh_with_delta();
    // Start outer tx, write delta, then rollback.
    {
        let _outer_tx = conn.unchecked_transaction().unwrap();
        Settings::write_delta(&conn, "receipt.footer", "rollback-me", "term-rb").unwrap();
        // _outer_tx dropped â†’ ROLLBACK
    }
    // Delta must NOT be visible after rollback.
    assert_eq!(
        Settings::get_version(&conn, "receipt.footer", "term-rb").unwrap(),
        None
    );
}

/// Different keys from the same terminal track independent version counters.
#[test]
fn set_tracked_multiple_keys_independent_versions() {
    let conn = fresh_with_delta();
    // Key "a" gets versions 1, 2.
    Settings::set_tracked(&conn, "a", "v1", "term-x").unwrap();
    Settings::set_tracked(&conn, "a", "v2", "term-x").unwrap();
    // Key "b" should start at version 1, NOT 3.
    Settings::set_tracked(&conn, "b", "v1", "term-x").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "a", "term-x").unwrap(),
        Some(2)
    );
    assert_eq!(
        Settings::get_version(&conn, "b", "term-x").unwrap(),
        Some(1)
    );
}

/// `set_tracked` with many sequential writes verifies monotonically
/// increasing version numbers.
#[test]
fn set_tracked_monotonic_version_sequence() {
    let conn = fresh_with_delta();
    for i in 1..=5 {
        Settings::set_tracked(&conn, "receipt.footer", &format!("v{i}"), "term-mono").unwrap();
        assert_eq!(
            Settings::get_version(&conn, "receipt.footer", "term-mono").unwrap(),
            Some(i)
        );
    }
}

// â”€â”€ Transaction atomicity proof & concurrency safety â”€â”€â”€â”€â”€â”€

/// Prove that `conn.execute()` inside an `unchecked_transaction()`
/// is truly transactional: if the transaction is dropped (rolled back),
/// the `set()` must NOT persist. This verifies `set_tracked` is atomic.
#[test]
fn conn_execute_is_part_of_active_transaction() {
    let conn = fresh();
    // Open a transaction, call set(), then drop without commit.
    {
        let _tx = conn.unchecked_transaction().unwrap();
        Settings::set(&conn, "tx.key", "should-rollback").unwrap();
        // _tx dropped here â†’ ROLLBACK
    }
    // Value must NOT be visible after rollback.
    assert_eq!(Settings::get(&conn, "tx.key").unwrap(), None);
}

/// Verify that `Settings::set()` called via `conn.execute()` inside
/// an `unchecked_transaction()` commits atomically when `tx.commit()`
/// is called. This is the happy path of `set_tracked`.
#[test]
fn conn_execute_commits_with_transaction() {
    let conn = fresh();
    let tx = conn.unchecked_transaction().unwrap();
    Settings::set(&conn, "tx.key", "should-commit").unwrap();
    tx.commit().unwrap();
    assert_eq!(
        Settings::get(&conn, "tx.key").unwrap(),
        Some("should-commit".into())
    );
}

/// Concurrent `set_tracked` calls on different keys must not interfere.
/// Each key gets its own version counter regardless of thread scheduling.
/// Concurrent `set_tracked` on independent keys from separate threads.
/// Uses a temp file DB so each thread can open its own `Connection`.
/// In-memory DBs can't be shared across threads because
/// `rusqlite::Connection` contains a `RefCell` (not `Sync`).
#[test]
fn set_tracked_concurrent_threads_independent_keys() {
    use std::thread;

    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("test.db");

    // Create the DB with schema first.
    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE TABLE IF NOT EXISTS setting_updated (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                key         TEXT    NOT NULL,
                value       TEXT    NOT NULL,
                terminal_id TEXT    NOT NULL DEFAULT 'unknown',
                version     INTEGER NOT NULL,
                created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );
            CREATE INDEX IF NOT EXISTS idx_setting_updated_key_version
                ON setting_updated(key, version DESC);
            CREATE INDEX IF NOT EXISTS idx_setting_updated_terminal
                ON setting_updated(terminal_id, created_at DESC);
            PRAGMA journal_mode=WAL;
        ",
        )
        .unwrap();
    }

    let p1 = db_path.clone();
    let p2 = db_path.clone();

    let t1 = thread::spawn(move || {
        let conn = Connection::open(&p1).unwrap();
        for i in 1..=10 {
            Settings::set_tracked(&conn, "thread.a", &format!("v{i}"), "t1").unwrap();
        }
    });
    let t2 = thread::spawn(move || {
        let conn = Connection::open(&p2).unwrap();
        for i in 1..=10 {
            Settings::set_tracked(&conn, "thread.b", &format!("v{i}"), "t2").unwrap();
        }
    });

    t1.join().unwrap();
    t2.join().unwrap();

    let conn = Connection::open(&db_path).unwrap();
    // Each key should have exactly 10 versions.
    assert_eq!(
        Settings::get_version(&conn, "thread.a", "t1").unwrap(),
        Some(10)
    );
    assert_eq!(
        Settings::get_version(&conn, "thread.b", "t2").unwrap(),
        Some(10)
    );
}

/// `set_batch_tracked` with one failing delta must still write all
/// settings and the succeeding deltas. Partial failure = non-fatal.
#[test]
fn set_batch_tracked_partial_delta_failure() {
    // DB without `setting_updated` â€” all delta writes will fail.
    let conn = fresh();
    let rows: Vec<(String, String)> = vec![
        ("key.1".into(), "val1".into()),
        ("key.2".into(), "val2".into()),
        ("key.3".into(), "val3".into()),
    ];
    // Should succeed despite all delta writes failing.
    Settings::set_batch_tracked(&conn, &rows, "term-a").unwrap();
    // All settings must be persisted.
    assert_eq!(Settings::get(&conn, "key.1").unwrap(), Some("val1".into()));
    assert_eq!(Settings::get(&conn, "key.2").unwrap(), Some("val2".into()));
    assert_eq!(Settings::get(&conn, "key.3").unwrap(), Some("val3".into()));
}

/// Verify that `set_tracked`'s error does NOT roll back the `set()`.
/// The ADR specifies delta loss is non-fatal â€” the setting persists
/// even if the delta write failed. This is the production behavior.
///
/// (Already proven by `set_tracked_survives_missing_delta_table`;
/// this test confirms the behavior holds for multiple keys.)
#[test]
fn set_tracked_delta_failure_does_not_rollback_set() {
    let conn = fresh();
    // 5 keys, all without delta table â€” all delta writes fail.
    for i in 0..5 {
        let key = format!("fail.{i}");
        let val = format!("val{i}");
        Settings::set_tracked(&conn, &key, &val, "term-fail").unwrap();
        assert_eq!(Settings::get(&conn, &key).unwrap(), Some(val));
    }
    assert_eq!(Settings::load_all(&conn).unwrap().len(), 5);
}

/// Prove that `get_version` is case-sensitive â€” SQLite uses BINARY
/// collation by default. 'Key' and 'key' are different keys.
#[test]
fn get_version_case_sensitive_keys() {
    let conn = fresh_with_delta();
    Settings::write_delta(&conn, "KEY", "val1", "term-x").unwrap();
    Settings::write_delta(&conn, "key", "val2", "term-x").unwrap();
    // Uppercase KEY is independent from lowercase key.
    assert_eq!(
        Settings::get_version(&conn, "KEY", "term-x").unwrap(),
        Some(1)
    );
    assert_eq!(
        Settings::get_version(&conn, "key", "term-x").unwrap(),
        Some(1)
    );
}

/// `write_delta_on_tx` correctly picks the MAX version when hundreds
/// of existing delta rows exist for the same (key, terminal_id) pair.
#[test]
fn write_delta_with_large_version_count() {
    let conn = fresh_with_delta();
    // Insert 100 deltas manually so MAX(version) = 100.
    let tx = conn.unchecked_transaction().unwrap();
    for v in 1..=100 {
        tx.execute(
            "INSERT INTO setting_updated (key, value, terminal_id, version) VALUES (?1, ?2, ?3, ?4)",
            params!["key.v", &format!("val{v}"), "term-bulk", v],
        )
        .unwrap();
    }
    tx.commit().unwrap();

    // Now call write_delta â€” it should compute version 101.
    Settings::write_delta(&conn, "key.v", "latest", "term-bulk").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "key.v", "term-bulk").unwrap(),
        Some(101)
    );
}

/// `set_batch_tracked` with duplicate keys in a single batch.
/// The second write must overwrite the first, and the delta version
/// must increment per key.
#[test]
fn set_batch_tracked_duplicate_keys_in_batch() {
    let conn = fresh_with_delta();
    let rows: Vec<(String, String)> = vec![
        ("receipt.footer".into(), "v1".into()),
        ("receipt.footer".into(), "v2".into()),
    ];
    Settings::set_batch_tracked(&conn, &rows, "term-dup").unwrap();

    // Final value should be v2 (last write wins).
    assert_eq!(
        Settings::get(&conn, "receipt.footer").unwrap(),
        Some("v2".into())
    );
    // Delta should reflect both writes: version 2.
    assert_eq!(
        Settings::get_version(&conn, "receipt.footer", "term-dup").unwrap(),
        Some(2)
    );
}

/// Verify the `get_version` query uses the
/// `idx_setting_updated_key_version` index for efficient lookups
/// rather than a full table scan.
#[test]
fn get_version_uses_covering_index() {
    let conn = fresh_with_delta();
    let mut stmt = conn
        .prepare(
            "EXPLAIN QUERY PLAN SELECT version FROM setting_updated
             WHERE key = 'k' AND terminal_id = 't'
             ORDER BY version DESC LIMIT 1",
        )
        .unwrap();
    let plans: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(3))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    let plan_text = plans.join(" ");
    assert!(
        plan_text.contains("idx_setting_updated_key_version")
            || plan_text.contains("COVERING INDEX"),
        "get_version query should use idx_setting_updated_key_version, got: {plan_text}"
    );
}

/// `get_version` returns Only the MAX version, even when multiple
/// version rows exist for the same (key, terminal_id) pair.
#[test]
fn get_version_returns_max_for_multiple_versions() {
    let conn = fresh_with_delta();
    Settings::write_delta(&conn, "k", "v1", "term-x").unwrap();
    Settings::write_delta(&conn, "k", "v2", "term-x").unwrap();
    Settings::write_delta(&conn, "k", "v3", "term-x").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "k", "term-x").unwrap(),
        Some(3)
    );
    // Verify we have exactly 3 delta rows, not just the latest.
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM setting_updated WHERE key = 'k' AND terminal_id = 'term-x'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 3, "all three delta rows should be preserved");
}

/// `set_tracked` with the same key called from two different terminals
/// must track completely independent version counters (LWW per-terminal).
#[test]
fn set_tracked_independent_terminal_version_counters() {
    let conn = fresh_with_delta();
    // Terminal A writes key "k" twice.
    Settings::set_tracked(&conn, "k", "a1", "term-a").unwrap();
    Settings::set_tracked(&conn, "k", "a2", "term-a").unwrap();
    // Terminal B writes key "k" once.
    Settings::set_tracked(&conn, "k", "b1", "term-b").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "k", "term-a").unwrap(),
        Some(2)
    );
    assert_eq!(
        Settings::get_version(&conn, "k", "term-b").unwrap(),
        Some(1)
    );
    // The settings value should be the last write across all terminals.
    assert_eq!(Settings::get(&conn, "k").unwrap(), Some("b1".into()));
}

/// Verify `write_delta` handles version numbers near `i64::MAX`
/// without overflow or panic. SQLite integer arithmetic wraps on
/// overflow, but the delta write itself should succeed.
#[test]
fn write_delta_near_version_overflow() {
    let conn = fresh_with_delta();
    // Insert a row at i64::MAX to set up the overflow scenario.
    conn.execute(
        "INSERT INTO setting_updated (key, value, terminal_id, version)
         VALUES ('overflow.key', 'max', 'term-of', ?1)",
        params![i64::MAX],
    )
    .unwrap();
    // `write_delta` should still succeed â€” the version computation
    // wraps around, but the method should not panic.
    let result = Settings::write_delta(&conn, "overflow.key", "post-max", "term-of");
    assert!(result.is_ok(), "write_delta should not panic near i64::MAX");
    // The version stored is implementation-defined (wrap or saturate),
    // but we must have a version row.
    assert!(Settings::get_version(&conn, "overflow.key", "term-of").is_ok());
}

/// `write_delta` with a very long key (near SQLite's default
/// limit) should not panic or truncate silently.
#[test]
fn write_delta_long_key() {
    let conn = fresh_with_delta();
    let long_key = "k".repeat(500); // 500 chars, well under limit
    Settings::write_delta(&conn, &long_key, "long-val", "term-lg").unwrap();
    let v = Settings::get_version(&conn, &long_key, "term-lg").unwrap();
    assert_eq!(v, Some(1));
}

/// `write_delta` with a very long value (multi-kilobyte JSON blob)
/// should not panic or truncate.
#[test]
fn write_delta_long_value() {
    let conn = fresh_with_delta();
    let long_value = "x".repeat(10_000); // 10 KB value
    Settings::write_delta(&conn, "bulk.key", &long_value, "term-bulk").unwrap();
    let v = Settings::get_version(&conn, "bulk.key", "term-bulk").unwrap();
    assert_eq!(v, Some(1));
}

#[test]
fn keys_constants_are_non_empty() {
    assert!(!keys::STORE_NAME.is_empty());
    assert!(!keys::STORE_ADDRESS.is_empty());
    assert!(!keys::STORE_TAX_ID.is_empty());
    assert!(!keys::DEFAULT_CURRENCY.is_empty());
    assert!(!keys::OLD_DEFAULT_CURRENCY.is_empty());
    assert!(!keys::CURRENCY_FORMAT.is_empty());
    assert!(!keys::CURRENCY_SYMBOL_POSITION.is_empty());
    assert!(!keys::CURRENCY_DECIMAL_SEPARATOR.is_empty());
    assert!(!keys::CURRENCY_THOUSANDS_SEPARATOR.is_empty());
    assert!(!keys::STORE_PRESET.is_empty());
    assert!(!keys::SETUP_COMPLETE.is_empty());
    assert!(!keys::SHOW_SETUP_WIZARD.is_empty());
    assert!(!keys::RECEIPT_SHOW_CURRENCY.is_empty());
    assert!(!keys::RECEIPT_DECIMAL_SEP.is_empty());
    assert!(!keys::RECEIPT_SHOW_TAX.is_empty());
    assert!(!keys::RECEIPT_FOOTER.is_empty());
    assert!(!keys::RECEIPT_PAPER_WIDTH.is_empty());
    assert!(!keys::RECEIPT_SHOW_TABLE_NUMBER.is_empty());
    assert!(!keys::SYNC_SERVER_URL.is_empty());
    assert!(!keys::SYNC_API_KEY.is_empty());
    assert!(!keys::SYNC_ENABLED.is_empty());
    assert!(!keys::PG_SYNC_ENABLED.is_empty());
    assert!(!keys::PG_SYNC_HOST.is_empty());
    assert!(!keys::PG_SYNC_PORT.is_empty());
    assert!(!keys::PG_SYNC_DBNAME.is_empty());
    assert!(!keys::PG_SYNC_USER.is_empty());
    assert!(!keys::PG_SYNC_PASSWORD.is_empty());
    assert!(!keys::RATE_SYNC_ENABLED.is_empty());
    assert!(!keys::RATE_SYNC_API_KEY.is_empty());
    assert!(!keys::RATE_SYNC_INTERVAL.is_empty());
    assert!(!keys::RATE_SYNC_BASE_CURRENCY.is_empty());
    assert!(!keys::BRAND_PRIMARY_COLOUR.is_empty());
    assert!(!keys::BRAND_LOGO_PATH.is_empty());
    assert!(!keys::BRAND_STORE_NAME.is_empty());
    assert!(!keys::LAN_SERVER_BIND.is_empty());
    assert!(!keys::LAN_SERVER_PSK.is_empty());
}

// â”€â”€ ADR #22 resilience & correctness tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// SQL-injection-like strings in keys/values should be handled
/// safely by parameterized queries â€” no syntax errors, no data leaks.
#[test]
fn write_delta_sql_injection_resilience() {
    let conn = fresh_with_delta();
    let malicious = "'; DROP TABLE settings; --";
    // Key with injection attempt.
    Settings::write_delta(&conn, malicious, "safe-val", "term-sql").unwrap();
    assert_eq!(
        Settings::get_version(&conn, malicious, "term-sql").unwrap(),
        Some(1)
    );
    // Value with injection attempt.
    Settings::write_delta(&conn, "safe.key", malicious, "term-sql").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "safe.key", "term-sql").unwrap(),
        Some(1)
    );
    // The settings table should still exist (not dropped).
    assert!(Settings::load_all(&conn).is_ok());
}

/// `set_tracked` with SQL-injection-like inputs should also be safe.
#[test]
fn set_tracked_sql_injection_resilience() {
    let conn = fresh_with_delta();
    let malicious = "'; DROP TABLE setting_updated; --";
    Settings::set_tracked(&conn, malicious, malicious, "term-sql").unwrap();
    // Delta table should still exist.
    assert!(Settings::get_version(&conn, "safe.check", "term-sql").is_ok());
    // The malicious value should be stored literally.
    assert_eq!(
        Settings::get(&conn, malicious).unwrap(),
        Some(malicious.into())
    );
}

/// Empty string key is valid in SQLite â€” `write_delta` should
/// handle it without panicking.
#[test]
fn write_delta_empty_string_key() {
    let conn = fresh_with_delta();
    Settings::write_delta(&conn, "", "empty-key-val", "term-empty").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "", "term-empty").unwrap(),
        Some(1)
    );
}

/// Empty string terminal_id should work â€” it's a valid default.
#[test]
fn write_delta_empty_terminal_id() {
    let conn = fresh_with_delta();
    Settings::write_delta(&conn, "k", "v", "").unwrap();
    assert_eq!(Settings::get_version(&conn, "k", "").unwrap(), Some(1));
}

/// Delta rows should have a non-null `created_at` timestamp
/// populated by the DEFAULT clause.
#[test]
fn write_delta_created_at_is_populated() {
    let conn = fresh_with_delta();
    Settings::write_delta(&conn, "ts.key", "ts-val", "term-ts").unwrap();
    let ts: String = conn
        .query_row(
            "SELECT created_at FROM setting_updated WHERE key = 'ts.key' AND terminal_id = 'term-ts'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!ts.is_empty(), "created_at should not be empty");
    // Should be an ISO 8601-like timestamp.
    assert!(ts.contains('T'), "timestamp should contain 'T': {ts}");
}

/// `write_delta` should not leave partial data when an error occurs
/// inside the savepoint. We can't easily trigger a constraint violation
/// on the INSERT (all columns accept any text), but we verify the
/// ROLLBACK path exists and the function signature handles errors.
///
/// Instead, verify that a successful write_delta followed by another
/// write on the same key correctly increments (proving the savepoint
/// lifecycle is clean â€” no stale savepoints).
#[test]
fn write_delta_savepoint_cleanup_allows_reuse() {
    let conn = fresh_with_delta();
    // First write â€” savepoint created, released.
    Settings::write_delta(&conn, "sp.k", "v1", "term-sp").unwrap();
    // Second write â€” new savepoint, must not collide with stale state.
    Settings::write_delta(&conn, "sp.k", "v2", "term-sp").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "sp.k", "term-sp").unwrap(),
        Some(2)
    );
}

/// Single-quote (apostrophe) in key names is a common real-world
/// edge case â€” e.g. store names like "Joe's Caf\u{00e9}".
#[test]
fn write_delta_single_quote_in_key() {
    let conn = fresh_with_delta();
    let key = "store.it's";
    Settings::write_delta(&conn, key, "val", "term-sq").unwrap();
    assert_eq!(
        Settings::get_version(&conn, key, "term-sq").unwrap(),
        Some(1)
    );
}

// â”€â”€ ADR #22 error-path bug hunting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// `write_delta` should not panic when the `setting_updated` table
/// does not exist. The ROLLBACK path must execute cleanly.
/// This proves the savepoint error-recovery code path is reachable
/// and works correctly.
#[test]
fn write_delta_rolls_back_cleanly_on_missing_table() {
    // DB without `setting_updated` â€” SELECT will fail.
    let conn = fresh();
    let result = Settings::write_delta(&conn, "k", "v", "term-rb");
    // write_delta should return an error, not panic.
    assert!(result.is_err(), "write_delta should error on missing table");
    // The settings table should be unaffected (no partial writes).
    assert!(Settings::load_all(&conn).is_ok());
    // Connection must still be usable after the savepoint rollback â€”
    // a subsequent write to the settings table should succeed.
    Settings::set(&conn, "recovery.key", "recovered").unwrap();
    assert_eq!(
        Settings::get(&conn, "recovery.key").unwrap(),
        Some("recovered".into())
    );
}

/// `set_batch_tracked` should persist settings even when delta
/// writes fail for every row. Delta loss is non-fatal.
/// This proves the batch-level error resilience.
#[test]
fn set_batch_tracked_survives_all_delta_failures() {
    // DB without `setting_updated` â€” all delta writes will fail.
    let conn = fresh();
    let rows: Vec<(String, String)> = vec![
        ("batch.a".into(), "va".into()),
        ("batch.b".into(), "vb".into()),
        ("batch.c".into(), "vc".into()),
    ];
    let result = Settings::set_batch_tracked(&conn, &rows, "term-batch");
    // Should succeed â€” delta failures are non-fatal.
    assert!(
        result.is_ok(),
        "set_batch_tracked should succeed despite delta failures"
    );
    // All three settings must be persisted.
    assert_eq!(Settings::get(&conn, "batch.a").unwrap(), Some("va".into()));
    assert_eq!(Settings::get(&conn, "batch.b").unwrap(), Some("vb".into()));
    assert_eq!(Settings::get(&conn, "batch.c").unwrap(), Some("vc".into()));
    // No deltas should have been written â€” the delta table doesn't exist.
    assert!(Settings::get_version(&conn, "batch.a", "term-batch").is_err());
    assert!(Settings::get_version(&conn, "batch.b", "term-batch").is_err());
    assert!(Settings::get_version(&conn, "batch.c", "term-batch").is_err());
}

/// `set_tracked` should return an error (not panic) when the
/// `settings` table itself is missing â€” the outer transaction
/// must roll back cleanly.
#[test]
fn set_tracked_errors_when_settings_table_missing() {
    let conn = Connection::open_in_memory().unwrap();
    // No tables at all â€” `set()` will fail.
    let result = Settings::set_tracked(&conn, "k", "v", "term");
    assert!(
        result.is_err(),
        "set_tracked should error when settings table missing"
    );
}

// â”€â”€ ADR #22 completeness: timestamps, batch edges, stress â”€â”€â”€â”€â”€

/// The `settings` table has an `updated_at` column with a DEFAULT
/// that should be populated automatically on INSERT.
#[test]
fn settings_updated_at_is_populated_on_set() {
    let conn = fresh();
    Settings::set(&conn, "ts.key", "ts-val").unwrap();
    let ts: String = conn
        .query_row(
            "SELECT updated_at FROM settings WHERE key = 'ts.key'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!ts.is_empty(), "updated_at should be populated");
    assert!(ts.contains('T'), "updated_at should be ISO 8601: {ts}");
}

/// `updated_at` should change when a setting value is overwritten,
/// providing a per-key modification timestamp.
#[test]
fn settings_updated_at_changes_on_overwrite() {
    let conn = fresh();
    Settings::set(&conn, "ts.k", "v1").unwrap();
    let ts1: String = conn
        .query_row(
            "SELECT updated_at FROM settings WHERE key = 'ts.k'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    // Small delay to ensure timestamp changes (10ms margin).
    std::thread::sleep(std::time::Duration::from_millis(10));
    Settings::set(&conn, "ts.k", "v2").unwrap();
    let ts2: String = conn
        .query_row(
            "SELECT updated_at FROM settings WHERE key = 'ts.k'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_ne!(ts1, ts2, "updated_at should change on overwrite");
}

/// `set_batch_tracked` with an empty terminal_id should work
/// â€” empty string is a valid terminal identifier.
#[test]
fn set_batch_tracked_empty_terminal_id() {
    let conn = fresh_with_delta();
    let rows: Vec<(String, String)> =
        vec![("bt.k1".into(), "v1".into()), ("bt.k2".into(), "v2".into())];
    Settings::set_batch_tracked(&conn, &rows, "").unwrap();
    assert_eq!(Settings::get(&conn, "bt.k1").unwrap(), Some("v1".into()));
    assert_eq!(Settings::get(&conn, "bt.k2").unwrap(), Some("v2".into()));
    assert_eq!(Settings::get_version(&conn, "bt.k1", "").unwrap(), Some(1));
    assert_eq!(Settings::get_version(&conn, "bt.k2", "").unwrap(), Some(1));
}

/// Stress test: 1,000 consecutive `write_delta` calls on the same
/// (key, terminal_id) pair. The version counter should reach 1,000
/// without stalling, wrapping, or erroring.
#[test]
fn write_delta_1000_consecutive_calls() {
    let conn = fresh_with_delta();
    for i in 1..=1000 {
        Settings::write_delta(&conn, "stress.k", &format!("v{i}"), "term-stress").unwrap();
    }
    assert_eq!(
        Settings::get_version(&conn, "stress.k", "term-stress").unwrap(),
        Some(1000)
    );
}

/// `set_batch` (without delta tracking) should not affect the
/// `setting_updated` table. Delta and non-delta writes must be
/// independent.
#[test]
fn set_batch_does_not_affect_delta_table() {
    let conn = fresh_with_delta();
    // Write a delta first to establish a baseline.
    Settings::write_delta(&conn, "ind.k", "v0", "term-ind").unwrap();
    assert_eq!(
        Settings::get_version(&conn, "ind.k", "term-ind").unwrap(),
        Some(1)
    );
    // Now use set_batch on the same key â€” no delta should be written.
    let rows: Vec<(String, String)> = vec![("ind.k".into(), "v1".into())];
    Settings::set_batch(&conn, &rows).unwrap();
    // Setting value should be updated.
    assert_eq!(Settings::get(&conn, "ind.k").unwrap(), Some("v1".into()));
    // Delta version should NOT have changed (still 1, not 2).
    assert_eq!(
        Settings::get_version(&conn, "ind.k", "term-ind").unwrap(),
        Some(1)
    );
}

/// Removing a setting should not delete its delta history.
/// The delta ledger is an append-only audit trail.
#[test]
fn remove_preserves_delta_history() {
    let conn = fresh_with_delta();
    Settings::set_tracked(&conn, "rm.k", "v1", "term-rm").unwrap();
    Settings::set_tracked(&conn, "rm.k", "v2", "term-rm").unwrap();
    // Remove the setting.
    assert!(Settings::remove(&conn, "rm.k").unwrap());
    // Setting should be gone.
    assert_eq!(Settings::get(&conn, "rm.k").unwrap(), None);
    // But delta history must survive â€” 2 versions still exist.
    assert_eq!(
        Settings::get_version(&conn, "rm.k", "term-rm").unwrap(),
        Some(2)
    );
}

/// Two connections race `Settings::write_delta` on the same
/// (key, terminal_id) against a shared file DB. Migration 116's UNIQUE
/// index makes a duplicate-version collision a hard constraint error, so
/// both writers must succeed and the ledger must end gapless (1, 2, 3 — no
/// duplicates, none dropped): the DB-08 retry contract made real.
///
/// The interleaving is deterministic: connection A holds a `BEGIN IMMEDIATE`
/// write lock from before B starts, so B's allocation is guaranteed to read
/// the same MAX as A and collide on its INSERT (A's lock blocks B's write).
/// A wins the slot; B must retry and land the next version.
#[test]
fn write_delta_concurrent_same_pair_never_loses_delta() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("delta-race.sqlite");
    {
        let setup = Connection::open(&db_path).unwrap();
        setup
            .busy_timeout(std::time::Duration::from_secs(30))
            .unwrap();
        // Mirrors migrations 100 + 116: the delta ledger plus the UNIQUE
        // (key, terminal_id, version) index that fails closed on a race.
        setup
            .execute_batch(
                "CREATE TABLE setting_updated (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    key         TEXT    NOT NULL,
                    value       TEXT    NOT NULL,
                    terminal_id TEXT    NOT NULL DEFAULT 'unknown',
                    version     INTEGER NOT NULL,
                    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                );
                CREATE UNIQUE INDEX idx_setting_updated_unique_version
                    ON setting_updated(key, terminal_id, version);",
            )
            .unwrap();
        // Seed version 1 so the race targets the next free slot.
        Settings::write_delta(&setup, "receipt.footer", "seed", "term-race").unwrap();
    }

    // Connection A grabs the write lock and holds it while B races.
    let conn_a = Connection::open(&db_path).unwrap();
    conn_a
        .busy_timeout(std::time::Duration::from_secs(30))
        .unwrap();
    conn_a.execute_batch("BEGIN IMMEDIATE").unwrap();

    // Connection B computes the same MAX(version)+1 as A and its INSERT is
    // blocked by A's lock — the guaranteed duplicate-version collision.
    let conn_b = Connection::open(&db_path).unwrap();
    conn_b
        .busy_timeout(std::time::Duration::from_secs(30))
        .unwrap();
    let loser = std::thread::spawn(move || {
        Settings::write_delta(&conn_b, "receipt.footer", "loser", "term-race")
    });

    // Give B time to reach its blocked write, then win the slot ourselves.
    std::thread::sleep(std::time::Duration::from_millis(500));
    Settings::write_delta(&conn_a, "receipt.footer", "winner", "term-race").unwrap();
    conn_a.execute_batch("COMMIT").unwrap();

    let loser_result = loser.join().unwrap();
    assert!(
        loser_result.is_ok(),
        "concurrent write_delta lost its delta: {loser_result:?}"
    );

    // seed (1) + winner (2) + loser (3): the ledger must be exactly
    // versions 1..=3 with no duplicates and no gaps.
    let conn = Connection::open(&db_path).unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT version FROM setting_updated
             WHERE key = 'receipt.footer' AND terminal_id = 'term-race'
             ORDER BY version",
        )
        .unwrap();
    let versions: Vec<i64> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(
        versions,
        vec![1, 2, 3],
        "delta ledger must be gapless 1..=3"
    );
}

// ── Brand primary colour: empty string = follow the active theme ──

#[test]
fn brand_primary_colour_unset_returns_empty_string() {
    let conn = fresh();
    // A fresh store must NOT report a colour: the UI treats "" as "no
    // override", letting the theme token sheet pick the per-theme primary
    // (light #147EFB, dark #1155CC). The old "#147EFB" fallback pinned
    // both themes to the light blue on every fresh install.
    assert_eq!(
        Settings::get_brand_primary_colour(&conn).unwrap(),
        "",
        "unset brand colour must read as the empty follow-theme sentinel"
    );
}

#[test]
fn brand_primary_colour_roundtrip_and_clear() {
    let conn = fresh();
    Settings::set_brand_primary_colour(&conn, "#FF5500").unwrap();
    assert_eq!(
        Settings::get_brand_primary_colour(&conn).unwrap(),
        "#FF5500"
    );

    // Reset-to-theme-default persists the empty sentinel.
    Settings::set_brand_primary_colour(&conn, "").unwrap();
    assert_eq!(Settings::get_brand_primary_colour(&conn).unwrap(), "");
}

// ── Mixed-generation reads: pre-encryption rows in the encrypted secret columns ──
//
// Five typed getters in `typed.rs` read a secret as
// `decrypt(value).unwrap_or(value)`:
//
//   typed.rs:334  get_sync_api_key          -> decrypt_sync_api_key
//   typed.rs:361  get_sync_terminal_secret  -> decrypt_sync_terminal_secret
//   typed.rs:437  get_pg_sync_password      -> decrypt_pg_sync_password
//   typed.rs:553  get_rate_sync_api_key     -> decrypt_rate_api_key
//   typed.rs:639  get_lan_server_psk        -> decrypt_lan_psk
//
// That `unwrap_or` is load-bearing, not sloppiness. An install whose row
// predates the setters encrypting still holds a PLAINTEXT `sync_api_key`,
// `pg_sync.password` or `lan_server.psk` in the table, nothing ever rewrites
// it, and the fallback is the only reason the store can read its own secret.
// The property had no owner in this file — neither "legacy" nor "plaintext"
// appeared anywhere in it before this section. Half one pins the read. Half
// two pins, in the same file, the price the same tolerance pays, so a future
// "surface decrypt failures" change (recorded at typed.rs:6-7) must answer
// both at once.

/// Insert a row straight into the `settings` table, bypassing every door on
/// the write path — [`Settings::set`], the typed setters that encrypt first,
/// and the tracked funnel with its policy and delta ledger. That is exactly
/// what a row written by a pre-encryption build looks like on disk.
fn seed_bare_row(conn: &Connection, key: &str, value: &str) {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .unwrap();
}

/// A value with the exact shape of this crate's ciphertext — 64 URL-safe
/// base64 characters decoding to 48 bytes, well past the `12 nonce + 16
/// tag` floor that `kasirmu_crypto`'s `looks_like_ciphertext` gate uses — which no
/// key on any machine can decrypt, because every byte is zero so the
/// AES-256-GCM tag check always fails. From the reader's side this is what a
/// corrupted, truncated or tampered-with secret row looks like.
const SHAPED_UNDECRYPTABLE: &str =
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

#[test]
fn pinned_probe_values_are_the_two_shapes_this_path_cannot_tell_apart() {
    // The referee is the crate's OWN format gate, reached through the public
    // smtp reader — the one family (kasirmu-crypto lib.rs:216-223) that separates
    // "never encrypted" from "tampered". Used as a shape oracle only; the
    // smtp key has nothing to do with the five columns below.
    assert_eq!(
        kasirmu_crypto::decrypt_smtp_at_rest("sk-sync-legacy:0001").unwrap(),
        "sk-sync-legacy:0001",
        "the legacy sample must be a value the crate calls never-encrypted"
    );
    assert!(
        kasirmu_crypto::decrypt_smtp_at_rest(SHAPED_UNDECRYPTABLE).is_err(),
        "the pinned value must be one the crate itself would call tampered,          not a legacy row — which is precisely what the five typed getters          below fail to do"
    );
}

// Half one — the mixed-generation read an operator depends on. ──────────────

#[test]
fn legacy_plaintext_sync_api_key_reads_back_unchanged() {
    let conn = fresh();
    seed_bare_row(&conn, keys::SYNC_API_KEY, "sk-sync-legacy:0001");
    // The row really is plaintext on disk: no write door encrypted it.
    assert_eq!(
        Settings::get(&conn, keys::SYNC_API_KEY).unwrap(),
        Some("sk-sync-legacy:0001".into()),
        "the seeded row must stand as stored, or this is not a legacy read"
    );
    assert_eq!(
        Settings::get_sync_api_key(&conn).unwrap(),
        Some("sk-sync-legacy:0001".into()),
        "a sync key that never was encrypted must come back byte for byte"
    );
}

#[test]
fn legacy_plaintext_sync_terminal_secret_reads_back_unchanged() {
    let conn = fresh();
    seed_bare_row(
        &conn,
        keys::SYNC_TERMINAL_SECRET,
        "terminal-secret-legacy:v1",
    );
    assert_eq!(
        Settings::get(&conn, keys::SYNC_TERMINAL_SECRET).unwrap(),
        Some("terminal-secret-legacy:v1".into())
    );
    assert_eq!(
        Settings::get_sync_terminal_secret(&conn).unwrap(),
        Some("terminal-secret-legacy:v1".into()),
        "a paired terminal's pre-encryption secret must survive the read"
    );
}

#[test]
fn legacy_plaintext_pg_sync_password_reads_back_unchanged() {
    let conn = fresh();
    seed_bare_row(&conn, keys::PG_SYNC_PASSWORD, "legacy-pg-password!2019");
    assert_eq!(
        Settings::get(&conn, keys::PG_SYNC_PASSWORD).unwrap(),
        Some("legacy-pg-password!2019".into())
    );
    assert_eq!(
        Settings::get_pg_sync_password(&conn).unwrap(),
        Some("legacy-pg-password!2019".into()),
        "the PG sync password an install has been using since before          encryption-at-rest shipped must still read back unchanged"
    );
}

#[test]
fn legacy_plaintext_rate_sync_api_key_reads_back_unchanged() {
    let conn = fresh();
    seed_bare_row(&conn, keys::RATE_SYNC_API_KEY, "ratesync-legacy-key#77");
    assert_eq!(
        Settings::get(&conn, keys::RATE_SYNC_API_KEY).unwrap(),
        Some("ratesync-legacy-key#77".into())
    );
    assert_eq!(
        Settings::get_rate_sync_api_key(&conn).unwrap(),
        Some("ratesync-legacy-key#77".into()),
        "a never-encrypted rate provider key must read back byte for byte"
    );
}

#[test]
fn legacy_plaintext_lan_server_psk_reads_back_unchanged() {
    let conn = fresh();
    seed_bare_row(&conn, keys::LAN_SERVER_PSK, "lan-psk-legacy:alpha");
    assert_eq!(
        Settings::get(&conn, keys::LAN_SERVER_PSK).unwrap(),
        Some("lan-psk-legacy:alpha".into())
    );
    assert_eq!(
        Settings::get_lan_server_psk(&conn).unwrap(),
        Some("lan-psk-legacy:alpha".into()),
        "a LAN PSK written before the setter encrypted must still let the          KDS pair; that is the read this tolerance protects"
    );
}

// Half two — the same tolerance, seen from the other side, as of C1 slice S1.5
// (typed.rs:334/361/437/553/639). A value that IS ciphertext-shaped and merely
// FAILS authentication is no longer handed back as if it were the secret: the
// five getters now fail closed, because that value is not the credential and
// passing it on put base64 in an SMTP client, a sync request or a PostgreSQL
// connection with no error anywhere. The error names the setting key and never
// the value.
//
// Half one is untouched and is the reason the gate is the shape predicate
// rather than a bare `.unwrap_or` removed: "never encrypted" (not ciphertext
// shape) still reads back byte for byte, because on this path a value with no
// ciphertext shape is a legitimate pre-encryption row, not tampering.

#[test]
fn fail_closed_sync_api_key_rejects_shaped_undecryptable_bytes() {
    let conn = fresh();
    seed_bare_row(&conn, keys::SYNC_API_KEY, SHAPED_UNDECRYPTABLE);
    assert!(
        kasirmu_crypto::decrypt_sync_api_key(SHAPED_UNDECRYPTABLE).is_err(),
        "premise: the value must fail the very decrypt this getter calls"
    );
    let err = Settings::get_sync_api_key(&conn)
        .expect_err("a tampered sync key must not reach the caller as the secret");
    let msg = err.to_string();
    assert!(
        msg.contains(keys::SYNC_API_KEY),
        "the error must name the setting key: {msg}"
    );
    assert!(
        !msg.contains(SHAPED_UNDECRYPTABLE),
        "the error must never carry the value: {msg}"
    );
}

#[test]
fn fail_closed_sync_terminal_secret_rejects_shaped_undecryptable_bytes() {
    let conn = fresh();
    seed_bare_row(&conn, keys::SYNC_TERMINAL_SECRET, SHAPED_UNDECRYPTABLE);
    assert!(
        kasirmu_crypto::decrypt_sync_terminal_secret(SHAPED_UNDECRYPTABLE).is_err(),
        "premise: the value must fail the very decrypt this getter calls"
    );
    let err = Settings::get_sync_terminal_secret(&conn)
        .expect_err("a tampered device secret must not be signed with as if it were the secret");
    let msg = err.to_string();
    assert!(
        msg.contains(keys::SYNC_TERMINAL_SECRET),
        "the error must name the setting key: {msg}"
    );
    assert!(
        !msg.contains(SHAPED_UNDECRYPTABLE),
        "the error must never carry the value: {msg}"
    );
}

#[test]
fn fail_closed_pg_sync_password_rejects_shaped_undecryptable_bytes() {
    let conn = fresh();
    seed_bare_row(&conn, keys::PG_SYNC_PASSWORD, SHAPED_UNDECRYPTABLE);
    assert!(
        kasirmu_crypto::decrypt_pg_sync_password(SHAPED_UNDECRYPTABLE).is_err(),
        "premise: the value must fail the very decrypt this getter calls"
    );
    let err = Settings::get_pg_sync_password(&conn)
        .expect_err("base64 ciphertext must not be sent to PostgreSQL as the password");
    let msg = err.to_string();
    assert!(
        msg.contains(keys::PG_SYNC_PASSWORD),
        "the error must name the setting key: {msg}"
    );
    assert!(
        !msg.contains(SHAPED_UNDECRYPTABLE),
        "the error must never carry the value: {msg}"
    );
}

#[test]
fn fail_closed_rate_sync_api_key_rejects_shaped_undecryptable_bytes() {
    let conn = fresh();
    seed_bare_row(&conn, keys::RATE_SYNC_API_KEY, SHAPED_UNDECRYPTABLE);
    assert!(
        kasirmu_crypto::decrypt_rate_api_key(SHAPED_UNDECRYPTABLE).is_err(),
        "premise: the value must fail the very decrypt this getter calls"
    );
    let err = Settings::get_rate_sync_api_key(&conn)
        .expect_err("a tampered rate key must not be sent to the provider as the API key");
    let msg = err.to_string();
    assert!(
        msg.contains(keys::RATE_SYNC_API_KEY),
        "the error must name the setting key: {msg}"
    );
    assert!(
        !msg.contains(SHAPED_UNDECRYPTABLE),
        "the error must never carry the value: {msg}"
    );
}

#[test]
fn fail_closed_lan_server_psk_rejects_shaped_undecryptable_bytes() {
    let conn = fresh();
    seed_bare_row(&conn, keys::LAN_SERVER_PSK, SHAPED_UNDECRYPTABLE);
    assert!(
        kasirmu_crypto::decrypt_lan_psk(SHAPED_UNDECRYPTABLE).is_err(),
        "premise: the value must fail the very decrypt this getter calls"
    );
    let err = Settings::get_lan_server_psk(&conn)
        .expect_err("the LAN server must not run on 48 zero bytes as its pre-shared key");
    let msg = err.to_string();
    assert!(
        msg.contains(keys::LAN_SERVER_PSK),
        "the error must name the setting key: {msg}"
    );
    assert!(
        !msg.contains(SHAPED_UNDECRYPTABLE),
        "the error must never carry the value: {msg}"
    );
}

// Half one, restated for the fail-closed gate: the values that are NOT
// ciphertext — an unset key, an empty string — must keep reading exactly as
// they did before the gate existed. Neither is an error.

#[test]
fn fail_closed_leaves_unset_and_empty_values_reading_back_as_before() {
    let conn = fresh();
    assert_eq!(Settings::get_sync_api_key(&conn).unwrap(), None);
    assert_eq!(Settings::get_sync_terminal_secret(&conn).unwrap(), None);
    assert_eq!(Settings::get_pg_sync_password(&conn).unwrap(), None);
    assert_eq!(Settings::get_rate_sync_api_key(&conn).unwrap(), None);
    assert_eq!(Settings::get_lan_server_psk(&conn).unwrap(), None);

    seed_bare_row(&conn, keys::SYNC_TERMINAL_SECRET, "");
    assert_eq!(
        Settings::get_sync_terminal_secret(&conn).unwrap(),
        None,
        "an empty terminal secret still means 'not paired', not a decrypt failure"
    );
    seed_bare_row(&conn, keys::LAN_SERVER_PSK, "");
    assert_eq!(
        Settings::get_lan_server_psk(&conn).unwrap(),
        Some(String::new()),
        "an empty LAN PSK is still the empty string, not an error"
    );
}
