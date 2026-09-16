/*
last audited 25-07-26 by RSA-Agent (tablet-client slice A: pos head+sweep)
crate: tablet-client | status: SAFE | lint: CLEAN
findings: sweep + guard sites verified — both Percentage::new unwraps (lines 57, 100) preceded by explicit 0..=100 range checks with SAFETY comments; authz decorators present; cart/sale state machine lives in oz_core (audited). Coverage note: risk-ranked sampling, not full deep read
next: none | perf: N/A
*/
//! Point-of-Sale pipeline commands: start a cart, add a line,
//! complete the sale, hold/resume carts.
//!
//! These commands are the IPC surface for the POS screen. The actual
//! cart/sale state machine lives in `oz_core`; this file translates
//! between the Tauri argument structs and the domain types.
//!
//! Carts are persisted in the SQLite `active_carts` table so they
//! survive application restarts.
//!
//! Checkout is idempotent per attempt (COR-7): `complete_sale_scoped` and
//! `complete_sale_with_resolved_shortfalls_scoped` read a client-supplied
//! `attempt_id`, treat it as an opaque key, stamp every payment split as
//! `{attempt}:{index}` and answer a replay with the original receipt. The
//! rules are copied from `crates/oz-bridge/src/pos.rs`, which this forked
//! command layer cannot import — keep the two in step.

use tauri::{State, command};

use foundation::Percentage;
use oz_core::db::Store;
use oz_core::events::{SaleCompleted, SaleCompletedLine};
use oz_core::location_resolver;
use oz_core::session::SessionContext;
use oz_core::{Cart, CartId, CartLine, Currency, Money, PaymentSplitArg, SaleStatus};

use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

// Phase 3.3 T4: the wire DTOs below moved to the shared `oz_bridge::pos`
// module (Agent 2's Wave D extraction) and are re-exported here, same as
// the desktop shell — one wire definition across both shells, ending the
// "keep the two in step" fork burden this header used to carry. The
// CompleteSale pair inherits the tablet's `deny_unknown_fields` hardening
// (now ported INTO the bridge DTOs so every shell fails loudly on an
// unknown key instead of silently dropping it — the incident that let
// `attemptId` vanish). The unscoped `CompleteSaleArgs` gains the two
// fields its fork had lost (`payment_splits`, `promotion_ids`); the
// unscoped command is not registered on this shell, so the wire is
// unwitnessed either way. The command bodies stay tablet-native (no
// BridgeCtx yet — see the T2 seam notes in void.rs).
pub use oz_bridge::pos::{
    AddLineArgs, AddLineResult, BILL_TYPE_OPEN_BILL, CartLineData, CompleteSaleArgs,
    CompleteSaleResult, CompleteSaleScopedArgs, CompleteSaleWithResolvedShortfallsArgs,
    DeductionLocationInfo, FireCourseArgs, HoldCartArgs, HoldCartResult, OverrideLinePriceArgs,
    OverrideLinePriceScopedArgs, PreviewLineArgs, PreviewPromotedTotalArgs,
    PreviewPromotedTotalFromLinesArgs, PreviewPromotedTotalResult, PreviewPromotionDiscount,
    SerialNumberArg, SetCartDiscountArgs, SetCartDiscountScopedArgs, SetLineCourseArgs,
    StartSaleArgs, StartSaleResult, is_restaurant_pos_workspace,
};

/// The tax scope for a sale rung up at `location_id` right now.
///
/// Mirrors the desktop helper of the same name; see
/// `apps/desktop-client/src/commands/pos.rs` for why `as_of` is the UTC
/// calendar date and why that is a recorded compromise rather than the answer
/// (`locations.timezone` IANA-vs-offset is regional open question 1, so a
/// locally-correct business date is not available yet). UTC is what
/// `sale.created_at` already records, which keeps a cart preview and its
/// checkout receipt resolving on the same side of an exclusive `effective_to`.
fn tax_scope_now(store: &Store, location_id: &str) -> oz_core::TaxSaleScope {
    // ADR #48 (Decision 3): as_of is the location business date, so resolve it in
    // the store's IANA zone, not raw UTC. The instant stays Utc::now(); only the
    // zone applied before formatting changes. A missing/corrupt timezone falls
    // back to UTC, which is the old behaviour and never resolves a wrong day.
    let timezone = store
        .get_location_profile(location_id)
        .ok()
        .flatten()
        .map(|p| p.timezone)
        .unwrap_or_else(|| "UTC".to_string());
    oz_core::TaxSaleScope {
        location_id: location_id.to_string(),
        as_of: oz_core::timezone::business_date_in_zone(chrono::Utc::now(), &timezone),
    }
}

// ── Discount ─────────────────────────────────────────────────────────

/// Set a cart discount within the session scope. ADR #7 / ADR-19.
#[command]
pub async fn set_cart_discount_scoped(
    session_token: String,
    args: SetCartDiscountScopedArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if !(0..=100).contains(&args.percent) {
        return Err(AppError::Invalid(format!(
            "discount percent must be between 0 and 100, got {}",
            args.percent
        )));
    }
    // SAFETY: args.percent is validated 0..=100 above, so the unwrap is safe.
    let percent = Percentage::new(args.percent as u8).unwrap();

    let db = state.db.lock().await;
    let store = Store::new(&db);

    let session = state.resolve_session(&session_token)?;
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_DISCOUNT,
    )?;

    let mut cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;
    cart.set_discount(percent, args.label);
    store.save_active_cart(&cart, None)?;
    drop(db);
    tracing::info!(cart_id = %args.cart_id, percent = %args.percent, "cart discount set (scoped)");
    Ok(())
}

// ── Start Sale ───────────────────────────────────────────────────────

/// Start a new sale in the session scope. ADR #7 / ADR-19 §5.1.
///
/// Resolves the primary deduction location from the workspace instance
/// and locks it on the `active_carts` row at cart-start time.
///
/// Requires `SALES_PROCESS` permission from the resolved session (Bug #4).
#[command]
pub async fn start_sale_scoped(
    session_token: String,
    args: StartSaleArgs,
    state: State<'_, AppState>,
) -> Result<StartSaleResult, AppError> {
    let currency_str = if args.currency.is_empty() {
        "USD"
    } else {
        &args.currency
    };
    let currency: oz_core::Currency = currency_str
        .parse()
        .map_err(|_| AppError::Invalid(format!("invalid currency code: {currency_str}")))?;
    let cart = Cart::new(currency);
    let id = cart.id();

    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);

    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;

    // Resolve the primary deduction location for this workspace instance.
    let deduction_location_id =
        location_resolver::resolve_primary_location(&db, &session.instance_id, None)
            .unwrap_or_else(|_| location_resolver::get_default_location_id());

    store.save_active_cart(&cart, Some(deduction_location_id.as_str()))?;
    drop(db);

    tracing::info!(
        cart_id = %id,
        deduction_location_id = %deduction_location_id,
        "cart created with deduction location lock (scoped)",
    );

    Ok(StartSaleResult {
        cart_id: id,
        deduction_location_id: Some(deduction_location_id.to_string()),
    })
}

