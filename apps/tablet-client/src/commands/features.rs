//! Feature flag management Tauri commands.
//!
//! Exposes `list_all_features` (returns all 32 features with enabled
//! status and metadata) and `set_feature` (toggle a single feature on
//! or off with automatic dependency resolution).
//!
//! The front-end consumes these via the Feature Toggle screen
//! (Settings → Features) so users can enable/disable capabilities
//! after the initial Setup Wizard.

use serde::{Deserialize, Serialize};
use tauri::{State, command};

use kasirmu_core::{Feature, Store, Terminal};

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

/// A single feature with its current state and metadata.
#[derive(Debug, Clone, Serialize)]
pub struct FeatureDto {
    /// Kebab-case key (e.g. "simple-retail").
    pub key: String,
    /// Human-readable display name.
    pub name: &'static str,
    /// Short description of what the feature provides.
    pub description: &'static str,
    /// Logical group (e.g. "Core", "Payments", "Products", etc.).
    pub group: &'static str,
    /// Whether this feature is currently enabled.
    pub enabled: bool,
    /// Kebab-case keys of features this one depends on.
    pub dependencies: Vec<String>,
}

/// Response from `list_all_features`.
#[derive(Debug, Serialize)]
pub struct ListAllFeaturesResult {
    /// All 32 features with metadata and enabled status.
    pub features: Vec<FeatureDto>,
}

/// Fetch every known feature with its current enabled status, metadata,
/// and dependency information.
///
/// The front-end renders this into the Feature Toggle screen.
#[command]
pub async fn list_all_features(
    state: State<'_, AppState>,
) -> Result<ListAllFeaturesResult, AppError> {
    let db = state.db.lock().await;
    run_list_all_features(&db)
}

/// Shared body for the ambient and session-scoped variants.
///
/// Extracted so the two cannot drift, matching this file's peers and `desktop-client`, which already
/// factors the same work into `build_feature_list`. Note the scoped variant below authenticates but
/// performs no permission check -- deliberately matching `desktop-client`'s
/// `list_all_features_scoped` (commands/features.rs:631), which also only calls `resolve_scope`.
/// Adding `SETTINGS_EDIT` here would make the two shells reject different callers.
fn run_list_all_features(db: &rusqlite::Connection) -> Result<ListAllFeaturesResult, AppError> {
    let store = Store::new(db);
    let reg = store.load_features()?;

    let features = all_feature_metadata()
        .into_iter()
        .map(|(feat, name, desc, group)| {
            let key = kasirmu_core::features::feature_key(feat).to_string();
            let deps: Vec<String> = feat
                .dependencies()
                .iter()
                .map(|d| kasirmu_core::features::feature_key(*d).to_string())
                .collect();
            FeatureDto {
                key,
                name,
                description: desc,
                group,
                enabled: reg.is_enabled(feat),
                dependencies: deps,
            }
        })
        .collect();

    Ok(ListAllFeaturesResult { features })
}

/// Session-scoped variant of [`list_all_features`] (ADR #7).
///
/// `desktop-client` has registered this since the ADR #7 sweep; tablet never defined it, so wiring
/// the UI to call it would have thrown there -- the same cross-shell asymmetry recorded in item 66,
/// in the opposite direction.
#[command]
pub async fn list_all_features_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<ListAllFeaturesResult, AppError> {
    let _session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    run_list_all_features(&db)
}

// ── Set feature ──────────────────────────────────────────────────────

/// Arguments for `set_feature`.
#[derive(Debug, Deserialize)]
pub struct SetFeatureArgs {
    /// Kebab-case key of the feature to toggle.
    pub key: String,
    /// Whether to enable (`true`) or disable (`false`).
    pub enabled: bool,
}

/// Response from `set_feature`.
#[derive(Debug, Serialize)]
pub struct SetFeatureResult {
    /// Whether the operation succeeded.
    pub success: bool,
    /// Updated list of all features (same shape as `list_all_features`).
    pub features: Vec<FeatureDto>,
    /// If the operation cascaded (auto-enabled dependencies), these were
    /// also enabled.
    pub auto_enabled: Vec<String>,
}

