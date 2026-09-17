use super::*;

#[test]
fn mask_pan_standard() {
    assert_eq!(mask_pan("4111111111111111"), "411111******1111");
}

#[test]
fn mask_pan_with_dashes() {
    assert_eq!(mask_pan("4111-1111-1111-1111"), "411111******1111");
}

#[test]
fn mask_pan_with_spaces() {
    assert_eq!(mask_pan("4111 1111 1111 1111"), "411111******1111");
}

#[test]
fn mask_pan_short() {
    assert_eq!(mask_pan("123"), "****");
}

#[test]
fn mask_pan_exactly_10_digits() {
    // 10-digit PAN: first_six + last_four would cover the entire
    // PAN, so only last 4 is shown (PCI-DSS 3.3 compliant).
    assert_eq!(mask_pan("1234567890"), "******7890");
}

#[test]
fn mask_pan_12_digits() {
    // 12-digit PAN: first 6 + last 4 cover 10 digits, leaving 2 masked.
    assert_eq!(mask_pan("411111111111"), "411111**1111");
}

#[test]
fn mask_pan_amex() {
    // Amex is 15 digits: 378282246310005
    assert_eq!(mask_pan("378282246310005"), "378282*****0005");
}

#[test]
fn mask_pan_empty() {
    assert_eq!(mask_pan(""), "****");
}

#[test]
fn is_valid_pan_visa() {
    assert!(is_valid_pan("4111111111111111"));
}

#[test]
fn is_valid_pan_mastercard() {
    assert!(is_valid_pan("5555555555554444"));
}

#[test]
fn is_valid_pan_amex() {
    assert!(is_valid_pan("378282246310005"));
}

#[test]
fn is_valid_pan_invalid_luhn() {
    assert!(!is_valid_pan("4111111111111112"));
}

#[test]
fn is_valid_pan_too_short() {
    assert!(!is_valid_pan("411111111111"));
}

#[test]
fn is_valid_pan_too_long() {
    assert!(!is_valid_pan("411111111111111111111"));
}

#[test]
fn is_valid_pan_with_formatting() {
    assert!(is_valid_pan("4111-1111-1111-1111"));
}

#[test]
fn mask_name_standard() {
    // "John" → J**n, "A." → A. (len <= 2), "Doe" → D*e
    assert_eq!(mask_name("John A. Doe"), "J**n A. D*e");
}

#[test]
fn mask_name_short() {
    assert_eq!(mask_name("Al"), "Al");
}

#[test]
fn mask_name_single() {
    assert_eq!(mask_name("John"), "J**n");
}

#[test]
fn mask_cvv_always_stars() {
    assert_eq!(mask_cvv("123"), "***");
    assert_eq!(mask_cvv(""), "***");
    assert_eq!(mask_cvv("9999"), "***");
}

// ── PCI-DSS 3.3: mask_pan must not expose the full PAN (Bug #16) ────
//
// PCI-DSS Requirement 3.3: "Mask PAN when displayed such that only
// the first six and last four digits are visible."
//
// For PANs of length 7-10, the current implementation shows BOTH
// the first 6 and last 4 digits. When the PAN is <= 10 digits,
// first_six + last_four covers (or exceeds) the entire PAN — so
// the full PAN is reconstructable from the "masked" output.
// The `.max(4)` on masked_len adds 4 stars, giving the *illusion*
// of masking while exposing the full number. This is a PCI-DSS
// violation and a security bug.

#[test]
fn mask_pan_10_digits_does_not_expose_full_pan() {
    // A 10-digit "PAN": first_six="123456", last_four="7890".
    // Together they cover ALL 10 digits — the full PAN is
    // reconstructable by concatenating the visible first 6 and
    // last 4. PCI-DSS 3.3 requires that the PAN NOT be fully
    // recoverable from the masked display.
    let pan = "1234567890";
    let masked = mask_pan(pan);
    // Extract all digit groups from the masked output (split on '*').
    let visible_digits: String = masked
        .split('*')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .concat();
    // The visible digits (first 6 + last 4 concatenated) must NOT
    // reconstruct the full original PAN.
    assert_ne!(
        visible_digits, pan,
        "mask_pan must not expose enough digits to reconstruct the \
         full 10-digit PAN — got '{masked}' (visible digits: '{visible_digits}' \
         reconstruct the full PAN '{pan}')"
    );
}

#[test]
fn mask_pan_7_digits_does_not_leak_more_than_4() {
    // A 7-digit "PAN": first_six="123456", last_four="4567".
    // These OVERLAP (digits 4-6 appear in both), so the masked
    // output exposes all 7 digits — more than the 4 PCI-DSS allows
    // for the "last four" display of a short PAN. The fix: when
    // first_six and last_four overlap (PAN <= 10 digits), don't
    // show first_six (show only last 4 with the rest masked).
    let pan = "1234567";
    let masked = mask_pan(pan);
    // Extract all digit groups from the masked output.
    let visible_digits: String = masked
        .split('*')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .concat();
    // For a 7-digit PAN, at most 4 digits should be visible (last 4).
    assert!(
        visible_digits.len() <= 4,
        "mask_pan must show at most 4 digits for a 7-digit PAN (PCI-DSS \
         allows first 6 + last 4 only when they don't overlap) — got \
         '{masked}' (visible digits: '{visible_digits}', {} visible)",
        visible_digits.len()
    );
}

