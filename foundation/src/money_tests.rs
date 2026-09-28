use super::*;

fn usd() -> Currency {
    "USD".parse().unwrap()
}

#[test]
fn money_zero_is_zero() {
    assert_eq!(Money::zero(usd()).minor_units, 0);
}

#[test]
fn money_from_major_dollars() {
    let m = Money::from_major(12, usd()).unwrap();
    assert_eq!(m.minor_units, 1200);
}

#[test]
fn money_from_major_jpy_has_no_exponent() {
    let jpy: Currency = "JPY".parse().unwrap();
    let m = Money::from_major(12, jpy).unwrap();
    assert_eq!(m.minor_units, 12);
}

#[test]
fn money_from_major_overflow_returns_none() {
    let kwd: Currency = "KWD".parse().unwrap();
    assert!(Money::from_major(i64::MAX, kwd).is_none());
}

#[test]
fn checked_add_same_currency() {
    let a = Money::from_major(5, usd()).unwrap();
    let b = Money::from_major(7, usd()).unwrap();
    assert_eq!(a.checked_add(b).unwrap().minor_units, 1200);
}

#[test]
fn checked_add_different_currency_returns_none() {
    let eur: Currency = "EUR".parse().unwrap();
    let a = Money::from_major(5, usd()).unwrap();
    let b = Money::from_major(5, eur).unwrap();
    assert!(a.checked_add(b).is_none());
}

#[test]
fn checked_add_overflow_returns_none() {
    let a = Money {
        minor_units: i64::MAX,
        currency: usd(),
    };
    let b = Money::from_major(1, usd()).unwrap();
    assert!(a.checked_add(b).is_none());
}

// ── checked_sub ────────────────────────────────────────────

#[test]
fn checked_sub_same_currency() {
    let a = Money::from_major(10, usd()).unwrap();
    let b = Money::from_major(3, usd()).unwrap();
    let result = a.checked_sub(b).unwrap();
    assert_eq!(result.minor_units, 700);
    assert_eq!(result.currency, usd());
}

#[test]
fn checked_sub_different_currency_returns_none() {
    let eur: Currency = "EUR".parse().unwrap();
    let a = Money::from_major(10, usd()).unwrap();
    let b = Money::from_major(3, eur).unwrap();
    assert!(a.checked_sub(b).is_none());
}

#[test]
fn checked_sub_underflow_returns_none() {
    let a = Money {
        minor_units: i64::MIN,
        currency: usd(),
    };
    let b = Money::from_major(1, usd()).unwrap();
    assert!(a.checked_sub(b).is_none());
}

#[test]
fn checked_sub_result_is_zero() {
    let a = Money::from_major(7, usd()).unwrap();
    let b = Money::from_major(7, usd()).unwrap();
    assert_eq!(a.checked_sub(b).unwrap().minor_units, 0);
}

// ── checked_mul ────────────────────────────────────────────

#[test]
fn checked_mul_by_scalar() {
    let m = Money::from_major(5, usd()).unwrap();
    let result = m.checked_mul(3).unwrap();
    assert_eq!(result.minor_units, 1500);
}

#[test]
fn checked_mul_by_zero() {
    let m = Money::from_major(5, usd()).unwrap();
    let result = m.checked_mul(0).unwrap();
    assert_eq!(result.minor_units, 0);
}

#[test]
fn checked_mul_by_one() {
    let m = Money::from_major(5, usd()).unwrap();
    let result = m.checked_mul(1).unwrap();
    assert_eq!(result.minor_units, 500);
}

#[test]
fn checked_mul_overflow_returns_none() {
    let m = Money {
        minor_units: i64::MAX,
        currency: usd(),
    };
    assert!(m.checked_mul(2).is_none());
}

#[test]
fn checked_mul_preserves_currency() {
    let jpy: Currency = "JPY".parse().unwrap();
    let m = Money::from_major(100, jpy).unwrap();
    let result = m.checked_mul(2).unwrap();
    assert_eq!(result.currency, jpy);
}

// ── checked_div ────────────────────────────────────────────

#[test]
fn checked_div_by_scalar() {
    let m = Money::from_major(10, usd()).unwrap();
    let result = m.checked_div(3).unwrap();
    assert_eq!(result.minor_units, 333); // 1000 / 3 = 333 (truncated)
}

