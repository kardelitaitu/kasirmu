use super::*;
use crate::db::Store;
use crate::migrations;

fn setup() -> Store<'static> {
    let conn = migrations::fresh_db();
    let conn = Box::leak(Box::new(conn));
    Store::new(conn)
}

fn test_promo(id: &str) -> Promotion {
    Promotion {
        id: id.to_owned(),
        name: format!("Promo {id}"),
        description: "Test".into(),
        promo_type: "percentage".into(),
        value_minor: 10,
        min_qty: None,
        trigger_sku: None,
        reward_sku: None,
        reward_qty: None,
        starts_at: None,
        ends_at: None,
        min_order_minor: 0,
        category_id: None,
        active: true,
        created_at: "2025-01-01T00:00:00.000Z".into(),
        updated_at: "2025-01-01T00:00:00.000Z".into(),
    }
}

#[test]
fn create_and_list() {
    let store = setup();
    let p = test_promo("p1");
    store.create_promotion(&p).unwrap();
    let list = store.list_promotions().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Promo p1");
}

#[test]
fn list_promotions_empty() {
    let store = setup();
    let list = store.list_promotions().unwrap();
    assert!(list.is_empty());
}

#[test]
fn get_by_id() {
    let store = setup();
    let p = test_promo("p2");
    store.create_promotion(&p).unwrap();
    let found = store.get_promotion("p2").unwrap().unwrap();
    assert_eq!(found.name, "Promo p2");
    assert!(store.get_promotion("nonexistent").unwrap().is_none());
}

#[test]
fn update() {
    let store = setup();
    let mut p = test_promo("p3");
    store.create_promotion(&p).unwrap();
    p.name = "Updated".into();
    p.updated_at = "2025-06-01T00:00:00.000Z".into();
    store.update_promotion(&p).unwrap();
    let found = store.get_promotion("p3").unwrap().unwrap();
    assert_eq!(found.name, "Updated");
}

#[test]
fn update_not_found() {
    let store = setup();
    let p = test_promo("nonexistent");
    let err = store.update_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn delete() {
    let store = setup();
    let p = test_promo("p4");
    store.create_promotion(&p).unwrap();
    store.delete_promotion("p4").unwrap();
    assert!(store.get_promotion("p4").unwrap().is_none());
}

#[test]
fn delete_not_found() {
    let store = setup();
    let err = store.delete_promotion("nonexistent").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn get_active_promotions() {
    let store = setup();
    let now = chrono::Utc::now();
    let past = now - chrono::Duration::hours(2);
    let future = now + chrono::Duration::hours(2);

    // Active — no time bounds.
    let p1 = test_promo("p1");
    store.create_promotion(&p1).unwrap();

    // Active — within window.
    let mut p2 = test_promo("p2");
    p2.starts_at = Some(past.to_rfc3339());
    p2.ends_at = Some(future.to_rfc3339());
    store.create_promotion(&p2).unwrap();

    // Inactive — active = 0.
    let mut p3 = test_promo("p3");
    p3.active = false;
    store.create_promotion(&p3).unwrap();

    // Expired.
    let far_past = now - chrono::Duration::hours(48);
    let mut p4 = test_promo("p4");
    p4.starts_at = Some(far_past.to_rfc3339());
    p4.ends_at = Some((far_past + chrono::Duration::hours(1)).to_rfc3339());
    store.create_promotion(&p4).unwrap();

    let active = store.get_active_promotions().unwrap();
    assert_eq!(active.len(), 2);
}

#[test]
fn record_and_get_applications() {
    let store = setup();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Create a promotion first (FK constraint).
    let promo = test_promo("promo-1");
    store.create_promotion(&promo).unwrap();

    // Create a sale (FK constraint).
    store
        .conn
        .execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, created_at, updated_at)
         VALUES ('sale-1', 1000, 'USD', 1, ?1, ?1)",
            params![now],
        )
        .unwrap();

    let app = PromotionApplication {
        id: "app-1".into(),
        promotion_id: "promo-1".into(),
        sale_id: "sale-1".into(),
        discount_minor: 100,
        description: "10% off".into(),
        created_at: now.clone(),
    };
    store.record_promotion_application(&app).unwrap();

    let apps = store.get_promotion_applications_for_sale("sale-1").unwrap();
    assert_eq!(apps.len(), 1);
    assert_eq!(apps[0].discount_minor, 100);
}

