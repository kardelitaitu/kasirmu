use super::*;

/// The wire `discount_percent` is an `i64`; the cart takes a `Percentage(u8)`
/// capped at 100, so the narrowing needs a decision. This shell used to spell
/// that narrowing itself as `discount_percent.min(100) as u8` -- equivalent to the
/// bridge's `checkout_discount_percent` for every input, because the `> 0` guard
/// and `Percentage::new`'s own rejection make the two agree.
///
/// It now routes through the ONE helper. That is not cosmetic: the bridge's
/// `preview_and_shortfall_doors_treat_a_high_discount_percent_identically`
/// exists because the original truncating cast was evaded by FORMATTING ALONE --
/// written across lines, no single line held both `Percentage::new(` and the
/// cast, so every source predicate missed and the test passed against the
/// broken door. A second untested spelling of the rule is how it returns.
///
/// WHAT THIS TEST DOES AND DOES NOT PIN, measured rather than assumed. Restoring
/// the old `discount_percent.min(100) as u8` makes every assertion below still
/// pass -- the two forms are arithmetically identical for every input, because
/// the `> 0` guard and `Percentage::new`'s own rejection cover the negative and
/// over-max ends. So this is a BEHAVIOUR test: it pins what the door resolves for
/// the wire values that matter, and it would catch a regression that reverted to
/// the bare `discount_percent as u8`. It cannot, and does not claim to, detect a
/// re-spelling that keeps the same arithmetic -- only a source scan can do that,
/// which is the bridge test's job and is why the fix here is to route through the
/// helper rather than to keep a parallel copy.
///
/// `256` is the case that matters: truncated it is `0`, so the discount is
/// silently DROPPED rather than refused. Clamped it is `100`.
#[test]
fn build_preview_cart_treats_an_over_100_percent_the_way_the_bridge_does() {
    let line = |unit: i64| PreviewLineArgs {
        sku: "SKU-1".into(),
        qty: 1,
        unit_price_minor: unit,
        unit_price_currency: "USD".into(),
    };

    // The out-of-range values the bridge pins, resolved through the same helper.
    for wire in [256i64, 300, 357, i64::from(u8::MAX) + 1] {
        let cart = build_preview_cart(std::slice::from_ref(&line(10_000)), wire).unwrap();
        assert_eq!(
            cart.discount_percent(),
            100,
            "{wire} must resolve to the maximum, not truncate ({})",
            wire as u8
        );
    }

    // An in-range value is untouched, and zero still means no discount.
    let exact = build_preview_cart(std::slice::from_ref(&line(10_000)), 2).unwrap();
    assert_eq!(exact.discount_percent(), 2);

    let none = build_preview_cart(std::slice::from_ref(&line(10_000)), 0).unwrap();
    assert_eq!(none.discount_percent(), 0);

    // A negative wire value is not a discount, before or after the change.
    let negative = build_preview_cart(std::slice::from_ref(&line(10_000)), -5).unwrap();
    assert_eq!(negative.discount_percent(), 0);
}
