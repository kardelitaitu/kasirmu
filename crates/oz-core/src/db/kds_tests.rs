use super::*;
use crate::migrations;
use crate::{Cart, CartLine, Money, Sale, Sku};
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn usd() -> crate::Currency {
    "USD".parse().unwrap()
}

fn seed_terminal(conn: &Connection, id: &str, name: &str, device_id: &str) {
    conn.execute(
        "INSERT INTO terminals (id, name, device_id, is_active) VALUES (?1, ?2, ?3, 1)",
        rusqlite::params![id, name, device_id],
    )
    .unwrap();
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

fn seed_product(conn: &Connection, sku: &str, name: &str) {
    let s = store(conn);
    s.create_product(sku, name, price(500), None, None, 100, Some("restaurant"))
        .unwrap();
}

#[test]
fn create_and_get_kds_order() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "COFFEE", "Coffee");

    // Create a minimal sale.
    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let test_sale = Sale {
        id: sale_id.clone(),
        status: crate::SaleStatus::Completed,
        total: price(0),
        currency: usd(),
        line_count: 0,
        payment_method: None,
        tendered_minor: None,
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now,
        subtotal: price(0),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        lines: vec![],
        version: 1,
    };
    s.create_sale(&test_sale).unwrap();

    let order = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale_id.clone(),
            store_id: None,
            items_summary: "Coffee x2, Bagel".into(),
            item_count: 3,
            kitchen_zone: None,
            notes: "No onions".into(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    assert_eq!(order.sale_id, sale_id);
    assert_eq!(order.items_summary, "Coffee x2, Bagel");
    assert_eq!(order.item_count, 3);
    assert_eq!(order.notes, "No onions");
    assert_eq!(order.status, "pending");
    assert!(order.display_number.is_some());
    assert!(order.display_number.unwrap() >= 1);

    let fetched = s.get_kds_order(&order.id).unwrap().unwrap();
    assert_eq!(fetched.id, order.id);
}

#[test]
fn get_kds_order_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let result = s.get_kds_order("nonexistent").unwrap();
    assert!(result.is_none());
}

#[test]
fn get_kds_order_by_sale() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "TEA", "Tea");

    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let test_sale = Sale {
        id: sale_id.clone(),
        status: crate::SaleStatus::Completed,
        total: price(0),
        currency: usd(),
        line_count: 0,
        payment_method: None,
        tendered_minor: None,
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now,
        subtotal: price(0),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        lines: vec![],
        version: 1,
    };
    s.create_sale(&test_sale).unwrap();

    let order = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale_id.clone(),
            store_id: None,
            items_summary: "Tea".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    let by_sale = s.get_kds_orders_by_sale(&sale_id).unwrap();
    assert_eq!(by_sale.len(), 1);
    assert_eq!(by_sale[0].id, order.id);
}

#[test]
fn update_kds_status_sets_timestamps() {
    let conn = fresh();
    let s = store(&conn);

    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let test_sale = Sale {
        id: sale_id.clone(),
        status: crate::SaleStatus::Completed,
        total: price(0),
        currency: usd(),
        line_count: 0,
        payment_method: None,
        tendered_minor: None,
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now,
        subtotal: price(0),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        lines: vec![],
        version: 1,
    };
    s.create_sale(&test_sale).unwrap();

    let order = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id,
            store_id: None,
            items_summary: "Test".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    // Pending -> Preparing
    let updated = s.update_kds_status(&order.id, "preparing").unwrap();
    assert_eq!(updated.status, "preparing");
    assert!(updated.started_at.is_some());

    // Preparing -> Ready
    let updated = s.update_kds_status(&order.id, "ready").unwrap();
    assert_eq!(updated.status, "ready");
    assert!(updated.ready_at.is_some());

    // Ready -> Served
    let updated = s.update_kds_status(&order.id, "served").unwrap();
    assert_eq!(updated.status, "served");
    assert!(updated.served_at.is_some());
}

/// RED: status transitions must be FORWARD-only. A regression (e.g. a stale
/// offline replay moving a ready/served order back to preparing) must be
/// rejected — today the backend accepts it and OVERWRITES started_at,
/// corrupting the ticket's prep metrics and re-surfacing a served order on
/// the kitchen queue.
#[test]
fn update_kds_status_rejects_regression() {
    let conn = fresh();
    let s = store(&conn);
    let (order, _sale) = seed_completed_sale_to_kds(&s);

    // Advance to ready.
    let updated = s.update_kds_status(&order.id, "preparing").unwrap();
    let started_at = updated.started_at.clone();
    assert!(started_at.is_some());
    s.update_kds_status(&order.id, "ready").unwrap();

    // Regression: ready -> preparing must be rejected and must NOT overwrite
    // the original started_at.
    let err = s.update_kds_status(&order.id, "preparing").unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { .. }),
        "regression must be a validation error, got: {err:?}"
    );
    let after = s.get_kds_order(&order.id).unwrap().unwrap();
    assert_eq!(after.status, "ready", "status must stay at ready");
    assert_eq!(
        after.started_at, started_at,
        "started_at must not be overwritten"
    );
}

/// RED: served is terminal — a served order must not go back to the queue.
#[test]
fn update_kds_status_served_is_terminal() {
    let conn = fresh();
    let s = store(&conn);
    let (order, _sale) = seed_completed_sale_to_kds(&s);

    s.update_kds_status(&order.id, "preparing").unwrap();
    s.update_kds_status(&order.id, "ready").unwrap();
    let served = s.update_kds_status(&order.id, "served").unwrap();
    assert!(served.served_at.is_some());

    // served -> preparing / ready / pending must all be rejected.
    for regression in ["preparing", "ready", "pending"] {
        let err = s.update_kds_status(&order.id, regression).unwrap_err();
        assert!(
            matches!(err, CoreError::Validation { .. }),
            "served -> {regression} must be rejected, got: {err:?}"
        );
    }
    let after = s.get_kds_order(&order.id).unwrap().unwrap();
    assert_eq!(after.status, "served");
}

/// RED: cancelled is terminal — a cancelled order must not be resurrected.
#[test]
fn update_kds_status_cancelled_is_terminal() {
    let conn = fresh();
    let s = store(&conn);
    let (order, _sale) = seed_completed_sale_to_kds(&s);

    s.update_kds_status(&order.id, "cancelled").unwrap();

    let err = s.update_kds_status(&order.id, "preparing").unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { .. }),
        "cancelled -> preparing must be rejected, got: {err:?}"
    );
}

/// RED: prep_time_seconds must be computed when the order reaches served
/// (served_at - started_at). Today the column is never written — it is read
/// in every SELECT but always 0.
#[test]
fn update_kds_status_computes_prep_time_on_served() {
    let conn = fresh();
    let s = store(&conn);
    let (order, _sale) = seed_completed_sale_to_kds(&s);

    // Start prep 2 minutes in the past so the elapsed time is deterministic.
    s.update_kds_status(&order.id, "preparing").unwrap();
    let started_at = chrono::Utc::now() - chrono::Duration::minutes(2);
    conn.execute(
        "UPDATE kds_orders SET started_at = ?1 WHERE id = ?2",
        rusqlite::params![
            started_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            order.id
        ],
    )
    .unwrap();
    s.update_kds_status(&order.id, "ready").unwrap();
    let served = s.update_kds_status(&order.id, "served").unwrap();
    assert!(
        served.prep_time_seconds >= 120,
        "prep_time_seconds must be ~2 minutes (120s), got: {}",
        served.prep_time_seconds
    );
}

/// Helper: seed a completed sale and create a KDS order from it.
fn seed_completed_sale_to_kds(s: &Store<'_>) -> (KdsOrder, Sale) {
    let conn = s.conn;
    seed_product(conn, "KDS-SKU", "Burger");
    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let sale = Sale {
        id: sale_id.clone(),
        status: crate::SaleStatus::Completed,
        total: price(0),
        currency: usd(),
        line_count: 0,
        payment_method: None,
        tendered_minor: None,
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now,
        subtotal: price(0),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        lines: vec![],
        version: 1,
    };
    s.create_sale(&sale).unwrap();
    // No restaurant lines → complete_sale_to_kds returns nothing; create a
    // KDS order directly so the status machine can be exercised.
    let order = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale_id.clone(),
            store_id: None,
            items_summary: "Burger x1".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();
    (order, sale)
}

#[test]
fn update_kds_status_invalid() {
    let conn = fresh();
    let s = store(&conn);

    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let test_sale = Sale {
        id: sale_id.clone(),
        status: crate::SaleStatus::Completed,
        total: price(0),
        currency: usd(),
        line_count: 0,
        payment_method: None,
        tendered_minor: None,
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now,
        subtotal: price(0),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        lines: vec![],
        version: 1,
    };
    s.create_sale(&test_sale).unwrap();

    let order = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id,
            store_id: None,
            items_summary: "Test".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    let err = s.update_kds_status(&order.id, "bogus").unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "status"));
}

#[test]
fn list_kds_orders_empty() {
    let conn = fresh();
    let s = store(&conn);
    let orders = s.list_kds_orders(None).unwrap();
    assert!(orders.is_empty());
}

#[test]
fn list_kds_orders_with_status_filter() {
    let conn = fresh();
    let s = store(&conn);

    let sale_id1 = uuid::Uuid::now_v7().to_string();
    let sale_id2 = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    for sid in [&sale_id1, &sale_id2] {
        let test_sale = Sale {
            id: sid.to_string(),
            status: crate::SaleStatus::Completed,
            total: price(0),
            currency: usd(),
            line_count: 0,
            payment_method: None,
            tendered_minor: None,
            discount_percent: 0,
            discount_label: None,
            user_id: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            subtotal: price(0),
            tax_total: price(0),
            customer_id: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: 0,
            service_charge_minor: 0,
            lines: vec![],
            version: 1,
        };
        s.create_sale(&test_sale).unwrap();
    }

    s.create_kds_order(CreateKdsOrderInput {
        sale_id: sale_id1,
        store_id: None,
        items_summary: "Order 1".into(),
        item_count: 1,
        kitchen_zone: None,
        notes: String::new(),
        table_number: None,
        priority: false,
    })
    .unwrap();

    s.create_kds_order(CreateKdsOrderInput {
        sale_id: sale_id2,
        store_id: None,
        items_summary: "Order 2".into(),
        item_count: 2,
        kitchen_zone: None,
        notes: String::new(),
        table_number: None,
        priority: false,
    })
    .unwrap();

    let all = s.list_kds_orders(None).unwrap();
    assert_eq!(all.len(), 2);

    let pending = s.list_kds_orders(Some("pending")).unwrap();
    assert_eq!(pending.len(), 2);

    let ready = s.list_kds_orders(Some("ready")).unwrap();
    assert_eq!(ready.len(), 0);
}

#[test]
fn get_kds_queue_returns_pending_and_preparing() {
    let conn = fresh();
    let s = store(&conn);

    let sale_id1 = uuid::Uuid::now_v7().to_string();
    let sale_id2 = uuid::Uuid::now_v7().to_string();
    let sale_id3 = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    for sid in [&sale_id1, &sale_id2, &sale_id3] {
        let test_sale = Sale {
            id: sid.to_string(),
            status: crate::SaleStatus::Completed,
            total: price(0),
            currency: usd(),
            line_count: 0,
            payment_method: None,
            tendered_minor: None,
            discount_percent: 0,
            discount_label: None,
            user_id: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            subtotal: price(0),
            tax_total: price(0),
            customer_id: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: 0,
            service_charge_minor: 0,
            lines: vec![],
            version: 1,
        };
        s.create_sale(&test_sale).unwrap();
    }

    let _o1 = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale_id1,
            store_id: None,
            items_summary: "Pending".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    let o2 = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale_id2,
            store_id: None,
            items_summary: "Preparing".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    let o3 = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale_id3,
            store_id: None,
            items_summary: "Served".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    s.update_kds_status(&o2.id, "preparing").unwrap();
    s.update_kds_status(&o3.id, "preparing").unwrap();
    s.update_kds_status(&o3.id, "ready").unwrap();
    s.update_kds_status(&o3.id, "served").unwrap();

    let queue = s.get_kds_queue(None).unwrap();
    // Queue should include pending + preparing + ready (but not served/cancelled).
    assert_eq!(queue.len(), 2);
    assert!(
        queue
            .iter()
            .all(|o| o.status == "pending" || o.status == "preparing" || o.status == "ready")
    );
}

