//! Product catalog commands.
//!
//! `list_products` fetches all products with category names and stock
//! quantities from the database and returns them as a JSON array.
//! The front-end uses this to populate the product grid.

use tauri::{State, command};

use kasirmu_core::availability::UsageCounts;
use kasirmu_core::entitlements::Entitlements;
use kasirmu_core::{Money, Store};

use kasirmu_core::events::{ProductCreated, StockAdjusted};

use foundation::validate_not_empty;

use kasirmu_core::permissions;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

// Phase 3.3 T6: the product wire DTOs moved to the shared `kasirmu_bridge::products`
// module and are re-exported here, same as the desktop shell. `ProductDto`
// arrives with the three spec-0046b image fields the fork had dropped
// (`id`, `image_hash`, `images`) — the shared UI reads all three, and
// without `id` its image commands had no product id to pass. Both mapper
// sites below now populate them. Command bodies stay tablet-native.
pub use kasirmu_bridge::products::{
    AdjustStockArgs, CreateProductArgs, CreateProductResult, DeleteProductArgs, MoneyDto,
    ProductDto, SerialTrackRow, UpdateProductArgs, UpdateProductResult,
};

/// Project the store's image assignments into the wire DTO shape (spec 0046b).
fn image_dtos(
    images: &[kasirmu_core::db::products::ProductImage],
) -> Vec<kasirmu_bridge::products::ProductImageDto> {
    images
        .iter()
        .map(|img| kasirmu_bridge::products::ProductImageDto {
            slot: img.slot,
            hash: img.hash.clone(),
            position: img.position,
        })
        .collect()
}

// ── Adjust stock ────────────────────────────────────────────────────

/// Adjust stock for a product identified by SKU.
///
/// Positive `delta` restocks, negative `delta` removes stock.
/// Returns the new quantity on success.
#[deprecated(note = "use adjust_stock_scoped instead")]
#[allow(deprecated)]
#[command]
pub async fn adjust_stock(
    args: AdjustStockArgs,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    validate_not_empty("sku", &args.sku).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("reason", &args.reason).map_err(|e| AppError::Invalid(e.to_string()))?;
    if args.delta == 0 {
        return Err(AppError::Invalid("delta must be non-zero".into()));
    }

    // Scope the DB borrow so Store (which is !Send) is dropped before
    // the next .await point when we lock the kernel for event publishing.
    let new_qty = {
        let db = state.db.lock().await;
        let tid = state.terminal_id.lock().await.clone();
        let store = kasirmu_core::db::Store::new(&db).with_terminal_id(tid);
        #[allow(deprecated)]
        store.adjust_stock(&args.sku, args.delta)?
    };

    // Publish the StockAdjusted domain event so that subscribers
    // (AuditLogHandler, etc.) fire their side effects.
    {
        let event = StockAdjusted {
            sku: args.sku.clone(),
            delta: args.delta,
            new_qty,
            reason: args.reason.clone(),
        };

        let kernel = state.kernel.lock().await;
        let bus = kernel.event_bus();
        if let Err(e) = bus.publish(&event) {
            // Logged by the bus; do not fail the command.
            tracing::warn!(sku = %args.sku, error = %e, "event bus publish failed");
        }
    }

    tracing::info!(sku = %args.sku, delta = %args.delta, reason = %args.reason, new_qty, "stock adjusted");
    Ok(new_qty)
}

/// Fetch all products from the database.
///
/// Returns an array of product DTOs with category names and stock
/// status. The front-end calls this on mount to populate the product
/// lookup grid.
#[command]
pub async fn list_products(state: State<'_, AppState>) -> Result<Vec<ProductDto>, AppError> {
    let db = state.db.lock().await;
    run_list_products(&db)
}

