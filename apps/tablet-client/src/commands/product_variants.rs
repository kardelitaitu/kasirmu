//! Product variant Tauri commands.
//!
//! CRUD operations for product variants (size, colour, flavour).
//! Each variant is linked to a parent product via `parent_sku` and has
//! its own SKU, optional price override, and barcode.
//!
//! # ADR #49 status — measured 2026-09-16, `verify-body-parity.py` → **3 / 5**
//!
//! All five twins are **renamed** (`list_product_variants_scoped` →
//! `list_scoped`), so a parity run needs `--map` or it compares nothing at all
//! and reports the doors as `shell-only` facing five `bridge-only` twins.
//!
//! **Three doors are ported** — [`list_product_variants_scoped`],
//! [`get_product_variant_scoped`] and [`delete_product_variant_scoped`]. Their
//! bodies were already statement-identical, and each names a permission
//! (`PRODUCTS_READ` / `PRODUCTS_READ` / `PRODUCTS_DELETE`), so all three are
//! case 1 and the delegation is ledger-neutral. Note the twins' argument order:
//! the payload comes **first** and `session_token` **last**
//! (`crates/kasirmu-bridge/src/product_variants.rs:160-164`), the reverse of most
//! modules in this campaign — a straight copy of the usual call shape will not
//! compile.
//!
//! **Two doors are REFUSED on the log text, and nothing else.**
//! [`create_product_variant_scoped`] and [`update_product_variant_scoped`] are
//! otherwise statement-identical to their twins — same validation, same `Money`
//! parse, same store call — but the bridge appends `" (scoped)"` where this
//! shell logs `"product variant created"` (`:133` vs
//! `crates/kasirmu-bridge/src/product_variants.rs:316`) and `"product variant
//! updated"` (`:188` vs `:386`). §4 pins log text byte-identical, so these are a
//! **decision rather than work**: reconcile the suffix and both become
//! whole-body moves.
//!
//! [`delete_product_variant_scoped`] is the control case: its log line matches
//! on both sides (`:212` / `:248`), which is exactly why it ports while its two
//! siblings do not.

use tauri::{State, command};

use oz_core::permissions;
use oz_core::{Money, ProductVariant, Store};

use foundation::validate_not_empty;

use crate::commands::authz::require_permission_for_session;
use crate::error::AppError;
use crate::state::AppState;

// Phase 3.3 T6: the variant wire DTOs and their `From<ProductVariant>` impl
// moved to the shared `oz_bridge::product_variants` module and are
// re-exported here, same as the desktop shell. Command bodies stay
// tablet-native.
pub use oz_bridge::product_variants::{
    CreateProductVariantArgs, CreateProductVariantResult, MoneyDto, ProductVariantDto,
    UpdateProductVariantArgs, UpdateProductVariantResult,
};

// ── List ──────────────────────────────────────────────────────────────

// ── Get by SKU ────────────────────────────────────────────────────────

// ── Create ────────────────────────────────────────────────────────────

// ── Update ────────────────────────────────────────────────────────────

// ── Delete ────────────────────────────────────────────────────────────

/// List all variants for a given parent product SKU resolved from a session token. ADR #7.
///
/// # ADR #49 — ported 2026-09-16
///
/// Delegates to [`oz_bridge::product_variants::list_scoped`]. The body was
/// statement-identical and the gate is `PRODUCTS_READ` on both sides, so the
/// move is ledger-neutral. Argument order follows the twin: payload first,
/// `session_token` last.
#[command]
pub async fn list_product_variants_scoped(
    session_token: String,
    parent_sku: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProductVariantDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::product_variants::list_scoped(&ctx, &parent_sku, &session_token)
        .await
        .map_err(Into::into)
}

/// Get a single variant by its own SKU resolved from a session token. ADR #7.
///
/// # ADR #49 — ported 2026-09-16
///
/// Delegates to [`oz_bridge::product_variants::get_scoped`]; the body was
/// statement-identical and the gate is `PRODUCTS_READ` on both sides, so the
/// move is ledger-neutral.
#[command]
pub async fn get_product_variant_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<Option<ProductVariantDto>, AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::product_variants::get_scoped(&ctx, &sku, &session_token)
        .await
        .map_err(Into::into)
}

