//! The COR-7 replay guard: deciding whether a submission replays a completed attempt.
//!
//! Split out of `pos/checkout.rs` on 2026-09-27. Extracted whole rather than in
//! halves because the decision and the key namespace it reads are one invariant:
//!
//! - an attempt id is validated COLON-FREE (`validated_attempt_id`), because the
//!   key namespace around it is colon-separated — a crafted `a:rekey:b` would
//!   otherwise stamp a base key identical to another attempt's re-key LOOKUP key
//!   and hand one basket the wrong receipt;
//! - a re-key stem binds an attempt to THIS submission's basket identity;
//! - a VOIDED latest epoch re-keys to the next epoch instead of dead-ending.
//!
//! Invariant: the replay decision is made BEFORE any write.
//!
//! NOTE FOR ANYONE MOVING CODE OUT OF THIS FILE: `pos_tests.rs` scans
//! `pos.rs` + `pos/preview.rs` + `pos/checkout.rs` for the discount clamp
//! (`checkout_discount_percent`, floor 3). This band deliberately contains
//! ZERO occurrences of it, which is why the scan's file list did not change.

use crate::error::BridgeError;

use super::{CartLineData, CompleteSaleResult, CompleteSaleWithResolvedShortfallsArgs};

use kasirmu_core::CartId;
use kasirmu_core::db::Store;

/// What the COR-7 replay guard decided for this submission.
pub(super) enum ReplayVerdict {
    /// The attempt already completed: hand back this receipt and touch
    /// nothing.
    Replayed(CompleteSaleResult),
    /// No completed attempt sits behind this key: settle normally with the
    /// request's own attempt id.
    Fresh,
    /// A key matched but must not answer this submission — its sale is
    /// VOIDED, or it belongs to a different basket. The `String` is the
    /// basket-derived re-key stem the caller must stamp instead: it binds
    /// the attempt id to THIS submission's basket identity, so a retry of
    /// the same submission finds its own receipt and the orphaned-receipt
    /// trap a random re-key once created cannot recur.
    Rekey(String),
}

/// Build the receipt a replay hands back for a matched sale.
pub(super) fn replay_receipt(sale: &kasirmu_core::Sale) -> CompleteSaleResult {
    CompleteSaleResult {
        sale_id: sale.id.clone(),
        total: Some(sale.total),
        line_count: sale.lines.len(),
        receipt_number: Some(sale.id.clone()),
        statutory_number: None,
    }
}

/// Validate a client-supplied checkout attempt id.
///
/// Mirrors the tablet's `normalized_attempt_id` — trim, and absent/empty/
/// whitespace-only all collapse to `None` (UNGUARDED) — with one hard
/// rejection the tablet normalizer does not have: an attempt id containing
/// `:' is refused. The id is OPAQUE and never parsed, but the KEY namespace
/// around it is colon-separated, so a crafted id like `a:rekey:b` would
/// stamp a base key identical to another attempt's re-key LOOKUP key and
/// hand one basket the wrong receipt. Colons never appear in the UUIDs the
/// UI mints, so honest clients never see this error.
pub(in crate::pos) fn validated_attempt_id(
    raw: Option<&str>,
) -> Result<Option<String>, BridgeError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.contains(':') {
        return Err(BridgeError::Invalid(
            "checkout attempt id must not contain ':'".into(),
        ));
    }
    Ok(Some(trimmed.to_owned()))
}

/// Stable identity of the basket a shortfall submission re-sells.
///
/// The resolved-shortfalls command re-builds its cart from the request body
/// under a SYNTHETIC `resolved-<timestamp>` cart id that is regenerated on
/// every submit, so the cart id cannot anchor a re-key — the basket CONTENTS
/// can: one dialog retry re-sends the same lines, total, currency and
/// discount. Lines are sorted before hashing so mere ordering cannot split
/// one basket into two identities. Never parses the `resolved` prefix —
/// the prefix is treated as noise and the contents as the identity.
pub(super) fn shortfall_basket_key(args: &CompleteSaleWithResolvedShortfallsArgs) -> String {
    use sha2::Digest as _;
    let mut hasher = sha2::Sha256::new();
    hasher.update(args.currency.as_bytes());
    hasher.update(args.total_minor.to_le_bytes());
    hasher.update(args.discount_percent.to_le_bytes());
    let mut lines: Vec<&CartLineData> = args.lines.iter().collect();
    lines.sort_by(|a, b| {
        (&a.sku, a.qty, a.unit_price_minor, &a.unit_price_currency).cmp(&(
            &b.sku,
            b.qty,
            b.unit_price_minor,
            &b.unit_price_currency,
        ))
    });
    for line in lines {
        hasher.update(line.sku.as_bytes());
        hasher.update(line.qty.to_le_bytes());
        hasher.update(line.unit_price_minor.to_le_bytes());
        hasher.update(line.unit_price_currency.as_deref().unwrap_or("").as_bytes());
    }
    format!("items:{}", hex::encode(&hasher.finalize()[..12]))
}

/// Build the re-key stem for one void epoch of an (attempt, basket) pair.
pub(in crate::pos) fn rekey_stem(attempt: &str, basket_key: &str, epoch: i64) -> String {
    format!("{attempt}:rekey:{basket_key}:v{epoch}")
}