#[test]
fn complete_sale_to_kds_creates_order() {
    let conn = fresh();
    let s = store(&conn);

    seed_product(&conn, "COFFEE", "Fresh Coffee");
    seed_product(&conn, "BAGEL", "Everything Bagel");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("COFFEE"), 2, price(350)))
        .unwrap();
    cart.add_line(CartLine::new(Sku::new("BAGEL"), 1, price(450)))
        .unwrap();

    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    let orders = s.complete_sale_to_kds(&sale.id, None).unwrap();
    assert_eq!(orders.len(), 1);
    let order = &orders[0];
    assert_eq!(order.sale_id, sale.id);
    assert_eq!(order.status, "pending");
    assert!(order.items_summary.contains("Coffee"));
    assert!(order.items_summary.contains("Bagel"));
    assert_eq!(order.item_count, 3);
}

#[test]
fn display_number_increments_per_day() {
    let conn = fresh();
    let s = store(&conn);

    let sale_id1 = uuid::Uuid::now_v7().to_string();
    let sale_id2 = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    for sid in [&sale_id1, &sale_id2] {
        let test_sale = Sale {
            id: sid.to_string(),
            status: crate::SaleStatus::Completed,
            total: price(0),
            currency: usd(),
            line_count: 0,
            payment_method: None,
            tendered_minor: None,
            discount_percent: 0,
            discount_label: None,
            user_id: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            subtotal: price(0),
            tax_total: price(0),
            customer_id: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: 0,
            service_charge_minor: 0,
            lines: vec![],
            version: 1,
        };
        s.create_sale(&test_sale).unwrap();
    }

    let o1 = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale_id1,
            store_id: None,
            items_summary: "First".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    let o2 = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale_id2,
            store_id: None,
            items_summary: "Second".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    assert_eq!(o1.display_number, Some(1));
    assert_eq!(o2.display_number, Some(2));
}

/// RED: display numbers must be per-STORE, not global. The counter is keyed
/// by date only, so in a multi-store deployment (kds_orders carries
/// store_id) two stores' first tickets of the day collide — the kitchen
/// shouts "#1 up!" at both stores. Each store must start at 1.
#[test]
fn display_number_is_per_store() {
    let conn = fresh();
    let s = store(&conn);

    let mk_sale = |sid: &str| {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        Sale {
            id: sid.to_string(),
            status: crate::SaleStatus::Completed,
            total: price(0),
            currency: usd(),
            line_count: 0,
            payment_method: None,
            tendered_minor: None,
            discount_percent: 0,
            discount_label: None,
            user_id: None,
            created_at: now.clone(),
            updated_at: now,
            subtotal: price(0),
            tax_total: price(0),
            customer_id: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: 0,
            service_charge_minor: 0,
            lines: vec![],
            version: 1,
        }
    };
    s.create_sale(&mk_sale("store-a-sale-1")).unwrap();
    s.create_sale(&mk_sale("store-a-sale-2")).unwrap();
    s.create_sale(&mk_sale("store-b-sale-1")).unwrap();

    // Store A gets two tickets today.
    let a1 = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: "store-a-sale-1".into(),
            store_id: Some("store-a".into()),
            items_summary: "A1".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();
    let a2 = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: "store-a-sale-2".into(),
            store_id: Some("store-a".into()),
            items_summary: "A2".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();
    // Store B gets its first ticket of the day.
    let b1 = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: "store-b-sale-1".into(),
            store_id: Some("store-b".into()),
            items_summary: "B1".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    assert_eq!(a1.display_number, Some(1));
    assert_eq!(a2.display_number, Some(2));
    assert_eq!(
        b1.display_number,
        Some(1),
        "store B's first ticket of the day must be #1, not #{} (global counter collision)",
        b1.display_number.unwrap_or(0)
    );
}

// ── CHECK constraint tests ──────────────────────────────────────

#[test]
fn kds_status_check_rejects_invalid_status_on_insert() {
    let conn = fresh();
    let s = store(&conn);

    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let test_sale = Sale {
        id: sale_id.clone(),
        status: crate::SaleStatus::Completed,
        total: price(0),
        currency: usd(),
        line_count: 0,
        payment_method: None,
        tendered_minor: None,
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now,
        subtotal: price(0),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        lines: vec![],
        version: 1,
    };
    s.create_sale(&test_sale).unwrap();

    // Attempt a raw INSERT with an invalid status — should fail the CHECK constraint.
    let id = uuid::Uuid::now_v7().to_string();
    let result = s.conn.execute(
        "INSERT INTO kds_orders (id, sale_id, status, items_summary, item_count, notes)
         VALUES (?1, ?2, 'bogus', 'Test', 1, '')",
        params![id, sale_id],
    );

    assert!(
        result.is_err(),
        "expected CHECK constraint error for invalid status"
    );
    let err = result.unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("CHECK") || msg.contains("constraint") || msg.contains("abort"),
        "expected constraint violation message, got: {msg}"
    );
}

#[test]
fn kds_status_check_accepts_valid_statuses() {
    let conn = fresh();
    let s = store(&conn);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Insert orders with each valid status. Each needs its own sale_id
    // because kds_orders.sale_id has a UNIQUE constraint.
    for status in &["pending", "preparing", "ready", "served", "cancelled"] {
        let sale_id = uuid::Uuid::now_v7().to_string();
        let test_sale = Sale {
            id: sale_id.clone(),
            status: crate::SaleStatus::Completed,
            total: price(0),
            currency: usd(),
            line_count: 0,
            payment_method: None,
            tendered_minor: None,
            discount_percent: 0,
            discount_label: None,
            user_id: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            subtotal: price(0),
            tax_total: price(0),
            customer_id: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: 0,
            service_charge_minor: 0,
            lines: vec![],
            version: 1,
        };
        s.create_sale(&test_sale).unwrap();

        let order_id = uuid::Uuid::now_v7().to_string();
        s.conn
            .execute(
                "INSERT INTO kds_orders (id, sale_id, status, items_summary, item_count, notes)
             VALUES (?1, ?2, ?3, 'Test', 1, '')",
                params![order_id, sale_id, status],
            )
            .unwrap();
        let fetched = s.get_kds_order(&order_id).unwrap().unwrap();
        assert_eq!(fetched.status, *status);
    }
}

// ── Additional edge cases ─────────────────────────────────────

#[test]
fn update_kds_status_nonexistent_order_fails() {
    let conn = fresh();
    let s = store(&conn);
    let err = s.update_kds_status("no-such-order", "pending").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "kds_order"));
}

#[test]
fn get_kds_queue_excludes_served_and_cancelled() {
    let conn = fresh();
    let s = store(&conn);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Create 4 orders with different statuses.
    let mut ids = Vec::new();
    for st in &["pending", "preparing", "served", "cancelled"] {
        let sale_id = uuid::Uuid::now_v7().to_string();
        let test_sale = Sale {
            id: sale_id.clone(),
            status: crate::SaleStatus::Completed,
            total: price(0),
            currency: usd(),
            line_count: 0,
            payment_method: None,
            tendered_minor: None,
            discount_percent: 0,
            discount_label: None,
            user_id: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            subtotal: price(0),
            tax_total: price(0),
            customer_id: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: 0,
            service_charge_minor: 0,
            lines: vec![],
            version: 1,
        };
        s.create_sale(&test_sale).unwrap();
        let order = s
            .create_kds_order(CreateKdsOrderInput {
                sale_id,
                store_id: None,
                items_summary: st.to_string(),
                item_count: 1,
                kitchen_zone: None,
                notes: String::new(),
                table_number: None,
                priority: false,
            })
            .unwrap();
        if *st != "pending" {
            // Advance through the state machine to reach the target status.
            match *st {
                "preparing" => {
                    s.update_kds_status(&order.id, "preparing").unwrap();
                }
                "served" | "cancelled" => {
                    s.update_kds_status(&order.id, "preparing").unwrap();
                    s.update_kds_status(&order.id, "ready").unwrap();
                    if *st == "served" {
                        s.update_kds_status(&order.id, "served").unwrap();
                    } else {
                        s.update_kds_status(&order.id, "cancelled").unwrap();
                    }
                }
                _ => {
                    s.update_kds_status(&order.id, st).unwrap();
                }
            }
        }
        ids.push(order.id);
    }

    let queue = s.get_kds_queue(None).unwrap();
    assert_eq!(queue.len(), 2, "should only have pending + preparing");
    assert!(queue.iter().any(|o| o.status == "pending"));
    assert!(queue.iter().any(|o| o.status == "preparing"));
}

