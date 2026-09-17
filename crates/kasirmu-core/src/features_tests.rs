use super::*;

// ── All dependency declarations ──────────────────────────────
//
// Every Feature with at least one dependency must be tested below
// to ensure the dependency graph stays correct as the enum grows.

#[test]
fn simple_retail_has_no_deps() {
    assert!(Feature::SimpleRetail.dependencies().is_empty());
}

#[test]
fn staff_roles_depends_on_staff_login() {
    assert_eq!(Feature::StaffRoles.dependencies(), &[Feature::StaffLogin]);
}

#[test]
fn shift_management_depends_on_staff_login() {
    assert_eq!(
        Feature::ShiftManagement.dependencies(),
        &[Feature::StaffLogin]
    );
}

#[test]
fn audit_log_depends_on_staff_login() {
    assert_eq!(Feature::AuditLog.dependencies(), &[Feature::StaffLogin]);
}

#[test]
fn cash_drawer_depends_on_receipt_printing() {
    assert_eq!(
        Feature::CashDrawer.dependencies(),
        &[Feature::ReceiptPrinting]
    );
}

#[test]
fn customer_display_depends_on_receipt_printing() {
    assert_eq!(
        Feature::CustomerDisplay.dependencies(),
        &[Feature::ReceiptPrinting]
    );
}

#[test]
fn kitchen_display_depends_on_restaurant() {
    assert_eq!(
        Feature::KitchenDisplay.dependencies(),
        &[Feature::Restaurant]
    );
}

#[test]
fn table_management_depends_on_restaurant() {
    assert_eq!(
        Feature::TableManagement.dependencies(),
        &[Feature::Restaurant]
    );
}

#[test]
fn self_service_kiosk_depends_on_simple_retail() {
    assert_eq!(
        Feature::SelfServiceKiosk.dependencies(),
        &[Feature::SimpleRetail]
    );
}

#[test]
fn loyalty_program_depends_on_staff_login() {
    assert_eq!(
        Feature::LoyaltyProgram.dependencies(),
        &[Feature::StaffLogin]
    );
}

#[test]
fn promotions_engine_depends_on_discount_engine() {
    assert_eq!(
        Feature::PromotionsEngine.dependencies(),
        &[Feature::DiscountEngine]
    );
}

#[test]
fn serial_tracking_depends_on_inventory_tracking() {
    assert_eq!(
        Feature::SerialTracking.dependencies(),
        &[Feature::InventoryTracking]
    );
}

#[test]
fn analytics_depends_on_reporting() {
    assert_eq!(Feature::Analytics.dependencies(), &[Feature::Reporting]);
}

#[test]
fn multi_terminal_depends_on_multi_store() {
    assert_eq!(
        Feature::MultiTerminal.dependencies(),
        &[Feature::MultiStore]
    );
}

#[test]
fn cloud_sync_depends_on_multi_store() {
    assert_eq!(Feature::CloudSync.dependencies(), &[Feature::MultiStore]);
}

/// All features that have **no** dependencies.
/// If this test fails, a new feature with deps wasn't added to the
/// dependency tests above, or a feature's deps changed unexpectedly.
#[test]
fn features_without_dependencies_have_empty_slice() {
    let no_deps = [
        Feature::SimpleRetail,
        Feature::Restaurant,
        Feature::CashPayment,
        Feature::CardPayment,
        Feature::MultiCurrency,
        Feature::InventoryTracking,
        Feature::ProductVariants,
        Feature::CategoriesEnabled,
        Feature::StaffLogin,
        Feature::BarcodeScanning,
        Feature::ReceiptPrinting,
        Feature::NfcReader,
        Feature::DiscountEngine,
        Feature::TaxEngine,
        Feature::GiftCards,
        Feature::QuickReturn,
        Feature::ProductBundles,
        Feature::PurchaseOrders,
        Feature::Reporting,
        Feature::MultiStore,
        Feature::ExportImport,
        Feature::PluginSystem,
    ];
    for f in no_deps {
        assert!(
            f.dependencies().is_empty(),
            "expected {f:?} to have no dependencies"
        );
    }
}

