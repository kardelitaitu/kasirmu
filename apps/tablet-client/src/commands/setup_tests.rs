use super::*;
use oz_core::{Store, migrations};
use rusqlite::Connection;

/// Create a fresh in-memory connection with migrations applied.
fn fresh_conn() -> Connection {
    migrations::fresh_db()
}

/// Run the production `complete_setup` statement list against a plain
/// `&Connection`, so tests need no Tauri runtime.
///
/// This delegates to `write_setup` — the very function the `#[command]`
/// calls inside its transaction — rather than re-listing the operations.
/// A re-listed copy passes while the command drops a leg, which is exactly
/// how the currency write stayed invisible here.
fn run_complete_setup(
    conn: &Connection,
    preset: &str,
    features: &[&str],
) -> Result<(), Box<dyn std::error::Error>> {
    run_complete_setup_args(
        conn,
        // Fed through the shared struct rather than built field-by-field,
        // so the currency leg carries the struct's own `#[serde(default)]`
        // value and not a literal restated here.
        &deserialise(serde_json::json!({ "preset": preset, "features": features })),
    )
}

/// Deserialise a wizard-shaped payload into the shared args type.
fn deserialise(payload: serde_json::Value) -> CompleteSetupArgs {
    serde_json::from_value(payload).expect("setup wizard payload must deserialize")
}

/// `run_complete_setup` for a caller that already holds the args — the
/// deserialised wizard payload in the end-to-end case below.
fn run_complete_setup_args(
    conn: &Connection,
    args: &CompleteSetupArgs,
) -> Result<(), Box<dyn std::error::Error>> {
    write_setup(conn, args)?;
    Ok(())
}

#[test]
fn complete_setup_persists_features() {
    let conn = fresh_conn();

    run_complete_setup(
        &conn,
        "simple-retail",
        &[
            "cash-payment",
            "barcode-scanning",
            "receipt-printing",
            "inventory-tracking",
            "categories-enabled",
            "tax-engine",
        ],
    )
    .unwrap();

    // Verify setup is marked complete.
    let completed = Settings::get(&conn, oz_core::settings::keys::SETUP_COMPLETE)
        .unwrap()
        .unwrap();
    assert_eq!(completed, "1");

    let preset = Settings::get(&conn, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "simple-retail");
}

#[test]
fn get_setup_status_defaults_to_not_completed() {
    let conn = fresh_conn();

    let completed = Settings::get(&conn, oz_core::settings::keys::SETUP_COMPLETE).unwrap();
    assert_eq!(completed, None);

    let preset = Settings::get(&conn, oz_core::settings::keys::STORE_PRESET).unwrap();
    assert_eq!(preset, None);
}

#[test]
fn complete_setup_skips_unknown_features() {
    let conn = fresh_conn();

    run_complete_setup(
        &conn,
        "custom",
        &["cash-payment", "made-up-feature"], // unknown, should be skipped
    )
    .unwrap();

    // Should still succeed.
    let completed = Settings::get(&conn, oz_core::settings::keys::SETUP_COMPLETE)
        .unwrap()
        .unwrap();
    assert_eq!(completed, "1");

    // Only cash-payment should be enabled.
    let store = Store::new(&conn);
    let loaded = store.load_features().unwrap();
    assert!(loaded.is_enabled(oz_core::Feature::CashPayment));
    assert!(!loaded.is_enabled(oz_core::Feature::BarcodeScanning));
}

#[test]
fn complete_setup_empty_features() {
    let conn = fresh_conn();

    run_complete_setup(&conn, "empty-store", &[]).unwrap();

    let completed = Settings::get(&conn, oz_core::settings::keys::SETUP_COMPLETE)
        .unwrap()
        .unwrap();
    assert_eq!(completed, "1");

    let preset = Settings::get(&conn, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "empty-store");

    // No features should be enabled.
    let store = Store::new(&conn);
    let loaded = store.load_features().unwrap();
    assert_eq!(loaded.count(), 0);
}