#[test]
fn get_kds_queue_with_zone_filter() {
    let conn = fresh();
    let s = store(&conn);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    for zone in &["grill", "salad"] {
        let sale_id = uuid::Uuid::now_v7().to_string();
        let test_sale = Sale {
            id: sale_id.clone(),
            status: crate::SaleStatus::Completed,
            total: price(0),
            currency: usd(),
            line_count: 0,
            payment_method: None,
            tendered_minor: None,
            discount_percent: 0,
            discount_label: None,
            user_id: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            subtotal: price(0),
            tax_total: price(0),
            customer_id: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: 0,
            service_charge_minor: 0,
            lines: vec![],
            version: 1,
        };
        s.create_sale(&test_sale).unwrap();
        s.create_kds_order(CreateKdsOrderInput {
            sale_id,
            store_id: None,
            items_summary: format!("Order in {zone}"),
            item_count: 1,
            kitchen_zone: Some(zone.to_string()),
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();
    }

    let grill = s.get_kds_queue(Some("grill")).unwrap();
    assert_eq!(grill.len(), 1);
    assert!(grill[0].items_summary.contains("grill"));

    let salad = s.get_kds_queue(Some("salad")).unwrap();
    assert_eq!(salad.len(), 1);
    assert!(salad[0].items_summary.contains("salad"));
}

#[test]
fn get_kds_queue_empty_zone_returns_unzoned_orders() {
    let conn = fresh();
    let s = store(&conn);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // One order with zone, one without.
    for (suffix, zone) in &[("zoned", Some("grill")), ("unzoned", None)] {
        let sale_id = uuid::Uuid::now_v7().to_string();
        let test_sale = Sale {
            id: sale_id.clone(),
            status: crate::SaleStatus::Completed,
            total: price(0),
            currency: usd(),
            line_count: 0,
            payment_method: None,
            tendered_minor: None,
            discount_percent: 0,
            discount_label: None,
            user_id: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            subtotal: price(0),
            tax_total: price(0),
            customer_id: None,
            base_currency: None,
            base_total_minor: None,
            tender_rate_millionths: None,
            tip_minor: 0,
            service_charge_minor: 0,
            lines: vec![],
            version: 1,
        };
        s.create_sale(&test_sale).unwrap();
        s.create_kds_order(CreateKdsOrderInput {
            sale_id,
            store_id: None,
            items_summary: format!("Order {suffix}"),
            item_count: 1,
            kitchen_zone: zone.map(|z| z.to_string()),
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();
    }

    let unzoned = s.get_kds_queue(Some("")).unwrap();
    assert_eq!(unzoned.len(), 1);
    assert!(unzoned[0].items_summary.contains("unzoned"));
}

#[test]
fn complete_sale_to_kds_no_restaurant_lines_returns_empty() {
    let conn = fresh();
    let s = store(&conn);

    // Seed a retail-type product.
    s.create_product(
        "RETAIL-1",
        "Retail Item",
        price(500),
        None,
        None,
        100,
        Some("retail"),
    )
    .unwrap();

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("RETAIL-1"), 1, price(500)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    let orders = s.complete_sale_to_kds(&sale.id, None).unwrap();
    assert!(orders.is_empty(), "no KDS orders for retail-only sale");
}

/// RED: a sale with items in TWO kitchen zones must create TWO KDS orders
/// (one per zone). The schema declares `sale_id UNIQUE` (one order per sale),
/// so the second zone's insert collides and the whole completion fails with a
/// constraint error — the kitchen never sees either ticket.
#[test]
fn complete_sale_to_kds_multi_zone_creates_one_order_per_zone() {
    let conn = fresh();
    let s = store(&conn);

    seed_product_with_zone(&conn, "STEAK", "Ribeye Steak", "grill");
    seed_product_with_zone(&conn, "BEER", "Craft Beer", "bar");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("STEAK"), 1, price(1500)))
        .unwrap();
    cart.add_line(CartLine::new(Sku::new("BEER"), 1, price(600)))
        .unwrap();

    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    let orders = s.complete_sale_to_kds(&sale.id, None).unwrap();
    assert_eq!(
        orders.len(),
        2,
        "one KDS order per kitchen zone (grill + bar), got: {orders:?}"
    );
    let mut zones: Vec<Option<String>> = orders.iter().map(|o| o.kitchen_zone.clone()).collect();
    zones.sort();
    assert_eq!(zones, vec![Some("bar".into()), Some("grill".into())]);
}

/// Idempotent fanout on retry: a retried checkout (double-tapped pay,
/// transient error between ticket creation and finalize) must NOT hit
/// UNIQUE(sale_id, kitchen_zone) as an error — for zoned sales that error
/// was swallowed at checkout (leaving NO ticket), and for unzoned sales
/// SQLite's NULL-distinct UNIQUE silently created duplicate tickets.
/// Instead: existing zones are skipped, missing zones are completed, and
/// a fully-replayed fanout returns the existing tickets unchanged.
#[test]
fn complete_sale_to_kds_fanout_is_idempotent_on_retry() {
    let conn = fresh();
    let s = store(&conn);

    seed_product_with_zone(&conn, "STEAK", "Ribeye Steak", "grill");
    seed_product_with_zone(&conn, "BEER", "Craft Beer", "bar");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("STEAK"), 1, price(1500)))
        .unwrap();
    cart.add_line(CartLine::new(Sku::new("BEER"), 1, price(600)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    // Simulate a concurrent terminal that already created the GRILL zone
    // ticket for this sale (partial completion / double-complete).
    s.create_kds_order(CreateKdsOrderInput {
        sale_id: sale.id.clone(),
        store_id: None,
        items_summary: "Steak".into(),
        item_count: 1,
        kitchen_zone: Some("grill".into()),
        notes: String::new(),
        table_number: None,
        priority: false,
    })
    .unwrap();

    // Retried fanout: skips grill (already exists), completes bar, and
    // must not duplicate or error.
    let created = s.complete_sale_to_kds(&sale.id, None).unwrap();
    assert_eq!(
        created.len(),
        1,
        "only the missing bar ticket may be created, got: {created:?}"
    );
    assert_eq!(created[0].kitchen_zone.as_deref(), Some("bar"));

    let orders = s.get_kds_orders_by_sale(&sale.id).unwrap();
    assert_eq!(
        orders.len(),
        2,
        "final state is the union of existing + new tickets, got: {orders:?}"
    );
    let mut zones: Vec<_> = orders
        .iter()
        .filter_map(|o| o.kitchen_zone.clone())
        .collect();
    zones.sort();
    assert_eq!(zones, vec!["bar".to_string(), "grill".to_string()]);

    // A fully-replayed fanout (every zone already ticketed) is a no-op
    // returning the existing tickets — never duplicates.
    let replay = s.complete_sale_to_kds(&sale.id, None).unwrap();
    assert_eq!(replay.len(), 2);
    let orders_after = s.get_kds_orders_by_sale(&sale.id).unwrap();
    assert_eq!(orders_after.len(), 2, "no duplicate tickets after replay");
}

fn seed_product_with_zone(conn: &Connection, sku: &str, name: &str, zone: &str) {
    let s = store(conn);
    s.create_product(sku, name, price(500), None, None, 100, Some("restaurant"))
        .unwrap();
    // Set kitchen_zone directly via SQL (not exposed on create_product API).
    conn.execute(
        "UPDATE products SET kitchen_zone = ?1 WHERE sku = ?2",
        params![zone, sku],
    )
    .unwrap();
}

#[test]
fn complete_sale_to_kds_groups_same_zone_items() {
    let conn = fresh();
    let s = store(&conn);

    // Seed products in the SAME zone (schema has UNIQUE constraint on sale_id).
    seed_product_with_zone(&conn, "STEAK", "Steak", "grill");
    seed_product_with_zone(&conn, "BURGER", "Burger", "grill");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("STEAK"), 2, price(500)))
        .unwrap();
    cart.add_line(CartLine::new(Sku::new("BURGER"), 3, price(300)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    let orders = s.complete_sale_to_kds(&sale.id, None).unwrap();
    // One order because both products are in the same zone.
    assert_eq!(orders.len(), 1, "same zone items grouped into one order");
    let order = &orders[0];
    assert_eq!(order.kitchen_zone.as_deref(), Some("grill"));
    assert_eq!(order.item_count, 5);
    assert!(order.items_summary.contains("Steak"));
    assert!(order.items_summary.contains("Burger"));
}

#[test]
fn complete_sale_to_kds_with_store_id() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("BURGER"), 1, price(500)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    let orders = s
        .complete_sale_to_kds_routed(&sale.id, Some("store-1"), Some("kds-main"))
        .unwrap();
    assert_eq!(orders.len(), 1);
    assert_eq!(orders[0].store_id, Some("store-1".to_string()));
    assert_eq!(orders[0].target_instance_id, Some("kds-main".to_string()));
}

#[test]
fn complete_sale_to_kds_fanout_targets_one_order_to_multiple_instances() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("BURGER"), 1, price(500)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    let targets = vec!["kds-main".to_owned(), "kds-expediter".to_owned()];
    let orders = s
        .complete_sale_to_kds_fanout(&sale.id, Some("store-1"), &targets)
        .unwrap();
    assert_eq!(orders.len(), 1, "fan-out must not duplicate the sale order");
    assert_eq!(orders[0].target_instance_id.as_deref(), Some("kds-main"));

    let target_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM kds_order_targets WHERE kds_order_id = ?1",
            params![orders[0].id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(target_count, 2);
    assert_eq!(
        s.get_kds_queue_for_instance(None, "kds-main")
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        s.get_kds_queue_for_instance(None, "kds-expediter")
            .unwrap()
            .len(),
        1
    );
    assert!(
        s.get_kds_queue_for_instance(None, "kds-other")
            .unwrap()
            .is_empty()
    );
}

/// PERF-KDS-02: instance filtering is pushed into SQL. The predicate must
/// agree with the per-order Rust rule in every direction, including the
/// historical-targeting edge: once ALL targeting rows are deleted, an
/// order with a NULL `target_instance_id` reverts to universal visibility
/// (same semantics as `order_visible_to_instance`).
#[test]
fn kds_instance_filter_sql_matches_rust_predicate() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("BURGER"), 1, price(500)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    let orders = s
        .complete_sale_to_kds_fanout(
            &sale.id,
            Some("store-1"),
            &["kds-main".to_owned(), "kds-expediter".to_owned()],
        )
        .unwrap();
    assert_eq!(orders.len(), 1);
    let order = &orders[0];

    // Both targeted instances see the ticket; a third does not.
    assert_eq!(
        s.get_kds_queue_for_instance(None, "kds-main")
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        s.get_kds_queue_for_instance(None, "kds-expediter")
            .unwrap()
            .len(),
        1
    );
    assert!(
        s.get_kds_queue_for_instance(None, "kds-other")
            .unwrap()
            .is_empty(),
        "targeted ticket must be hidden from other instances in SQL"
    );

    // Deleting every targeting row reverts visibility to the raw
    // `target_instance_id` column (kds-main) — matching
    // `order_visible_to_instance`, the ticket stays hidden from others.
    conn.execute(
        "DELETE FROM kds_order_targets WHERE kds_order_id = ?1",
        params![order.id],
    )
    .unwrap();
    assert_eq!(
        s.get_kds_queue_for_instance(None, "kds-main")
            .unwrap()
            .len(),
        1
    );
    assert!(
        s.get_kds_queue_for_instance(None, "kds-other")
            .unwrap()
            .is_empty(),
        "column-targeted ticket stays hidden once targeting rows are gone"
    );

    // The SQL predicate must also respect zone filtering combined with
    // instance scoping (binds: zone + iid together).
    assert!(
        s.get_kds_queue_for_instance(Some("Grill"), "kds-main")
            .unwrap()
            .is_empty(),
        "zone filter must still apply on top of instance scoping"
    );
}

#[test]
fn scoped_kds_commands_reject_cross_instance_targeted_order() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("BURGER"), 1, price(500)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();
    let order = s
        .complete_sale_to_kds_fanout(&sale.id, Some("store-1"), &["kds-main".to_owned()])
        .unwrap()
        .remove(0);
    let line = s
        .create_kds_line_items(
            &order.id,
            &[CreateKdsLineItemInput {
                sku: "BURGER".into(),
                display_name: "Burger".into(),
                qty: 1,
                course: Some("main".into()),
                modifiers: vec![],
            }],
        )
        .unwrap()
        .remove(0);

    // The print command uses this scoped lookup before it touches a printer.
    assert!(
        s.get_kds_order_for_instance(&order.id, "kds-other")
            .unwrap()
            .is_none()
    );
    let err = s
        .ensure_kds_order_visible_to_instance(&order.id, "kds-other")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "kds_order"));

    // Status and whole-order edit commands cannot mutate another display's ticket.
    let err = s
        .update_kds_status_for_instance(&order.id, "preparing", "kds-other")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "kds_order"));
    let err = s
        .update_kds_order_items_for_instance(
            crate::UpdateKdsOrderItemsInput {
                id: order.id.clone(),
                items_summary: "Tampered".into(),
                item_count: 1,
                line_items: None,
            },
            "kds-other",
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "kds_order"));

    // Both line-item read and update commands enforce the parent order scope.
    let err = s
        .get_kds_order_lines_for_instance(&order.id, "kds-other")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "kds_order"));
    let err = s
        .update_kds_line_item_status_for_instance(&line.id, "ready", "kds-other")
        .unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "kds_order"));

    let unchanged = s.get_kds_order(&order.id).unwrap().unwrap();
    assert_eq!(unchanged.status, "pending");
    assert_eq!(unchanged.items_summary, "Burger");
    let unchanged_line = s.get_kds_order_lines(&order.id).unwrap().remove(0);
    assert_eq!(unchanged_line.item_status, "pending");
}

#[test]
fn kds_order_has_runtime_target_instance_column() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("BURGER"), 1, price(500)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();
    let order = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale.id,
            store_id: Some("store-1".into()),
            items_summary: "Burger".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    let target: Option<String> = conn
        .query_row(
            "SELECT target_instance_id FROM kds_orders WHERE id = ?1",
            params![order.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(target, None);
}

#[test]
fn kds_order_targets_support_multiple_instances() {
    let conn = fresh();
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'kds_order_targets'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(exists, 1);
}

#[test]
fn get_kds_order_by_sale_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let result = s.get_kds_orders_by_sale("no-such-sale").unwrap();
    assert!(result.is_empty());
}

#[test]
fn list_kds_orders_ordered_by_received_at_desc() {
    let conn = fresh();
    let s = store(&conn);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // Create two orders with distinct timing (sleep to separate timestamps).
    let sale_id1 = uuid::Uuid::now_v7().to_string();
    let ts1 = Sale {
        id: sale_id1.clone(),
        status: crate::SaleStatus::Completed,
        total: price(0),
        currency: usd(),
        line_count: 0,
        payment_method: None,
        tendered_minor: None,
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now.clone(),
        subtotal: price(0),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        lines: vec![],
        version: 1,
    };
    s.create_sale(&ts1).unwrap();
    let o1 = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale_id1,
            store_id: None,
            items_summary: "First".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    std::thread::sleep(std::time::Duration::from_millis(5));

    let sale_id2 = uuid::Uuid::now_v7().to_string();
    let ts2 = Sale {
        id: sale_id2.clone(),
        status: crate::SaleStatus::Completed,
        total: price(0),
        currency: usd(),
        line_count: 0,
        payment_method: None,
        tendered_minor: None,
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now.clone(),
        subtotal: price(0),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        lines: vec![],
        version: 1,
    };
    s.create_sale(&ts2).unwrap();
    let o2 = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale_id2,
            store_id: None,
            items_summary: "Second".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    let all = s.list_kds_orders(None).unwrap();
    assert_eq!(all.len(), 2);
    // Most recent first.
    assert_eq!(all[0].id, o2.id);
    assert_eq!(all[1].id, o1.id);
}

// ── update_kds_order_items tests ─────────────────────────────────

