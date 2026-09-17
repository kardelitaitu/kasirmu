//! Feature-flag command bodies (Wave F) — the tauri-free half of
//! `apps/desktop-client/src/commands/features.rs`.
//!
//! Key items: the four feature commands, the feature DTOs, the feature metadata
//! table, the feature-to-kernel-module mapping, and `device_hostname`.
//!
//! Ports are verbatim: the `SETTINGS_EDIT` gates keep their kind and their
//! position after `resolve_session`, the bulk toggle keeps its single SQLite
//! transaction (`transaction` -> `save_features` -> `prune_stale_features` ->
//! `commit`) and both of its error strings, `set_feature` keeps its
//! guard-before-kernel-before-DB order including `drop(kernel)` before the DB
//! lock, and `device_hostname` still reads `COMPUTERNAME`/`HOSTNAME` from the
//! environment unchanged. The terminal identity is taken through the borrowed
//! [`BridgeCtx::terminal_id`] FIELD, never the async accessor, so no await point
//! appears where the original had none.

use serde::{Deserialize, Serialize};

use oz_core::{Feature, FeatureGuardRegistry, Store, Terminal};

use platform_kernel::ModuleStatus;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;
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
pub async fn list_all_features(ctx: &BridgeCtx<'_>) -> Result<ListAllFeaturesResult, BridgeError> {
    let db = ctx.lock_global().await;
    let store = Store::new(&db);
    let reg = store.load_features()?;

    let features = build_feature_list(&reg);
    Ok(ListAllFeaturesResult { features })
}

/// Build the full feature DTO list from a loaded registry.
fn build_feature_list(reg: &oz_core::FeatureRegistry) -> Vec<FeatureDto> {
    all_feature_metadata()
        .into_iter()
        .map(|(feat, name, desc, group)| {
            let key = oz_core::features::feature_key(feat).to_string();
            let deps: Vec<String> = feat
                .dependencies()
                .iter()
                .map(|d| oz_core::features::feature_key(*d).to_string())
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
        .collect()
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
/// - Does NOT run kernel module lifecycle (use individual `set_feature`
///   for module-backed features that need start/stop)
/// - Does NOT cascade auto-enable dependencies (each feature is toggled
///   individually; call `set_feature` if dependency resolution is needed)
/// - Returns `ListAllFeaturesResult` so the front-end can refresh its
///   display with a single response
///
/// This is intended for bulk group toggles in the Feature Toggle screen
/// (e.g. "Enable all Hardware", "Disable all Advanced").
pub async fn set_features_bulk(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: SetFeaturesBulkArgs,
) -> Result<ListAllFeaturesResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SETTINGS_EDIT)
        .await?;
    let mut db = ctx.lock_global().await;

    // Start a SQLite transaction for atomicity.
    let tx = db.transaction().map_err(|e| {
        BridgeError::Internal(format!("failed to start transaction for bulk toggle: {e}"))
    })?;

    // Use Store within the transaction (Transaction derefs to Connection).
    let store = Store::new(&tx);
    let mut reg = store.load_features()?;

    // Parse and apply each key.
    for key in &args.keys {
        let feature = oz_core::features::feature_from_key(key)
            .ok_or_else(|| BridgeError::Invalid(format!("unknown feature key: {key}")))?;

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
        .map_err(|e| BridgeError::Internal(format!("failed to commit bulk feature toggle: {e}")))?;

    let features = build_feature_list(&reg);
    Ok(ListAllFeaturesResult { features })
}

/// Enable or disable a single feature flag.
///
/// When enabling, all required dependencies are automatically enabled
/// as well. When disabling, only the specified feature is turned off
/// (dependents are NOT cascaded — the UI must handle that).
///
/// When the feature corresponds to a registered kernel module, the
/// module is started (on enable) or stopped (on disable) via
/// `kernel.start_module` / `kernel.stop_module`. Module lifecycle
/// failures are logged but do not prevent the feature toggle from
/// succeeding — the feature registry is persisted regardless.
pub async fn set_feature(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: SetFeatureArgs,
) -> Result<SetFeatureResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, oz_core::permissions::SETTINGS_EDIT)
        .await?;
    let feature = oz_core::features::feature_from_key(&args.key)
        .ok_or_else(|| BridgeError::Invalid(format!("unknown feature key: {}", args.key)))?;

    // ── Feature safety guards (before any changes) ────────────────
    //
    // For disable operations, run all registered FeatureGuards FIRST
    // to ensure the toggle won't leave the system in an unsafe state
    // (e.g. orphaned KDS tickets or unreconciled shifts). Guards are
    // checked before kernel lifecycle so that a guard rejection does
    // not leave a partially-stopped module.
    if !args.enabled {
        let db = ctx.lock_global().await;
        let guards = FeatureGuardRegistry::new_with_defaults();
        if let Err(reason) = guards.check_feature(feature, &db) {
            return Err(BridgeError::Invalid(reason));
        }
        drop(db);
    }

    // ── Kernel module lifecycle (before DB persist) ───────────────
    //
    // For features that map to a kernel module, we attempt the
    // start/stop next. This way, if the module fails to start,
    // the feature toggle is not persisted (preventing inconsistent
    // state where the DB says enabled but the module is not running).
    if let Some(module_id) = feature_to_module_id(feature) {
        let mut kernel = ctx.kernel.lock().await;
        if args.enabled {
            match kernel.start_module(module_id) {
                Ok(()) => {
                    tracing::info!(
                        module = module_id,
                        feature = %args.key,
                        "kernel module started via feature toggle"
                    );
                }
                Err(e) => {
                    // Module may already be started — that's fine.
                    let status = kernel.module_status(module_id);
                    if status != Some(ModuleStatus::Started) {
                        tracing::warn!(
                            module = module_id,
                            error = %e,
                            status = ?status,
                            "failed to start kernel module for feature, aborting toggle"
                        );
                        return Err(BridgeError::Internal(format!(
                            "failed to start module '{module_id}' for feature '{}': {e}",
                            args.key,
                        )));
                    }
                }
            }
        } else {
            match kernel.stop_module(module_id) {
                Ok(()) => {
                    tracing::info!(
                        module = module_id,
                        feature = %args.key,
                        "kernel module stopped via feature toggle"
                    );
                }
                Err(e) => {
                    let status = kernel.module_status(module_id);
                    if status != Some(ModuleStatus::Stopped)
                        && status != Some(ModuleStatus::Registered)
                    {
                        tracing::warn!(
                            module = module_id,
                            error = %e,
                            status = ?status,
                            "failed to stop kernel module for feature, aborting toggle"
                        );
                        return Err(BridgeError::Internal(format!(
                            "failed to stop module '{module_id}' for feature '{}': {e}",
                            args.key,
                        )));
                    }
                }
            }
        }
        // Release kernel lock before DB lock to avoid nested locking.
        drop(kernel);
    }

    // Acquire terminal_id BEFORE the db lock so the db MutexGuard
    // (which wraps a !Send Connection) never crosses an await point.
    let mut tid = ctx.terminal_id.lock().await;
    let db = ctx.lock_global().await;
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
                auto_enabled.push(oz_core::features::feature_key(f).to_string());
            }
        }
    } else {
        reg.disable(feature);
    }

    // Persist the updated registry and prune stale rows (from disabling).
    store.save_features(&reg)?;
    store.prune_stale_features(&reg)?;

    // Auto-register this device as a terminal when MultiTerminal is enabled.
    // This ensures every POS device has a registered terminal entry for
    // cross-terminal inventory sync and Redis pub/sub filtering.
    if args.enabled && feature == Feature::MultiTerminal {
        let device_id = device_hostname();
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
    }
    drop(tid);

    let features = build_feature_list(&reg);

    Ok(SetFeatureResult {
        success: true,
        features,
        auto_enabled,
    })
}

