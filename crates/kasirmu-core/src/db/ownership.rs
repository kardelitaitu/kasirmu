//! Table ownership map (plan §7) — GENERATED, DO NOT EDIT.
//!
//! Generated from `modules/ownership.json` by
//! `scripts/generate-ownership-map.mjs`. The same source feeds
//! `scripts/verify-namespace-governance.py`; a parity test fails when
//! the two disagree. Change the JSON, re-run the generator, commit both.
//!
//! A module that owns no tables (reporting) still appears, with an empty
//! slice: absence from this map is a governance gap, not permission.

/// The module id that owns each table, per `modules/ownership.json`.
pub const TABLE_OWNERS: &[(&str, &[&str])] = &[
    ("sales", &["sales", "sale_lines", "payments"]),
    (
        "inventory",
        &["products", "product_recipes", "inventory", "stock_summary"],
    ),
    ("crm", &["customers"]),
    ("settings", &["settings"]),
    ("currency", &["currencies", "exchange_rates"]),
    (
        "loyalty",
        &["loyalty_accounts", "loyalty_tiers", "loyalty_transactions"],
    ),
    ("staff", &["users", "roles"]),
    ("tax", &["tax_rates", "category_taxes", "product_taxes"]),
    (
        "terminal",
        &[
            "terminals",
            "terminal_profiles",
            "terminal_feature_overrides",
        ],
    ),
    ("giftcards", &["gift_cards", "gift_card_transactions"]),
    (
        "kitchen",
        &["kds_daily_counters", "kds_line_items", "kds_order_targets"],
    ),
    ("promotions", &["promotions", "promotion_applications"]),
    ("purchasing", &["purchase_orders", "purchase_order_lines"]),
    ("reporting", &[]),
];

/// The owning module for a table, or `None` when the map does not name it.
///
/// `None` is a governance gap, not permission: callers must treat an
/// unmapped table the same as a foreign one (fail closed).
pub fn owner_of(table: &str) -> Option<&'static str> {
    for (module, tables) in TABLE_OWNERS {
        if tables.contains(&table) {
            return Some(module);
        }
    }
    None
}

#[cfg(test)]
#[path = "ownership_tests.rs"]
mod tests;
