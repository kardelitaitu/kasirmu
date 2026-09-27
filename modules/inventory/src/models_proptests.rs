//! Property-based tests for `modules-inventory` model invariants.
//!
//! `models_tests.rs` samples cases — the negative-qty panic, the
//! `ProductType` round-trip, a non-empty name. These properties range over
//! the space those samples sit in, on the types where a stored value comes
//! from outside the process and cannot be trusted: an IPC string in
//! `products.product_type`, a supplier name in a CSV import, a SKU typed
//! on a tablet.
//!
//! # A correction to the task that requested these
//!
//! `todo-codebase-relability.md` P1-1 asks for a property that *"stock never
//! goes negative under any interleaving of adjustments and sales"*. **That
//! contract does not exist in this crate, and asserting it would fail
//! against correct code.** `WorkspaceInventoryLocation.allow_negative_stock`
//! (`models.rs:368`) is a documented per-location policy flag, and
//! `Repository::adjust_stock_tx` (`repository.rs:130`) applies a raw
//! `UPDATE inventory SET qty = qty + ?1` with no floor — deliberately, so a
//! location that opts into negative stock can oversell. The only
//! non-negativity guard is `Inventory::new`'s constructor assertion, which
//! cannot see a running balance.
//!
//! What IS asserted here instead is the set of contracts that genuinely
//! hold, each verified against the implementation before being written
//! down. Where a property would have been false it is recorded as false
//! rather than quietly dropped, because the difference between "unchecked"
//! and "checkably false" is the whole point of writing one down.
//!
//! Wired from `models.rs` via
//! `#[cfg(test)] #[path = "models_proptests.rs"] mod proptests;`.

use super::*;
use foundation::money::{Currency, Money};
use proptest::prelude::*;

fn usd() -> Currency {
    "USD".parse().expect("USD is a valid currency code")
}

fn price() -> Money {
    Money {
        minor_units: 1000,
        currency: usd(),
    }
}

/// A SKU built from characters a real scanner or keyboard can produce.
///
/// Deliberately includes spaces and punctuation: the point is to find
/// whether construction accepts something a later lookup cannot find.
///
/// The leading `[A-Za-z0-9]` is required rather than cosmetic — `Sku::new`
/// rejects an empty SKU, and a strategy free to generate all-whitespace
/// would fail for a reason that has nothing to do with the round trip
/// under test. `Sku::new`'s own rejection is covered separately below.
fn sku_strategy() -> impl Strategy<Value = String> {
    "[A-Za-z0-9][A-Za-z0-9 ._\\-]{0,31}"
}

// ── Product::new ─────────────────────────────────────────────────────

proptest! {
    /// The stored name is `trim()`ed, and never empty.
    ///
    /// A name that is entirely whitespace must be rejected, and a name
    /// with padding must be stored without it — otherwise two products
    /// that render identically in the UI carry different stored names and
    /// a search for one misses the other.
    #[test]
    fn product_name_is_trimmed_and_never_blank(name in "[ \\t]{0,8}\\S[^\\n]{0,40}[ \\t]{0,8}") {
        let p = Product::new(Sku::new("SKU-P"), name.clone(), price());
        prop_assert_eq!(p.name.as_str(), name.trim());
        prop_assert!(!p.name.is_empty());
    }

    /// A whitespace-only name panics rather than being stored.
    ///
    /// `Product::new` asserts this. Asserting it as a property rather than
    /// a single example covers the whole class — tabs, newlines, mixed
    /// padding — which is what a paste from a spreadsheet actually
    /// produces.
    #[test]
    fn whitespace_only_name_is_rejected(blank in "[ \\t\\n\\r]{1,20}") {
        let result = std::panic::catch_unwind(|| {
            Product::new(Sku::new("SKU-P"), blank.clone(), price())
        });
        prop_assert!(result.is_err(), "blank name {:?} was accepted", blank);
    }

    /// Every constructed product starts at version 1 and active.
    ///
    /// `version` is the field Version-LWW conflict resolution compares, so
    /// a product born at an arbitrary version would sort against its peers
    /// incorrectly from the first sync.
    #[test]
    fn new_products_start_at_version_one_and_active(_seed in any::<u8>()) {
        let p = Product::new(Sku::new("SKU-P"), "Name", price());
        prop_assert_eq!(p.version, 1);
        prop_assert!(p.is_active);
        prop_assert!(!p.id.is_empty());
    }

    /// A SKU is stored **trimmed**, and construction is idempotent over that.
    ///
    /// `Sku::new` trims by documented contract (`foundation/src/sku.rs:34`,
    /// "trimming and panicking if empty"), so this asserts the real
    /// behaviour rather than wishing it away. The first draft of this test
    /// asserted a byte-exact round trip and failed on `"0 "` — which is the
    /// correct outcome for the implementation and the wrong property.
    ///
    /// What makes the trim worth pinning is the consumer: stock lookups
    /// (`get_stock`, `adjust_stock_tx`) match on `sku.as_str()`, so a
    /// trailing space from a scanner or a paste must not create a second
    /// product row that the trimmed lookup can never find.
    #[test]
    fn sku_is_stored_trimmed_and_construction_is_idempotent(sku in sku_strategy()) {
        let once = Sku::new(sku.as_str());
        prop_assert_eq!(once.as_str(), sku.trim());

        // Re-constructing from the stored form must not change it again:
        // otherwise a read-modify-write would drift the key on every save.
        let twice = Sku::new(once.as_str());
        prop_assert_eq!(twice.as_str(), once.as_str());

        // Product construction preserves the normalised key verbatim.
        let p = Product::new(Sku::new(sku.as_str()), "Name", price());
        prop_assert_eq!(p.sku.as_str(), sku.trim());
    }

    /// A SKU that is empty or whitespace-only is rejected.
    ///
    /// Companion to the trim property: the trim is only safe because the
    /// empty result is refused rather than stored as `""`, which would let
    /// every blank-scanned item collide on one product row.
    #[test]
    fn whitespace_only_sku_is_rejected(blank in "[ \\t\\n\\r]{1,20}") {
        prop_assert!(
            Sku::try_new(blank.as_str()).is_none(),
            "blank SKU {:?} produced Some", blank
        );
    }
}