/// Count settlements already recorded under a re-key stem prefix.
///
/// Each settlement contributes exactly one first-split row ending in `:0`,
/// so the count doubles as the next free void epoch. The prefix is compared
/// with `substr`, never LIKE — attempt ids are client-supplied and `%` or
/// `_` inside them would be LIKE wildcards.
pub(super) fn count_rekey_settlements(
    conn: &rusqlite::Connection,
    prefix: &str,
) -> Result<i64, BridgeError> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM payments              WHERE substr(idempotency_key, 1, ?2) = ?1 AND substr(idempotency_key, -2) = ':0'",
            rusqlite::params![prefix, prefix.len()],
            |row| row.get(0),
        )
        .map_err(|e| BridgeError::Internal(format!("counting re-keyed settlements: {e}")))?;
    Ok(n)
}

/// Decide whether a submission replays an already-completed attempt.
///
/// The caller cannot supply the sale id — the response that carried it is the
/// very thing that was lost — so the attempt key is the only handle back to
/// the original sale. Resolving it here, before any write, is what makes a
/// replay return a receipt instead of an error:
///
/// - `complete_sale_scoped` removes the cart as its first step, so a retry
///   would otherwise fail with "cart not found" while the sale sits completed.
/// - the shortfall command rebuilds its lines from the request body under a
///   synthetic per-submit cart id, so it has no cart dependency at all and
///   would otherwise sell the same basket a second time.
///
/// A match is trusted as THIS request's receipt only when it can be tied to
/// the request's own basket:
///
/// - Step 1 consults the re-key namespace `{attempt}:rekey:{basket}:v{n}:0`.
///   The stem binds the attempt id to THIS submission's basket identity
///   (real cart id for the scoped command, contents hash for the shortfall
///   command), and attempt ids are validated colon-free, so a hit here is
///   this basket's own settlement and answers with ITS receipt — never an
///   older attempt's. The latest void epoch answers; a VOIDED latest epoch
///   re-keys to the next epoch instead of dead-ending.
/// - Step 2 consults the base key `{attempt}:0`. A VOIDED match satisfies
///   no replay (it took no money and returned its stock) but must not block
///   a new sale either, so it re-keys into the basket namespace. A LIVE
///   match answers only while the request's cart is already consumed; if
///   that cart still exists the matched sale belongs to a DIFFERENT basket
///   and this submission settles under its own basket-derived key — a
///   silent re-key with a RANDOM stem once orphaned receipts, but a
///   basket-derived stem keeps every settlement discoverable, so the
///   second basket can still be sold (a hard refusal here would make a
///   legitimate sale impossible after a lost response).
///
/// Only the first split's key is consulted: every key of one attempt maps to
/// the same sale.
pub(super) fn replay_verdict(
    conn: &rusqlite::Connection,
    attempt_id: Option<&str>,
    basket_key: Option<&str>,
    request_cart_id: Option<&CartId>,
) -> Result<ReplayVerdict, BridgeError> {
    let Some(attempt) = attempt_id else {
        return Ok(ReplayVerdict::Fresh);
    };
    let store = Store::new(conn);
    // Step 1 — the re-key namespace: provably bound to (attempt, basket).
    if let Some(basket) = basket_key {
        let prefix = format!("{attempt}:rekey:{basket}:v");
        let settled = count_rekey_settlements(conn, &prefix)?;
        if settled > 0 {
            let latest_key = format!("{}:0", rekey_stem(attempt, basket, settled - 1));
            if let Some(sale_id) = store.find_sale_by_idempotency_key(&latest_key)? {
                let sale = store.get_sale(&sale_id)?.ok_or_else(|| {
                    BridgeError::Internal("re-keyed payment points at a missing sale".into())
                })?;
                if sale.status == foundation::SaleStatus::Voided {
                    return Ok(ReplayVerdict::Rekey(rekey_stem(attempt, basket, settled)));
                }
                return Ok(ReplayVerdict::Replayed(replay_receipt(&sale)));
            }
        }
    }
    // Step 2 — the attempt's own first-split key.
    let Some(sale_id) = store.find_sale_by_idempotency_key(&format!("{attempt}:0"))? else {
        return Ok(ReplayVerdict::Fresh);
    };
    let sale = store
        .get_sale(&sale_id)?
        .ok_or_else(|| BridgeError::Internal("replayed payment points at a missing sale".into()))?;
    if sale.status == foundation::SaleStatus::Voided {
        let Some(basket) = basket_key else {
            return Err(BridgeError::Invalid(format!(
                "checkout attempt {attempt} was voided and no basket identity was supplied — start a new checkout"
            )));
        };
        let settled = count_rekey_settlements(conn, &format!("{attempt}:rekey:{basket}:v"))?;
        return Ok(ReplayVerdict::Rekey(rekey_stem(attempt, basket, settled)));
    }
    // Key equality is not basket identity: while the request's cart still
    // exists, the matched sale belongs to a DIFFERENT basket. Settle this
    // one under its own basket-derived key — discoverable by Step 1, so no
    // receipt is orphaned and no legitimate sale is refused.
    if let Some(cart_id) = request_cart_id
        && store.load_active_cart(cart_id)?.is_some()
    {
        let Some(basket) = basket_key else {
            return Err(BridgeError::Invalid(format!(
                "checkout attempt {attempt} already completed a different basket (sale {sale_id})"
            )));
        };
        let settled = count_rekey_settlements(conn, &format!("{attempt}:rekey:{basket}:v"))?;
        return Ok(ReplayVerdict::Rekey(rekey_stem(attempt, basket, settled)));
    }
    Ok(ReplayVerdict::Replayed(replay_receipt(&sale)))
}
