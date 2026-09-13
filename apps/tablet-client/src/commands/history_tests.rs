use super::*;
use foundation::Currency;
use oz_core::{Money, SaleLine};

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

fn make_sale_line(sale_id: &str, sku: &str, qty: i64, unit: i64) -> SaleLine {
    SaleLine {
        id: uuid::Uuid::now_v7().to_string(),
        sale_id: sale_id.into(),
        sku: sku.into(),
        qty,
        unit_price: price(unit),
        line_total: price(unit * qty),
        line_position: 1,
        tax_amount: Money::zero(usd()),
        tax_rate_id: None,
        tax_breakdown_json: None,
        serial_number: None,
        course: None,
        modifiers_json: None,
    }
}

// ── SaleListItem ───────────────────────────────────────────────────

// ── F2-7: the estimate note rides the detail DTO ───────────────────

#[test]
fn sale_detail_carries_the_estimate_stamp_when_claimed() {
    let detail = SaleDetail {
        id: "s-est".into(),
        total: price(770),
        line_count: 1,
        status: "Pending".into(),
        payment_method: Some("cash".into()),
        tendered_minor: Some(770),
        user_id: None,
        created_at: "2026-09-10T00:00:00.000Z".into(),
        lines: vec![],
        tax_estimate_note: Some("{\"estimated\":true,\"computed_tax\":70}".into()),
    };
    let json = serde_json::to_value(&detail).unwrap();
    assert_eq!(
        json["taxEstimateNote"], "{\"estimated\":true,\"computed_tax\":70}",
        "the badge source rides the wire camelCase"
    );
}

#[test]
fn sale_detail_serializes_null_when_unstamped() {
    let detail = SaleDetail {
        id: "s-est".into(),
        total: price(770),
        line_count: 1,
        status: "Pending".into(),
        payment_method: None,
        tendered_minor: None,
        user_id: None,
        created_at: "2026-09-10T00:00:00.000Z".into(),
        lines: vec![],
        tax_estimate_note: None,
    };
    let json = serde_json::to_value(&detail).unwrap();
    assert!(
        json["taxEstimateNote"].is_null(),
        "NULL = unstamped — absence must never read as a claim"
    );
}

#[test]
fn sale_list_item_debug() {
    let item = SaleListItem {
        id: "s1".into(),
        total: price(5000),
        line_count: 3,
        status: "completed".into(),
        payment_method: Some("cash".into()),
        user_id: Some("u1".into()),
        created_at: "2025-01-01".into(),
    };
    let d = format!("{item:?}");
    assert!(d.contains("s1"));
    assert!(d.contains("5000"));
    assert!(d.contains("completed"));
    assert!(d.contains("cash"));
}

#[test]
fn sale_list_item_serialize() {
    let item = SaleListItem {
        id: "s2".into(),
        total: price(7500),
        line_count: 1,
        status: "voided".into(),
        payment_method: None,
        user_id: None,
        created_at: "2025-06-01".into(),
    };
    let json = serde_json::to_value(&item).unwrap();
    assert_eq!(json["id"], "s2");
    assert_eq!(json["line_count"], 1);
    assert_eq!(json["status"], "voided");
    assert!(json["payment_method"].is_null());
}

// ── SaleDetail ──────────────────────────────────────────────────────

#[test]
fn sale_detail_debug() {
    let detail = SaleDetail {
        id: "sd1".into(),
        total: price(10000),
        line_count: 2,
        status: "completed".into(),
        payment_method: Some("card".into()),
        tendered_minor: Some(12000),
        user_id: Some("u2".into()),
        created_at: "2025-03-15".into(),
        lines: vec![make_sale_line("sd1", "SKU-A", 2, 5000)],
        tax_estimate_note: None,
    };
    let d = format!("{detail:?}");
    assert!(d.contains("sd1"));
    assert!(d.contains("SKU-A"));
}