// ── Edge cases: non-ASCII digits, formatting, length boundaries ──

/// Unicode numeral-like characters (Arabic-Indic ٠-٩, emoji, etc.)
/// are NOT `is_ascii_digit` and must be filtered out before masking.
/// A pure Unicode-digit input strips to empty digits → falls back
/// to `"****"`. Mixed inputs strip non-digits and mask the
/// remaining ASCII digits per the standard rule.
#[test]
fn mask_pan_non_ascii_digits() {
    // Eleven Arabic-Indic digits (0x0660-0x0669) are visually
    // digits but not ASCII. After the `is_ascii_digit` filter, no
    // digits remain → fallback `"****"`.
    assert_eq!(
        mask_pan(
            "\u{0660}\u{0661}\u{0662}\u{0663}\u{0664}\u{0665}\u{0666}\u{0667}\u{0668}\u{0669}\u{0660}"
        ),
        "****"
    );
    // Mixed ASCII digits + letters + emoji: only the 12 ASCII digits
    // count, so the result is the standard 12-digit mask.
    assert_eq!(mask_pan("1234abcd5678\u{01F440}9012"), "123456**9012");
}

/// 11-digit boundary: the smallest length where the first_six +
/// last_four branch kicks in (1 star of masking).
#[test]
fn mask_pan_11_digits_boundary() {
    assert_eq!(mask_pan("12345678901"), "123456*8901");
}

/// 19-digit maximum (per ISO/IEC 7812). 9 stars between first_six
/// and last_four.
#[test]
fn mask_pan_19_digits_max() {
    assert_eq!(mask_pan("1234567890123456789"), "123456*********6789");
}

/// 20+ digit input is over-length. The current implementation
/// does not validate; the slice arithmetic still applies, producing
/// `(len-10)` stars between first 6 and last 4. This test pins the
/// non-panicking behavior so any future `digits.len() > 19` guard
/// is a deliberate change, not an accidental regression.
#[test]
fn mask_pan_20_digits_over_length() {
    assert_eq!(mask_pan("12345678901234567890"), "123456**********7890");
}

/// Inputs containing no ASCII digits (letters, whitespace-only)
/// filter to an empty digit set and fall back to `"****"`.
#[test]
fn mask_pan_letters_only() {
    assert_eq!(mask_pan("ABCD-EFGH-IJKL-MNOP"), "****");
    assert_eq!(mask_pan("         "), "****");
}

// ── is_valid_pan length boundary tests ────────────────────────

/// 13 digits is the minimum valid length per ISO/IEC 7812. Zero-only
/// input trivially passes Luhn (0×2=0 ⇒ sum=0 ⇒ divisible by 10),
/// so this is a clean boundary marker independent of any single
/// test card being valid.
#[test]
fn is_valid_pan_13_digits_edge() {
    assert!(is_valid_pan("0000000000000"));
}

/// 19 digits is the maximum valid length per ISO/IEC 7812.
#[test]
fn is_valid_pan_19_digits_edge() {
    assert!(is_valid_pan("0000000000000000000"));
}

/// Strings composed entirely of Unicode digit-like characters
/// (Arabic-Indic ٠-٩) are NOT ASCII digits — `is_ascii_digit`
/// filters every char, leaving 0 digits. Length 0 < 13 ⇒ rejected.
/// This guards against Unicode-based Luhn-injection attempts.
#[test]
fn is_valid_pan_unicode_digits() {
    assert!(!is_valid_pan(
        "\u{0664}\u{0661}\u{0661}\u{0661}\u{0661}\u{0661}\u{0661}\u{0661}\u{0661}\u{0661}\u{0661}\u{0661}\u{0661}\u{0661}\u{0661}\u{0661}"
    ));
}

// ── PCI-DSS 3.3 invariant: exhaustive length sweep ──────────────

/// For every valid length 11..=19, `mask_pan` must produce exactly
/// `first_six + (len-10 stars) + last_four` from the input — no
/// other digits visible, no deviation from the PCI-DSS 3.3 mask
/// structure. This is the core invariant: the visible digits
/// never extend beyond first 6 and last 4, and never overlap.
#[test]
fn mask_pan_exact_invariant_11_through_19() {
    for len in 11..=19 {
        let pan = "1".repeat(6) + &"2".repeat(len - 10) + &"3".repeat(4);
        let expected = format!("{}{}{}", "111111", "*".repeat(len - 10), "3333");
        assert_eq!(mask_pan(&pan), expected, "len = {len}");
    }
}

// ── mask_name byte vs. char semantics ───────────────────────────