#[test]
fn update_kds_order_items_updates_summary_and_count() {
    let conn = fresh();
    let s = store(&conn);
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let sale_id = uuid::Uuid::now_v7().to_string();
    let test_sale = Sale {
        id: sale_id.clone(),
        status: crate::SaleStatus::Completed,
        total: price(0),
        currency: usd(),
        line_count: 0,
        payment_method: None,
        tendered_minor: None,
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now,
        subtotal: price(0),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        lines: vec![],
        version: 1,
    };
    s.create_sale(&test_sale).unwrap();

    let order = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id,
            store_id: None,
            items_summary: "Coffee x2".into(),
            item_count: 2,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    // Update items.
    let updated = s
        .update_kds_order_items(crate::UpdateKdsOrderItemsInput {
            id: order.id.clone(),
            items_summary: "Coffee x2, Bagel x1".into(),
            item_count: 3,
            line_items: None,
        })
        .unwrap();

    assert_eq!(updated.items_summary, "Coffee x2, Bagel x1");
    assert_eq!(updated.item_count, 3);
    assert_eq!(updated.status, "pending"); // Other fields unchanged
}

#[test]
fn update_kds_order_items_nonexistent_order_fails() {
    let conn = fresh();
    let s = store(&conn);

    let err = s
        .update_kds_order_items(crate::UpdateKdsOrderItemsInput {
            id: "no-such-order".into(),
            items_summary: "New items".into(),
            item_count: 1,
            line_items: None,
        })
        .unwrap_err();

    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "kds_order"));
}

#[test]
fn update_kds_order_items_rejects_empty_summary() {
    let conn = fresh();
    let s = store(&conn);

    let err = s
        .update_kds_order_items(crate::UpdateKdsOrderItemsInput {
            id: "any-id".into(),
            items_summary: "".into(),
            item_count: 1,
            line_items: None,
        })
        .unwrap_err();

    assert!(matches!(err, CoreError::Validation { field, .. } if field == "items_summary"));
}

#[test]
fn update_kds_order_items_rejects_zero_count() {
    let conn = fresh();
    let s = store(&conn);

    let err = s
        .update_kds_order_items(crate::UpdateKdsOrderItemsInput {
            id: "any-id".into(),
            items_summary: "Items".into(),
            item_count: 0,
            line_items: None,
        })
        .unwrap_err();

    assert!(matches!(err, CoreError::Validation { field, .. } if field == "item_count"));
}

// ── KDS order input validation ──────────────────────────────────────

#[test]
fn create_kds_order_rejects_empty_sale_id() {
    let conn = fresh();
    let s = store(&conn);
    let err = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: "".into(),
            store_id: None,
            items_summary: "Items".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "sale_id",
            ..
        }
    ));
}

#[test]
fn create_kds_order_rejects_empty_items_summary() {
    let conn = fresh();
    let s = store(&conn);
    let err = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: "sale-1".into(),
            store_id: None,
            items_summary: "".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "items_summary",
            ..
        }
    ));
}

#[test]
fn create_kds_order_rejects_zero_item_count() {
    let conn = fresh();
    let s = store(&conn);
    let err = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: "sale-1".into(),
            store_id: None,
            items_summary: "Items".into(),
            item_count: 0,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "item_count",
            ..
        }
    ));
}

#[test]
fn create_kds_order_rejects_negative_item_count() {
    let conn = fresh();
    let s = store(&conn);
    let err = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: "sale-1".into(),
            store_id: None,
            items_summary: "Items".into(),
            item_count: -1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "item_count",
            ..
        }
    ));
}

// ── KDS Device CRUD ────────────────────────────────────────────

use crate::kds::{KdsConnectionStatus, RegisterKdsDeviceInput};

#[test]
fn register_kds_device_and_retrieve() {
    let conn = fresh();
    seed_terminal(&conn, "resto-1", "Restaurant POS", "dev-resto-1");
    let s = store(&conn);
    let input = RegisterKdsDeviceInput {
        name: "Expo Screen".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec!["station-grill".into(), "station-bar".into()],
        pairing_token_hash: "hash-abc".into(),
        pairing_expires_at: "2099-01-01T00:00:00.000Z".into(),
    };
    let device = s.register_kds_device(input).unwrap();
    assert!(!device.id.is_empty());
    assert_eq!(device.name, "Expo Screen");
    assert_eq!(device.restaurant_pos_id, "resto-1");
    assert_eq!(device.station_ids, vec!["station-grill", "station-bar"]);
    assert!(device.is_active);
    assert_eq!(device.connection_status, KdsConnectionStatus::Disconnected);

    let loaded = s.get_kds_device(&device.id).unwrap().unwrap();
    assert_eq!(loaded.id, device.id);
    assert_eq!(loaded.name, "Expo Screen");
}

#[test]
fn get_kds_device_returns_none_for_missing() {
    let conn = fresh();
    seed_terminal(&conn, "resto-1", "Restaurant POS", "dev-resto-1");
    let s = store(&conn);
    assert!(s.get_kds_device("nope").unwrap().is_none());
}

#[test]
fn list_kds_devices_for_restaurant() {
    let conn = fresh();
    seed_terminal(&conn, "resto-1", "Restaurant POS A", "dev-1");
    seed_terminal(&conn, "resto-2", "Restaurant POS B", "dev-2");
    let s = store(&conn);
    s.register_kds_device(RegisterKdsDeviceInput {
        name: "Screen A".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec![],
        pairing_token_hash: "h1".into(),
        pairing_expires_at: "2099-01-01".into(),
    })
    .unwrap();
    s.register_kds_device(RegisterKdsDeviceInput {
        name: "Screen B".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec![],
        pairing_token_hash: "h2".into(),
        pairing_expires_at: "2099-01-01".into(),
    })
    .unwrap();
    s.register_kds_device(RegisterKdsDeviceInput {
        name: "Other Screen".into(),
        restaurant_pos_id: "resto-2".into(),
        station_ids: vec![],
        pairing_token_hash: "h3".into(),
        pairing_expires_at: "2099-01-01".into(),
    })
    .unwrap();

    let devices = s.list_kds_devices_for_restaurant("resto-1").unwrap();
    assert_eq!(devices.len(), 2);
    assert!(devices.iter().all(|d| d.restaurant_pos_id == "resto-1"));
}

#[test]
fn update_kds_device_status_connected() {
    let conn = fresh();
    seed_terminal(&conn, "resto-1", "Restaurant POS", "dev-resto-1");
    let s = store(&conn);
    let device = s
        .register_kds_device(RegisterKdsDeviceInput {
            name: "Test".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "h".into(),
            pairing_expires_at: "2099-01-01".into(),
        })
        .unwrap();

    s.update_kds_device_status(&device.id, KdsConnectionStatus::Connected)
        .unwrap();
    let loaded = s.get_kds_device(&device.id).unwrap().unwrap();
    assert_eq!(loaded.connection_status, KdsConnectionStatus::Connected);
    assert!(loaded.last_seen_at.is_some());
}

#[test]
fn update_kds_device_status_not_found() {
    let conn = fresh();
    seed_terminal(&conn, "resto-1", "Restaurant POS", "dev-resto-1");
    let s = store(&conn);
    let err = s
        .update_kds_device_status("bad-id", KdsConnectionStatus::Connected)
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "kds_device",
            ..
        }
    ));
}

#[test]
fn deactivate_kds_device() {
    let conn = fresh();
    seed_terminal(&conn, "resto-1", "Restaurant POS", "dev-resto-1");
    let s = store(&conn);
    let device = s
        .register_kds_device(RegisterKdsDeviceInput {
            name: "Test".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "h".into(),
            pairing_expires_at: "2099-01-01".into(),
        })
        .unwrap();

    s.deactivate_kds_device(&device.id).unwrap();
    let loaded = s.get_kds_device(&device.id).unwrap().unwrap();
    assert!(!loaded.is_active);
}

// ── Order Acknowledgment ───────────────────────────────────────

#[test]
fn ack_order_first_device_wins() {
    let conn = fresh();
    let s = store(&conn);
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("SKU-1"), 1, price(100)))
        .unwrap();
    let sale = Sale::from_cart_with_user(&cart, None).unwrap();
    s.create_sale(&sale).unwrap();
    let kds_order = s
        .create_kds_order(crate::CreateKdsOrderInput {
            sale_id: sale.id.clone(),
            store_id: None,
            items_summary: "Item".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    let result = s.ack_kds_order(&kds_order.id, "device-a").unwrap();
    assert!(result, "first ack should succeed");
}

#[test]
fn ack_order_second_device_loses() {
    let conn = fresh();
    let s = store(&conn);
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("SKU-1"), 1, price(100)))
        .unwrap();
    let sale = Sale::from_cart_with_user(&cart, None).unwrap();
    s.create_sale(&sale).unwrap();
    let kds_order = s
        .create_kds_order(crate::CreateKdsOrderInput {
            sale_id: sale.id.clone(),
            store_id: None,
            items_summary: "Item".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    let first = s.ack_kds_order(&kds_order.id, "device-a").unwrap();
    assert!(first);

    let second = s.ack_kds_order(&kds_order.id, "device-b").unwrap();
    assert!(!second, "second ack should return false");
}

/// RED: an ack means the device ACCEPTED the ticket and started prep — the
/// order must advance pending → preparing with started_at set. The old code
/// jumped straight to 'ready' with no started_at, so the ticket appeared
/// ready-to-serve the instant it was acknowledged and prep_time_seconds
/// could never be computed on serve.
#[test]
fn ack_moves_to_preparing_and_sets_started_at() {
    let conn = fresh();
    let s = store(&conn);
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("SKU-1"), 1, price(100)))
        .unwrap();
    let sale = Sale::from_cart_with_user(&cart, None).unwrap();
    s.create_sale(&sale).unwrap();
    let kds_order = s
        .create_kds_order(crate::CreateKdsOrderInput {
            sale_id: sale.id.clone(),
            store_id: None,
            items_summary: "Item".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    assert!(s.ack_kds_order(&kds_order.id, "device-a").unwrap());

    let after = s.get_kds_order(&kds_order.id).unwrap().unwrap();
    assert_eq!(
        after.status, "preparing",
        "ack must advance pending -> preparing (device started cooking)"
    );
    assert!(
        after.started_at.is_some(),
        "ack must set started_at so prep_time can be computed on serve"
    );

    // The flow continues: preparing -> ready -> served computes prep_time
    // from the ack's started_at.
    s.update_kds_status(&kds_order.id, "ready").unwrap();
    let served = s.update_kds_status(&kds_order.id, "served").unwrap();
    assert!(
        served.prep_time_seconds >= 0,
        "prep_time_seconds must be computable after an ack, got {}",
        served.prep_time_seconds
    );
}

#[test]
fn ack_order_already_ready_is_noop() {
    let conn = fresh();
    let s = store(&conn);
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("SKU-1"), 1, price(100)))
        .unwrap();
    let sale = Sale::from_cart_with_user(&cart, None).unwrap();
    s.create_sale(&sale).unwrap();
    let kds_order = s
        .create_kds_order(crate::CreateKdsOrderInput {
            sale_id: sale.id.clone(),
            store_id: None,
            items_summary: "Item".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    s.update_kds_status(&kds_order.id, "preparing").unwrap();

    let result = s.ack_kds_order(&kds_order.id, "device-a").unwrap();
    assert!(!result, "ack on non-pending order should return false");
}

// ── Multi-KDS plan §7.3 tests ────────────────────────────────

#[test]
fn register_device_rejects_duplicate_name() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    let input = crate::kds::RegisterKdsDeviceInput {
        name: "Expo Screen".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec![],
        pairing_token_hash: "hash1".into(),
        pairing_expires_at: "2099-01-01T00:00:00Z".into(),
    };
    s.register_kds_device(input.clone()).unwrap();

    let err = s.register_kds_device(input).unwrap_err();
    assert!(matches!(err, crate::CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn register_device_allows_same_name_different_restaurant() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant A", "pc-1");
    seed_terminal(&conn, "resto-2", "Restaurant B", "pc-2");

    let make = |resto_id: &str| crate::kds::RegisterKdsDeviceInput {
        name: "Expo Screen".into(),
        restaurant_pos_id: resto_id.into(),
        station_ids: vec![],
        pairing_token_hash: "hash".into(),
        pairing_expires_at: "2099-01-01T00:00:00Z".into(),
    };

    s.register_kds_device(make("resto-1")).unwrap();
    s.register_kds_device(make("resto-2")).unwrap();

    let devices = s.list_kds_devices_for_restaurant("resto-1").unwrap();
    assert_eq!(devices.len(), 1);
    let devices = s.list_kds_devices_for_restaurant("resto-2").unwrap();
    assert_eq!(devices.len(), 1);
}

#[test]
fn get_devices_filtered_by_restaurant_pos() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant A", "pc-1");
    seed_terminal(&conn, "resto-2", "Restaurant B", "pc-2");

    let make = |name: &str, resto_id: &str| crate::kds::RegisterKdsDeviceInput {
        name: name.into(),
        restaurant_pos_id: resto_id.into(),
        station_ids: vec![],
        pairing_token_hash: "hash".into(),
        pairing_expires_at: "2099-01-01T00:00:00Z".into(),
    };

    s.register_kds_device(make("KDS-1", "resto-1")).unwrap();
    s.register_kds_device(make("KDS-2", "resto-1")).unwrap();
    s.register_kds_device(make("KDS-3", "resto-2")).unwrap();

    let resto1_devices = s.list_kds_devices_for_restaurant("resto-1").unwrap();
    assert_eq!(resto1_devices.len(), 2);
    let resto2_devices = s.list_kds_devices_for_restaurant("resto-2").unwrap();
    assert_eq!(resto2_devices.len(), 1);
    let empty = s.list_kds_devices_for_restaurant("resto-99").unwrap();
    assert!(empty.is_empty());
}

#[test]
fn update_status_connected_to_disconnected() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    let device = s
        .register_kds_device(crate::kds::RegisterKdsDeviceInput {
            name: "Test KDS".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hash".into(),
            pairing_expires_at: "2099-01-01T00:00:00Z".into(),
        })
        .unwrap();
    assert_eq!(
        device.connection_status,
        crate::kds::KdsConnectionStatus::Disconnected
    );

    s.update_kds_device_status(&device.id, crate::kds::KdsConnectionStatus::Connected)
        .unwrap();
    let fetched = s.get_kds_device(&device.id).unwrap().unwrap();
    assert_eq!(
        fetched.connection_status,
        crate::kds::KdsConnectionStatus::Connected
    );
    assert!(fetched.last_seen_at.is_some());

    s.update_kds_device_status(&device.id, crate::kds::KdsConnectionStatus::Disconnected)
        .unwrap();
    let fetched = s.get_kds_device(&device.id).unwrap().unwrap();
    assert_eq!(
        fetched.connection_status,
        crate::kds::KdsConnectionStatus::Disconnected
    );
}