// ── List Active Carts ────────────────────────────────────────────────

/// List active carts in the session scope. ADR #7.
#[command]
pub async fn list_active_carts_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<CartId>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let ids = store.list_active_carts()?;
    drop(db);
    Ok(ids)
}

// ── Get Active Cart ──────────────────────────────────────────────────

/// Load a cart in the session scope. ADR #7.
#[command]
pub async fn get_active_cart_scoped(
    session_token: String,
    cart_id: CartId,
    state: State<'_, AppState>,
) -> Result<Option<Cart>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let cart = store.load_active_cart(&cart_id)?;
    drop(db);
    Ok(cart)
}

// ── Add Line ─────────────────────────────────────────────────────────

/// Resolve the unit price for an `add_line_scoped` request (FRONTEND-03).
///
/// The line's own currency crosses the IPC boundary so a cross-currency
/// line is rejected by `Cart::add_line` instead of being silently re-stamped
/// to the cart's currency. `None` preserves the legacy fallback.
fn line_unit_price(args: &AddLineArgs, cart_currency: Currency) -> Result<Money, AppError> {
    let currency = match args.unit_price_currency.as_deref() {
        Some(s) => s
            .parse::<Currency>()
            .map_err(|_| AppError::Invalid(format!("invalid unit price currency: {s}")))?,
        None => cart_currency,
    };
    Ok(Money {
        minor_units: args.unit_price_minor,
        currency,
    })
}

/// Add a line to an active cart in the session scope.
///
/// ADR #7 / ADR-19 §5.1: rejects the command when the cart has no
/// `deduction_location_id` lock.
///
/// Requires `SALES_PROCESS` permission from the resolved session (Bug #3).
#[command]
pub async fn add_line_scoped(
    session_token: String,
    args: AddLineArgs,
    state: State<'_, AppState>,
) -> Result<AddLineResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    run_add_line_scoped(&db, &session.user_id, &args)
}

/// Shared business logic: permission-check + add line to cart.
/// Extracted so the `SALES_PROCESS` gate is unit-testable without
/// constructing an `AppState` (Bug #3 fix).
fn run_add_line_scoped(
    db: &rusqlite::Connection,
    user_id: &str,
    args: &AddLineArgs,
) -> Result<AddLineResult, AppError> {
    let store = Store::new(db);

    require_permission_for_user(&store, user_id, oz_core::permissions::SALES_PROCESS)?;

    // ADR-19 §5.1: reject add_line_scoped when the cart has no deduction location lock.
    store
        .ensure_cart_deduction_location_lock(&args.cart_id)
        .map_err(|_| {
            AppError::Invalid(format!(
                "cart {} has no deduction location lock — create via start_sale_scoped first",
                args.cart_id
            ))
        })?;

    let mut cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;

    let unit_price = line_unit_price(args, cart.currency())?;
    let line = CartLine::new(args.sku.clone(), args.qty, unit_price);
    let line_id = line.id;
    let line_total = line.total();
    cart.add_line(line)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    store.save_active_cart(&cart, None)?;

    Ok(AddLineResult {
        line_id,
        line_total,
    })
}

// ── Override Line Price ──────────────────────────────────────────────

/// Override a line price within the session scope. ADR #7.
#[command]
pub async fn override_line_price_scoped(
    session_token: String,
    args: OverrideLinePriceScopedArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let mut cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;

    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_OVERRIDE_PRICE,
    )?;

    let currency = cart.currency();
    let new_price = Money {
        minor_units: args.new_price_minor,
        currency,
    };

    let line = cart
        .lines_mut()
        .iter_mut()
        .find(|l| l.id == args.line_id)
        .ok_or_else(|| AppError::Invalid(format!("line not found: {}", args.line_id)))?;

    line.set_overridden_price(new_price)
        .map_err(|e| AppError::Invalid(e.to_string()))?;

    store.save_active_cart(&cart, None)?;
    drop(db);

    tracing::info!(cart_id = %args.cart_id, line_id = %args.line_id, new_price_minor = args.new_price_minor, "line price overridden (scoped)");
    Ok(())
}

// ── Set Line Course ────────────────────────────────────────────────

/// Assign (or clear) the restaurant course on an active cart line. ADR #7.
///
/// Delegated to `oz_bridge::pos::run_set_line_course_unchecked` so the
/// cart mutation stays in one place; the `SALES_PROCESS` gate runs here,
/// ahead of the bridge body (same order as the price-override command).
#[command]
pub async fn set_line_course_scoped(
    session_token: String,
    args: SetLineCourseArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    oz_bridge::pos::run_set_line_course_unchecked(
        &db,
        &args.cart_id,
        &args.line_id,
        args.course.as_deref(),
    )
    .map_err(Into::into)
}

// ── Fire Course ────────────────────────────────────────────────────

/// Fire a restaurant course from an active cart. ADR #7.
///
/// Thin shell over `oz_bridge::pos::fire_course_scoped`, which resolves the
/// session, gates on `SALES_PROCESS`, and publishes `order.course_fired`.
/// Kept in the bridge (rather than native like the price override) because
/// the body needs product-name resolution plus event publishing — both live
/// behind `BridgeCtx`. The tablet kernel carries the bus, so the publish
/// lands there; the LAN forward remains desktop-only (no oz-lan dep here).
#[command]
pub async fn fire_course_scoped(
    session_token: String,
    args: FireCourseArgs,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let ctx = state.bridge_ctx();
    oz_bridge::pos::fire_course_scoped(&ctx, &session_token, args)
        .await
        .map_err(Into::into)
}

// ── Get Cart Deduction Location ───────────────────────────────────────

/// Return the deduction location info for an active cart.
#[command]
pub async fn get_cart_deduction_location(
    cart_id: CartId,
    state: State<'_, AppState>,
) -> Result<Option<DeductionLocationInfo>, AppError> {
    let db = state.db.lock().await;
    run_get_cart_deduction_location(&db, &cart_id)
}

