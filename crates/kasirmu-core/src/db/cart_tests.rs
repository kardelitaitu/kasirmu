use super::*;
use crate::migrations;
use foundation::{Cart, CartLine, Currency, Money, Sku};
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

fn sample_cart() -> Cart {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("COFFEE"), 2, price(350)))
        .unwrap();
    cart.add_line(CartLine::new(Sku::new("BAGEL"), 1, price(450)))
        .unwrap();
    cart
}

#[test]
fn save_and_load_roundtrip() {
    let conn = fresh();
    let s = store(&conn);
    let cart = sample_cart();
    let id = cart.id();

    s.save_active_cart(&cart, None).unwrap();
    let loaded = s.load_active_cart(&id).unwrap().unwrap();
    assert_eq!(loaded.id(), id);
    assert_eq!(loaded.line_count(), 2);
    assert_eq!(loaded.total().unwrap().minor_units, 1150);
}

#[test]
fn load_nonexistent_returns_none() {
    let conn = fresh();
    let s = store(&conn);
    let id = CartId::new();
    let result = s.load_active_cart(&id).unwrap();
    assert!(result.is_none());
}

#[test]
fn delete_removes_cart() {
    let conn = fresh();
    let s = store(&conn);
    let cart = sample_cart();
    let id = cart.id();

    s.save_active_cart(&cart, None).unwrap();
    s.delete_active_cart(&id).unwrap();
    assert!(s.load_active_cart(&id).unwrap().is_none());
}

#[test]
fn delete_nonexistent_is_noop() {
    let conn = fresh();
    let s = store(&conn);
    let id = CartId::new();
    // Should not error.
    s.delete_active_cart(&id).unwrap();
}

#[test]
fn update_overwrites_existing() {
    let conn = fresh();
    let s = store(&conn);
    let mut cart = sample_cart();
    let id = cart.id();

    s.save_active_cart(&cart, None).unwrap();

    // Modify and save again.
    cart.add_line(CartLine::new(Sku::new("TEA"), 3, price(200)))
        .unwrap();
    s.save_active_cart(&cart, None).unwrap();

    let loaded = s.load_active_cart(&id).unwrap().unwrap();
    assert_eq!(loaded.line_count(), 3);
    assert_eq!(loaded.total().unwrap().minor_units, 1750);
}

#[test]
fn list_active_carts_returns_all() {
    let conn = fresh();
    let s = store(&conn);

    let cart_a = Cart::new(usd());
    let id_a = cart_a.id();
    s.save_active_cart(&cart_a, None).unwrap();

    let cart_b = Cart::new(usd());
    let id_b = cart_b.id();
    s.save_active_cart(&cart_b, None).unwrap();

    let ids = s.list_active_carts().unwrap();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&id_a));
    assert!(ids.contains(&id_b));
}

#[test]
fn list_active_carts_empty() {
    let conn = fresh();
    let s = store(&conn);
    let ids = s.list_active_carts().unwrap();
    assert!(ids.is_empty());
}

#[test]
fn list_active_carts_ordered_by_update() {
    let conn = fresh();
    let s = store(&conn);

    let cart_a = Cart::new(usd());
    let id_a = cart_a.id();
    s.save_active_cart(&cart_a, None).unwrap();

    // Small delay so timestamps differ.
    std::thread::sleep(std::time::Duration::from_millis(10));

    let cart_b = Cart::new(usd());
    let id_b = cart_b.id();
    s.save_active_cart(&cart_b, None).unwrap();

    let ids = s.list_active_carts().unwrap();
    // id_b should be first (most recently updated).
    assert_eq!(ids[0], id_b);
    assert_eq!(ids[1], id_a);
}

#[test]
fn deduction_location_lock_missing_for_cart_without_location() {
    let conn = fresh();
    let s = store(&conn);
    let cart = sample_cart();
    let id = cart.id();

    s.save_active_cart(&cart, None).unwrap();

    let loc = s.get_active_cart_deduction_location(&id).unwrap();
    assert!(loc.is_none());

    let result = s.ensure_cart_deduction_location_lock(&id);
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().to_string(),
        format!("cart {id} has no deduction_location_id — create the cart via start_sale_scoped")
    );
}

#[test]
fn deduction_location_lock_present_when_saved_with_location() {
    let conn = fresh();
    let s = store(&conn);
    let cart = sample_cart();
    let id = cart.id();
    let loc_id = "01926b3a-0000-7000-8000-000000000001";

    s.save_active_cart(&cart, Some(loc_id)).unwrap();

    let loc = s.get_active_cart_deduction_location(&id).unwrap();
    assert_eq!(loc.as_deref(), Some(loc_id));

    assert!(s.ensure_cart_deduction_location_lock(&id).is_ok());
}

#[test]
fn deduction_location_lock_preserved_on_subsequent_save_with_none() {
    let conn = fresh();
    let s = store(&conn);
    let cart = sample_cart();
    let id = cart.id();
    let loc_id = "01926b3a-0000-7000-8000-000000000001";

    // Save with location lock.
    s.save_active_cart(&cart, Some(loc_id)).unwrap();

    // Subsequent save with None should preserve the lock.
    let mut cart2 = cart.clone();
    cart2
        .add_line(CartLine::new(Sku::new("TEA"), 1, price(200)))
        .unwrap();
    s.save_active_cart(&cart2, None).unwrap();

    let loc = s.get_active_cart_deduction_location(&id).unwrap();
    assert_eq!(loc.as_deref(), Some(loc_id));
}