#[test]
fn complete_setup_with_different_presets() {
    let conn = fresh_conn();

    // Test restaurant preset.
    run_complete_setup(
        &conn,
        "restaurant",
        &[
            "restaurant",
            "cash-payment",
            "receipt-printing",
            "inventory-tracking",
            "categories-enabled",
            "discount-engine",
            "tax-engine",
            "kitchen-display",
            "table-management",
            "staff-login",
        ],
    )
    .unwrap();

    let completed = Settings::get(&conn, oz_core::settings::keys::SETUP_COMPLETE)
        .unwrap()
        .unwrap();
    assert_eq!(completed, "1");

    let preset = Settings::get(&conn, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "restaurant");

    // Verify restaurant-specific features.
    let store = Store::new(&conn);
    let loaded = store.load_features().unwrap();
    assert!(loaded.is_enabled(oz_core::Feature::Restaurant));
    assert!(loaded.is_enabled(oz_core::Feature::KitchenDisplay));
    assert!(loaded.is_enabled(oz_core::Feature::TableManagement));
    assert!(loaded.is_enabled(oz_core::Feature::StaffLogin));
    assert!(!loaded.is_enabled(oz_core::Feature::SimpleRetail));
    assert!(!loaded.is_enabled(oz_core::Feature::CardPayment));
}

#[test]
fn complete_setup_all_features_single_preset() {
    let conn = fresh_conn();

    // Full-store preset: 24 feature keys.
    run_complete_setup(
        &conn,
        "full-store",
        &[
            "simple-retail",
            "cash-payment",
            "card-payment",
            "multi-currency",
            "inventory-tracking",
            "product-variants",
            "categories-enabled",
            "staff-login",
            "staff-roles",
            "shift-management",
            "audit-log",
            "barcode-scanning",
            "receipt-printing",
            "cash-drawer",
            "customer-display",
            "nfc-reader",
            "discount-engine",
            "tax-engine",
            "loyalty-program",
            "promotions-engine",
            "product-bundles",
            "reporting",
            "analytics",
            "export-import",
        ],
    )
    .unwrap();

    let store = Store::new(&conn);
    let loaded = store.load_features().unwrap();
    assert!(loaded.count() >= 20);
    assert!(loaded.is_enabled(oz_core::Feature::SimpleRetail));
    assert!(loaded.is_enabled(oz_core::Feature::Analytics));

    // Prune should be a no-op since all features match.
    let removed = Settings::prune_stale_features(&conn, &loaded).unwrap();
    assert_eq!(removed, 0);
}

#[test]
fn complete_setup_allows_multiple_calls() {
    let conn = fresh_conn();

    // First call with simple-retail.
    run_complete_setup(
        &conn,
        "simple-retail",
        &["cash-payment", "barcode-scanning", "receipt-printing"],
    )
    .unwrap();

    // Second call overwrites with restaurant (pruning handles cleanup).
    run_complete_setup(
        &conn,
        "restaurant",
        &[
            "restaurant",
            "cash-payment",
            "kitchen-display",
            "table-management",
            "staff-login",
        ],
    )
    .unwrap();

    // Preset was overwritten.
    let preset = Settings::get(&conn, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "restaurant");

    // Features should be from restaurant, not simple-retail.
    let store = Store::new(&conn);
    let loaded = store.load_features().unwrap();
    assert!(loaded.is_enabled(oz_core::Feature::Restaurant));
    assert!(!loaded.is_enabled(oz_core::Feature::SimpleRetail));
}

#[test]
fn complete_setup_persists_all_settings() {
    let conn = fresh_conn();

    run_complete_setup(
        &conn,
        "simple-retail",
        &["cash-payment", "receipt-printing"],
    )
    .unwrap();

    // Verify DB state directly.
    let complete = Settings::get(&conn, oz_core::settings::keys::SETUP_COMPLETE)
        .unwrap()
        .unwrap();
    assert_eq!(complete, "1");

    let preset = Settings::get(&conn, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "simple-retail");

    // Feature flags.
    let cash = Settings::get(&conn, "feature.cash-payment")
        .unwrap()
        .unwrap();
    assert_eq!(cash, "1");
    let receipt = Settings::get(&conn, "feature.receipt-printing")
        .unwrap()
        .unwrap();
    assert_eq!(receipt, "1");

    // Unknown feature should NOT be present.
    assert_eq!(Settings::get(&conn, "feature.card-payment").unwrap(), None);
}

