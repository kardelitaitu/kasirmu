//! Feature flag system — toggleable POS capabilities.
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice C4: features deep read)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: production logic (1-685) clean — dependency DAG with recursive enable, kebab-case settings keys, FeatureGuard veto registry (KDS tickets / open shifts), format! interpolates an internal constant only; COR-33 CONVENTION: ~660 lines of inline #[test]/proptest (691-1349) live in this production file despite the declared sibling features_tests.rs — violates AGENTS.md ("never tests in production files", 1,000-line rule); guard COUNT queries use .unwrap_or(0) -> DB error = veto passes (fail-open on a safety guard, COR-11/25 family, INFO)
next: move inline tests to features_tests.rs (COR-33); propagate guard query errors | perf: N/A
*/
//!
//! The [`Feature`] enum defines all 32 toggleable features in the
//! OZ-POS framework. A [`FeatureRegistry`] holds the currently-active
//! set and provides helpers for enabling/disabling flags with automatic
//! dependency resolution.
//!
//! Feature flags are persisted in the `settings` table as
//! `feature.<variant_name>` = `"1"` rows. The bridge between
//! [`FeatureRegistry`] and the settings store lives in `settings.rs`
//! (#6 in the core plan).

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use rusqlite::Connection;

/// Every toggleable feature in the OZ-POS framework.
///
/// Variants are in logical groups: core, payments, products, staff,
/// hardware, business rules, scaling, and advanced. The order is stable;
/// adding new variants at the end preserves the integer discriminants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Feature {
    // ── Core ─────────────────────────────────────────────────────
    /// Core retail POS: scan barcode, add to cart, sell, print receipt.
    SimpleRetail,
    /// Restaurant mode with table management and KDS.
    Restaurant,

    // ── Payments ─────────────────────────────────────────────────
    /// Cash payment method.
    CashPayment,
    /// Card payment method (debit / credit).
    CardPayment,
    /// Multi-currency support with exchange rates.
    MultiCurrency,

    // ── Products ─────────────────────────────────────────────────
    /// Track stock levels per product.
    InventoryTracking,
    /// Product variants (size, colour, flavour).
    ProductVariants,
    /// Product category grouping.
    CategoriesEnabled,

    // ── Staff ────────────────────────────────────────────────────
    /// Staff PIN / password login.
    StaffLogin,
    /// Role-based permissions (owner, manager, cashier).
    StaffRoles,
    /// Open / close shift with cash reconciliation.
    ShiftManagement,
    /// Immutable append-only audit log.
    AuditLog,

    // ── Hardware ─────────────────────────────────────────────────
    /// Barcode scanner support (USB, serial, Bluetooth).
    BarcodeScanning,
    /// Receipt printer (USB / serial / network).
    ReceiptPrinting,
    /// Cash drawer trigger (via printer GPIO).
    CashDrawer,
    /// Customer-facing secondary display.
    CustomerDisplay,
    /// NFC / contactless reader.
    NfcReader,
    /// USB weight scale for produce/groceries.
    UsbScale,

    // ── Business Rules ───────────────────────────────────────────
    /// Percentage and fixed-amount discounts.
    DiscountEngine,
    /// Tax calculation engine.
    TaxEngine,
    /// Customer loyalty points and tiers.
    LoyaltyProgram,
    /// Gift cards — issue, redeem, top-up, freeze.
    GiftCards,
    /// Quick return from POS — scan receipt barcode to initiate refund.
    QuickReturn,
    /// Time-limited promotions (buy-X-get-Y, etc.).
    PromotionsEngine,
    /// Sell multiple SKUs as a bundle.
    ProductBundles,
    /// Stock counting / physical inventory.
    StockCounting,
    /// Transfer stock between locations or terminals.
    StockTransfers,
    /// Purchase orders and supplier management.
    PurchaseOrders,
    /// Track serial numbers for warranty tracking at checkout.
    SerialTracking,

    // ── Restaurant ───────────────────────────────────────────────
    /// Kitchen display system for order routing.
    KitchenDisplay,
    /// Interactive table management (floor plan).
    TableManagement,
    /// Locked-down full-screen self-service mode.
    SelfServiceKiosk,

    // ── Scaling ──────────────────────────────────────────────────
    /// Cloud database synchronisation.
    CloudSync,
    /// Multi-store management.
    MultiStore,
    /// Multiple terminals per store.
    MultiTerminal,

    // ── Reporting ────────────────────────────────────────────────
    /// Sales, inventory, and shift reports.
    Reporting,
    /// Advanced analytics with charts and exports.
    Analytics,

    // ── Advanced ─────────────────────────────────────────────────
    /// Data export / import (.kasirpkg format).
    ExportImport,
    /// Third-party plugin system.
    PluginSystem,
}

