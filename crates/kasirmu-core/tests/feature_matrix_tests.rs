//! Integration tests for the preset feature matrix.
//!
//! Exercises all 6 built-in presets (`simple_retail`, `restaurant`,
//! `full_store`, `cafe`, `franchise`, `custom`) to verify:
//!
//! - `from_set` succeeds (dependency validation passes)
//! - `count()` matches expected
//! - `to_settings_rows()` roundtrips cleanly via `from_settings_rows()`
//!
//! These tests use only the public API — no internal module access.

use kasirmu_core::FeatureRegistry;

// ── Expected feature counts ───────────────────────────────────────────
//
// These counts are verified against the preset constructors in
// `crates/oz-core/src/features.rs`. When a preset is modified, update
// the count and the individual feature assertions below.

const SIMPLE_RETAIL_COUNT: usize = 7;
const RESTAURANT_COUNT: usize = 10;
const CAFE_COUNT: usize = 10;
const FRANCHISE_COUNT: usize = 21;
const CUSTOM_COUNT: usize = 0;

// ── Generic helpers ───────────────────────────────────────────────────

/// Expected features for `simple_retail` preset.
/// Matches the features listed in `FeatureRegistry::simple_retail()`.
fn assert_simple_retail(reg: &FeatureRegistry) {
    use kasirmu_core::Feature::{
        BarcodeScanning, CashPayment, CategoriesEnabled, InventoryTracking, ReceiptPrinting,
        SimpleRetail, TaxEngine,
    };
    assert!(
        reg.is_enabled(SimpleRetail),
        "SimpleRetail should be enabled"
    );
    assert!(reg.is_enabled(CashPayment), "CashPayment should be enabled");
    assert!(
        reg.is_enabled(BarcodeScanning),
        "BarcodeScanning should be enabled"
    );
    assert!(
        reg.is_enabled(ReceiptPrinting),
        "ReceiptPrinting should be enabled"
    );
    assert!(
        reg.is_enabled(InventoryTracking),
        "InventoryTracking should be enabled"
    );
    assert!(
        reg.is_enabled(CategoriesEnabled),
        "CategoriesEnabled should be enabled"
    );
    assert!(reg.is_enabled(TaxEngine), "TaxEngine should be enabled");
}

/// Expected features for `restaurant` preset.
fn assert_restaurant(reg: &FeatureRegistry) {
    use kasirmu_core::Feature::{
        CashPayment, CategoriesEnabled, DiscountEngine, InventoryTracking, KitchenDisplay,
        ReceiptPrinting, Restaurant, StaffLogin, TableManagement, TaxEngine,
    };
    assert!(reg.is_enabled(Restaurant), "Restaurant should be enabled");
    assert!(reg.is_enabled(CashPayment), "CashPayment should be enabled");
    assert!(
        reg.is_enabled(ReceiptPrinting),
        "ReceiptPrinting should be enabled"
    );
    assert!(
        reg.is_enabled(InventoryTracking),
        "InventoryTracking should be enabled"
    );
    assert!(
        reg.is_enabled(CategoriesEnabled),
        "CategoriesEnabled should be enabled"
    );
    assert!(
        reg.is_enabled(DiscountEngine),
        "DiscountEngine should be enabled"
    );
    assert!(reg.is_enabled(TaxEngine), "TaxEngine should be enabled");
    assert!(
        reg.is_enabled(KitchenDisplay),
        "KitchenDisplay should be enabled"
    );
    assert!(
        reg.is_enabled(TableManagement),
        "TableManagement should be enabled"
    );
    assert!(reg.is_enabled(StaffLogin), "StaffLogin should be enabled");
}