#[test]
fn sale_detail_serialize() {
    let detail = SaleDetail {
        id: "sd2".into(),
        total: price(3000),
        line_count: 1,
        status: "completed".into(),
        payment_method: None,
        tendered_minor: None,
        user_id: None,
        created_at: "2025-01-01".into(),
        lines: vec![],
        tax_estimate_note: None,
    };
    let json = serde_json::to_value(&detail).unwrap();
    assert_eq!(json["id"], "sd2");
    assert!(
        json["paymentMethod"].is_null(),
        "camelCase wire: paymentMethod"
    );
    assert!(
        json["tenderedMinor"].is_null(),
        "camelCase wire: tenderedMinor"
    );
    assert!(
        json["taxEstimateNote"].is_null(),
        "camelCase wire: taxEstimateNote"
    );
    assert_eq!(json["lines"].as_array().unwrap().len(), 0);
}

// ── PaymentBreakdown ────────────────────────────────────────────────

#[test]
fn payment_breakdown_debug() {
    let pb = PaymentBreakdown {
        method: "cash".into(),
        count: 15,
        total: 50000,
    };
    let d = format!("{pb:?}");
    assert!(d.contains("cash"));
    assert!(d.contains("15"));
    assert!(d.contains("50000"));
}

#[test]
fn payment_breakdown_serialize() {
    let pb = PaymentBreakdown {
        method: "card".into(),
        count: 42,
        total: 120000,
    };
    let json = serde_json::to_value(&pb).unwrap();
    assert_eq!(json["method"], "card");
    assert_eq!(json["count"], 42);
    assert_eq!(json["total"], 120000);
}

// ── EodReport ───────────────────────────────────────────────────────

#[test]
fn eod_report_debug() {
    let report = EodReport {
        total_sales: 100,
        total_revenue: 500000,
        currency: "IDR".into(),
        payment_breakdown: vec![],
        void_count: 3,
        void_total: 15000,
        discount_count: 10,
        discount_total: 25000,
        hourly_breakdown: vec![],
    };
    let d = format!("{report:?}");
    assert!(d.contains("100"));
    assert!(d.contains("IDR"));
}

#[test]
fn eod_report_serialize() {
    let report = EodReport {
        total_sales: 50,
        total_revenue: 250000,
        currency: "USD".into(),
        payment_breakdown: vec![PaymentBreakdown {
            method: "cash".into(),
            count: 30,
            total: 150000,
        }],
        void_count: 1,
        void_total: 5000,
        discount_count: 5,
        discount_total: 10000,
        hourly_breakdown: vec![],
    };
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["total_sales"], 50);
    assert_eq!(json["currency"], "USD");
    assert_eq!(json["void_count"], 1);
    assert!(!json["payment_breakdown"].as_array().unwrap().is_empty());
}

// ── F-017: the five session-scoped twins must CHECK a permission ────────
//
// `resolve_scope` resolves the session and opens the store database and
// stops there, so a `_scoped` twin that asks nothing after it is a name that
// looks gated and is not — worse than an unscoped door, because it survives
// review. Each case drives the real command twice through the real harness:
// a session whose role lacks the permission must be refused, and the same
// door must open for a session that holds it. Deny comes first in every
// case, because a check that never runs can only fail the deny leg. The
// permission is named by constant, never by a copy of the wire string, and
// the refusal text is checked for what it must not carry.

use oz_core::migrations;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

const HIST_SALE: &str = "s-hist-1";
const DENIED_TOKEN: &str = "tok-no-perm";
const GRANTED_TOKEN: &str = "tok-granted";