/// Shared body for the ambient and session-scoped variants above.
///
/// Extracted to match this file's existing `run_*` convention (see
/// `run_override_cart_deduction_location`), so the two variants cannot drift apart. Note that the
/// store getter takes only a `cart_id` -- there is no ownership parameter to pass -- so the scoped
/// variant's added value is authenticating the session, exactly as every other ADR #7 pair here
/// does, and as `desktop-client`'s `get_cart_deduction_location_scoped` already does.
fn run_get_cart_deduction_location(
    db: &rusqlite::Connection,
    cart_id: &CartId,
) -> Result<Option<DeductionLocationInfo>, AppError> {
    let store = Store::new(db);
    let result = store.get_active_cart_deduction_location_info(cart_id)?;
    // No `drop(db)` here, unlike the inline original: `db` is a borrow of the caller's MutexGuard,
    // so dropping it is a no-op that rustc warns about. The lock is released when the caller's
    // guard goes out of scope, and the mapping below touches no DB state, so holding it a few
    // instructions longer is immaterial.
    Ok(
        result.map(|(loc_id, loc_name, overridden_at)| DeductionLocationInfo {
            location_id: loc_id,
            location_name: loc_name,
            overridden_at,
        }),
    )
}

/// Scoped variant of `get_cart_deduction_location` (ADR #7).
///
/// `desktop-client` has registered this command since the ADR #7 sweep; tablet never did, and the
/// UI invokes the ambient name, which desktop never registered -- so the two shells exposed
/// opposite halves of the same pair and the call threw on desktop. This closes that half.
#[command]
pub async fn get_cart_deduction_location_scoped(
    session_token: String,
    cart_id: CartId,
    state: State<'_, AppState>,
) -> Result<Option<DeductionLocationInfo>, AppError> {
    let _session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    run_get_cart_deduction_location(&db, &cart_id)
}

// ── Override Deduction Location ───────────────────────────────────────

/// Shared business logic: permission-check + override.
/// Extracted so both the deprecated and scoped commands share the same
/// `SALES_OVERRIDE_PRICE` gate, and so the gate is unit-testable without
/// constructing an `AppState`.
fn run_override_cart_deduction_location(
    db: &rusqlite::Connection,
    user_id: &str,
    cart_id: &CartId,
) -> Result<(), AppError> {
    let store = Store::new(db);

    require_permission_for_user(&store, user_id, oz_core::permissions::SALES_OVERRIDE_PRICE)?;

    store
        .override_active_cart_deduction_location(cart_id)
        .map_err(|e| AppError::Internal(format!("failed to override deduction location: {e}")))?;

    tracing::info!(cart_id = %cart_id, user_id = %user_id, "deduction location override recorded");
    Ok(())
}

/// Override the deduction location lock on an active cart (scoped).
///
/// ADR-19 §17: Records the manager override timestamp on the cart.
/// Requires `SALES_OVERRIDE_PRICE` permission from the resolved session.
#[command]
pub async fn override_cart_deduction_location_scoped(
    session_token: String,
    cart_id: CartId,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    run_override_cart_deduction_location(&db, &session.user_id, &cart_id)
}

// ── Complete Sale ────────────────────────────────────────────────────

// ── COR-7: per-attempt checkout idempotency (tablet port) ───────────
//
// Semantics copied from the desktop implementation in
// `crates/oz-bridge/src/pos.rs` (`stamp_attempt_split_keys`,
// `replay_verdict`), which this crate cannot import: the tablet shell is a
// fork of the command layer, so the helpers below are a second
// implementation of the SAME rules, not shared code. Keep them in step.