/// Create a new product variant resolved from a session token. ADR #7.
///
/// # ADR #49 NOT APPLIED, deliberately — the log line is the only obstacle
///
/// Refused 2026-09-16. The gate matches (`PRODUCTS_CREATE`, same kind, same
/// order) and the body is otherwise statement-identical to
/// [`oz_bridge::product_variants::create_scoped`] — same three
/// `validate_not_empty` calls, same `Money` parse, same barcode handling, same
/// store call. The single delta is the log text: this shell logs
/// `"product variant created"` (`:133`) where the bridge logs
/// `"product variant created (scoped)"`
/// (`crates/kasirmu-bridge/src/product_variants.rs:316`). §4 pins log text
/// byte-identical, and the `resolve_boot_store` refusal set that precedent.
///
/// This is a **decision rather than work** — reconcile the `(scoped)` suffix on
/// one side and the door becomes a whole-body move with nothing left to rewrite.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn create_product_variant_scoped(
    session_token: String,
    args: CreateProductVariantArgs,
    state: State<'_, AppState>,
) -> Result<CreateProductVariantResult, AppError> {
    validate_not_empty("parent_sku", &args.parent_sku)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("name", &args.name).map_err(|e| AppError::Invalid(e.to_string()))?;
    validate_not_empty("sku", &args.sku).map_err(|e| AppError::Invalid(e.to_string()))?;

    let price = match (args.price_minor, args.currency) {
        (Some(minor), Some(cur_str)) => {
            let currency: oz_core::Currency = cur_str
                .parse()
                .map_err(|_| AppError::Invalid(format!("invalid currency '{cur_str}'")))?;
            Some(Money {
                minor_units: minor,
                currency,
            })
        }
        _ => None,
    };

    let mut variant = ProductVariant::new(args.parent_sku, args.name, args.sku);
    if let Some(p) = price {
        variant = variant.with_price(p);
    }
    if let Some(ref barcode) = args.barcode {
        let parsed = foundation::Barcode::new(barcode)
            .map_err(|e| AppError::Invalid(e.message.to_string()))?;
        variant = variant.with_barcode(parsed);
    }
    if let Some(order) = args.sort_order {
        variant = variant.with_sort_order(order);
    }

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PRODUCTS_CREATE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    store.create_product_variant(&variant)?;
    drop(db);

    tracing::info!(sku = %variant.sku, parent_sku = %variant.parent_sku, "product variant created");
    Ok(CreateProductVariantResult { sku: variant.sku })
}

/// Update an existing product variant (matched by SKU) resolved from a session token. ADR #7.
///
/// # ADR #49 NOT APPLIED, deliberately — the log line is the only obstacle
///
/// Refused 2026-09-16 on the same ground as
/// [`create_product_variant_scoped`]: the gate matches (`PRODUCTS_UPDATE`), the
/// body is otherwise statement-identical, and the one delta is the log text —
/// `"product variant updated"` here (`:188`) against
/// `"product variant updated (scoped)"` in the twin
/// (`crates/kasirmu-bridge/src/product_variants.rs:386`). §4 pins log text
/// byte-identical.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_product_variant_scoped(
    session_token: String,
    args: UpdateProductVariantArgs,
    state: State<'_, AppState>,
) -> Result<UpdateProductVariantResult, AppError> {
    validate_not_empty("sku", &args.sku).map_err(|e| AppError::Invalid(e.to_string()))?;

    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, permissions::PRODUCTS_UPDATE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);

    // Fetch existing variant first.
    let mut variant = store
        .get_product_variant(&args.sku)?
        .ok_or_else(|| AppError::Invalid(format!("variant '{}' not found", args.sku)))?;

    if let Some(name) = args.name {
        validate_not_empty("name", &name).map_err(|e| AppError::Invalid(e.to_string()))?;
        variant.name = name;
    }
    if let (Some(minor), Some(cur_str)) = (args.price_minor, args.currency) {
        let currency: oz_core::Currency = cur_str
            .parse()
            .map_err(|_| AppError::Invalid(format!("invalid currency '{cur_str}'")))?;
        variant.price = Some(Money {
            minor_units: minor,
            currency,
        });
    }
    if let Some(ref barcode) = args.barcode {
        let parsed = foundation::Barcode::new(barcode)
            .map_err(|e| AppError::Invalid(e.message.to_string()))?;
        variant.barcode = Some(parsed);
    }
    if let Some(order) = args.sort_order {
        variant.sort_order = order;
    }
    if let Some(active) = args.is_active {
        variant.is_active = active;
    }

    store.update_product_variant(&variant)?;
    drop(db);

    tracing::info!(sku = %variant.sku, "product variant updated");
    Ok(UpdateProductVariantResult { sku: variant.sku })
}

/// Delete a product variant by its own SKU resolved from a session token. ADR #7.
///
/// # ADR #49 — ported 2026-09-16
///
/// Delegates to [`oz_bridge::product_variants::delete_scoped`]. The body was
/// statement-identical — including the log line, `"product variant deleted"`,
/// which is what distinguishes this door from its two refused siblings — and the
/// gate is `PRODUCTS_DELETE` on both sides, so the move is ledger-neutral.
#[command]
pub async fn delete_product_variant_scoped(
    session_token: String,
    sku: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::product_variants::delete_scoped(&ctx, &sku, &session_token)
        .await
        .map_err(Into::into)
}

#[cfg(test)]
#[path = "product_variants_tests.rs"]
mod tests;
