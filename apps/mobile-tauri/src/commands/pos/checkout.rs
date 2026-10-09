//! COR-7 checkout: per-attempt idempotency and the promoted-total previews.
//!
//! **This is a deliberate SECOND IMPLEMENTATION.** The desktop checkout lives in
//! `crates/kasirmu-bridge/src/pos/checkout.rs` (`validated_attempt_id`,
//! `replay_verdict`); the tablet shell is a fork of the command layer and cannot
//! import it, so the rules are restated here rather than shared. **Keep the two in
//! step** - a change to the attempt-key format or the replay verdict on one side
//! that is not mirrored here makes a replayed checkout either double-charge or
//! fail to recover.
//!
//! Invariant: the attempt id is treated as an OPAQUE key, stamped onto every
//! payment split as `{attempt}:{index}`, and a replay answers with the ORIGINAL
//! receipt rather than writing a second sale.

use tauri::{State, command};

use kasirmu_core::db::Store;
use kasirmu_core::events::{SaleCompleted, SaleCompletedLine};
use kasirmu_core::session::SessionContext;
use kasirmu_core::{CartId, PaymentSplitArg, SaleStatus};

use crate::commands::authz::require_permission_for_session;
#[cfg(test)]
use crate::commands::authz::require_permission_for_user;
use crate::error::AppError;
use crate::state::AppState;

// The wire DTOs (shared with the desktop shell through `kasirmu_bridge::pos`) are
// re-exported by the parent, as is its `tax_scope_now` helper.
use super::{
    CompleteSaleResult, CompleteSaleScopedArgs, PreviewLineArgs, PreviewPromotedTotalArgs,
    PreviewPromotedTotalFromLinesArgs, PreviewPromotedTotalResult, PreviewPromotionDiscount,
    tax_scope_now,
};