impl Feature {
    /// Features that must be enabled before this one can be turned on.
    ///
    /// Returns an empty slice if the feature has no dependencies.
    pub fn dependencies(self) -> &'static [Feature] {
        match self {
            // Staff hierarchy.
            Self::StaffRoles => &[Self::StaffLogin],
            Self::ShiftManagement => &[Self::StaffLogin],
            Self::AuditLog => &[Self::StaffLogin],

            // Hardware chains.
            Self::CashDrawer => &[Self::ReceiptPrinting],
            Self::CustomerDisplay => &[Self::ReceiptPrinting],

            // Restaurant.
            Self::KitchenDisplay => &[Self::Restaurant],
            Self::TableManagement => &[Self::Restaurant],
            Self::SelfServiceKiosk => &[Self::SimpleRetail],

            // Business rules that need staff login.
            Self::LoyaltyProgram => &[Self::StaffLogin],
            Self::PromotionsEngine => &[Self::DiscountEngine],

            // Scaling.
            Self::MultiTerminal => &[Self::MultiStore],
            Self::CloudSync => &[Self::MultiStore],

            // Reporting.
            Self::Analytics => &[Self::Reporting],

            // Products.
            Self::StockCounting => &[Self::InventoryTracking],
            Self::SerialTracking => &[Self::InventoryTracking],

            // Everything else has no dependencies.
            _ => &[],
        }
    }
}

/// Holds the currently-active feature set.
///
/// Persisted to the `settings` table as `feature.<kebab-case-name>` = `"1"`.
/// Provides preset constructors for common store types.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureRegistry {
    enabled: HashSet<Feature>,
}

impl FeatureRegistry {
    /// Create an empty registry with no features enabled.
    pub fn new() -> Self {
        Self {
            enabled: HashSet::new(),
        }
    }

    /// Create a registry from a set of features.
    ///
    /// # Panics
    ///
    /// Panics if any feature's dependencies are not included in the set.
    pub fn from_set(features: impl IntoIterator<Item = Feature>) -> Self {
        let enabled: HashSet<Feature> = features.into_iter().collect();
        for &f in &enabled {
            for &dep in f.dependencies() {
                assert!(
                    enabled.contains(&dep),
                    "feature {f:?} requires {dep:?} but it is not in the set"
                );
            }
        }
        Self { enabled }
    }

    /// True when the given feature is turned on.
    pub fn is_enabled(&self, feature: Feature) -> bool {
        self.enabled.contains(&feature)
    }

    /// Enable a feature and all of its dependencies recursively.
    ///
    /// Returns `true` if the feature was newly enabled (not already on).
    ///
    /// # Example
    ///
    /// ```
    /// use kasirmu_core::{Feature, FeatureRegistry};
    ///
    /// let mut reg = FeatureRegistry::new();
    ///
    /// // Enabling StaffRoles automatically enables its dependency StaffLogin.
    /// assert!(reg.enable(Feature::StaffRoles));
    /// assert!(reg.is_enabled(Feature::StaffRoles));
    /// assert!(reg.is_enabled(Feature::StaffLogin),  "auto-enabled dep");
    /// assert_eq!(reg.count(), 2);
    ///
    /// // Enabling again returns false (already on).
    /// assert!(!reg.enable(Feature::StaffRoles));
    /// ```
    pub fn enable(&mut self, feature: Feature) -> bool {
        if self.enabled.contains(&feature) {
            return false;
        }
        // Enable dependencies first (bottom-up).
        for &dep in feature.dependencies() {
            self.enable(dep);
        }
        self.enabled.insert(feature)
    }