/// The checkout attempt id this submission wants guarded, normalised.
///
/// The value is an OPAQUE client-owned key and is never parsed — its only
/// contract is to be identical on every submission of one attempt.
///
/// Absent, empty and whitespace-only all mean UNGUARDED and collapse to
/// `None`, so every payment row is stamped NULL. Trimming is load-bearing,
/// not cosmetic: an untrimmed "   " would become the stem `"   :0"`, a key
/// no client can ever replay, which would look guarded while guarding
/// nothing. No key is ever minted server-side.
fn normalized_attempt_id(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Stamp one idempotency key per split from a normalised attempt id.
///
/// The index is required, not cosmetic: a split tender whose rows all
/// carried the same key would collide with itself on the second row and
/// reject a legitimate first sale. `{attempt}:{n}` is deterministic, so
/// replaying an attempt reproduces exactly the same set of keys and the
/// UNIQUE index on `payments.idempotency_key` closes the race between two
/// concurrent submits.
///
/// `None` stamps nothing: the caller asked for no guard, so the rows keep
/// their NULL key and stay invisible to the replay lookup.
fn stamp_attempt_split_keys(attempt_id: Option<&str>, splits: &mut [PaymentSplitArg]) {
    if let Some(attempt) = attempt_id {
        for (i, split) in splits.iter_mut().enumerate() {
            split.idempotency_key = Some(format!("{attempt}:{i}"));
        }
    }
}

/// What the COR-7 replay guard decided for this submission.
///
/// Three verdicts, mirroring the desktop enum exactly — a fourth would mean
/// the two shells answer the same request differently.
enum ReplayVerdict {
    /// The attempt already completed: hand back this receipt and touch
    /// nothing (no cart delete, no sale, no event).
    Replayed(CompleteSaleResult),
    /// No completed attempt sits behind this key: settle normally with the
    /// request's own attempt id.
    Fresh,
    /// A key matched but its sale is VOIDED — it took no money and returned
    /// its stock, so it must neither block a new sale nor be presented as a
    /// receipt. The `String` is the deterministic re-key stem derived from
    /// the attempt id and the request's cart, which the caller stamps
    /// instead of the request's attempt id.
    Rekey(String),
}

/// Build the receipt a replay hands back for a matched sale.
///
/// Success-shaped on purpose: the client's `await` resolves with the sale it
/// lost the response to, so a double-tap cannot be mistaken for a failure
/// and retried into a third path.
fn replay_receipt(sale: &oz_core::Sale) -> CompleteSaleResult {
    CompleteSaleResult {
        sale_id: sale.id.clone(),
        total: Some(sale.total),
        line_count: sale.lines.len(),
    }
}

/// Decide whether a submission replays an already-completed attempt.
///
/// The caller cannot supply the sale id — the response that carried it is
/// the very thing that was lost — so the attempt key is the only handle back
/// to the original sale. Resolving it BEFORE any write is what makes a replay
/// return a receipt instead of an error, and specifically before the cart is
/// consumed: a retry that deleted a live cart would strand the basket the
/// customer is still looking at.
///
/// A match is trusted as THIS request's receipt only when it can be tied to
/// the request's own basket:
///
/// - a settlement re-keyed for this exact cart (`{attempt}:rekey:{cart}:0`)
///   is provably this basket's, so it wins over the base key;
/// - the base key `{attempt}:0` answers only while the request's cart is
///   already consumed; if that cart still exists the matched sale belongs to
///   a DIFFERENT basket — a key collision, refused loudly rather than
///   silently re-keyed, because a silent re-key is what orphans receipts;
/// - a VOIDED sale satisfies no replay.
///
/// Only the first split's key is consulted: every key of one attempt maps to
/// the same sale.
fn replay_verdict(
    store: &Store,
    attempt_id: Option<&str>,
    request_cart_id: Option<&CartId>,
) -> Result<ReplayVerdict, AppError> {
    let Some(attempt) = attempt_id else {
        return Ok(ReplayVerdict::Fresh);
    };
    // Step 1 — a settlement re-keyed for this exact basket is unambiguous.
    if let Some(cart_id) = request_cart_id {
        let rekey_key = format!("{attempt}:rekey:{cart_id}:0");
        if let Some(sale_id) = store.find_sale_by_idempotency_key(&rekey_key)? {
            let sale = store.get_sale(&sale_id)?.ok_or_else(|| {
                AppError::Internal("re-keyed payment points at a missing sale".into())
            })?;
            if sale.status == SaleStatus::Voided {
                return Err(AppError::Invalid(format!(
                    "checkout attempt {attempt} for this basket was already settled and then voided — start a new checkout"
                )));
            }
            return Ok(ReplayVerdict::Replayed(replay_receipt(&sale)));
        }
    }
    // Step 2 — the attempt's own first-split key.
    let Some(sale_id) = store.find_sale_by_idempotency_key(&format!("{attempt}:0"))? else {
        return Ok(ReplayVerdict::Fresh);
    };
    let sale = store
        .get_sale(&sale_id)?
        .ok_or_else(|| AppError::Internal("replayed payment points at a missing sale".into()))?;
    // A voided sale took no money and returned its stock: it must not block
    // this settlement either, because its key is taken.
    if sale.status == SaleStatus::Voided {
        let Some(cart_id) = request_cart_id else {
            return Err(AppError::Invalid(format!(
                "checkout attempt {attempt} was voided and no cart was supplied — start a new checkout"
            )));
        };
        return Ok(ReplayVerdict::Rekey(format!("{attempt}:rekey:{cart_id}")));
    }
    // Key equality is not basket identity: while the request's cart still
    // exists, the matched sale belongs to a DIFFERENT basket. Refuse loudly.
    if let Some(cart_id) = request_cart_id
        && store.load_active_cart(cart_id)?.is_some()
    {
        return Err(AppError::Invalid(format!(
            "checkout attempt {attempt} already completed a different basket (sale {sale_id}) — cancel and start a new checkout"
        )));
    }
    Ok(ReplayVerdict::Replayed(replay_receipt(&sale)))
}

/// What one guarded settlement produced.
struct SaleSettlement {
    /// The receipt to hand back to the client — original sale id on a replay.
    result: CompleteSaleResult,
    /// `Some` only when THIS call created the sale. `None` means the
    /// submission replayed an existing one, so the caller must publish
    /// nothing: the domain event already fired with the original sale.
    sale: Option<oz_core::Sale>,
}

/// Preview the promotion-reduced payable for a cart without mutating it.
///
/// PROMO-3 checkout integration: the client needs the promoted total
/// BEFORE constructing payment splits (the checkout call validates splits
/// against the reduced total). Runs the same cart → sale → tax → engine
/// sequence as [`complete_sale_scoped`] but consumes no cart and writes
/// no rows; the authoritative computation still happens inside the
/// checkout call, which re-validates the splits against the freshly
/// computed total.
#[command]
pub async fn preview_promoted_total_scoped(
    session_token: String,
    args: PreviewPromotedTotalArgs,
    state: State<'_, AppState>,
) -> Result<PreviewPromotedTotalResult, AppError> {
    let session = state.resolve_session(&session_token)?;

    // ── Lock 1: peek the cart (do NOT delete it) ──────────────────
    let (cart, rounding_mode) = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        require_permission_for_user(
            &store,
            &session.user_id,
            oz_core::permissions::SALES_PROCESS,
        )?;
        let cart = store
            .load_active_cart(&args.cart_id)?
            .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;
        let rounding_mode = oz_core::Settings::get_tax_rounding_mode(&db)?;
        (cart, rounding_mode)
    };

    let mut sale = oz_core::Sale::from_cart(&cart)
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;

    // ── Lock 2: tax + engine discounts (no writes) ────────────────
    let (base_total_minor, discounts) = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        store.compute_sale_tax_for_location(
            &mut sale,
            &[],
            rounding_mode,
            Some(&tax_scope_now(&store, &session.store_id)),
        )?;
        let base_total_minor = sale.total.minor_units;
        let apps = store.compute_checkout_promotions(
            &mut sale,
            &args.promotion_ids,
            chrono::Utc::now(),
        )?;
        let discounts = apps
            .into_iter()
            .map(|app| PreviewPromotionDiscount {
                promotion_id: app.promotion_id,
                discount_minor: app.discount_minor,
                description: app.description,
            })
            .collect();
        (base_total_minor, discounts)
    };

    Ok(PreviewPromotedTotalResult {
        base_total_minor,
        total_minor: sale.total.minor_units,
        discounts,
    })
}

/// Build an in-memory cart mirroring the client's displayed cart for the
/// lines-based promotion preview (no persistence, no cart id needed).
fn build_preview_cart(
    lines: &[PreviewLineArgs],
    discount_percent: i64,
) -> Result<oz_core::Cart, AppError> {
    let first = lines
        .first()
        .ok_or_else(|| AppError::Invalid("cannot preview an empty cart".into()))?;
    let parse_currency = |code: &str| -> Result<oz_core::Currency, AppError> {
        code.parse()
            .map_err(|_| AppError::Invalid(format!("invalid currency code: {code}")))
    };
    let mut cart = oz_core::Cart::new(parse_currency(&first.unit_price_currency)?);
    for l in lines {
        cart.add_line(oz_core::CartLine::new(
            oz_core::Sku::new(l.sku.clone()),
            l.qty,
            oz_core::Money {
                minor_units: l.unit_price_minor,
                currency: parse_currency(&l.unit_price_currency)?,
            },
        ))
        .map_err(|e| AppError::Invalid(format!("cart line rejected: {e}")))?;
    }
    if discount_percent > 0
        && let Some(pct) = foundation::Percentage::new(discount_percent.min(100) as u8)
    {
        cart.set_discount(pct, None);
    }
    Ok(cart)
}