#[test]
fn complete_setup_without_transaction_leaves_partial_state() {
    let conn = fresh_conn();

    // Run a successful setup first.
    run_complete_setup(&conn, "simple-retail", &["cash-payment"]).unwrap();

    // Write feature rows, preset (but NOT setup_complete) outside a
    // transaction, simulating a crash halfway through.
    {
        let mut registry = FeatureRegistry::new();
        registry.enable(oz_core::Feature::CardPayment);

        let store = Store::new(&conn);
        store.save_features(&registry).unwrap();
        Settings::prune_stale_features(&conn, &registry).unwrap();
        Settings::set(&conn, oz_core::settings::keys::STORE_PRESET, "broken").unwrap();
        // Crashing here — setup_complete is NOT written.
    }

    // setup_complete is still "1" from the first call because the
    // second attempt crashed before writing it.
    let complete = Settings::get(&conn, oz_core::settings::keys::SETUP_COMPLETE)
        .unwrap()
        .unwrap();
    assert_eq!(complete, "1");

    // preset was written (outside a transaction, so visible despite crash).
    let preset = Settings::get(&conn, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "broken");
}

#[test]
fn complete_setup_twice_preserves_latest() {
    let conn = fresh_conn();

    // Run setup twice with different presets.
    run_complete_setup(&conn, "first", &["cash-payment", "barcode-scanning"]).unwrap();

    run_complete_setup(
        &conn,
        "second",
        &["restaurant", "cash-payment", "kitchen-display"],
    )
    .unwrap();

    // Second setup's results are in effect.
    let preset = Settings::get(&conn, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "second");

    let store = Store::new(&conn);
    let loaded = store.load_features().unwrap();
    assert!(loaded.is_enabled(oz_core::Feature::Restaurant));
    assert!(loaded.is_enabled(oz_core::Feature::KitchenDisplay));
    assert!(!loaded.is_enabled(oz_core::Feature::BarcodeScanning));
    assert!(!loaded.is_enabled(oz_core::Feature::SimpleRetail));
}

// ── show_setup_wizard tests ─────────────────────────────────────

#[test]
fn show_setup_wizard_defaults_to_true() {
    let conn = fresh_conn();
    let val = Settings::get(&conn, oz_core::settings::keys::SHOW_SETUP_WIZARD).unwrap();
    assert_eq!(val, None, "absent means show wizard");
}

#[test]
fn show_setup_wizard_is_false_after_complete_setup() {
    let conn = fresh_conn();
    run_complete_setup(&conn, "restaurant", &["cash-payment"]).unwrap();
    let val = Settings::get(&conn, oz_core::settings::keys::SHOW_SETUP_WIZARD)
        .unwrap()
        .unwrap();
    assert_eq!(val, "false");
}

#[test]
fn show_setup_wizard_is_false_after_dismiss() {
    let conn = fresh_conn();
    Settings::set(&conn, oz_core::settings::keys::SHOW_SETUP_WIZARD, "false").unwrap();
    let val = Settings::get(&conn, oz_core::settings::keys::SHOW_SETUP_WIZARD)
        .unwrap()
        .unwrap();
    assert_eq!(val, "false");
}

#[test]
fn get_setup_status_returns_completed_when_wizard_dismissed() {
    let conn = fresh_conn();
    Settings::set(&conn, oz_core::settings::keys::SHOW_SETUP_WIZARD, "false").unwrap();
    let completed = Settings::get(&conn, oz_core::settings::keys::SHOW_SETUP_WIZARD)
        .unwrap()
        .map(|v| v == "false")
        .unwrap_or(false);
    assert!(completed);
}

#[test]
fn get_setup_status_returns_not_completed_when_key_absent() {
    let conn = fresh_conn();
    let completed = Settings::get(&conn, oz_core::settings::keys::SHOW_SETUP_WIZARD)
        .unwrap()
        .map(|v| v == "false")
        .unwrap_or(false);
    assert!(!completed, "absent key means not completed");
}