// ── Additional edge-case tests ─────────────────────────────────

#[test]
fn list_promotions_ordered_by_name() {
    let store = setup();
    let c = test_promo("p-c");
    store.create_promotion(&c).unwrap();
    let a = test_promo("p-a");
    store.create_promotion(&a).unwrap();
    let b = test_promo("p-b");
    store.create_promotion(&b).unwrap();

    let list = store.list_promotions().unwrap();
    assert_eq!(list.len(), 3);
    // ORDER BY name ASC: Promo p-a, Promo p-b, Promo p-c
    assert_eq!(list[0].name, "Promo p-a");
    assert_eq!(list[1].name, "Promo p-b");
    assert_eq!(list[2].name, "Promo p-c");
}

#[test]
fn create_promotion_duplicate_id() {
    let store = setup();
    let p = test_promo("dup");
    store.create_promotion(&p).unwrap();
    let result = store.create_promotion(&p);
    assert!(result.is_err());
}

#[test]
fn update_changes_all_fields() {
    let store = setup();
    let mut p = test_promo("all");
    store.create_promotion(&p).unwrap();

    p.name = "All Updated".into();
    p.description = "New desc".into();
    p.promo_type = "fixed_amount".into();
    p.value_minor = 500;
    p.min_qty = Some(2);
    p.trigger_sku = Some("SKU-TRIGGER".into());
    p.reward_sku = Some("SKU-REWARD".into());
    p.reward_qty = Some(1);
    p.min_order_minor = 1000;
    p.category_id = Some("cat-1".into());
    p.active = false;
    p.updated_at = "2025-06-01T00:00:00.000Z".into();
    store.update_promotion(&p).unwrap();

    let found = store.get_promotion("all").unwrap().unwrap();
    assert_eq!(found.name, "All Updated");
    assert_eq!(found.description, "New desc");
    assert_eq!(found.promo_type, "fixed_amount");
    assert_eq!(found.value_minor, 500);
    assert_eq!(found.min_qty, Some(2));
    assert_eq!(found.trigger_sku, Some("SKU-TRIGGER".to_owned()));
    assert_eq!(found.reward_sku, Some("SKU-REWARD".to_owned()));
    assert_eq!(found.reward_qty, Some(1));
    assert_eq!(found.min_order_minor, 1000);
    assert_eq!(found.category_id, Some("cat-1".to_owned()));
    assert!(!found.active);
}

#[test]
fn get_active_promotions_no_time_bounds() {
    let store = setup();
    let p = test_promo("no-time");
    store.create_promotion(&p).unwrap();

    // starts_at = NULL, ends_at = NULL, active = true → should be active
    let active = store.get_active_promotions().unwrap();
    assert!(active.iter().any(|x| x.id == "no-time"));
}

#[test]
fn get_active_promotions_no_active_promos() {
    let store = setup();

    // Create only inactive promos
    let mut p1 = test_promo("i1");
    p1.active = false;
    store.create_promotion(&p1).unwrap();
    let mut p2 = test_promo("i2");
    p2.active = false;
    store.create_promotion(&p2).unwrap();

    let active = store.get_active_promotions().unwrap();
    assert!(active.is_empty());
}

#[test]
fn get_active_promotions_future_starts_at() {
    let store = setup();
    let future = chrono::Utc::now() + chrono::Duration::hours(24);

    let mut p = test_promo("future");
    p.starts_at = Some(future.to_rfc3339());
    store.create_promotion(&p).unwrap();

    // starts_at is in the future → not yet active
    let active = store.get_active_promotions().unwrap();
    assert!(!active.iter().any(|x| x.id == "future"));
}