/// Preview the promotion-reduced payable from raw cart lines.
///
/// PROMO-3 checkout integration: the client materializes its backend cart
/// only at the confirm step, but needs the engine-exact payable BEFORE
/// then — to show the promoted total and let split payments be entered
/// against it. Runs cart → sale → tax → engine on an in-memory cart built
/// from the caller's lines (no plugin tax overrides — the tablet checkout
/// path applies none either); the authoritative computation still happens
/// inside the checkout call, which re-validates the splits against the
/// freshly computed total.
#[command]
pub async fn preview_promoted_total_from_lines_scoped(
    session_token: String,
    args: PreviewPromotedTotalFromLinesArgs,
    state: State<'_, AppState>,
) -> Result<PreviewPromotedTotalResult, AppError> {
    let session = state.resolve_session(&session_token)?;

    let cart = build_preview_cart(&args.lines, args.discount_percent)?;
    let mut sale = oz_core::Sale::from_cart(&cart)
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;

    // ── Lock: permission + tax + engine discounts (no writes) ─────
    let (base_total_minor, discounts) = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        require_permission_for_user(
            &store,
            &session.user_id,
            oz_core::permissions::SALES_PROCESS,
        )?;
        store.compute_sale_tax_for_location(
            &mut sale,
            &[],
            oz_core::Settings::get_tax_rounding_mode(&db)?,
            Some(&tax_scope_now(&store, &session.store_id)),
        )?;
        let base_total_minor = sale.total.minor_units;
        let apps = store.compute_checkout_promotions(
            &mut sale,
            &args.promotion_ids,
            chrono::Utc::now(),
        )?;
        let discounts = apps
            .into_iter()
            .map(|app| PreviewPromotionDiscount {
                promotion_id: app.promotion_id,
                discount_minor: app.discount_minor,
                description: app.description,
            })
            .collect();
        (base_total_minor, discounts)
    };

    Ok(PreviewPromotedTotalResult {
        base_total_minor,
        total_minor: sale.total.minor_units,
        discounts,
    })
}

/// Complete one guarded checkout attempt against the store connection.
///
/// Split out of the `#[command]` wrapper (the house `run_*` seam this file
/// already uses for `run_add_line_scoped` and friends) so the replay guard
/// and the cart consumption can be driven from a test with a plain
/// `Connection` — the command itself needs a Tauri `State`, a session token
/// and an event bus.
///
/// The order inside is the whole point:
/// 1. permission check;
/// 2. the COR-7 replay lookup;
/// 3. only then the cart read and its deletion;
/// 4. tax, promotions, split stamping and the deduction, under the one lock
///    the caller holds.
///
/// A replay therefore returns at step 2 with the original receipt and has
/// already deleted nothing — a retried tap cannot consume a live cart.
/// Steps 2-4 share a single lock so two concurrent submits carrying one key
/// serialise: the loser sees the winner's stamped key and answers with the
/// winner's sale (the UNIQUE index on `payments.idempotency_key` is the back
/// stop when a second process is involved).
fn run_complete_sale_scoped(
    db: &rusqlite::Connection,
    session: &SessionContext,
    args: &CompleteSaleScopedArgs,
) -> Result<SaleSettlement, AppError> {
    let store = Store::new(db);

    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;

    // ── COR-7 replay guard — BEFORE any write, including the cart ──
    let attempt = normalized_attempt_id(args.attempt_id.as_deref());
    let mut effective_attempt_id = attempt.clone();
    match replay_verdict(&store, attempt.as_deref(), Some(&args.cart_id))? {
        ReplayVerdict::Replayed(receipt) => {
            tracing::info!(
                sale_id = %receipt.sale_id,
                "tablet checkout replayed an existing attempt — returning the original receipt"
            );
            return Ok(SaleSettlement {
                result: receipt,
                sale: None,
            });
        }
        ReplayVerdict::Fresh => {}
        ReplayVerdict::Rekey(rekey_stem) => {
            // The key's sale was VOIDED: it took no money and returned its
            // stock, so it must not block this settlement. Re-key
            // deterministically from (attempt, cart) so a retry of THIS
            // submission finds its own receipt instead of an older one.
            tracing::warn!(
                "replay attempt id points at a voided sale — stamping a deterministic re-key"
            );
            effective_attempt_id = Some(rekey_stem);
        }
    }

    let cart = store
        .load_active_cart(&args.cart_id)?
        .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;
    store.delete_active_cart(&args.cart_id)?;

    let line_count = cart.line_count();

    let mut sale = oz_core::Sale::from_cart_with_user(&cart, Some(session.user_id.clone()))
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;
    sale.payment_method = Some(args.payment_method.clone());
    sale.tendered_minor = args.tendered_minor;
    sale.customer_id = args.customer_id.clone();
    // CUR-02: record tender-currency metadata when multi-currency checkout
    // was used. All three are None for single-currency sales.
    sale.base_currency = args.base_currency.clone();
    sale.base_total_minor = args.base_total_minor;
    sale.tender_rate_millionths = args.tender_rate_millionths;
    sale.tip_minor = args.tip_minor.unwrap_or(0);
    sale.service_charge_minor = args.service_charge_minor.unwrap_or(0);

    store.compute_sale_tax_for_location(
        &mut sale,
        &[],
        oz_core::Settings::get_tax_rounding_mode(db)?,
        Some(&tax_scope_now(&store, &session.store_id)),
    )?;

    if let Some(ref serial_numbers) = args.serial_numbers {
        for sn in serial_numbers {
            if let Some(line) = sale.lines.iter_mut().find(|l| l.sku == sn.sku) {
                line.serial_number = Some(sn.serial.clone());
            }
        }
    }

    // PROMO-3 checkout integration: engine-apply the selected
    // promotions against the post-tax sale; sale.total is reduced in
    // place and the application rows persist inside the checkout tx.
    let checkout_applications = store.compute_checkout_promotions(
        &mut sale,
        args.promotion_ids.as_deref().unwrap_or(&[]),
        chrono::Utc::now(),
    )?;

    let mut splits = if let Some(ref splits) = args.payment_splits {
        splits.clone()
    } else {
        vec![PaymentSplitArg {
            method: args.payment_method.clone(),
            amount_minor: sale.total.minor_units,
            gateway_reference: args.customer_name.clone(),
            gateway_status: None,
            gateway_response: None,
            idempotency_key: None,
        }]
    };
    // COR-7: one key per split, derived from the attempt id so a replay of
    // the same attempt reproduces exactly these rows instead of a second
    // sale. No attempt id, no keys — the unguarded path stays NULL-stamped.
    stamp_attempt_split_keys(effective_attempt_id.as_deref(), &mut splits);

    // Same primary-location resolution the legacy complete_sale_deduction
    // wrapper performs internally — routed through with_locations so
    // checkout promotions persist.
    let primary = oz_core::location_resolver::resolve_primary_location(
        db,
        session.instance_id.as_str(),
        None,
    )
    .unwrap_or_else(|_| oz_core::location_resolver::get_default_location_id());
    store.complete_sale_deduction_with_locations_and_estimate(
        &sale,
        Some(&session.instance_id),
        &[primary],
        &splits,
        &session.user_id,
        Some(&session.terminal_id),
        &checkout_applications,
        args.tax_estimated.unwrap_or(false),
    )?;

    // Promotion-reduced payable (cart.total() would ignore promotions).
    let result = CompleteSaleResult {
        sale_id: sale.id.clone(),
        total: Some(sale.total),
        line_count,
    };
    tracing::info!(
        sale_id = %result.sale_id,
        total = ?result.total,
        line_count,
        store_id = %session.store_id,
        "sale completed (scoped)"
    );
    Ok(SaleSettlement {
        result,
        sale: Some(sale),
    })
}

