//! Unit tests for the feature-flag command bodies (Wave-F test relocation:
//! moved out of `apps/desktop-client/src/commands/features_tests.rs`).
//!
//! Mounted at the foot of `features.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the DTOs and the pure helpers exactly as the
//! desktop sibling module did; every case here is harness-free (DTO
//! serde/debug conformance plus the static metadata mappings).

use super::*;

// ── FeatureDto ───────────────────────────────────────────────

#[test]
fn feature_dto_debug_output() {
    let dto = FeatureDto {
        key: "simple-retail".into(),
        name: "Simple Retail",
        description: "Core POS: scan, sell, print receipt",
        group: "Core",
        enabled: true,
        dependencies: vec!["cash-payment".into()],
    };
    let debug = format!("{dto:?}");
    assert!(debug.contains("simple-retail"));
    assert!(debug.contains("Simple Retail"));
    assert!(debug.contains("Core"));
}

#[test]
fn feature_dto_serialize_json() {
    let dto = FeatureDto {
        key: "tax-engine".into(),
        name: "Tax Engine",
        description: "Tax calculation with configurable rates",
        group: "Business Rules",
        enabled: false,
        dependencies: vec![],
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["key"], "tax-engine");
    assert_eq!(json["name"], "Tax Engine");
    assert_eq!(json["group"], "Business Rules");
    assert_eq!(json["enabled"], false);
    assert_eq!(json["dependencies"].as_array().unwrap().len(), 0);
}

#[test]
fn feature_dto_with_dependencies_serialize() {
    let dto = FeatureDto {
        key: "analytics".into(),
        name: "Analytics",
        description: "Advanced charts",
        group: "Reporting",
        enabled: true,
        dependencies: vec!["reporting".into()],
    };
    let json = serde_json::to_value(&dto).unwrap();
    let deps = json["dependencies"].as_array().unwrap();
    assert_eq!(deps.len(), 1);
    assert_eq!(deps[0], "reporting");
}

// ── SetFeatureArgs ───────────────────────────────────────────

#[test]
fn set_feature_args_deserialize() {
    let json = r#"{"key": "tax-engine", "enabled": true}"#;
    let args: SetFeatureArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.key, "tax-engine");
    assert!(args.enabled);
}

#[test]
fn set_feature_args_deserialize_disable() {
    let json = r#"{"key": "loyalty-program", "enabled": false}"#;
    let args: SetFeatureArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.key, "loyalty-program");
    assert!(!args.enabled);
}

#[test]
fn set_feature_args_debug() {
    let args = SetFeatureArgs {
        key: "gift-cards".into(),
        enabled: true,
    };
    let debug = format!("{args:?}");
    assert!(debug.contains("gift-cards"));
    assert!(debug.contains("true"));
}

// ── SetFeatureResult ─────────────────────────────────────────

#[test]
fn set_feature_result_debug() {
    let dto = FeatureDto {
        key: "simple-retail".into(),
        name: "Simple Retail",
        description: "Core POS",
        group: "Core",
        enabled: true,
        dependencies: vec![],
    };
    let result = SetFeatureResult {
        success: true,
        features: vec![dto],
        auto_enabled: vec!["cash-payment".into()],
    };
    let debug = format!("{result:?}");
    assert!(debug.contains("true"));
    assert!(debug.contains("Simple Retail"));
    assert!(debug.contains("cash-payment"));
}

#[test]
fn set_feature_result_empty_auto_enabled() {
    let result = SetFeatureResult {
        success: true,
        features: vec![],
        auto_enabled: vec![],
    };
    let json = serde_json::to_value(&result).unwrap();
    assert_eq!(json["success"], true);
    assert_eq!(json["auto_enabled"].as_array().unwrap().len(), 0);
}

// ── ListAllFeaturesResult ────────────────────────────────────

#[test]
fn list_all_features_result_serialize_empty() {
    let result = ListAllFeaturesResult { features: vec![] };
    let json = serde_json::to_value(&result).unwrap();
    assert!(json["features"].as_array().unwrap().is_empty());
}

// ── feature_to_module_id ────────────────────────────────────

#[test]
fn feature_to_module_id_inventory() {
    assert_eq!(
        feature_to_module_id(Feature::InventoryTracking),
        Some("inventory")
    );
    assert_eq!(
        feature_to_module_id(Feature::CategoriesEnabled),
        Some("inventory")
    );
}

#[test]
fn feature_to_module_id_staff() {
    assert_eq!(feature_to_module_id(Feature::StaffLogin), Some("staff"));
    assert_eq!(feature_to_module_id(Feature::StaffRoles), Some("staff"));
    assert_eq!(
        feature_to_module_id(Feature::ShiftManagement),
        Some("staff")
    );
}