// ── COR-7: per-attempt checkout idempotency (tablet port) ───────────
//
// Semantics copied from the desktop implementation in
// `crates/kasirmu-bridge/src/pos.rs` (`stamp_attempt_split_keys`,
// `replay_verdict`), which this crate cannot import: the tablet shell is a
// fork of the command layer, so the helpers below are a second
// implementation of the SAME rules, not shared code. Keep them in step.
//
// ⚠️ MEASURED DIVERGENCE, not repaired here. The fork has drifted from the bridge
// in a way that changes what a cashier can do after a void. Compared line by line
// against `crates/kasirmu-bridge/src/pos/checkout/replay.rs:175-234`:
//
// 1. Step 1, re-keyed sale is VOIDED. Bridge returns `Rekey(stem)` and settles a
//    NEW sale under the next epoch (:195-197). This shell returns
//    `Err(Invalid)` (:146-150) and refuses the checkout outright.
// 2. Different basket under a used attempt. Bridge returns `Rekey(stem)` and
//    settles it, so no receipt is orphaned and no legitimate sale is refused
//    (:218-232). This shell refuses (:173-179).
// 3. The re-key stem carries NO EPOCH. The bridge counts settlements under the
//    prefix and stamps `{attempt}:rekey:{basket}:v{n}` (replay.rs:115-137); this
//    shell stamps a fixed `{attempt}:rekey:{cart_id}` (:169) and probes
//    `...:rekey:{cart_id}:0` (:141). A second void-and-retry therefore re-derives
//    the SAME keys, and the UNIQUE index on `payments.idempotency_key` rejects
//    the second settlement instead of admitting it.
//
// So after a void the tablet refuses where the desktop settles. Which is right is
// a PRODUCT ruling -- a cashier who taps "pay" after a voided attempt either gets
// a new sale or a message -- so it is not decided here. What is recorded is that
// the two shells disagree today, that the disagreement is reachable, and that
// the epoch counter the bridge relies on does not exist on this side.
//
// HOW TO CLOSE IT, verified rather than guessed. The desktop shell does not fork
// these rules at all: `apps/desktop-tauri/src/commands/pos.rs:42` imports
// `shortfall_line_unit_price`, `stamp_attempt_split_keys` and `tax_scope_now` from
// `kasirmu_bridge::pos`, and its `line_unit_price` / `run_override_line_price_unchecked`
// are one-line `map_err(Into::into)` shims over the bridge bodies (:45-63). So this
// shell is the only fork of this pair, and the bridge is the single implementation
// to converge on -- the tablet has no reason to be a second source of truth.
//
// The helpers are reachable in principle: `replay_verdict` takes
// `(&rusqlite::Connection, Option<&str>, Option<&str>, Option<&CartId>)` and this
// shell already holds a `rusqlite::Connection` behind `store`, so the only real
// obstacle is VISIBILITY. Today `mod replay` is `pub(super)` (pos/checkout.rs:166)
// and its members are `pub(super)` / `pub(in crate::pos)`, so they are invisible
// outside the bridge crate. Closing the drift is therefore: widen those visibilities,
// re-export from `kasirmu_bridge::pos`, map `BridgeError` into `AppError` at the
// call site, and delete the four helpers below -- not re-porting the logic, which is
// how the two drifted apart in the first place.

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
///
/// COLON IS REFUSED, matching `checkout::replay::validated_attempt_id`
/// (crates/kasirmu-bridge/src/pos/checkout/replay.rs:63), which this function
/// predates. The id is opaque and never parsed, but the KEY NAMESPACE around it
/// is colon-separated — `{attempt}:0`, `{attempt}:{n}`, `{attempt}:rekey:{cart}` —
/// so a crafted `a:rekey:b` composes a base key identical to another attempt's
/// re-key LOOKUP key, and the replay guard would hand that basket a sale it did
/// not ring up. This shell built its re-key namespace on the same `:` and had no
/// rejection, so the forgery was reachable here and is not on the desktop; the
/// bridge pins its own side in
/// `attempt_ids_with_colons_are_rejected_and_rekey_stems_stay_disjoint`.
///
/// Honest clients are unaffected: the ids the UI mints are UUIDs, which contain
/// no colon.
///
/// PARITY, verified both ways rather than asserted: the bridge validates on BOTH
/// checkout doors (`pos/checkout.rs:343` for the cart door and `:598` for the
/// shortfall door), and `apps/desktop-tauri` carries no attempt-id handling of its
/// own — it reaches these through `kasirmu_bridge::pos`, so rejecting here makes
/// this shell AGREE with the desktop on both doors instead of one.
///
/// The trim half of this contract is pinned across shells by
/// `whitespace_only_attempt_id_is_unguarded_like_the_tablet` in the bridge tests,
/// which is what kept the two implementations in step while the colon rule drifted
/// the other way. The colon half is pinned here now.
pub(super) fn normalized_attempt_id(raw: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.contains(':') {
        return Err(AppError::Invalid(
            "checkout attempt id must not contain ':'".into(),
        ));
    }
    Ok(Some(trimmed.to_owned()))
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
pub(super) fn stamp_attempt_split_keys(attempt_id: Option<&str>, splits: &mut [PaymentSplitArg]) {
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
pub(super) enum ReplayVerdict {
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
pub(super) fn replay_receipt(sale: &kasirmu_core::Sale) -> CompleteSaleResult {
    CompleteSaleResult {
        sale_id: sale.id.clone(),
        total: Some(sale.total),
        line_count: sale.lines.len(),
        receipt_number: Some(sale.id.clone()),
        statutory_number: None,
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
pub(super) fn replay_verdict(
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
pub(super) struct SaleSettlement {
    /// The receipt to hand back to the client — original sale id on a replay.
    pub(super) result: CompleteSaleResult,
    /// `Some` only when THIS call created the sale. `None` means the
    /// submission replayed an existing one, so the caller must publish
    /// nothing: the domain event already fired with the original sale.
    pub(super) sale: Option<kasirmu_core::Sale>,
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
    require_permission_for_session(&state, &session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;

    let conn_arc = state.resolve_store(&session_token)?;
    let (base_total_minor, total_minor, discounts) = {
        let db = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        let cart = store
            .load_active_cart(&args.cart_id)?
            .ok_or_else(|| AppError::Invalid(format!("cart not found: {}", args.cart_id)))?;
        let rounding_mode = kasirmu_core::Settings::get_tax_rounding_mode(&db)?;
        let mut sale = kasirmu_core::Sale::from_cart(&cart)
            .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;
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
        (base_total_minor, sale.total.minor_units, discounts)
    };

    Ok(PreviewPromotedTotalResult {
        base_total_minor,
        total_minor,
        discounts,
    })
}

/// Build an in-memory cart mirroring the client's displayed cart for the
/// lines-based promotion preview (no persistence, no cart id needed).
pub(super) fn build_preview_cart(
    lines: &[PreviewLineArgs],
    discount_percent: i64,
) -> Result<kasirmu_core::Cart, AppError> {
    let first = lines
        .first()
        .ok_or_else(|| AppError::Invalid("cannot preview an empty cart".into()))?;
    let parse_currency = |code: &str| -> Result<kasirmu_core::Currency, AppError> {
        code.parse()
            .map_err(|_| AppError::Invalid(format!("invalid currency code: {code}")))
    };
    let mut cart = kasirmu_core::Cart::new(parse_currency(&first.unit_price_currency)?);
    for l in lines {
        cart.add_line(kasirmu_core::CartLine::new(
            kasirmu_core::Sku::new(l.sku.clone()),
            l.qty,
            kasirmu_core::Money {
                minor_units: l.unit_price_minor,
                currency: parse_currency(&l.unit_price_currency)?,
            },
        ))
        .map_err(|e| AppError::Invalid(format!("cart line rejected: {e}")))?;
    }
    // Routes through the bridge's ONE narrowing helper rather than repeating the
    // clamp here. `checkout_discount_percent` is `p.clamp(0, 100)`; the `> 0`
    // guard plus `Percentage::new`'s own rejection of anything over 100 made this
    // line's `discount_percent.min(100) as u8` equivalent -- but it was a SECOND
    // spelling of a rule whose bridge test (`preview_and_shortfall_doors_treat_a_
    // high_discount_percent_identically`) exists because the original truncating
    // cast was evaded by FORMATTING ALONE: no single line contained both
    // `Percentage::new(` and the cast, so every source predicate missed. A second
    // untested spelling is exactly how that comes back, and `256 as u8 == 0`
    // silently DROPS the discount rather than raising. One helper, one place.
    if discount_percent > 0
        && let Some(pct) = foundation::Percentage::new(
            kasirmu_bridge::pos::checkout_discount_percent(discount_percent) as u8,
        )
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
    require_permission_for_session(&state, &session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;

    let cart = build_preview_cart(&args.lines, args.discount_percent)?;
    let mut sale = kasirmu_core::Sale::from_cart(&cart)
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;

    let conn_arc = state.resolve_store(&session_token)?;
    let (base_total_minor, discounts) = {
        let db = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        let store = Store::new(&db);
        store.compute_sale_tax_for_location(
            &mut sale,
            &[],
            kasirmu_core::Settings::get_tax_rounding_mode(&db)?,
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
pub(super) fn run_complete_sale_scoped_store(
    db: &rusqlite::Connection,
    session: &SessionContext,
    args: &CompleteSaleScopedArgs,
    primary_override: Option<kasirmu_core::inventory::LocationId>,
) -> Result<SaleSettlement, AppError> {
    let store = Store::new(db);

    // ── COR-7 replay guard — BEFORE any write, including the cart ──
    // `?` so a colon-bearing id is refused here, before any key is stamped.
    let attempt = normalized_attempt_id(args.attempt_id.as_deref())?;
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

    let mut sale = kasirmu_core::Sale::from_cart_with_user(&cart, Some(session.user_id.clone()))
        .ok_or_else(|| AppError::Invalid("cart total overflowed i64".into()))?;
    sale.payment_method = Some(args.payment_method.to_ascii_lowercase());
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
        kasirmu_core::Settings::get_tax_rounding_mode(db)?,
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
        let mut s = splits.clone();
        for split in &mut s {
            split.method = split.method.to_ascii_lowercase();
        }
        s
    } else {
        vec![PaymentSplitArg {
            method: args.payment_method.to_ascii_lowercase(),
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
    //
    // PROPAGATES, matching `commands/pos.rs::start_sale_scoped` and the four bridge
    // callers. The earlier `.unwrap_or_else(|_| get_default_location_id())` made a
    // FAILED resolve indistinguishable from an unbound workspace, so the sale
    // deducted stock from the canonical default location while reporting success —
    // the same defect fixed in the two core callers in 5a931d80f, reached here from
    // the tablet instead of the bridge.
    //
    // Tier 4 is still the answer for a workspace with genuinely no binding, and
    // `resolve_primary_location` returns it without erroring; only a READ FAILURE
    // reaches this `?`, and that must refuse rather than deduct somewhere arbitrary.
    let primary = match primary_override {
        Some(loc) => loc,
        None => kasirmu_core::location_resolver::resolve_primary_location(
            db,
            session.instance_id.as_str(),
            None,
        )?,
    };
    let deduct = store.complete_sale_deduction_with_locations_and_estimate(
        &sale,
        Some(&session.instance_id),
        std::slice::from_ref(&primary),
        &splits,
        &session.user_id,
        Some(&session.terminal_id),
        &checkout_applications,
        args.tax_estimated.unwrap_or(false),
    )?;

    let mut statutory_number = deduct.statutory_number;
    if args.document_kind.as_deref() == Some("invoice") {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        if let Ok(inv_num) = store.issue_tax_invoice_for_sale(&sale.id, primary.as_str(), &now) {
            statutory_number = Some(inv_num);
        }
    }

    // Promotion-reduced payable (cart.total() would ignore promotions).
    let result = CompleteSaleResult {
        sale_id: sale.id.clone(),
        total: Some(sale.total),
        line_count,
        receipt_number: Some(deduct.receipt_number),
        statutory_number,
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

#[cfg(test)]
pub(super) fn run_complete_sale_scoped(
    db: &rusqlite::Connection,
    session: &SessionContext,
    args: &CompleteSaleScopedArgs,
) -> Result<SaleSettlement, AppError> {
    let store = Store::new(db);

    require_permission_for_user(
        &store,
        &session.user_id,
        kasirmu_core::permissions::SALES_PROCESS,
    )?;

    run_complete_sale_scoped_store(db, session, args, None)
}

/// Complete a sale within the session scope. ADR #7 / ADR-19 §6.
///
/// Uses the `complete_sale_deduction` path which checks stock at the
/// resolved deduction location, performs per-location deduction, and
/// writes `deduction_locations` JSON on the sale row.
/// Returns `PartialStockResult` as an error when stock is insufficient.
///
/// COR-7: `args.attempt_id` makes the call idempotent — see
/// `run_complete_sale_scoped` (a private fn in this module) for the guard and
/// its ordering rules.
#[command]
pub async fn complete_sale_scoped(
    session_token: String,
    args: CompleteSaleScopedArgs,
    state: State<'_, AppState>,
) -> Result<CompleteSaleResult, AppError> {
    let session = state.resolve_session(&session_token)?;
    require_permission_for_session(&state, &session, kasirmu_core::permissions::SALES_PROCESS)
        .await?;

    // §B read-only lock: a lapsed grace window rejects new sales.
    {
        let db = state.db.lock().await;
        let sub = kasirmu_core::TenantSubscription::load(&db, "default")?
            .ok_or_else(|| AppError::Internal("default tenant subscription not found".into()))?;
        sub.verify_signature()?;
        sub.enforce_pos_writable()?;
    }

    // Resolve primary deduction location from global identity DB where workspace_instances lives.
    let primary_location = {
        let global_db = state.db.lock().await;
        match kasirmu_core::location_resolver::resolve_primary_location(
            &global_db,
            session.instance_id.as_str(),
            None,
        ) {
            Ok(loc) => Some(loc),
            Err(kasirmu_core::CoreError::NotFound { entity, .. })
                if entity == "workspace_instance" =>
            {
                None
            }
            Err(e) => return Err(e.into()),
        }
    };

    // One lock covers the replay lookup AND the settlement on the store database.
    let conn_arc = state.resolve_store(&session_token)?;
    let settlement = {
        let db = conn_arc
            .lock()
            .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
        run_complete_sale_scoped_store(&db, &session, &args, primary_location)?
    };
    let CompleteSaleResult {
        sale_id,
        total,
        line_count,
        receipt_number,
        statutory_number,
    } = settlement.result;

    // A replay wrote nothing, so it must publish nothing: the domain event
    // already fired with the original sale, and firing it twice would deduct
    // stock and re-credit customer spend for one payment.
    let Some(sale) = settlement.sale else {
        return Ok(CompleteSaleResult {
            sale_id,
            total,
            line_count,
            receipt_number,
            statutory_number,
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
            // UNREACHABLE default, kept as defence rather than as a live branch.
            // `total` is `Option<Money>` only because the REPLAY arm can return a
            // receipt without a settlement -- and that arm returns at :560, before
            // this block is reached. Both paths that build a `SaleSettlement` with
            // `sale: Some(..)` set `total: Some(sale.total)` (:502, :352), so by the
            // time an event is published `total` is always `Some`.
            //
            // Recorded because `unwrap_or(0)` on a money field is the exact shape of
            // the error-collapse family this codebase has been removing, and a
            // future refactor that let a `None` reach here would publish a
            // `SaleCompleted` claiming the sale was worth nothing. Making it total
            // instead would panic on the event bus; the day this needs to change,
            // the fix is to skip the event, not to invent a figure.
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

    // SYNC-EW: wake the inline sync daemon so the completed sale reaches the
    // cloud portal within seconds rather than waiting up to 30 s for the next
    // periodic tick.
    state.sync_wakeup.notify_one();

    Ok(CompleteSaleResult {
        sale_id,
        total,
        line_count,
        receipt_number,
        statutory_number,
    })
}

#[cfg(test)]
#[path = "checkout_tests.rs"]
mod tests;