    /// Disable a feature.
    ///
    /// Does **not** cascade to dependents — callers must decide whether
    /// to disable features that depend on this one. Returns `true` if
    /// the feature was actually removed.
    pub fn disable(&mut self, feature: Feature) -> bool {
        self.enabled.remove(&feature)
    }

    /// All currently-enabled features (unordered).
    pub fn enabled_features(&self) -> impl Iterator<Item = Feature> + '_ {
        self.enabled.iter().copied()
    }

    /// Number of enabled features.
    pub fn count(&self) -> usize {
        self.enabled.len()
    }

    /// Serialize to key-value pairs suitable for the `settings` table.
    ///
    /// Each enabled feature becomes `"feature.<kebab-case-name>"` = `"1"`.
    /// Disabled features are omitted (the settings store may carry stale
    /// keys from previous runs; they will be cleaned up by the store).
    pub fn to_settings_rows(&self) -> Vec<(String, String)> {
        self.enabled
            .iter()
            .map(|f| {
                let key = format!("feature.{}", feature_key(*f));
                (key, "1".into())
            })
            .collect()
    }

    /// Reconstruct a registry from key-value rows loaded from the
    /// `settings` table.
    ///
    /// Rows whose key starts with `"feature."` are parsed; all other
    /// keys are silently ignored. Rows with value `"1"` enable the
    /// feature. Dependency validation is NOT performed — the stored
    /// state is assumed to be consistent.
    pub fn from_settings_rows(rows: &[(String, String)]) -> Self {
        let enabled: HashSet<Feature> = rows
            .iter()
            .filter_map(|(key, value)| {
                if value == "1" {
                    key.strip_prefix("feature.").and_then(feature_from_key)
                } else {
                    None
                }
            })
            .collect();
        // Note: we purposely skip dependency validation here.
        // The settings store should always be internally consistent;
        // if it's not, the UX layer will handle missing deps gracefully.
        Self { enabled }
    }
}

// ── Presets ────────────────────────────────────────────────────────────

impl FeatureRegistry {
    /// **Simple Retail** — barcode, cash, receipt, inventory, tax.
    pub fn simple_retail() -> Self {
        Self::from_set([
            Feature::SimpleRetail,
            Feature::CashPayment,
            Feature::BarcodeScanning,
            Feature::ReceiptPrinting,
            Feature::InventoryTracking,
            Feature::CategoriesEnabled,
            Feature::TaxEngine,
        ])
    }

    /// **Restaurant** — tables, KDS, cash, receipt, discounts.
    pub fn restaurant() -> Self {
        Self::from_set([
            Feature::Restaurant,
            Feature::CashPayment,
            Feature::ReceiptPrinting,
            Feature::InventoryTracking,
            Feature::CategoriesEnabled,
            Feature::DiscountEngine,
            Feature::TaxEngine,
            Feature::KitchenDisplay,
            Feature::TableManagement,
            Feature::StaffLogin,
        ])
    }

    /// **Full Store** — everything except cloud, multi-store, and plugins.
    pub fn full_store() -> Self {
        Self::from_set([
            Feature::SimpleRetail,
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
            Feature::Reporting,
            Feature::Analytics,
            Feature::ExportImport,
        ])
    }

    /// **Cafe / Bakery** — quick-service with kitchen display, cash+card, discounts.
    pub fn cafe() -> Self {
        Self::from_set([
            Feature::SimpleRetail,
            Feature::Restaurant, // required by KitchenDisplay
            Feature::CashPayment,
            Feature::CardPayment,
            Feature::ReceiptPrinting,
            Feature::CustomerDisplay,
            Feature::DiscountEngine,
            Feature::TaxEngine,
            Feature::KitchenDisplay,
            Feature::PromotionsEngine,
        ])
    }

    /// **Franchise** — multi-store, multi-terminal, restaurant + full admin stack.
    pub fn franchise() -> Self {
        Self::from_set([
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
            Feature::ReceiptPrinting,
            Feature::DiscountEngine,
            Feature::TaxEngine,
            Feature::KitchenDisplay,
            Feature::TableManagement,
            Feature::CloudSync,
            Feature::MultiStore,
            Feature::MultiTerminal,
            Feature::Reporting,
            Feature::Analytics,
        ])
    }