/// Complete a sale within the session scope. ADR #7 / ADR-19 §6.
///
/// Uses the `complete_sale_deduction` path which checks stock at the
/// resolved deduction location, performs per-location deduction, and
/// writes `deduction_locations` JSON on the sale row.
/// Returns `PartialStockResult` as an error when stock is insufficient.
///
/// COR-7: `args.attempt_id` makes the call idempotent — see
/// [`run_complete_sale_scoped`] for the guard and its ordering rules.
#[command]
pub async fn complete_sale_scoped(
    session_token: String,
    args: CompleteSaleScopedArgs,
    state: State<'_, AppState>,
) -> Result<CompleteSaleResult, AppError> {
    let session = state.resolve_session(&session_token)?;

    // §B read-only lock: a lapsed grace window rejects new sales.
    {
        let db = state.db.lock().await;
        let sub = oz_core::TenantSubscription::load(&db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.enforce_pos_writable()?;
    }

    // One lock covers the replay lookup AND the settlement, so a double-tap
    // cannot have both requests pass the guard before either writes.
    let settlement = {
        let db = state.db.lock().await;
        run_complete_sale_scoped(&db, &session, &args)?
    };
    let CompleteSaleResult {
        sale_id,
        total,
        line_count,
    } = settlement.result;

    // A replay wrote nothing, so it must publish nothing: the domain event
    // already fired with the original sale, and firing it twice would deduct
    // stock and re-credit customer spend for one payment.
    let Some(sale) = settlement.sale else {
        return Ok(CompleteSaleResult {
            sale_id,
            total,
            line_count,
        });
    };

    // ── Event publishing (no DB lock held) ────────────────────────
    {
        let line_items: Vec<SaleCompletedLine> = sale
            .lines
            .iter()
            .map(|l| SaleCompletedLine {
                sku: l.sku.clone(),
                qty: l.qty,
                unit_price_minor: l.unit_price.minor_units,
                tax_minor: l.tax_amount.minor_units,
                tax_rate_id: l.tax_rate_id.clone(),
            })
            .collect();

        let event = SaleCompleted {
            sale_id: sale_id.clone(),
            store_id: Some(session.store_id.clone()),
            line_items,
            total_minor: total.map(|m| m.minor_units).unwrap_or(0),
            currency: String::from_utf8_lossy(&sale.currency.0).into_owned(),
            customer_id: args.customer_id.clone(),
        };

        let kernel = state.kernel.lock().await;
        let bus = kernel.event_bus();
        if let Err(e) = bus.publish(&event) {
            tracing::warn!(%sale_id, error = %e, "event bus publish failed");
        }
    }

    Ok(CompleteSaleResult {
        sale_id,
        total,
        line_count,
    })
}

// ── Compute Cart Tax ──────────────────────────────────────────────────

/// Compute tax within the session scope. ADR #7.
#[command]
pub async fn compute_cart_tax_scoped(
    session_token: String,
    lines: Vec<oz_core::db::CartLineTaxInput>,
    currency: String,
    state: State<'_, AppState>,
) -> Result<oz_core::db::CartTaxResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    let parsed: oz_core::Currency = currency
        .parse()
        .map_err(|_| AppError::Invalid(format!("invalid currency code: {currency}")))?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let tax = store.compute_cart_tax_for_location(
        &lines,
        parsed,
        oz_core::Settings::get_tax_rounding_mode(&db)?,
        Some(&tax_scope_now(&store, &session.store_id)),
    )?;
    drop(db);
    Ok(tax)
}

// ── Complete Sale With Resolved Shortfalls ───────────────────────────

/// Resolve the unit price for a reconstructed shortfall line
/// (FRONTEND-03 follow-up). Mirrors [`line_unit_price`]: the line's own
/// currency crosses the IPC boundary so a mismatch is rejected instead of
/// silently re-stamped to the sale currency.
fn shortfall_line_unit_price(
    line_data: &CartLineData,
    sale_currency: Currency,
) -> Result<Money, AppError> {
    let currency = match line_data.unit_price_currency.as_deref() {
        Some(s) => s
            .parse::<Currency>()
            .map_err(|_| AppError::Invalid(format!("invalid unit price currency: {s}")))?,
        None => sale_currency,
    };
    Ok(Money {
        minor_units: line_data.unit_price_minor,
        currency,
    })
}