// ── Inventory::new ───────────────────────────────────────────────────

proptest! {
    /// A non-negative quantity is accepted and stored exactly.
    #[test]
    fn inventory_accepts_and_preserves_non_negative_qty(qty in 0i64..i64::MAX) {
        let inv = Inventory::new(Sku::new("SKU-I"), qty);
        prop_assert_eq!(inv.qty, qty);
    }

    /// A negative quantity panics at construction.
    ///
    /// This is the ONLY non-negativity guard in the crate, and it applies
    /// to a freshly-constructed row — not to a running balance. Stating it
    /// precisely matters: a reader who mistakes this for a balance
    /// invariant will believe oversell is impossible, and
    /// `allow_negative_stock` says otherwise.
    #[test]
    fn inventory_rejects_negative_qty_at_construction(qty in i64::MIN..0i64) {
        let result = std::panic::catch_unwind(|| Inventory::new(Sku::new("SKU-I"), qty));
        prop_assert!(result.is_err(), "negative qty {} was accepted", qty);
    }
}

// ── Inventory::is_low_stock ──────────────────────────────────────────

proptest! {
    /// `is_low_stock` is `qty <= threshold`, including at the boundary.
    ///
    /// The boundary is the whole signal — a reorder alert fires when the
    /// balance reaches the threshold, not only when it passes below it —
    /// and an off-by-one here is invisible in ordinary use.
    #[test]
    fn is_low_stock_is_inclusive_at_the_threshold(qty in 0i64..200, threshold in 0i64..200) {
        let mut inv = Inventory::new(Sku::new("SKU-I"), qty);
        inv.low_stock_threshold = threshold;
        prop_assert_eq!(inv.is_low_stock(), qty <= threshold);
    }
}

// ── ProductType parsing ──────────────────────────────────────────────

proptest! {
    /// A canonical stored value parses back to its own variant, for all
    /// four variants, and the canonical spelling is fixed.
    ///
    /// The round trip is what keeps `products.product_type` stable across
    /// a read-modify-write: a variant whose stored spelling differed from
    /// its parsed spelling would rewrite the column on every save.
    ///
    /// Sampled as ONE pair rather than two independent draws — the earlier
    /// form drew an index and a spelling separately, so it asserted
    /// `all[0].1 == "restaurant"` whenever the two happened to disagree.
    /// That is a bad property, not a bad implementation.
    #[test]
    fn product_type_stored_spelling_round_trips(
        pair in prop::sample::select(vec![
            (ProductType::Retail, "retail"),
            (ProductType::Restaurant, "restaurant"),
            (ProductType::Both, "both"),
            (ProductType::Service, "service"),
        ])
    ) {
        let (variant, stored) = pair;
        prop_assert_eq!(
            ProductType::parse_str(stored),
            Some(variant),
            "canonical spelling {:?} did not parse to its own variant", stored
        );
        // And the canonical spelling survives the stored-value path too.
        prop_assert_eq!(
            ProductType::parse_stored_or_default(Some(stored), "SKU-X", "test"),
            variant
        );
    }

    /// An unrecognised stored value falls back to `Retail` rather than
    /// panicking or failing the listing.
    ///
    /// The column has no CHECK constraint in either engine and the bridge
    /// writes raw IPC strings, so a bad value is reachable. The row must
    /// survive: one bad `product_type` may not take a product listing
    /// down. The fallback is documented as ambiguous between a legitimate
    /// `'retail'` and a failed read, and the warning is how they are told
    /// apart — so the property is that it falls back, not that it is
    /// distinguishable from its return value alone.
    #[test]
    fn unrecognised_product_type_falls_back_to_retail(s in "[A-Za-z0-9_ ]{0,20}") {
        prop_assume!(ProductType::parse_str(&s).is_none());
        let parsed = ProductType::parse_stored_or_default(Some(s.as_str()), "SKU-X", "test");
        prop_assert_eq!(parsed, ProductType::Retail);
    }

    /// A missing (`NULL`) column also falls back to `Retail`.
    #[test]
    fn absent_product_type_falls_back_to_retail(_seed in any::<u8>()) {
        let parsed = ProductType::parse_stored_or_default(None, "SKU-X", "test");
        prop_assert_eq!(parsed, ProductType::Retail);
    }

    /// Only `Service` and `Retail`-family types are non-tracking in the
    /// way the doc claims — asserted as the actual mapping, so a future
    /// edit that changed `tracks_inventory` for one variant fails here.
    #[test]
    fn tracks_inventory_is_stable_per_variant(idx in 0usize..4usize) {
        let all = [
            ProductType::Retail,
            ProductType::Restaurant,
            ProductType::Both,
            ProductType::Service,
        ];
        let t = all[idx];
        // `Service` is the only variant that does not track stock; the
        // other three all do. Any change here changes whether a sale
        // deducts, so it must be a deliberate edit with a failing test.
        prop_assert_eq!(t.tracks_inventory(), t != ProductType::Service);
    }
}