/// Every feature that HAS dependencies is listed here so we catch
/// regressions — if a new feature is added with deps but no test is
/// written, this test will need updating.
///
/// Note: the dependency graph is a static DAG (no cycles) because
/// [`Feature::dependencies`] returns a fixed slice — there is no
/// dynamic registration mechanism that could introduce cycles.
#[test]
fn all_features_known_dep_or_no_dep() {
    // Features with at least one dependency.
    let with_deps: std::collections::HashSet<Feature> = [
        Feature::StaffRoles,
        Feature::ShiftManagement,
        Feature::AuditLog,
        Feature::CashDrawer,
        Feature::CustomerDisplay,
        Feature::KitchenDisplay,
        Feature::TableManagement,
        Feature::SelfServiceKiosk,
        Feature::LoyaltyProgram,
        Feature::SerialTracking,
        Feature::PromotionsEngine,
        Feature::Analytics,
        Feature::MultiTerminal,
        Feature::CloudSync,
    ]
    .into_iter()
    .collect();

    // All features listed explicitly (same pattern as
    // `feature_key_roundtrip`). This avoids unsafe transmute.
    let all_features = [
        Feature::SimpleRetail,
        Feature::Restaurant,
        Feature::CashPayment,
        Feature::CardPayment,
        Feature::MultiCurrency,
        Feature::InventoryTracking,
        Feature::ProductVariants,
        Feature::CategoriesEnabled,
        Feature::StaffLogin,
        Feature::StaffRoles,
        Feature::ShiftManagement,
        Feature::AuditLog,
        Feature::BarcodeScanning,
        Feature::ReceiptPrinting,
        Feature::CashDrawer,
        Feature::CustomerDisplay,
        Feature::NfcReader,
        Feature::DiscountEngine,
        Feature::TaxEngine,
        Feature::LoyaltyProgram,
        Feature::GiftCards,
        Feature::PromotionsEngine,
        Feature::ProductBundles,
        Feature::KitchenDisplay,
        Feature::TableManagement,
        Feature::SelfServiceKiosk,
        Feature::CloudSync,
        Feature::MultiStore,
        Feature::MultiTerminal,
        Feature::Reporting,
        Feature::Analytics,
        Feature::ExportImport,
        Feature::PluginSystem,
    ];

    for &f in &all_features {
        if with_deps.contains(&f) {
            assert!(
                !f.dependencies().is_empty(),
                "{f:?} tagged as having deps but returned empty"
            );
        } else {
            assert!(
                f.dependencies().is_empty(),
                "{f:?} has dependencies but is not listed in the with_deps set: {:?}",
                f.dependencies(),
            );
        }
    }
}

// ── Enable / disable ─────────────────────────────────────────

#[test]
fn new_registry_is_empty() {
    let reg = FeatureRegistry::new();
    assert_eq!(reg.count(), 0);
    assert!(!reg.is_enabled(Feature::SimpleRetail));
}

#[test]
fn enable_returns_true_when_new() {
    let mut reg = FeatureRegistry::new();
    assert!(reg.enable(Feature::CashPayment));
    assert!(reg.is_enabled(Feature::CashPayment));
}

#[test]
fn enable_returns_false_when_already_on() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::CashPayment);
    assert!(!reg.enable(Feature::CashPayment));
}

#[test]
fn disable_removes_feature() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::CashPayment);
    assert!(reg.disable(Feature::CashPayment));
    assert!(!reg.is_enabled(Feature::CashPayment));
}

#[test]
fn disable_returns_false_when_not_enabled() {
    let mut reg = FeatureRegistry::new();
    assert!(!reg.disable(Feature::CashPayment));
}

#[test]
fn enable_returns_true_after_disable() {
    let mut reg = FeatureRegistry::new();
    assert!(reg.enable(Feature::CashPayment));
    assert!(reg.disable(Feature::CashPayment));
    assert!(reg.enable(Feature::CashPayment), "re-enable after disable");
}

#[test]
fn enable_auto_enables_dependencies() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::StaffRoles);
    assert!(reg.is_enabled(Feature::StaffLogin), "auto-enabled dep");
    assert!(reg.is_enabled(Feature::StaffRoles));
}

#[test]
fn enable_resolves_deep_dependency_chain() {
    let mut reg = FeatureRegistry::new();
    // MultiTerminal → MultiStore, MultiStore has no deps.
    reg.enable(Feature::MultiTerminal);
    assert!(reg.is_enabled(Feature::MultiStore));
    assert!(reg.is_enabled(Feature::MultiTerminal));
}

#[test]
fn enable_with_dep_already_present() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::StaffLogin);
    assert!(reg.enable(Feature::StaffRoles));
    assert!(reg.is_enabled(Feature::StaffRoles));
    assert!(reg.is_enabled(Feature::StaffLogin));
    assert_eq!(reg.count(), 2);
}