#[test]
fn get_active_promotions_past_ends_at() {
    let store = setup();
    let past = chrono::Utc::now() - chrono::Duration::hours(24);

    let mut p = test_promo("past");
    p.ends_at = Some(past.to_rfc3339());
    store.create_promotion(&p).unwrap();

    // ends_at is in the past → expired
    let active = store.get_active_promotions().unwrap();
    assert!(!active.iter().any(|x| x.id == "past"));
}

#[test]
fn get_promotion_applications_multiple_for_sale() {
    let store = setup();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let p1 = test_promo("mp1");
    store.create_promotion(&p1).unwrap();
    let p2 = test_promo("mp2");
    store.create_promotion(&p2).unwrap();

    store
        .conn
        .execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, created_at, updated_at)
         VALUES ('multi-sale', 2000, 'USD', 2, ?1, ?1)",
            params![now],
        )
        .unwrap();

    let app1 = PromotionApplication {
        id: "app-m1".into(),
        promotion_id: "mp1".into(),
        sale_id: "multi-sale".into(),
        discount_minor: 100,
        description: "10% off".into(),
        created_at: now.clone(),
    };
    let app2 = PromotionApplication {
        id: "app-m2".into(),
        promotion_id: "mp2".into(),
        sale_id: "multi-sale".into(),
        discount_minor: 50,
        description: "$5 off".into(),
        created_at: now.clone(),
    };
    store.record_promotion_application(&app1).unwrap();
    store.record_promotion_application(&app2).unwrap();

    let apps = store
        .get_promotion_applications_for_sale("multi-sale")
        .unwrap();
    assert_eq!(apps.len(), 2);
}

#[test]
fn get_promotion_applications_empty_for_sale() {
    let store = setup();
    let apps = store
        .get_promotion_applications_for_sale("no-apps-sale")
        .unwrap();
    assert!(apps.is_empty());
}

// ── Validation tests ────────────────────────────────────────

#[test]
fn create_promotion_empty_name_rejected() {
    let store = setup();
    let mut p = test_promo("v1");
    p.name = "".into();
    let err = store.create_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn create_promotion_whitespace_name_rejected() {
    let store = setup();
    let mut p = test_promo("v2");
    p.name = "   ".into();
    let err = store.create_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn create_promotion_empty_type_rejected() {
    let store = setup();
    let mut p = test_promo("v3");
    p.promo_type = "".into();
    let err = store.create_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "promo_type"));
}

#[test]
fn create_promotion_invalid_type_rejected() {
    let store = setup();
    let mut p = test_promo("v4");
    p.promo_type = "invalid_type".into();
    let err = store.create_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "promo_type"));
}

#[test]
fn create_promotion_negative_value_rejected() {
    let store = setup();
    let mut p = test_promo("v5");
    p.value_minor = -1;
    let err = store.create_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "value_minor"));
}

#[test]
fn create_promotion_negative_min_order_rejected() {
    let store = setup();
    let mut p = test_promo("v6");
    p.min_order_minor = -50;
    let err = store.create_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "min_order_minor"));
}

#[test]
fn update_promotion_empty_name_rejected() {
    let store = setup();
    let mut p = test_promo("v7");
    store.create_promotion(&p).unwrap();
    p.name = "".into();
    let err = store.update_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn record_application_negative_discount_rejected() {
    let store = setup();
    let app = PromotionApplication {
        id: "app1".into(),
        promotion_id: "p1".into(),
        sale_id: "s1".into(),
        discount_minor: -100,
        description: "test".into(),
        created_at: "2025-01-01T00:00:00.000Z".into(),
    };
    let err = store.record_promotion_application(&app).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "discount_minor"));
}

// ── Validation hardening (PROMO-8) ──────────────────────────────────

