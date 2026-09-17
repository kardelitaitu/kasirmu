//! Unit tests for the tax-rate command bodies (Wave-A test relocation:
//! moved out of `apps/desktop-client/src/commands/tax_tests.rs`).
//!
//! Mounted at the foot of `tax.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves the DTOs, the five `run_*` bodies and the
//! session-scoped operations directly. The desktop file exercised the
//! same behaviour through `AppState` + a Tauri mock app; here the scoped
//! calls go straight to the bridge fns over a `TestBridge` context (the
//! crate's `testing` harness), the permission-gate tests seed the global
//! identity DB exactly as before, and the store-isolation tests use the
//! harness's per-instance store directory instead of a tempdir handle.
//! Error assertions are the 1:1 `AppError` -> `BridgeError` rename.

use super::*;
use crate::testing::{TestBridge, temp_conn};
use oz_core::session::SessionContext;
use platform_core::StoreDatabaseManager;

// ── TaxRateDto ──────────────────────────────────────────────────────

#[test]
fn tax_rate_dto_debug() {
    let dto = TaxRateDto {
        id: "t1".into(),
        name: "VAT".into(),
        rate_bps: 1100,
        is_default: true,
        is_inclusive: false,
        display_rate: "11.00%".into(),
        created_at: "2025-01-01".into(),
        updated_at: "2025-01-01".into(),
        scope: None,
        window: None,
    };
    let d = format!("{dto:?}");
    assert!(d.contains("VAT"));
    assert!(d.contains("1100"));
}

#[test]
fn tax_rate_dto_serialize() {
    let dto = TaxRateDto {
        id: "t2".into(),
        name: "GST".into(),
        rate_bps: 1000,
        is_default: false,
        is_inclusive: true,
        display_rate: "10.00%".into(),
        created_at: "2025-02-01".into(),
        updated_at: "2025-02-01".into(),
        scope: None,
        window: None,
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["name"], "GST");
    assert_eq!(json["is_inclusive"], true);
}

// ── CreateTaxRateArgs ───────────────────────────────────────────────

#[test]
fn create_tax_rate_args_deserialize_camel_case() {
    // Wire contract is camelCase (frontend sends rateBps/isDefault/...).
    let json = r##"{"name":"VAT","rateBps":1100,"isDefault":true,"isInclusive":false}"##;
    let args: CreateTaxRateArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.name, "VAT");
    assert_eq!(args.rate_bps, 1100);
    assert!(args.is_default);
    assert!(!args.is_inclusive);
}

#[test]
fn create_tax_rate_args_debug() {
    let args = CreateTaxRateArgs {
        name: "T".into(),
        rate_bps: 500,
        is_default: false,
        is_inclusive: false,
        legal_entity_id: None,
        location_id: None,
        effective_from: None,
        effective_to: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("T"));
}

// ── UpdateTaxRateArgs ───────────────────────────────────────────────

#[test]
fn update_tax_rate_args_deserialize_camel_case() {
    let json =
        r##"{"id":"t1","name":"VAT Updated","rateBps":1200,"isDefault":false,"isInclusive":true}"##;
    let args: UpdateTaxRateArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.id, "t1");
    assert_eq!(args.rate_bps, 1200);
    assert!(args.is_inclusive);
}

#[test]
fn update_tax_rate_args_debug() {
    let args = UpdateTaxRateArgs {
        id: "x".into(),
        name: "N".into(),
        rate_bps: 0,
        is_default: true,
        is_inclusive: false,
        legal_entity_id: None,
        location_id: None,
        effective_from: None,
        effective_to: None,
    };
    let d = format!("{args:?}");
    assert!(d.contains("N"));
}

// ── SetCategoryTaxRatesArgs ─────────────────────────────────────────

#[test]
fn set_category_tax_rates_args_deserialize() {
    let json = r##"{"category_id":"cat1","tax_rate_ids":["t1","t2"]}"##;
    let args: SetCategoryTaxRatesArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.category_id, "cat1");
    assert_eq!(args.tax_rate_ids, vec!["t1", "t2"]);
}

#[test]
fn set_category_tax_rates_args_deserialize_empty() {
    let json = r##"{"category_id":"cat2","tax_rate_ids":[]}"##;
    let args: SetCategoryTaxRatesArgs = serde_json::from_str(json).unwrap();
    assert!(args.tax_rate_ids.is_empty());
}

#[test]
fn set_category_tax_rates_args_debug() {
    let args = SetCategoryTaxRatesArgs {
        category_id: "c".into(),
        tax_rate_ids: vec!["t1".into()],
    };
    let d = format!("{args:?}");
    assert!(d.contains("c"));
}

