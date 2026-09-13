use super::*;
use crate::migrations::fresh_db;
use rusqlite::Connection;

// ── Helpers ─────────────────────────────────────────────────────

fn seeded_conn() -> Connection {
    let conn = fresh_db();
    seed_terminal(&conn, "resto-1");
    seed_terminal(&conn, "resto-2");
    conn
}

/// Seed a Restaurant POS terminal — the scope key of the rules table is
/// an FK onto `terminals` (mirroring kds_devices), so every fixture
/// provides one even where the pragma would not force it.
fn seed_terminal(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO terminals (id, name, device_id, is_active) VALUES (?1, ?2, ?3, 1)",
        params![id, format!("Term {id}"), format!("dev-{id}")],
    )
    .unwrap();
}

fn seed_category(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO categories (id, name, colour, icon, created_at, updated_at) \
         VALUES (?1, ?2, '#06b6d4', '', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![id, format!("Category {id}")],
    )
    .unwrap();
}

fn seed_product(conn: &Connection, sku: &str, category_id: Option<&str>, zone: Option<&str>) {
    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, category_id, kitchen_zone, \
         created_at, updated_at) \
         VALUES (?1, ?2, ?2, 1000, 'USD', ?3, ?4, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        params![sku, sku, category_id, zone],
    )
    .unwrap();
}

fn input(
    priority: i64,
    matcher: KdsRuleMatcher,
    matcher_value: &str,
    target_station: &str,
) -> KdsRoutingRuleInput {
    KdsRoutingRuleInput {
        priority,
        matcher,
        matcher_value: matcher_value.into(),
        target_station: target_station.into(),
        is_active: true,
    }
}

// ── list / save roundtrips ──────────────────────────────────────

#[test]
fn list_empty_for_restaurant_without_rules() {
    let conn = seeded_conn();
    let store = Store::new(&conn);
    assert!(
        store.list_kds_routing_rules("resto-1").unwrap().is_empty(),
        "unknown scope must list empty, not error"
    );
}

#[test]
fn save_and_list_roundtrip_perserves_every_field() {
    let conn = seeded_conn();
    let store = Store::new(&conn);
    let saved = store
        .save_kds_routing_rules(
            "resto-1",
            &[input(
                1,
                KdsRuleMatcher::Sku,
                "BURGER",
                "station-grill",
            )],
        )
        .unwrap();
    assert_eq!(saved.len(), 1);
    let rule = &saved[0];
    assert_eq!(rule.restaurant_pos_id, "resto-1");
    assert_eq!(rule.priority, 1);
    assert_eq!(rule.matcher, KdsRuleMatcher::Sku);
    assert_eq!(rule.matcher_value, "BURGER");
    assert_eq!(rule.target_station, "station-grill");
    assert!(rule.is_active);
    assert!(!rule.id.is_empty());
    assert!(!rule.created_at.is_empty());
    assert!(!rule.updated_at.is_empty());

    let listed = store.list_kds_routing_rules("resto-1").unwrap();
    assert_eq!(listed, saved, "list must return exactly what save wrote");
}

#[test]
fn save_replaces_the_whole_scope_set() {
    let conn = seeded_conn();
    let store = Store::new(&conn);
    store
        .save_kds_routing_rules(
            "resto-1",
            &[
                input(1, KdsRuleMatcher::Sku, "OLD-A", "s1"),
                input(2, KdsRuleMatcher::Sku, "OLD-B", "s2"),
            ],
        )
        .unwrap();
    let after = store
        .save_kds_routing_rules("resto-1", &[input(3, KdsRuleMatcher::Sku, "NEW", "s3")])
        .unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].matcher_value, "NEW");
    assert_eq!(after[0].priority, 3);
    let listed = store.list_kds_routing_rules("resto-1").unwrap();
    assert_eq!(listed.len(), 1, "replaced rows must be gone, not merged");
}

#[test]
fn save_empty_list_clears_the_scope() {
    let conn = seeded_conn();
    let store = Store::new(&conn);
    store
        .save_kds_routing_rules("resto-1", &[input(1, KdsRuleMatcher::Sku, "X", "s")])
        .unwrap();
    let after = store.save_kds_routing_rules("resto-1", &[]).unwrap();
    assert!(after.is_empty());
    assert!(store.list_kds_routing_rules("resto-1").unwrap().is_empty());
}

#[test]
fn scopes_are_isolated_between_restaurants() {
    let conn = seeded_conn();
    let store = Store::new(&conn);
    store
        .save_kds_routing_rules("resto-1", &[input(1, KdsRuleMatcher::Sku, "A", "s1")])
        .unwrap();
    store
        .save_kds_routing_rules(
            "resto-2",
            &[
                input(1, KdsRuleMatcher::Category, "cat-x", "s2"),
                input(2, KdsRuleMatcher::Sku, "B", "s3"),
            ],
        )
        .unwrap();
    // Replacing resto-1's set must leave resto-2 untouched.
    store.save_kds_routing_rules("resto-1", &[]).unwrap();
    assert!(store.list_kds_routing_rules("resto-1").unwrap().is_empty());
    assert_eq!(store.list_kds_routing_rules("resto-2").unwrap().len(), 2);
}

