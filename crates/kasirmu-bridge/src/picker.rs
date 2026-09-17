//! Picker-ticket primitives (Wave B / B4a) — the tauri-free half of
//! `apps/desktop-tauri/src/commands/picker_ticket.rs`.
//!
//! A ticket is `{user_id}.{expiry_ts}.{hex_hmac}` where the HMAC covers
//! `picker:{user_id}:{expiry_ts}` with the per-process secret carried by
//! `BridgeCtx::picker_ticket_secret`. These functions take the secret as a
//! parameter (verbatim from the shell module) so every caller — the bridge
//! auth/staff bodies, the pre-session `workspaces` commands and the unit
//! tests — shares exactly one implementation.
//!
//! Verification is deliberately uniform: forged, expired and malformed
//! tickets all yield `None`, so the ticket can never be used as an
//! enumeration oracle. The signature check uses `Mac::verify_slice`
//! (constant-time).

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// How long a picker ticket stays valid, in seconds.
///
/// 5 minutes is enough for login → workspace selection; the opaque
/// session token created by `create_session` takes over afterwards.
pub const PICKER_TICKET_TTL_SECS: i64 = 300;

/// Sign a picker ticket for `user_id` valid until `expiry_ts`.
///
/// Format: `{user_id}.{expiry_ts}.{hex_hmac}` — the HMAC covers
/// `picker:{user_id}:{expiry_ts}` so neither the user nor the expiry
/// can be altered without the secret.
pub fn sign_picker_ticket(secret: &[u8], user_id: &str, expiry_ts: i64) -> String {
    let mut mac = new_mac(secret);
    mac.update(b"picker:");
    mac.update(user_id.as_bytes());
    mac.update(b":");
    mac.update(expiry_ts.to_string().as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());
    format!("{user_id}.{expiry_ts}.{sig}")
}

/// Build the HMAC-SHA256 instance for the picker-ticket domain.
///
/// HMAC-SHA256 accepts any key length, so `new_from_slice` cannot
/// fail for the byte slice we hand it (SHA-256 block size is 64 bytes,
/// far below the 255-byte HMAC limit). The `expect` is provably total.
fn new_mac(secret: &[u8]) -> HmacSha256 {
    // SAFETY: HMAC-SHA256 accepts any key length (SHA-256 block is 64 bytes,
    // far below the 255-byte HMAC limit), so new_from_slice cannot fail.
    HmacSha256::new_from_slice(secret).expect("HMAC-SHA256 accepts any key length")
}

/// Verify a picker ticket at time `now_ts`.
///
/// Returns the bound `user_id` when the signature is valid and the
/// ticket has not expired. Returns `None` for every failure mode
/// (forged, expired, malformed) so the caller surfaces one uniform
/// denial — the ticket cannot be used as an enumeration oracle.
///
/// Signature comparison uses `Mac::verify_slice` (constant-time),
/// never a byte-string equality that could leak the match position.
pub fn verify_picker_ticket(secret: &[u8], ticket: &str, now_ts: i64) -> Option<String> {
    let mut parts = ticket.splitn(3, '.');
    let user_id = parts.next()?;
    let expiry_ts: i64 = parts.next()?.parse().ok()?;
    let sig = parts.next()?;

    if user_id.is_empty() || expiry_ts < now_ts {
        return None;
    }

    let mut mac = new_mac(secret);
    mac.update(b"picker:");
    mac.update(user_id.as_bytes());
    mac.update(b":");
    mac.update(expiry_ts.to_string().as_bytes());

    let expected = hex::decode(sig).ok()?;
    mac.verify_slice(&expected).ok()?;

    Some(user_id.to_owned())
}

#[cfg(test)]
#[path = "picker_ticket_tests.rs"]
mod picker_ticket_tests;