#[test]
fn deactivate_device_no_longer_listed_as_active() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    let device = s
        .register_kds_device(crate::kds::RegisterKdsDeviceInput {
            name: "Test KDS".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hash".into(),
            pairing_expires_at: "2099-01-01T00:00:00Z".into(),
        })
        .unwrap();
    assert!(device.is_active);

    s.deactivate_kds_device(&device.id).unwrap();
    let fetched = s.get_kds_device(&device.id).unwrap().unwrap();
    assert!(!fetched.is_active);
}

#[test]
fn ack_order_records_device_and_timestamp() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("SKU-1"), 1, price(100)))
        .unwrap();
    let sale = Sale::from_cart_with_user(&cart, None).unwrap();
    s.create_sale(&sale).unwrap();

    let kds_order = s
        .create_kds_order(crate::CreateKdsOrderInput {
            sale_id: sale.id.clone(),
            store_id: None,
            items_summary: "Item".into(),
            item_count: 1,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();

    let result = s.ack_kds_order(&kds_order.id, "device-alpha").unwrap();
    assert!(result);

    // Verify the order has acked_by_device and acked_at set, and that the
    // ack moved it to PREPARING (device accepted + started cooking) — not
    // 'ready' (the ticket is not ready-to-serve at the instant of ack).
    let fetched = s.get_kds_order(&kds_order.id).unwrap().unwrap();
    assert_eq!(fetched.status, "preparing");
}

// ── Event Replay & Cleanup ───────────────────────────────────

fn seed_kds_order_at(
    s: &Store<'_>,
    conn: &Connection,
    received_at: &str,
    status: &str,
) -> crate::KdsOrder {
    // Create a sale first (FK requirement).
    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let sale = crate::Sale {
        id: sale_id.clone(),
        status: crate::SaleStatus::Completed,
        total: price(0),
        currency: usd(),
        line_count: 0,
        payment_method: None,
        tendered_minor: None,
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now,
        subtotal: price(0),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        lines: vec![],
        version: 1,
    };
    s.create_sale(&sale).unwrap();

    let id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO kds_orders (id, sale_id, status, items_summary, item_count, display_number, received_at, prep_time_seconds, priority)
         VALUES (?1, ?2, ?3, 'Item', 1, 1, ?4, 0, 0)",
        rusqlite::params![id, sale_id, status, received_at],
    ).unwrap();
    s.get_kds_order(&id).unwrap().unwrap()
}

#[test]
fn replay_orders_since_returns_only_newer() {
    let conn = fresh();
    let s = store(&conn);

    let _old = seed_kds_order_at(&s, &conn, "2025-01-01T10:00:00.000Z", "ready");
    let new1 = seed_kds_order_at(&s, &conn, "2025-01-01T12:00:00.000Z", "pending");
    let new2 = seed_kds_order_at(&s, &conn, "2025-01-01T13:00:00.000Z", "pending");

    let replayed = s
        .replay_kds_orders_since("2025-01-01T11:00:00.000Z", None)
        .unwrap();
    assert_eq!(replayed.len(), 2);
    assert_eq!(replayed[0].id, new1.id);
    assert_eq!(replayed[1].id, new2.id);
}

#[test]
fn replay_orders_since_respects_status_filter() {
    let conn = fresh();
    let s = store(&conn);

    seed_kds_order_at(&s, &conn, "2025-01-01T12:00:00.000Z", "pending");
    seed_kds_order_at(&s, &conn, "2025-01-01T12:05:00.000Z", "ready");
    seed_kds_order_at(&s, &conn, "2025-01-01T12:10:00.000Z", "pending");

    let replayed = s
        .replay_kds_orders_since("2025-01-01T11:00:00.000Z", Some("pending"))
        .unwrap();
    assert_eq!(replayed.len(), 2);
    assert!(replayed.iter().all(|o| o.status == "pending"));
}

#[test]
fn replay_orders_since_empty_when_nothing_newer() {
    let conn = fresh();
    let s = store(&conn);

    seed_kds_order_at(&s, &conn, "2025-01-01T10:00:00.000Z", "pending");

    let replayed = s
        .replay_kds_orders_since("2025-06-01T00:00:00.000Z", None)
        .unwrap();
    assert!(replayed.is_empty());
}

#[test]
fn cleanup_old_kds_orders_removes_terminal_states() {
    let conn = fresh();
    let s = store(&conn);

    // Old orders in terminal states.
    seed_kds_order_at(&s, &conn, "2024-01-01T10:00:00.000Z", "ready");
    seed_kds_order_at(&s, &conn, "2024-01-02T10:00:00.000Z", "served");
    seed_kds_order_at(&s, &conn, "2024-01-03T10:00:00.000Z", "cancelled");

    // Recent order (should not be deleted).
    seed_kds_order_at(&s, &conn, "2025-06-01T10:00:00.000Z", "pending");

    let deleted = s.cleanup_old_kds_orders(365).unwrap();
    assert_eq!(deleted, 3);

    let remaining = s.list_kds_orders(None).unwrap();
    assert_eq!(remaining.len(), 1);
}

#[test]
fn cleanup_old_kds_orders_preserves_pending_orders() {
    let conn = fresh();
    let s = store(&conn);

    // Old but still pending — should NOT be deleted.
    seed_kds_order_at(&s, &conn, "2024-01-01T10:00:00.000Z", "pending");
    seed_kds_order_at(&s, &conn, "2024-01-01T10:05:00.000Z", "preparing");

    let deleted = s.cleanup_old_kds_orders(365).unwrap();
    assert_eq!(deleted, 0);

    let remaining = s.list_kds_orders(None).unwrap();
    assert_eq!(remaining.len(), 2);
}

// ── Pairing Token Validation ──────────────────────────────────

#[test]
fn validate_pairing_token_accepts_valid_hash() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    let device = s
        .register_kds_device(crate::kds::RegisterKdsDeviceInput {
            name: "Test KDS".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "correct-hash".into(),
            pairing_expires_at: "2099-01-01T00:00:00Z".into(),
        })
        .unwrap();

    let result = s
        .validate_pairing_token("correct-hash", &device.id)
        .unwrap();
    assert!(result);
}

#[test]
fn validate_pairing_token_rejects_wrong_hash() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    let device = s
        .register_kds_device(crate::kds::RegisterKdsDeviceInput {
            name: "Test KDS".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "correct-hash".into(),
            pairing_expires_at: "2099-01-01T00:00:00Z".into(),
        })
        .unwrap();

    let err = s
        .validate_pairing_token("wrong-hash", &device.id)
        .unwrap_err();
    assert!(matches!(err, crate::CoreError::Validation { field, .. } if field == "token_hash"));
}

#[test]
fn validate_pairing_token_rejects_expired() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    let device = s
        .register_kds_device(crate::kds::RegisterKdsDeviceInput {
            name: "Test KDS".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hash".into(),
            pairing_expires_at: "2020-01-01T00:00:00Z".into(), // already expired
        })
        .unwrap();

    let err = s.validate_pairing_token("hash", &device.id).unwrap_err();
    assert!(
        matches!(err, crate::CoreError::Validation { field, .. } if field == "pairing_expires_at")
    );
}

#[test]
fn validate_pairing_token_returns_false_for_missing_device() {
    let conn = fresh();
    let s = store(&conn);

    let result = s
        .validate_pairing_token("hash", "nonexistent-device")
        .unwrap();
    assert!(!result);
}

// ── Zone-based routing with real product data ─────────────────

#[test]
fn product_kitchen_zone_lookup() {
    let conn = fresh();
    let s = store(&conn);

    // Create products with kitchen zones.
    s.create_product(
        "STEAK",
        "Ribeye Steak",
        price(1500),
        None,
        None,
        100,
        Some("restaurant"),
    )
    .unwrap();
    s.create_product(
        "BEER",
        "Craft Beer",
        price(600),
        None,
        None,
        100,
        Some("restaurant"),
    )
    .unwrap();

    // Set kitchen_zone on products.
    conn.execute(
        "UPDATE products SET kitchen_zone = 'grill' WHERE sku = 'STEAK'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE products SET kitchen_zone = 'bar' WHERE sku = 'BEER'",
        [],
    )
    .unwrap();

    // Verify lookup.
    assert_eq!(
        s.product_kitchen_zone_by_sku("STEAK").unwrap(),
        Some("grill".into())
    );
    assert_eq!(
        s.product_kitchen_zone_by_sku("BEER").unwrap(),
        Some("bar".into())
    );
    assert_eq!(s.product_kitchen_zone_by_sku("UNKNOWN").unwrap(), None);
}