/// The write half of `complete_sale_with_resolved_shortfalls_scoped`:
/// cart rebuild from the request body, tax, promotions, split stamping, the
/// settlement write, and the UNIQUE-index replay conversion. The caller MUST
/// have run the replay guard under the SAME db lock — the lock is what
/// closes the same-process double-tap; this fn is deliberately guard-free so
/// the tests can model the cross-process window where the guard read raced
/// the winner's commit.
fn settle_shortfall_resolved(
    db: &rusqlite::Connection,
    session: &SessionContext,
    args: &CompleteSaleWithResolvedShortfallsArgs,
    attempt_id: Option<&str>,
    effective_attempt_id: Option<&str>,
) -> Result<SaleSettlement, AppError> {
    let store = Store::new(db);

    // ── Reconstruct the Cart from front-end line data ─────────────
    let currency: oz_core::Currency = args
        .currency
        .parse()
        .map_err(|_| AppError::Invalid(format!("invalid currency code: {}", args.currency)))?;

    let mut cart = oz_core::Cart::new(currency);
    for line_data in &args.lines {
        let unit_price = shortfall_line_unit_price(line_data, cart.currency())?;
        let line =
            oz_core::CartLine::new(oz_core::Sku::new(&line_data.sku), line_data.qty, unit_price);
        cart.add_line(line)
            .map_err(|e| AppError::Invalid(e.to_string()))?;
    }

    // Apply discount if configured
    if args.discount_percent > 0
        && let Some(pct) = foundation::Percentage::new(args.discount_percent as u8)
    {
        cart.set_discount(pct, args.discount_label.clone());
    }

    let line_count = cart.line_count();

    let mut sale = oz_core::Sale::from_cart_with_user(&cart, Some(session.user_id.clone()))
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;
    sale.payment_method = Some(args.payment_method.clone());
    sale.tendered_minor = args.tendered_minor;
    sale.customer_id = args.customer_id.clone();
    // CUR-02: record tender-currency metadata when multi-currency checkout
    // was used. All three are None for single-currency sales.
    sale.base_currency = args.base_currency.clone();
    sale.base_total_minor = args.base_total_minor;
    sale.tender_rate_millionths = args.tender_rate_millionths;
    sale.tip_minor = args.tip_minor.unwrap_or(0);
    sale.service_charge_minor = args.service_charge_minor.unwrap_or(0);

    store.compute_sale_tax_for_location(
        &mut sale,
        &[],
        oz_core::Settings::get_tax_rounding_mode(db)?,
        Some(&tax_scope_now(&store, &session.store_id)),
    )?;

    // PROMO-3 checkout integration: engine-apply the selected
    // promotions against the post-tax sale; sale.total is reduced in
    // place and the application rows persist inside the checkout tx.
    let checkout_applications = store.compute_checkout_promotions(
        &mut sale,
        args.promotion_ids.as_deref().unwrap_or(&[]),
        chrono::Utc::now(),
    )?;

    let mut splits = if let Some(ref splits) = args.payment_splits {
        splits.clone()
    } else {
        vec![PaymentSplitArg {
            method: args.payment_method.clone(),
            amount_minor: sale.total.minor_units,
            gateway_reference: args.customer_name.clone(),
            gateway_status: None,
            gateway_response: None,
            idempotency_key: None,
        }]
    };
    // COR-7: one key per split from the attempt id, so a retry of this
    // submission resolves back to the sale it already created.
    stamp_attempt_split_keys(effective_attempt_id, &mut splits);

    match store
        .complete_sale_with_resolved_shortfalls(
            &sale,
            Some(&session.instance_id),
            &splits,
            &session.user_id,
            Some(&session.terminal_id),
            &args.resolutions,
            &checkout_applications,
        )
        .map_err(AppError::from)
    {
        Ok(_) => Ok(SaleSettlement {
            result: CompleteSaleResult {
                sale_id: sale.id.clone(),
                total: Some(sale.total),
                line_count,
            },
            sale: Some(sale),
        }),
        Err(e) => {
            // The re-lookup runs by the BASE attempt id (not the re-key
            // stem): `replay_verdict` consults the re-keyed key itself, so
            // the base id resolves a winner settled under either stamping.
            let receipt = replay_on_unique_collision(&store, attempt_id, Some(&args.cart_id), e)?;
            Ok(SaleSettlement {
                result: receipt,
                sale: None,
            })
        }
    }
}

/// Convert a lost cross-process idempotency race into a replay receipt.
///
/// The UNIQUE index on `payments.idempotency_key` is the only guard that
/// spans processes (`state.rs`'s tokio Mutex is process-local and no
/// single-instance guard exists), so a loser that passed the replay guard
/// before the winner committed still reaches the settlement write and fails
/// with `UNIQUE constraint failed: payments.idempotency_key`. Surfacing
/// that as a Db error turns a double-tap into a failed-checkout toast — the
/// exact failure the replay design exists to eliminate — so the collision is
/// converted: the replay lookup is re-run by the attempt stem and, when it
/// resolves to a COMPLETED sale, the winner's receipt is returned exactly as
/// the `Replayed` verdict does, publishing nothing extra.
///
/// Absorbed: only a Db UNIQUE violation on the stamped idempotency key whose
/// re-lookup resolves to a completed sale. NOT absorbed: any other error
/// kind, any other UNIQUE violation, and a collision whose re-lookup comes
/// back `Fresh` (the collided key belongs to something this attempt cannot
/// name — returning a receipt would mean handing back a stranger's sale) or
/// `Rekey` (the winner was voided; re-settling would need the re-key dance,
/// so the original error propagates unchanged).
fn replay_on_unique_collision(
    store: &Store,
    attempt_id: Option<&str>,
    request_cart_id: Option<&CartId>,
    err: AppError,
) -> Result<CompleteSaleResult, AppError> {
    let AppError::Core {
        sub_kind: oz_core::CoreErrorKind::Db,
        message,
    } = &err
    else {
        return Err(err);
    };
    if !(message.contains("UNIQUE constraint failed") && message.contains("idempotency_key")) {
        return Err(err);
    }
    match replay_verdict(store, attempt_id, request_cart_id)? {
        ReplayVerdict::Replayed(receipt) => {
            tracing::info!(
                sale_id = %receipt.sale_id,
                "settlement lost the cross-process idempotency race — returning the winner's receipt"
            );
            Ok(receipt)
        }
        _ => Err(err),
    }
}