#[test]
fn list_orders_by_priority_then_insertion_order() {
    let conn = seeded_conn();
    let store = Store::new(&conn);
    let saved = store
        .save_kds_routing_rules(
            "resto-1",
            &[
                input(5, KdsRuleMatcher::Sku, "FIVE", "s"),
                input(1, KdsRuleMatcher::Sku, "ONE", "s"),
                input(5, KdsRuleMatcher::Sku, "FIVE-AGAIN", "s"),
            ],
        )
        .unwrap();
    let order: Vec<&str> = saved.iter().map(|r| r.matcher_value.as_str()).collect();
    assert_eq!(order, vec!["ONE", "FIVE", "FIVE-AGAIN"]);
}

#[test]
fn negative_and_zero_priorities_round_trip() {
    // Priority is a ranking, not a money/quantity: no positivity pin.
    let conn = seeded_conn();
    let store = Store::new(&conn);
    let saved = store
        .save_kds_routing_rules(
            "resto-1",
            &[
                input(-5, KdsRuleMatcher::Sku, "TOP", "s"),
                input(0, KdsRuleMatcher::Sku, "ZERO", "s"),
            ],
        )
        .unwrap();
    assert_eq!(saved[0].priority, -5);
    assert_eq!(saved[1].priority, 0);
}

#[test]
fn inactive_flag_round_trips() {
    let conn = seeded_conn();
    let store = Store::new(&conn);
    let mut off = input(1, KdsRuleMatcher::Sku, "OFF", "s");
    off.is_active = false;
    let saved = store.save_kds_routing_rules("resto-1", &[off]).unwrap();
    assert_eq!(saved.len(), 1);
    assert!(!saved[0].is_active, "is_active=false must persist");
}

#[test]
fn tag_kind_is_storable_even_though_it_never_matches() {
    // Stamped design: 'tag' stays in the CHECK for schema stability while
    // the catalog has no tags — storage round-trips, routing ignores it
    // (see kds_tests::tag_rule_never_matches...).
    let conn = seeded_conn();
    let store = Store::new(&conn);
    let saved = store
        .save_kds_routing_rules("resto-1", &[input(1, KdsRuleMatcher::Tag, "spicy", "s")])
        .unwrap();
    assert_eq!(saved[0].matcher, KdsRuleMatcher::Tag);
}

// ── Validation & constraints ────────────────────────────────────

#[test]
fn save_rejects_blank_matcher_value() {
    let conn = seeded_conn();
    let store = Store::new(&conn);
    let bad = input(1, KdsRuleMatcher::Sku, "  ", "s");
    let err = store.save_kds_routing_rules("resto-1", &[bad]).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field: "matcher_value", .. }),
        "got {err:?}"
    );
    // And the rejection is atomic: a prior set stays intact.
    store
        .save_kds_routing_rules("resto-1", &[input(1, KdsRuleMatcher::Sku, "KEEP", "s")])
        .unwrap();
    store
        .save_kds_routing_rules(
            "resto-1",
            &[
                input(1, KdsRuleMatcher::Sku, "NEW", "s"),
                input(2, KdsRuleMatcher::Sku, "", "s"),
            ],
        )
        .unwrap_err();
    let listed = store.list_kds_routing_rules("resto-1").unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].matcher_value, "KEEP", "failed save must roll back the delete");
}

#[test]
fn save_rejects_blank_target_station() {
    let conn = seeded_conn();
    let store = Store::new(&conn);
    let bad = input(1, KdsRuleMatcher::Sku, "BURGER", " ");
    let err = store.save_kds_routing_rules("resto-1", &[bad]).unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field: "target_station", .. }),
        "got {err:?}"
    );
}

#[test]
fn save_rejects_blank_restaurant_scope() {
    let conn = seeded_conn();
    let store = Store::new(&conn);
    let err = store
        .save_kds_routing_rules("", &[input(1, KdsRuleMatcher::Sku, "X", "s")])
        .unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field: "restaurant_pos_id", .. }),
        "got {err:?}"
    );
}

#[test]
fn check_constraint_rejects_unknown_matcher_kind() {
    // The Rust enum cannot produce it, but a hand-written row must still
    // be refused by the table CHECK ('sku'|'category'|'tag' only).
    let conn = seeded_conn();
    let err = conn.execute(
        "INSERT INTO kds_routing_rules
             (id, restaurant_pos_id, priority, matcher_kind, matcher_value, target_station)
         VALUES ('x-1', 'resto-1', 1, 'supplier', 'V', 's')",
        [],
    );
    assert!(err.is_err(), "CHECK must reject matcher_kind 'supplier'");
}

// ── product_category_id_by_sku ──────────────────────────────────

#[test]
fn product_category_lookup_covers_all_three_nones() {
    let conn = seeded_conn();
    store_seed_product_cat(&conn);
    let store = Store::new(&conn);

    // Categorized → Some(id).
    assert_eq!(
        store
            .product_category_id_by_sku("CAT-SKU")
            .unwrap()
            .as_deref(),
        Some("cat-1")
    );
    // Known product without a category → Ok(None).
    assert_eq!(
        store
            .product_category_id_by_sku("NO-CAT")
            .unwrap()
            .as_deref(),
        None
    );
    // Unknown SKU → Ok(None), not NotFound.
    assert_eq!(store.product_category_id_by_sku("GHOST").unwrap(), None);
}

fn store_seed_product_cat(conn: &Connection) {
    seed_category(conn, "cat-1");
    seed_product(conn, "CAT-SKU", Some("cat-1"), Some("grill"));
    seed_product(conn, "NO-CAT", None, None);
}