/// Enable or disable a single feature flag.
///
/// When enabling, all required dependencies are automatically enabled
/// as well. When disabling, only the specified feature is turned off
/// (dependents are NOT cascaded — the UI must handle that).
#[command]
pub async fn set_feature(
    session_token: String,
    args: SetFeatureArgs,
    state: State<'_, AppState>,
) -> Result<SetFeatureResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, kasirmu_core::permissions::SETTINGS_EDIT).await?;
    let feature = kasirmu_core::features::feature_from_key(&args.key)
        .ok_or_else(|| AppError::Invalid(format!("unknown feature key: {}", args.key)))?;

    // ── DB-scoped block: load, mutate, persist features ──────────
    // Store is !Send (wraps rusqlite Connection's RefCell), so we
    // must drop it before any subsequent .await point. Wrapping the
    // entire DB interaction in a block guarantees both the Store and
    // the MutexGuard are dropped before the terminal_id lock below.
    let (reg, auto_enabled) = {
        let db = state.db.lock().await;
        let store = Store::new(&db);

        let mut reg = store.load_features()?;
        let mut auto_enabled: Vec<String> = Vec::new();

        if args.enabled {
            // Before enabling, track what was already enabled.
            let before_enable: Vec<Feature> = reg.enabled_features().collect();

            // Enable the feature (this auto-enables dependencies).
            reg.enable(feature);

            // Auto-enable CloudSync when MultiTerminal is enabled (logical coupling:
            // cross-terminal sync requires the cloud sync backend).
            if feature == Feature::MultiTerminal && !reg.is_enabled(Feature::CloudSync) {
                reg.enable(Feature::CloudSync);
            }

            // Figure out what was newly auto-enabled.
            for f in reg.enabled_features() {
                if !before_enable.contains(&f) && f != feature {
                    auto_enabled.push(kasirmu_core::features::feature_key(f).to_string());
                }
            }
        } else {
            reg.disable(feature);
        }

        // Persist the updated registry and prune stale rows (from disabling).
        store.save_features(&reg)?;
        store.prune_stale_features(&reg)?;

        // Store and MutexGuard dropped here — no !Send types survive
        // past this block.
        (reg, auto_enabled)
    };

    // Auto-register this device as a terminal when MultiTerminal is enabled.
    // This ensures every POS device has a registered terminal entry for
    // cross-terminal inventory sync and Redis pub/sub filtering.
    if args.enabled && feature == Feature::MultiTerminal {
        let device_id = device_hostname();
        let mut tid = state.terminal_id.lock().await;
        // Re-acquire db for terminal lookup — must happen after terminal_id
        // lock to avoid holding !Send types across the await.
        let db = state.db.lock().await;
        let store = Store::new(&db);
        if store.get_terminal_by_device_id(&device_id)?.is_none() {
            let name = format!("{} (auto)", device_id);
            let terminal = Terminal::new(&name, &device_id);
            store.create_terminal(&terminal)?;
            *tid = Some(terminal.id.clone());
            tracing::info!(
                id = %terminal.id,
                name = %terminal.name,
                "terminal auto-registered for multi-terminal"
            );
        } else if tid.is_none()
            && let Some(existing) = store.get_terminal_by_device_id(&device_id)?
        {
            *tid = Some(existing.id);
        }
        drop(tid);
    }

    // Build the full feature list response.
    let features = all_feature_metadata()
        .into_iter()
        .map(|(feat, name, desc, group)| {
            let key = kasirmu_core::features::feature_key(feat).to_string();
            let deps: Vec<String> = feat
                .dependencies()
                .iter()
                .map(|d| kasirmu_core::features::feature_key(*d).to_string())
                .collect();
            FeatureDto {
                key,
                name,
                description: desc,
                group,
                enabled: reg.is_enabled(feat),
                dependencies: deps,
            }
        })
        .collect();

    Ok(SetFeatureResult {
        success: true,
        features,
        auto_enabled,
    })
}