#[test]
fn create_rejects_percentage_value_over_100() {
    let store = setup();
    let mut p = test_promo("v-over");
    p.value_minor = 150;
    let err = store.create_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "value_minor"));
    assert!(store.get_promotion("v-over").unwrap().is_none());
}

#[test]
fn create_rejects_percentage_value_zero() {
    let store = setup();
    let mut p = test_promo("v-zero");
    p.value_minor = 0;
    let err = store.create_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "value_minor"));
}

#[test]
fn create_rejects_buy_x_get_y_without_trigger_sku() {
    let store = setup();
    let mut p = test_promo("v-bxgy");
    p.promo_type = "buy_x_get_y".into();
    p.trigger_sku = None;
    let err = store.create_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "trigger_sku"));
}

#[test]
fn create_rejects_buy_x_get_y_non_positive_quantities() {
    let store = setup();
    let mut p = test_promo("v-bxgy-qty");
    p.promo_type = "buy_x_get_y".into();
    p.trigger_sku = Some("COFFEE".into());
    p.min_qty = Some(0);
    p.reward_qty = Some(1);
    let err = store.create_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "min_qty"));

    p.min_qty = Some(2);
    p.reward_qty = Some(-3);
    let err = store.create_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "reward_qty"));
}

#[test]
fn create_accepts_valid_buy_x_get_y() {
    let store = setup();
    let mut p = test_promo("v-bxgy-ok");
    p.promo_type = "buy_x_get_y".into();
    p.value_minor = 100;
    p.trigger_sku = Some("COFFEE".into());
    p.reward_sku = Some("COOKIE".into());
    p.min_qty = Some(2);
    p.reward_qty = Some(1);
    store.create_promotion(&p).unwrap();
    assert!(store.get_promotion("v-bxgy-ok").unwrap().is_some());
}

#[test]
fn create_accepts_fixed_amount_any_non_negative_value() {
    let store = setup();
    let mut p = test_promo("v-fixed");
    p.promo_type = "fixed_amount".into();
    p.value_minor = 0; // fixed discount may be zero or any amount
    store.create_promotion(&p).unwrap();
    let mut p2 = test_promo("v-fixed-big");
    p2.promo_type = "fixed_amount".into();
    p2.value_minor = 999_999;
    store.create_promotion(&p2).unwrap();
}

#[test]
fn update_rejects_invalid_value_even_when_name_valid() {
    // COR-12 asymmetry: update used to validate only the name.
    let store = setup();
    let mut p = test_promo("v-upd");
    store.create_promotion(&p).unwrap();
    p.value_minor = 500; // percentage percent out of range
    let err = store.update_promotion(&p).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "value_minor"));
    // The stored row is untouched.
    let stored = store.get_promotion("v-upd").unwrap().unwrap();
    assert_eq!(stored.value_minor, 10);
}

// ── Atomic apply-to-payable (PROMO-3/4) ─────────────────────────────

use crate::foundation::Money;
use crate::sale::Sale;
use crate::{Cart, CartLine, Sku};

fn usd() -> crate::foundation::Currency {
    "USD".parse().unwrap()
}