/// R3: clamp an optional `(limit, offset)` window onto a row count.
///
/// Mirrors `paginate()` in `ui/src/utils/list-policy.ts` — the same
/// `start = offset`, `end = start + limit` arithmetic the UI pager uses — so
/// the two halves of the bounded list path cannot drift apart.
///
/// `None` for either bound means "unbounded", which is what preserves
/// today's behaviour for a caller that passes neither (every existing
/// caller, desktop included).
pub(crate) fn page_window(total: usize, limit: Option<u64>, offset: Option<u64>) -> (usize, usize) {
    let start = offset.unwrap_or(0).min(total as u64) as usize;
    let end = limit
        .map(|l| (start as u64).saturating_add(l))
        .unwrap_or(total as u64)
        .min(total as u64) as usize;
    (start, end.max(start))
}

/// Business logic for listing products (extracted for testing).
fn run_list_products(conn: &rusqlite::Connection) -> Result<Vec<ProductDto>, AppError> {
    let store = Store::new(conn);
    let products = store.list_products()?;
    map_products_to_dtos(&store, products)
}

/// Business logic for listing warehouse-tracked products only.
fn run_list_warehouse_products(conn: &rusqlite::Connection) -> Result<Vec<ProductDto>, AppError> {
    let store = Store::new(conn);
    let products = store.list_warehouse_products()?;
    map_products_to_dtos(&store, products)
}

/// Shared mapping from a vec of ProductWithDetails to ProductDto vec.
fn map_products_to_dtos(
    store: &Store<'_>,
    products: Vec<kasirmu_core::db::ProductWithDetails>,
) -> Result<Vec<ProductDto>, AppError> {
    // PROD-12/O-H14: batch-load tax rates for all products in one query,
    // replacing the N+1 per-product lookup (get_product_tax_rates_batch).
    let skus: Vec<String> = products.iter().map(|p| p.product.sku.to_string()).collect();
    let tax_rates = store.get_product_tax_rates_batch(&skus).unwrap_or_default();

    let dtos: Vec<ProductDto> = products
        .into_iter()
        .map(|pwd| {
            let cur_str = std::str::from_utf8(&pwd.product.price.currency.0)
                .unwrap_or("USD")
                .to_owned();
            ProductDto {
                id: pwd.product.id.clone(),
                sku: pwd.product.sku.to_string(),
                name: pwd.product.name,
                category: pwd.category_name,
                price: MoneyDto {
                    minor_units: pwd.product.price.minor_units,
                    currency: cur_str,
                },
                barcode: pwd.product.barcode.as_ref().map(|b| b.to_string()),
                in_stock: pwd.stock_qty.is_some_and(|q| q > 0),
                stock_qty: pwd.stock_qty,
                created_at: pwd.product.created_at,
                price_updated_at: pwd.product.price_updated_at,
                product_type: pwd.product.product_type.as_str().to_owned(),
                tax_rate_ids: tax_rates
                    .get(pwd.product.sku.as_str())
                    .cloned()
                    .unwrap_or_default(),
                cost_minor: pwd.product.cost_minor,
                brand: pwd.product.brand.clone(),
                rack_location: pwd.product.rack_location.clone(),
                notes: pwd.product.notes.clone(),
                unit: pwd.product.unit.clone(),
                is_active: pwd.product.is_active,
                default_supplier_id: pwd.product.default_supplier_id.clone(),
                popularity_score: pwd.popularity_score,
                image_hash: pwd.product.image_hash.clone(),
                images: Some(image_dtos(&pwd.images)),
            }
        })
        .collect();
    Ok(dtos)
}

// ── Lookup by barcode ────────────────────────────────────────────────

/// Business logic for barcode lookup (extracted for testing).
fn run_lookup_by_barcode(
    conn: &rusqlite::Connection,
    barcode: &str,
) -> Result<Option<ProductDto>, AppError> {
    let store = Store::new(conn);
    let pwd = store.lookup_product_with_details_by_barcode(barcode)?;
    map_pwd_to_dto(&store, pwd)
}

/// Business logic for SKU lookup (extracted for testing).
fn run_lookup_product_by_sku(
    conn: &rusqlite::Connection,
    sku: &str,
) -> Result<Option<ProductDto>, AppError> {
    let store = Store::new(conn);
    let pwd = store.get_product(sku)?;
    map_pwd_to_dto(&store, pwd)
}