/// Global db seeded with the default roles; store-a holds the two roles and
/// two users the doors are tested against, plus one sale row to identify.
fn history_state() -> (AppState, tempfile::TempDir) {
    let conn = migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
    }
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.path().to_path_buf(), migrations::ALL);
    let conn = state.db_manager.open_store("store-a").unwrap();
    let db = conn.lock().unwrap();
    db.execute_batch(
        r#"INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-nope', 'Nope', 'Nothing granted', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
            ('role-full', 'Full', 'Both doors granted', '["sales:view","reports:export"]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at) VALUES
            ('user-nope', 'nope', 'hash-not-a-real-pin', 'Nope', 'role-nope', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
            ('user-full', 'full', 'hash-not-a-real-pin', 'Full', 'role-full', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, user_id, created_at) VALUES
            ('s-hist-1', 12000, 'USD', 1, 'completed', 'user-full', '2026-07-10T09:00:00Z');"#
    )
    .unwrap();
    drop(db);
    (state, temp_dir)
}

fn mint(state: &mut AppState, token: &str, user: &str, role: &str) {
    state.session_store.write().unwrap().insert(
        token.into(),
        oz_core::session::SessionContext::new(
            user.into(),
            role.into(),
            "terminal-1".into(),
            "store-a".into(),
            "ws-a-1".into(),
            "store-pos".into(),
            None,
            0,
        ),
    );
}

fn mock_app(state: AppState) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap()
}

/// The refusal must say no, name nothing it should not, and carry no value.
fn assert_refusal_text(cmd: &str, message: &str) {
    assert!(
        !message.is_empty(),
        "{cmd}: an empty refusal tells the cashier nothing"
    );
    for leak in [DENIED_TOKEN, GRANTED_TOKEN, "hash-not-a-real-pin", "12000"] {
        assert!(
            !message.contains(leak),
            "{cmd}: the refusal leaks a session token, a pin hash or a row value"
        );
    }
}

#[tokio::test]
async fn list_sales_scoped_requires_sales_view() {
    let (mut state, _dir) = history_state();
    mint(&mut state, DENIED_TOKEN, "user-nope", "role-nope");
    mint(&mut state, GRANTED_TOKEN, "user-full", "role-full");
    let app = mock_app(state);

    // Deny first: this is the leg a missing check cannot pass.
    let denied = list_sales_scoped(DENIED_TOKEN.into(), app.state()).await;
    let Err(AppError::PermissionDenied(message)) = denied else {
        panic!("list_sales_scoped let a session without sales:view through: {denied:?}")
    };
    assert_refusal_text("list_sales_scoped", &message);

    // Allow: the same door, same data, one role apart.
    let allowed = list_sales_scoped(GRANTED_TOKEN.into(), app.state()).await;
    assert!(
        matches!(allowed, Ok(_)),
        "list_sales_scoped must still open for a session holding sales:view: {allowed:?}"
    );
}

#[tokio::test]
async fn get_sale_scoped_requires_sales_view() {
    let (mut state, _dir) = history_state();
    mint(&mut state, DENIED_TOKEN, "user-nope", "role-nope");
    mint(&mut state, GRANTED_TOKEN, "user-full", "role-full");
    let app = mock_app(state);

    // Deny first: this is the leg a missing check cannot pass.
    let denied = get_sale_scoped(DENIED_TOKEN.into(), HIST_SALE.into(), app.state()).await;
    let Err(AppError::PermissionDenied(message)) = denied else {
        panic!("get_sale_scoped let a session without sales:view through: {denied:?}")
    };
    assert_refusal_text("get_sale_scoped", &message);

    // Allow: the same door, same data, one role apart.
    let allowed = get_sale_scoped(GRANTED_TOKEN.into(), HIST_SALE.into(), app.state()).await;
    assert!(
        matches!(allowed, Ok(_)),
        "get_sale_scoped must still open for a session holding sales:view: {allowed:?}"
    );
}

#[tokio::test]
async fn export_daily_summary_scoped_requires_reports_export() {
    let (mut state, _dir) = history_state();
    mint(&mut state, DENIED_TOKEN, "user-nope", "role-nope");
    mint(&mut state, GRANTED_TOKEN, "user-full", "role-full");
    let app = mock_app(state);

    // Deny first: this is the leg a missing check cannot pass.
    let denied = export_daily_summary_scoped(DENIED_TOKEN.into(), app.state()).await;
    let Err(AppError::PermissionDenied(message)) = denied else {
        panic!(
            "export_daily_summary_scoped let a session without reports:export through: {denied:?}"
        )
    };
    assert_refusal_text("export_daily_summary_scoped", &message);

    // Allow: the same door, same data, one role apart.
    let allowed = export_daily_summary_scoped(GRANTED_TOKEN.into(), app.state()).await;
    assert!(
        matches!(allowed, Ok(_)),
        "export_daily_summary_scoped must still open for a session holding reports:export: {allowed:?}"
    );
}

