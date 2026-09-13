use super::*;
use crate::testing::TestBridge;
use oz_core::migrations;
use rusqlite::Connection;

/// Create a fresh in-memory connection with migrations applied.
fn fresh_conn() -> Connection {
    migrations::fresh_db()
}

/// Run the bridge `complete_setup` command over the harness context.
///
/// The desktop sibling re-implemented the operation list on a plain
/// `&Connection` because the Tauri command needed a runtime; the relocated
/// tests drive the real bridge command body end to end instead.
async fn run_complete_setup(
    tb: &TestBridge,
    preset: &str,
    features: &[&str],
) -> Result<(), BridgeError> {
    let args = CompleteSetupArgs {
        preset: preset.to_string(),
        features: features.iter().map(|&key| key.to_string()).collect(),
        default_currency: "IDR".to_string(),
    };
    complete_setup(&tb.ctx(), args).await
}

#[tokio::test]
async fn complete_setup_persists_features() {
    let tb = TestBridge::new();

    run_complete_setup(
        &tb,
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
    .await
    .unwrap();

    let ctx = tb.ctx();
    let db = ctx.lock_global().await;

    // Verify setup is marked complete.
    let completed = Settings::get(&db, oz_core::settings::keys::SETUP_COMPLETE)
        .unwrap()
        .unwrap();
    assert_eq!(completed, "1");

    let preset = Settings::get(&db, oz_core::settings::keys::STORE_PRESET)
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

#[tokio::test]
async fn complete_setup_skips_unknown_features() {
    let tb = TestBridge::new();

    run_complete_setup(
        &tb,
        "custom",
        &["cash-payment", "made-up-feature"], // unknown, should be skipped
    )
    .await
    .unwrap();

    let ctx = tb.ctx();
    let db = ctx.lock_global().await;

    // Should still succeed.
    let completed = Settings::get(&db, oz_core::settings::keys::SETUP_COMPLETE)
        .unwrap()
        .unwrap();
    assert_eq!(completed, "1");

    // Only cash-payment should be enabled.
    let store = Store::new(&db);
    let loaded = store.load_features().unwrap();
    assert!(loaded.is_enabled(oz_core::Feature::CashPayment));
    assert!(!loaded.is_enabled(oz_core::Feature::BarcodeScanning));
}

#[tokio::test]
async fn complete_setup_empty_features() {
    let tb = TestBridge::new();

    run_complete_setup(&tb, "empty-store", &[]).await.unwrap();

    let ctx = tb.ctx();
    let db = ctx.lock_global().await;

    let completed = Settings::get(&db, oz_core::settings::keys::SETUP_COMPLETE)
        .unwrap()
        .unwrap();
    assert_eq!(completed, "1");

    let preset = Settings::get(&db, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "empty-store");

    // No features should be enabled.
    let store = Store::new(&db);
    let loaded = store.load_features().unwrap();
    assert_eq!(loaded.count(), 0);
}

#[tokio::test]
async fn complete_setup_with_different_presets() {
    let tb = TestBridge::new();

    // Test restaurant preset.
    run_complete_setup(
        &tb,
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
    .await
    .unwrap();

    let ctx = tb.ctx();
    let db = ctx.lock_global().await;

    let completed = Settings::get(&db, oz_core::settings::keys::SETUP_COMPLETE)
        .unwrap()
        .unwrap();
    assert_eq!(completed, "1");

    let preset = Settings::get(&db, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "restaurant");

    // Verify restaurant-specific features.
    let store = Store::new(&db);
    let loaded = store.load_features().unwrap();
    assert!(loaded.is_enabled(oz_core::Feature::Restaurant));
    assert!(loaded.is_enabled(oz_core::Feature::KitchenDisplay));
    assert!(loaded.is_enabled(oz_core::Feature::TableManagement));
    assert!(loaded.is_enabled(oz_core::Feature::StaffLogin));
    assert!(!loaded.is_enabled(oz_core::Feature::SimpleRetail));
    assert!(!loaded.is_enabled(oz_core::Feature::CardPayment));
}

#[tokio::test]
async fn complete_setup_all_features_single_preset() {
    let tb = TestBridge::new();

    // Full-store preset: 24 feature keys.
    run_complete_setup(
        &tb,
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
    .await
    .unwrap();

    let ctx = tb.ctx();
    let db = ctx.lock_global().await;

    let store = Store::new(&db);
    let loaded = store.load_features().unwrap();
    assert!(loaded.count() >= 20);
    assert!(loaded.is_enabled(oz_core::Feature::SimpleRetail));
    assert!(loaded.is_enabled(oz_core::Feature::Analytics));

    // Prune should be a no-op since all features match.
    let removed = Settings::prune_stale_features(&db, &loaded).unwrap();
    assert_eq!(removed, 0);
}

#[tokio::test]
async fn complete_setup_allows_multiple_calls() {
    let tb = TestBridge::new();

    // First call with simple-retail.
    run_complete_setup(
        &tb,
        "simple-retail",
        &["cash-payment", "barcode-scanning", "receipt-printing"],
    )
    .await
    .unwrap();

    // Second call overwrites with restaurant (pruning handles cleanup).
    run_complete_setup(
        &tb,
        "restaurant",
        &[
            "restaurant",
            "cash-payment",
            "kitchen-display",
            "table-management",
            "staff-login",
        ],
    )
    .await
    .unwrap();

    let ctx = tb.ctx();
    let db = ctx.lock_global().await;

    // Preset was overwritten.
    let preset = Settings::get(&db, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "restaurant");

    // Features should be from restaurant, not simple-retail.
    let store = Store::new(&db);
    let loaded = store.load_features().unwrap();
    assert!(loaded.is_enabled(oz_core::Feature::Restaurant));
    assert!(!loaded.is_enabled(oz_core::Feature::SimpleRetail));
}

#[test]
fn complete_setup_args_deserialize() {
    let json = r##"{"preset":"simple-retail","features":["cash-payment","receipt-printing"]}"##;
    let args: CompleteSetupArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.preset, "simple-retail");
    assert_eq!(args.features.len(), 2);
}

#[test]
fn complete_setup_args_debug() {
    let args = CompleteSetupArgs {
        preset: "custom".into(),
        features: vec![],
        default_currency: "IDR".into(),
    };
    let d = format!("{args:?}");
    assert!(d.contains("custom"));
}

#[test]
fn setup_status_serialize() {
    let status = SetupStatus {
        completed: true,
        preset: Some("restaurant".into()),
    };
    let json = serde_json::to_value(&status).unwrap();
    assert_eq!(json["completed"], true);
    assert_eq!(json["preset"], "restaurant");
}

#[test]
fn setup_status_serialize_not_completed() {
    let status = SetupStatus {
        completed: false,
        preset: None,
    };
    let json = serde_json::to_value(&status).unwrap();
    assert_eq!(json["completed"], false);
    assert!(json["preset"].is_null());
}

#[test]
fn setup_status_debug() {
    let status = SetupStatus {
        completed: false,
        preset: None,
    };
    let d = format!("{status:?}");
    assert!(d.contains("false"));
}

#[test]
fn enabled_features_result_serialize() {
    let result = EnabledFeaturesResult {
        features: vec!["cash-payment".into(), "barcode-scanning".into()],
    };
    let json = serde_json::to_value(&result).unwrap();
    let arr = json["features"].as_array().unwrap();
    assert_eq!(arr.len(), 2);
}

#[test]
fn enabled_features_result_debug() {
    let result = EnabledFeaturesResult {
        features: vec!["tax-engine".into()],
    };
    let d = format!("{result:?}");
    assert!(d.contains("tax-engine"));
}

#[tokio::test]
async fn complete_setup_persists_all_settings() {
    let tb = TestBridge::new();

    run_complete_setup(&tb, "simple-retail", &["cash-payment", "receipt-printing"])
        .await
        .unwrap();

    let ctx = tb.ctx();
    let db = ctx.lock_global().await;

    // Verify DB state directly.
    let complete = Settings::get(&db, oz_core::settings::keys::SETUP_COMPLETE)
        .unwrap()
        .unwrap();
    assert_eq!(complete, "1");

    let preset = Settings::get(&db, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "simple-retail");

    // Feature flags.
    let cash = Settings::get(&db, "feature.cash-payment").unwrap().unwrap();
    assert_eq!(cash, "1");
    let receipt = Settings::get(&db, "feature.receipt-printing")
        .unwrap()
        .unwrap();
    assert_eq!(receipt, "1");

    // Unknown feature should NOT be present.
    assert_eq!(Settings::get(&db, "feature.card-payment").unwrap(), None);
}

#[tokio::test]
async fn complete_setup_without_transaction_leaves_partial_state() {
    let tb = TestBridge::new();

    // Run a successful setup first.
    run_complete_setup(&tb, "simple-retail", &["cash-payment"])
        .await
        .unwrap();

    let ctx = tb.ctx();
    let db = ctx.lock_global().await;

    // Write feature rows, preset (but NOT setup_complete) outside a
    // transaction, simulating a crash halfway through.
    {
        let mut registry = FeatureRegistry::new();
        registry.enable(oz_core::Feature::CardPayment);

        let store = Store::new(&db);
        store.save_features(&registry).unwrap();
        Settings::prune_stale_features(&db, &registry).unwrap();
        Settings::set(&db, oz_core::settings::keys::STORE_PRESET, "broken").unwrap();
        // Crashing here — setup_complete is NOT written.
    }

    // setup_complete is still "1" from the first call because the
    // second attempt crashed before writing it.
    let complete = Settings::get(&db, oz_core::settings::keys::SETUP_COMPLETE)
        .unwrap()
        .unwrap();
    assert_eq!(complete, "1");

    // preset was written (outside a transaction, so visible despite crash).
    let preset = Settings::get(&db, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "broken");
}

#[tokio::test]
async fn complete_setup_twice_preserves_latest() {
    let tb = TestBridge::new();

    // Run setup twice with different presets.
    run_complete_setup(&tb, "first", &["cash-payment", "barcode-scanning"])
        .await
        .unwrap();

    run_complete_setup(
        &tb,
        "second",
        &["restaurant", "cash-payment", "kitchen-display"],
    )
    .await
    .unwrap();

    let ctx = tb.ctx();
    let db = ctx.lock_global().await;

    // Second setup's results are in effect.
    let preset = Settings::get(&db, oz_core::settings::keys::STORE_PRESET)
        .unwrap()
        .unwrap();
    assert_eq!(preset, "second");

    let store = Store::new(&db);
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
    // No setup ran → key should be absent (defaults to true/show).
    let val = Settings::get(&conn, oz_core::settings::keys::SHOW_SETUP_WIZARD).unwrap();
    assert_eq!(val, None, "absent means show wizard");
}

#[tokio::test]
async fn show_setup_wizard_is_false_after_complete_setup() {
    let tb = TestBridge::new();

    run_complete_setup(&tb, "restaurant", &["cash-payment"])
        .await
        .unwrap();

    let ctx = tb.ctx();
    let db = ctx.lock_global().await;
    let val = Settings::get(&db, oz_core::settings::keys::SHOW_SETUP_WIZARD)
        .unwrap()
        .unwrap();
    assert_eq!(val, "false");
}

#[tokio::test]
async fn show_setup_wizard_is_false_after_dismiss() {
    let tb = TestBridge::new();

    dismiss_setup_wizard(&tb.ctx()).await.unwrap();

    let ctx = tb.ctx();
    let db = ctx.lock_global().await;
    let val = Settings::get(&db, oz_core::settings::keys::SHOW_SETUP_WIZARD)
        .unwrap()
        .unwrap();
    assert_eq!(val, "false");
}

#[tokio::test]
async fn get_setup_status_returns_completed_when_wizard_dismissed() {
    let tb = TestBridge::new();

    dismiss_setup_wizard(&tb.ctx()).await.unwrap();

    let raw = {
        let ctx = tb.ctx();
        let db = ctx.lock_global().await;
        Settings::get(&db, oz_core::settings::keys::SHOW_SETUP_WIZARD)
            .unwrap()
            .unwrap()
    };
    assert_eq!(raw, "false");

    let status = get_setup_status(&tb.ctx()).await.unwrap();
    assert!(status.completed);
}

#[tokio::test]
async fn get_setup_status_returns_not_completed_when_key_absent() {
    let tb = TestBridge::new();

    let status = get_setup_status(&tb.ctx()).await.unwrap();
    assert!(!status.completed, "absent key means not completed");
}

// ── Token rejection test ──────────────────────────────

#[test]
fn setup_scoped_rejects_invalid_token() {
    let tb = TestBridge::new();
    let ctx = tb.ctx();
    let result = ctx.resolve_session("nonexistent-token");
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}