/// Shared mapping from `ProductWithDetails` to `ProductDto`.
fn map_pwd_to_dto(
    store: &Store<'_>,
    pwd: Option<kasirmu_core::db::ProductWithDetails>,
) -> Result<Option<ProductDto>, AppError> {
    let tax_rate_ids = match pwd {
        Some(ref p) => store
            .get_product_tax_rates(p.product.sku.as_str())
            .unwrap_or_default(),
        None => vec![],
    };
    Ok(pwd.map(|pwd| {
        let cur_str = std::str::from_utf8(&pwd.product.price.currency.0)
            .unwrap_or("USD")
            .to_owned();
        ProductDto {
            id: pwd.product.id.clone(),
            sku: pwd.product.sku.to_string(),
            name: pwd.product.name,
            category: pwd.category_name,
            price: MoneyDto {
                minor_units: pwd.product.price.minor_units,
                currency: cur_str,
            },
            barcode: pwd.product.barcode.as_ref().map(|b| b.to_string()),
            in_stock: pwd.stock_qty.is_some_and(|q| q > 0),
            stock_qty: pwd.stock_qty,
            tax_rate_ids,
            product_type: pwd.product.product_type.as_str().to_owned(),
            created_at: pwd.product.created_at,
            price_updated_at: pwd.product.price_updated_at,
            cost_minor: pwd.product.cost_minor,
            brand: pwd.product.brand.clone(),
            rack_location: pwd.product.rack_location.clone(),
            notes: pwd.product.notes.clone(),
            unit: pwd.product.unit.clone(),
            is_active: pwd.product.is_active,
            default_supplier_id: pwd.product.default_supplier_id.clone(),
            popularity_score: pwd.popularity_score,
            image_hash: pwd.product.image_hash.clone(),
            images: Some(image_dtos(&pwd.images)),
        }
    }))
}

// ── Create product ──────────────────────────────────────────────────

// ── Update product ──────────────────────────────────────────────────

/// Map the PATCH-style attribute fields onto the core update struct.
///
/// Free function rather than an inherent impl: `UpdateProductArgs` is
/// re-exported from `kasirmu_bridge::products` (Phase 3.3 T6), and Rust does not
/// permit an inherent impl for a type defined in another crate.
fn to_update_attributes(args: &UpdateProductArgs) -> kasirmu_core::db::UpdateProductAttributes {
    kasirmu_core::db::UpdateProductAttributes {
        cost_minor: args.cost_minor,
        brand: args.brand.clone(),
        rack_location: args.rack_location.clone(),
        notes: args.notes.clone(),
        unit: args.unit.clone(),
        is_active: args.is_active,
        default_supplier_id: args.default_supplier_id.clone(),
    }
}

/// Business logic for the batch serial-tracking lookup (extracted for testing).
fn run_get_product_track_serial_batch(store: &Store<'_>, skus: &[String]) -> Vec<SerialTrackRow> {
    skus.iter()
        .map(|sku| {
            // get_product returns Result<Option<ProductWithDetails>> —
            // collapse both error and missing-product into `false` so the
            // batch never fails for unknown SKUs (matches single-SKU).
            let track_serial = store
                .get_product(sku)
                .ok()
                .flatten()
                .map(|p| p.product.track_serial)
                .unwrap_or(false);
            SerialTrackRow {
                sku: sku.clone(),
                track_serial,
            }
        })
        .collect()
}

// ── Popularity search signal (ADR #37) ──────────────────────────────

// ── Delete product ──────────────────────────────────────────────────