#[test]
fn checked_div_by_one() {
    let m = Money::from_major(7, usd()).unwrap();
    let result = m.checked_div(1).unwrap();
    assert_eq!(result.minor_units, 700);
}

#[test]
fn checked_div_by_zero_returns_none() {
    let m = Money::from_major(5, usd()).unwrap();
    assert!(m.checked_div(0).is_none());
}

#[test]
fn checked_div_negative_scalar() {
    let m = Money::from_major(10, usd()).unwrap();
    let result = m.checked_div(-2).unwrap();
    assert_eq!(result.minor_units, -500);
}

#[test]
fn checked_div_preserves_currency() {
    let eur: Currency = "EUR".parse().unwrap();
    let m = Money::from_major(15, eur).unwrap();
    let result = m.checked_div(2).unwrap();
    assert_eq!(result.currency, eur);
}

// ── negate ─────────────────────────────────────────────────

#[test]
fn negate_positive_becomes_negative() {
    let m = Money::from_major(5, usd()).unwrap();
    let neg = m.negate();
    assert_eq!(neg.minor_units, -500);
    assert_eq!(neg.currency, usd());
}

#[test]
fn negate_negative_becomes_positive() {
    let m = Money {
        minor_units: -500,
        currency: usd(),
    };
    let pos = m.negate();
    assert_eq!(pos.minor_units, 500);
}

#[test]
fn negate_zero_stays_zero() {
    let m = Money::zero(usd()).negate();
    assert_eq!(m.minor_units, 0);
}

#[test]
fn negate_twice_is_identity() {
    let m = Money::from_major(5, usd()).unwrap();
    assert_eq!(m.negate().negate(), m);
}

// ── abs ────────────────────────────────────────────────────

#[test]
fn abs_positive_is_noop() {
    let m = Money::from_major(5, usd()).unwrap();
    assert_eq!(m.abs().minor_units, 500);
}

#[test]
fn abs_negative_becomes_positive() {
    let m = Money {
        minor_units: -500,
        currency: usd(),
    };
    assert_eq!(m.abs().minor_units, 500);
}

#[test]
fn abs_zero_is_zero() {
    assert_eq!(Money::zero(usd()).abs().minor_units, 0);
}

#[test]
fn abs_preserves_currency() {
    let jpy: Currency = "JPY".parse().unwrap();
    let m = Money {
        minor_units: -1000,
        currency: jpy,
    };
    assert_eq!(m.abs().currency, jpy);
}

// ── checked_negate ─────────────────────────────────────────

#[test]
fn checked_negate_positive_becomes_negative() {
    let m = Money::from_major(5, usd()).unwrap();
    let neg = m.checked_negate().unwrap();
    assert_eq!(neg.minor_units, -500);
    assert_eq!(neg.currency, usd());
}

#[test]
fn checked_negate_negative_becomes_positive() {
    let m = Money {
        minor_units: -500,
        currency: usd(),
    };
    let pos = m.checked_negate().unwrap();
    assert_eq!(pos.minor_units, 500);
}

#[test]
fn checked_negate_zero_stays_zero() {
    let m = Money::zero(usd()).checked_negate().unwrap();
    assert_eq!(m.minor_units, 0);
    assert_eq!(m.currency, usd());
}

#[test]
fn checked_negate_i64_min_returns_none() {
    // -i64::MIN overflows; must not panic like `negate()` does.
    let m = Money {
        minor_units: i64::MIN,
        currency: usd(),
    };
    assert!(m.checked_negate().is_none());
}

#[test]
fn checked_negate_twice_is_identity() {
    let m = Money::from_major(5, usd()).unwrap();
    assert_eq!(m.checked_negate().and_then(super::Money::checked_negate), Some(m));
}

// ── checked_abs ────────────────────────────────────────────

#[test]
fn checked_abs_positive_is_noop() {
    let m = Money::from_major(5, usd()).unwrap();
    let a = m.checked_abs().unwrap();
    assert_eq!(a.minor_units, 500);
    assert_eq!(a.currency, usd());
}

#[test]
fn checked_abs_negative_becomes_positive() {
    let m = Money {
        minor_units: -500,
        currency: usd(),
    };
    let a = m.checked_abs().unwrap();
    assert_eq!(a.minor_units, 500);
}