// ── CategoryTaxRateRow ──────────────────────────────────────────────

#[test]
fn category_tax_rate_row_debug() {
    let row = CategoryTaxRateRow {
        category_id: "cat1".into(),
        tax_rate_ids: vec!["t1".into()],
    };
    let d = format!("{row:?}");
    assert!(d.contains("cat1"));
}

#[test]
fn category_tax_rate_row_serialize() {
    let row = CategoryTaxRateRow {
        category_id: "cat2".into(),
        tax_rate_ids: vec![],
    };
    let json = serde_json::to_value(&row).unwrap();
    assert_eq!(json["category_id"], "cat2");
    assert!(json["tax_rate_ids"].as_array().unwrap().is_empty());
}

// -- scoped tax authoring + DTO join (B1, Option B side-channel) ------

#[test]
fn create_tax_rate_args_deserialize_scope_fields() {
    let json = r##"{"name":"PBJT","rateBps":1100,"isDefault":false,"isInclusive":false,"legalEntityId":"ent-1","effectiveFrom":"2026-01-01","effectiveTo":"2026-12-31"}"##;
    let args: CreateTaxRateArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.legal_entity_id.as_deref(), Some("ent-1"));
    assert!(args.location_id.is_none());
    assert_eq!(args.effective_from.as_deref(), Some("2026-01-01"));
    assert_eq!(args.effective_to.as_deref(), Some("2026-12-31"));
}

#[test]
fn create_tax_rate_args_without_scope_fields_stay_none() {
    // Legacy callers send no scope keys; they must keep working unchanged.
    let json = r##"{"name":"VAT","rateBps":1100,"isDefault":true,"isInclusive":false}"##;
    let args: CreateTaxRateArgs = serde_json::from_str(json).unwrap();
    assert!(
        args.legal_entity_id.is_none()
            && args.location_id.is_none()
            && args.effective_from.is_none()
            && args.effective_to.is_none()
    );
}

#[test]
fn scoped_create_round_trips_scope_and_window() {
    let conn = temp_conn();
    // The migration seed provides location 'default' and (20260908
    // backfill) the entity 'default:default-legal-entity' the scope
    // target validation checks against.
    let created = run_create_tax_rate(
        &conn,
        &CreateTaxRateArgs {
            name: "PBJT Loc".into(),
            rate_bps: 1100,
            is_default: false,
            is_inclusive: false,
            legal_entity_id: None,
            location_id: Some("default".into()),
            effective_from: Some("2026-01-01".into()),
            effective_to: Some("2026-12-31".into()),
        },
    )
    .unwrap();
    let scope = created.scope.as_ref().expect("scoped create carries scope");
    assert_eq!(scope.scope, "location");
    assert_eq!(scope.location_id.as_deref(), Some("default"));
    let window = created.window.as_ref().unwrap();
    assert_eq!(window.effective_from.as_deref(), Some("2026-01-01"));
    assert_eq!(window.effective_to.as_deref(), Some("2026-12-31"));
    // The stored row agrees with the DTO (the core scoped fn round-trips).
    let store = Store::new(&conn);
    let stored = store
        .tax_rate_scope(&created.id)
        .unwrap()
        .expect("active scoped row carries a scope");
    assert!(matches!(
        stored,
        oz_core::db::tax::TaxRateScope::Location(_)
    ));
}

#[test]
fn create_tax_rate_args_reject_both_scope_targets() {
    let conn = temp_conn();
    let err = run_create_tax_rate(
        &conn,
        &CreateTaxRateArgs {
            name: "Bad".into(),
            rate_bps: 100,
            is_default: false,
            is_inclusive: false,
            legal_entity_id: Some("ent-1".into()),
            location_id: Some("default".into()),
            effective_from: None,
            effective_to: None,
        },
    )
    .unwrap_err();
    match err {
        BridgeError::Core { message, .. } => {
            assert!(message.contains("mutually exclusive"), "got: {message}");
        }
        other => panic!("expected a typed validation error, got {other:?}"),
    }
}

#[test]
fn legacy_create_without_scope_fields_writes_the_global_arm() {
    let conn = temp_conn();
    let created = run_create_tax_rate(
        &conn,
        &CreateTaxRateArgs {
            name: "VAT".into(),
            rate_bps: 500,
            is_default: true,
            is_inclusive: false,
            legal_entity_id: None,
            location_id: None,
            effective_from: None,
            effective_to: None,
        },
    )
    .unwrap();
    assert_eq!(created.scope.as_ref().unwrap().scope, "global");
    assert!(created.window.as_ref().unwrap().effective_from.is_none());
}