/// Complete a sale with cashier-resolved shortfalls (split fulfillment).
///
/// This is the second command in the two-command flow (ADR-19 §6b).
/// After `complete_sale_scoped` returns a `PartialStockResult` error,
/// the cashier resolves shortfalls via the Stock Shortfall dialog.
/// This command re-checks stock at the resolved locations and deducts
/// accordingly.
#[command]
pub async fn complete_sale_with_resolved_shortfalls_scoped(
    session_token: String,
    args: CompleteSaleWithResolvedShortfallsArgs,
    state: State<'_, AppState>,
) -> Result<CompleteSaleResult, AppError> {
    let session = state.resolve_session(&session_token)?;

    // §B read-only lock: a lapsed grace window rejects new sales.
    {
        let db = state.db.lock().await;
        let sub = oz_core::TenantSubscription::load(&db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.enforce_pos_writable()?;
    }

    // ── COR-7: replay guard + settlement under ONE lock ─────────────
    // This is the path the guard matters most on: the command rebuilds its
    // cart from the request body and carries a synthetic `resolved-<ts>`
    // cart id, so unlike `complete_sale_scoped` it has no cart to run out of
    // and would otherwise re-sell the same basket on every retry.
    //
    // The guard and the write share one lock span. Tablet `state.db` is a
    // `tokio::sync::Mutex` (state.rs:50), whose guard may be held across
    // `.await`, and the whole lookup→write segment below contains no await
    // point — the cart is rebuilt in memory from the request body — so one
    // `lock().await` covers the replay lookup through the settlement write
    // and a same-process double-tap serialises: the loser re-runs the guard
    // AFTER the winner committed and answers with the winner's receipt.
    // DRIFT NOTE (deliberate, not carelessness): the desktop shell cannot
    // hold its equivalent span — its store connection is a STD `Mutex` and
    // the plugin hooks + event publish sitting between its two lock regions
    // are `.await` points (crates/oz-bridge/src/pos.rs:1740-1754), so the
    // desktop two-lock gap is still open for structural reasons and relies
    // on fail-closed settlement + the UNIQUE index instead.
    let attempt = normalized_attempt_id(args.attempt_id.as_deref());
    let settlement = {
        let db = state.db.lock().await;
        let store = Store::new(&db);
        let mut effective_attempt_id = attempt.clone();
        match replay_verdict(&store, attempt.as_deref(), Some(&args.cart_id))? {
            ReplayVerdict::Replayed(receipt) => {
                tracing::info!(
                    sale_id = %receipt.sale_id,
                    "shortfall retry replayed an existing attempt — returning the original receipt"
                );
                return Ok(receipt);
            }
            ReplayVerdict::Fresh => {}
            ReplayVerdict::Rekey(rekey_stem) => {
                tracing::warn!(
                    "replay attempt id points at a voided sale — stamping a deterministic re-key"
                );
                effective_attempt_id = Some(rekey_stem);
            }
        }
        settle_shortfall_resolved(
            &db,
            &session,
            &args,
            attempt.as_deref(),
            effective_attempt_id.as_deref(),
        )?
    };

    // A replay (guard or UNIQUE-index conversion) wrote nothing, so it must
    // publish nothing: the domain event already fired with the original
    // sale, and firing it twice would deduct stock and re-credit customer
    // spend for one payment.
    let Some(sale) = settlement.sale else {
        return Ok(settlement.result);
    };

    tracing::info!(sale_id = %sale.id, store_id = %session.store_id, "sale completed with resolved shortfalls");

    // ── Event publishing (no DB lock held) ────────────────────────
    {
        let kernel = state.kernel.lock().await;
        let bus = kernel.event_bus();
        let line_items: Vec<oz_core::events::SaleCompletedLine> = sale
            .lines
            .iter()
            .map(|l| oz_core::events::SaleCompletedLine {
                sku: l.sku.clone(),
                qty: l.qty,
                unit_price_minor: l.unit_price.minor_units,
                tax_minor: l.tax_amount.minor_units,
                tax_rate_id: l.tax_rate_id.clone(),
            })
            .collect();

        if let Err(e) = bus.publish(&oz_core::events::SaleCompleted {
            sale_id: sale.id.clone(),
            store_id: Some(session.store_id.clone()),
            line_items,
            total_minor: sale.total.minor_units,
            currency: String::from_utf8_lossy(&sale.currency.0).into_owned(),
            customer_id: args.customer_id.clone(),
        }) {
            tracing::warn!(sale_id = %sale.id, error = %e, "event bus publish failed");
        }
    }

    Ok(settlement.result)
}

// ── Hold Orders ──────────────────────────────────────────────────────

/// Park the current sale as a held order (scoped).
///
/// `bill_type` is checked against the caller's workspace type rather than
/// trusted: `open_bill` is a Restaurant POS concept, so any other terminal is
/// refused fail-closed. Mirrors `oz_bridge::pos::hold_cart_scoped` — this shell
/// forked the body, so the check has to exist on both sides of the fork.
#[command]
pub async fn hold_cart_scoped(
    session_token: String,
    args: HoldCartArgs,
    state: State<'_, AppState>,
) -> Result<HoldCartResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    if args.bill_type == BILL_TYPE_OPEN_BILL && !is_restaurant_pos_workspace(&session) {
        return Err(AppError::PermissionDenied(format!(
            "workspace '{}' may not create an open bill; only '{}' may",
            session.type_key,
            oz_core::workspace_type::RESTAURANT_POS
        )));
    }
    let id = store.hold_cart(
        &args.label,
        &args.cart_data,
        args.item_count,
        args.total_minor,
        &args.currency,
        &args.bill_type,
        args.customer_name.as_deref(),
        args.deduction_location_id.as_deref(),
    )?;
    drop(db);
    tracing::info!(held_cart_id = %id, label = %args.label, "cart held (scoped)");
    Ok(HoldCartResult { id })
}

/// List held carts in the session scope. ADR #7.
#[command]
pub async fn list_held_carts_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::db::HeldCartRow>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let carts = store.list_held_carts()?;
    drop(db);
    Ok(carts)
}

/// List open bills in the session scope. ADR #7.
///
/// Restaurant POS only — an open bill is that terminal's own concept, so a
/// session whose `type_key` is not [`oz_core::workspace_type::RESTAURANT_POS`] is refused
/// rather than served an empty list, which would read as "there are none"
/// instead of "this is not your terminal". Mirrors
/// `oz_bridge::pos::list_open_bills_scoped`; this shell forked the body, so the
/// check has to exist on both sides of the fork.
#[command]
pub async fn list_open_bills_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<oz_core::db::HeldCartRow>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    if !is_restaurant_pos_workspace(&session) {
        return Err(AppError::PermissionDenied(format!(
            "workspace '{}' may not list open bills; only '{}' may",
            session.type_key,
            oz_core::workspace_type::RESTAURANT_POS
        )));
    }
    let carts = store.list_open_bills()?;
    drop(db);
    Ok(carts)
}

/// Resume a held cart in the session scope. ADR #7.
#[command]
pub async fn get_held_cart_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<oz_core::db::HeldCartFull>, AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    let cart = store.get_held_cart(&id)?;
    drop(db);
    Ok(cart)
}

/// Delete a held cart in the session scope. ADR #7.
#[command]
pub async fn delete_held_cart_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let session = state.resolve_session(&session_token)?;
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(
        &store,
        &session.user_id,
        oz_core::permissions::SALES_PROCESS,
    )?;
    store.delete_held_cart(&id)?;
    drop(db);
    tracing::info!(held_cart_id = %id, "held cart deleted (scoped)");
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "pos_tests.rs"]
mod tests;