#[tokio::test]
async fn export_sales_by_hour_scoped_requires_reports_export() {
    let (mut state, _dir) = history_state();
    mint(&mut state, DENIED_TOKEN, "user-nope", "role-nope");
    mint(&mut state, GRANTED_TOKEN, "user-full", "role-full");
    let app = mock_app(state);

    // Deny first: this is the leg a missing check cannot pass.
    let denied = export_sales_by_hour_scoped(DENIED_TOKEN.into(), app.state()).await;
    let Err(AppError::PermissionDenied(message)) = denied else {
        panic!(
            "export_sales_by_hour_scoped let a session without reports:export through: {denied:?}"
        )
    };
    assert_refusal_text("export_sales_by_hour_scoped", &message);

    // Allow: the same door, same data, one role apart.
    let allowed = export_sales_by_hour_scoped(GRANTED_TOKEN.into(), app.state()).await;
    assert!(
        matches!(allowed, Ok(_)),
        "export_sales_by_hour_scoped must still open for a session holding reports:export: {allowed:?}"
    );
}

#[tokio::test]
async fn export_eod_report_scoped_requires_reports_export() {
    let (mut state, _dir) = history_state();
    mint(&mut state, DENIED_TOKEN, "user-nope", "role-nope");
    mint(&mut state, GRANTED_TOKEN, "user-full", "role-full");
    let app = mock_app(state);

    // Deny first: this is the leg a missing check cannot pass.
    let denied = export_eod_report_scoped(DENIED_TOKEN.into(), app.state()).await;
    let Err(AppError::PermissionDenied(message)) = denied else {
        panic!("export_eod_report_scoped let a session without reports:export through: {denied:?}")
    };
    assert_refusal_text("export_eod_report_scoped", &message);

    // Allow: the same door, same data, one role apart.
    let allowed = export_eod_report_scoped(GRANTED_TOKEN.into(), app.state()).await;
    assert!(
        matches!(allowed, Ok(_)),
        "export_eod_report_scoped must still open for a session holding reports:export: {allowed:?}"
    );
}