// ── Set features bulk ───────────────────────────────────────────────

/// Arguments for `set_features_bulk`.
#[derive(Debug, Deserialize)]
pub struct SetFeaturesBulkArgs {
    /// Kebab-case keys of the features to toggle.
    pub keys: Vec<String>,
    /// Whether to enable (`true`) or disable (`false`) all given features.
    pub enabled: bool,
}

/// Enable or disable multiple feature flags atomically in a single
/// SQLite transaction.
///
/// Unlike `set_feature`, this bulk operation:
/// - Executes all changes in a single SQLite transaction
/// - Does NOT cascade auto-enable dependencies (each feature is toggled
///   individually; call `set_feature` if dependency resolution is needed)
/// - Returns `ListAllFeaturesResult` so the front-end can refresh its
///   display with a single response
///
/// This is intended for bulk group toggles in the Feature Toggle screen
/// (e.g. "Enable all Hardware", "Disable all Advanced").
#[command]
pub async fn set_features_bulk(
    session_token: String,
    args: SetFeaturesBulkArgs,
    state: State<'_, AppState>,
) -> Result<ListAllFeaturesResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, kasirmu_core::permissions::SETTINGS_EDIT).await?;
    let mut db = state.db.lock().await;

    // Start a SQLite transaction for atomicity.
    let tx = db.transaction().map_err(|e| {
        AppError::Internal(format!("failed to start transaction for bulk toggle: {e}"))
    })?;

    // Use Store within the transaction (Transaction derefs to Connection).
    let store = Store::new(&tx);
    let mut reg = store.load_features()?;

    // Parse and apply each key.
    for key in &args.keys {
        let feature = kasirmu_core::features::feature_from_key(key)
            .ok_or_else(|| AppError::Invalid(format!("unknown feature key: {key}")))?;

        if args.enabled {
            reg.enable(feature);
        } else {
            reg.disable(feature);
        }
    }

    // Persist and prune within the transaction.
    store.save_features(&reg)?;
    store.prune_stale_features(&reg)?;

    // Commit the transaction.
    tx.commit()
        .map_err(|e| AppError::Internal(format!("failed to commit bulk feature toggle: {e}")))?;

    let features = all_feature_metadata()
        .into_iter()
        .map(|(feat, name, desc, group)| {
            let key = kasirmu_core::features::feature_key(feat).to_string();
            let deps: Vec<String> = feat
                .dependencies()
                .iter()
                .map(|d| kasirmu_core::features::feature_key(*d).to_string())
                .collect();
            FeatureDto {
                key,
                name,
                description: desc,
                group,
                enabled: reg.is_enabled(feat),
                dependencies: deps,
            }
        })
        .collect();

    Ok(ListAllFeaturesResult { features })
}

/// Return a stable device identifier for this machine.
///
/// Uses `COMPUTERNAME` (Windows) or `HOSTNAME` (Unix) if available,
/// falling back to `"unknown-device"`. This identifier is used to
/// auto-register the terminal when multi-terminal mode is enabled.
fn device_hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown-device".to_string())
}

// ── Feature metadata ────────────────────────────────────────────────