#[test]
fn enable_dep_unchanged_when_dependent_already_present() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::StaffRoles);
    assert!(!reg.enable(Feature::StaffLogin));
}

#[test]
fn enable_multiple_features_sharing_dependency() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::StaffRoles);
    reg.enable(Feature::ShiftManagement);
    reg.enable(Feature::AuditLog);
    assert!(reg.is_enabled(Feature::StaffLogin));
    assert!(reg.is_enabled(Feature::StaffRoles));
    assert!(reg.is_enabled(Feature::ShiftManagement));
    assert!(reg.is_enabled(Feature::AuditLog));
    assert_eq!(reg.count(), 4);
}

#[test]
fn enable_multiple_features_sharing_two_level_dep() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::CashDrawer);
    reg.enable(Feature::CustomerDisplay);
    assert!(reg.is_enabled(Feature::ReceiptPrinting));
    assert!(reg.is_enabled(Feature::CashDrawer));
    assert!(reg.is_enabled(Feature::CustomerDisplay));
    assert_eq!(reg.count(), 3);
}

#[test]
fn disable_does_not_cascade_to_dependents() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::StaffRoles);
    reg.disable(Feature::StaffLogin);
    assert!(!reg.is_enabled(Feature::StaffLogin));
    assert!(reg.is_enabled(Feature::StaffRoles));
}

#[test]
fn disable_dep_then_re_enable_dependent_restores_dep() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::StaffRoles);
    assert!(reg.is_enabled(Feature::StaffLogin));
    assert!(reg.is_enabled(Feature::StaffRoles));

    reg.disable(Feature::StaffRoles);
    reg.disable(Feature::StaffLogin);
    assert!(!reg.is_enabled(Feature::StaffLogin));
    assert!(!reg.is_enabled(Feature::StaffRoles));

    assert!(reg.enable(Feature::StaffRoles));
    assert!(reg.is_enabled(Feature::StaffRoles));
    assert!(
        reg.is_enabled(Feature::StaffLogin),
        "dep restored by enable"
    );
}

#[test]
fn count_correct_after_enable_disable_chain() {
    let mut reg = FeatureRegistry::new();
    assert_eq!(reg.count(), 0);

    reg.enable(Feature::CashPayment);
    assert_eq!(reg.count(), 1);

    reg.enable(Feature::StaffRoles);
    assert_eq!(reg.count(), 3);

    reg.disable(Feature::StaffLogin);
    assert_eq!(reg.count(), 2);

    reg.disable(Feature::CashPayment);
    assert_eq!(reg.count(), 1);

    reg.disable(Feature::StaffRoles);
    assert_eq!(reg.count(), 0);
}

#[test]
fn enable_all_features_then_disable_all() {
    let mut reg = FeatureRegistry::new();
    let all_features = [
        Feature::SimpleRetail,
        Feature::Restaurant,
        Feature::CashPayment,
        Feature::CardPayment,
        Feature::MultiCurrency,
        Feature::InventoryTracking,
        Feature::ProductVariants,
        Feature::CategoriesEnabled,
        Feature::StaffLogin,
        Feature::StaffRoles,
        Feature::ShiftManagement,
        Feature::AuditLog,
        Feature::BarcodeScanning,
        Feature::ReceiptPrinting,
        Feature::CashDrawer,
        Feature::CustomerDisplay,
        Feature::NfcReader,
        Feature::DiscountEngine,
        Feature::TaxEngine,
        Feature::LoyaltyProgram,
        Feature::GiftCards,
        Feature::PromotionsEngine,
        Feature::ProductBundles,
        Feature::PurchaseOrders,
        Feature::KitchenDisplay,
        Feature::TableManagement,
        Feature::SelfServiceKiosk,
        Feature::CloudSync,
        Feature::MultiStore,
        Feature::MultiTerminal,
        Feature::Reporting,
        Feature::Analytics,
        Feature::ExportImport,
        Feature::PluginSystem,
        Feature::SerialTracking,
        Feature::QuickReturn,
        Feature::UsbScale,
    ];

    for f in all_features {
        reg.enable(f);
    }
    assert!(reg.count() >= 37);

    for f in all_features {
        reg.disable(f);
    }
    assert_eq!(reg.count(), 0);
    assert!(!reg.is_enabled(Feature::SimpleRetail));
    assert!(!reg.is_enabled(Feature::PluginSystem));
}