#[test]
fn list_tax_rates_dto_joins_scope_and_window() {
    let conn = temp_conn();
    run_create_tax_rate(
        &conn,
        &CreateTaxRateArgs {
            name: "Ent".into(),
            rate_bps: 900,
            is_default: false,
            is_inclusive: false,
            legal_entity_id: Some("default:default-legal-entity".into()),
            location_id: None,
            effective_from: Some("2026-02-01".into()),
            effective_to: None,
        },
    )
    .unwrap();
    run_create_tax_rate(
        &conn,
        &CreateTaxRateArgs {
            name: "Glob".into(),
            rate_bps: 100,
            is_default: false,
            is_inclusive: false,
            legal_entity_id: None,
            location_id: None,
            effective_from: None,
            effective_to: None,
        },
    )
    .unwrap();
    let rows = run_list_tax_rates(&conn).unwrap();
    assert_eq!(rows.len(), 2);
    let ent = rows.iter().find(|r| r.name == "Ent").unwrap();
    assert_eq!(ent.scope.as_ref().unwrap().scope, "legal_entity");
    assert_eq!(
        ent.scope.as_ref().unwrap().legal_entity_id.as_deref(),
        Some("default:default-legal-entity")
    );
    assert_eq!(
        ent.window.as_ref().unwrap().effective_from.as_deref(),
        Some("2026-02-01")
    );
    let glob = rows.iter().find(|r| r.name == "Glob").unwrap();
    assert_eq!(glob.scope.as_ref().unwrap().scope, "global");
    assert!(glob.window.as_ref().unwrap().effective_from.is_none());
}

#[test]
fn scoped_update_moves_tier_and_window() {
    let conn = temp_conn();
    let created = run_create_tax_rate(
        &conn,
        &CreateTaxRateArgs {
            name: "Loc".into(),
            rate_bps: 700,
            is_default: false,
            is_inclusive: false,
            legal_entity_id: None,
            location_id: Some("default".into()),
            effective_from: None,
            effective_to: None,
        },
    )
    .unwrap();
    // Tier move: location -> legal entity. The vacated location tier's
    // default silently empties (documented F1 surfacing debt).
    let updated = run_update_tax_rate(
        &conn,
        &UpdateTaxRateArgs {
            id: created.id.clone(),
            name: "Loc moved".into(),
            rate_bps: 800,
            is_default: false,
            is_inclusive: false,
            legal_entity_id: Some("default:default-legal-entity".into()),
            location_id: None,
            effective_from: Some("2026-03-01".into()),
            effective_to: None,
        },
    )
    .unwrap();
    assert_eq!(updated.scope.as_ref().unwrap().scope, "legal_entity");
    assert_eq!(
        updated.window.as_ref().unwrap().effective_from.as_deref(),
        Some("2026-03-01")
    );
    let store = Store::new(&conn);
    let stored = store
        .tax_rate_scope(&created.id)
        .unwrap()
        .expect("row still active");
    assert!(matches!(
        stored,
        oz_core::db::tax::TaxRateScope::LegalEntity(_)
    ));
}

// ── Scoped-command permission + isolation (Phase 5) ─────────────────

/// Seed the GLOBAL identity DB with an owner user (all permissions).
fn seed_owner_user(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

/// Unique per-test directory for the store sqlite files. Mirrors the
/// harness's per-instance store root (`testing.rs` builds one for the
/// default `TestBridge` manager); a handle is needed here only where a
/// test must pre-seed a store database before driving the scoped ops.
fn store_dir() -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "oz-bridge-tax-tests-{}-{}-{}",
        std::process::id(),
        nanos,
        NEXT.fetch_add(1, Ordering::Relaxed)
    ))
}