#[test]
fn checked_abs_zero_is_zero() {
    let a = Money::zero(usd()).checked_abs().unwrap();
    assert_eq!(a.minor_units, 0);
}

#[test]
fn checked_abs_i64_min_returns_none() {
    // i64::MIN.abs() overflows; must not panic like `abs()` does.
    let m = Money {
        minor_units: i64::MIN,
        currency: usd(),
    };
    assert!(m.checked_abs().is_none());
}

#[test]
fn checked_abs_preserves_currency() {
    let jpy: Currency = "JPY".parse().unwrap();
    let m = Money {
        minor_units: -1000,
        currency: jpy,
    };
    assert_eq!(m.checked_abs().unwrap().currency, jpy);
}

// ── is_zero ────────────────────────────────────────────────

#[test]
fn is_zero_true_for_zero() {
    assert!(Money::zero(usd()).is_zero());
}

#[test]
fn is_zero_false_for_non_zero() {
    let m = Money::from_major(1, usd()).unwrap();
    assert!(!m.is_zero());
}

#[test]
fn is_zero_false_for_negative() {
    let m = Money {
        minor_units: -1,
        currency: usd(),
    };
    assert!(!m.is_zero());
}

#[test]
fn is_zero_chained_after_arithmetic() {
    let a = Money::from_major(3, usd()).unwrap();
    let b = Money::from_major(3, usd()).unwrap();
    assert!(a.checked_sub(b).unwrap().is_zero());
}

#[test]
fn currency_from_str_rejects_bad_input() {
    assert!("US".parse::<Currency>().is_err());
    assert!("USDD".parse::<Currency>().is_err());
    assert!("U2D".parse::<Currency>().is_err());
    assert!("USD".parse::<Currency>().is_ok());
}

#[test]
fn minor_unit_exponent_known_codes() {
    assert_eq!(usd().minor_unit_exponent(), 2);
    assert_eq!("JPY".parse::<Currency>().unwrap().minor_unit_exponent(), 0);
    assert_eq!("IDR".parse::<Currency>().unwrap().minor_unit_exponent(), 0);
    assert_eq!("KWD".parse::<Currency>().unwrap().minor_unit_exponent(), 3);
}

#[test]
fn money_from_major_idr_has_no_exponent() {
    let idr: Currency = "IDR".parse().unwrap();
    // IDR minor unit IS the Rupiah (exp 0): Rp 12 → 12 minor units.
    let m = Money::from_major(12, idr).unwrap();
    assert_eq!(m.minor_units, 12);
}

#[test]
fn format_minor_uses_currency_exponent() {
    let idr: Currency = "IDR".parse().unwrap();
    let usd: Currency = "USD".parse().unwrap();
    let kwd: Currency = "KWD".parse().unwrap();
    // exp 0: minor unit IS the Rupiah.
    assert_eq!(format_minor(4_450_000, idr), "4450000");
    // exp 2: 1,200 cents → $12.00.
    assert_eq!(format_minor(1_200, usd), "12.00");
    // exp 3: 12 fils → KWD 0.012.
    assert_eq!(format_minor(12, kwd), "0.012");
    // Negative keeps sign on the major part.
    assert_eq!(format_minor(-1_200, usd), "-12.00");
    // Negative sub-major amount keeps its sign too (refund/void totals).
    assert_eq!(format_minor(-12, usd), "-0.12");
    assert_eq!(format_minor(-12, kwd), "-0.012");
    assert_eq!(format_minor(-4_450_000, idr), "-4450000");
}

#[test]
fn lowercase_currency_parses_with_correct_exponent() {
    // Lowercase codes should parse and produce the same exponent as uppercase.
    let jpy: Currency = "jpy".parse().unwrap();
    assert_eq!(
        jpy.minor_unit_exponent(),
        0,
        "'jpy' should have 0 exponent like 'JPY'"
    );
    let krw: Currency = "krw".parse().unwrap();
    assert_eq!(
        krw.minor_unit_exponent(),
        0,
        "'krw' should have 0 exponent like 'KRW'"
    );
    let kwd: Currency = "kwd".parse().unwrap();
    assert_eq!(
        kwd.minor_unit_exponent(),
        3,
        "'kwd' should have 3 exponent like 'KWD'"
    );
}