    /// **Custom** — empty; the Setup Wizard will enable features one by one.
    pub fn custom() -> Self {
        Self::new()
    }
}

/// Resolve a store-type preset slug to its [`FeatureRegistry`].
///
/// The single owner of the preset→features fact. First-run provisioning asks
/// the merchant for a store type and must turn that answer into the feature set
/// the terminal starts with; doing that with a second copy of these lists is what
/// `FeatureRegistry`'s preset constructors exist to prevent.
///
/// Returns `None` for a slug this build does not know. Callers decide whether
/// that is fatal: `provision_device`'s contract is that an unknown preset must
/// not strand a merchant at the first-run screen, so it degrades rather than
/// refusing.
pub fn preset_registry(slug: &str) -> Option<FeatureRegistry> {
    Some(match slug {
        "simple-retail" => FeatureRegistry::simple_retail(),
        "restaurant" => FeatureRegistry::restaurant(),
        "full-store" => FeatureRegistry::full_store(),
        "cafe" => FeatureRegistry::cafe(),
        "franchise" => FeatureRegistry::franchise(),
        "custom" => FeatureRegistry::custom(),
        _ => return None,
    })
}

/// The kebab-case feature keys a store-type preset enables, **sorted**.
///
/// Thin wrapper over [`preset_registry`] for the IPC boundary, which speaks
/// keys rather than a registry.
///
/// SORTED deliberately: [`FeatureRegistry::enabled_features`] documents itself
/// as unordered (it iterates a hash set), so passing that order across IPC would
/// hand the UI an array that differs between calls for the same preset. Nothing
/// downstream depends on the order — `provision_device` enables each key in turn
/// — but a stable payload is what lets a test or a log compare two of them.
pub fn preset_feature_keys(slug: &str) -> Option<Vec<String>> {
    preset_registry(slug).map(|registry| {
        let mut keys: Vec<String> = registry
            .enabled_features()
            .map(|f| feature_key(f).to_string())
            .collect();
        keys.sort();
        keys
    })
}

// ── Settings-table helpers ──────────────────────────────────────────────

/// Convert a [`Feature`] to its kebab-case settings key suffix.
///
/// The full settings key is `"feature.<suffix>"`. This function returns
/// just the suffix (e.g., `"simple-retail"`).
pub fn feature_key(f: Feature) -> &'static str {
    match f {
        Feature::SimpleRetail => "simple-retail",
        Feature::Restaurant => "restaurant",
        Feature::CashPayment => "cash-payment",
        Feature::CardPayment => "card-payment",
        Feature::MultiCurrency => "multi-currency",
        Feature::InventoryTracking => "inventory-tracking",
        Feature::ProductVariants => "product-variants",
        Feature::CategoriesEnabled => "categories-enabled",
        Feature::StaffLogin => "staff-login",
        Feature::StaffRoles => "staff-roles",
        Feature::ShiftManagement => "shift-management",
        Feature::AuditLog => "audit-log",
        Feature::BarcodeScanning => "barcode-scanning",
        Feature::ReceiptPrinting => "receipt-printing",
        Feature::CashDrawer => "cash-drawer",
        Feature::CustomerDisplay => "customer-display",
        Feature::NfcReader => "nfc-reader",
        Feature::UsbScale => "usb-scale",
        Feature::DiscountEngine => "discount-engine",
        Feature::TaxEngine => "tax-engine",
        Feature::LoyaltyProgram => "loyalty-program",
        Feature::GiftCards => "gift-cards",
        Feature::QuickReturn => "quick-return",
        Feature::StockCounting => "stock-counting",
        Feature::StockTransfers => "stock-transfers",
        Feature::PurchaseOrders => "purchase-orders",
        Feature::SerialTracking => "serial-tracking",
        Feature::PromotionsEngine => "promotions-engine",
        Feature::ProductBundles => "product-bundles",
        Feature::KitchenDisplay => "kitchen-display",
        Feature::TableManagement => "table-management",
        Feature::SelfServiceKiosk => "self-service-kiosk",
        Feature::CloudSync => "cloud-sync",
        Feature::MultiStore => "multi-store",
        Feature::MultiTerminal => "multi-terminal",
        Feature::Reporting => "reporting",
        Feature::Analytics => "analytics",
        Feature::ExportImport => "export-import",
        Feature::PluginSystem => "plugin-system",
    }
}