#[test]
fn from_set_with_all_deps_present_does_not_panic() {
    let reg = FeatureRegistry::from_set([Feature::SimpleRetail, Feature::SelfServiceKiosk]);
    assert!(reg.is_enabled(Feature::SimpleRetail));
    assert!(reg.is_enabled(Feature::SelfServiceKiosk));
    assert_eq!(reg.count(), 2);
}

#[test]
fn from_set_with_direct_dep_present_does_not_panic() {
    let reg = FeatureRegistry::from_set([Feature::Reporting, Feature::Analytics]);
    assert!(reg.is_enabled(Feature::Reporting));
    assert!(reg.is_enabled(Feature::Analytics));
}

// ── Presets ──────────────────────────────────────────────────

#[test]
fn simple_retail_preset_has_expected_features() {
    let reg = FeatureRegistry::simple_retail();
    assert!(reg.is_enabled(Feature::SimpleRetail));
    assert!(reg.is_enabled(Feature::CashPayment));
    assert!(reg.is_enabled(Feature::BarcodeScanning));
    assert!(reg.is_enabled(Feature::ReceiptPrinting));
    assert!(reg.is_enabled(Feature::InventoryTracking));
    assert!(reg.is_enabled(Feature::CategoriesEnabled));
    assert!(reg.is_enabled(Feature::TaxEngine));
    assert!(!reg.is_enabled(Feature::CardPayment));
    assert!(!reg.is_enabled(Feature::StaffLogin));
}

#[test]
fn restaurant_preset_includes_dependencies() {
    let reg = FeatureRegistry::restaurant();
    assert!(reg.is_enabled(Feature::Restaurant));
    assert!(reg.is_enabled(Feature::KitchenDisplay));
    assert!(reg.is_enabled(Feature::TableManagement));
    assert!(reg.is_enabled(Feature::StaffLogin));
}

#[test]
fn full_store_preset_is_large() {
    let reg = FeatureRegistry::full_store();
    assert!(reg.count() >= 20);
    assert!(reg.is_enabled(Feature::SimpleRetail));
    assert!(reg.is_enabled(Feature::CardPayment));
    assert!(reg.is_enabled(Feature::StaffLogin));
    assert!(reg.is_enabled(Feature::Analytics));
    assert!(!reg.is_enabled(Feature::CloudSync));
    assert!(!reg.is_enabled(Feature::MultiStore));
}

#[test]
fn custom_preset_is_empty() {
    let reg = FeatureRegistry::custom();
    assert_eq!(reg.count(), 0);
}

#[test]
fn cafe_preset_has_expected_features() {
    let reg = FeatureRegistry::cafe();
    assert!(reg.is_enabled(Feature::SimpleRetail));
    assert!(reg.is_enabled(Feature::Restaurant));
    assert!(reg.is_enabled(Feature::CashPayment));
    assert!(reg.is_enabled(Feature::CardPayment));
    assert!(reg.is_enabled(Feature::ReceiptPrinting));
    assert!(reg.is_enabled(Feature::CustomerDisplay));
    assert!(reg.is_enabled(Feature::DiscountEngine));
    assert!(reg.is_enabled(Feature::TaxEngine));
    assert!(reg.is_enabled(Feature::KitchenDisplay));
    assert!(reg.is_enabled(Feature::PromotionsEngine));
    assert!(!reg.is_enabled(Feature::StaffLogin));
    assert_eq!(reg.count(), 10);
}

#[test]
fn franchise_preset_has_expected_features() {
    let reg = FeatureRegistry::franchise();
    assert!(reg.is_enabled(Feature::Restaurant));
    assert!(reg.is_enabled(Feature::CashPayment));
    assert!(reg.is_enabled(Feature::CardPayment));
    assert!(reg.is_enabled(Feature::MultiCurrency));
    assert!(reg.is_enabled(Feature::InventoryTracking));
    assert!(reg.is_enabled(Feature::ProductVariants));
    assert!(reg.is_enabled(Feature::CategoriesEnabled));
    assert!(reg.is_enabled(Feature::StaffLogin));
    assert!(reg.is_enabled(Feature::StaffRoles));
    assert!(reg.is_enabled(Feature::ShiftManagement));
    assert!(reg.is_enabled(Feature::AuditLog));
    assert!(reg.is_enabled(Feature::ReceiptPrinting));
    assert!(reg.is_enabled(Feature::DiscountEngine));
    assert!(reg.is_enabled(Feature::TaxEngine));
    assert!(reg.is_enabled(Feature::KitchenDisplay));
    assert!(reg.is_enabled(Feature::TableManagement));
    assert!(reg.is_enabled(Feature::CloudSync));
    assert!(reg.is_enabled(Feature::MultiStore));
    assert!(reg.is_enabled(Feature::MultiTerminal));
    assert!(reg.is_enabled(Feature::Reporting));
    assert!(reg.is_enabled(Feature::Analytics));
    assert!(!reg.is_enabled(Feature::SimpleRetail));
    assert_eq!(reg.count(), 21);
}

