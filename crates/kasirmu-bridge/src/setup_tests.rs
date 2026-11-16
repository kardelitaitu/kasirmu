//! Tests for the bridge's setup / first-run provisioning surface (ADR #56).
//!
//! This file REPLACED a suite built around `complete_setup` and the two setup
//! booleans. Those are retired (§2.2), so their tests could not survive — but
//! the properties they pinned did not all belong to the command, and the ones
//! that did not are kept below.
//!
//! What is deliberately NOT re-tested here: the provisioning transaction. It
//! is covered by 21 tests in `kasirmu_core::db::provisioning` — the guard, the
//! replay, the rollback, both schema CHECKs and the workspace topology.
//! Re-asserting it through this shim would be the mirrored-copy failure mode
//! this module's own history warns about.

use super::*;
use crate::testing::TestBridge;

fn fresh_conn() -> rusqlite::Connection {
    crate::testing::temp_conn()
}

/// Seed the two rows `provisioning` carries foreign keys to.
///
/// `provisioning.location_id` REFERENCES `locations(id)` and
/// `owner_user_id` REFERENCES `users(id)`, so a fixture naming an unseeded id
/// is refused by SQLite — which is the constraint working, not an obstacle to
/// route around.
fn seed_refs(conn: &rusqlite::Connection) {
    conn.execute_batch(
        "INSERT INTO locations (id, name) VALUES ('loc-1', 'Main');
         INSERT INTO roles (id, name) VALUES ('owner', 'Owner');
         INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('user-1', 'owner', 'x', 'Owner', 'owner');",
    )
    .unwrap();
}

// ── The derived first-run state (ADR #56 §2.1) ──────────────────────

#[tokio::test]
async fn first_run_state_is_unprovisioned_with_no_row() {
    // The replacement for "get_setup_status returns not completed when the key
    // is absent". Note what this CANNOT be fooled by: no row and no legacy
    // dismissal key, which is a fresh install exactly.
    let tb = TestBridge::new();
    let state = get_first_run_state(&tb.ctx(), "dev-1").await.unwrap();
    assert!(matches!(state, FirstRunStateDto::Unprovisioned));
}

#[tokio::test]
async fn the_retired_setup_keys_cannot_forge_a_provisioned_terminal() {
    // The counter-example that makes the test above worth having. `SETUP_COMPLETE`
    // is the retired wizard's other boolean and must move nothing; the legacy
    // dismissal key is NOT set here, so this is also the "the key is absent"
    // leg — see `a_terminal_with_no_legacy_signal_is_never_backfilled`.
    let tb = TestBridge::new();
    {
        let ctx = tb.ctx();
        let db = ctx.lock_global().await;
        Settings::set(&db, kasirmu_core::settings::keys::SETUP_COMPLETE, "1").unwrap();
    }

    let state = get_first_run_state(&tb.ctx(), "dev-1").await.unwrap();
    assert!(
        matches!(state, FirstRunStateDto::Unprovisioned),
        "ADR #56 §2.1: the row is the gate, so no legacy key may forge a provisioned terminal"
    );
}

// ── The runtime legacy backfill ─────────────────────────────────────
//
// The SQL migration 20261008 does the same job from SQL, keyed on
// `terminals.device_id`. It cannot help a legacy install that never registered a
// terminal row — which is exactly the device that reported this bug — because
// SQL cannot read the hostname the shell gates on. `get_first_run_state` is
// handed that hostname, so the backfill runs there. The three legs below mirror
// the migration's own tests (`migrations_tests.rs`):
//   legacy_setup_backfills_a_provisioning_row_only_for_terminals_the_wizard_set_up
//   a_terminal_without_the_legacy_signal_is_never_backfilled

/// Plant the legacy-only signal the two retired commands wrote.
async fn plant_legacy_dismissal(tb: &TestBridge) {
    let ctx = tb.ctx();
    let db = ctx.lock_global().await;
    Settings::set(
        &db,
        kasirmu_core::settings::keys::SHOW_SETUP_WIZARD,
        "false",
    )
    .unwrap();
}