/// Expected features for `full_store` preset (subset).
fn assert_full_store_key_features(reg: &FeatureRegistry) {
    use kasirmu_core::Feature::{
        Analytics, CardPayment, CashDrawer, CustomerDisplay, ExportImport, GiftCards,
        LoyaltyProgram, MultiCurrency, NfcReader, ProductBundles, ProductVariants,
        PromotionsEngine, QuickReturn, Reporting, SimpleRetail, StaffLogin, StaffRoles, UsbScale,
    };
    assert!(
        reg.is_enabled(SimpleRetail),
        "SimpleRetail should be enabled"
    );
    assert!(reg.is_enabled(CardPayment), "CardPayment should be enabled");
    assert!(
        reg.is_enabled(MultiCurrency),
        "MultiCurrency should be enabled"
    );
    assert!(
        reg.is_enabled(ProductVariants),
        "ProductVariants should be enabled"
    );
    assert!(reg.is_enabled(StaffLogin), "StaffLogin should be enabled");
    assert!(reg.is_enabled(StaffRoles), "StaffRoles should be enabled");
    assert!(reg.is_enabled(CashDrawer), "CashDrawer should be enabled");
    assert!(
        reg.is_enabled(CustomerDisplay),
        "CustomerDisplay should be enabled"
    );
    assert!(reg.is_enabled(NfcReader), "NfcReader should be enabled");
    assert!(reg.is_enabled(UsbScale), "UsbScale should be enabled");
    assert!(
        reg.is_enabled(LoyaltyProgram),
        "LoyaltyProgram should be enabled"
    );
    assert!(reg.is_enabled(GiftCards), "GiftCards should be enabled");
    assert!(reg.is_enabled(QuickReturn), "QuickReturn should be enabled");
    assert!(
        reg.is_enabled(PromotionsEngine),
        "PromotionsEngine should be enabled"
    );
    assert!(
        reg.is_enabled(ProductBundles),
        "ProductBundles should be enabled"
    );
    assert!(reg.is_enabled(Reporting), "Reporting should be enabled");
    assert!(reg.is_enabled(Analytics), "Analytics should be enabled");
    assert!(
        reg.is_enabled(ExportImport),
        "ExportImport should be enabled"
    );
}

/// Expected features for `cafe` preset.
fn assert_cafe(reg: &FeatureRegistry) {
    use kasirmu_core::Feature::{
        CardPayment, CashPayment, CustomerDisplay, DiscountEngine, KitchenDisplay,
        PromotionsEngine, ReceiptPrinting, Restaurant, SimpleRetail, TaxEngine,
    };
    assert!(
        reg.is_enabled(SimpleRetail),
        "SimpleRetail should be enabled"
    );
    assert!(reg.is_enabled(Restaurant), "Restaurant should be enabled");
    assert!(reg.is_enabled(CashPayment), "CashPayment should be enabled");
    assert!(reg.is_enabled(CardPayment), "CardPayment should be enabled");
    assert!(
        reg.is_enabled(ReceiptPrinting),
        "ReceiptPrinting should be enabled"
    );
    assert!(
        reg.is_enabled(CustomerDisplay),
        "CustomerDisplay should be enabled"
    );
    assert!(
        reg.is_enabled(DiscountEngine),
        "DiscountEngine should be enabled"
    );
    assert!(reg.is_enabled(TaxEngine), "TaxEngine should be enabled");
    assert!(
        reg.is_enabled(KitchenDisplay),
        "KitchenDisplay should be enabled"
    );
    assert!(
        reg.is_enabled(PromotionsEngine),
        "PromotionsEngine should be enabled"
    );
}