#[tokio::test]
async fn require_tax_permission_uses_global_identity_db() {
    // Users/roles are GLOBAL authentication records (ADR #4/#7); the
    // store-scoped DBs have no users, so a permission check against the
    // global DB must succeed for an owner while the store DB alone
    // would report "user not found".
    let conn = temp_conn();
    seed_owner_user(&conn);
    let bridge = TestBridge::new().with_conn(conn);
    let ctx = bridge.ctx();

    assert!(
        require_tax_permission(&ctx, "user-owner", oz_core::permissions::SETTINGS_READ)
            .await
            .is_ok()
    );
    assert!(
        require_tax_permission(&ctx, "user-owner", oz_core::permissions::SETTINGS_EDIT)
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn require_tax_permission_rejects_missing_user() {
    let conn = temp_conn();
    let bridge = TestBridge::new().with_conn(conn);
    let ctx = bridge.ctx();

    assert!(matches!(
        require_tax_permission(&ctx, "missing-user", oz_core::permissions::SETTINGS_READ).await,
        Err(BridgeError::PermissionDenied(_))
    ));
}

#[tokio::test]
async fn scoped_tax_command_rejects_invalid_session() {
    let bridge = TestBridge::new();
    let ctx = bridge.ctx();

    let result = list_rates_scoped(&ctx, "missing-token").await;
    assert!(matches!(result, Err(BridgeError::InvalidSession)));
}

#[tokio::test]
async fn scoped_tax_command_denies_user_without_permission() {
    let conn = temp_conn();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-cashier', 'cashier', 'hash', 'Cashier', 'role-staff', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let bridge = TestBridge::new().with_conn(conn);
    bridge.sessions().write().unwrap().insert(
        "cashier-token".into(),
        SessionContext::new(
            "user-cashier".into(),
            "role-staff".into(),
            "terminal-1".into(),
            "store-cashier".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
    let ctx = bridge.ctx();

    // Cashier role lacks SETTINGS_READ → PermissionDenied from the
    // GLOBAL identity DB (not "user not found" from an empty store DB).
    let result = list_rates_scoped(&ctx, "cashier-token").await;
    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn scoped_tax_command_reads_only_the_session_store() {
    let conn = temp_conn();
    seed_owner_user(&conn);

    let db_manager = StoreDatabaseManager::new(store_dir(), oz_core::migrations::ALL);
    let bridge = TestBridge::new()
        .with_conn(conn)
        .with_db_manager(db_manager.clone());
    for (token, store_id) in [("store-a-token", "store-a"), ("store-b-token", "store-b")] {
        bridge.sessions().write().unwrap().insert(
            token.into(),
            SessionContext::new(
                "user-owner".into(),
                "role-owner".into(),
                "terminal-1".into(),
                store_id.into(),
                "instance-1".into(),
                "pos".into(),
                None,
                0,
            ),
        );
    }

    // Seed a tax rate ONLY into store A's database. The guard is
    // scoped to a block so it drops before the async commands below.
    {
        let store_a_conn = db_manager.open_store("store-a").unwrap();
        let store_a_db = store_a_conn.lock().unwrap();
        Store::new(&store_a_db)
            .create_tax_rate("Store A VAT", 1000, true, false)
            .unwrap();
    }

    let ctx = bridge.ctx();
    let store_a_rates = list_rates_scoped(&ctx, "store-a-token").await.unwrap();
    let store_b_rates = list_rates_scoped(&ctx, "store-b-token").await.unwrap();
    assert_eq!(store_a_rates.len(), 1);
    assert_eq!(store_a_rates[0].name, "Store A VAT");
    assert!(
        store_b_rates.is_empty(),
        "store B must not see store A tax data"
    );
}

#[tokio::test]
async fn scoped_tax_write_command_targets_only_the_session_store() {
    let conn = temp_conn();
    seed_owner_user(&conn);

    let bridge = TestBridge::new().with_conn(conn);
    for (token, store_id) in [("store-a-token", "store-a"), ("store-b-token", "store-b")] {
        bridge.sessions().write().unwrap().insert(
            token.into(),
            SessionContext::new(
                "user-owner".into(),
                "role-owner".into(),
                "terminal-1".into(),
                store_id.into(),
                "instance-1".into(),
                "pos".into(),
                None,
                0,
            ),
        );
    }
    let ctx = bridge.ctx();

    let created = create_rate_scoped(
        &ctx,
        "store-a-token",
        &CreateTaxRateArgs {
            name: "A-only".into(),
            rate_bps: 500,
            is_default: false,
            is_inclusive: false,
            legal_entity_id: None,
            location_id: None,
            effective_from: None,
            effective_to: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(created.name, "A-only");

    let store_b_rates = list_rates_scoped(&ctx, "store-b-token").await.unwrap();
    assert!(
        store_b_rates.is_empty(),
        "writes scoped to store A must not leak into store B"
    );
}

// ── E1-5: statutory rounding-mode read surface ────────────────────────

/// The exact seeding of the core alphabet pin: truncate / half_up / ''
/// (the 20260929 CHECK constrains the column to this alphabet).
fn seed_rounding_rows(conn: &rusqlite::Connection) {
    conn.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, rounding_mode) VALUES
         ('r-trunc', 'Trunc', 1000, 'truncate'),
         ('r-half', 'Half', 1000, 'half_up'),
         ('r-plain', 'Plain', 1000, '')",
        [],
    )
    .unwrap();
}

#[test]
fn run_list_tax_rate_rounding_modes_maps_the_statutory_alphabet() {
    // E1-5 over the E1-2 door: the two statutory spellings map to their
    // modes; '' and unknown ids read as None (the preference applies —
    // unknown and absent read identically, so the batch read is never a
    // second failure mode beside the resolver that produced the ids).
    let conn = temp_conn();
    seed_rounding_rows(&conn);
    let modes =
        run_list_tax_rate_rounding_modes(&conn, &["r-trunc", "r-half", "r-plain", "r-ghost"])
            .unwrap();
    assert_eq!(
        modes.get("r-trunc"),
        Some(&Some(oz_core::tax_rate::RoundingMode::Truncate)),
    );
    assert_eq!(
        modes.get("r-half"),
        Some(&Some(oz_core::tax_rate::RoundingMode::HalfUp)),
    );
    assert_eq!(
        modes.get("r-plain"),
        Some(&None),
        "'' = the preference applies"
    );
    assert_eq!(
        modes.get("r-ghost"),
        Some(&None),
        "unknown id = the preference applies"
    );
}

#[test]
fn run_list_tax_rate_rounding_modes_ignores_archived_rows() {
    // Archived rows must not leak a directive: is_active = 0 reads as
    // "the preference applies", exactly like the core door's contract.
    let conn = temp_conn();
    conn.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, rounding_mode, is_active)
         VALUES ('r-arch', 'Archived', 1000, 'truncate', 0)",
        [],
    )
    .unwrap();
    let modes = run_list_tax_rate_rounding_modes(&conn, &["r-arch"]).unwrap();
    assert_eq!(
        modes.get("r-arch"),
        Some(&None),
        "archived rows must not leak a directive",
    );
}

#[test]
fn rounding_mode_wire_is_the_core_serde_snake_case() {
    // The IPC value IS the core enum's serde snake_case name, passed
    // through verbatim; null = preference. The ui contract test pins the
    // JS half of this contract; this pins the Rust half.
    assert_eq!(
        serde_json::to_value(oz_core::tax_rate::RoundingMode::HalfUp).unwrap(),
        serde_json::json!("half_up"),
    );
    assert_eq!(
        serde_json::to_value(oz_core::tax_rate::RoundingMode::Truncate).unwrap(),
        serde_json::json!("truncate"),
    );
    let map = run_list_tax_rate_rounding_modes(&temp_conn(), &["r-none"]).unwrap();
    assert_eq!(
        serde_json::to_value(map).unwrap(),
        serde_json::json!({ "r-none": null }),
    );
}

#[test]
fn tax_rate_dependency_counts_wire_is_the_key_the_delete_guard_reads() {
    // The whole point of these counts is the delete confirmations on the tax
    // configuration screen, and the load-bearing read is that screen's own
    // `disabled={(pendingDeleteCounts?.sale_lines ?? 0) > 0}` guard.
    // The key it names is declared at `ui/src/api/tax.ts:114` as `sale_lines`,
    // but this type carried `#[serde(rename_all = "camelCase")]`, so the wire
    // said `saleLines` and the guard read `undefined`. `undefined > 0` is
    // `false`, so a rate referenced by historical sale lines was offered for
    // deletion with no warning and a live Confirm button.
    //
    // Nothing caught it because the failure is one-directional and quiet:
    // `products` and `categories` are single words, so they are spelled the
    // same in either convention and only the third key moved; the dev-mock
    // (`ui/src/dev-mock/handlers/catalog.ts:391`) answers `sale_lines`, so the
    // screen looked right in mock mode; and the backend refuses the delete
    // anyway (`crates/oz-core/src/db/tax/rates.rs:359`), so no data was ever
    // lost — the loss was the warning. And `saleLines` appears ZERO times in
    // the repository, i.e. no consumer on the emitted side existed to break.
    //
    // Pinned against the renderer's declaration rather than against this file's
    // own derives, which is the mistake that let it ship.
    let dto = TaxRateDependencyCountsDto {
        products: 1,
        categories: 2,
        sale_lines: 3,
    };
    let value = serde_json::to_value(&dto).unwrap();
    let keys = value
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>()
        .join(",");
    assert_eq!(
        keys, "categories,products,sale_lines",
        "the dependency-counts wire drifted from ui/src/api/tax.ts:114"
    );
    assert_eq!(value["sale_lines"], serde_json::json!(3));
    assert!(
        value.get("saleLines").is_none(),
        "the camelCase alias nobody reads must not be emitted"
    );
}
