//! Cross-layer boundary contract for the tax vertical (TAX-10).
//!
//! `modules/tax` is the contractual owner of the tax domain types
//! (`TaxRate`, `RoundingMode`), which `kasirmu-core` re-exports
//! (`crates/kasirmu-core/src/tax_rate.rs`) and which the Tauri command layer
//! (`apps/*-client/src/commands/tax.rs`) and the UI's API surface
//! (`ui/src/api/tax.ts`) consume. These tests pin that boundary so the
//! pieces cannot drift:
//!
//! 1. **Module registration** — `manifest.json` id must match the
//!    `Module` trait id and declare the documented permissions.
//! 2. **Type identity** — `kasirmu_core::tax_rate::{TaxRate, RoundingMode}`
//!    are *the same types* as the `modules_tax` ones (compile-time proof).
//! 3. **DB behaviour parity** — the module repository/service must observe
//!    exactly the same rows as `kasirmu_core`'s `Store`, including the TAX-03
//!    soft-delete (`is_active = 0`) policy.
//! 4. **Serde wire shape** — `TaxRate` serializes the exact field names
//!    the frontend `TaxRateDto` declares, so IPC payloads stay in sync.

use foundation::contracts::Module;
use kasirmu_core::db::Store;
use kasirmu_core::migrations::fresh_db;
use modules_tax::{RoundingMode, TaxModule, TaxRate, TaxService};

// ── 1. Module registration contract ─────────────────────────────────

#[test]
fn manifest_id_matches_module_trait_id() {
    let manifest_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("manifest.json");
    let manifest = platform_kernel::ModuleManifest::load_from_file(&manifest_path)
        .expect("modules/tax/manifest.json must load and validate");

    assert_eq!(manifest.id, "tax", "manifest id must be stable kebab-case");
    assert_eq!(
        manifest.id,
        TaxModule::new().id(),
        "manifest id must equal Module::id()"
    );
    assert!(
        manifest.permissions.iter().any(|p| p == "tax:view"),
        "manifest must declare tax:view"
    );
    assert!(
        manifest.permissions.iter().any(|p| p == "tax:edit"),
        "manifest must declare tax:edit"
    );
}

// ── 2. Type identity contract ───────────────────────────────────────

/// Identity function used only for compile-time type-equality proofs.
fn identity<T>(t: T) -> T {
    t
}

#[test]
fn oz_core_reexports_exact_module_types() {
    // These function-pointer assignments compile ONLY if the kasirmu-core
    // re-export is literally the same type as the modules_tax type.
    // If someone forks the type in either crate, this fails to build.
    let _rate: fn(kasirmu_core::tax_rate::TaxRate) -> kasirmu_core::tax_rate::TaxRate =
        identity::<modules_tax::TaxRate>;
    let _mode: fn(kasirmu_core::tax_rate::RoundingMode) -> kasirmu_core::tax_rate::RoundingMode =
        identity::<modules_tax::RoundingMode>;
}

#[test]
fn rounding_mode_serializes_snake_case() {
    // RoundingMode crosses IPC only in tests today, but pin the wire shape
    // so adding it to a command payload later cannot silently use a
    // different casing.
    assert_eq!(
        serde_json::to_string(&RoundingMode::HalfUp).unwrap(),
        "\"half_up\""
    );
    assert_eq!(
        serde_json::to_string(&RoundingMode::Truncate).unwrap(),
        "\"truncate\""
    );
}

// ── RoundingMode::divide equivalence ────────────────────────────────
//
// TAX-05: `(numerator + divisor/2) / divisor` with truncating division
// for divisor/2 must produce the same result as the true "round half away
// from zero" formula `(2*numerator + divisor) / (2*divisor)` for all
// non-negative inputs (the only domain tax math produces).
#[test]
fn rounding_mode_halfup_equals_true_half_away_for_positive_inputs() {
    // Test every divisor from 1..=200 against every numerator from 0..=2000.
    // This is a comprehensive brute-force check that the integer idiom
    // `(n + d/2) / d` equals the mathematically correct `round(n/d)` for
    // all positive inputs within a reasonable bounded range.
    for d in 1i64..=200 {
        for n in 0i64..=2_000 {
            // True round-half-away-from-zero: round(n/d) = floor(n/d + 0.5)
            let true_half_up = (2 * n + d) / (2 * d);
            let got = RoundingMode::HalfUp.divide(n, d).unwrap();
            assert_eq!(
                got, true_half_up,
                "HalfUp mismatch at n={n}, d={d}: got={got}, true={true_half_up}"
            );
        }
    }
}

