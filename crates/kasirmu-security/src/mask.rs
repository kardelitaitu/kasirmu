/*
last audited 25-07-26 by RSA-Agent
crate: oz-security | status: SAFE | lint: CLEAN
findings: PCI-DSS masking verified; digit-only filtering makes byte slicing panic-free (no multibyte hazard); mask_name byte-vs-char length caveat already pinned by mask_name_byte_vs_char_caveat test (SEC-8)
next: none | perf: N/A
*/
//! PCI-DSS helpers for cardholder data handling.
//!
//! This module provides functions for masking Primary Account Numbers
//! (PAN) in compliance with PCI-DSS requirement 3.3 — display only the
//! first six and last four digits.
//!
//! # Example
//!
//! ```
//! use kasirmu_security::mask::mask_pan;
//!
//! assert_eq!(mask_pan("4111111111111111"), "411111******1111");
//! assert_eq!(mask_pan("4111-1111-1111-1111"), "411111******1111");
//! assert_eq!(mask_pan("411111111111"), "411111**1111");
//! assert_eq!(mask_pan("123"), "****");
//! ```

/// Mask a PAN (Primary Account Number) for PCI-DSS compliant display.
///
/// Shows only the first six and last four digits. All other digits are
/// replaced with `*`. Non-digit characters (spaces, hyphens) are
/// stripped before masking.
///
/// # Panics
///
/// Does not panic — returns a masked string even for short inputs.
///
/// # PCI-DSS Requirement 3.3
///
/// > Render PAN unreadable anywhere it is stored by using any of the
/// > following approaches: truncation, masking, hashing, or encryption.
/// > Mask PAN when displayed such that only the first six and last four
/// > digits are visible.
pub fn mask_pan(pan: &str) -> String {
    // Strip non-digit characters.
    let digits: String = pan.chars().filter(|c| c.is_ascii_digit()).collect();

    if digits.len() <= 6 {
        // Too short for meaningful masking — mask all.
        return "****".to_string();
    }

    // PCI-DSS 3.3: show first 6 + last 4 digits. But when the PAN is
    // ≤ 10 digits, first_six and last_four overlap (or cover the entire
    // PAN), so showing both exposes the full PAN. In that case, show
    // only the last 4 digits (the more sensitive part to hide is the
    // beginning, per PCI-DSS truncation guidance).
    if digits.len() <= 10 {
        let last_four = &digits[digits.len() - 4..];
        let masked_len = digits.len() - 4;
        let masked = "*".repeat(masked_len.max(4));
        return format!("{masked}{last_four}");
    }

    let first_six = &digits[..6];
    let last_four = &digits[digits.len() - 4..];
    let masked_len = digits.len() - 10;
    let masked = "*".repeat(masked_len);

    format!("{first_six}{masked}{last_four}")
}

/// Check whether a string contains a valid PAN format (at least 13
/// digits, at most 19 digits, passes Luhn check).
///
/// This is a basic validation — it does NOT verify that the PAN is
/// actually issued by a real financial institution.
///
/// # Example
///
/// ```
/// use kasirmu_security::mask::is_valid_pan;
///
/// // Visa test number
/// assert!(is_valid_pan("4111111111111111"));
/// // Invalid Luhn
/// assert!(!is_valid_pan("4111111111111112"));
/// ```
pub fn is_valid_pan(pan: &str) -> bool {
    let digits: String = pan.chars().filter(|c| c.is_ascii_digit()).collect();

    if digits.len() < 13 || digits.len() > 19 {
        return false;
    }

    // Luhn check.
    let mut sum = 0u32;
    let mut double = false;

    for c in digits.chars().rev() {
        let digit = c.to_digit(10).unwrap_or(0);
        if double {
            let doubled = digit * 2;
            sum += if doubled > 9 { doubled - 9 } else { doubled };
        } else {
            sum += digit;
        }
        double = !double;
    }

    sum.is_multiple_of(10)
}

/// Mask a cardholder name — show only the first and last letter of
/// each name part.
///
/// # Example
///
/// ```
/// use kasirmu_security::mask::mask_name;
///
/// assert_eq!(mask_name("John A. Doe"), "J**n A. D*e");
/// ```
pub fn mask_name(name: &str) -> String {
    name.split_whitespace()
        .map(|part| {
            if part.len() <= 2 {
                part.to_string()
            } else {
                let first = part.chars().next().unwrap_or('*');
                let last = part.chars().last().unwrap_or('*');
                let masked_len = part.len().saturating_sub(2);
                let masked = "*".repeat(masked_len);
                format!("{first}{masked}{last}")
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Mask a card verification value (CVV/CVC) — always returns `"***"`.
///
/// PCI-DSS prohibits storing CVV/CVC after authorization.
/// This function is a visual indicator that the value should NOT
/// be stored or displayed.
///
/// # Example
///
/// ```
/// use kasirmu_security::mask::mask_cvv;
///
/// assert_eq!(mask_cvv("123"), "***");
/// ```
pub fn mask_cvv(_cvv: &str) -> String {
    "***".to_string()
}

/// Mask an opaque bearer token for logging: `"..."` plus a stable tail, or
/// `"***"` when there is nothing meaningful to show.
///
/// A session token is a bearer credential — whoever holds it acts as that
/// session without knowing the user's PIN — so it must never reach a log
/// intact. A bare `"***"` is not good enough either: the eviction, expiry
/// and PIN-rotation lines each name a specific session, and support cannot
/// correlate them without some stable suffix.
///
/// The tail is eight characters, and that size is a deliberate compromise
/// rather than a round number. Four characters (16 bits) would collide
/// between two of the 256 sessions the store allows roughly half the time,
/// which makes the logs actively misleading — the failure is invisible and
/// looks like a real event about the wrong session. Eight characters
/// (32 bits) puts that below one in a hundred thousand while revealing 32 of
/// a UUID v7's ~122 random bits, leaving ~90 unguessable. Same reasoning
/// PCI-DSS accepts for PAN last-four, scaled to how many tokens are in
/// flight at once.
///
/// Inputs no longer than twice the tail are fully masked. Showing eight
/// characters of a ten-character token would leak 80% of its entropy and
/// produce a "masked" string LONGER than the secret — masking that reveals
/// most of the value is not masking, so the tail is only worth showing when
/// it is a small fraction of the whole.
///
/// # Example
///
/// ```
/// use kasirmu_security::mask::mask_token;
///
/// assert_eq!(mask_token("018f3b2c-7de7-7a91-9c4d-2f1b8a6e5d44"), "...8a6e5d44");
/// assert_eq!(mask_token("abcd1234ef01"), "***");
/// assert_eq!(mask_token(""), "***");
/// ```
pub fn mask_token(token: &str) -> String {
    const TAIL_CHARS: usize = 8;
    // Chars, not bytes: a byte slice can split a multibyte sequence and
    // panic (the hazard SEC-8 pinned for mask_name).
    let count = token.chars().count();
    if count <= TAIL_CHARS * 2 {
        return "***".to_string();
    }
    let tail: String = token.chars().skip(count - TAIL_CHARS).collect();
    format!("...{tail}")
}

#[cfg(test)]
#[path = "mask_tests.rs"]
mod tests;