#[test]
fn mixed_case_currency_parses_with_correct_exponent() {
    let jpy: Currency = "Jpy".parse().unwrap();
    assert_eq!(jpy.minor_unit_exponent(), 0, "'Jpy' should have 0 exponent");
}

// ── Additional edge-case tests ───────────────────────────────────────

#[test]
fn format_minor_jpy_no_decimal_places() {
    let jpy: Currency = "JPY".parse().unwrap();
    assert_eq!(format_minor(12345, jpy), "12345");
}

#[test]
fn format_minor_kwd_three_decimal_places() {
    let kwd: Currency = "KWD".parse().unwrap();
    assert_eq!(format_minor(12345, kwd), "12.345");
}

#[test]
fn format_minor_usd_two_decimal_places() {
    assert_eq!(format_minor(12345, usd()), "123.45");
}

#[test]
fn format_minor_usd_zero() {
    assert_eq!(format_minor(0, usd()), "0.00");
}

#[test]
fn format_minor_usd_one_cent() {
    assert_eq!(format_minor(1, usd()), "0.01");
}

#[test]
fn format_minor_i64_min_does_not_panic() {
    // `i64::MIN.abs()` overflows (panics in debug, wraps negative in
    // release). The fractional part must render as "08", not "-8" or a
    // panic: -9_223_372_036_854_775_808 / 100 → -92_233_720_368_547_758.08.
    assert_eq!(format_minor(i64::MIN, usd()), "-92233720368547758.08");
}

#[test]
fn format_minor_idr_no_decimal() {
    let idr: Currency = "IDR".parse().unwrap();
    assert_eq!(format_minor(50000, idr), "50000");
}

#[test]
fn money_from_major_various_currencies() {
    let usd_val = Money::from_major(10, usd()).unwrap();
    assert_eq!(usd_val.minor_units, 1000);
    let jpy = Money::from_major(500, "JPY".parse().unwrap()).unwrap();
    assert_eq!(jpy.minor_units, 500);
}

#[test]
fn money_checked_add_same_currency() {
    let a = Money {
        minor_units: 100,
        currency: usd(),
    };
    let b = Money {
        minor_units: 250,
        currency: usd(),
    };
    let sum = a.checked_add(b).unwrap();
    assert_eq!(sum.minor_units, 350);
    assert_eq!(sum.currency, usd());
}

#[test]
fn money_checked_add_different_currency_returns_none() {
    let usd_val = Money {
        minor_units: 100,
        currency: usd(),
    };
    let eur_val = Money {
        minor_units: 100,
        currency: "EUR".parse().unwrap(),
    };
    assert!(usd_val.checked_add(eur_val).is_none());
}

#[test]
fn money_checked_sub_underflow_returns_none() {
    let a = Money {
        minor_units: i64::MIN,
        currency: usd(),
    };
    let b = Money {
        minor_units: 1,
        currency: usd(),
    };
    assert!(a.checked_sub(b).is_none());
}

#[test]
fn money_checked_mul_overflow_returns_none() {
    let m = Money {
        minor_units: i64::MAX,
        currency: usd(),
    };
    assert!(m.checked_mul(2).is_none());
}

#[test]
fn money_checked_div_by_zero_returns_none() {
    let m = Money {
        minor_units: 100,
        currency: usd(),
    };
    assert!(m.checked_div(0).is_none());
}

#[test]
fn money_negate_flips_sign() {
    let m = Money {
        minor_units: 500,
        currency: usd(),
    };
    assert_eq!(m.negate().minor_units, -500);
    assert_eq!(m.negate().negate().minor_units, 500);
}

#[test]
fn money_abs_makes_positive() {
    let m = Money {
        minor_units: -300,
        currency: usd(),
    };
    assert_eq!(m.abs().minor_units, 300);
    assert_eq!(m.abs().currency, usd());
}

#[test]
fn money_is_zero() {
    assert!(Money::zero(usd()).is_zero());
    assert!(
        !Money {
            minor_units: 1,
            currency: usd()
        }
        .is_zero()
    );
}

#[test]
fn money_equality_by_minor_units_and_currency() {
    let a = Money {
        minor_units: 100,
        currency: usd(),
    };
    let b = Money {
        minor_units: 100,
        currency: usd(),
    };
    let c = Money {
        minor_units: 200,
        currency: usd(),
    };
    assert_eq!(a, b);
    assert_ne!(a, c);
}

