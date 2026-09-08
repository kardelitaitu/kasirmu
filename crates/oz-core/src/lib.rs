/*
last audited DD-MM-YY by DSH-Agent (verify + delta)
crate: oz-core | status: SAFE | lint: CLEAN
findings: zero unsafe verified (#![deny(unsafe_code)] holds); baseline claims re-verified. COR-1 FIXED DD-MM-YY — UUID-v7 field docs updated across 13 production files (swept audit/ cash_payout/ kds/ offline/ payment/ product_bundle/ product_variant/ promotion/ purchase_order/ shift/ supplier/ sync_pull/ table). COR-3 FIXED DD-MM-YY — config_validator redacts userinfo from DATABASE_URL and REDIS_URL before logging (redact_url helper, tested). COR-6 FIXED DD-MM-YY — mislabeled SAFETY comments reworded to plain comments in db/profile.rs (the COR-6 pattern). Delta files (edc_terminals, loyalty, profile, staff, migrations) reviewed: no new unsafe or production unwrap/expect concerns.
next: none — all open COR findings from the closed campaign resolved | perf: N/A
*/

//! Domain types for OZ-POS.
//!
//! `oz-core` is the foundation crate of the framework. It contains the
//! types every other crate builds on: [`Money`] and [`Currency`] for
//! pricing, [`Cart`] and [`CartLine`] for the sale pipeline, [`Sku`] and
//! [`LineId`] identifiers, the SQL [`migrations`] runner, and the
//! domain-level error type [`CoreError`].
//!
//! Rules enforced here (see `AGENTS.md` for the full policy):
//!
//! - **Money is always `i64` minor units.** Never `f32`/`f64`.
//! - **All public items have `///` docs.** Library consumers depend on them.
//! - **`#![deny(unsafe_code)]`** is on; open a discussion before adding `unsafe`.
//! - **`missing_docs` is warned** via `[lints] workspace = true` in
//!   `Cargo.toml`, inherited from `[workspace.lints]`; new public items must
//!   be documented.

#![deny(unsafe_code)]