/// Session-scoped variant of `adjust_stock`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn adjust_stock_scoped(
    session_token: String,
    args: AdjustStockArgs,
    state: State<'_, AppState>,
) -> Result<i64, AppError> {
    validate_not_empty("sku", &args.sku).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("reason", &args.reason).map_err(|e| AppError::Invalid(e.to_string()))?;
    if args.delta == 0 {
        return Err(AppError::Invalid("delta must be non-zero".into()));
    }

    // Get terminal_id before acquiring the DB lock (await must not be
    // inside a block that holds a std::sync::MutexGuard, which is !Send).
    let tid = state.terminal_id.lock().await.clone();

    // Scope the DB borrow so Store (which is !Send) is dropped before
    // the next .await point when we lock the kernel for event publishing.
    let new_qty = {
        let (_session, conn_arc) = state.resolve_scope(&session_token)?;
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let db = &*db_guard;
        let store = kasirmu_core::db::Store::new(&db).with_terminal_id(tid);
        #[allow(deprecated)]
        store.adjust_stock(&args.sku, args.delta)?
    };

    // Publish the StockAdjusted domain event so that subscribers
    // (AuditLogHandler, etc.) fire their side effects.
    {
        let event = StockAdjusted {
            sku: args.sku.clone(),
            delta: args.delta,
            new_qty,
            reason: args.reason.clone(),
        };

        let kernel = state.kernel.lock().await;
        let bus = kernel.event_bus();
        if let Err(e) = bus.publish(&event) {
            // Logged by the bus; do not fail the command.
            tracing::warn!(sku = %args.sku, error = %e, "event bus publish failed");
        }
    }

    tracing::info!(sku = %args.sku, delta = %args.delta, reason = %args.reason, new_qty, "stock adjusted");
    Ok(new_qty)
}

/// Session-scoped variant of `list_products`.
///
/// R3: `limit` and `offset` are **optional and additive**. A caller that
/// passes neither gets the whole catalog, byte-identical to before — which is
/// what every existing caller (the desktop shell's own body, the catalog
/// cache, the KDS picker, the kiosk grid) relies on. The return type is
/// deliberately UNCHANGED for the same reason: the door is shared with
/// `apps/desktop-tauri`, so a page envelope here would break that shell's
/// bare-array contract at runtime.
///
/// What the bounds buy is the thing R3 asks for: the IPC payload and the
/// renderer's copy are capped at `limit` rows instead of the whole catalog.
///
/// # KNOWN LIMITATION — the DB read is unbounded (DEFERRED)
///
/// This window is applied in Rust, AFTER `Store::list_products` has read and
/// materialised every row. So the **IPC payload and the renderer are bounded,
/// the query is not**: peak memory inside this command is still the whole
/// catalog. Closing it means a LIMIT/OFFSET in `kasirmu-core`, and that is
/// deferred because it is NOT additive there:
///
/// * `Store::list_products(&self) -> Result<Vec<ProductWithDetails>, CoreError>`
///   (`crates/kasirmu-core/src/db/products_crud.rs:47`) has no bound parameters,
///   and it has ~40 call sites across `apps/`, `crates/`, `platform/` and
///   `cli/` (plus core's own integration tests) — every one of which would need
///   `None, None` threading. A new sibling `list_products_paged(limit, offset)`
///   would be additive and safe; changing this signature is not.
/// * The precedent for the sibling already exists in core and should be
///   mirrored, not invented: `Store::list_sales_for_customer` does a real
///   `LIMIT ?2 OFFSET ?3` (`crates/kasirmu-core/src/db/sales_crud.rs:432`) and
///   `Store::search_customers` clamps its page to `[1, 100]`
///   (`crates/kasirmu-core/src/db/customers.rs:118-125`).
///
/// Why the deferral is survivable for now: the catalog is entitlement-capped
/// upstream — `SubscriptionTier::max_products()` returns `Some(10_000)` for
/// Premium (`crates/kasirmu-core/src/subscription.rs:211`), and `None` for
/// Enterprise (`:212`), i.e. **unlimited**. So 10k is the realistic ceiling on
/// Premium and this deferral is honest there; on Enterprise the read is
/// genuinely unbounded and the sibling method above is the fix that matters.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_products_scoped(
    session_token: String,
    limit: Option<u64>,
    offset: Option<u64>,
    state: State<'_, AppState>,
) -> Result<Vec<ProductDto>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let mut products = run_list_products(&db)?;
    let (start, end) = page_window(products.len(), limit, offset);
    Ok(products.drain(start..end).collect())
}