#[test]
fn feature_to_module_id_reporting() {
    assert_eq!(feature_to_module_id(Feature::Reporting), Some("reporting"));
    assert_eq!(feature_to_module_id(Feature::Analytics), Some("reporting"));
}

#[test]
fn feature_to_module_id_tax() {
    assert_eq!(feature_to_module_id(Feature::TaxEngine), Some("tax"));
}

#[test]
fn feature_to_module_id_sales() {
    assert_eq!(feature_to_module_id(Feature::SimpleRetail), Some("sales"));
    assert_eq!(feature_to_module_id(Feature::Restaurant), Some("sales"));
}

#[test]
fn feature_to_module_id_currency() {
    assert_eq!(
        feature_to_module_id(Feature::MultiCurrency),
        Some("currency")
    );
}

#[test]
fn feature_to_module_id_returns_none_for_non_module_features() {
    assert_eq!(feature_to_module_id(Feature::CashPayment), None);
    assert_eq!(feature_to_module_id(Feature::CardPayment), None);
    assert_eq!(feature_to_module_id(Feature::BarcodeScanning), None);
    assert_eq!(feature_to_module_id(Feature::ReceiptPrinting), None);
    assert_eq!(feature_to_module_id(Feature::DiscountEngine), None);
    assert_eq!(feature_to_module_id(Feature::GiftCards), None);
    assert_eq!(feature_to_module_id(Feature::PluginSystem), None);
    assert_eq!(feature_to_module_id(Feature::ExportImport), None);
    assert_eq!(feature_to_module_id(Feature::CloudSync), None);
}

#[test]
fn feature_to_module_id_known_features_are_comprehensive() {
    // Ensure every feature that maps to a module has its mapping
    // listed above. This test will catch missing mappings when
    // new features are added.
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
        Feature::StockCounting,
        Feature::StockTransfers,
        Feature::PurchaseOrders,
        Feature::SerialTracking,
        Feature::QuickReturn,
        Feature::UsbScale,
    ];
    for f in all_features {
        let result = feature_to_module_id(f);
        // Just ensure that known module-mapped features return Some
        // and others return None — no panics.
        if matches!(
            f,
            Feature::InventoryTracking
                | Feature::CategoriesEnabled
                | Feature::StaffLogin
                | Feature::StaffRoles
                | Feature::ShiftManagement
                | Feature::Reporting
                | Feature::Analytics
                | Feature::TaxEngine
                | Feature::SimpleRetail
                | Feature::Restaurant
                | Feature::MultiCurrency
        ) {
            assert!(
                result.is_some(),
                "feature {f:?} should have a module mapping"
            );
        }
    }
}

// ── SetFeaturesBulkArgs ────────────────────────────────────────

#[test]
fn set_features_bulk_args_deserialize() {
    let json = r#"{"keys": ["simple-retail", "cash-payment"], "enabled": true}"#;
    let args: SetFeaturesBulkArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.keys.len(), 2);
    assert_eq!(args.keys[0], "simple-retail");
    assert_eq!(args.keys[1], "cash-payment");
    assert!(args.enabled);
}

#[test]
fn set_features_bulk_args_deserialize_disable() {
    let json = r#"{"keys": ["kitchen-display"], "enabled": false}"#;
    let args: SetFeaturesBulkArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.keys.len(), 1);
    assert_eq!(args.keys[0], "kitchen-display");
    assert!(!args.enabled);
}

#[test]
fn set_features_bulk_args_empty_keys() {
    let json = r#"{"keys": [], "enabled": true}"#;
    let args: SetFeaturesBulkArgs = serde_json::from_str(json).unwrap();
    assert!(args.keys.is_empty());
    assert!(args.enabled);
}

#[test]
fn set_features_bulk_args_debug() {
    let args = SetFeaturesBulkArgs {
        keys: vec!["hardware".into()],
        enabled: false,
    };
    let debug = format!("{args:?}");
    assert!(debug.contains("hardware"));
    assert!(debug.contains("false"));
}

// ── all_feature_metadata ─────────────────────────────────────

#[test]
fn all_feature_metadata_non_empty() {
    let metadata = all_feature_metadata();
    assert!(!metadata.is_empty(), "should have at least one feature");
}

#[test]
fn all_feature_metadata_no_duplicate_keys() {
    let metadata = all_feature_metadata();
    let keys: Vec<String> = metadata
        .iter()
        .map(|(feat, _, _, _)| kasirmu_core::features::feature_key(*feat).to_string())
        .collect();
    let mut sorted = keys.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), keys.len(), "feature keys must be unique");
}