/// Expected features for `franchise` preset.
fn assert_franchise(reg: &FeatureRegistry) {
    use kasirmu_core::Feature::{
        Analytics, AuditLog, CardPayment, CashPayment, CategoriesEnabled, CloudSync,
        DiscountEngine, InventoryTracking, KitchenDisplay, MultiCurrency, MultiStore,
        MultiTerminal, ProductVariants, ReceiptPrinting, Reporting, Restaurant, ShiftManagement,
        StaffLogin, StaffRoles, TableManagement, TaxEngine,
    };
    assert!(reg.is_enabled(Restaurant), "Restaurant should be enabled");
    assert!(reg.is_enabled(CashPayment), "CashPayment should be enabled");
    assert!(reg.is_enabled(CardPayment), "CardPayment should be enabled");
    assert!(
        reg.is_enabled(MultiCurrency),
        "MultiCurrency should be enabled"
    );
    assert!(
        reg.is_enabled(InventoryTracking),
        "InventoryTracking should be enabled"
    );
    assert!(
        reg.is_enabled(ProductVariants),
        "ProductVariants should be enabled"
    );
    assert!(
        reg.is_enabled(CategoriesEnabled),
        "CategoriesEnabled should be enabled"
    );
    assert!(reg.is_enabled(StaffLogin), "StaffLogin should be enabled");
    assert!(reg.is_enabled(StaffRoles), "StaffRoles should be enabled");
    assert!(
        reg.is_enabled(ShiftManagement),
        "ShiftManagement should be enabled"
    );
    assert!(reg.is_enabled(AuditLog), "AuditLog should be enabled");
    assert!(
        reg.is_enabled(ReceiptPrinting),
        "ReceiptPrinting should be enabled"
    );
    assert!(
        reg.is_enabled(DiscountEngine),
        "DiscountEngine should be enabled"
    );
    assert!(reg.is_enabled(TaxEngine), "TaxEngine should be enabled");
    assert!(
        reg.is_enabled(KitchenDisplay),
        "KitchenDisplay should be enabled"
    );
    assert!(
        reg.is_enabled(TableManagement),
        "TableManagement should be enabled"
    );
    assert!(reg.is_enabled(CloudSync), "CloudSync should be enabled");
    assert!(reg.is_enabled(MultiStore), "MultiStore should be enabled");
    assert!(
        reg.is_enabled(MultiTerminal),
        "MultiTerminal should be enabled"
    );
    assert!(reg.is_enabled(Reporting), "Reporting should be enabled");
    assert!(reg.is_enabled(Analytics), "Analytics should be enabled");
}

// ── Preset structure tests ──────────────────────────────────────────

#[test]
fn test_presets_simple_retail_from_set_success() {
    let reg = FeatureRegistry::simple_retail();
    assert_eq!(reg.count(), SIMPLE_RETAIL_COUNT);
    assert_simple_retail(&reg);
}

#[test]
fn test_presets_restaurant_from_set_success() {
    let reg = FeatureRegistry::restaurant();
    assert_eq!(reg.count(), RESTAURANT_COUNT);
    assert_restaurant(&reg);
}

#[test]
fn test_presets_full_store_from_set_success() {
    let reg = FeatureRegistry::full_store();
    assert!(
        reg.count() >= 20,
        "full_store should have at least 20 features, got {}",
        reg.count()
    );
    assert_full_store_key_features(&reg);
}

#[test]
fn test_presets_cafe_from_set_success() {
    let reg = FeatureRegistry::cafe();
    assert_eq!(reg.count(), CAFE_COUNT);
    assert_cafe(&reg);
}

#[test]
fn test_presets_franchise_from_set_success() {
    let reg = FeatureRegistry::franchise();
    assert_eq!(reg.count(), FRANCHISE_COUNT);
    assert_franchise(&reg);
}

#[test]
fn test_presets_custom_from_set_success() {
    let reg = FeatureRegistry::custom();
    assert_eq!(reg.count(), CUSTOM_COUNT);
}

// ── Settings serialization roundtrip ─────────────────────────────────

#[test]
fn test_presets_simple_retail_settings_roundtrip() {
    let reg = FeatureRegistry::simple_retail();
    let rows = reg.to_settings_rows();
    assert_eq!(rows.len(), SIMPLE_RETAIL_COUNT);
    let back = FeatureRegistry::from_settings_rows(&rows);
    assert_eq!(
        back, reg,
        "simple_retail: from_settings_rows(to_settings_rows()) must be lossless"
    );
}

#[test]
fn test_presets_restaurant_settings_roundtrip() {
    let reg = FeatureRegistry::restaurant();
    let rows = reg.to_settings_rows();
    assert_eq!(rows.len(), RESTAURANT_COUNT);
    let back = FeatureRegistry::from_settings_rows(&rows);
    assert_eq!(
        back, reg,
        "restaurant: from_settings_rows(to_settings_rows()) must be lossless"
    );
}