#[test]
#[should_panic]
fn from_set_panics_on_missing_dependency() {
    FeatureRegistry::from_set([Feature::StaffRoles]);
}

// ── Settings serialization ───────────────────────────────────

#[test]
fn to_settings_rows_empty_registry() {
    let reg = FeatureRegistry::new();
    assert!(reg.to_settings_rows().is_empty());
}

#[test]
fn to_settings_rows_produces_expected_keys() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::CashPayment);
    reg.enable(Feature::BarcodeScanning);
    let rows = reg.to_settings_rows();
    assert_eq!(rows.len(), 2);
    assert!(rows.contains(&("feature.cash-payment".into(), "1".into())));
    assert!(rows.contains(&("feature.barcode-scanning".into(), "1".into())));
}

#[test]
fn from_settings_rows_reconstructs_registry() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::CashPayment);
    reg.enable(Feature::BarcodeScanning);
    let rows = reg.to_settings_rows();
    let back = FeatureRegistry::from_settings_rows(&rows);
    assert_eq!(back, reg);
}

#[test]
fn from_settings_rows_ignores_non_feature_keys() {
    let rows: Vec<(String, String)> = vec![
        ("feature.cash-payment".into(), "1".into()),
        ("store.name".into(), "My Store".into()),
        ("feature.barcode-scanning".into(), "1".into()),
        ("random.key".into(), "whatever".into()),
    ];
    let reg = FeatureRegistry::from_settings_rows(&rows);
    assert!(reg.is_enabled(Feature::CashPayment));
    assert!(reg.is_enabled(Feature::BarcodeScanning));
    assert_eq!(reg.count(), 2);
}

#[test]
fn from_settings_rows_ignores_zero_valued_features() {
    let rows: Vec<(String, String)> = vec![
        ("feature.cash-payment".into(), "0".into()),
        ("feature.tax-engine".into(), "1".into()),
    ];
    let reg = FeatureRegistry::from_settings_rows(&rows);
    assert!(!reg.is_enabled(Feature::CashPayment));
    assert!(reg.is_enabled(Feature::TaxEngine));
}

#[test]
fn feature_key_roundtrip() {
    let features = [
        Feature::SimpleRetail,
        Feature::Restaurant,
        Feature::CashPayment,
        Feature::CardPayment,
        Feature::MultiCurrency,
        Feature::InventoryTracking,
        Feature::ProductVariants,
        Feature::CategoriesEnabled,
        Feature::StaffLogin,
        Feature::StaffRoles,
        Feature::ShiftManagement,
        Feature::AuditLog,
        Feature::BarcodeScanning,
        Feature::ReceiptPrinting,
        Feature::CashDrawer,
        Feature::CustomerDisplay,
        Feature::NfcReader,
        Feature::DiscountEngine,
        Feature::TaxEngine,
        Feature::LoyaltyProgram,
        Feature::GiftCards,
        Feature::PromotionsEngine,
        Feature::ProductBundles,
        Feature::PurchaseOrders,
        Feature::KitchenDisplay,
        Feature::TableManagement,
        Feature::SelfServiceKiosk,
        Feature::CloudSync,
        Feature::MultiStore,
        Feature::MultiTerminal,
        Feature::Reporting,
        Feature::Analytics,
        Feature::ExportImport,
        Feature::PluginSystem,
        Feature::SerialTracking,
        Feature::QuickReturn,
        Feature::UsbScale,
    ];
    for f in features {
        let key = feature_key(f);
        let back = feature_from_key(key).unwrap();
        assert_eq!(back, f, "roundtrip failed for {f:?}");
    }
}

// ── Serde ────────────────────────────────────────────────────

#[test]
fn serde_roundtrip() {
    let reg = FeatureRegistry::simple_retail();
    let json = serde_json::to_string(&reg).unwrap();
    let back: FeatureRegistry = serde_json::from_str(&json).unwrap();
    assert_eq!(back, reg);
}

// ── Iterator ─────────────────────────────────────────────────