fn usd_money(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

/// Cart: 2x COFFEE @ 350 + 1x BAGEL @ 450 = 1150.
fn cart_sale(store: &Store<'_>) -> Sale {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("COFFEE"), 2, usd_money(350)))
        .unwrap();
    cart.add_line(CartLine::new(Sku::new("BAGEL"), 1, usd_money(450)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    store.create_sale(&sale).unwrap();
    sale
}

#[test]
fn apply_reduces_sale_total_and_records_application() {
    let store = setup();
    let sale = cart_sale(&store);
    let p = test_promo("ap-1"); // percentage 10
    store.create_promotion(&p).unwrap();

    let app = store
        .apply_promotion_to_sale(&sale.id, "ap-1", chrono::Utc::now())
        .unwrap();
    assert_eq!(app.discount_minor, 115);

    let updated = store.get_sale(&sale.id).unwrap().unwrap();
    assert_eq!(updated.total.minor_units, 1035);

    let apps = store.get_promotion_applications_for_sale(&sale.id).unwrap();
    assert_eq!(apps.len(), 1);
    assert_eq!(apps[0].promotion_id, "ap-1");
}

#[test]
fn apply_rejects_second_application_of_same_promotion() {
    let store = setup();
    let sale = cart_sale(&store);
    let p = test_promo("ap-dup");
    store.create_promotion(&p).unwrap();

    store
        .apply_promotion_to_sale(&sale.id, "ap-dup", chrono::Utc::now())
        .unwrap();
    let err = store
        .apply_promotion_to_sale(&sale.id, "ap-dup", chrono::Utc::now())
        .unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "promotion_id"),
        "expected duplicate-application rejection, got {err:?}"
    );
    // Total was reduced exactly once; one application row exists.
    let updated = store.get_sale(&sale.id).unwrap().unwrap();
    assert_eq!(updated.total.minor_units, 1035);
    assert_eq!(
        store
            .get_promotion_applications_for_sale(&sale.id)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn apply_rejects_completed_sale() {
    let store = setup();
    let sale = cart_sale(&store);
    store.finalize_sale(&sale.id).unwrap();
    let p = test_promo("ap-done");
    store.create_promotion(&p).unwrap();

    let err = store
        .apply_promotion_to_sale(&sale.id, "ap-done", chrono::Utc::now())
        .unwrap_err();
    assert!(err.to_string().contains("not modifiable"));

    let updated = store.get_sale(&sale.id).unwrap().unwrap();
    assert_eq!(updated.total.minor_units, 1150);
    assert!(
        store
            .get_promotion_applications_for_sale(&sale.id)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn apply_different_promotions_stack() {
    let store = setup();
    let sale = cart_sale(&store);
    let mut pct = test_promo("ap-pct");
    pct.promo_type = "percentage".into();
    pct.value_minor = 10;
    store.create_promotion(&pct).unwrap();
    let mut fixed = test_promo("ap-fixed");
    fixed.promo_type = "fixed_amount".into();
    fixed.value_minor = 100;
    store.create_promotion(&fixed).unwrap();

    store
        .apply_promotion_to_sale(&sale.id, "ap-pct", chrono::Utc::now())
        .unwrap();
    store
        .apply_promotion_to_sale(&sale.id, "ap-fixed", chrono::Utc::now())
        .unwrap();
    // 1150 - 115 (10%) - 100 (fixed) = 935.
    let updated = store.get_sale(&sale.id).unwrap().unwrap();
    assert_eq!(updated.total.minor_units, 935);
    assert_eq!(
        store
            .get_promotion_applications_for_sale(&sale.id)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn apply_zero_discount_records_row_without_changing_total() {
    let store = setup();
    let sale = cart_sale(&store);
    // BXGY never satisfied (no trigger SKU in cart) → 0 discount.
    let mut p = test_promo("ap-zero");
    p.promo_type = "buy_x_get_y".into();
    p.value_minor = 100;
    p.trigger_sku = Some("TEA".into());
    p.reward_sku = Some("TEA".into());
    p.min_qty = Some(2);
    p.reward_qty = Some(1);
    store.create_promotion(&p).unwrap();

    let app = store
        .apply_promotion_to_sale(&sale.id, "ap-zero", chrono::Utc::now())
        .unwrap();
    assert_eq!(app.discount_minor, 0);
    let updated = store.get_sale(&sale.id).unwrap().unwrap();
    assert_eq!(updated.total.minor_units, 1150);
}

#[test]
fn apply_missing_promotion_is_not_found() {
    let store = setup();
    let sale = cart_sale(&store);
    let err = store
        .apply_promotion_to_sale(&sale.id, "nope", chrono::Utc::now())
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { ref entity, .. } if entity == &"promotion"));
}