/// `mask_name` keys off `String::len()`, which counts **bytes**
/// (not Unicode scalar values). This test documents the boundary
/// so future readers know what to expect for multi-byte input.
///
/// `'é'` (U+00E9) is 2 bytes UTF-8 → falls in the short-string branch
/// and is returned unchanged. `'😊'` (U+1F60A) is 4 bytes UTF-8 →
/// enters the masking branch and becomes `<first>**<last>`.
#[test]
fn mask_name_byte_vs_char_caveat() {
    assert_eq!(mask_name("\u{00E9}"), "\u{00E9}");
    assert_eq!(mask_name("\u{1F60A}"), "\u{1F60A}**\u{1F60A}");
}

/// `split_whitespace` collapses runs of any unicode whitespace
/// (spaces, tabs, newlines), so `"John \t\n  Doe"` parses into
/// `["John", "Doe"]` and masks each part separately.
#[test]
fn mask_name_collapses_whitespace() {
    assert_eq!(mask_name("John \t\n  Doe"), "J**n D*e");
}

// ── mask_cvv universal-masking guarantee ───────────────────────

/// PCI-DSS prohibits CVV display/storage after authorization.
/// `mask_cvv` must return `"***"` for **every** input — empty,
/// extreme length, emoji-prefixed, mixed-symbol. This pins the
/// invariant so any future change that exposes even a partial
/// digit of input is loudly caught by tests.
#[test]
fn mask_cvv_extreme_inputs() {
    assert_eq!(mask_cvv(""), "***");
    assert_eq!(mask_cvv("\u{1F60A}9!"), "***");
    assert_eq!(mask_cvv("123456789012345"), "***");
}

// ── mask_token: bearer credentials in logs ───────────────────

/// Session tokens are bearer credentials: whoever holds one acts as that
/// session without knowing the PIN. The point of `mask_token` is that a log
/// line can name a session without handing over the ability to *be* it, so
/// the front of the value — where a UUID v7 carries its timestamp — must
/// never appear.
#[test]
fn mask_token_keeps_only_a_stable_tail() {
    let token = "018f3b2c-7de7-7a91-9c4d-2f1b8a6e5d44";
    let masked = mask_token(token);
    assert_eq!(masked, "...8a6e5d44");
    assert!(!masked.contains("018f3b2c"), "front half leaked: {masked}");
    assert!(!masked.contains(token), "full token leaked: {masked}");
}

#[test]
fn mask_token_never_emits_a_value_it_could_be_recovered_from() {
    // Short tokens are the case a naive implementation gets wrong: showing
    // 8 of 10 characters leaks 80% of the entropy and returns a string
    // LONGER than the secret. Anything at or below twice the tail is fully
    // masked, so the output is always strictly smaller than a real token.
    for (token, shows_tail) in [
        ("018f3b2c-7de7-7a91-9c4d-2f1b8a6e5d44", true),
        ("018f3b2c7de77a919c4d2f1b8a6e5d44", true),
        ("sk_live_9f2b1c0d4e5a6b7c8d9e", true),
        ("0123456789", false),
        ("abcd1234ef01", false),
        ("a", false),
        ("", false),
    ] {
        let masked = mask_token(token);
        if shows_tail {
            assert!(masked.starts_with("..."), "got {masked:?} for {token:?}");
            assert!(
                !masked.contains(token),
                "{token:?} leaked through as {masked:?}"
            );
            assert!(
                masked.len() < token.len(),
                "masking must shrink the value, got {masked:?} for {token:?}"
            );
        } else {
            assert_eq!(masked, "***", "{token:?} is too short to show a tail");
        }
    }
}

/// Eight characters, not four: with the 256 sessions the desktop store
/// allows, a 16-bit suffix collides between two sessions about half the
/// time, which makes the log misleading rather than merely lossy. The
/// failure is invisible — it looks like a real event about the wrong
/// session — so the size is pinned, not left as a round-number preference.
#[test]
fn mask_token_tail_is_eight_characters() {
    let masked = mask_token("018f3b2c-7de7-7a91-9c4d-2f1b8a6e5d44");
    assert_eq!(masked.chars().count(), 11, "expected '...' + 8 chars");
    assert_eq!(masked.chars().count() - "...".chars().count(), 8);
}

#[test]
fn mask_token_handles_multibyte_without_panicking() {
    // The SEC-8 hazard that byte-slicing mask_name has: a byte-based tail
    // would split one of these and panic at the char boundary.
    let token = "🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉tailhere";
    let masked = mask_token(token);
    assert!(masked.starts_with("..."), "got {masked:?}");
    assert_eq!(masked.chars().count(), 11);
}

#[test]
fn mask_token_is_deterministic_so_logs_can_correlate() {
    let token = "018f3b2c-7de7-7a91-9c4d-2f1b8a6e5d44";
    assert_eq!(mask_token(token), mask_token(token));
    assert_ne!(
        mask_token(token),
        mask_token("018f3b2c-7de7-7a91-9c4d-2f1b8a6e0000"),
        "two different sessions must not collapse onto one label"
    );
}