/// Count the provisioning rows for one terminal, straight from the table.
async fn provisioning_rows(tb: &TestBridge, terminal_id: &str) -> i64 {
    let ctx = tb.ctx();
    let db = ctx.lock_global().await;
    db.query_row(
        "SELECT COUNT(*) FROM provisioning WHERE terminal_id = ?1",
        [terminal_id],
        |r| r.get(0),
    )
    .unwrap()
}

#[tokio::test]
async fn a_legacy_setup_device_is_backfilled_and_reads_as_provisioned() {
    // The bug this closes, in the shape the real device has: a fully set-up,
    // signed-in legacy install with NO `terminals` row at all, so the SQL
    // migration has nothing to key on and inserts nothing for it.
    let tb = TestBridge::new();
    plant_legacy_dismissal(&tb).await;

    let state = get_first_run_state(&tb.ctx(), "legacy-host").await.unwrap();
    match state {
        FirstRunStateDto::Provisioned {
            location_id,
            owner_user_id,
            mode,
            home_region,
            tenant_id,
        } => {
            // Exactly the migration's row shape for its legacy case: `local`,
            // residency `global`, and NULL tenant/owner/location because the
            // legacy install had none of those facts to claim.
            assert_eq!(mode, "local");
            assert_eq!(home_region, "global");
            assert_eq!(tenant_id, None);
            assert_eq!(owner_user_id, None);
            assert_eq!(location_id, None);
        }
        FirstRunStateDto::Unprovisioned => {
            panic!("a legacy device whose wizard completed must not re-enter onboarding")
        }
    }

    assert_eq!(
        provisioning_rows(&tb, "legacy-host").await,
        1,
        "the row is what the next boot reads; the state alone would not persist"
    );
}

#[tokio::test]
async fn a_terminal_with_no_legacy_signal_is_never_backfilled() {
    // The leg that protects a GENUINELY NEW install: no key at all, which is
    // what a fresh ADR-#56 database looks like (`provision_device` never writes
    // this key and no migration seeds one). A forged row here would silently
    // skip onboarding — strictly worse than the bug being fixed.
    let tb = TestBridge::new();
    assert!(matches!(
        get_first_run_state(&tb.ctx(), "new-host").await.unwrap(),
        FirstRunStateDto::Unprovisioned
    ));
    assert_eq!(provisioning_rows(&tb, "new-host").await, 0);

    // A present-but-not-`"false"` value is the wizard's "show me" state, not a
    // completion. `store.setup_complete` is the CLI's DIFFERENT key and is not
    // the dismissal either.
    {
        let ctx = tb.ctx();
        let db = ctx.lock_global().await;
        Settings::set(&db, kasirmu_core::settings::keys::SHOW_SETUP_WIZARD, "true").unwrap();
        Settings::set(&db, kasirmu_core::settings::keys::SETUP_COMPLETE, "true").unwrap();
    }
    assert!(
        matches!(
            get_first_run_state(&tb.ctx(), "new-host").await.unwrap(),
            FirstRunStateDto::Unprovisioned
        ),
        "only 'false' is the dismissal the retired commands wrote"
    );
    assert_eq!(provisioning_rows(&tb, "new-host").await, 0);
}