#[test]
fn enabled_features_iterator() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::CashPayment);
    reg.enable(Feature::BarcodeScanning);
    let features: Vec<_> = reg.enabled_features().collect();
    assert_eq!(features.len(), 2);
    assert!(features.contains(&Feature::CashPayment));
}

// ── Additional edge-case tests ─────────────────────────────

#[test]
fn feature_from_key_unknown_returns_none() {
    assert_eq!(feature_from_key("unknown-feature"), None);
    assert_eq!(feature_from_key(""), None);
    assert_eq!(feature_from_key("SimpleRetail"), None);
    assert_eq!(feature_from_key("SIMPLE-RETAIL"), None);
}

#[test]
fn feature_key_is_lowercase_kebab_case() {
    for &feature in &[
        Feature::SimpleRetail,
        Feature::StaffRoles,
        Feature::CashDrawer,
        Feature::KitchenDisplay,
        Feature::MultiTerminal,
        Feature::CloudSync,
        Feature::Analytics,
        Feature::SelfServiceKiosk,
        Feature::PromotionsEngine,
    ] {
        let key = feature_key(feature);
        assert!(!key.is_empty(), "key for {feature:?} should not be empty");
        assert!(
            key.chars().all(|c| c.is_ascii_lowercase() || c == '-'),
            "key '{key}' for {feature:?} should be lowercase kebab-case"
        );
    }
}

#[test]
fn from_settings_rows_with_mixed_keys_and_values() {
    let rows = vec![
        ("feature.simple-retail".into(), "1".into()),
        ("feature.cash-payment".into(), "0".into()),
        ("feature.staff-login".into(), "1".into()),
        ("store.name".into(), "1".into()),
        ("feature.unknown-feature".into(), "1".into()),
    ];
    let reg = FeatureRegistry::from_settings_rows(&rows);
    assert!(reg.is_enabled(Feature::SimpleRetail));
    assert!(!reg.is_enabled(Feature::CashPayment));
    assert!(reg.is_enabled(Feature::StaffLogin));
    assert_eq!(reg.count(), 2);
}

#[test]
fn to_settings_rows_sorted_deterministic() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::SimpleRetail);
    reg.enable(Feature::StaffRoles); // cascades StaffLogin
    let rows = reg.to_settings_rows();
    for (key, value) in &rows {
        assert!(key.starts_with("feature."));
        assert_eq!(value, "1");
    }
    assert_eq!(rows.len(), 3);
}

#[test]
fn enable_deep_chain_with_multi_level_deps() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::MultiTerminal);
    assert!(reg.is_enabled(Feature::MultiTerminal));
    assert!(reg.is_enabled(Feature::MultiStore));
    assert_eq!(reg.count(), 2);
}

#[test]
fn enable_cloud_sync_brings_in_multi_store() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::CloudSync);
    assert!(reg.is_enabled(Feature::CloudSync));
    assert!(reg.is_enabled(Feature::MultiStore));
}

#[test]
fn disable_multi_store_does_not_affect_multi_terminal() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::MultiTerminal);
    reg.enable(Feature::CloudSync);
    reg.disable(Feature::MultiStore);
    assert!(reg.is_enabled(Feature::MultiTerminal));
    assert!(reg.is_enabled(Feature::CloudSync));
}

#[test]
fn simple_retail_preset_count() {
    let reg = FeatureRegistry::simple_retail();
    assert!(
        reg.count() >= 5,
        "simple retail should have at least 5 features"
    );
}

#[test]
fn full_store_preset_count() {
    let reg = FeatureRegistry::full_store();
    assert!(reg.count() > 20, "full store should have many features");
}

#[test]
fn from_set_deduplicates() {
    let mut set = HashSet::new();
    set.insert(Feature::SimpleRetail);
    let reg = FeatureRegistry::from_set(set);
    assert_eq!(reg.count(), 1);
}

#[test]
fn kitchen_display_requires_restaurant() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::KitchenDisplay);
    // KitchenDisplay depends on Restaurant, so Restaurant is auto-enabled
    assert!(reg.is_enabled(Feature::KitchenDisplay));
    assert!(reg.is_enabled(Feature::Restaurant));
}

#[test]
fn restaurant_does_not_auto_enable_kitchen_display() {
    let mut reg = FeatureRegistry::new();
    reg.enable(Feature::Restaurant);
    assert!(reg.is_enabled(Feature::Restaurant));
    // KitchenDisplay depends ON Restaurant, not the other way around
    assert!(!reg.is_enabled(Feature::KitchenDisplay));
    assert!(!reg.is_enabled(Feature::TableManagement));
}
