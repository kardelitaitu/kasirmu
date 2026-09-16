//! Midtrans QRIS transaction notifications: the ledger-resolving settlement
//! path, which settles a sale from the `midtrans_transactions` ledger rather
//! than the `gateway_reference` JOIN the Stripe/Square arms use. Carries the
//! deliberately strict notification shape, its constant-time signature
//! verifier, the fail-closed amount parser and the handler itself — moved
//! verbatim out of `webhooks` by the 2026-09-15 split, which leaves the
//! router, the Stripe/Square handlers, the subscription lifecycle and the two
//! shared payment helpers in the parent.
//!
//! Only `midtrans_webhook_handler` is named by the parent, so it and
//! `midtrans_gross_to_minor` are `pub(super)` and nothing is re-exported: the
//! router reaches the handler through the parent's `use`, and the parser
//! through the parent's `#[cfg(test)]` import from `webhooks_tests.rs`.
//!
//! Invariant carried with the code: `gross_amount` stays a STRING, and a
//! settlement whose signed amount disagrees with its ledger row is recorded
//! as `amount_mismatch` and never finalized.

use axum::extract::State;
use axum::http::StatusCode;
use sha2::{Digest, Sha512};

use crate::CloudServerState;
use crate::midtrans_ledger::LedgerDb;

use super::enqueue_finalize_sale;

/// Midtrans transaction notification (QRIS). Field shapes follow the
/// Core-API notification body; `gross_amount` is a STRING exactly as
/// Midtrans signs it ("15000.00") — deserializing it as a number would
/// re-canonicalize away the trailing zeros and break the signature, so the
/// type is deliberately strict (a numeric body fails with 400, and no
/// settlement can ride a malformed notification into `finalize_sale`).
#[derive(serde::Deserialize, Debug)]
struct MidtransNotification {
    /// Our ledger primary key (derived by the driver from the caller's
    /// idempotency key or a UUIDv7 tail).
    order_id: String,
    /// Gateway transaction id (recorded, not needed for routing).
    #[allow(dead_code)]
    transaction_id: Option<String>,
    /// Lifecycle status: `pending`, `authorize`, `capture`, `settlement`,
    /// `expire`, `cancel`, `refund`, `void`.
    transaction_status: String,
    /// Numeric status code as sent (part of the signed preimage).
    #[serde(default)]
    transaction_status_code: Option<String>,
    /// Signed amount string, verbatim (part of the signed preimage).
    #[serde(default)]
    gross_amount: Option<String>,
    /// Currency (QRIS: IDR).
    #[allow(dead_code)]
    #[serde(default)]
    currency: Option<String>,
    /// Hex SHA512 signature to verify.
    #[serde(default)]
    signature_key: Option<String>,
    /// Declared signature scheme; anything but `sha512` is unverifiable.
    #[allow(dead_code)]
    #[serde(default)]
    signature_type: Option<String>,
}

/// Verify a Midtrans notification signature:
/// `SHA512(order_id + status_code + gross_amount + server_key)` hex.
///
/// NOTE the deliberate difference from Stripe/Square: the preimage is the
/// CONCATENATED FIELDS, not the raw body, and the scheme is a bare digest —
/// the server key is folded into the preimage rather than used as an HMAC
/// key. Do not copy the sibling verifiers' shape. Constant time is still
/// required (CS-1 discipline): decode the provided hex and fold-compare the
/// raw digest bytes; the hex decode doubles as format validation.
fn verify_midtrans_signature(
    order_id: &str,
    status_code: &str,
    gross_amount: &str,
    server_key: &str,
    provided_hex: &str,
) -> bool {
    let mut digest = Sha512::new();
    digest.update(order_id.as_bytes());
    digest.update(status_code.as_bytes());
    digest.update(gross_amount.as_bytes());
    digest.update(server_key.as_bytes());
    let expected = digest.finalize();

    let Ok(provided) = hex::decode(provided_hex.trim()) else {
        return false;
    };
    if provided.len() != expected.len() {
        return false;
    }
    let mut acc: u8 = 0;
    for (a, b) in expected.iter().zip(provided.iter()) {
        acc |= a ^ b;
    }
    acc == 0
}

/// Parse a Midtrans amount string into IDR minor units (exp-0, whole
/// Rupiah — the PAY-1 convention the driver settled on). Accepts `"15000"`,
/// `"15000.00"`; REJECTS non-zero fractions and malformed input rather than
/// zeroing them (the old PAY-1 bug class).
pub(super) fn midtrans_gross_to_minor(raw: &str) -> Option<i64> {
    let raw = raw.trim();
    match raw.split_once('.') {
        Some((int, frac)) => {
            if frac != "00" {
                return None;
            }
            int.parse::<i64>().ok()
        }
        None => raw.parse::<i64>().ok(),
    }
}