#[test]
fn money_eq_different_currency_not_equal() {
    // PartialEq: amounts in different currencies are never equal.
    // (Cross-currency ordering is incomparable — see
    // `partial_cmp_different_currency_is_none`.)
    let usd_val = Money {
        minor_units: 100,
        currency: usd(),
    };
    let eur_val = Money {
        minor_units: 100,
        currency: "EUR".parse().unwrap(),
    };
    assert_ne!(usd_val, eur_val);
}

#[test]
fn money_hash_consistent_with_eq() {
    use std::collections::HashMap;
    let mut map = HashMap::new();
    let key = Money {
        minor_units: 100,
        currency: usd(),
    };
    map.insert(key, "one hundred");
    let lookup = Money {
        minor_units: 100,
        currency: usd(),
    };
    assert_eq!(map.get(&lookup), Some(&"one hundred"));
}

// ── PartialOrd ─────────────────────────────────────────────

#[test]
fn partial_cmp_same_currency_orders() {
    let low = Money::from_major(5, usd()).unwrap();
    let high = Money::from_major(7, usd()).unwrap();
    assert_eq!(low.partial_cmp(&high), Some(std::cmp::Ordering::Less));
    assert_eq!(high.partial_cmp(&low), Some(std::cmp::Ordering::Greater));
}

#[test]
fn partial_cmp_same_amount_equal() {
    let a = Money::from_major(5, usd()).unwrap();
    let b = Money::from_major(5, usd()).unwrap();
    assert_eq!(a.partial_cmp(&b), Some(std::cmp::Ordering::Equal));
}

#[test]
fn partial_cmp_different_currency_is_none() {
    // Cross-currency comparison is a domain error, mirroring
    // `checked_add`: USD 1 < EUR 0 must NOT be orderable.
    let usd_val = Money::from_major(1, usd()).unwrap();
    let eur_val = Money::from_major(0, "EUR".parse().unwrap()).unwrap();
    assert_eq!(usd_val.partial_cmp(&eur_val), None);
    assert_eq!(eur_val.partial_cmp(&usd_val), None);
}

#[test]
fn money_lt_gt_operators_same_currency() {
    let low = Money::from_major(5, usd()).unwrap();
    let high = Money::from_major(7, usd()).unwrap();
    assert!(low < high);
    assert!(high > low);
    assert!(low <= high);
    assert!(low <= low);
    assert!(high >= low);
    assert!(high >= high);
}

#[test]
fn money_lt_different_currency_is_false() {
    // PartialOrd contract: when partial_cmp is None, < / > / <= / >=
    // all return false — a cross-currency "less than" must not hold.
    let usd_val = Money::from_major(1, usd()).unwrap();
    let eur_val = Money::from_major(100, "EUR".parse().unwrap()).unwrap();
    let lt = usd_val < eur_val;
    let gt = usd_val > eur_val;
    let le = usd_val <= eur_val;
    let ge = usd_val >= eur_val;
    assert!(!lt);
    assert!(!gt);
    assert!(!le);
    assert!(!ge);
}

#[test]
fn partial_cmp_negative_orders() {
    let neg = Money {
        minor_units: -500,
        currency: usd(),
    };
    let zero = Money::zero(usd());
    let pos = Money::from_major(5, usd()).unwrap();
    assert!(neg < zero);
    assert!(zero < pos);
    assert!(neg < pos);
}

#[test]
fn money_min_operator_picks_lower_same_currency() {
    // `Money` is only PartialOrd (cross-currency is incomparable),
    // so the ordering APIs that assume a total order (Ord::min etc.)
    // must NOT exist — this pins the design.
    fn assert_manual_min(a: Money, b: Money) -> Money {
        if a < b { a } else { b }
    }
    let low = Money::from_major(5, usd()).unwrap();
    let high = Money::from_major(7, usd()).unwrap();
    assert_eq!(assert_manual_min(low, high), low);
}

// ── min ────────────────────────────────────────────────────

#[test]
fn min_picks_lower_same_currency() {
    let low = Money::from_major(5, usd()).unwrap();
    let high = Money::from_major(7, usd()).unwrap();
    assert_eq!(low.min(high).unwrap(), low);
    assert_eq!(high.min(low).unwrap(), low);
}