/// Fetch warehouse-tracked products only (excludes services) resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_warehouse_products_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProductDto>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    run_list_warehouse_products(&db)
}

/// Look up a single product by barcode resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn lookup_by_barcode_scoped(
    session_token: String,
    barcode: String,
    state: State<'_, AppState>,
) -> Result<Option<ProductDto>, AppError> {
    validate_not_empty("barcode", &barcode).map_err(|e| AppError::Invalid(e.to_string()))?;
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let _store = Store::new(&db);
    let result = run_lookup_by_barcode(&db, &barcode);
    drop(db);
    result
}

/// Look up a single product by SKU resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn lookup_product_by_sku_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<Option<ProductDto>, AppError> {
    validate_not_empty("sku", &sku).map_err(|e| AppError::Invalid(e.to_string()))?;
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let _store = Store::new(&db);
    let result = run_lookup_product_by_sku(&db, &sku);
    drop(db);
    result
}

/// Create product resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn create_product_scoped(
    session_token: String,
    args: CreateProductArgs,
    state: State<'_, AppState>,
) -> Result<CreateProductResult, AppError> {
    // R10 gate-KIND + gate-ORDER, 2026-09-25: the session and BOTH gates are resolved
    // BEFORE the scope block opens the store, and with the scope-aware form the bridge
    // twin uses (`kasirmu-bridge/src/products.rs:668`, `:674`). The gates are `await`s,
    // so they cannot live inside the block that exists to keep `Store` (!Send) off an
    // await point — that constraint is exactly why the old code gated after opening the
    // store, and why the store was opened for callers who were never authorised.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PRODUCTS_CREATE).await?;
    // ADR #36 D7: setting a cost (HPP) requires the manager-only
    // products:edit_cost permission — staff can create products without
    // ever touching cost.
    if args.cost_minor != 0 {
        require_permission_for_session(&state, &session, permissions::PRODUCTS_EDIT_COST).await?;
    }

    // Scope the DB borrow so Store (which is !Send) is dropped before
    // the next .await point when we lock the kernel for event publishing.
    {
        let conn_arc = state.resolve_store(&session_token)?;
        // Quota: the tier's product/menu cap (subscription-tiers.md
        // §Numeric Limits) is enforced per-location catalog before
        // creation. Tier from the global identity DB, count from the
        // scoped store DB.
        let sub = {
            let global_db = state.db.lock().await;
            kasirmu_core::TenantSubscription::validate_clock_rollback(&global_db)?;
            kasirmu_core::TenantSubscription::load(&global_db, "default")?
                .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?
        };
        sub.verify_signature()?;
        let db_guard = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let db = &*db_guard;
        let store = Store::new(&db);

        store.enforce_product_quota(
            &Entitlements::from_subscription(&sub, UsageCounts::default()).tier,
        )?;

        let currency: kasirmu_core::Currency = args
            .currency
            .parse()
            .map_err(|_| AppError::Invalid(format!("invalid currency '{}'", args.currency)))?;

        let price = Money {
            minor_units: args.price_minor,
            currency,
        };

        store.create_product_with_attributes(
            &args.sku,
            &args.name,
            price,
            args.category_id.as_deref(),
            args.barcode.as_deref(),
            args.initial_stock,
            Some(&args.product_type),
            &kasirmu_core::db::CreateProductAttributes {
                cost_minor: args.cost_minor,
                brand: args.brand.clone(),
                rack_location: args.rack_location.clone(),
                notes: args.notes.clone(),
                unit: args.unit.clone(),
                is_active: args.is_active,
                default_supplier_id: args.default_supplier_id.clone(),
            },
        )?;

        store.set_product_tax_rates(&args.sku, &args.tax_rate_ids)?;
    } // db and store dropped here before .await

    // Publish the ProductCreated domain event so that subscribers
    // (AuditLogHandler, etc.) fire their side effects.
    {
        let event = ProductCreated {
            sku: args.sku.clone(),
            name: args.name.clone(),
            price_minor: args.price_minor,
            currency: args.currency.clone(),
            category_id: args.category_id.clone(),
            barcode: args
                .barcode
                .as_ref()
                .and_then(|s| foundation::Barcode::new(s).ok()),
            initial_stock: args.initial_stock,
        };

        let kernel = state.kernel.lock().await;
        let bus = kernel.event_bus();
        if let Err(e) = bus.publish(&event) {
            // Logged by the bus; do not fail the command.
            tracing::warn!(sku = %args.sku, error = %e, "event bus publish failed");
        }
    }

    tracing::info!(sku = %args.sku, name = %args.name, "product created");
    Ok(CreateProductResult { sku: args.sku })
}