#[test]
fn test_presets_full_store_settings_roundtrip() {
    let reg = FeatureRegistry::full_store();
    let rows = reg.to_settings_rows();
    assert!(
        rows.len() >= 20,
        "full_store should produce at least 20 settings rows, got {}",
        rows.len()
    );
    let back = FeatureRegistry::from_settings_rows(&rows);
    assert_eq!(
        back, reg,
        "full_store: from_settings_rows(to_settings_rows()) must be lossless"
    );
}

#[test]
fn test_presets_cafe_settings_roundtrip() {
    let reg = FeatureRegistry::cafe();
    let rows = reg.to_settings_rows();
    assert_eq!(rows.len(), CAFE_COUNT);
    let back = FeatureRegistry::from_settings_rows(&rows);
    assert_eq!(
        back, reg,
        "cafe: from_settings_rows(to_settings_rows()) must be lossless"
    );
}

#[test]
fn test_presets_franchise_settings_roundtrip() {
    let reg = FeatureRegistry::franchise();
    let rows = reg.to_settings_rows();
    assert_eq!(rows.len(), FRANCHISE_COUNT);
    let back = FeatureRegistry::from_settings_rows(&rows);
    assert_eq!(
        back, reg,
        "franchise: from_settings_rows(to_settings_rows()) must be lossless"
    );
}

#[test]
fn test_presets_custom_settings_roundtrip() {
    let reg = FeatureRegistry::custom();
    let rows = reg.to_settings_rows();
    assert!(rows.is_empty());
    let back = FeatureRegistry::from_settings_rows(&rows);
    assert_eq!(
        back, reg,
        "custom: from_settings_rows(to_settings_rows()) must be lossless"
    );
}

// ── Dependency invariant ────────────────────────────────────────────

#[test]
fn test_presets_simple_retail_dependency_invariant() {
    let reg = FeatureRegistry::simple_retail();
    for f in reg.enabled_features() {
        for &dep in f.dependencies() {
            assert!(
                reg.is_enabled(dep),
                "simple_retail: {f:?} enabled but dep {dep:?} is not"
            );
        }
    }
}

#[test]
fn test_presets_restaurant_dependency_invariant() {
    let reg = FeatureRegistry::restaurant();
    for f in reg.enabled_features() {
        for &dep in f.dependencies() {
            assert!(
                reg.is_enabled(dep),
                "restaurant: {f:?} enabled but dep {dep:?} is not"
            );
        }
    }
}

#[test]
fn test_presets_full_store_dependency_invariant() {
    let reg = FeatureRegistry::full_store();
    for f in reg.enabled_features() {
        for &dep in f.dependencies() {
            assert!(
                reg.is_enabled(dep),
                "full_store: {f:?} enabled but dep {dep:?} is not"
            );
        }
    }
}

#[test]
fn test_presets_cafe_dependency_invariant() {
    let reg = FeatureRegistry::cafe();
    for f in reg.enabled_features() {
        for &dep in f.dependencies() {
            assert!(
                reg.is_enabled(dep),
                "cafe: {f:?} enabled but dep {dep:?} is not"
            );
        }
    }
}

#[test]
fn test_presets_franchise_dependency_invariant() {
    let reg = FeatureRegistry::franchise();
    for f in reg.enabled_features() {
        for &dep in f.dependencies() {
            assert!(
                reg.is_enabled(dep),
                "franchise: {f:?} enabled but dep {dep:?} is not"
            );
        }
    }
}

#[test]
fn test_presets_custom_dependency_invariant() {
    let reg = FeatureRegistry::custom();
    // Custom preset has zero features — vacuously true.
    assert_eq!(reg.count(), 0);
    let features: Vec<_> = reg.enabled_features().collect();
    assert!(features.is_empty(), "custom preset should have no features");
}

// ── Serde roundtrip ────────────────────────────────────────────────