#[test]
fn min_equal_amounts_returns_amount() {
    let a = Money::from_major(5, usd()).unwrap();
    let b = Money::from_major(5, usd()).unwrap();
    assert_eq!(a.min(b).unwrap(), a);
}

#[test]
fn min_currency_mismatch_returns_none() {
    // Same domain-error rule as checked_add: capping a USD amount at
    // an EUR bound must fail, not silently compare minor units.
    let usd_val = Money::from_major(1, usd()).unwrap();
    let eur_val = Money::from_major(100, "EUR".parse().unwrap()).unwrap();
    assert_eq!(usd_val.min(eur_val), None);
    assert_eq!(eur_val.min(usd_val), None);
}

#[test]
fn min_negative_amount_orders() {
    let neg = Money {
        minor_units: -500,
        currency: usd(),
    };
    let pos = Money::from_major(5, usd()).unwrap();
    assert_eq!(neg.min(pos).unwrap(), neg);
    assert_eq!(pos.min(neg).unwrap(), neg);
}

#[test]
fn min_zero_vs_positive_is_zero() {
    let zero = Money::zero(usd());
    let pos = Money::from_major(5, usd()).unwrap();
    assert_eq!(zero.min(pos).unwrap(), zero);
}

#[test]
fn min_preserves_currency() {
    let low = Money::from_major(2, usd()).unwrap();
    let high = Money::from_major(3, usd()).unwrap();
    assert_eq!(low.min(high).unwrap().currency, usd());
}

#[test]
fn currency_idr_has_zero_exponent() {
    let idr: Currency = "IDR".parse().unwrap();
    assert_eq!(idr.minor_unit_exponent(), 0);
}

#[test]
fn currency_jpy_has_zero_exponent() {
    let jpy: Currency = "JPY".parse().unwrap();
    assert_eq!(jpy.minor_unit_exponent(), 0);
}

#[test]
fn currency_kwd_has_three_exponent() {
    let kwd: Currency = "KWD".parse().unwrap();
    assert_eq!(kwd.minor_unit_exponent(), 3);
}

#[test]
fn currency_usd_has_two_exponent() {
    assert_eq!(usd().minor_unit_exponent(), 2);
}

// ── Default ────────────────────────────────────────────────

#[test]
fn default_is_zero_usd() {
    let d = Money::default();
    assert_eq!(d.minor_units, 0);
    assert_eq!(d.currency, usd());
}

// ── Display / Error impls ──────────────────────────────────

#[test]
fn currency_display_renders_code() {
    assert_eq!(format!("{}", usd()), "USD");
    assert_eq!(format!("{}", "jpy".parse::<Currency>().unwrap()), "JPY");
}

#[test]
fn invalid_currency_code_error_display() {
    let err: InvalidCurrencyCode = "US".parse::<Currency>().unwrap_err();
    assert_eq!(
        err.to_string(),
        "expected a 3-letter ISO-4217 currency code"
    );
}

// ── serde ──────────────────────────────────────────────────

#[test]
fn currency_serde_roundtrip() {
    let json = serde_json::to_string(&usd()).unwrap();
    assert_eq!(json, "\"USD\"");
    let back: Currency = serde_json::from_str(&json).unwrap();
    assert_eq!(back, usd());
}

#[test]
fn currency_serde_lowercase_input_parses() {
    let c: Currency = serde_json::from_str("\"jpy\"").unwrap();
    assert_eq!(c, "JPY".parse().unwrap());
}

#[test]
fn currency_serde_invalid_code_errors() {
    assert!(serde_json::from_str::<Currency>("\"US\"").is_err());
    assert!(serde_json::from_str::<Currency>("\"U2D\"").is_err());
    assert!(serde_json::from_str::<Currency>("\"USDX\"").is_err());
}