// ── DTO struct tests ──────────────────────────────────────────

#[test]
fn complete_setup_args_deserialize() {
    let json = r#"{"preset":"simple-retail","features":["cash-payment","receipt-printing"]}"#;
    let args: CompleteSetupArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.preset, "simple-retail");
    assert_eq!(args.features.len(), 2);
    assert_eq!(args.features[0], "cash-payment");
}

/// The exact shape `SetupWizard.tsx` builds and `TabletAppShell.tsx`
/// forwards — all three keys, currency included — driven end to end.
///
/// This is the case that was missing: nothing in this file named
/// `default_currency`, so the wizard currency could be (and was) dropped
/// on tablet without a single red test. It reads a currency no fallback
/// could produce, so it fails both if the shared struct loses the field and
/// if `write_setup` stops writing the row.
#[test]
fn complete_setup_currency_survives_the_wizard_payload() {
    let json = r#"{"preset":"simple-retail","features":["cash-payment","tax-engine"],"default_currency":"USD"}"#;
    let args: CompleteSetupArgs = serde_json::from_str(json).unwrap();

    // 1. The field survives deserialisation — the local copy had no such
    // field, and serde ignores unknown keys rather than rejecting them.
    assert_eq!(
        args.default_currency, "USD",
        "the currency the wizard collected was dropped by deserialisation"
    );

    // 2. It reaches the row the command writes.
    let conn = fresh_conn();
    run_complete_setup_args(&conn, &args).unwrap();
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap().as_deref(),
        Some("USD"),
        "complete_setup did not persist the currency to `currency.default`"
    );
}

/// An older client that sends no `default_currency` keeps working: the
/// shared struct supplies its `#[serde(default)]` fallback and that is what
/// lands in the row.
#[test]
fn complete_setup_currency_falls_back_when_key_absent() {
    let args: CompleteSetupArgs =
        serde_json::from_str(r#"{"preset":"simple-retail","features":["cash-payment"]}"#).unwrap();
    assert_eq!(args.default_currency, "IDR");

    let conn = fresh_conn();
    run_complete_setup_args(&conn, &args).unwrap();
    assert_eq!(
        Settings::get_default_currency(&conn).unwrap().as_deref(),
        Some("IDR")
    );
}

#[test]
fn complete_setup_args_debug() {
    let args = CompleteSetupArgs {
        preset: "restaurant".into(),
        features: vec!["cash-payment".into()],
        default_currency: "IDR".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("restaurant"));
    assert!(d.contains("cash-payment"));
}

#[test]
fn setup_status_debug() {
    let status = SetupStatus {
        completed: true,
        preset: Some("simple-retail".into()),
    };
    let d = format!("{status:?}");
    assert!(d.contains("simple-retail"));
}

#[test]
fn setup_status_serialize() {
    let status = SetupStatus {
        completed: false,
        preset: None,
    };
    let json = serde_json::to_value(&status).unwrap();
    assert!(!json["completed"].as_bool().unwrap());
    assert!(json["preset"].is_null());
}

#[test]
fn setup_status_serialize_with_preset() {
    let status = SetupStatus {
        completed: true,
        preset: Some("restaurant".into()),
    };
    let json = serde_json::to_value(&status).unwrap();
    assert!(json["completed"].as_bool().unwrap());
    assert_eq!(json["preset"], "restaurant");
}

#[test]
fn enabled_features_result_debug() {
    let result = EnabledFeaturesResult {
        features: vec!["cash-payment".into(), "tax-engine".into()],
    };
    let d = format!("{result:?}");
    assert!(d.contains("cash-payment"));
    assert!(d.contains("tax-engine"));
}

#[test]
fn enabled_features_result_serialize() {
    let result = EnabledFeaturesResult {
        features: vec!["barcode-scanning".into()],
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["features"][0], "barcode-scanning");
    assert_eq!(json["features"].as_array().unwrap().len(), 1);
}
