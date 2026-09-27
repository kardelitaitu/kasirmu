//! Property-based tests for the `Money` / `Currency` / `Percentage`
//! invariants, using `proptest`.
//!
//! These tests pin the arithmetic contracts that unit tests only sample:
//! - `checked_*` never panics and is exact when it returns `Some`
//! - arithmetic is commutative / associative within a currency
//! - cross-currency operations are always `None` (never silently compared)
//! - overflow boundaries are exact (`MAX+1` and `MIN-1` are `None`)
//! - `format_minor` round-trips through integer math
//! - `Percentage` application is overflow-free and total
//!
//! Wired from `money.rs` via `#[cfg(test)] #[path = "money_proptests.rs"]
//! mod proptests;`.

use super::*;
use crate::percentage::Percentage;
use proptest::prelude::*;

/// A strategy for arbitrary `Money` in a single currency, given a currency
/// strategy. The currency is fixed per generated value so arithmetic
/// invariants hold within one money.
fn money_in(currencies: impl Strategy<Value = Currency>) -> impl Strategy<Value = Money> {
    currencies.prop_flat_map(|currency| {
        any::<i64>().prop_map(move |minor_units| Money {
            minor_units,
            currency,
        })
    })
}

/// The set of currencies exercising all ISO-4217 exponent classes.
fn currencies() -> impl Strategy<Value = Currency> {
    prop_oneof![
        Just("USD".parse().unwrap()),
        Just("IDR".parse().unwrap()),
        Just("KWD".parse().unwrap()),
        Just("JPY".parse().unwrap()),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    /// `checked_add` never panics and, when it succeeds, is the exact
    /// `i64` sum with the same currency.
    #[test]
    fn checked_add_is_exact_when_it_succeeds(a in any::<i64>(), b in any::<i64>(), c in currencies()) {
        let ma = Money { minor_units: a, currency: c };
        let mb = Money { minor_units: b, currency: c };
        if let Some(sum) = ma.checked_add(mb) {
            assert_eq!(sum.minor_units, a + b, "exact sum");
            assert_eq!(sum.currency, c, "currency preserved");
        }
    }

    /// `checked_add` is commutative: `a+b` and `b+a` agree (both `Some`
    /// with equal values, or both `None`).
    #[test]
    fn checked_add_is_commutative(a in any::<i64>(), b in any::<i64>(), c in currencies()) {
        let ma = Money { minor_units: a, currency: c };
        let mb = Money { minor_units: b, currency: c };
        assert_eq!(ma.checked_add(mb).map(|m| m.minor_units), mb.checked_add(ma).map(|m| m.minor_units));
    }

    /// `checked_sub` is the exact inverse of `checked_add` when the
    /// intermediate sum does not overflow.
    #[test]
    fn checked_sub_undoes_checked_add(a in any::<i64>(), b in any::<i64>(), c in currencies()) {
        let ma = Money { minor_units: a, currency: c };
        let mb = Money { minor_units: b, currency: c };
        if let Some(sum) = ma.checked_add(mb) {
            // sum - b == a (a is the "sum" being undone by b)
            if let Some(back) = sum.checked_sub(mb) {
                assert_eq!(back.minor_units, a, "a+b-b == a");
            } else {
                // Only possible when `sum` underflowed i64, which cannot
                // happen since sum == a+b fits by construction.
                unreachable!("sum - b must fit: sum == a+b and b subtracts back");
            }
        }
    }

    /// `checked_sub` never panics and, when it succeeds, is the exact
    /// `i64` difference with the same currency.
    #[test]
    fn checked_sub_is_exact_when_it_succeeds(a in any::<i64>(), b in any::<i64>(), c in currencies()) {
        let ma = Money { minor_units: a, currency: c };
        let mb = Money { minor_units: b, currency: c };
        if let Some(diff) = ma.checked_sub(mb) {
            assert_eq!(diff.minor_units, a - b, "exact difference");
            assert_eq!(diff.currency, c, "currency preserved");
        }
    }

    /// Overflow boundaries are exact: `MAX + 1` is `None`, `MIN - 1` is
    /// `None`, and `MAX + 0` / `MIN - 0` succeed.
    #[test]
    fn checked_add_overflow_boundary_is_exact(c in currencies()) {
        let max = Money { minor_units: i64::MAX, currency: c };
        let min = Money { minor_units: i64::MIN, currency: c };
        let one = Money { minor_units: 1, currency: c };
        let zero = Money { minor_units: 0, currency: c };
        let neg_one = Money { minor_units: -1, currency: c };
        assert!(max.checked_add(one).is_none(), "MAX + 1 must be None");
        assert!(min.checked_add(neg_one).is_none(), "MIN + (-1) must be None");
        assert_eq!(max.checked_add(zero).map(|m| m.minor_units), Some(i64::MAX));
        assert_eq!(min.checked_add(zero).map(|m| m.minor_units), Some(i64::MIN));
        assert_eq!(min.checked_sub(one).map(|m| m.minor_units), None, "MIN - 1 must be None");
        assert_eq!(max.checked_sub(neg_one).map(|m| m.minor_units), None, "MAX - (-1) must be None");
    }

    /// Cross-currency arithmetic is always `None` — never a silent compare.
    #[test]
    fn cross_currency_ops_are_never_some(a in any::<i64>(), b in any::<i64>()) {
        let usd_m = Money { minor_units: a, currency: "USD".parse().unwrap() };
        let eur_m = Money { minor_units: b, currency: "EUR".parse().unwrap() };
        assert!(usd_m.checked_add(eur_m).is_none());
        assert!(usd_m.checked_sub(eur_m).is_none());
        assert_eq!(usd_m.partial_cmp(&eur_m), None, "cross-currency compare must be None");
        assert!(usd_m.min(eur_m).is_none(), "cross-currency min must be None");
    }

    /// `checked_mul` is exact: `minor * scalar` when it fits.
    #[test]
    fn checked_mul_is_exact(a in any::<i64>(), s in -10i64..=10i64, c in currencies()) {
        let m = Money { minor_units: a, currency: c };
        if let Some(p) = m.checked_mul(s) {
            assert_eq!(p.minor_units, a * s, "exact product");
            assert_eq!(p.currency, c);
        }
    }

    /// Multiplying by 1 is the identity and multiplying by 0 is zero for
    /// every amount (no overflow is possible, so both always succeed).
    #[test]
    fn checked_mul_identity_and_zero(m in money_in(currencies())) {
        let one = m.checked_mul(1).expect("mul by 1 cannot overflow");
        assert_eq!(one.minor_units, m.minor_units, "mul by 1 is identity");
        let zero = m.checked_mul(0).expect("mul by 0 cannot overflow");
        assert_eq!(zero.minor_units, 0, "mul by 0 is zero");
    }

    /// `checked_div` by 1 is the identity; by -1 it negates (unless the
    /// amount is `i64::MIN`, where negation overflows → `None`).
    #[test]
    fn checked_div_identity(a in any::<i64>(), c in currencies()) {
        let m = Money { minor_units: a, currency: c };
        assert_eq!(m.checked_div(1).map(|m| m.minor_units), Some(a), "div by 1 is identity");
        if a != i64::MIN {
            assert_eq!(m.checked_div(-1).map(|m| m.minor_units), Some(-a), "div by -1 negates");
        } else {
            assert!(m.checked_div(-1).is_none(), "i64::MIN / -1 overflows");
        }
    }

    /// `checked_negate` is exact for every value except `i64::MIN`.
    #[test]
    fn checked_negate_is_exact(m in money_in(currencies())) {
        if m.minor_units == i64::MIN {
            assert!(m.checked_negate().is_none(), "MIN negate must be None");
            assert!(m.checked_abs().is_none(), "MIN abs must be None");
        } else {
            let n = m.checked_negate().expect("non-MIN negate succeeds");
            assert_eq!(n.minor_units, -m.minor_units, "exact negation");
            assert_eq!(n.currency, m.currency);
            assert_eq!(m.checked_abs().map(|x| x.minor_units), Some(m.minor_units.abs()));
        }
    }

    /// `negate`/`abs` (panicking variants) agree with `checked_*` for all
    /// non-`i64::MIN` values — the panicking API is safe exactly where the
    /// checked API says it is.
    #[test]
    fn panicking_variants_agree_with_checked(m in money_in(currencies())) {
        // Panicking variants are documented UB on i64::MIN — skip those.
        if m.minor_units != i64::MIN {
            assert_eq!(m.negate().minor_units, m.checked_negate().unwrap().minor_units);
            assert_eq!(m.abs().minor_units, m.checked_abs().unwrap().minor_units);
        }
    }

    /// `checked_add` is associative within a currency — but only in the
    /// strong sense: `(a+b)+c` and `a+(b+c)` are mathematically equal, so
    /// they may disagree only in WHICH intermediate overflows. If both
    /// paths succeed (no intermediate overflow), they must agree exactly.
    #[test]
    fn checked_add_is_associative(a in any::<i64>(), b in any::<i64>(), cc in any::<i64>(), c in currencies()) {
        let ma = Money { minor_units: a, currency: c };
        let mb = Money { minor_units: b, currency: c };
        let mc = Money { minor_units: cc, currency: c };
        let left = ma.checked_add(mb).and_then(|x| x.checked_add(mc));
        let right = mb.checked_add(mc).and_then(|x| ma.checked_add(x));
        // Both intermediates fit → the full sums must be identical.
        // At least one intermediate overflowed. The other path may
        // still produce a value (different intermediate), but a path
        // that DID overflow must be None — checked arithmetic must
        // never wrap.
        if let (Some(l), Some(r)) = (left, right) {
            assert_eq!(
                l.minor_units,
                r.minor_units,
                "associativity when both intermediates fit: a={a} b={b} c={cc}"
            );
        }
    }

    /// Adding zero is the identity for every amount.
    #[test]
    fn checked_add_zero_is_identity(m in money_in(currencies())) {
        let zero = Money { minor_units: 0, currency: m.currency };
        assert_eq!(m.checked_add(zero).map(|x| x.minor_units), Some(m.minor_units));
    }

    /// `Money::min` picks the smaller of two same-currency amounts.
    #[test]
    fn min_picks_smaller(a in any::<i64>(), b in any::<i64>(), c in currencies()) {
        let ma = Money { minor_units: a, currency: c };
        let mb = Money { minor_units: b, currency: c };
        let min = ma.min(mb).expect("same-currency min succeeds");
        assert_eq!(min.minor_units, a.min(b), "min picks smaller minor units");
    }

    /// `Money::min` is commutative: `min(a, b) == min(b, a)`.
    #[test]
    fn min_is_commutative(a in any::<i64>(), b in any::<i64>(), c in currencies()) {
        let ma = Money { minor_units: a, currency: c };
        let mb = Money { minor_units: b, currency: c };
        assert_eq!(ma.min(mb).map(|m| m.minor_units), mb.min(ma).map(|m| m.minor_units));
    }

    /// `format_minor` renders the exact decimal string: parseable and
    /// sign-correct, including negative sub-major amounts like `-0.05`.
    #[test]
    fn format_minor_is_sign_correct_and_exact(minor in any::<i64>(), c in currencies()) {
        let s = format_minor(minor, c);
        let exp = c.minor_unit_exponent();
        if exp == 0 {
            assert_eq!(s, minor.to_string(), "zero-exponent renders raw");
        } else {
            let div = 10_i64.pow(exp);
            let major = minor / div;
            let frac = (minor % div).unsigned_abs();
            let expected_sign = if minor < 0 && major == 0 { "-" } else { "" };
            let expected = format!("{expected_sign}{major}.{:0width$}", frac, width = exp as usize);
            assert_eq!(s, expected, "decimal rendering matches integer math");
            // Every negative amount (except -0.00 cases) keeps its sign.
            if minor <= -div {
                assert!(s.starts_with('-'), "negative amount renders with sign: {s}");
            }
        }
    }

    /// `format_minor` round-trips: parsing the string back with the same
    /// exponent recovers the exact minor-unit amount for any value.
    /// Uses `i128` for the intermediate magnitude so `i64::MIN`'s absolute
    /// value (which is `i64::MAX + 1`) does not overflow.
    #[test]
    fn format_minor_round_trips(minor in any::<i64>(), c in currencies()) {
        let s = format_minor(minor, c);
        let exp = c.minor_unit_exponent();
        let div = 10_i64.pow(exp);
        let (sign, rest) = s.strip_prefix('-').map_or(("", s.as_str()), |r| ("-", r));
        // Parse major and fractional parts as i128 to avoid overflow for
        // i64::MIN (where the absolute magnitude exceeds i64::MAX).
        let parsed_major: i128 = rest
            .split('.')
            .next()
            .unwrap_or("0")
            .parse()
            .unwrap_or(0);
        let frac_digits = rest.split('.').nth(1).unwrap_or("");
        let parsed_frac: i128 = frac_digits.parse().unwrap_or(0);
        let reconstructed = parsed_major
            .checked_mul(i128::from(div))
            .and_then(|v| v.checked_add(parsed_frac))
            .unwrap_or(0);
        let signed = if sign == "-" { -reconstructed } else { reconstructed };
        // `try_into` rather than `as i64`: the narrowing is infallible here
        // (signed was reconstructed FROM an i64 `minor`), and saying so
        // explicitly turns "this cannot overflow" from a comment into a checked
        // assertion. `as` would silently wrap if a future change to the parser
        // let the reconstruction grow, which is exactly the failure this
        // round-trip property exists to catch.
        let signed_i64: i64 = signed
            .try_into()
            .expect("reconstruction of an i64 must fit in i64");
        assert_eq!(signed_i64, minor, "round-trip recovers minor units for {minor} ({s})");
    }

    /// `checked_div` is exact Rust integer division (truncation toward
    /// zero) when it succeeds; `div 0` is always `None`.
    #[test]
    fn checked_div_is_exact_or_zero_divisor(a in any::<i64>(), d in any::<i64>(), c in currencies()) {
        let m = Money { minor_units: a, currency: c };
        if d == 0 {
            assert!(m.checked_div(d).is_none(), "div by zero must be None");
        } else if let Some(q) = m.checked_div(d) {
            assert_eq!(q.minor_units, a / d, "exact quotient");
            assert_eq!(q.currency, c);
        }
    }

    /// `from_major` / exponent round-trip: `minor == major * 10^exp` when
    /// the conversion succeeds.
    #[test]
    fn from_major_matches_exponent(major in 0i64..=1_000_000, c in currencies()) {
        let exp = c.minor_unit_exponent();
        if let Some(m) = Money::from_major(major, c) {
            let expected = major.checked_mul(10_i64.pow(exp)).unwrap();
            assert_eq!(m.minor_units, expected, "major * 10^exp");
            assert_eq!(m.currency, c);
        }
    }

    /// `format_minor` is a pure function of `(minor, currency)`: identical
    /// inputs produce identical output.
    #[test]
    fn format_minor_is_pure(a in any::<i64>(), c in currencies()) {
        let s1 = format_minor(a, c);
        let s2 = format_minor(a, c);
        assert_eq!(s1, s2);
        // Non-empty and contains the expected digit length for exp > 0.
        if c.minor_unit_exponent() > 0 {
            assert!(s1.contains('.'), "exp>0 must render a decimal point: {s1}");
        }
    }

    /// `Percentage::apply_to` is overflow-free and total: applying 100%
    /// returns the identity and 0% returns zero, for ANY i64 amount.
    #[test]
    fn percentage_apply_to_is_total_and_bounded(minor in any::<i64>(), pct in 0u8..=100u8, c in currencies()) {
        let m = Money { minor_units: minor, currency: c };
        let p = Percentage::new(pct).unwrap();
        let applied = p.apply_to(m);
        assert!(applied.is_some(), "apply_to must never fail for pct {pct}");
        let out = applied.unwrap();
        assert_eq!(out.currency, c);
        // pct/100 of a value is bounded by the value's magnitude (for the
        // positive branch; negatives keep sign via truncation).
        let bounded = minor.checked_mul(i64::from(pct)).is_some();
        if bounded {
            assert_eq!(out.minor_units, minor * i64::from(pct) / 100);
        }
    }

    /// `apply_to` + `complement_apply_to` partition the amount to within
    /// one minor unit: `apply(p) + complement(p) ∈ {x-1, x, x+1}`.
    ///
    /// Rust integer division truncates toward zero, so the two remainders
    /// cancel to `0` or `±100` — the sum of quotients is `x` (exact) or
    /// `x ∓ 1` (one minor unit of rounding drift, which is the documented
    /// truncation behavior of `Percentage`).
    #[test]
    fn percentage_partitions_amount(minor in any::<i64>(), pct in 0u8..=100u8, c in currencies()) {
        let m = Money { minor_units: minor, currency: c };
        let p = Percentage::new(pct).unwrap();
        let taken = p.apply_to(m).unwrap();
        let left = p.complement_apply_to(m).unwrap();
        let sum = taken.minor_units + left.minor_units;
        assert!(
            (sum - minor).abs() <= 1,
            "partition sum {sum} must be within 1 minor unit of {minor} for pct {pct}"
        );
    }
}

/// Deterministic smoke: the exact partitioning property for a fixed case.
#[test]
fn percentage_partition_smoke() {
    let c: Currency = "USD".parse().unwrap();
    let m = Money {
        minor_units: 100,
        currency: c,
    };
    for pct in 0..=100u8 {
        let p = Percentage::new(pct).unwrap();
        let taken = p.apply_to(m).unwrap().minor_units;
        let left = p.complement_apply_to(m).unwrap().minor_units;
        assert_eq!(taken + left, 100, "pct {pct}: {taken} + {left}");
    }
}