/// Returns all 32 features with their human-readable name, description,
/// and logical group.
fn all_feature_metadata() -> Vec<(Feature, &'static str, &'static str, &'static str)> {
    vec![
        (
            Feature::SimpleRetail,
            "Simple Retail",
            "Core POS: scan, sell, print receipt",
            "Core",
        ),
        (
            Feature::Restaurant,
            "Restaurant Mode",
            "Table management and KDS",
            "Core",
        ),
        (
            Feature::CashPayment,
            "Cash Payment",
            "Accept cash at checkout",
            "Payments",
        ),
        (
            Feature::CardPayment,
            "Card Payment",
            "Accept debit/credit cards",
            "Payments",
        ),
        (
            Feature::MultiCurrency,
            "Multi-Currency",
            "Support multiple currencies with exchange rates",
            "Payments",
        ),
        (
            Feature::InventoryTracking,
            "Inventory Tracking",
            "Track stock levels per product",
            "Products",
        ),
        (
            Feature::ProductVariants,
            "Product Variants",
            "Size, colour, flavour variants",
            "Products",
        ),
        (
            Feature::CategoriesEnabled,
            "Categories",
            "Group products into categories",
            "Products",
        ),
        (
            Feature::StaffLogin,
            "Staff Login",
            "PIN/password login for staff",
            "Staff",
        ),
        (
            Feature::StaffRoles,
            "Staff Roles",
            "Role-based permissions (owner, manager, cashier)",
            "Staff",
        ),
        (
            Feature::ShiftManagement,
            "Shift Management",
            "Open/close shift with cash reconciliation",
            "Staff",
        ),
        (
            Feature::AuditLog,
            "Audit Log",
            "Immutable append-only action log",
            "Staff",
        ),
        (
            Feature::BarcodeScanning,
            "Barcode Scanning",
            "USB/serial/Bluetooth barcode scanner",
            "Hardware",
        ),
        (
            Feature::ReceiptPrinting,
            "Receipt Printing",
            "USB/serial/network receipt printer",
            "Hardware",
        ),
        (
            Feature::CashDrawer,
            "Cash Drawer",
            "Cash drawer trigger via printer GPIO",
            "Hardware",
        ),
        (
            Feature::CustomerDisplay,
            "Customer Display",
            "Secondary customer-facing screen",
            "Hardware",
        ),
        (
            Feature::NfcReader,
            "NFC Reader",
            "Contactless card/NFC reader",
            "Hardware",
        ),
        (
            Feature::DiscountEngine,
            "Discount Engine",
            "Percentage and fixed-amount discounts",
            "Business Rules",
        ),
        (
            Feature::TaxEngine,
            "Tax Engine",
            "Tax calculation with configurable rates",
            "Business Rules",
        ),
        (
            Feature::LoyaltyProgram,
            "Loyalty Program",
            "Customer points, tiers, and redemption",
            "Business Rules",
        ),
        (
            Feature::GiftCards,
            "Gift Cards",
            "Issue, redeem, and manage gift card balances",
            "Payments",
        ),
        (
            Feature::PromotionsEngine,
            "Promotions Engine",
            "Time-limited buy-X-get-Y and % off",
            "Business Rules",
        ),
        (
            Feature::ProductBundles,
            "Product Bundles",
            "Sell multiple SKUs as one bundle",
            "Business Rules",
        ),
        (
            Feature::KitchenDisplay,
            "Kitchen Display",
            "Order routing to kitchen screens",
            "Restaurant",
        ),
        (
            Feature::TableManagement,
            "Table Management",
            "Interactive restaurant floor plan",
            "Restaurant",
        ),
        (
            Feature::SelfServiceKiosk,
            "Self-Service Kiosk",
            "Locked-down fullscreen kiosk mode",
            "Restaurant",
        ),
        (
            Feature::CloudSync,
            "Cloud Sync",
            "Database synchronisation to cloud",
            "Scaling",
        ),
        (
            Feature::MultiStore,
            "Multi-Store",
            "Manage multiple store locations",
            "Scaling",
        ),
        (
            Feature::MultiTerminal,
            "Multi-Terminal",
            "Multiple terminals per store",
            "Scaling",
        ),
        (
            Feature::Reporting,
            "Reporting",
            "Sales, inventory, and shift reports",
            "Reporting",
        ),
        (
            Feature::Analytics,
            "Analytics",
            "Advanced charts and data exports",
            "Reporting",
        ),
        (
            Feature::ExportImport,
            "Export / Import",
            "Data export/import in .kasirpkg format",
            "Advanced",
        ),
        (
            Feature::PluginSystem,
            "Plugin System",
            "Third-party plugin support",
            "Advanced",
        ),
    ]
}

#[cfg(test)]
#[path = "features_tests.rs"]
mod tests;