// ── KNOWN HAZARD — daily totals count voided sales as revenue ───────
//
/// PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT. INVERT OR DELETE WHEN THE
/// QUERY IS FIXED. Nothing today distinguishes the two numbers this pins, so
/// the pair is asserted side by side: the report is internally inconsistent
/// by construction, and a green run here means the inconsistency is still
/// live, not that it is correct.
///
/// `Store::export_daily_summary` (crates/oz-core/src/db/sales.rs:262-268)
/// filters on DATE only — no status predicate at all — and five consumers
/// then sum or count what comes back: the dashboard tile
/// (ui/src/features/sales/widgets/DailyTotalWidget.tsx), the tablet EOD
/// builder both unscoped (commands/history.rs:205) and scoped (:413), and
/// the desktop bridge path (crates/oz-bridge/src/history.rs:199) which
/// feeds the same daily rows into total_sales and total_revenue at :284 and
/// :330-331. `void_sale` (crates/oz-core/src/db/sales_lifecycle.rs:769-773)
/// sets status to voided and never touches total_minor, so the money of a
/// cancelled sale stays inside the daily total.
///
/// The contamination is status `voided` plus anything still open: `active`
/// and `pending` sit in the same family, because an open till mid-shift is
/// not revenue yet either. (Held carts are NOT a sale status — they live in
/// held_carts — so they are not what this pin is about.)
///
/// Why it is a reconciliation error rather than a cosmetic one: three lines
/// from the unfiltered sum, the same report filters hard — the payment
/// breakdown requires status completed, the void stats require status voided,
/// the discount stats require completed and a discount. So on a day with one
/// void, total_revenue exceeds the sum of the payment breakdown and the void
/// amount is reported twice in one sheet, once inside total_revenue and once
/// as void_total. A drawer counted against payment_breakdown will NOT equal
/// total_revenue, and nothing on the sheet says why.
///
/// What the fix has to DECIDE, which is a product question and not a bug:
/// whether the tile and the EOD header want completed only. Completed-only
/// makes the header agree with the payment breakdown but changes what a
/// merchant reads as a daily total, and the voided amount has to be shown
/// somewhere or it vanishes from the sheet. This test takes no side: it
/// pins both numbers so the day someone adds a status predicate, exactly one
/// of these two assertions flips and names itself.
#[tokio::test]
async fn known_hazard_daily_totals_count_voided_sales_as_revenue() {
    let (mut state, _dir) = history_state();
    let completed_minor: i64 = 4_000;
    let voided_minor: i64 = 1_500;
    let today = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    {
        let conn = state.db_manager.open_store("store-a").unwrap();
        let db = conn.lock().unwrap();
        db.execute(
            r#"INSERT INTO sales
                 (id, total_minor, currency, line_count, status, payment_method, user_id, created_at)
               VALUES ('s-pin-completed', ?1, 'USD', 1, 'completed', 'cash', 'user-full', ?2),
                      ('s-pin-voided',    ?3, 'USD', 1, 'active',   'card', 'user-full', ?2);"#,
            rusqlite::params![completed_minor, today, voided_minor],
        )
        .unwrap();
    }
    // The void goes through the real lifecycle method, not a hand-written
    // UPDATE, and the status is read back: a fixture that silently failed to
    // void cannot produce a green pin.
    let conn = state.db_manager.open_store("store-a").unwrap();
    {
        let db = conn.lock().unwrap();
        let store = Store::new(&db);
        store
            .void_sale("s-pin-voided", "user-full", "pin fixture")
            .expect("the fixture must be able to void its own active sale");
        let back = store
            .get_sale("s-pin-voided")
            .unwrap()
            .expect("voiding must not delete the row");
        assert_eq!(
            back.status,
            oz_core::SaleStatus::Voided,
            "the pin needs a real voided row, got {:?}",
            back.status
        );
        assert_eq!(
            back.total.minor_units, voided_minor,
            "void_sale is expected to leave total_minor alone; if that changed, the hazard this pins changed too"
        );
        let daily = store.export_daily_summary().unwrap();
        assert_eq!(
            daily.len(),
            2,
            "vacuity guard: both seeded sales must come back from the DATE-only query, got {} (ids: {:?})",
            daily.len(),
            daily.iter().map(|r| r.sale_id.clone()).collect::<Vec<_>>()
        );
    }
    drop(conn);
    mint(&mut state, GRANTED_TOKEN, "user-full", "role-full");
    let app = mock_app(state);
    let report = export_eod_report_scoped(GRANTED_TOKEN.into(), app.state())
        .await
        .expect("the EOD twin must answer for a session holding reports:export");

    // Half one: the header counts every row the DATE-only query returned.
    assert_eq!(
        report.total_sales, 2,
        "total_sales counted the voided sale: the header is no longer a row count"
    );
    assert_eq!(
        report.total_revenue,
        completed_minor + voided_minor,
        "total_revenue must equal both rows today; if it now equals the completed-only sum, the query was fixed — invert or delete this pin"
    );

    // Half two: the body of the same report filters, so it disagrees.
    let paid: i64 = report.payment_breakdown.iter().map(|p| p.total).sum();
    assert_eq!(
        paid, completed_minor,
        "the payment breakdown is completed-only; it must still exclude the voided sale for this pin to mean anything"
    );
    assert_eq!(
        report.void_count, 1,
        "the voided row must also be reported as a void, which is the double count"
    );
    assert_eq!(
        report.void_total, voided_minor,
        "the same 1500 rides in void_total and inside total_revenue"
    );

    // The pair, stated as the merchant meets it: a drawer counted against
    // the payment breakdown will not equal the revenue line on the sheet.
    assert_ne!(
        report.total_revenue,
        paid,
        "reconciliation gap of {} minor: total_revenue vs the payment breakdown sum",
        report.total_revenue - paid
    );
}