#[tokio::test]
async fn the_legacy_backfill_is_idempotent_and_never_overwrites() {
    // Boot happens many times per device, so the backfill must be a no-op after
    // the first write. A duplicate is impossible (`terminal_id` is the PRIMARY
    // KEY) and an overwrite is what this pins: the row a real provisioning run
    // wrote must survive a legacy-keyed re-read untouched.
    let tb = TestBridge::new();
    plant_legacy_dismissal(&tb).await;

    get_first_run_state(&tb.ctx(), "legacy-host").await.unwrap();
    let first = {
        let ctx = tb.ctx();
        let db = ctx.lock_global().await;
        db.query_row(
            "SELECT provisioned_at FROM provisioning WHERE terminal_id = 'legacy-host'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap()
    };

    let second = get_first_run_state(&tb.ctx(), "legacy-host").await.unwrap();
    assert!(matches!(second, FirstRunStateDto::Provisioned { .. }));
    assert_eq!(
        provisioning_rows(&tb, "legacy-host").await,
        1,
        "a second boot must not duplicate the row"
    );
    let again = {
        let ctx = tb.ctx();
        let db = ctx.lock_global().await;
        db.query_row(
            "SELECT provisioned_at FROM provisioning WHERE terminal_id = 'legacy-host'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap()
    };
    assert_eq!(
        first, again,
        "the existing row must be replayed, not rewritten"
    );

    // And the other direction: a terminal a REAL provisioning run already set up
    // keeps its tenant/owner even though the legacy key is also present.
    let conn = fresh_conn();
    seed_refs(&conn);
    Store::new(&conn)
        .provision_terminal(&kasirmu_core::db::provisioning::ProvisioningRecord {
            terminal_id: "dev-1".into(),
            tenant_id: None,
            location_id: Some("loc-1".into()),
            owner_user_id: Some("user-1".into()),
            device_id: None,
            mode: kasirmu_core::db::provisioning::ProvisioningMode::Local,
            home_region: "global".into(),
            provisioned_at: String::new(),
        })
        .unwrap();
    let tb = TestBridge::new().with_conn(conn);
    plant_legacy_dismissal(&tb).await;
    match get_first_run_state(&tb.ctx(), "dev-1").await.unwrap() {
        FirstRunStateDto::Provisioned {
            owner_user_id,
            location_id,
            ..
        } => {
            assert_eq!(owner_user_id.as_deref(), Some("user-1"));
            assert_eq!(location_id.as_deref(), Some("loc-1"));
        }
        FirstRunStateDto::Unprovisioned => panic!("an existing row must read as provisioned"),
    }
}

#[tokio::test]
async fn a_provisioning_row_is_what_makes_a_terminal_provisioned() {
    // The positive leg, and the only one that can produce `Provisioned`: the
    // gate reads a real row through the same accessor the shell's command uses.
    let conn = fresh_conn();
    seed_refs(&conn);
    let store = Store::new(&conn);
    store
        .provision_terminal(&kasirmu_core::db::provisioning::ProvisioningRecord {
            terminal_id: "dev-1".into(),
            tenant_id: None,
            location_id: Some("loc-1".into()),
            owner_user_id: Some("user-1".into()),
            device_id: None,
            mode: kasirmu_core::db::provisioning::ProvisioningMode::Local,
            home_region: "global".into(),
            provisioned_at: String::new(),
        })
        .unwrap();

    let tb = TestBridge::new().with_conn(conn);
    let state = get_first_run_state(&tb.ctx(), "dev-1").await.unwrap();
    match state {
        FirstRunStateDto::Provisioned {
            location_id,
            owner_user_id,
            mode,
            home_region,
            tenant_id,
        } => {
            assert_eq!(location_id.as_deref(), Some("loc-1"));
            assert_eq!(owner_user_id.as_deref(), Some("user-1"));
            assert_eq!(mode, "local");
            assert_eq!(home_region, "global");
            assert_eq!(tenant_id, None);
        }
        FirstRunStateDto::Unprovisioned => panic!("a stored row must read as provisioned"),
    }
}

#[tokio::test]
async fn the_gate_is_keyed_per_terminal() {
    // §5 Q4: a tablet can be replaced independently of the store, so the
    // question is per-device. Provisioning one must not answer for its
    // neighbour — the failure this prevents is a second terminal silently
    // inheriting the first one's setup.
    let conn = fresh_conn();
    seed_refs(&conn);
    Store::new(&conn)
        .provision_terminal(&kasirmu_core::db::provisioning::ProvisioningRecord {
            terminal_id: "dev-1".into(),
            tenant_id: None,
            location_id: Some("loc-1".into()),
            owner_user_id: None,
            device_id: None,
            mode: kasirmu_core::db::provisioning::ProvisioningMode::Local,
            home_region: "global".into(),
            provisioned_at: String::new(),
        })
        .unwrap();

    let tb = TestBridge::new().with_conn(conn);
    assert!(matches!(
        get_first_run_state(&tb.ctx(), "dev-1").await.unwrap(),
        FirstRunStateDto::Provisioned { .. }
    ));
    assert!(matches!(
        get_first_run_state(&tb.ctx(), "dev-2").await.unwrap(),
        FirstRunStateDto::Unprovisioned
    ));
}

// ── Enabled features (unchanged surface) ────────────────────────────

#[tokio::test]
async fn enabled_features_reads_the_feature_registry() {
    let conn = fresh_conn();
    let tb = TestBridge::new().with_conn(conn);
    // A fresh store has no enabled features; the read must answer, not fail.
    let result = get_enabled_features(&tb.ctx()).await.unwrap();
    assert!(result.features.is_empty());
}

// ── Pilot Merchant Provisioning Simulation (Day 2 · ADR #56 §2 / docs/operations/pilot-merchant-onboarding.md) ──

#[tokio::test]
async fn pilot_merchant_first_run_provisioning_simulation_end_to_end() {
    // Operational guide: docs/operations/pilot-merchant-onboarding.md §2
    // 5-minute onboarding flow:
    // [Step 1: Device Link] -> [Step 2: Store Profile] -> [Step 3: Tax Preset] -> [Step 4: Hardware Check] -> [Step 5: First Sale]
    // + End of Day (EOD) Reconciliation & Shift Closure
    let tb = TestBridge::new();
    let terminal_id = "pilot-tablet-01";

    // Pre-condition: fresh installation is unprovisioned
    let initial_state = get_first_run_state(&tb.ctx(), terminal_id).await.unwrap();
    assert!(matches!(initial_state, FirstRunStateDto::Unprovisioned));

    // ── Step 1 & 2: Local Standalone Provisioning & Store Profile ──
    // Merchant: Warung Kopi Nusantara, Asia/Jakarta, IDR locked
    let args = ProvisionDeviceArgs {
        terminal_id: terminal_id.into(),
        location_name: "Warung Kopi Nusantara".into(),
        currency: "IDR".into(),
        timezone: "Asia/Jakarta".into(),
        owner_username: "budi".into(),
        owner_display_name: "Budi Santoso".into(),
        owner_pin: "8888".into(),
        preset: "restaurant".into(),
        features: kasirmu_core::features::preset_feature_keys("restaurant").unwrap(),
        location_kind: LocationKind::Restaurant,
        mode: ProvisioningMode::Local,
        tenant_id: None,
        device_credential_id: None,
        tax_preset: Some("ppn11_service5".into()),
        seed_sample_products: Some(true),
    };

    let result = provision_device(&tb.ctx(), args).await.unwrap();
    assert_eq!(result.terminal_id, terminal_id);
    let location_id = result.location_id;
    assert!(!location_id.is_empty());
    assert!(!result.owner_user_id.is_empty());

    // Verify first-run state is now provisioned
    let state = get_first_run_state(&tb.ctx(), terminal_id).await.unwrap();
    match state {
        FirstRunStateDto::Provisioned {
            location_id: loc,
            mode,
            home_region,
            owner_user_id,
            tenant_id,
        } => {
            assert_eq!(loc.as_deref(), Some(location_id.as_str()));
            assert_eq!(mode, "local");
            assert_eq!(home_region, "global");
            assert_eq!(
                owner_user_id.as_deref(),
                Some(result.owner_user_id.as_str())
            );
            assert_eq!(tenant_id, None);
        }
        FirstRunStateDto::Unprovisioned => panic!("must be provisioned after provision_device"),
    }

    // ── Step 3: Tax Preset & Seeded Sample Catalog ──
    {
        let ctx = tb.ctx();
        let db = ctx.lock_global().await;

        // Assert location profile matches Warung Kopi Nusantara
        let (loc_name, loc_curr, loc_tz, is_primary): (String, String, String, i32) = db
            .query_row(
                "SELECT name, currency, timezone, is_primary FROM locations WHERE id = ?1",
                [&location_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(loc_name, "Warung Kopi Nusantara");
        assert_eq!(loc_curr, "IDR");
        assert_eq!(loc_tz, "Asia/Jakarta");
        // is_primary is 0 when a primary location already exists in the baseline DB (idx_locations_primary)
        assert_eq!(is_primary, 0);

        // Assert tax presets: PPN 11% (1100 bps, default) + Service Charge 5% (500 bps)
        let tax_rates: Vec<(String, i64, i32)> = db
            .prepare("SELECT name, rate_bps, is_default FROM tax_rates ORDER BY rate_bps DESC")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(tax_rates.len(), 2);
        assert_eq!(tax_rates[0].0, "PPN 11%");
        assert_eq!(tax_rates[0].1, 1100);
        assert_eq!(tax_rates[0].2, 1); // default
        assert_eq!(tax_rates[1].0, "Service Charge 5%");
        assert_eq!(tax_rates[1].1, 500);
        assert_eq!(tax_rates[1].2, 0);

        // Assert seeded starter catalog has 5 items
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 5);

        // Assert workspace topology created for restaurant (restaurant-pos, warehouse, admin, kds)
        let workspaces: Vec<String> = db
            .prepare(
                "SELECT type_key FROM workspace_instances WHERE location_id = ?1 ORDER BY type_key",
            )
            .unwrap()
            .query_map([&location_id], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert!(workspaces.contains(&"restaurant-pos".to_string()));
        assert!(workspaces.contains(&"warehouse".to_string()));
        assert!(workspaces.contains(&"admin".to_string()));
        assert!(workspaces.contains(&"kds".to_string()));

        // Assert Free subscription bootstrapped
        let tier: String = db
            .query_row(
                "SELECT tier_key FROM tenant_subscription WHERE tenant_id = 'default'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tier, "free");
    }

    // Also verify the alternate tax preset 'ppn11' standalone seeding on a separate DB
    {
        let conn2 = fresh_conn();
        let tb2 = TestBridge::new().with_conn(conn2);
        let args2 = ProvisionDeviceArgs {
            terminal_id: "pilot-pos-retail".into(),
            location_name: "Toko Sembako Nusantara".into(),
            currency: "IDR".into(),
            timezone: "Asia/Jakarta".into(),
            owner_username: "siti".into(),
            owner_display_name: "Siti Rahma".into(),
            owner_pin: "9999".into(),
            preset: "simple-retail".into(),
            features: kasirmu_core::features::preset_feature_keys("simple-retail").unwrap(),
            location_kind: LocationKind::Retail,
            mode: ProvisioningMode::Local,
            tenant_id: None,
            device_credential_id: None,
            tax_preset: Some("ppn11".into()),
            seed_sample_products: Some(false),
        };
        provision_device(&tb2.ctx(), args2).await.unwrap();
        let ctx2 = tb2.ctx();
        let db2 = ctx2.lock_global().await;
        let count: i64 = db2
            .query_row(
                "SELECT COUNT(*) FROM tax_rates WHERE name = 'PPN 11%' AND rate_bps = 1100 AND is_default = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    // ── Step 4: Hardware Pairing & Thermal Printer Test Chit ──
    // Format sales receipt with Indonesian currency glyph (Rp) and dot grouping
    let cur_idr: kasirmu_core::Currency = "IDR".parse().unwrap();
    let money_idr = |amt: i64| kasirmu_core::Money {
        minor_units: amt,
        currency: cur_idr,
    };

    let receipt_cfg = kasirmu_hal::drivers::receipt::ReceiptConfig {
        paper_width: kasirmu_hal::drivers::receipt::PaperWidth::Standard,
        show_currency: true,
        grouping: kasirmu_hal::drivers::receipt::ThousandSeparator::Dot,
        footer: Some("Terima Kasih atas Kunjungan Anda".into()),
        ..kasirmu_hal::drivers::receipt::ReceiptConfig::default()
    };
    let test_receipt = kasirmu_hal::drivers::receipt::SalesReceipt {
        receipt_number: "PILOT-REC-001".into(),
        store: kasirmu_hal::drivers::receipt::StoreInfo {
            name: "Warung Kopi Nusantara".into(),
            address: "Jl. Malioboro No. 42, Yogyakarta".into(),
            tax_id: Some("01.234.567.8-901.000".into()),
            tax_id_label: Some("NPWP".into()),
        },
        date: "18 Nov 2026".into(),
        table_number: Some("Meja 04".into()),
        customer_name: Some("Pak Joko".into()),
        items: vec![
            kasirmu_hal::drivers::receipt::LineItem {
                name: "Nasi Goreng Spesial".into(),
                quantity: 1,
                unit_price: money_idr(35_000),
                total_price: money_idr(35_000),
                tax_amount: Some(money_idr(3_850)),
                note: Some("pedas sedang".into()),
            },
            kasirmu_hal::drivers::receipt::LineItem {
                name: "Es Teh Manis".into(),
                quantity: 2,
                unit_price: money_idr(8_000),
                total_price: money_idr(16_000),
                tax_amount: Some(money_idr(1_760)),
                note: None,
            },
        ],
        subtotal: money_idr(51_000),
        tax: Some(money_idr(5_610)),
        total: money_idr(56_610),
        payments: vec![
            kasirmu_hal::drivers::receipt::PaymentInfo::new("CASH", money_idr(50_000), None),
            kasirmu_hal::drivers::receipt::PaymentInfo::new("QRIS", money_idr(6_610), None),
        ],
        credit_terms: None,
        faktur_pajak: None,
    };
    let raw_chit = kasirmu_hal::drivers::receipt::format_sales_receipt(&test_receipt, &receipt_cfg);
    assert!(!raw_chit.is_empty());
    let chit_text = String::from_utf8_lossy(&raw_chit);
    assert!(chit_text.contains("Warung Kopi Nusantara"));
    assert!(chit_text.contains("PILOT-REC-001"));
    assert!(chit_text.contains("Rp"));
    // Assert paper feed / cut command in ESC/POS buffer (0x1D 0x56 or 0x1B 0x64)
    assert!(
        raw_chit
            .windows(2)
            .any(|w| w == [0x1D, 0x56] || w == [0x1B, 0x64])
    );

    // ── Step 5: Test Sale & Multi-Tender Payment (Split Cash + QRIS 0% MDR) ──
    let store_conn = tb.db_manager().open_store("default").unwrap();
    let guard = store_conn.lock().unwrap();
    let store = Store::new(&guard);

    store.seed_default_roles().unwrap();
    guard
        .execute(
            "INSERT OR REPLACE INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES ('user-budi', 'budi', 'hash', 'Budi Santoso', 'role-owner', 1, '2026-11-18T00:00:00Z', '2026-11-18T00:00:00Z')",
            [],
        )
        .unwrap();
    guard
        .execute(
            "INSERT OR REPLACE INTO products (id, sku, name, price_minor, currency, product_type)
             VALUES ('prod-americano', 'SMPL-REST-01', 'Americano (Hot/Iced)', 25000, 'IDR', 'restaurant')",
            [],
        )
        .unwrap();
    guard
        .execute(
            "INSERT OR REPLACE INTO stock_summary (item_id, location_id, qty)
             VALUES ('prod-americano', '01926b3a-0000-7000-8000-000000000001', 100)",
            [],
        )
        .unwrap();

    // Cashier opens shift with 100.000 IDR opening float
    let shift = store
        .open_shift("user-budi", Some(terminal_id), 100_000)
        .unwrap();
    assert_eq!(shift.opening_balance_minor, 100_000);
    assert_eq!(shift.status, "open");

    // Ring up 2 Americanos: 2 x 25.000 = 50.000 IDR
    let total_due = 50_000;
    let sale_id = uuid::Uuid::now_v7().to_string();
    let sale_time = shift.opened_at.clone();
    let currency_idr: kasirmu_core::Currency = "IDR".parse().unwrap();
    let sale = kasirmu_core::Sale {
        id: sale_id.clone(),
        total: money_idr(total_due),
        currency: currency_idr,
        line_count: 1,
        status: kasirmu_core::SaleStatus::Pending,
        payment_method: Some("split".into()),
        tendered_minor: Some(total_due),
        discount_percent: 0,
        discount_label: None,
        user_id: Some("user-budi".into()),
        created_at: sale_time.clone(),
        updated_at: sale_time,
        subtotal: money_idr(total_due),
        tax_total: money_idr(0),
        customer_id: None,
        base_currency: None,
        base_total_minor: None,
        tender_rate_millionths: None,
        tip_minor: 0,
        service_charge_minor: 0,
        version: 1,
        lines: vec![kasirmu_core::SaleLine {
            id: uuid::Uuid::now_v7().to_string(),
            sale_id: sale_id.clone(),
            sku: "SMPL-REST-01".into(),
            qty: 2,
            unit_price: money_idr(25000),
            line_total: money_idr(total_due),
            line_position: 1,
            tax_amount: money_idr(0),
            tax_rate_id: None,
            tax_breakdown_json: None,
            serial_number: None,
            course: None,
            modifiers_json: None,
        }],
    };

    // Multi-tender split: 30.000 Cash + 20.000 QRIS
    let cash_part = 30_000;
    let qris_part = 20_000;
    let splits = vec![
        kasirmu_core::payment::PaymentSplitArg {
            method: "cash".into(),
            amount_minor: cash_part,
            gateway_reference: None,
            gateway_status: Some("settled".into()),
            gateway_response: None,
            idempotency_key: Some("idem-split-cash-01".into()),
        },
        kasirmu_core::payment::PaymentSplitArg {
            method: "qris".into(),
            amount_minor: qris_part,
            gateway_reference: Some("QRIS-REF-001".into()),
            gateway_status: Some("confirmed".into()),
            // 0% MDR validation: gross amount equals net minor units
            gateway_response: Some(
                r#"{"gross_amount":20000,"net_amount":20000,"mdr_bps":0,"status":"PAID"}"#.into(),
            ),
            idempotency_key: Some("idem-split-qris-01".into()),
        },
    ];

    let deduction = store
        .complete_sale_deduction(&sale, None, &splits, "user-budi", None)
        .unwrap();
    assert_eq!(deduction.status, kasirmu_core::SaleStatus::Pending);

    // Finalize sale: transitions to Completed, updates shift totals and cash expectations
    store.finalize_sale(&sale.id).unwrap();

    // Verify payments recorded in payments table
    let payments: Vec<(String, i64, Option<String>)> = guard
        .prepare("SELECT method, amount_minor, gateway_status FROM payments WHERE sale_id = ?1 ORDER BY amount_minor DESC")
        .unwrap()
        .query_map([&sale_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(payments.len(), 2);
    assert_eq!(payments[0].0, "cash");
    assert_eq!(payments[0].1, cash_part);
    assert_eq!(payments[0].2.as_deref(), Some("settled"));
    assert_eq!(payments[1].0, "qris");
    assert_eq!(payments[1].1, qris_part);
    assert_eq!(payments[1].2.as_deref(), Some("confirmed"));

    // ── End of Day (EOD) Reconciliation & Shift Closure ──
    // Cash count matches opening float + cash sales
    let expected_cash = 100_000 + cash_part;
    let closed = store
        .close_shift(
            &shift.id,
            expected_cash,
            Some("Pilot merchant day 1 end of shift"),
        )
        .unwrap();
    assert_eq!(closed.status, "closed");
    assert_eq!(closed.expected_cash_minor, Some(expected_cash));
    assert_eq!(closed.closing_balance_minor, Some(expected_cash));
    assert_eq!(closed.cash_difference_minor, Some(0)); // Zero cash discrepancy!
    assert_eq!(closed.total_cash_minor, cash_part);
    assert_eq!(closed.total_other_minor, qris_part);

    // Verify Z-report totals
    let report = store.get_shift_report(&shift.id).unwrap();
    assert_eq!(report.shift.total_cash_minor, cash_part);
    assert_eq!(report.shift.cash_difference_minor, Some(0));
}