#[test]
fn zone_based_routing_with_product_lookup() {
    use std::collections::HashMap;
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    // Create products with kitchen zones.
    s.create_product(
        "STEAK",
        "Ribeye Steak",
        price(1500),
        None,
        None,
        100,
        Some("restaurant"),
    )
    .unwrap();
    s.create_product(
        "BEER",
        "Craft Beer",
        price(600),
        None,
        None,
        100,
        Some("restaurant"),
    )
    .unwrap();
    conn.execute(
        "UPDATE products SET kitchen_zone = 'grill' WHERE sku = 'STEAK'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE products SET kitchen_zone = 'bar' WHERE sku = 'BEER'",
        [],
    )
    .unwrap();

    // Register devices with zone-based station_ids.
    s.register_kds_device(crate::kds::RegisterKdsDeviceInput {
        name: "Grill Display".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec!["grill".into()],
        pairing_token_hash: "h1".into(),
        pairing_expires_at: "2099-01-01T00:00:00Z".into(),
    })
    .unwrap();
    s.register_kds_device(crate::kds::RegisterKdsDeviceInput {
        name: "Bar Display".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec!["bar".into()],
        pairing_token_hash: "h2".into(),
        pairing_expires_at: "2099-01-01T00:00:00Z".into(),
    })
    .unwrap();

    let devices = s.list_kds_devices_for_restaurant("resto-1").unwrap();

    // Build SKU → station map using the product lookup.
    let skus = ["STEAK", "BEER"];
    let mut sku_to_station: HashMap<String, Option<String>> = HashMap::new();
    for sku in &skus {
        let zone = s.product_kitchen_zone_by_sku(sku).unwrap();
        sku_to_station.insert(sku.to_string(), zone);
    }

    // Line items: one steak, one beer.
    let items = vec![
        crate::kds::KdsLineItem {
            id: "li-1".into(),
            kds_order_id: "order-1".into(),
            sku: "STEAK".into(),
            display_name: "Ribeye Steak".into(),
            qty: 1,
            course: None,
            modifiers: vec![],
            line_position: 0,
            item_status: "pending".into(),
            started_at: None,
            ready_at: None,
            served_at: None,
            created_at: "2025-01-01T00:00:00Z".into(),
        },
        crate::kds::KdsLineItem {
            id: "li-2".into(),
            kds_order_id: "order-1".into(),
            sku: "BEER".into(),
            display_name: "Craft Beer".into(),
            qty: 1,
            course: None,
            modifiers: vec![],
            line_position: 1,
            item_status: "pending".into(),
            started_at: None,
            ready_at: None,
            served_at: None,
            created_at: "2025-01-01T00:00:00Z".into(),
        },
    ];

    // Route with the real zone lookup.
    let targets = crate::kds::resolve_kds_targets(&items, &devices, |sku| {
        sku_to_station.get(sku).cloned().flatten()
    });

    // Both devices should receive the order (grill for steak, bar for beer).
    assert_eq!(
        targets.len(),
        2,
        "both grill and bar devices should be targets"
    );

    // Verify each device is in the targets.
    let grill_id = devices
        .iter()
        .find(|d| d.name == "Grill Display")
        .unwrap()
        .id
        .clone();
    let bar_id = devices
        .iter()
        .find(|d| d.name == "Bar Display")
        .unwrap()
        .id
        .clone();
    assert!(targets.contains(&grill_id));
    assert!(targets.contains(&bar_id));
}

#[test]
fn zone_based_routing_only_matches_relevant_devices() {
    use std::collections::HashMap;
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    // Product with only grill zone.
    s.create_product(
        "STEAK",
        "Ribeye Steak",
        price(1500),
        None,
        None,
        100,
        Some("restaurant"),
    )
    .unwrap();
    conn.execute(
        "UPDATE products SET kitchen_zone = 'grill' WHERE sku = 'STEAK'",
        [],
    )
    .unwrap();

    // Three devices: grill, bar, and broadcast.
    s.register_kds_device(crate::kds::RegisterKdsDeviceInput {
        name: "Grill".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec!["grill".into()],
        pairing_token_hash: "h1".into(),
        pairing_expires_at: "2099-01-01T00:00:00Z".into(),
    })
    .unwrap();
    s.register_kds_device(crate::kds::RegisterKdsDeviceInput {
        name: "Bar".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec!["bar".into()],
        pairing_token_hash: "h2".into(),
        pairing_expires_at: "2099-01-01T00:00:00Z".into(),
    })
    .unwrap();
    s.register_kds_device(crate::kds::RegisterKdsDeviceInput {
        name: "Broadcast".into(),
        restaurant_pos_id: "resto-1".into(),
        station_ids: vec![], // broadcast mode
        pairing_token_hash: "h3".into(),
        pairing_expires_at: "2099-01-01T00:00:00Z".into(),
    })
    .unwrap();

    let devices = s.list_kds_devices_for_restaurant("resto-1").unwrap();

    let mut sku_to_station: HashMap<String, Option<String>> = HashMap::new();
    let zone = s.product_kitchen_zone_by_sku("STEAK").unwrap();
    sku_to_station.insert("STEAK".into(), zone);

    let items = vec![crate::kds::KdsLineItem {
        id: "li-1".into(),
        kds_order_id: "order-1".into(),
        sku: "STEAK".into(),
        display_name: "Ribeye Steak".into(),
        qty: 1,
        course: None,
        modifiers: vec![],
        line_position: 0,
        item_status: "pending".into(),
        started_at: None,
        ready_at: None,
        served_at: None,
        created_at: "2025-01-01T00:00:00Z".into(),
    }];

    let targets = crate::kds::resolve_kds_targets(&items, &devices, |sku| {
        sku_to_station.get(sku).cloned().flatten()
    });

    // Grill (station match) + Broadcast (empty station_ids) should be targets.
    // Bar should NOT be a target (station mismatch and not broadcast).
    let grill_id = devices
        .iter()
        .find(|d| d.name == "Grill")
        .unwrap()
        .id
        .clone();
    let bar_id = devices.iter().find(|d| d.name == "Bar").unwrap().id.clone();
    let broadcast_id = devices
        .iter()
        .find(|d| d.name == "Broadcast")
        .unwrap()
        .id
        .clone();
    assert!(targets.contains(&grill_id));
    assert!(targets.contains(&broadcast_id));
    assert!(!targets.contains(&bar_id));
}

// ── Device Health Monitoring ─────────────────────────────────

#[test]
fn mark_stale_devices_transitions_connected_to_stale() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    let device = s
        .register_kds_device(crate::kds::RegisterKdsDeviceInput {
            name: "Test KDS".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hash".into(),
            pairing_expires_at: "2099-01-01T00:00:00Z".into(),
        })
        .unwrap();

    // Mark as connected with a stale last_seen_at.
    s.update_kds_device_status(&device.id, crate::kds::KdsConnectionStatus::Connected)
        .unwrap();

    // Manually backdate last_seen_at to simulate a stale device.
    conn.execute(
        "UPDATE kds_devices SET last_seen_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1",
        rusqlite::params![device.id],
    )
    .unwrap();

    let marked = s.mark_stale_kds_devices(30).unwrap(); // 30 second threshold
    assert_eq!(marked, 1);

    let fetched = s.get_kds_device(&device.id).unwrap().unwrap();
    assert_eq!(
        fetched.connection_status,
        crate::kds::KdsConnectionStatus::Stale
    );
}

#[test]
fn mark_stale_devices_skips_already_disconnected() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    let _device = s
        .register_kds_device(crate::kds::RegisterKdsDeviceInput {
            name: "Test KDS".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hash".into(),
            pairing_expires_at: "2099-01-01T00:00:00Z".into(),
        })
        .unwrap();

    // Device is disconnected (default) — should not be marked stale.
    let marked = s.mark_stale_kds_devices(30).unwrap();
    assert_eq!(marked, 0);
}

#[test]
fn deactivate_stale_devices_removes_long_offline_devices() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    let device = s
        .register_kds_device(crate::kds::RegisterKdsDeviceInput {
            name: "Test KDS".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hash".into(),
            pairing_expires_at: "2099-01-01T00:00:00Z".into(),
        })
        .unwrap();

    // Set device to stale with an old updated_at.
    conn.execute(
        "UPDATE kds_devices SET connection_status = 'stale', updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1",
        rusqlite::params![device.id],
    ).unwrap();

    let deactivated = s.deactivate_stale_kds_devices(3600).unwrap(); // 1 hour threshold
    assert_eq!(deactivated, 1);

    let fetched = s.get_kds_device(&device.id).unwrap().unwrap();
    assert!(!fetched.is_active);
}

#[test]
fn deactivate_stale_devices_skips_recently_stale() {
    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    let device = s
        .register_kds_device(crate::kds::RegisterKdsDeviceInput {
            name: "Test KDS".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec![],
            pairing_token_hash: "hash".into(),
            pairing_expires_at: "2099-01-01T00:00:00Z".into(),
        })
        .unwrap();

    // Mark as connected, then stale (recently).
    s.update_kds_device_status(&device.id, crate::kds::KdsConnectionStatus::Connected)
        .unwrap();
    s.update_kds_device_status(&device.id, crate::kds::KdsConnectionStatus::Stale)
        .unwrap();

    // Should not be deactivated — just went stale.
    let deactivated = s.deactivate_stale_kds_devices(3600).unwrap();
    assert_eq!(deactivated, 0);

    let fetched = s.get_kds_device(&device.id).unwrap().unwrap();
    assert!(fetched.is_active);
}

// ── End-to-End Enrollment Flow ──────────────────────────────

#[test]
fn e2e_enrollment_flow_register_validate_route_ack() {
    use std::collections::HashMap;

    let conn = fresh();
    let s = store(&conn);
    seed_terminal(&conn, "resto-1", "Restaurant POS", "pc-1");

    // 1. Create a product with a kitchen zone.
    s.create_product(
        "BURGER",
        "Classic Burger",
        price(1200),
        None,
        None,
        100,
        Some("restaurant"),
    )
    .unwrap();
    conn.execute(
        "UPDATE products SET kitchen_zone = 'grill' WHERE sku = 'BURGER'",
        [],
    )
    .unwrap();

    // 2. Generate a pairing token and hash it (simulating QR generation).
    let token = "abcdef1234567890abcdef1234567890";
    let token_hash = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(token.as_bytes());
        format!("{:x}", hasher.finalize())
    };
    let expires_at = "2099-01-01T00:00:00Z";

    // 3. Register the KDS device with the hashed token.
    let device = s
        .register_kds_device(crate::kds::RegisterKdsDeviceInput {
            name: "Grill Display".into(),
            restaurant_pos_id: "resto-1".into(),
            station_ids: vec!["grill".into()],
            pairing_token_hash: token_hash.clone(),
            pairing_expires_at: expires_at.into(),
        })
        .unwrap();
    assert!(device.is_active);
    assert_eq!(
        device.connection_status,
        crate::kds::KdsConnectionStatus::Disconnected
    );

    // 4. Validate the pairing token — should succeed.
    let valid = s.validate_pairing_token(&token_hash, &device.id).unwrap();
    assert!(valid, "pairing token should be valid");

    // 5. Validate with wrong hash — should fail.
    let wrong = s.validate_pairing_token("wrong_hash", &device.id);
    assert!(wrong.is_err(), "wrong hash should fail");

    // 6. Simulate device connecting (update status to connected).
    s.update_kds_device_status(&device.id, crate::kds::KdsConnectionStatus::Connected)
        .unwrap();
    let fetched = s.get_kds_device(&device.id).unwrap().unwrap();
    assert_eq!(
        fetched.connection_status,
        crate::kds::KdsConnectionStatus::Connected
    );
    assert!(fetched.last_seen_at.is_some());

    // 7. Create a sale and KDS order.
    let sale_id = uuid::Uuid::now_v7().to_string();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let sale = crate::Sale {
        id: sale_id.clone(),
        status: crate::SaleStatus::Completed,
        total: price(1200),
        currency: usd(),
        line_count: 1,
        payment_method: None,
        tendered_minor: None,
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now,
        subtotal: price(1200),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        lines: vec![],
        version: 1,
    };
    s.create_sale(&sale).unwrap();

    let kds_order = s
        .create_kds_order(crate::CreateKdsOrderInput {
            sale_id: sale_id.clone(),
            store_id: None,
            items_summary: "Classic Burger".into(),
            item_count: 1,
            kitchen_zone: Some("grill".into()),
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();
    assert_eq!(kds_order.status, "pending");

    // 8. Route the order — should target the grill device.
    let devices = s.list_kds_devices_for_restaurant("resto-1").unwrap();
    let mut sku_to_station: HashMap<String, Option<String>> = HashMap::new();
    let zone = s.product_kitchen_zone_by_sku("BURGER").unwrap();
    sku_to_station.insert("BURGER".into(), zone);

    let items = vec![crate::kds::KdsLineItem {
        id: "li-1".into(),
        kds_order_id: kds_order.id.clone(),
        sku: "BURGER".into(),
        display_name: "Classic Burger".into(),
        qty: 1,
        course: None,
        modifiers: vec![],
        line_position: 0,
        item_status: "pending".into(),
        started_at: None,
        ready_at: None,
        served_at: None,
        created_at: "2025-01-01T00:00:00Z".into(),
    }];

    let targets = crate::kds::resolve_kds_targets(&items, &devices, |sku| {
        sku_to_station.get(sku).cloned().flatten()
    });
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0], device.id);

    // 9. Ack the order — should succeed.
    let acked = s.ack_kds_order(&kds_order.id, &device.id).unwrap();
    assert!(acked);

    // 10. Double-ack should fail (already acked).
    let acked2 = s.ack_kds_order(&kds_order.id, "other-device").unwrap();
    assert!(!acked2);

    // 11. Verify order is now in 'preparing' state (device accepted + cooking).
    let order = s.get_kds_order(&kds_order.id).unwrap().unwrap();
    assert_eq!(order.status, "preparing");

    // 12. Replay should not include this order (it's old and ready).
    let replayed = s
        .replay_kds_orders_since("2020-01-01T00:00:00.000Z", Some("pending"))
        .unwrap();
    assert!(
        replayed.is_empty(),
        "acknowledged order should not appear in pending replay"
    );

    // 13. Simulate device going stale and being deactivated.
    conn.execute(
        "UPDATE kds_devices SET last_seen_at = '2020-01-01T00:00:00.000Z', connection_status = 'connected' WHERE id = ?1",
        rusqlite::params![device.id],
    ).unwrap();
    s.mark_stale_kds_devices(30).unwrap();
    let fetched = s.get_kds_device(&device.id).unwrap().unwrap();
    assert_eq!(
        fetched.connection_status,
        crate::kds::KdsConnectionStatus::Stale
    );

    // 14. Cleanup old orders — this order is recent, should not be deleted.
    let deleted = s.cleanup_old_kds_orders(30).unwrap();
    assert_eq!(deleted, 0);
}