/// Update product resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_product_scoped(
    session_token: String,
    args: UpdateProductArgs,
    state: State<'_, AppState>,
) -> Result<UpdateProductResult, AppError> {
    // R10 gate-KIND + gate-ORDER, 2026-09-25: adopt the scope-aware form the bridge twin
    // uses (`kasirmu-bridge/src/products.rs:889`, `:895`) and run BOTH gates BEFORE the
    // store is opened. The cost gate is conditional, so it has to be asked here rather
    // than hoisted into a helper.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PRODUCTS_UPDATE).await?;
    // ADR #36 D7: changing a product's cost (HPP) requires the manager-only
    // products:edit_cost permission. A PATCH that does not touch cost
    // (cost_minor absent) stays open to PRODUCTS_UPDATE holders.
    if args.cost_minor.is_some() {
        require_permission_for_session(&state, &session, permissions::PRODUCTS_EDIT_COST).await?;
    }
    let conn_arc = state.resolve_store(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);

    let currency: kasirmu_core::Currency = args
        .currency
        .parse()
        .map_err(|_| AppError::Invalid(format!("invalid currency '{}'", args.currency)))?;

    let price = Money {
        minor_units: args.price_minor,
        currency,
    };

    store.update_product(
        &args.sku,
        &args.name,
        price,
        args.category_id.as_deref(),
        args.barcode.as_deref(),
        args.product_type.as_deref(),
        None,
    )?;

    store.set_product_tax_rates(&args.sku, &args.tax_rate_ids)?;

    store.update_product_attributes(&args.sku, &to_update_attributes(&args))?;

    Ok(UpdateProductResult { sku: args.sku })
}

/// Check whether a product tracks serial numbers resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_product_track_serial_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let product = store.get_product(&sku)?;
    drop(db);
    Ok(product.map(|p| p.product.track_serial).unwrap_or(false))
}

/// Check serial-tracking flags for many SKUs in one round trip resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_product_track_serial_batch_scoped(
    session_token: String,
    skus: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<SerialTrackRow>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let rows = run_get_product_track_serial_batch(&store, &skus);
    drop(db);
    Ok(rows)
}

/// Record an acted-upon product search for the popularity index resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn record_product_search_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    match store.record_product_search(&sku) {
        Ok(()) => {}
        Err(e) => {
            tracing::warn!(sku = %sku, error = %e, "product search signal not recorded");
        }
    }
    drop(db);
    Ok(())
}

/// Delete product resolved from a session token. ADR #7.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn delete_product_scoped(
    session_token: String,
    args: DeleteProductArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // R10 gate-KIND + gate-ORDER, 2026-09-25: adopt the scope-aware form the bridge twin
    // uses (`kasirmu-bridge/src/products.rs:1006`) and run it BEFORE the store is opened.
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PRODUCTS_DELETE).await?;
    let conn_arc = state.resolve_store(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    store.delete_product(&args.sku)?;
    Ok(())
}

#[cfg(test)]
#[path = "products_tests.rs"]
mod tests;