/// `POST /api/webhooks/midtrans` — settlement notification for a QRIS
/// charge issued through `payment_api`.
///
/// Resolution goes through the `midtrans_transactions` ledger, NOT the
/// `gateway_reference` JOIN the Stripe/Square arms use: a customer can pay
/// seconds after the QR renders, long before the device's sync push lands
/// `payments`/`sales` in the cloud. The ledger was written at ISSUE time, so
/// settlement resolves even on the first notification after a fast scan.
///
/// Failure policy (deliberate, recorded in the work order): signature
/// failures answer 401 (stop retries, alert); unknown-but-genuine
/// signatures answer 200 `ignored` (verified payload for an order never
/// issued here — stale pruned row or environment leak; nothing settleable
/// exists, and 5xx would only invite notification hammering).
pub(super) async fn midtrans_webhook_handler(
    State(state): State<CloudServerState>,
    body_bytes: axum::body::Bytes,
) -> Result<axum::Json<serde_json::Value>, (StatusCode, String)> {
    let server_key = state.midtrans_server_key.as_deref().ok_or((
        StatusCode::INTERNAL_SERVER_ERROR,
        "MIDTRANS_SERVER_KEY not configured".into(),
    ))?;

    let event: MidtransNotification = serde_json::from_slice(&body_bytes).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("invalid notification body: {e}"),
        )
    })?;

    if let Some(t) = &event.signature_type
        && !t.eq_ignore_ascii_case("sha512")
    {
        return Err((
            StatusCode::UNAUTHORIZED,
            format!("unsupported signature_type '{t}'"),
        ));
    }
    let provided = event
        .signature_key
        .as_deref()
        .ok_or((StatusCode::UNAUTHORIZED, "missing signature_key".into()))?;

    let status_code = event.transaction_status_code.as_deref().unwrap_or("");
    let gross = event.gross_amount.as_deref().unwrap_or("");
    if !verify_midtrans_signature(&event.order_id, status_code, gross, server_key, provided) {
        tracing::warn!(
            order_id = %event.order_id,
            transaction_status = %event.transaction_status,
            "midtrans webhook: signature verification failed"
        );
        return Err((StatusCode::UNAUTHORIZED, "invalid webhook signature".into()));
    }

    let ledger = LedgerDb {
        db: state.db.clone(),
        pg: state.pg.clone(),
    };
    let entry = ledger
        .lookup(&event.order_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let Some(entry) = entry else {
        tracing::info!(
            order_id = %event.order_id,
            transaction_status = %event.transaction_status,
            "midtrans webhook: verified but no ledger row — ignored"
        );
        return Ok(axum::Json(serde_json::json!({
            "status": "ignored", "reason": "unmatched_order_id",
        })));
    };

    let status = event.transaction_status.to_ascii_lowercase();
    let settle_like = status == "settlement" || status == "capture";

    if settle_like {
        // Amount policy (fail closed): a settlement whose signed amount
        // disagrees with what we asked to charge is an incident, not a
        // rounding debate — record it and DO NOT finalize.
        let minor_ok = match event.gross_amount.as_deref().map(midtrans_gross_to_minor) {
            Some(Some(v)) => v == entry.amount_minor,
            Some(None) => false, // malformed fraction/garbage in a signed field
            None => false,       // settlement without a signed amount
        };
        if !minor_ok {
            tracing::error!(
                order_id = %event.order_id,
                tenant_id = %entry.tenant_id,
                sale_id = %entry.sale_id,
                expected_minor = entry.amount_minor,
                received = ?event.gross_amount,
                "MIDTRANS AMOUNT MISMATCH — settlement NOT enqueued; reconcile manually"
            );
            ledger
                .mark_status(&event.order_id, &entry.tenant_id, "amount_mismatch")
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            return Ok(axum::Json(serde_json::json!({
                "status": "recorded", "reason": "amount_mismatch",
            })));
        }
        if entry.status == "settlement"
            || entry.status == "capture"
            || entry.status == "amount_mismatch"
        {
            // Sequential duplicate (the common redelivery) — the ledger
            // status is the idempotency gate. Fully concurrent duplicates
            // (both reads before either write) may double-enqueue; the
            // device's finalize is a no-op on an already-finalized sale,
            // and a lost enqueue would be strictly worse than a duplicate.
            return Ok(axum::Json(serde_json::json!({
                "status": "already_processed", "order_id": event.order_id,
            })));
        }
        // Enqueue FIRST, then mark: an enqueue failure returns 5xx so the
        // gateway retries the notification (ledger still says `issued`, so
        // the retry re-runs this path) — whereas marking settled first and
        // losing the enqueue would silently eat a paid sale forever.
        enqueue_finalize_sale(&state, &entry.sale_id, &entry.tenant_id).await?;
        ledger
            .mark_status(&event.order_id, &entry.tenant_id, &status)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        Ok(axum::Json(serde_json::json!({
            "status": "finalization_queued",
            "order_id": event.order_id,
            "sale_id": entry.sale_id,
        })))
    } else {
        // Non-settling lifecycle updates (`expire`, `cancel`, `refund`,
        // `pending`, `authorize`, …): recorded verbatim, never finalized.
        // `mark_status` refuses to downgrade a settled row, so a late
        // `expire` after `settlement` becomes an observable anomaly instead
        // of a rewrite.
        if entry.status == "settlement" || entry.status == "capture" {
            tracing::error!(
                order_id = %event.order_id,
                late_status = %status,
                "midtrans: non-settling notification for an already settled order — anomaly"
            );
        }
        ledger
            .mark_status(&event.order_id, &entry.tenant_id, &status)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
        Ok(axum::Json(serde_json::json!({
            "status": "recorded",
            "order_id": event.order_id,
            "transaction_status": status,
        })))
    }
}