/// Return a stable device identifier for this machine.
///
/// Uses `COMPUTERNAME` (Windows) or `HOSTNAME` (Unix) if available,
/// falling back to `"unknown-device"`. This identifier is used to
/// auto-register the terminal when multi-terminal mode is enabled.
/// Map a [`Feature`] to its corresponding kernel module ID, if any.
///
/// Not all features have a dedicated kernel module — many are simple
/// flag toggles (e.g. `CashPayment`, `BarcodeScanning`) that only
/// affect UI rendering or payment routing. Only features backed by a
/// registered [`Module`](foundation::contracts::Module) are listed here.
pub fn feature_to_module_id(feature: Feature) -> Option<&'static str> {
    match feature {
        Feature::InventoryTracking => Some("inventory"),
        Feature::CategoriesEnabled => Some("inventory"),
        Feature::StaffLogin => Some("staff"),
        Feature::StaffRoles => Some("staff"),
        Feature::ShiftManagement => Some("staff"),
        Feature::Reporting => Some("reporting"),
        Feature::Analytics => Some("reporting"),
        Feature::TaxEngine => Some("tax"),
        Feature::SimpleRetail | Feature::Restaurant => Some("sales"),
        Feature::MultiCurrency => Some("currency"),
        _ => None,
    }
}

fn device_hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown-device".to_string())
}

// ── Feature metadata ────────────────────────────────────────────────

/// Returns all 32 features with their human-readable name, description,
/// and logical group.
pub fn all_feature_metadata() -> Vec<(Feature, &'static str, &'static str, &'static str)> {
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
        (
            Feature::StockCounting,
            "Stock Counting",
            "Periodic stock counting",
            "Inventory",
        ),
        (
            Feature::StockTransfers,
            "Stock Transfers",
            "Transfer stock between locations",
            "Inventory",
        ),
        (
            Feature::PurchaseOrders,
            "Purchase Orders",
            "Create and manage purchase orders",
            "Inventory",
        ),
        (
            Feature::SerialTracking,
            "Serial Tracking",
            "Track products by serial number",
            "Inventory",
        ),
        (
            Feature::QuickReturn,
            "Quick Return",
            "Fast return without original sale lookup",
            "Core",
        ),
        (
            Feature::UsbScale,
            "USB Scale",
            "USB-connected weight scale",
            "Hardware",
        ),
    ]
}

/// Session-scoped variant of [`list_all_features`].
pub async fn list_all_features_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<ListAllFeaturesResult, BridgeError> {
    let (_session, conn) = ctx.resolve_scope(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let reg = store.load_features()?;
    let features = build_feature_list(&reg);
    Ok(ListAllFeaturesResult { features })
}

#[cfg(test)]
#[path = "features_tests.rs"]
mod features_tests;