/// Parse a kebab-case settings key suffix back to a [`Feature`].
///
/// Returns `None` if the suffix doesn't match any known feature.
pub fn feature_from_key(suffix: &str) -> Option<Feature> {
    match suffix {
        "simple-retail" => Some(Feature::SimpleRetail),
        "restaurant" => Some(Feature::Restaurant),
        "cash-payment" => Some(Feature::CashPayment),
        "card-payment" => Some(Feature::CardPayment),
        "multi-currency" => Some(Feature::MultiCurrency),
        "inventory-tracking" => Some(Feature::InventoryTracking),
        "product-variants" => Some(Feature::ProductVariants),
        "categories-enabled" => Some(Feature::CategoriesEnabled),
        "staff-login" => Some(Feature::StaffLogin),
        "staff-roles" => Some(Feature::StaffRoles),
        "shift-management" => Some(Feature::ShiftManagement),
        "audit-log" => Some(Feature::AuditLog),
        "barcode-scanning" => Some(Feature::BarcodeScanning),
        "receipt-printing" => Some(Feature::ReceiptPrinting),
        "cash-drawer" => Some(Feature::CashDrawer),
        "customer-display" => Some(Feature::CustomerDisplay),
        "nfc-reader" => Some(Feature::NfcReader),
        "usb-scale" => Some(Feature::UsbScale),
        "discount-engine" => Some(Feature::DiscountEngine),
        "tax-engine" => Some(Feature::TaxEngine),
        "loyalty-program" => Some(Feature::LoyaltyProgram),
        "gift-cards" => Some(Feature::GiftCards),
        "quick-return" => Some(Feature::QuickReturn),
        "stock-counting" => Some(Feature::StockCounting),
        "stock-transfers" => Some(Feature::StockTransfers),
        "purchase-orders" => Some(Feature::PurchaseOrders),
        "serial-tracking" => Some(Feature::SerialTracking),
        "promotions-engine" => Some(Feature::PromotionsEngine),
        "product-bundles" => Some(Feature::ProductBundles),
        "kitchen-display" => Some(Feature::KitchenDisplay),
        "table-management" => Some(Feature::TableManagement),
        "self-service-kiosk" => Some(Feature::SelfServiceKiosk),
        "cloud-sync" => Some(Feature::CloudSync),
        "multi-store" => Some(Feature::MultiStore),
        "multi-terminal" => Some(Feature::MultiTerminal),
        "reporting" => Some(Feature::Reporting),
        "analytics" => Some(Feature::Analytics),
        "export-import" => Some(Feature::ExportImport),
        "plugin-system" => Some(Feature::PluginSystem),
        _ => None,
    }
}

// ── Default ─────────────────────────────────────────────────────────────

impl Default for FeatureRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ── Feature Guards ──────────────────────────────────────────────────────

/// Runtime safety guard that can veto a feature being disabled.
///
/// Guards are checked **before** the feature is toggled off in the
/// kernel and persisted to the database. If any guard returns
/// `Err(reason)` for the feature being disabled, the toggle is
/// aborted and the error message is surfaced to the admin UI.
///
/// # Example
///
/// ```
/// use kasirmu_core::{Feature, FeatureGuard, KdsFeatureGuard};
/// use rusqlite::Connection;
///
/// let conn = Connection::open_in_memory().unwrap();
/// conn.execute_batch(
///     "CREATE TABLE IF NOT EXISTS kds_orders (
///         id TEXT PRIMARY KEY,
///         status TEXT NOT NULL DEFAULT 'pending'
///     );"
/// ).unwrap();
///
/// let guard = KdsFeatureGuard;
/// // No orders exist, so KitchenDisplay can be disabled safely.
/// assert!(guard.can_disable(Feature::KitchenDisplay, &conn).is_ok());
/// ```
pub trait FeatureGuard: Send + Sync {
    /// Return `Ok(())` if the feature can be disabled, or
    /// `Err(reason)` with an actionable message for the admin.
    fn can_disable(&self, feature: Feature, conn: &Connection) -> Result<(), String>;
}