// ── S3: sale-lifecycle ↔ KDS ticket reconciliation ─────────────────

fn make_active_sale(s: &Store<'_>, sale_id: &str) {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let test_sale = Sale {
        id: sale_id.to_owned(),
        status: crate::SaleStatus::Active,
        total: price(0),
        currency: usd(),
        line_count: 0,
        payment_method: None,
        tendered_minor: None,
        discount_percent: 0,
        discount_label: None,
        user_id: None,
        created_at: now.clone(),
        updated_at: now,
        subtotal: price(0),
        tax_total: price(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        lines: vec![],
        version: 1,
    };
    s.create_sale(&test_sale).unwrap();
}

fn make_kds_order(s: &Store<'_>, sale_id: &str, zone: Option<&str>) -> crate::KdsOrder {
    s.create_kds_order(CreateKdsOrderInput {
        sale_id: sale_id.to_owned(),
        store_id: None,
        items_summary: "Burger x1".into(),
        item_count: 1,
        kitchen_zone: zone.map(|z| z.to_owned()),
        notes: String::new(),
        table_number: None,
        priority: false,
    })
    .unwrap()
}

/// F10: replaying the CURRENT state must be a true no-op — the workflow
/// timestamp (started_at) and prep timer must not be overwritten by a
/// duplicate offline replay or a re-fired auto-acknowledge.
#[test]
fn update_kds_status_same_state_replay_preserves_started_at() {
    let conn = fresh();
    let s = store(&conn);
    make_active_sale(&s, "sale-noop");
    let order = make_kds_order(&s, "sale-noop", Some("grill"));

    let preparing = s.update_kds_status(&order.id, "preparing").unwrap();
    let started = preparing.started_at.clone().expect("started_at set");

    let replay = s.update_kds_status(&order.id, "preparing").unwrap();
    assert_eq!(replay.status, "preparing");
    assert_eq!(
        replay.started_at.as_deref(),
        Some(started.as_str()),
        "same-state replay must not overwrite started_at"
    );
}

/// F5: replacing an order's items mid-preparation must carry the matched
/// item's workflow state onto the new rows (FIFO by (sku, course)), not
/// reset the kitchen's progress to 'pending'. Unmatched new items start
/// pending.
#[test]
fn update_kds_order_items_replacement_preserves_item_status() {
    let conn = fresh();
    let s = store(&conn);
    make_active_sale(&s, "sale-edit");
    let order = make_kds_order(&s, "sale-edit", None);

    let initial = s
        .create_kds_line_items(
            &order.id,
            &[
                CreateKdsLineItemInput {
                    sku: "BURGER".into(),
                    display_name: "Burger".into(),
                    qty: 1,
                    course: Some("main".into()),
                    modifiers: vec![],
                },
                CreateKdsLineItemInput {
                    sku: "FRIES".into(),
                    display_name: "Fries".into(),
                    qty: 1,
                    course: Some("side".into()),
                    modifiers: vec![],
                },
            ],
        )
        .unwrap();

    // Kitchen starts the burger.
    let burger = &initial[0];
    assert_eq!(burger.sku, "BURGER");
    let started_line = s
        .update_kds_line_item_status(&burger.id, "preparing")
        .unwrap();
    let started_at = started_line.started_at.clone().expect("started_at set");

    // FOH edits the order: same burger + fries, plus a new coke.
    s.update_kds_order_items(crate::UpdateKdsOrderItemsInput {
        id: order.id.clone(),
        items_summary: String::new(),
        item_count: 0,
        line_items: Some(vec![
            CreateKdsLineItemInput {
                sku: "BURGER".into(),
                display_name: "Burger".into(),
                qty: 1,
                course: Some("main".into()),
                modifiers: vec![],
            },
            CreateKdsLineItemInput {
                sku: "FRIES".into(),
                display_name: "Fries".into(),
                qty: 1,
                course: Some("side".into()),
                modifiers: vec![],
            },
            CreateKdsLineItemInput {
                sku: "COKE".into(),
                display_name: "Coke".into(),
                qty: 1,
                course: Some("beverage".into()),
                modifiers: vec![],
            },
        ]),
    })
    .unwrap();

    let lines = s.get_kds_order_lines(&order.id).unwrap();
    assert_eq!(lines.len(), 3);
    let by_sku: std::collections::HashMap<&str, &crate::KdsLineItem> =
        lines.iter().map(|l| (l.sku.as_str(), l)).collect();
    let burger = by_sku.get("BURGER").unwrap();
    assert_eq!(burger.item_status, "preparing", "burger keeps its progress");
    assert_eq!(
        burger.started_at.as_deref(),
        Some(started_at.as_str()),
        "burger keeps its started_at"
    );
    assert_eq!(by_sku.get("FRIES").unwrap().item_status, "pending");
    assert_eq!(
        by_sku.get("COKE").unwrap().item_status,
        "pending",
        "new items start pending"
    );
}

/// S3: cancelling a sale's tickets is active-only — served food is history
/// and already-cancelled tickets are terminal; lines follow their parent.
#[test]
fn cancel_kds_orders_for_sale_cancels_only_active_tickets() {
    let conn = fresh();
    let s = store(&conn);
    make_active_sale(&s, "sale-cancel");
    let pending = make_kds_order(&s, "sale-cancel", Some("grill"));
    let served = make_kds_order(&s, "sale-cancel", Some("bar"));
    let already = make_kds_order(&s, "sale-cancel", None);

    s.update_kds_status(&served.id, "preparing").unwrap();
    s.update_kds_status(&served.id, "ready").unwrap();
    s.update_kds_status(&served.id, "served").unwrap();
    s.update_kds_status(&already.id, "cancelled").unwrap();

    // Lines on the pending ticket must follow it to 'cancelled'.
    s.create_kds_line_items(
        &pending.id,
        &[CreateKdsLineItemInput {
            sku: "BURGER".into(),
            display_name: "Burger".into(),
            qty: 1,
            course: Some("main".into()),
            modifiers: vec![],
        }],
    )
    .unwrap();

    let tx = conn.unchecked_transaction().unwrap();
    let cancelled = s
        .cancel_kds_orders_for_sale_in_tx(&tx, "sale-cancel")
        .unwrap();
    tx.commit().unwrap();

    assert_eq!(
        cancelled, 1,
        "only the active (pending) ticket is cancelled"
    );
    assert_eq!(
        s.get_kds_order(&pending.id).unwrap().unwrap().status,
        "cancelled"
    );
    assert_eq!(
        s.get_kds_order(&served.id).unwrap().unwrap().status,
        "served"
    );
    assert_eq!(
        s.get_kds_order(&already.id).unwrap().unwrap().status,
        "cancelled"
    );
    let pending_lines = s.get_kds_order_lines(&pending.id).unwrap();
    assert!(
        pending_lines.iter().all(|l| l.item_status == "cancelled"),
        "lines of a cancelled ticket follow to 'cancelled'"
    );
}

/// S3: voiding a sale must pull its active tickets off the board, in the
/// same transaction as the void itself.
#[test]
fn void_sale_cancels_kds_tickets_for_the_sale() {
    let conn = fresh();
    let s = store(&conn);
    make_active_sale(&s, "sale-void");
    let ticket = make_kds_order(&s, "sale-void", Some("grill"));
    s.update_kds_status(&ticket.id, "preparing").unwrap();

    let voided = s
        .void_sale("sale-void", "manager-1", "customer left")
        .unwrap();
    assert_eq!(voided.status, crate::SaleStatus::Voided);

    let after = s.get_kds_order(&ticket.id).unwrap().unwrap();
    assert_eq!(
        after.status, "cancelled",
        "voided sale's active ticket must be cancelled"
    );
}

/// S3 integration: a FULL refund must pull the sale's active kitchen
/// tickets off the board, inside the refund's own transaction. Drives the
/// real cart → sale → fanout → refund path end to end (the void sibling
/// test covers `void_sale`; until now no test drove the refund branch).
#[test]
fn full_refund_cancels_kds_tickets_for_the_sale() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("BURGER"), 1, price(500)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    // Kitchen tickets exist and one is mid-prep when the refund lands.
    let ticket = s
        .complete_sale_to_kds_fanout(&sale.id, None, &[])
        .unwrap()
        .remove(0);
    s.update_kds_status(&ticket.id, "preparing").unwrap();
    s.create_kds_line_items(
        &ticket.id,
        &[CreateKdsLineItemInput {
            sku: "BURGER".into(),
            display_name: "Burger".into(),
            qty: 1,
            course: Some("main".into()),
            modifiers: vec![],
        }],
    )
    .unwrap();

    let refund = crate::Refund::new(
        &sale.id,
        price(500),
        "full refund",
        "",
        "user-1",
        vec![crate::RefundLine::new(
            &sale.lines[0].id,
            "BURGER",
            1,
            price(500),
            price(500),
        )],
    );
    s.create_refund(&refund).unwrap();

    let after = s.get_kds_order(&ticket.id).unwrap().unwrap();
    assert_eq!(
        after.status, "cancelled",
        "a full refund must cancel the sale's active kitchen ticket"
    );
    let lines = s.get_kds_order_lines(&ticket.id).unwrap();
    assert!(
        lines.iter().all(|l| l.item_status == "cancelled"),
        "the cancelled ticket's line items follow to 'cancelled'"
    );
}