// ── The EOD report is assembled from TWO day boundaries ────

/// PIN OF A KNOWN HAZARD, NOT AN ENDORSEMENT.
/// INVERT OR DELETE WHEN THE DAY BOUNDARY IS FIXED.
///
/// One `EodReport` is built from two different answers to “what day is it”.
/// The header half applies the store's offset — `Store::export_daily_summary
/// ()` at crates/oz-core/src/db/sales.rs:268 and `export_sales_by_hour` at :290,
/// both `DATE(created_at, tz) = DATE(now, tz)` — while every money sub-query
/// in the SAME struct is bare `date(created_at) = date('now')`: this door at
/// apps/tablet-client/src/commands/history.rs:216, :237, :248; the scoped door
/// at :437, :458, :469; the desktop's `build_eod_report` at
/// crates/oz-bridge/src/history.rs:291, :312, :323. Nine bare clauses, three
/// gated reads, one struct.
///
/// For a +07:00 store the boundaries sit seven hours apart, so a row can be
/// today to `total_revenue` and yesterday to the payment breakdown that is
/// meant to explain it. Generalised: header revenue and payment breakdown are
/// not comparable for ANY non-UTC store, not merely in an evening window.
/// The desktop's three clauses are named and deliberately untested — one lane
/// pinned, the class visible; copying the pin to a second lane makes two tests
/// to keep in step instead of one defect with one name.
///
/// Why nothing has ever caught it. The pin above this one
/// (`known_hazard_daily_totals_count_voided_sales_as_revenue`) seeds both rows
/// at `chrono::Utc::now()`, and a now-created row satisfies the offset
/// predicate and the bare predicate at once because both sides of each shift
/// together: structurally blind, in whichever door runs it. The second
/// blindness is `tz_modifier` (crates/oz-core/src/db/reports.rs:420 to :432),
/// which reads the offset from the `locations` table of whichever database it
/// is handed and falls back to `+00:00` for anything unparseable, IANA names
/// included — exactly what the bare clauses already do, so a misconfigured
/// store makes the two halves AGREE instead of flagging itself. The anti-vacuity
/// block below exists so a failed timezone seed fails loudly instead of passing.
///
/// What a fix has to DECIDE, an owner question and not a bug: either the money
/// sub-queries gain the store modifier, which changes every historical EOD sheet
/// a merchant has printed, or the header drops it, which changes the day a
/// multi-store operator reads off the tile. That is an eight-in-the-morning
/// decision, not a five-in-the-morning commit.
#[tokio::test]
async fn known_hazard_eod_header_and_payment_breakdown_use_different_day_boundaries() {
    const OFFSET_HOURS: i64 = 7;
    let (state, _dir) = history_state();

    // Derived from `now`, not hardcoded: a fixed instant sits in the
    // disagreeing band only while the clock allows it, so a hardcoded pin
    // passes today and rots silently. The time-invariant thing is the CLASS — a
    // row on today's store-local date whose UTC date is not today's UTC date.
    // The control row agrees with both halves, so this cannot pass empty.
    let now = chrono::Utc::now();
    let shift = chrono::Duration::hours(OFFSET_HOURS);
    let local_date = (now + shift).date_naive();
    let mut boundary: Option<chrono::DateTime<chrono::Utc>> = None;
    let mut control: Option<chrono::DateTime<chrono::Utc>> = None;
    for hour in 0..24 {
        let local = local_date
            .and_hms_opt(hour, 30, 0)
            .expect("fixture hour")
            .and_utc();
        let utc = local - shift;
        if (utc + shift).date_naive() != local_date {
            continue;
        }
        if utc.date_naive() != now.date_naive() {
            boundary.get_or_insert(utc);
        } else {
            control.get_or_insert(utc);
        }
    }
    let (boundary_at, control_at) = match (boundary, control) {
        (Some(b), Some(c)) => (b, c),
        _ => panic!("no disagreeing row constructible for +{OFFSET_HOURS}:00"),
    };
    let boundary_local = boundary_at + shift;
    let ts =
        |t: chrono::DateTime<chrono::Utc>| t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let boundary_minor: i64 = 3_300;
    let control_minor: i64 = 1_100;

    {
        let db = state.db.lock().await;
        // tz_modifier reads locations.is_primary = 1 from THIS database and
        // nothing else here creates that row: a missed seed means +00:00, which
        // makes both halves agree and turns this pin green having measured
        // nothing. Asserted before it is trusted.
        db.execute(
            "INSERT INTO locations (id, name, timezone, is_primary) VALUES ('loc-tz-pin', 'TZ Pin', '+07:00', 1)",
            [],
        )
        .expect("seed the primary location with a fixed numeric offset");
        db.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method, user_id, created_at) VALUES ('s-tz-boundary', ?1, 'USD', 1, 'completed', 'cash', 'user-full', ?2)",
            rusqlite::params![boundary_minor, ts(boundary_at)],
        )
        .expect("seed the boundary row");
        db.execute(
            "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method, user_id, created_at) VALUES ('s-tz-control', ?1, 'USD', 1, 'completed', 'card', 'user-full', ?2)",
            rusqlite::params![control_minor, ts(control_at)],
        )
        .expect("seed the control row");

        // Anti-vacuity, all three before any verdict is asserted.
        let seeded_tz: String = db
            .query_row(
                "SELECT timezone FROM locations WHERE is_primary = 1 LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap_or_else(|e| panic!("no primary location row seeded: {e}"));
        assert_eq!(
            seeded_tz, "+07:00",
            "a +00:00 fallback would make the two boundaries agree and this pass empty"
        );
        let rows: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM sales WHERE id IN ('s-tz-boundary','s-tz-control')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            rows, 2,
            "both rows must exist before judging which day they land in"
        );
        let in_header_day: bool = db
            .query_row(
                "SELECT DATE(?1, '+07:00') = DATE('now', '+07:00')",
                rusqlite::params![ts(boundary_at)],
                |r| r.get(0),
            )
            .unwrap();
        let in_body_day: bool = db
            .query_row(
                "SELECT DATE(?1) = DATE('now')",
                rusqlite::params![ts(boundary_at)],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            in_header_day && !in_body_day,
            "boundary row {boundary_local} local must be today for the header and not today ",
        );
    }

    let app = mock_app(state);
    let report = export_eod_report(app.state()).await.expect("eod report");

    // 1. The offset-aware header counts the boundary row.
    assert_eq!(report.total_sales, 2, "the header must see both rows");
    assert_eq!(
        report.total_revenue,
        boundary_minor + control_minor,
        "total_revenue comes from the store-local day, so it includes the boundary row"
    );
    // 2. The payment breakdown, three lines later in the same struct, does not.
    let breakdown_total: i64 = report.payment_breakdown.iter().map(|row| row.total).sum();
    assert_eq!(
        breakdown_total,
        control_minor,
        "the bare-clause breakdown drops the boundary row at {} UTC",
        ts(boundary_at)
    );
    // 3. The naive reconciliation a merchant does on the sheet does not close.
    assert_ne!(
        breakdown_total, report.total_revenue,
        "sum(payment_breakdown) can equal total_revenue only if both halves share a day ",
    );
    assert_eq!(
        report.total_revenue - breakdown_total,
        boundary_minor,
        "the two halves disagree by exactly the boundary row, {OFFSET_HOURS} hours of offset"
    );
}