/// Guard that prevents disabling `KitchenDisplay` while KDS tickets
/// are actively being prepared.
///
/// Queries the `kds_orders` table for orders with status `'pending'`
/// or `'preparing'`. If any exist, the feature cannot be safely
/// disabled because tickets will be orphaned.
#[derive(Debug, Clone, Copy)]
pub struct KdsFeatureGuard;

impl FeatureGuard for KdsFeatureGuard {
    fn can_disable(&self, feature: Feature, conn: &Connection) -> Result<(), String> {
        if feature != Feature::KitchenDisplay {
            return Ok(());
        }

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM kds_orders WHERE status IN ('pending', 'preparing')",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if count > 0 {
            Err(format!(
                "Cannot disable Kitchen Display while {count} ticket{} are actively in progress",
                if count == 1 { " is" } else { "s are" }
            ))
        } else {
            Ok(())
        }
    }
}

/// Guard that prevents disabling `ShiftManagement` while a shift is
/// still open and unreconciled.
///
/// Queries the `shifts` table for rows where `closed_at IS NULL`.
/// Active shifts must be closed before the feature can be turned off.
#[derive(Debug, Clone, Copy)]
pub struct ShiftFeatureGuard;

impl FeatureGuard for ShiftFeatureGuard {
    fn can_disable(&self, feature: Feature, conn: &Connection) -> Result<(), String> {
        if feature != Feature::ShiftManagement {
            return Ok(());
        }

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM shifts WHERE closed_at IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if count > 0 {
            Err(format!(
                "Cannot disable Shift Management while {} shift{} are actively open and unreconciled",
                count,
                if count == 1 { " is" } else { "s are" }
            ))
        } else {
            Ok(())
        }
    }
}

/// A registry of all active [`FeatureGuard`] instances.
///
/// `set_feature` calls `check_feature` before disabling a feature;
/// the registry runs every guard and collects all failures.
#[derive(Default)]
pub struct FeatureGuardRegistry {
    guards: Vec<Box<dyn FeatureGuard>>,
}

impl std::fmt::Debug for FeatureGuardRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FeatureGuardRegistry")
            .field("count", &self.guards.len())
            .finish()
    }
}

impl FeatureGuardRegistry {
    /// Create an empty registry with no guards.
    pub fn new() -> Self {
        Self { guards: Vec::new() }
    }

    /// Register a guard. Multiple guards can be registered; they are
    /// all checked independently during `check_feature`.
    pub fn register(&mut self, guard: Box<dyn FeatureGuard>) {
        self.guards.push(guard);
    }

    /// Check `feature` against all registered guards.
    ///
    /// Returns `Ok(())` if **all** guards approve. Returns
    /// `Err(reasons)` with **all** failure messages joined by `"; "`.
    pub fn check_feature(&self, feature: Feature, conn: &Connection) -> Result<(), String> {
        let failures: Vec<String> = self
            .guards
            .iter()
            .filter_map(|guard| guard.can_disable(feature, conn).err())
            .collect();

        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.join("; "))
        }
    }

    /// Number of registered guards.
    pub fn count(&self) -> usize {
        self.guards.len()
    }

    /// True when no guards have been registered.
    pub fn is_empty(&self) -> bool {
        self.guards.is_empty()
    }

    /// Create a registry pre-loaded with all built-in guards.
    ///
    /// Currently includes:
    /// - [`KdsFeatureGuard`] — protects open KDS tickets
    /// - [`ShiftFeatureGuard`] — protects unreconciled shifts
    pub fn new_with_defaults() -> Self {
        let mut registry = Self::new();
        registry.register(Box::new(KdsFeatureGuard));
        registry.register(Box::new(ShiftFeatureGuard));
        registry
    }
}

#[cfg(test)]
#[path = "features_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "features_proptests.rs"]
mod proptests;