#[test]
fn money_serde_roundtrip() {
    let m = Money {
        minor_units: 1550,
        currency: usd(),
    };
    let json = serde_json::to_string(&m).unwrap();
    assert_eq!(json, r#"{"minor_units":1550,"currency":"USD"}"#);
    let back: Money = serde_json::from_str(&json).unwrap();
    assert_eq!(back, m);
}

#[test]
fn money_serde_invalid_currency_errors() {
    let bad = r#"{"minor_units":100,"currency":"US"}"#;
    assert!(serde_json::from_str::<Money>(bad).is_err());
}

// ── from_major edge cases ──────────────────────────────────

#[test]
fn from_major_zero_returns_zero() {
    let m = Money::from_major(0, usd()).unwrap();
    assert_eq!(m.minor_units, 0);
    assert_eq!(m.currency, usd());
}

#[test]
fn from_major_negative_major() {
    let m = Money::from_major(-12, usd()).unwrap();
    assert_eq!(m.minor_units, -1200);
    assert_eq!(m.currency, usd());
}

// ── arithmetic with negative operands ──────────────────────

#[test]
fn checked_add_negative_amount_nets() {
    // Refund-style: adding a negative amount reduces the total.
    let total = Money::from_major(5, usd()).unwrap();
    let refund = Money {
        minor_units: -300,
        currency: usd(),
    };
    assert_eq!(total.checked_add(refund).unwrap().minor_units, 200);
}

#[test]
fn checked_add_zero_is_identity() {
    let m = Money::from_major(5, usd()).unwrap();
    assert_eq!(m.checked_add(Money::zero(usd())).unwrap(), m);
}

#[test]
fn checked_sub_negative_result_allowed() {
    // Money allows negative balances (refunds/voids); only i64
    // underflow is an error.
    let a = Money::from_major(5, usd()).unwrap();
    let b = Money::from_major(7, usd()).unwrap();
    assert_eq!(a.checked_sub(b).unwrap().minor_units, -200);
}

#[test]
fn checked_mul_negative_scalar() {
    let m = Money::from_major(5, usd()).unwrap();
    assert_eq!(m.checked_mul(-3).unwrap().minor_units, -1500);
    assert_eq!(m.checked_mul(-3).unwrap().currency, usd());
}

#[test]
fn checked_mul_i64_min_by_neg_one_overflows() {
    // i64::MIN * -1 = i64::MAX + 1 → overflow; must return None.
    let m = Money {
        minor_units: i64::MIN,
        currency: usd(),
    };
    assert!(m.checked_mul(-1).is_none());
}

#[test]
fn checked_div_i64_min_by_neg_one_overflows() {
    // i64::MIN / -1 = i64::MAX + 1 → overflow; must return None.
    let m = Money {
        minor_units: i64::MIN,
        currency: usd(),
    };
    assert!(m.checked_div(-1).is_none());
}

#[test]
fn checked_div_negative_truncates_toward_zero() {
    // Rust integer division truncates toward zero: -1000 / 3 = -333.
    let m = Money {
        minor_units: -1000,
        currency: usd(),
    };
    assert_eq!(m.checked_div(3).unwrap().minor_units, -333);
    assert_eq!(m.checked_div(-3).unwrap().minor_units, 333);
}

// ── format_minor extremes ──────────────────────────────────

#[test]
fn format_minor_i64_min_kwd_does_not_panic() {
    let kwd: Currency = "KWD".parse().unwrap();
    // exp 3: -9_223_372_036_854_775_808 / 1000 → -9_223_372_036_854_775.808.
    assert_eq!(format_minor(i64::MIN, kwd), "-9223372036854775.808");
}

// ── currency parse normalisation ───────────────────────────

#[test]
fn currency_lowercase_equals_uppercase() {
    let lower: Currency = "jpy".parse().unwrap();
    let upper: Currency = "JPY".parse().unwrap();
    assert_eq!(lower, upper);
}

// ── i64 extremes ───────────────────────────────────────────

#[test]
fn partial_cmp_i64_extremes_same_currency() {
    let min = Money {
        minor_units: i64::MIN,
        currency: usd(),
    };
    let max = Money {
        minor_units: i64::MAX,
        currency: usd(),
    };
    assert!(min < max);
    assert_eq!(min.partial_cmp(&max), Some(std::cmp::Ordering::Less));
}

#[test]
fn min_picks_lower_at_i64_extremes() {
    let min = Money {
        minor_units: i64::MIN,
        currency: usd(),
    };
    let max = Money {
        minor_units: i64::MAX,
        currency: usd(),
    };
    assert_eq!(min.min(max).unwrap(), min);
    assert_eq!(max.min(min).unwrap(), min);
}
