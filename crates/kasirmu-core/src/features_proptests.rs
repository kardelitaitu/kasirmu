//! Property-based tests for features.rs (moved from the inline
//! mod proptests per AGENTS.md; F-016).

use super::*;
use proptest::prelude::*;

/// List of all features for generating random selections.
const ALL_FEATURES: &[Feature] = &[
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
    Feature::UsbScale,
    Feature::DiscountEngine,
    Feature::TaxEngine,
    Feature::LoyaltyProgram,
    Feature::GiftCards,
    Feature::QuickReturn,
    Feature::PromotionsEngine,
    Feature::ProductBundles,
    Feature::PurchaseOrders,
    Feature::SerialTracking,
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

/// Strategy: a random sequence of enable/disable operations.
/// Each step is `(should_enable, feature_index)`. We use the index
/// into `ALL_FEATURES` rather than the Feature directly to work
/// around proptest's requirement for `Arbitrary`.
fn arb_ops() -> impl Strategy<Value = Vec<(bool, usize)>> {
    proptest::collection::vec(
        (proptest::bool::ANY, 0usize..ALL_FEATURES.len()),
        0..200, // sequences from 0 to 200 steps
    )
}

// ── Invariant: newly-enabled features satisfy deps ───────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]
    /// After every `enable` call, the **newly-enabled** features
    /// (including auto-enabled dependencies) all have their own
    /// dependencies satisfied.
    ///
    /// We only check newly-added features, not the full set,
    /// because `disable` intentionally does not cascade — a
    /// feature can be left with a missing dependency after a
    /// previous `disable` call, and that is by design.
    #[test]
    fn dependency_invariant_holds_after_enables(ops in arb_ops()) {
        let mut reg = FeatureRegistry::new();

        for (should_enable, idx) in &ops {
            let feature = ALL_FEATURES[*idx];
            if *should_enable {
                let before: HashSet<Feature> = reg.enabled_features().collect();
                reg.enable(feature);
                let after: HashSet<Feature> = reg.enabled_features().collect();
                let new_features: Vec<&Feature> =
                    after.difference(&before).collect();

                for &&f in &new_features {
                    for &dep in f.dependencies() {
                        prop_assert!(
                            reg.is_enabled(dep),
                            "after enable({f:?}): dep {dep:?} is missing"
                        );
                    }
                }
            } else {
                reg.disable(feature);
            }
        }
    }
}

// ── Disable does NOT cascade (design property) ────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]
    /// `disable` does NOT cascade to dependents — only the
    /// specific feature is removed from the set. Every other
    /// feature that was enabled remains enabled.
    #[test]
    fn disable_does_not_cascade(ops in arb_ops()) {
        let mut reg = FeatureRegistry::new();

        // Enable features from all operations marked for enable.
        for (should_enable, idx) in &ops {
            if *should_enable {
                reg.enable(ALL_FEATURES[*idx]);
            }
        }

        // Snapshot the enabled set before any disable calls.
        let before_disable: HashSet<Feature> = reg.enabled_features().collect();

        // Disable features marked for disable.
        let disabled_features: Vec<Feature> = ops
            .iter()
            .filter(|(se, _)| !*se)
            .map(|(_, idx)| ALL_FEATURES[*idx])
            .collect();
        for &f in &disabled_features {
            reg.disable(f);
        }

        // Every disabled feature is no longer in the set.
        for &f in &disabled_features {
            prop_assert!(!reg.is_enabled(f), "disable({f:?}) should have removed it");
        }

        // Every feature that WAS in the set and was NOT disabled
        // is still enabled (disable does not cascade).
        for &f in &before_disable {
            if !disabled_features.contains(&f) {
                prop_assert!(reg.is_enabled(f), "{f:?} was removed despite not being disabled");
            }
        }
    }
}

// ── Enable return value ───────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]
    /// `enable(f)` returns `true` iff `f` was NOT already in the set.
    #[test]
    fn enable_return_value_matches_precondition(ops in arb_ops()) {
        let mut reg = FeatureRegistry::new();

        for (should_enable, idx) in &ops {
            let feature = ALL_FEATURES[*idx];
            if *should_enable {
                let was_enabled = reg.is_enabled(feature);
                prop_assert_eq!(reg.enable(feature), !was_enabled);
                prop_assert!(reg.is_enabled(feature));
            }
        }
    }
}

// ── Disable return value ──────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]
    /// `disable(f)` returns `true` iff `f` WAS already in the set.
    #[test]
    fn disable_return_value_matches_precondition(ops in arb_ops()) {
        let mut reg = FeatureRegistry::new();

        // First, enable a bunch of features.
        for (should_enable, idx) in &ops {
            if *should_enable {
                reg.enable(ALL_FEATURES[*idx]);
            }
        }

        // Then disable the same features.
        for (_, idx) in &ops {
            let feature = ALL_FEATURES[*idx];
            let was_enabled = reg.is_enabled(feature);
            prop_assert_eq!(reg.disable(feature), was_enabled);
        }
    }
}

// ── Serialization roundtrip ───────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]
    /// A registry survives `to_settings_rows` → `from_settings_rows`
    /// losslessly (modulo unknown keys, which we don't supply).
    #[test]
    fn serialization_roundtrip(ops in arb_ops()) {
        let mut reg = FeatureRegistry::new();

        for (should_enable, idx) in &ops {
            if *should_enable {
                reg.enable(ALL_FEATURES[*idx]);
            } else {
                reg.disable(ALL_FEATURES[*idx]);
            }
        }

        let rows = reg.to_settings_rows();
        let back = FeatureRegistry::from_settings_rows(&rows);
        prop_assert_eq!(back, reg);
    }
}

// ── Presets satisfy invariant ─────────────────────────────────

#[test]
fn simple_retail_preset_satisfies_invariant() {
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
fn restaurant_preset_satisfies_invariant() {
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
fn full_store_preset_satisfies_invariant() {
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
fn cafe_preset_satisfies_invariant() {
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
fn franchise_preset_satisfies_invariant() {
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

// ── Empty registry invariant ──────────────────────────────────

#[test]
fn empty_registry_satisfies_invariant() {
    let reg = FeatureRegistry::new();
    assert_eq!(reg.count(), 0);
    let features: Vec<Feature> = reg.enabled_features().collect();
    assert!(
        features.is_empty(),
        "empty registry should have no enabled features: {features:?}"
    );
}