#[test]
fn test_presets_simple_retail_serde() {
    let reg = FeatureRegistry::simple_retail();
    let json = serde_json::to_string(&reg).unwrap();
    let back: FeatureRegistry = serde_json::from_str(&json).unwrap();
    assert_eq!(back, reg);
}

#[test]
fn test_presets_restaurant_serde() {
    let reg = FeatureRegistry::restaurant();
    let json = serde_json::to_string(&reg).unwrap();
    let back: FeatureRegistry = serde_json::from_str(&json).unwrap();
    assert_eq!(back, reg);
}

#[test]
fn test_presets_full_store_serde() {
    let reg = FeatureRegistry::full_store();
    let json = serde_json::to_string(&reg).unwrap();
    let back: FeatureRegistry = serde_json::from_str(&json).unwrap();
    assert_eq!(back, reg);
}

#[test]
fn test_presets_cafe_serde() {
    let reg = FeatureRegistry::cafe();
    let json = serde_json::to_string(&reg).unwrap();
    let back: FeatureRegistry = serde_json::from_str(&json).unwrap();
    assert_eq!(back, reg);
}

#[test]
fn test_presets_franchise_serde() {
    let reg = FeatureRegistry::franchise();
    let json = serde_json::to_string(&reg).unwrap();
    let back: FeatureRegistry = serde_json::from_str(&json).unwrap();
    assert_eq!(back, reg);
}

#[test]
fn test_presets_custom_serde() {
    let reg = FeatureRegistry::custom();
    let json = serde_json::to_string(&reg).unwrap();
    let back: FeatureRegistry = serde_json::from_str(&json).unwrap();
    assert_eq!(back, reg);
}

// ── Database roundtrip (full persistence) ──────────────────────────

#[test]
fn test_presets_simple_retail_db_roundtrip() {
    let conn = kasirmu_core::migrations::fresh_db();
    let reg = FeatureRegistry::simple_retail();
    kasirmu_core::Settings::save_features(&conn, &reg).unwrap();
    let loaded = kasirmu_core::Settings::load_features(&conn).unwrap();
    assert_eq!(loaded, reg);
}

#[test]
fn test_presets_restaurant_db_roundtrip() {
    let conn = kasirmu_core::migrations::fresh_db();
    let reg = FeatureRegistry::restaurant();
    kasirmu_core::Settings::save_features(&conn, &reg).unwrap();
    let loaded = kasirmu_core::Settings::load_features(&conn).unwrap();
    assert_eq!(loaded, reg);
}

#[test]
fn test_presets_full_store_db_roundtrip() {
    let conn = kasirmu_core::migrations::fresh_db();
    let reg = FeatureRegistry::full_store();
    kasirmu_core::Settings::save_features(&conn, &reg).unwrap();
    let loaded = kasirmu_core::Settings::load_features(&conn).unwrap();
    assert_eq!(loaded, reg);
}

#[test]
fn test_presets_cafe_db_roundtrip() {
    let conn = kasirmu_core::migrations::fresh_db();
    let reg = FeatureRegistry::cafe();
    kasirmu_core::Settings::save_features(&conn, &reg).unwrap();
    let loaded = kasirmu_core::Settings::load_features(&conn).unwrap();
    assert_eq!(loaded, reg);
}

#[test]
fn test_presets_franchise_db_roundtrip() {
    let conn = kasirmu_core::migrations::fresh_db();
    let reg = FeatureRegistry::franchise();
    kasirmu_core::Settings::save_features(&conn, &reg).unwrap();
    let loaded = kasirmu_core::Settings::load_features(&conn).unwrap();
    assert_eq!(loaded, reg);
}

#[test]
fn test_presets_custom_db_roundtrip() {
    let conn = kasirmu_core::migrations::fresh_db();
    let reg = FeatureRegistry::custom();
    kasirmu_core::Settings::save_features(&conn, &reg).unwrap();
    let loaded = kasirmu_core::Settings::load_features(&conn).unwrap();
    assert_eq!(loaded, reg);
}