/// Immutable audit log — cash management and data-modification events.
pub mod audit;
/// Authentication and session management.
pub mod auth;
/// Feature-availability verdicts — *why* a feature is unavailable.
pub mod availability;
/// In-memory and Redis-backed caching.
pub mod cache;
/// Open cart and checkout session.
pub mod cart;
/// Cash-in / cash-out drawer transactions.
pub mod cash_payout;
/// Product category tree.
pub mod category;
/// Startup configuration validator — checks env vars before the app boots.
pub mod config_validator;
/// Cryptographic helpers — encrypt sensitive data at rest.
pub mod crypto;
/// Customer profiles and contact data.
pub mod customer;
/// SQLite data access layer — one module per domain aggregate.
pub mod db;
/// Downgrade assessment — which existing resources exceed a lower tier's quotas.
pub mod downgrade;
/// Domain error types.
pub mod error;
/// Domain event types for cross-crate communication.
pub mod events;
// Note: ExchangeRateRow re-exported from `modules-currency`.
// The old `pub mod exchange_rate` shim was removed in R2 Phase 4.
// Import directly from `modules_currency::ExchangeRateRow`.
/// Feature-gate registry and runtime guards.
pub mod entitlements;
/// Unified analytics export — JSON bundle of all report types.
pub mod export;
pub mod features;
/// Gift cards — issue, redeem, top-up, freeze, balance checks.
pub mod gift_card;
/// Stock-on-hand queries and reservation.
pub mod inventory;
/// Inventory audit transactions (ADR-18 §9a + §9b; ADR-19 §3.2).
pub mod inventory_transaction;
/// Kitchen Display System order pipeline.
pub mod kds;
/// Organization/Tenant legal business identity.
pub mod legal_entity;
/// License server client — verify, activate, renew subscriptions (ADR #9).
pub mod license_verification;
/// Location profile settings.
pub mod location_profile;
/// Workspace-to-location resolution — which inventory location should a POS deduct from? (ADR-19 §4).
pub mod location_resolver;
/// Loyalty program — points, tiers, and redemption.
pub mod loyalty;
/// Memo lifecycle — status/delivery state machines, duration, and stop rule.
pub mod memo;
/// SQL migration definitions embedded at compile time.
pub mod migrations;
/// Money and currency primitives (re-exported from `foundation`).
pub mod money;
/// Offline queue — queued mutations for sync when connectivity returns.
pub mod offline;
/// OZ-POS package metadata reader (`.ozpkg` bundles).
pub mod ozpkg;
/// Accounts Payable (Hutang) domain model — status machine and row shapes.
pub mod payable;
/// Payment processing and split-tender allocation.
pub mod payment;
/// Product popularity scoring (ADR #37) — pure decayed/smoothed blend.
pub mod popularity;
/// Product catalog — SKU, price, type, metadata.
pub mod product;
/// Product bundles — sell multiple SKUs as one item.
pub mod product_bundle;
/// Product variants — sizes, colours, options.
pub mod product_variant;
/// Discount and promotion rules.
pub mod promotion;
/// Promotion discount engine — pure, fail-closed discount computation.
pub mod promotion_engine;
/// Purchase orders — order stock from suppliers.
pub mod purchase_order;
/// Sliding-window rate limiter for login PIN attempts.
pub mod rate_limiter;
/// Product recipes — bill-of-materials for make-from-scratch items.
pub mod recipe;
/// Refund and return processing.
pub mod refund;
/// Completed sale records and sale-line items.
pub mod sale;
/// Sale-deduction result types — CompleteSaleResult vs PartialStockResult (ADR-19 §2).
pub mod sale_deduction;
/// Service health contracts — shared state vocabulary for license, sync,
/// payment and device connectivity, and the license-server classifier.
pub mod service_health;
/// Active user session state.
pub mod session;
/// Persistent key-value settings store.
pub mod settings;
/// Cashier shift open/close and float management.
pub mod shift;
/// Stock-keeping unit identifier.
pub mod sku;
/// Stock-count and inventory adjustment.
pub mod stock_count;
/// Inter-store stock transfers.
pub mod stock_transfer;
/// Tenant subscription and license state.
pub mod subscription;
/// Supplier directory.
pub mod supplier;
/// LAN peer discovery for offline sync.
pub mod sync;
/// Pending-sync push/pull client.
pub mod sync_client;
/// Restaurant table management — floor plan positions and statuses.
pub mod table;
/// Tax-rate catalog.
pub mod tax_rate;
/// Registered terminal device.
pub mod terminal;
/// Per-terminal feature overrides per store.
pub mod terminal_override;
/// Terminal profile configuration.
pub mod terminal_profile;
/// Semantic validation for the topology graph (ADR #34 contract gates).
pub mod topology;
/// Staff user accounts and role-based access control.
pub mod user;
/// Per-user display preferences (card size, font size, etc.).
pub mod user_preferences;

/// Generate a new time-ordered UUIDv7 primary key.
///
/// UUIDv7 embeds a millisecond-precision timestamp in the high bits,
/// providing better B-tree index locality in SQLite and preventing
/// ID collisions when multiple offline registers generate IDs
/// independently (ADR #6).
///
/// Use this helper for all new entity IDs. Avoid `Uuid::new_v4()`
/// in production code.
#[must_use]
pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// Default optimistic concurrency version (ADR #6).
///
/// Used as the `#[serde(default)]` value for [`Product::version`]
/// and [`Sale::version`] so that deserialization from pre-migration
/// payloads succeeds.
#[doc(hidden)]
pub fn default_version() -> i64 {
    1
}