#[test]
fn rounding_mode_truncate_matches_integer_division() {
    for d in 1i64..=50 {
        for n in 0i64..=500 {
            assert_eq!(
                RoundingMode::Truncate.divide(n, d).unwrap(),
                n / d,
                "Truncate mismatch at n={n}, d={d}"
            );
        }
    }
}

// ── 3. DB behaviour parity contract ─────────────────────────────────

#[test]
fn repository_and_store_agree_on_active_rows() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let rate = store.create_tax_rate("VAT 10%", 1000, true, false).unwrap();

    // The module service layer must see the same row the store sees.
    let via_service = TaxService::get_tax_rate(&conn, &rate.id).unwrap();
    let via_store = store.get_tax_rate(&rate.id).unwrap();
    assert_eq!(
        via_service, via_store,
        "module and store must agree on active rows"
    );
    assert!(via_service.is_some());
}

#[test]
fn archived_rates_are_hidden_by_repository_and_store() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let rate = store
        .create_tax_rate("Archive Me", 100, false, false)
        .unwrap();

    // TAX-03 soft-delete: archiving hides the rate.
    store.delete_tax_rate(&rate.id).unwrap();

    // kasirmu-core store: hidden.
    assert!(store.get_tax_rate(&rate.id).unwrap().is_none());

    // The module repository must observe the SAME policy. Without the
    // `is_active = 1` filter this assertion fails — the module would
    // resurrect archived (immutable) rates that the store hides.
    assert!(
        TaxService::get_tax_rate(&conn, &rate.id).unwrap().is_none(),
        "module repository must honor the TAX-03 is_active soft-delete filter"
    );
}

#[test]
fn repository_returns_none_for_unknown_id() {
    let conn = fresh_db();
    assert!(
        TaxService::get_tax_rate(&conn, "no-such-id")
            .unwrap()
            .is_none(),
        "unknown ids must return None through the module repository"
    );
}

#[test]
fn repository_list_tax_rates_filters_archived_and_matches_store() {
    let conn = fresh_db();
    let store = Store::new(&conn);
    let active = store
        .create_tax_rate("Active VAT", 1000, true, false)
        .unwrap();
    let archived = store
        .create_tax_rate("Archived Old", 500, false, false)
        .unwrap();
    store.delete_tax_rate(&archived.id).unwrap();

    // The module repository must observe the SAME active row set as the
    // kasirmu-core store — archived (is_active = 0) rates must be filtered out.
    let via_module = TaxService::list_tax_rates(&conn).unwrap();
    let via_store = store.list_tax_rates().unwrap();

    assert_eq!(
        via_module, via_store,
        "module and store must agree on the active tax-rate row set"
    );
    assert_eq!(via_module.len(), 1, "archived rate must be hidden");
    assert_eq!(via_module[0].id, active.id);
    assert!(
        via_module.iter().all(|r| r.id != archived.id),
        "archived rate id must not appear in the module listing"
    );
}

#[test]
fn repository_list_tax_rates_empty_db() {
    let conn = fresh_db();
    assert!(
        TaxService::list_tax_rates(&conn).unwrap().is_empty(),
        "empty database must yield an empty module listing"
    );
}

// ── 4. Serde wire-shape contract ────────────────────────────────────

#[test]
fn tax_rate_serializes_frontend_contract_fields() {
    let rate = TaxRate {
        id: "t1".into(),
        name: "VAT".into(),
        rate_bps: 1100,
        is_default: true,
        is_inclusive: false,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    };

    let value = serde_json::to_value(&rate).unwrap();
    let obj = value
        .as_object()
        .expect("TaxRate must serialize to an object");

    // Must match ui/src/api/tax.ts TaxRateDto field names exactly.
    for field in [
        "id",
        "name",
        "rate_bps",
        "is_default",
        "is_inclusive",
        "created_at",
        "updated_at",
    ] {
        assert!(obj.contains_key(field), "missing contract field '{field}'");
    }
    // No accidental extra keys (rename_all drift or stray fields).
    assert_eq!(obj.len(), 7, "TaxRate must serialize exactly 7 fields");
    assert_eq!(obj["rate_bps"], 1100);
}
