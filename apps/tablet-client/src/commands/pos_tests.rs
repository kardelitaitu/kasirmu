use super::*;
use oz_core::Currency;
use oz_core::migrations;
use rusqlite::Connection;

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

#[test]
fn start_cart_add_line() {
    let mut cart = oz_core::Cart::new(usd());
    let cart_id = cart.id();

    let line = CartLine::new(Sku::new("COFFEE"), 2, price(350));
    cart.add_line(line).unwrap();

    assert_eq!(cart.line_count(), 1);
    let total = cart.total();
    assert_eq!(total.unwrap().minor_units, 700);
    assert_eq!(total.unwrap().currency, usd());
    assert!(!cart_id.to_string().is_empty());

    let line2 = CartLine::new(Sku::new("BAGEL"), 1, price(450));
    cart.add_line(line2).unwrap();
    assert_eq!(cart.line_count(), 2);
    assert_eq!(cart.total().unwrap().minor_units, 1150);
}

#[test]
fn cart_total_with_fractional_qty() {
    let mut cart = oz_core::Cart::new(usd());
    let line = CartLine::new(Sku::new("TEA"), 3, price(200));
    let line_total = line.total().unwrap();
    cart.add_line(line).unwrap();
    assert_eq!(line_total.minor_units, 600);
    assert_eq!(cart.total().unwrap().minor_units, 600);
}

#[test]
fn start_sale_args_defaults_currency() {
    let json = r#"{}"#;
    let args: StartSaleArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.currency, "");
}

#[test]
fn add_line_args_deserialize() {
    let json = r#"{"cartId":"550e8400-e29b-41d4-a716-446655440000","sku":"COFFEE","qty":3,"unitPriceMinor":350}"#;
    let args: AddLineArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.sku.as_str(), "COFFEE");
    assert_eq!(args.qty, 3);
    assert_eq!(args.unit_price_minor, 350);
}

#[test]
fn set_cart_discount_args_deserialize() {
    let json = r#"{"cartId":"660e8400-e29b-41d4-a716-446655440001","percent":10,"label":"Senior Discount","userId":"u1"}"#;
    let args: SetCartDiscountArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.percent, 10);
    assert_eq!(args.label, Some("Senior Discount".into()));
    assert_eq!(args.user_id, "u1");
}

#[test]
fn complete_sale_args_deserialize_minimal() {
    let json =
        r#"{"cartId":"770e8400-e29b-41d4-a716-446655440002","paymentMethod":"cash","userId":"u2"}"#;
    let args: CompleteSaleArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.payment_method, "cash");
    assert!(args.tendered_minor.is_none());
    assert!(args.customer_id.is_none());
    assert!(args.serial_numbers.is_none());
}

// ── Bug #2: override_cart_deduction_location permission check ───

fn fresh_conn() -> Connection {
    migrations::fresh_db()
}

