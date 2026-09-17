//! Fuzz target for `Percentage` construction, arithmetic, and serde —
//! feeds arbitrary bytes to `Percentage::new`, `apply_to` /
//! `complement_apply_to` over arbitrary `Money` values, and the JSON
//! deserializer, verifying no panics and the `0..=100` invariant.
//!
//! Percentages sit in the discount/tax path, so the checked-mul/div overflow
//! boundaries here are payment-adjacent — the same class of bug the
//! `money_parse` target hunts. Mirrors the honggfuzz target at
//! tools/fuzz/hfuzz/fuzz_targets/percentage_parse.rs.

#![no_main]

use libfuzzer_sys::fuzz_target;
use foundation::money::{Currency, Money};
use foundation::percentage::Percentage;

fuzz_target!(|data: &[u8]| {
    // ── Construction: every possible first byte is a u8 ─────────────
    if let Some(&v) = data.first() {
        match Percentage::new(v) {
            Some(p) => {
                // Invariant: accepted values are bounded 0..=100
                // and `get` round-trips the constructor input.
                assert!(v <= 100, "accepted percentage must be 0..=100");
                assert_eq!(p.get(), v, "Percentage::get round-trip mismatch");
                // Display must render "<value>%".
                assert_eq!(p.to_string(), format!("{v}%"), "Display mismatch");
                // Helpers must agree with `new`.
                if v == 0 {
                    assert_eq!(p, Percentage::zero(), "zero() must equal new(0)");
                }
                if v == 100 {
                    assert_eq!(p, Percentage::hundred(), "hundred() must equal new(100)");
                }
            }
            None => {
                assert!(v > 100, "rejected percentage must be > 100");
            }
        }
    }

    // ── Arithmetic over arbitrary Money values ─────────────────────
    if data.len() >= 8 {
        let minor = i64::from_le_bytes(data[0..8].try_into().expect("8 bytes"));
        let currency: Currency = "USD".parse().expect("USD is valid");
        let money = Money { minor_units: minor, currency };

        // Every legal percentage over extreme minor-unit values:
        // checked ops must never panic (Ok or None only).
        for &pct_val in &[0u8, 1, 10, 33, 50, 99, 100] {
            if let Some(pct) = Percentage::new(pct_val) {
                let _ = pct.apply_to(money);
                let _ = pct.complement_apply_to(money);
            }
        }

        // Bounds sanity (exact when no overflow occurs):
        // 0% → zero, 100% → identity, and vice-versa for the
        // complement operation.
        if let (Some(zero), Some(hundred)) = (Percentage::new(0), Percentage::new(100)) {
            if let Some(out) = zero.apply_to(money) {
                assert_eq!(out.minor_units, 0, "0% of anything must be zero");
            }
            if let Some(out) = hundred.apply_to(money) {
                assert_eq!(out, money, "100% must be the identity");
            }
            if let Some(out) = zero.complement_apply_to(money) {
                assert_eq!(out, money, "complement of 0% must be the identity (100%)");
            }
            if let Some(out) = hundred.complement_apply_to(money) {
                assert_eq!(out.minor_units, 0, "complement of 100% must be zero");
            }
        }
    }

    // ── Serde: arbitrary text as a JSON number ─────────────────────
    if let Ok(s) = std::str::from_utf8(data) {
        // Must deserialize into a 0..=100 Percentage or fail with
        // an error — never panic.
        let _: Result<Percentage, _> = serde_json::from_str(s);
    }
});