#[test]
fn nonexistent_cart_returns_none_location() {
    let conn = fresh();
    let s = store(&conn);
    let id = CartId::new();
    let loc = s.get_active_cart_deduction_location(&id).unwrap();
    assert!(loc.is_none());
}

// ── Additional edge cases ─────────────────────────────────────

#[test]
fn override_location_on_existing_cart_sets_override_at() {
    let conn = fresh();
    let s = store(&conn);
    let cart = sample_cart();
    let id = cart.id();
    let loc_id = "01926b3a-0000-7000-8000-000000000001";

    s.save_active_cart(&cart, Some(loc_id)).unwrap();

    // Before override: override_at should be None.
    let (_, _, before) = s
        .get_active_cart_deduction_location_info(&id)
        .unwrap()
        .expect("cart with lock should have info");
    assert!(before.is_none(), "no override before call");

    // Override.
    s.override_active_cart_deduction_location(&id).unwrap();

    // After override: override_at should be Some.
    let (_, _, after) = s
        .get_active_cart_deduction_location_info(&id)
        .unwrap()
        .expect("cart with lock should have info");
    assert!(after.is_some(), "override timestamp should be set");
}

#[test]
fn override_location_nonexistent_cart_fails() {
    let conn = fresh();
    let s = store(&conn);
    let id = CartId::new();
    let err = s.override_active_cart_deduction_location(&id).unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "active_cart"));
}

#[test]
fn deduction_location_info_none_for_cart_without_lock() {
    let conn = fresh();
    let s = store(&conn);
    let cart = sample_cart();
    let id = cart.id();

    s.save_active_cart(&cart, None).unwrap();
    let info = s.get_active_cart_deduction_location_info(&id).unwrap();
    assert!(info.is_none(), "cart without lock has no location info");
}

#[test]
fn deduction_location_info_returns_location_name() {
    let conn = fresh();
    let s = store(&conn);
    let cart = sample_cart();
    let id = cart.id();
    let loc_id = "01926b3a-0000-7000-8000-000000000001";

    s.save_active_cart(&cart, Some(loc_id)).unwrap();
    let (lid, name, _) = s
        .get_active_cart_deduction_location_info(&id)
        .unwrap()
        .expect("cart with lock should have info");
    assert_eq!(lid, loc_id);
    // The default location is seeded in migration 078 with name "Default".
    assert!(!name.is_empty(), "location name should be non-empty");
}

#[test]
fn ensure_lock_fails_for_nonexistent_cart() {
    let conn = fresh();
    let s = store(&conn);
    let id = CartId::new();
    let result = s.ensure_cart_deduction_location_lock(&id);
    assert!(result.is_err());
}

#[test]
fn multiple_carts_isolated_location_locks() {
    let conn = fresh();
    let s = store(&conn);
    let loc_id = "01926b3a-0000-7000-8000-000000000001";

    let cart_a = sample_cart();
    let id_a = cart_a.id();
    s.save_active_cart(&cart_a, Some(loc_id)).unwrap();

    let cart_b = sample_cart();
    let id_b = cart_b.id();
    s.save_active_cart(&cart_b, None).unwrap();

    // Cart A has lock, Cart B does not.
    assert!(s.ensure_cart_deduction_location_lock(&id_a).is_ok());
    assert!(s.ensure_cart_deduction_location_lock(&id_b).is_err());
}

#[test]
fn list_active_carts_excludes_deleted() {
    let conn = fresh();
    let s = store(&conn);

    let cart_a = Cart::new(usd());
    let id_a = cart_a.id();
    s.save_active_cart(&cart_a, None).unwrap();

    let cart_b = Cart::new(usd());
    let id_b = cart_b.id();
    s.save_active_cart(&cart_b, None).unwrap();

    s.delete_active_cart(&id_a).unwrap();
    let ids = s.list_active_carts().unwrap();
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0], id_b);
}

#[test]
fn save_multiple_carts_all_listed() {
    let conn = fresh();
    let s = store(&conn);

    let ids: Vec<CartId> = (0..5)
        .map(|_| {
            let c = Cart::new(usd());
            let id = c.id();
            s.save_active_cart(&c, None).unwrap();
            id
        })
        .collect();

    let listed = s.list_active_carts().unwrap();
    assert_eq!(listed.len(), 5);
    for id in &ids {
        assert!(listed.contains(id), "cart {id} should be in list");
    }
}

#[test]
fn save_cart_with_location_override_then_check_info() {
    let conn = fresh();
    let s = store(&conn);
    let loc_id = "01926b3a-0000-7000-8000-000000000001";

    let cart = Cart::new(usd());
    let id = cart.id();
    s.save_active_cart(&cart, Some(loc_id)).unwrap();

    // Override twice to verify timestamp updates.
    s.override_active_cart_deduction_location(&id).unwrap();
    let (_, _, t1) = s
        .get_active_cart_deduction_location_info(&id)
        .unwrap()
        .expect("info exists");

    std::thread::sleep(std::time::Duration::from_millis(2));
    s.override_active_cart_deduction_location(&id).unwrap();
    let (_, _, t2) = s
        .get_active_cart_deduction_location_info(&id)
        .unwrap()
        .expect("info exists");

    assert_ne!(t1, t2, "second override should update timestamp");
}