pub use audit::{AuditEntry, AuditReviewCheckpoint};
#[cfg(feature = "cache-redis")]
pub use cache::redis_cache::RedisCache;
pub use cache::{Cache, NoopCache, create_cache};
pub use cart::{Cart, CartError, CartId, CartLine};
pub use cash_payout::CashPayout;
pub use category::Category;
pub use customer::Customer;
pub use db::plans::TenantPlan;
pub use db::reports::{
    CategoryBreakdownRow, DailyRevenueRow, HourlyHeatmapRow, LowStockAlert, MonthlyRevenueRow,
    StockAlertEvent, TopProductRow, WeeklyRevenueRow,
};
pub use db::{ProductWithDetails, RemoteSyncFailure, Store};
pub use error::{CoreError, CoreErrorKind};
pub use features::{
    Feature, FeatureGuard, FeatureGuardRegistry, FeatureRegistry, KdsFeatureGuard,
    ShiftFeatureGuard,
};
pub use foundation;
pub use foundation::{InvalidTransition, SaleStatus};
pub use gift_card::{
    GiftCard, GiftCardFilter, GiftCardTransaction, GiftCardWithTransactions, IssueGiftCardInput,
    RedeemGiftCardResult,
};
pub use inventory::{
    CANONICAL_DEFAULT_LOCATION_UUID, Inventory, InventoryLocation, InventoryShift, LocationId,
    StockThreshold, WorkspaceInventoryLocation,
};
pub use inventory_transaction::{
    InventoryTransaction, InventoryTransactionId, InventoryTransactionLine,
    InventoryTransactionType,
};
pub use kds::{
    CreateKdsLineItemInput, CreateKdsOrderInput, KdsLineItem, KdsModifier, KdsOrder, KdsStatus,
    RegisterKdsDeviceInput, UpdateKdsOrderItemsInput,
};
pub use legal_entity::{LegalEntity, UpdateLegalEntity};
pub use location_profile::LocationProfile;

/// Deprecated compatibility alias for the pre-Phase 1 site-unit name.
#[deprecated(note = "use LocationProfile; Store is now Location")]
pub type StoreProfile = LocationProfile;
pub use location_resolver::{
    get_default_location_id, resolve_all_locations, resolve_location_chain_for_sku,
    resolve_primary_location,
};
pub use loyalty::{LoyaltyAccount, LoyaltyAccountWithDetails, LoyaltyTier, LoyaltyTransaction};
pub use money::{Currency, Money, format_minor};
pub use offline::{OfflineQueueItem, OfflineQueueStatus, SyncPriority};
pub use payment::{Payment, PaymentSplitArg};
pub use platform_core::permission_registry;
pub use platform_core::rbac::{AuthorizationError, has_permission, permissions};
pub use product::{Product, ProductType};
pub use product_bundle::{BundleItem, BundleWithItems, ProductBundle};
pub use product_variant::ProductVariant;
pub use promotion::{Promotion, PromotionApplication, PromotionType};
pub use promotion_engine::{compute_discount, compute_discount_unscoped};
pub use purchase_order::{PurchaseOrder, PurchaseOrderLine, PurchaseOrderWithLines};
pub use rate_limiter::LoginRateLimiter;
pub use recipe::RecipeItem;
pub use refund::{Refund, RefundLine};
pub use sale::{Sale, SaleLine};
pub use sale_deduction::{
    CompleteSaleResult, LocationAllocation, LocationStock, PartialStockResult, ResolvedShortfall,
    Shortfall, StockDeduction,
};
pub use settings::Settings;
pub use shift::Shift;
pub use sku::{LineId, Sku};
pub use stock_count::{CountType, StockAdjustment, StockCount, StockCountLine, StockCountStatus};
pub use stock_transfer::{StockTransfer, StockTransferLine};
pub use subscription::{InstanceStatus, SubscriptionTier, TenantSubscription};
pub use supplier::Supplier;
pub use sync_client::{
    PingResult, PullResult, Snapshot, SyncAttemptResult, SyncConfig, SyncHttpError,
    TerminalRegistrationResult, TokenResult, admin_key_from_env, apply_snapshot,
    apply_sync_outcomes, fetch_snapshot_from_server, mark_all_failed, mint_token,
    persist_refreshed_api_key, ping_server, register_terminal, request_refresh_token,
    request_token, request_token_client_credentials, send_items_to_server, sync_pending,
};
pub use table::{Table, TableStatus};
pub use terminal::Terminal;
pub use terminal_override::TerminalFeatureOverride;
pub use terminal_profile::TerminalProfile;
pub use user::{Role, User, builtin_roles, seed_users};
pub use user_preferences::UserPreferences;