/// Seed a user with ONLY sales:process permission (no SALES_OVERRIDE_PRICE).
/// role-lite: a narrow custom role — the new role-staff preset grants
/// sales:override_price, which would flip the rejection below (0048
/// retirement sweep).
fn seed_cashier_without_override_permission(conn: &Connection, user_id: &str) {
    conn.execute_batch(&format!(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-lite', 'Lite', 'Limited sales', '[\"sales:process\"]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, display_name, role_id, pin_hash, is_active, created_at, updated_at) VALUES
            ('{user_id}', '{user_id}', 'Cashier', 'role-lite', 'hashed', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    )).unwrap();
}

/// Seed a user with SALES_OVERRIDE_PRICE permission.
fn seed_manager_with_override_permission(conn: &Connection, user_id: &str) {
    conn.execute_batch(&format!(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-manager', 'Manager', 'Manager', '[\"sales:override_price\"]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, display_name, role_id, pin_hash, is_active, created_at, updated_at) VALUES
            ('{user_id}', '{user_id}', 'Manager', 'role-manager', 'hashed', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    )).unwrap();
}
/// Insert an active cart row and return its `CartId`.
/// Also seeds a minimal inventory_location row so the FK on
/// `deduction_location_id` is satisfied.
fn seed_active_cart(conn: &Connection) -> CartId {
    // Satisfy the FK from active_carts.deduction_location_id → inventory_locations(id).
    conn.execute(
        "INSERT OR IGNORE INTO inventory_locations (id, name, created_at, updated_at)
         VALUES ('loc-warehouse-1', 'Warehouse', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let cart = oz_core::Cart::new("USD".parse::<Currency>().unwrap());
    let cart_id = cart.id();
    let cart_data = serde_json::to_string(&cart).unwrap();
    conn.execute(
        "INSERT INTO active_carts (id, cart_data, deduction_location_id, updated_at)
         VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        rusqlite::params![cart_id.to_string(), cart_data, "loc-warehouse-1"],
    )
    .unwrap();
    cart_id
}

#[test]
fn override_cart_deduction_location_rejects_user_without_sales_override_price() {
    // Bug #2: the non-scoped command had NO permission check, so any
    // caller could override a deduction location — a silent privilege
    // bypass. After the fix, a user without SALES_OVERRIDE_PRICE must
    // be rejected before the DB write executes.
    let conn = fresh_conn();
    seed_cashier_without_override_permission(&conn, "user-cashier");
    let cart_id = seed_active_cart(&conn);

    let result = run_override_cart_deduction_location(&conn, "user-cashier", &cart_id);

    assert!(
        result.is_err(),
        "Bug #2: override lacked permission check — \
         cashier without SALES_OVERRIDE_PRICE must be rejected"
    );
    let err = result.unwrap_err().to_string();
    assert!(
        err.to_lowercase().contains("permission") || err.to_lowercase().contains("denied"),
        "error must mention permission/denied, got: {err}"
    );
}

#[test]
fn override_cart_deduction_location_allows_user_with_sales_override_price() {
    // Happy-path regression: a manager with SALES_OVERRIDE_PRICE should
    // succeed — the permission check must not reject authorised users.
    let conn = fresh_conn();
    seed_manager_with_override_permission(&conn, "user-mgr");
    let cart_id = seed_active_cart(&conn);

    let result = run_override_cart_deduction_location(&conn, "user-mgr", &cart_id);

    assert!(
        result.is_ok(),
        "manager with SALES_OVERRIDE_PRICE must be allowed, got: {:?}",
        result.err()
    );
}

#[test]
fn override_cart_deduction_location_fails_for_nonexistent_cart() {
    // Edge case: permission check passes but the cart doesn't exist.
    let conn = fresh_conn();
    seed_manager_with_override_permission(&conn, "user-mgr");

    // Create a CartId that won't exist in the DB.
    let cart_id = oz_core::Cart::new("USD".parse::<Currency>().unwrap()).id();
    let result = run_override_cart_deduction_location(&conn, "user-mgr", &cart_id);

    assert!(
        result.is_err(),
        "nonexistent cart must fail after permission check"
    );
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("not found") || err.contains("active_cart"),
        "error must mention not-found, got: {err}"
    );
}

// ── Bug #3: add_line_scoped session authorization ──────────────

/// Seed a user with NO sales permissions at all.
fn seed_user_without_sales_process(conn: &Connection, user_id: &str) {
    conn.execute_batch(&format!(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at) VALUES
            ('role-no-sales', 'No Sales', 'No sales permissions', '[]', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, display_name, role_id, pin_hash, is_active, created_at, updated_at) VALUES
            ('{user_id}', '{user_id}', 'No Sales', 'role-no-sales', 'hashed', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    )).unwrap();
}

#[test]
fn add_line_scoped_rejects_user_without_sales_process() {
    // Bug #3: add_line_scoped resolved the session but stored it as
    // _session (unused). A user without SALES_PROCESS could add lines
    // to any cart — a silent authorization gap. After the fix, the
    // permission check must reject unprivileged users.
    let conn = fresh_conn();
    seed_user_without_sales_process(&conn, "user-no-sales");
    let cart_id = seed_active_cart(&conn);

    let args = AddLineArgs {
        cart_id,
        sku: Sku::new("COFFEE"),
        qty: 1,
        unit_price_minor: 350,
        unit_price_currency: None,
    };
    let result = run_add_line_scoped(&conn, "user-no-sales", &args);

    assert!(
        result.is_err(),
        "Bug #3: add_line_scoped lacked SALES_PROCESS check — \
         user without sales:process must be rejected"
    );
    let err = result.unwrap_err().to_string();
    assert!(
        err.to_lowercase().contains("permission") || err.to_lowercase().contains("denied"),
        "error must mention permission/denied, got: {err}"
    );
}

#[test]
fn add_line_scoped_allows_user_with_sales_process() {
    // Happy-path regression: a cashier with SALES_PROCESS must be
    // able to add lines to a cart with a deduction_location lock.
    let conn = fresh_conn();
    // seed_cashier_without_override_permission gives the user sales:process
    seed_cashier_without_override_permission(&conn, "user-cashier");
    let cart_id = seed_active_cart(&conn);

    let args = AddLineArgs {
        cart_id,
        sku: Sku::new("LATTE"),
        qty: 2,
        unit_price_minor: 450,
        unit_price_currency: None,
    };
    let result = run_add_line_scoped(&conn, "user-cashier", &args);

    assert!(
        result.is_ok(),
        "cashier with SALES_PROCESS must be allowed to add lines, got: {:?}",
        result.err()
    );
    let r = result.unwrap();
    assert_eq!(r.line_total.unwrap().minor_units, 900);
}

// ── FRONTEND-03: line currency crosses the IPC boundary ─────────

#[test]
fn line_unit_price_uses_wire_currency_over_cart_currency() {
    let args = AddLineArgs {
        cart_id: CartId::new(),
        sku: Sku::new("IMPORT"),
        qty: 1,
        unit_price_minor: 500,
        unit_price_currency: Some("EUR".into()),
    };
    let money = line_unit_price(&args, usd()).unwrap();
    assert_eq!(money.currency, "EUR".parse::<Currency>().unwrap());
    assert_eq!(money.minor_units, 500);
}

#[test]
fn line_unit_price_falls_back_to_cart_currency_when_absent() {
    let args = AddLineArgs {
        cart_id: CartId::new(),
        sku: Sku::new("COFFEE"),
        qty: 1,
        unit_price_minor: 350,
        unit_price_currency: None,
    };
    let money = line_unit_price(&args, usd()).unwrap();
    assert_eq!(money.currency, usd());
}

#[test]
fn line_unit_price_rejects_invalid_currency() {
    let args = AddLineArgs {
        cart_id: CartId::new(),
        sku: Sku::new("COFFEE"),
        qty: 1,
        unit_price_minor: 350,
        unit_price_currency: Some("NOPE!".into()),
    };
    let err = line_unit_price(&args, usd()).unwrap_err();
    assert!(
        err.to_string().to_lowercase().contains("currency"),
        "invalid currency must surface as a clear error, got: {err}"
    );
}

// ── FRONTEND-03 follow-up: shortfall line currency ─────────────

#[test]
fn cart_line_data_unit_price_currency_shape() {
    let with_cur: CartLineData = serde_json::from_str(
        r#"{"sku":"IMPORT","qty":2,"unitPriceMinor":500,"unitPriceCurrency":"EUR"}"#,
    )
    .unwrap();
    assert_eq!(with_cur.unit_price_currency.as_deref(), Some("EUR"));
    let without_cur: CartLineData =
        serde_json::from_str(r#"{"sku":"COFFEE","qty":1,"unitPriceMinor":350}"#).unwrap();
    assert_eq!(without_cur.unit_price_currency, None);
}

#[test]
fn shortfall_line_unit_price_uses_wire_currency_over_sale_currency() {
    let line_data = CartLineData {
        sku: "IMPORT".into(),
        qty: 1,
        unit_price_minor: 500,
        unit_price_currency: Some("EUR".into()),
    };
    let money = shortfall_line_unit_price(&line_data, usd()).unwrap();
    assert_eq!(money.currency, "EUR".parse::<Currency>().unwrap());
    assert_eq!(money.minor_units, 500);
}

#[test]
fn shortfall_line_unit_price_falls_back_to_sale_currency_when_absent() {
    let line_data = CartLineData {
        sku: "COFFEE".into(),
        qty: 1,
        unit_price_minor: 350,
        unit_price_currency: None,
    };
    let money = shortfall_line_unit_price(&line_data, usd()).unwrap();
    assert_eq!(money.currency, usd());
}

#[test]
fn shortfall_line_unit_price_rejects_invalid_currency() {
    let line_data = CartLineData {
        sku: "COFFEE".into(),
        qty: 1,
        unit_price_minor: 350,
        unit_price_currency: Some("NOPE!".into()),
    };
    let err = shortfall_line_unit_price(&line_data, usd()).unwrap_err();
    assert!(
        err.to_string().to_lowercase().contains("currency"),
        "invalid currency must surface as a clear error, got: {err}"
    );
}

#[test]
fn add_line_scoped_rejects_cross_currency_line() {
    // FRONTEND-03 end-to-end: an EUR-priced line added to the seeded USD
    // cart must be REJECTED. Before the fix the command re-stamped the
    // line as USD (the wire carried no currency), so Cart::add_line's
    // mismatch check could never fire and the sale silently recorded the
    // wrong currency for the product.
    let conn = fresh_conn();
    seed_cashier_without_override_permission(&conn, "user-cashier");
    let cart_id = seed_active_cart(&conn);

    let args = AddLineArgs {
        cart_id,
        sku: Sku::new("EUR-COFFEE"),
        qty: 1,
        unit_price_minor: 500,
        unit_price_currency: Some("EUR".into()),
    };
    let result = run_add_line_scoped(&conn, "user-cashier", &args);

    assert!(
        result.is_err(),
        "cross-currency line must be rejected, got Ok: {:?}",
        result.ok()
    );
    let err = result.unwrap_err().to_string();
    assert!(
        err.to_lowercase().contains("currency"),
        "error must mention the currency mismatch, got: {err}"
    );
}

/// ADR #7: the scoped deduction-location lookup must authenticate, not merely accept a token
/// argument. `add_line_scoped` once resolved its session into an unused `_session` and shipped a
/// silent authorization gap -- the regression documented by
/// `add_line_scoped_rejects_user_without_sales_process` above -- so at the call site a scoped
/// command that ignores its token is indistinguishable from one that checks it.
///
/// `resolve_session` already has its own tests, so this does not re-prove the resolver; it proves
/// the command actually calls it before touching the store. That is the property a reader cannot
/// infer from `let _session = ...`, and the reason this test reaches through
/// `tauri::test::mock_builder` (the pattern `analytics_tests.rs` establishes) instead of testing a
/// `run_*` helper like the cases above: the authentication lives in the wrapper, not the helper.
#[tokio::test]
async fn get_cart_deduction_location_scoped_rejects_invalid_token() {
    // Imported here rather than at the top of the file: `.state()` on the built app comes from the
    // Manager trait, and the other 20-odd cases here are synchronous `run_*` tests that never need
    // it. analytics_tests.rs brings it in file-wide because every case there builds an app.
    use tauri::Manager as _;

    let conn = fresh_conn();
    let cart_id = seed_active_cart(&conn);
    let state = AppState::for_test_with_conn(conn);
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    let result =
        get_cart_deduction_location_scoped("never-minted-token".into(), cart_id, app.state()).await;
    assert!(
        matches!(result, Err(AppError::InvalidSession)),
        "an unauthenticated call must not reach the store, got: {result:?}",
    );
}
// ── Tax scope at the command layer (tax-separation P1) ─────────────

fn single_line_cart() -> oz_core::Cart {
    let mut cart = oz_core::Cart::new(usd());
    cart.add_line(oz_core::CartLine::new(Sku::new("COFFEE"), 2, price(350)))
        .unwrap();
    cart
}

#[test]
fn tax_scope_now_carries_the_location_and_a_date_the_resolver_accepts() {
    // The command layer owns the business date, so it owns getting the shape
    // right. A scope the core resolver rejects fails EVERY sale at this
    // location — loudly, which is the intended failure mode, but loudly at
    // checkout is still a broken checkout.
    let scope = tax_scope_now("loc-42");
    assert_eq!(
        scope.location_id, "loc-42",
        "the session's store id must pass through unchanged"
    );
    chrono::NaiveDate::parse_from_str(&scope.as_of, "%Y-%m-%d").unwrap_or_else(|e| {
        panic!(
            "as_of must be a bare business date the resolver parses, got {:?}: {e}",
            scope.as_of
        )
    });
}

#[test]
fn a_store_scoped_rate_wins_over_the_tenant_default_through_the_command_door() {
    // Core proves the resolver. This pins the exact call shape pos.rs uses —
    // tax_scope_now + compute_sale_tax_for_location + the settings rounding
    // mode — so a location with its own rate stops inheriting the tenant
    // default at the command layer, and does not leak it next door.
    let db = oz_core::migrations::fresh_db();
    let store = Store::new(&db);
    db.execute(
        "INSERT INTO legal_entities (id, tenant_id, name) VALUES ('ent-1', 'default', 'Ent')",
        [],
    )
    .unwrap();
    for (id, name) in [("loc-here", "Here"), ("loc-there", "There")] {
        db.execute(
            "INSERT INTO locations (id, name, legal_entity_id) VALUES (?1, ?2, 'ent-1')",
            rusqlite::params![id, name],
        )
        .unwrap();
    }
    store
        .create_tax_rate("National VAT", 1000, true, false)
        .unwrap();
    db.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, is_active, location_id)
         VALUES ('r-here', 'Here VAT', 1100, 0, 0, 1, 'loc-here')",
        [],
    )
    .unwrap();
    let mode = oz_core::Settings::get_tax_rounding_mode(&db).unwrap();

    let mut here = oz_core::Sale::from_cart(&single_line_cart()).unwrap();
    store
        .compute_sale_tax_for_location(&mut here, &[], mode, Some(&tax_scope_now("loc-here")))
        .unwrap();
    assert_eq!(here.lines[0].tax_rate_id.as_deref(), Some("r-here"));
    assert_eq!(here.tax_total.minor_units, 77, "11% of 700");

    let mut there = oz_core::Sale::from_cart(&single_line_cart()).unwrap();
    store
        .compute_sale_tax_for_location(&mut there, &[], mode, Some(&tax_scope_now("loc-there")))
        .unwrap();
    assert_eq!(
        there.tax_total.minor_units, 70,
        "the neighbouring branch keeps the tenant default"
    );

    // The regression this exists to catch: if a future edit drops the scope
    // argument, loc-here silently gets THIS number.
    let mut forgot = oz_core::Sale::from_cart(&single_line_cart()).unwrap();
    store.compute_sale_tax(&mut forgot, &[], mode).unwrap();
    assert_eq!(forgot.tax_total.minor_units, 70);
}