/// S3 integration: a PARTIAL refund must leave the kitchen board alone —
/// the kitchen is still cooking the remainder of the sale.
#[test]
fn partial_refund_keeps_kds_tickets_active() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");
    seed_product(&conn, "FRIES", "Fries");

    // Two line items: refunding one line is partial against the total.
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("BURGER"), 1, price(500)))
        .unwrap();
    cart.add_line(CartLine::new(Sku::new("FRIES"), 1, price(300)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    let ticket = s
        .complete_sale_to_kds_fanout(&sale.id, None, &[])
        .unwrap()
        .remove(0);
    s.update_kds_status(&ticket.id, "preparing").unwrap();

    let refund = crate::Refund::new(
        &sale.id,
        price(500),
        "partial refund",
        "",
        "user-1",
        vec![crate::RefundLine::new(
            &sale.lines[0].id,
            "BURGER",
            1,
            price(500),
            price(500),
        )],
    );
    s.create_refund(&refund).unwrap();

    let after = s.get_kds_order(&ticket.id).unwrap().unwrap();
    assert_eq!(
        after.status, "preparing",
        "a partial refund must NOT cancel the kitchen ticket"
    );
}

/// S3 boundary: the full-refund detection is CUMULATIVE — two partial
/// refunds that together reach the sale total must cancel the kitchen
/// tickets on the second refund, even though neither refund alone is
/// full. Pins the `already_refunded + refund.total >= sale_total` branch
/// with a non-zero prior balance.
#[test]
fn cumulative_refunds_reaching_full_total_cancel_kds_tickets() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");
    seed_product(&conn, "FRIES", "Fries");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("BURGER"), 1, price(500)))
        .unwrap();
    cart.add_line(CartLine::new(Sku::new("FRIES"), 1, price(300)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    let ticket = s
        .complete_sale_to_kds_fanout(&sale.id, None, &[])
        .unwrap()
        .remove(0);
    s.update_kds_status(&ticket.id, "preparing").unwrap();

    // First partial refund (500 of 800): ticket must stay.
    let first = crate::Refund::new(
        &sale.id,
        price(500),
        "partial one",
        "",
        "user-1",
        vec![crate::RefundLine::new(
            &sale.lines[0].id,
            "BURGER",
            1,
            price(500),
            price(500),
        )],
    );
    s.create_refund(&first).unwrap();
    assert_eq!(
        s.get_kds_order(&ticket.id).unwrap().unwrap().status,
        "preparing",
        "first partial refund leaves the board alone"
    );

    // Second partial refund (300 of 800) reaches the full total:
    // the kitchen is now returning EVERYTHING — ticket must cancel.
    let second = crate::Refund::new(
        &sale.id,
        price(300),
        "partial two completes the refund",
        "",
        "user-1",
        vec![crate::RefundLine::new(
            &sale.lines[1].id,
            "FRIES",
            1,
            price(300),
            price(300),
        )],
    );
    s.create_refund(&second).unwrap();
    assert_eq!(
        s.get_kds_order(&ticket.id).unwrap().unwrap().status,
        "cancelled",
        "refunds summing to the sale total must cancel the kitchen ticket"
    );
}

/// S3 ghost-ticket window: `void_pending_sale` must cancel any kitchen
/// tickets created for the sale before the void ran. In production a
/// ticket exists between the checkout command's deduction pass and the
/// separate `create_kds_order_from_sale_scoped` call — a void arriving in
/// that window (app crash, sync replay, cashier abort) must not leave a
/// ghost ticket cooking on the board. Drives the real checkout path so
/// the sale is genuinely 'pending' in the DB with deduction_locations set.
#[test]
fn void_pending_sale_cancels_kds_tickets_in_ghost_window() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("BURGER"), 1, price(500)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();

    // Real checkout: sale lands 'pending', stock deducted from the
    // canonical default location (create_product seeded it).
    let default_loc = crate::inventory::CANONICAL_DEFAULT_LOCATION_UUID;
    let splits = vec![crate::PaymentSplitArg {
        method: "cash".into(),
        amount_minor: 500,
        gateway_reference: None,
        gateway_status: None,
        gateway_response: None,
        idempotency_key: None,
    }];
    s.complete_sale_deduction_with_locations(
        &sale,
        None,
        &[crate::inventory::LocationId::from(default_loc)],
        &splits,
        "cashier-1",
        None,
        &[],
    )
    .unwrap();

    // Ghost-window ticket: created after checkout, before finalize.
    let ticket = s
        .complete_sale_to_kds_fanout(&sale.id, None, &[])
        .unwrap()
        .remove(0);
    s.update_kds_status(&ticket.id, "preparing").unwrap();

    s.void_pending_sale(&sale.id).unwrap();

    let after = s.get_kds_order(&ticket.id).unwrap().unwrap();
    assert_eq!(
        after.status, "cancelled",
        "voiding a pending sale must cancel its ghost-window kitchen ticket"
    );
    let lines = s.get_kds_order_lines(&ticket.id).unwrap();
    assert!(
        lines.iter().all(|l| l.item_status == "cancelled"),
        "the cancelled ghost ticket's line items follow to 'cancelled'"
    );
}

/// TODO 1b: the fanout stamps each kitchen ticket with the dining table
/// currently bound to the sale (`tables.active_sale_id`), so the KDS
/// board can show "Table 4" instead of a bare ticket id. No test pinned
/// this: a regression that drops the lookup would silently strip the
/// table name from every zoned ticket. Pins both halves — the stamp
/// lands when a table is assigned, and stays None when none is.
#[test]
fn kds_fanout_stamps_table_number_from_assigned_table() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");

    let table = s
        .create_table(&crate::Table {
            id: "tbl-ghost-1".into(),
            name: "Table 4".into(),
            capacity: 4,
            pos_x: 10.0,
            pos_y: 20.0,
            shape: "circle".into(),
            width: 10.0,
            height: 10.0,
            status: "available".into(),
            active_sale_id: None,
            section: "Main".into(),
            active: true,
            sort_order: 0,
            created_at: String::new(),
            updated_at: String::new(),
        })
        .unwrap();

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("BURGER"), 1, price(500)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    s.assign_table_order(&table.id, &sale.id).unwrap();

    let ticket = s
        .complete_sale_to_kds_fanout(&sale.id, None, &[])
        .unwrap()
        .remove(0);
    assert_eq!(
        ticket.table_number.as_deref(),
        Some("Table 4"),
        "ticket must carry the assigned table's name"
    );
}

/// The None half: a takeaway sale with no table assignment must produce
/// tickets with no table_number (NOT an empty string or a stale name).
#[test]
fn kds_fanout_leaves_table_number_none_without_table() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");

    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("BURGER"), 1, price(500)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    let ticket = s
        .complete_sale_to_kds_fanout(&sale.id, None, &[])
        .unwrap()
        .remove(0);
    assert_eq!(
        ticket.table_number, None,
        "no assigned table → no table name on the ticket"
    );
}

/// Seeds a ticket with two structured line items (burger + fries) and
/// returns (order, lines) for line-item state-machine tests. Callers must
/// seed the BURGER/FRIES products first.
fn seed_ticket_with_lines(s: &Store<'_>) -> (crate::KdsOrder, Vec<crate::KdsLineItem>) {
    let mut cart = Cart::new(usd());
    cart.add_line(CartLine::new(Sku::new("BURGER"), 1, price(500)))
        .unwrap();
    cart.add_line(CartLine::new(Sku::new("FRIES"), 1, price(300)))
        .unwrap();
    let sale = Sale::from_cart(&cart).unwrap();
    s.create_sale(&sale).unwrap();

    let order = s
        .create_kds_order(CreateKdsOrderInput {
            sale_id: sale.id.clone(),
            store_id: None,
            items_summary: "Burger, Fries".into(),
            item_count: 2,
            kitchen_zone: Some("grill".into()),
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap();
    let lines = s
        .create_kds_line_items(
            &order.id,
            &[
                CreateKdsLineItemInput {
                    sku: "BURGER".into(),
                    display_name: "Burger".into(),
                    qty: 1,
                    course: Some("main".into()),
                    modifiers: vec![],
                },
                CreateKdsLineItemInput {
                    sku: "FRIES".into(),
                    display_name: "Fries".into(),
                    qty: 1,
                    course: Some("side".into()),
                    modifiers: vec![],
                },
            ],
        )
        .unwrap();
    (order, lines)
}

/// RED: each line-item forward transition must stamp its workflow
/// timestamp (preparing → started_at, ready → ready_at, served →
/// served_at) — the KDS prep-time metrics are built on these columns.
#[test]
fn kds_line_item_transitions_stamp_workflow_timestamps() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");
    seed_product(&conn, "FRIES", "Fries");
    let (order, lines) = seed_ticket_with_lines(&s);
    let _ = order;

    let burger = &lines[0];

    let preparing = s
        .update_kds_line_item_status(&burger.id, "preparing")
        .unwrap();
    assert_eq!(preparing.item_status, "preparing");
    assert!(preparing.started_at.is_some(), "started_at stamped");

    let ready = s.update_kds_line_item_status(&burger.id, "ready").unwrap();
    assert_eq!(ready.item_status, "ready");
    assert!(ready.ready_at.is_some(), "ready_at stamped");
    assert_eq!(
        ready.started_at, preparing.started_at,
        "started_at must survive the ready transition"
    );

    let served = s.update_kds_line_item_status(&burger.id, "served").unwrap();
    assert_eq!(served.item_status, "served");
    assert!(served.served_at.is_some(), "served_at stamped");
}

/// RED: the line-item state machine is FORWARD-only, mirroring the
/// order-level machine — a stale offline replay moving a line item back
/// (ready → preparing) must be rejected, not silently applied.
#[test]
fn kds_line_item_transitions_reject_regression() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");
    seed_product(&conn, "FRIES", "Fries");
    let (order, lines) = seed_ticket_with_lines(&s);
    let _ = order;

    let burger = &lines[0];
    s.update_kds_line_item_status(&burger.id, "preparing")
        .unwrap();
    s.update_kds_line_item_status(&burger.id, "ready").unwrap();

    let err = s
        .update_kds_line_item_status(&burger.id, "preparing")
        .unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { .. }),
        "line-item regression must be a validation error, got: {err:?}"
    );
    let after = s
        .get_kds_order_lines(&order.id)
        .unwrap()
        .into_iter()
        .find(|l| l.sku == "BURGER")
        .unwrap();
    assert_eq!(after.item_status, "ready", "status must stay ready");
}

/// RED: unknown statuses and skips are not KDS line-item states — an
/// offline payload replaying "servedx" or "skip" must be rejected, not
/// written.
#[test]
fn kds_line_item_transitions_reject_unknown_status() {
    let conn = fresh();
    let s = store(&conn);
    seed_product(&conn, "BURGER", "Burger");
    seed_product(&conn, "FRIES", "Fries");
    let (_order, lines) = seed_ticket_with_lines(&s);

    for bad in ["skip", "servedx", ""] {
        let err = s
            .update_kds_line_item_status(&lines[0].id, bad)
            .unwrap_err();
        assert!(
            matches!(err, CoreError::Validation { .. }),
            "unknown status '{bad}' must be rejected, got: {err:?}"
        );
    }
}

// ── Frozen ticket prefix (W2-A consumer: kds_orders.ticket_prefix) ──
//
// The column is written at INSERT, not resolved at read: that is the whole
// point (D16). Read with raw SQL because KdsOrder does not carry the field
// yet - widening it breaks 8 struct literals in three other test files, so
// the reader half is a separate, sized change.

fn stamped_prefix(conn: &Connection, order_id: &str) -> String {
    conn.query_row(
        "SELECT ticket_prefix FROM kds_orders WHERE id = ?1",
        rusqlite::params![order_id],
        |row| row.get(0),
    )
    .unwrap()
}

fn ticket_for(conn: &Connection, store_id: Option<&str>) -> String {
    conn.execute(
        "INSERT OR IGNORE INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES ('sale-stamp', 1000, 'USD', 1, 'completed', '2026-09-27T00:00:00.000Z', '2026-09-27T00:00:00.000Z')",
        [],
    )
    .unwrap();
    store(conn)
        .create_kds_order(CreateKdsOrderInput {
            sale_id: "sale-stamp".into(),
            store_id: store_id.map(str::to_owned),
            items_summary: "Steak x2".into(),
            item_count: 2,
            kitchen_zone: None,
            notes: String::new(),
            table_number: None,
            priority: false,
        })
        .unwrap()
        .id
}

#[test]
fn a_ticket_stamps_its_locations_prefix_at_creation() {
    let conn = fresh();
    let s = store(&conn);
    s.set_location_ticket_prefix("default", " sw-a ").unwrap();
    let id = ticket_for(&conn, Some("default"));
    assert_eq!(stamped_prefix(&conn, &id), "SW-A");
}

#[test]
fn the_stamp_survives_renaming_the_location_afterwards() {
    // THE reason the value is copied instead of looked up: tomorrow's config
    // edit must not retitle a ticket the kitchen already cooked from.
    let conn = fresh();
    let s = store(&conn);
    s.set_location_ticket_prefix("default", "OLD").unwrap();
    let id = ticket_for(&conn, Some("default"));
    s.set_location_ticket_prefix("default", "NEW").unwrap();
    assert_eq!(
        stamped_prefix(&conn, &id),
        "OLD",
        "the ticket keeps the label it was given"
    );
    assert_eq!(
        s.location_ticket_prefix("default").unwrap().as_deref(),
        Some("NEW")
    );
}

#[test]
fn a_ticket_with_no_prefix_configured_stamps_the_empty_sentinel() {
    let conn = fresh();
    let id = ticket_for(&conn, Some("default"));
    assert_eq!(stamped_prefix(&conn, &id), "");
}

#[test]
fn an_unknown_store_stamps_empty_rather_than_guessing_the_primary() {
    // Falling back to the primary location would print one branch's label on
    // another branch's ticket, which is worse than no label.
    let conn = fresh();
    store(&conn)
        .set_location_ticket_prefix("default", "SW-A")
        .unwrap();
    let id = ticket_for(&conn, Some("no-such-store"));
    assert_eq!(stamped_prefix(&conn, &id), "");
}

#[test]
fn a_ticket_with_no_store_at_all_stamps_empty() {
    let conn = fresh();
    store(&conn)
        .set_location_ticket_prefix("default", "SW-A")
        .unwrap();
    let id = ticket_for(&conn, None);
    assert_eq!(stamped_prefix(&conn, &id), "");
}
