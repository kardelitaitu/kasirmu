use super::*;
use crate::migrations;
use foundation::Currency;
use rusqlite::Connection;
use std::str::FromStr;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

#[test]
fn list_tax_rates_empty() {
    let conn = fresh();
    let s = store(&conn);
    let rates = s.list_tax_rates().unwrap();
    assert!(rates.is_empty());
}

#[test]
fn create_and_list_tax_rate() {
    let conn = fresh();
    let s = store(&conn);
    s.create_tax_rate("VAT 10%", 1000, true, false).unwrap();
    let rates = s.list_tax_rates().unwrap();
    assert_eq!(rates.len(), 1);
    assert_eq!(rates[0].name, "VAT 10%");
    assert_eq!(rates[0].rate_bps, 1000);
    assert!(rates[0].is_default);
    assert!(!rates[0].is_inclusive);
}

#[test]
fn create_tax_rate_exclusive() {
    let conn = fresh();
    let s = store(&conn);
    s.create_tax_rate("GST 5%", 500, false, true).unwrap();
    let rates = s.list_tax_rates().unwrap();
    assert_eq!(rates.len(), 1);
    assert!(!rates[0].is_default);
    assert!(rates[0].is_inclusive);
}

#[test]
fn create_tax_rate_empty_name() {
    let conn = fresh();
    let s = store(&conn);
    let result = s.create_tax_rate("", 1000, false, false);
    assert!(matches!(
        result,
        Err(CoreError::Validation { field: "name", .. })
    ));
}

#[test]
fn create_tax_rate_negative_rate() {
    let conn = fresh();
    let s = store(&conn);
    let result = s.create_tax_rate("Bad", -1, false, false);
    assert!(matches!(
        result,
        Err(CoreError::Validation {
            field: "rate_bps",
            ..
        })
    ));
}

// ── TAX-04: bounded rate validation ─────────────────────────────

#[test]
fn create_tax_rate_accepts_max_bps() {
    let conn = fresh();
    let s = store(&conn);
    let rate = s
        .create_tax_rate("Extreme", MAX_TAX_RATE_BPS, false, false)
        .unwrap();
    assert_eq!(rate.rate_bps, MAX_TAX_RATE_BPS);
}

#[test]
fn create_tax_rate_rejects_above_max_bps() {
    let conn = fresh();
    let s = store(&conn);
    let result = s.create_tax_rate("Bad", MAX_TAX_RATE_BPS + 1, false, false);
    assert!(matches!(
        result,
        Err(CoreError::Validation {
            field: "rate_bps",
            ..
        })
    ));
}

#[test]
fn update_tax_rate_rejects_above_max_bps() {
    let conn = fresh();
    let s = store(&conn);
    let created = s.create_tax_rate("Test", 100, false, false).unwrap();
    let result = s.update_tax_rate(&created.id, "Test", MAX_TAX_RATE_BPS + 1, false, false);
    assert!(matches!(
        result,
        Err(CoreError::Validation {
            field: "rate_bps",
            ..
        })
    ));
}

#[test]
fn get_tax_rate_found() {
    let conn = fresh();
    let s = store(&conn);
    let created = s.create_tax_rate("VAT 8%", 800, true, false).unwrap();
    let found = s.get_tax_rate(&created.id).unwrap().unwrap();
    assert_eq!(found.name, "VAT 8%");
    assert_eq!(found.rate_bps, 800);
}

#[test]
fn get_tax_rate_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let result = s.get_tax_rate("nonexistent-id").unwrap();
    assert!(result.is_none());
}

#[test]
fn update_tax_rate_basic() {
    let conn = fresh();
    let s = store(&conn);
    let created = s.create_tax_rate("Old Name", 500, false, false).unwrap();
    let updated = s
        .update_tax_rate(&created.id, "New Name", 600, true, true)
        .unwrap();
    assert_eq!(updated.name, "New Name");
    assert_eq!(updated.rate_bps, 600);
    assert!(updated.is_default);
    assert!(updated.is_inclusive);
}

#[test]
fn update_tax_rate_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let result = s.update_tax_rate("bad-id", "X", 100, false, false);
    assert!(matches!(result, Err(CoreError::NotFound { .. })));
}

#[test]
fn update_tax_rate_empty_name() {
    let conn = fresh();
    let s = store(&conn);
    let created = s.create_tax_rate("Test", 100, false, false).unwrap();
    let result = s.update_tax_rate(&created.id, "", 100, false, false);
    assert!(matches!(
        result,
        Err(CoreError::Validation { field: "name", .. })
    ));
}

#[test]
fn update_tax_rate_negative_rate() {
    let conn = fresh();
    let s = store(&conn);
    let created = s.create_tax_rate("Test", 100, false, false).unwrap();
    let result = s.update_tax_rate(&created.id, "Test", -5, false, false);
    assert!(matches!(
        result,
        Err(CoreError::Validation {
            field: "rate_bps",
            ..
        })
    ));
}

#[test]
fn delete_tax_rate_removes() {
    let conn = fresh();
    let s = store(&conn);
    let created = s.create_tax_rate("To Delete", 100, false, false).unwrap();
    s.delete_tax_rate(&created.id).unwrap();
    let found = s.get_tax_rate(&created.id).unwrap();
    assert!(found.is_none());
}

#[test]
fn delete_tax_rate_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let result = s.delete_tax_rate("bad-id");
    assert!(matches!(result, Err(CoreError::NotFound { .. })));
}

#[test]
fn default_flag_is_cleared_on_new_default() {
    let conn = fresh();
    let s = store(&conn);
    let first = s.create_tax_rate("First", 500, true, false).unwrap();
    let second = s.create_tax_rate("Second", 1000, true, false).unwrap();

    let r1 = s.get_tax_rate(&first.id).unwrap().unwrap();
    let r2 = s.get_tax_rate(&second.id).unwrap().unwrap();
    assert!(!r1.is_default); // cleared when second was set as default
    assert!(r2.is_default);
}

#[test]
fn set_and_get_product_tax_rates() {
    let conn = fresh();
    let s = store(&conn);
    let currency = Currency::from_str("USD").unwrap();
    let money = crate::Money {
        minor_units: 1000,
        currency,
    };
    s.create_product("SKU-TAX", "Taxed Product", money, None, None, 0, None)
        .unwrap();

    let rate = s.create_tax_rate("VAT", 1000, true, false).unwrap();
    s.set_product_tax_rates("SKU-TAX", std::slice::from_ref(&rate.id))
        .unwrap();

    let ids = s.get_product_tax_rates("SKU-TAX").unwrap();
    assert_eq!(ids, vec![rate.id]);
}

#[test]
fn set_product_tax_rates_overwrites() {
    let conn = fresh();
    let s = store(&conn);
    let currency = Currency::from_str("USD").unwrap();
    let money = crate::Money {
        minor_units: 1000,
        currency,
    };
    s.create_product("SKU-TAX2", "Item", money, None, None, 0, None)
        .unwrap();

    let r1 = s.create_tax_rate("R1", 500, false, false).unwrap();
    let r2 = s.create_tax_rate("R2", 1000, false, false).unwrap();

    s.set_product_tax_rates("SKU-TAX2", std::slice::from_ref(&r1.id))
        .unwrap();
    s.set_product_tax_rates("SKU-TAX2", std::slice::from_ref(&r2.id))
        .unwrap();

    let ids = s.get_product_tax_rates("SKU-TAX2").unwrap();
    assert_eq!(ids, vec![r2.id]);
}

#[test]
fn set_and_get_category_tax_rates() {
    let conn = fresh();
    let s = store(&conn);
    s.create_category("cat-tax", "Taxed Cat", "#fff", "")
        .unwrap();

    let rate = s.create_tax_rate("CT", 800, false, false).unwrap();
    s.set_category_tax_rates("cat-tax", std::slice::from_ref(&rate.id))
        .unwrap();

    let ids = s.get_category_tax_rates("cat-tax").unwrap();
    assert_eq!(ids, vec![rate.id]);
}

#[test]
fn get_product_tax_rates_none() {
    let conn = fresh();
    let s = store(&conn);
    let ids = s.get_product_tax_rates("NO-SKU").unwrap();
    assert!(ids.is_empty());
}

#[test]
fn get_product_tax_rates_batch_returns_all_skus() {
    let conn = fresh();
    let s = store(&conn);
    let currency = Currency::from_str("USD").unwrap();
    let money = crate::Money {
        minor_units: 1000,
        currency,
    };
    let r1 = s.create_tax_rate("GST", 1000, true, false).unwrap();
    let r2 = s.create_tax_rate("State", 500, false, false).unwrap();
    s.create_product("A", "Product A", money, None, None, 0, None)
        .unwrap();
    s.create_product("B", "Product B", money, None, None, 0, None)
        .unwrap();
    s.set_product_tax_rates("A", &[r1.id.clone(), r2.id.clone()])
        .unwrap();
    s.set_product_tax_rates("B", std::slice::from_ref(&r1.id))
        .unwrap();

    let map = s
        .get_product_tax_rates_batch(&["A".into(), "B".into(), "NOPE".into()])
        .unwrap();
    assert_eq!(map.get("A").map(|v| v.len()), Some(2));
    assert_eq!(map.get("B").map(|v| v.len()), Some(1));
    assert!(!map.contains_key("NOPE"));
}

#[test]
fn get_product_tax_rates_batch_empty_skus() {
    let conn = fresh();
    let s = store(&conn);
    let map = s.get_product_tax_rates_batch(&[]).unwrap();
    assert!(map.is_empty());
}

#[test]
fn get_category_tax_rates_none() {
    let conn = fresh();
    let s = store(&conn);
    let ids = s.get_category_tax_rates("no-cat").unwrap();
    assert!(ids.is_empty());
}

// ── Extended edge cases (coverage 19→25) ──────────────────────────

#[test]
fn create_tax_rate_trims_whitespace_name_then_rejects_empty() {
    let conn = fresh();
    let s = store(&conn);
    // Name with only whitespace should be rejected after trim
    let result = s.create_tax_rate("   ", 100, false, false);
    assert!(matches!(
        result,
        Err(CoreError::Validation { field: "name", .. })
    ));
}

#[test]
fn list_tax_rates_ordered_by_name() {
    let conn = fresh();
    let s = store(&conn);
    s.create_tax_rate("Zebra Tax", 300, false, false).unwrap();
    s.create_tax_rate("Alpha Tax", 100, false, false).unwrap();
    s.create_tax_rate("Mike Tax", 200, false, false).unwrap();

    let rates = s.list_tax_rates().unwrap();
    assert_eq!(rates.len(), 3);
    assert_eq!(rates[0].name, "Alpha Tax");
    assert_eq!(rates[1].name, "Mike Tax");
    assert_eq!(rates[2].name, "Zebra Tax");
}

#[test]
fn update_default_flag_clears_previous_default() {
    let conn = fresh();
    let s = store(&conn);
    let first = s.create_tax_rate("First", 500, true, false).unwrap();
    let second = s.create_tax_rate("Second", 1000, false, false).unwrap();

    // Update second to become default; first should be cleared
    s.update_tax_rate(&second.id, "Second", 1000, true, false)
        .unwrap();

    let r1 = s.get_tax_rate(&first.id).unwrap().unwrap();
    let r2 = s.get_tax_rate(&second.id).unwrap().unwrap();
    assert!(!r1.is_default, "first default should be cleared");
    assert!(r2.is_default);
}

#[test]
fn product_tax_rates_with_multiple_rates() {
    let conn = fresh();
    let s = store(&conn);
    let currency = Currency::from_str("USD").unwrap();
    let money = crate::Money {
        minor_units: 1000,
        currency,
    };
    s.create_product("SKU-MULTI", "Multi-Tax", money, None, None, 0, None)
        .unwrap();

    let r1 = s.create_tax_rate("VAT", 1000, false, false).unwrap();
    let r2 = s.create_tax_rate("SVC", 500, false, false).unwrap();

    s.set_product_tax_rates("SKU-MULTI", &[r1.id.clone(), r2.id.clone()])
        .unwrap();

    let ids = s.get_product_tax_rates("SKU-MULTI").unwrap();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&r1.id));
    assert!(ids.contains(&r2.id));
}

#[test]
fn category_tax_rates_with_multiple_rates() {
    let conn = fresh();
    let s = store(&conn);
    s.create_category("cat-multi", "Multi Tax Cat", "#fff", "")
        .unwrap();

    let r1 = s.create_tax_rate("CT-A", 700, false, false).unwrap();
    let r2 = s.create_tax_rate("CT-B", 300, false, false).unwrap();

    s.set_category_tax_rates("cat-multi", &[r1.id.clone(), r2.id.clone()])
        .unwrap();

    let ids = s.get_category_tax_rates("cat-multi").unwrap();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&r1.id));
    assert!(ids.contains(&r2.id));
}

#[test]
fn category_tax_rates_overwrites() {
    let conn = fresh();
    let s = store(&conn);
    s.create_category("cat-ow", "OW", "#000", "").unwrap();

    let r1 = s.create_tax_rate("Old", 100, false, false).unwrap();
    let r2 = s.create_tax_rate("New", 200, false, false).unwrap();

    s.set_category_tax_rates("cat-ow", std::slice::from_ref(&r1.id))
        .unwrap();
    s.set_category_tax_rates("cat-ow", std::slice::from_ref(&r2.id))
        .unwrap();

    let ids = s.get_category_tax_rates("cat-ow").unwrap();
    assert_eq!(ids, vec![r2.id]);
}

// ── TAX-03: soft-delete + dependency policy ─────────────────────

#[test]
fn update_archived_tax_rate_returns_not_found() {
    let conn = fresh();
    let s = store(&conn);
    let created = s.create_tax_rate("Archive Me", 100, false, false).unwrap();
    s.delete_tax_rate(&created.id).unwrap();

    // TAX-03: an archived rate must not be updatable (immutable history).
    let result = s.update_tax_rate(&created.id, "Resurrected", 200, false, false);
    assert!(matches!(result, Err(CoreError::NotFound { .. })));
}

#[test]
fn delete_tax_rate_archives_instead_of_hard_delete() {
    let conn = fresh();
    let s = store(&conn);
    let created = s.create_tax_rate("Archive Me", 100, false, false).unwrap();

    s.delete_tax_rate(&created.id).unwrap();

    // Hidden from listing and lookup, but the row still exists with
    // is_active = 0 (so historical sale_lines references resolve).
    assert!(s.get_tax_rate(&created.id).unwrap().is_none());
    assert!(s.list_tax_rates().unwrap().is_empty());
    let raw_active: i64 = conn
        .query_row(
            "SELECT is_active FROM tax_rates WHERE id = ?1",
            params![created.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(raw_active, 0, "row must be archived, not deleted");
}

#[test]
fn delete_tax_rate_clears_product_and_category_junctions() {
    let conn = fresh();
    let s = store(&conn);
    let currency = foundation::Currency::from_str("USD").unwrap();
    let money = crate::Money {
        minor_units: 1000,
        currency,
    };
    s.create_product("SKU-TAX3", "Item", money, None, None, 0, None)
        .unwrap();
    s.create_category("cat-tax3", "Taxed Cat", "#fff", "")
        .unwrap();

    let rate = s.create_tax_rate("VAT", 1000, true, false).unwrap();
    s.set_product_tax_rates("SKU-TAX3", std::slice::from_ref(&rate.id))
        .unwrap();
    s.set_category_tax_rates("cat-tax3", std::slice::from_ref(&rate.id))
        .unwrap();

    // Sanity: both junctions populated before archive.
    assert_eq!(s.get_product_tax_rates("SKU-TAX3").unwrap().len(), 1);
    assert_eq!(s.get_category_tax_rates("cat-tax3").unwrap().len(), 1);

    s.delete_tax_rate(&rate.id).unwrap();

    // Junction rows are configuration, not history — they must be
    // cleaned so no product/category points at an archived rate.
    assert!(s.get_product_tax_rates("SKU-TAX3").unwrap().is_empty());
    assert!(s.get_category_tax_rates("cat-tax3").unwrap().is_empty());
}

#[test]
fn delete_tax_rate_blocked_when_referenced_by_sales() {
    let conn = fresh();
    let s = store(&conn);
    let rate = s.create_tax_rate("Historic", 1000, true, false).unwrap();

    // Seed a historical sale line that references the rate.
    conn.execute_batch(&format!(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            ('p-hist', 'SKU-HIST', 'Item', 1000, 'USD', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
            ('sale-hist', 1000, 'USD', 1, 'completed', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position, tax_rate_id) VALUES
            ('sl-hist', 'sale-hist', 'SKU-HIST', 1, 1000, 1000, 'USD', 1, '{}');",
        rate.id
    ))
    .unwrap();

    // Dependency count must surface the sale reference.
    let counts = s.tax_rate_dependency_counts(&rate.id).unwrap();
    assert_eq!(counts.sale_lines, 1);

    // Archive must be blocked with a structured validation error.
    let err = s.delete_tax_rate(&rate.id).unwrap_err();
    assert!(matches!(
        err,
        CoreError::Validation {
            field: "tax_rate",
            ..
        }
    ));
    assert!(
        s.get_tax_rate(&rate.id).unwrap().is_some(),
        "rate must remain active after a blocked archive"
    );
}

#[test]
fn tax_rate_dependency_counts_are_zero_for_orphan() {
    let conn = fresh();
    let s = store(&conn);
    let rate = s.create_tax_rate("Lonely", 500, false, false).unwrap();

    let counts = s.tax_rate_dependency_counts(&rate.id).unwrap();
    assert_eq!(counts.products, 0);
    assert_eq!(counts.categories, 0);
    assert_eq!(counts.sale_lines, 0);
}

#[test]
fn tax_rate_dependency_counts_include_assignments() {
    let conn = fresh();
    let s = store(&conn);
    let currency = foundation::Currency::from_str("USD").unwrap();
    let money = crate::Money {
        minor_units: 1000,
        currency,
    };
    s.create_product("SKU-DEP1", "Item", money, None, None, 0, None)
        .unwrap();
    s.create_category("cat-dep1", "Cat", "#fff", "").unwrap();

    let rate = s.create_tax_rate("Dep", 800, false, false).unwrap();
    s.set_product_tax_rates("SKU-DEP1", std::slice::from_ref(&rate.id))
        .unwrap();
    s.set_category_tax_rates("cat-dep1", std::slice::from_ref(&rate.id))
        .unwrap();

    let counts = s.tax_rate_dependency_counts(&rate.id).unwrap();
    assert_eq!(counts.products, 1);
    assert_eq!(counts.categories, 1);
    assert_eq!(counts.sale_lines, 0);
}

// ── TAX-03 residual: assignments reject archived rate ids ────────

#[test]
fn set_product_tax_rates_rejects_archived_rate_id() {
    let conn = fresh();
    let s = store(&conn);
    let currency = foundation::Currency::from_str("USD").unwrap();
    let money = crate::Money {
        minor_units: 1000,
        currency,
    };
    s.create_product("SKU-ARCH", "Item", money, None, None, 0, None)
        .unwrap();

    let rate = s.create_tax_rate("VAT", 1000, true, false).unwrap();
    s.delete_tax_rate(&rate.id).unwrap();

    // TAX-03: an archived (immutable) rate must not be assignable.
    let err = s
        .set_product_tax_rates("SKU-ARCH", std::slice::from_ref(&rate.id))
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "tax_rate",
            ..
        }
    ));
    // Junction rows must be untouched by the rejected assignment.
    assert!(s.get_product_tax_rates("SKU-ARCH").unwrap().is_empty());
}

#[test]
fn set_category_tax_rates_rejects_archived_rate_id() {
    let conn = fresh();
    let s = store(&conn);
    s.create_category("cat-arch", "Cat", "#fff", "").unwrap();

    let rate = s.create_tax_rate("VAT", 1000, true, false).unwrap();
    s.delete_tax_rate(&rate.id).unwrap();

    let err = s
        .set_category_tax_rates("cat-arch", std::slice::from_ref(&rate.id))
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "tax_rate",
            ..
        }
    ));
    assert!(s.get_category_tax_rates("cat-arch").unwrap().is_empty());
}

#[test]
fn set_product_tax_rates_rejects_mixed_list_without_partial_write() {
    let conn = fresh();
    let s = store(&conn);
    let currency = foundation::Currency::from_str("USD").unwrap();
    let money = crate::Money {
        minor_units: 1000,
        currency,
    };
    s.create_product("SKU-MIX", "Item", money, None, None, 0, None)
        .unwrap();

    let active = s.create_tax_rate("Active", 500, false, false).unwrap();
    let archived = s.create_tax_rate("Archived", 1000, false, false).unwrap();
    s.delete_tax_rate(&archived.id).unwrap();

    // One archived id poisons the whole assignment — nothing is written.
    let err = s
        .set_product_tax_rates("SKU-MIX", &[active.id.clone(), archived.id.clone()])
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "tax_rate",
            ..
        }
    ));
    assert!(s.get_product_tax_rates("SKU-MIX").unwrap().is_empty());
}

#[test]
fn set_category_tax_rates_rejects_unknown_rate_id() {
    let conn = fresh();
    let s = store(&conn);
    s.create_category("cat-unk", "Cat", "#fff", "").unwrap();

    // Unknown ids are rejected with the same structured error as archived.
    let err = s
        .set_category_tax_rates("cat-unk", &["no-such-rate".into()])
        .unwrap_err();
    assert!(matches!(
        err,
        CoreError::NotFound {
            entity: "tax_rate",
            ..
        }
    ));
    assert!(s.get_category_tax_rates("cat-unk").unwrap().is_empty());
}

// ── Scoped resolution (tax-separation P1, slice 1) ──────────────────
//
// The write-side IPC is the NEXT slice, so every scoped row here is seeded
// with raw SQL. That is the only way to test a reader before there is a
// writer — and it is the honest statement of the slice boundary: nothing in
// production can put a value in these four columns yet.

/// Seed a legal entity + location pair so the new FKs resolve: fresh_db's
/// snapshot runs with PRAGMA foreign_keys = ON.
fn seed_topology(conn: &Connection, entity: &str, location: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO legal_entities (id, tenant_id, name) VALUES (?1, 'default', ?1)",
        rusqlite::params![entity],
    )
    .unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO locations (id, name) VALUES (?1, ?1)",
        rusqlite::params![location],
    )
    .unwrap();
}

#[allow(clippy::too_many_arguments)]
fn insert_scoped_rate(
    conn: &Connection,
    id: &str,
    name: &str,
    rate_bps: i64,
    is_default: bool,
    legal_entity_id: Option<&str>,
    location_id: Option<&str>,
    effective_from: Option<&str>,
    effective_to: Option<&str>,
) {
    conn.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, is_active,
                                legal_entity_id, location_id, effective_from, effective_to)
         VALUES (?1, ?2, ?3, ?4, 0, 1, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            id,
            name,
            rate_bps,
            is_default,
            legal_entity_id,
            location_id,
            effective_from,
            effective_to
        ],
    )
    .unwrap();
}

#[test]
fn every_existing_row_resolves_as_the_tenant_global_answer() {
    // THE regression proof for this slice. A database written before scoping —
    // one default row, both scope columns NULL — must resolve to exactly the
    // row get_default_tax_rate returns. If this diverges, the migration has
    // changed money math for every existing tenant.
    let conn = fresh();
    let s = store(&conn);
    let legacy = s.create_tax_rate("Sales Tax", 825, true, false).unwrap();
    let resolved = s
        .resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
        .unwrap()
        .expect("the legacy default must still resolve");
    assert_eq!(resolved.id, legacy.id);
    assert_eq!(resolved.rate_bps, 825);
    assert_eq!(
        s.tax_rate_scope(&legacy.id).unwrap(),
        Some(TaxRateScope::Global),
        "a pre-scoping row IS the tenant-global legacy default"
    );
}

#[test]
fn location_scoped_rate_wins_over_the_tenant_global_row() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    s.create_tax_rate("Global VAT", 1000, true, false).unwrap();
    insert_scoped_rate(
        &conn,
        "r-loc",
        "Jakarta rate",
        1100,
        false,
        None,
        Some("loc-a"),
        None,
        None,
    );
    let resolved = s
        .resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
        .unwrap()
        .unwrap();
    assert_eq!(
        resolved.id, "r-loc",
        "the location row outranks the global one"
    );
    assert_eq!(resolved.rate_bps, 1100);
}

#[test]
fn entity_scoped_rate_wins_over_global_and_loses_to_location() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    seed_topology(&conn, "ent-a", "loc-b");
    s.create_tax_rate("Global VAT", 1000, true, false).unwrap();
    insert_scoped_rate(
        &conn,
        "r-ent",
        "Entity rate",
        1200,
        false,
        Some("ent-a"),
        None,
        None,
        None,
    );
    // loc-b has no row of its own, so the entity row is the most specific match.
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-b", Some("ent-a"), "2026-09-08")
            .unwrap()
            .unwrap()
            .id,
        "r-ent"
    );
    // loc-a has its own row, which outranks the entity row above it.
    insert_scoped_rate(
        &conn,
        "r-loc",
        "Location rate",
        1100,
        false,
        None,
        Some("loc-a"),
        None,
        None,
    );
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap()
            .unwrap()
            .id,
        "r-loc",
        "location beats entity beats global"
    );
}

#[test]
fn a_rate_belonging_to_another_location_or_entity_never_leaks() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    seed_topology(&conn, "ent-b", "loc-b");
    insert_scoped_rate(
        &conn,
        "r-other-loc",
        "Other loc",
        9999,
        false,
        None,
        Some("loc-b"),
        None,
        None,
    );
    insert_scoped_rate(
        &conn,
        "r-other-ent",
        "Other ent",
        8888,
        false,
        Some("ent-b"),
        None,
        None,
        None,
    );
    // No tenant-global row exists, so the correct answer for loc-a/ent-a is
    // None — never a neighbouring scope's rate.
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap(),
        None,
        "another location's or another entity's rate must not be applied here"
    );
}

#[test]
fn a_null_entity_in_the_request_skips_the_entity_level() {
    // NULL legal_entity_id means "not scoped to an entity", never "matches
    // every entity-scoped row". Without this a location whose entity is not
    // yet assigned would silently inherit some entity's rate.
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    insert_scoped_rate(
        &conn,
        "r-ent",
        "Entity rate",
        1200,
        false,
        Some("ent-a"),
        None,
        None,
        None,
    );
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", None, "2026-09-08")
            .unwrap(),
        None,
        "no entity in the request must skip level 2, not wildcard it"
    );
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap()
            .map(|r| r.id),
        Some("r-ent".to_string())
    );
}

#[test]
fn effective_from_gates_a_rate_that_has_not_started_yet() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let global = s.create_tax_rate("Global VAT", 1000, true, false).unwrap();
    insert_scoped_rate(
        &conn,
        "r-future",
        "Next year",
        1500,
        false,
        None,
        Some("loc-a"),
        Some("2027-01-01"),
        None,
    );
    // Before the start date the scoped row is not live, so the walk falls
    // through to the tenant-global row.
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-12-31")
            .unwrap()
            .unwrap()
            .id,
        global.id,
        "the global row answers while the scoped row has not started"
    );
    // ON the start date it applies: effective_from is inclusive.
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2027-01-01")
            .unwrap()
            .unwrap()
            .id,
        "r-future"
    );
}

#[test]
fn an_expired_scoped_rate_falls_back_to_the_tenant_global_row() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let global = s.create_tax_rate("Global VAT", 1000, true, false).unwrap();
    insert_scoped_rate(
        &conn,
        "r-expired",
        "2025 only",
        1500,
        false,
        None,
        Some("loc-a"),
        Some("2025-01-01"),
        Some("2026-01-01"),
    );
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2025-12-31")
            .unwrap()
            .unwrap()
            .id,
        "r-expired"
    );
    let after = s
        .resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-01-01")
        .unwrap()
        .unwrap();
    assert_eq!(after.id, global.id, "an expired row is ignored");
    assert_eq!(after.rate_bps, 1000);
}

#[test]
fn two_consecutive_periods_cannot_both_match_on_the_boundary_day() {
    // Why effective_to is EXCLUSIVE: when a successor starts the day its
    // predecessor ends, exactly one may match — otherwise the resolver needs a
    // tie-break to price a sale.
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    insert_scoped_rate(
        &conn,
        "r-old",
        "Until 2026",
        1000,
        false,
        None,
        Some("loc-a"),
        Some("2025-01-01"),
        Some("2026-01-01"),
    );
    insert_scoped_rate(
        &conn,
        "r-new",
        "From 2026",
        1200,
        false,
        None,
        Some("loc-a"),
        Some("2026-01-01"),
        None,
    );
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-01-01")
            .unwrap()
            .unwrap()
            .id,
        "r-new",
        "the boundary day belongs to the successor, and only to it"
    );
}

#[test]
fn within_a_level_the_newest_effective_from_wins() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    insert_scoped_rate(
        &conn,
        "r-early",
        "2024 rate",
        1000,
        false,
        None,
        Some("loc-a"),
        Some("2024-01-01"),
        None,
    );
    insert_scoped_rate(
        &conn,
        "r-late",
        "2026 rate",
        1200,
        false,
        None,
        Some("loc-a"),
        Some("2026-01-01"),
        None,
    );
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap()
            .unwrap()
            .id,
        "r-late",
        "the newest start date is the current rate"
    );
}

#[test]
fn an_undated_row_is_the_oldest_possible_start_so_a_dated_one_wins() {
    // NULL effective_from means "no lower bound", which sorts as the earliest
    // start rather than the newest — otherwise adding a date to a row would
    // silently demote it.
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    insert_scoped_rate(
        &conn,
        "r-undated",
        "No window",
        900,
        false,
        None,
        Some("loc-a"),
        None,
        None,
    );
    insert_scoped_rate(
        &conn,
        "r-dated",
        "Dated",
        1100,
        false,
        None,
        Some("loc-a"),
        Some("2020-01-01"),
        None,
    );
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap()
            .unwrap()
            .id,
        "r-dated"
    );
}

#[test]
fn an_explicit_default_outranks_a_newer_start_within_the_same_level() {
    // is_default is the operator's own "this one" signal and predates scoping,
    // so it stays the primary key INSIDE a level. Precedence ACROSS levels is
    // unaffected: a scoped row still beats a tenant-global default.
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    insert_scoped_rate(
        &conn,
        "r-pick",
        "Picked",
        1000,
        true,
        None,
        Some("loc-a"),
        Some("2020-01-01"),
        None,
    );
    insert_scoped_rate(
        &conn,
        "r-newer",
        "Newer but unpicked",
        1200,
        false,
        None,
        Some("loc-a"),
        Some("2026-01-01"),
        None,
    );
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap()
            .unwrap()
            .id,
        "r-pick"
    );
}

#[test]
fn an_untrusted_row_is_skipped_and_the_walk_falls_through() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let global = s.create_tax_rate("Global VAT", 1000, true, false).unwrap();
    // Malformed stored window: an impossible calendar day as the end date.
    // This used to be an ambiguous-scope row (both columns set), which the
    // schema now refuses outright — see the CHECK assertion below.
    insert_scoped_rate(
        &conn,
        "r-badend",
        "Bad end",
        1500,
        false,
        None,
        Some("loc-a"),
        None,
        Some("2026-02-30"),
    );
    // Malformed stored windows: an RFC3339 timestamp, and an empty-string end.
    insert_scoped_rate(
        &conn,
        "r-ts",
        "Timestamp",
        1600,
        false,
        None,
        Some("loc-a"),
        Some("2026-01-01T00:00:00Z"),
        None,
    );
    insert_scoped_rate(
        &conn,
        "r-empty",
        "Empty date",
        1700,
        false,
        None,
        Some("loc-a"),
        None,
        Some(""),
    );
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap()
            .unwrap()
            .id,
        global.id,
        "none of the three untrusted rows may decide the rate"
    );
    // A both-set row can no longer be written at all: migration
    // 20260926_tax_rate_scoped_authoring rebuilt tax_rates with
    // CHECK (legal_entity_id IS NULL OR location_id IS NULL). That makes the
    // resolver's ambiguous-scope error unreachable-by-construction on a guarded
    // database, and it is KEPT as defense-in-depth — it is the answer a row
    // gives on a hub whose schema predates the guard. What is asserted here is
    // therefore the SCHEMA's refusal, not the type's.
    let amb_err = conn
        .execute(
            "INSERT INTO tax_rates (id, name, rate_bps, is_default,
                                    legal_entity_id, location_id)
             VALUES ('r-ambiguous', 'Both scopes', 1500, 0, 'ent-a', 'loc-a')",
            [],
        )
        .unwrap_err();
    assert!(
        amb_err.to_string().contains("CHECK constraint failed"),
        "the schema itself must refuse a both-set row, got {amb_err}"
    );
    // An untrusted WINDOW is not a scope problem: the row keeps its real scope
    // and is skipped by the walk rather than reclassified or reported ambiguous.
    assert!(matches!(
        s.tax_rate_scope("r-badend").unwrap(),
        Some(TaxRateScope::Location(_))
    ));
    assert!(matches!(
        s.tax_rate_scope("r-ts").unwrap(),
        Some(TaxRateScope::Location(_))
    ));
    assert!(
        s.tax_rate_scope(&global.id)
            .unwrap()
            .is_some_and(|sc| sc.is_global())
    );
    assert_eq!(s.tax_rate_scope("no-such-rate").unwrap(), None);
}

#[test]
fn a_malformed_as_of_is_the_callers_bug_and_errors() {
    // Ok(None) means "no rate is configured". Returning it for a bad argument
    // would make a typo look like an unconfigured tenant, so this is an error.
    let conn = fresh();
    let s = store(&conn);
    for bad in [
        "",
        "2026-9-8",
        "2026-09",
        "2026-09-08T00:00:00Z",
        "2026-13-01",
        "2026-02-30",
        "not-a-date",
    ] {
        let err = s
            .resolve_tax_rate_for_location("loc-a", None, bad)
            .unwrap_err();
        assert!(
            matches!(&err, CoreError::Validation { field: "as_of", .. }),
            "{bad:?} must be rejected, got {err:?}"
        );
    }
    // A well-formed date is accepted even when nothing matches.
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", None, "2026-09-08")
            .unwrap(),
        None
    );
}

#[test]
fn an_archived_scoped_rate_is_invisible_to_the_walk() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let global = s.create_tax_rate("Global VAT", 1000, true, false).unwrap();
    insert_scoped_rate(
        &conn,
        "r-arch",
        "Archived",
        1500,
        false,
        None,
        Some("loc-a"),
        None,
        None,
    );
    s.delete_tax_rate("r-arch").unwrap();
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap()
            .unwrap()
            .id,
        global.id,
        "TAX-03: an archived rate is hidden from resolution too"
    );
    assert_eq!(s.tax_rate_scope("r-arch").unwrap(), None);
}

#[test]
fn no_configured_rate_resolves_to_none() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap(),
        None
    );
}

#[test]
fn classify_is_the_single_statement_of_the_scope_rule() {
    assert_eq!(
        TaxRateScope::classify(None, None),
        Some(TaxRateScope::Global)
    );
    assert_eq!(
        TaxRateScope::classify(Some("ent-a"), None),
        Some(TaxRateScope::LegalEntity("ent-a".into()))
    );
    assert_eq!(
        TaxRateScope::classify(None, Some("loc-a")),
        Some(TaxRateScope::Location("loc-a".into()))
    );
    assert_eq!(TaxRateScope::classify(Some("ent-a"), Some("loc-a")), None);
    assert!(TaxRateScope::Global.is_global());
    assert!(!TaxRateScope::Location("loc-a".into()).is_global());
}

#[test]
fn business_dates_parse_strictly_and_reject_every_other_shape() {
    assert!(parse_effective_date("2026-09-08").is_some());
    assert!(parse_effective_date("2024-02-29").is_some(), "leap year");
    for bad in [
        "",
        "2026-9-08",
        "2026-09-8",
        "2026-09-08 ",
        " 2026-09-08",
        "2026-09-08T00:00:00Z",
        "08-09-2026",
        "2026/09/08",
        "2026-00-08",
        "2026-13-08",
        "2026-09-31",
        "2025-02-29",
        "xxxx-xx-xx",
    ] {
        assert!(
            parse_effective_date(bad).is_none(),
            "{bad:?} must not parse"
        );
    }
}

// ── Scoped authoring (tax-separation P1, slice A2) ──────────────────────
//
// The write half. Everything above had to seed scoped rows with raw SQL
// because nothing in core could author them; from here on there is a writer,
// so these go through it. The one place that deliberately writes raw SQL says
// why in its own comment.

#[test]
fn create_tax_rate_scoped_stores_scope_window_and_prices_the_location() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let global = s.create_tax_rate("Global VAT", 1000, true, false).unwrap();
    let window = TaxRateWindow {
        effective_from: Some("2026-01-01".into()),
        effective_to: Some("2027-01-01".into()),
    };
    let rate = s
        .create_tax_rate_scoped(
            "Jakarta PPN",
            1100,
            false,
            false,
            &TaxRateScope::Location("loc-a".into()),
            &window,
        )
        .unwrap();

    assert_eq!(
        s.tax_rate_scope(&rate.id).unwrap(),
        Some(TaxRateScope::Location("loc-a".into())),
        "the scope round-trips"
    );
    assert_eq!(s.tax_rate_window(&rate.id).unwrap(), Some(window));
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap()
            .unwrap()
            .id,
        rate.id,
        "the new row prices its own location"
    );
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-b", None, "2026-09-08")
            .unwrap()
            .unwrap()
            .id,
        global.id,
        "and nobody else's"
    );
}

#[test]
fn an_entity_default_leaves_the_tenant_global_default_in_place() {
    // THE bug this slice closes. The old clear was
    // UPDATE ... SET is_default = 0 WHERE is_default = 1 across the whole
    // table, so authoring an entity default silently un-defaulted the
    // tenant-global row and every location without its own rate lost the rate
    // it was pricing on.
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let global = s.create_tax_rate("Global VAT", 1000, true, false).unwrap();

    let ent = s
        .create_tax_rate_scoped(
            "Entity VAT",
            1200,
            true,
            false,
            &TaxRateScope::LegalEntity("ent-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();

    assert!(
        s.get_tax_rate(&global.id).unwrap().expect("row").is_default,
        "a default in one tier must not touch another tier's default"
    );
    assert!(s.get_tax_rate(&ent.id).unwrap().unwrap().is_default);
}

#[test]
fn the_same_tier_default_is_still_replaced() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let first = s
        .create_tax_rate_scoped(
            "Loc rate A",
            1000,
            true,
            false,
            &TaxRateScope::Location("loc-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();
    let second = s
        .create_tax_rate_scoped(
            "Loc rate B",
            1100,
            true,
            false,
            &TaxRateScope::Location("loc-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();
    assert!(!s.get_tax_rate(&first.id).unwrap().unwrap().is_default);
    assert!(s.get_tax_rate(&second.id).unwrap().unwrap().is_default);
}

#[test]
fn a_location_default_clears_only_its_own_location_tier_row() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    seed_topology(&conn, "ent-a", "loc-b");
    let a = s
        .create_tax_rate_scoped(
            "Loc A",
            1000,
            true,
            false,
            &TaxRateScope::Location("loc-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();
    let b = s
        .create_tax_rate_scoped(
            "Loc B",
            1100,
            true,
            false,
            &TaxRateScope::Location("loc-b".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();
    assert!(s.get_tax_rate(&a.id).unwrap().unwrap().is_default);
    assert!(s.get_tax_rate(&b.id).unwrap().unwrap().is_default);
}

#[test]
fn create_tax_rate_scoped_refuses_a_malformed_or_inverted_window() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let scope = TaxRateScope::Location("loc-a".into());
    // None means "column absent", Some("") means "column present but empty"
    // — a present-but-unreadable date, which is exactly what must be refused.
    let bad: [(Option<&str>, Option<&str>, &str); 6] = [
        (Some("2026-1-1"), None, "effective_from"),
        (Some("2026-01-01T00:00:00Z"), None, "effective_from"),
        (Some(""), None, "effective_from"),
        (None, Some("2026-02-30"), "effective_to"),
        // Equal bounds cover no day at all: effective_to is exclusive.
        (Some("2026-01-01"), Some("2026-01-01"), "effective_to"),
        (Some("2026-06-01"), Some("2026-01-01"), "effective_to"),
    ];
    for (from, to, field) in bad {
        let window = TaxRateWindow {
            effective_from: from.map(str::to_owned),
            effective_to: to.map(str::to_owned),
        };
        let err = s
            .create_tax_rate_scoped("Bad window", 1000, false, false, &scope, &window)
            .expect_err("an unusable period must be refused");
        assert!(
            matches!(&err, CoreError::Validation { field: f, .. } if *f == field),
            "{from:?}..{to:?} must name {field}, got {err:?}"
        );
    }
    // Every refusal happened before the transaction opened.
    assert!(s.list_tax_rates().unwrap().is_empty());
}

#[test]
fn create_tax_rate_scoped_refuses_an_unknown_or_blank_scope_target() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let w = TaxRateWindow::default();
    let err = s
        .create_tax_rate_scoped(
            "Nowhere",
            1000,
            false,
            false,
            &TaxRateScope::Location("loc-nope".into()),
            &w,
        )
        .expect_err("a missing location is not a scope");
    assert!(
        matches!(&err, CoreError::Validation { field, .. } if *field == "location_id"),
        "a typed location_id error, not a bare FK violation: {err:?}"
    );
    let err = s
        .create_tax_rate_scoped(
            "Blank",
            1000,
            false,
            false,
            &TaxRateScope::LegalEntity("  ".into()),
            &w,
        )
        .expect_err("an empty entity id is not a scope either");
    assert!(matches!(
        &err,
        CoreError::Validation { field, .. } if *field == "legal_entity_id"
    ));
}

#[test]
fn update_tax_rate_scoped_moves_tiers_keeps_created_at_and_refuses_archived() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let rate = s
        .create_tax_rate_scoped(
            "Location rate",
            1000,
            true,
            false,
            &TaxRateScope::Location("loc-a".into()),
            &TaxRateWindow {
                effective_from: Some("2026-01-01".into()),
                effective_to: None,
            },
        )
        .unwrap();

    let moved = s
        .update_tax_rate_scoped(
            &rate.id,
            "Entity rate",
            1200,
            false,
            false,
            &TaxRateScope::LegalEntity("ent-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();
    assert_eq!(moved.created_at, rate.created_at, "created_at survives");
    // updated_at is NOT asserted: both stamps come from the same clock read and
    // the writes land inside one millisecond, so an inequality here would be a
    // flake, not a fact.
    assert_eq!(
        s.tax_rate_scope(&rate.id).unwrap(),
        Some(TaxRateScope::LegalEntity("ent-a".into()))
    );
    assert_eq!(
        s.tax_rate_window(&rate.id).unwrap(),
        Some(TaxRateWindow::default()),
        "the window is replaced, not merged"
    );
    // The row left the location tier and stopped being a default, so that tier
    // now has none — the accepted, documented consequence of a tier change.
    assert!(!s.get_tax_rate(&rate.id).unwrap().unwrap().is_default);

    s.delete_tax_rate(&rate.id).unwrap();
    let err = s
        .update_tax_rate_scoped(
            &rate.id,
            "Resurrect",
            100,
            false,
            false,
            &TaxRateScope::Global,
            &TaxRateWindow::default(),
        )
        .expect_err("an archived rate stays immutable");
    assert!(matches!(err, CoreError::NotFound { .. }));
}

#[test]
fn list_tax_rate_scopes_reports_every_active_row_in_one_read() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let global = s.create_tax_rate("A Global", 1000, true, false).unwrap();
    let ent = s
        .create_tax_rate_scoped(
            "B Entity",
            1100,
            false,
            false,
            &TaxRateScope::LegalEntity("ent-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();
    let loc = s
        .create_tax_rate_scoped(
            "C Location",
            1200,
            false,
            false,
            &TaxRateScope::Location("loc-a".into()),
            &TaxRateWindow {
                effective_from: None,
                effective_to: Some("2027-01-01".into()),
            },
        )
        .unwrap();
    let gone = s
        .create_tax_rate_scoped(
            "D Gone",
            1300,
            false,
            false,
            &TaxRateScope::Global,
            &TaxRateWindow::default(),
        )
        .unwrap();
    s.delete_tax_rate(&gone.id).unwrap();

    let all = s.list_tax_rate_scopes().unwrap();
    let ids: Vec<String> = all.iter().map(|r| r.id.clone()).collect();
    assert_eq!(
        ids,
        vec![global.id.clone(), ent.id.clone(), loc.id.clone()],
        "active rows only, ordered by name"
    );
    let tiers: Vec<&str> = all
        .iter()
        .map(|r| match &r.scope {
            TaxRateScope::Global => "global",
            TaxRateScope::LegalEntity(_) => "entity",
            TaxRateScope::Location(_) => "location",
        })
        .collect();
    assert_eq!(tiers, vec!["global", "entity", "location"]);
    assert!(all[0].window.effective_from.is_none());
    assert_eq!(all[2].window.effective_to.as_deref(), Some("2027-01-01"));
}

#[test]
fn the_tier_unique_index_backstops_a_writer_that_does_not_clear() {
    // The only raw write in this section, on purpose: it proves the default
    // rule belongs to the database and is not just the writer being polite.
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    s.create_tax_rate_scoped(
        "Loc default",
        1000,
        true,
        false,
        &TaxRateScope::Location("loc-a".into()),
        &TaxRateWindow::default(),
    )
    .unwrap();
    let err = conn
        .execute(
            "INSERT INTO tax_rates (id, name, rate_bps, is_default, location_id)
             VALUES ('r-sneak', 'Second default', 1100, 1, 'loc-a')",
            [],
        )
        .unwrap_err();
    assert!(
        err.to_string().contains("UNIQUE constraint failed"),
        "the location tier's index must refuse a second default: {err}"
    );
    // A different tier is still free to hold its own default.
    assert!(
        s.create_tax_rate_scoped(
            "Entity default",
            1200,
            true,
            false,
            &TaxRateScope::LegalEntity("ent-a".into()),
            &TaxRateWindow::default(),
        )
        .is_ok()
    );
}

#[test]
fn tax_rate_window_reports_a_malformed_stored_date_verbatim() {
    // The writer refuses a malformed date, so one can only arrive from
    // elsewhere (a hub row, a hand edit). It is REPORTED, not repaired — the
    // resolver skips it, and a screen has to be able to show why.
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    insert_scoped_rate(
        &conn,
        "r-ts",
        "Timestamp",
        1000,
        false,
        None,
        Some("loc-a"),
        Some("2026-01-01T00:00:00Z"),
        None,
    );
    let w = s.tax_rate_window("r-ts").unwrap().unwrap();
    assert_eq!(w.effective_from.as_deref(), Some("2026-01-01T00:00:00Z"));
    assert_eq!(w.effective_to, None);
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", None, "2026-09-08")
            .unwrap(),
        None,
        "the untrusted row prices nothing"
    );
}

#[test]
fn the_unscoped_writer_still_leaves_scoped_tiers_alone() {
    // The D5 fix is not confined to the scoped writers. create_tax_rate is
    // reachable from the IPC today and can only ever write a tenant-global row,
    // so its table-wide clear used to wipe every entity and location default in
    // the database the moment an operator set an application default.
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let ent = s
        .create_tax_rate_scoped(
            "Entity default",
            1200,
            true,
            false,
            &TaxRateScope::LegalEntity("ent-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();
    let loc = s
        .create_tax_rate_scoped(
            "Location default",
            1100,
            true,
            false,
            &TaxRateScope::Location("loc-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();

    let global = s.create_tax_rate("Global VAT", 1000, true, false).unwrap();

    assert!(s.get_tax_rate(&global.id).unwrap().unwrap().is_default);
    assert!(
        s.get_tax_rate(&ent.id).unwrap().unwrap().is_default,
        "a tenant-global default must not reach into the entity tier"
    );
    assert!(
        s.get_tax_rate(&loc.id).unwrap().unwrap().is_default,
        "...or the location tier"
    );
}

// ── Delete guard: last covering row (tax-separation P1, slice A3) ─────
//
// Archiving the only row that covers a location is the same class of money
// bug as the unscoped default clear: a silent change to what a branch prices
// on. These pin the refusal, the fallbacks that lift it, and the two cases
// where refusing would be WRONG (the tenant-global tier, and a rate a
// historical sale already made permanent).

#[test]
fn delete_refuses_the_last_row_covering_a_location() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let only = s
        .create_tax_rate_scoped(
            "Loc only",
            1100,
            true,
            false,
            &TaxRateScope::Location("loc-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();

    let err = s
        .delete_tax_rate(&only.id)
        .expect_err("the last cover of a location must not be erasable");
    assert!(
        matches!(&err, CoreError::Validation { field, .. } if *field == "tax_rate"),
        "a typed validation error, got {err:?}"
    );
    let msg = err.to_string();
    assert!(
        msg.contains("loc-a") && msg.contains("location"),
        "the error names the location it protects: {msg}"
    );
    assert!(
        msg.contains("author a replacement"),
        "and says what to do instead of refusing: {msg}"
    );
    assert!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap()
            .is_some_and(|r| r.id == only.id),
        "a refusal means nothing was archived — the location still prices on it"
    );
}

#[test]
fn delete_allowed_when_a_fallback_tier_covers_the_location() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let global = s.create_tax_rate("Global VAT", 1000, true, false).unwrap();
    let loc = s
        .create_tax_rate_scoped(
            "Loc rate",
            1100,
            false,
            false,
            &TaxRateScope::Location("loc-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();

    s.delete_tax_rate(&loc.id)
        .expect("the global row still covers loc-a, so archiving is legal");
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", Some("ent-a"), "2026-09-08")
            .unwrap()
            .unwrap()
            .id,
        global.id,
        "and the location falls back rather than losing tax"
    );
}

#[test]
fn delete_allowed_when_a_sibling_row_covers_the_same_location() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let keeper = s
        .create_tax_rate_scoped(
            "Keeper",
            1100,
            false,
            false,
            &TaxRateScope::Location("loc-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();
    let redundant = s
        .create_tax_rate_scoped(
            "Redundant",
            1200,
            false,
            false,
            &TaxRateScope::Location("loc-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();

    s.delete_tax_rate(&redundant.id)
        .expect("two rows cover the location; one may go");
    assert_eq!(
        s.resolve_tax_rate_for_location("loc-a", None, "2026-09-08")
            .unwrap()
            .unwrap()
            .id,
        keeper.id
    );
}

#[test]
fn delete_refuses_the_last_entity_row_a_location_is_relying_on() {
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    // seed_topology does not link the location to the entity; without the link
    // there is no entity tier to lose, which is the point of setting it up here.
    conn.execute(
        "UPDATE locations SET legal_entity_id = \'ent-a\' WHERE id = \'loc-a\'",
        [],
    )
    .unwrap();
    let ent = s
        .create_tax_rate_scoped(
            "Ent rate",
            1200,
            true,
            false,
            &TaxRateScope::LegalEntity("ent-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();

    let msg = s
        .delete_tax_rate(&ent.id)
        .expect_err("loc-a would be left with no row at any tier")
        .to_string();
    assert!(
        msg.contains("ent-a") && msg.contains("entity-tier"),
        "names the tier and the entity: {msg}"
    );

    // Author the fallback the error asked for, and the same call succeeds.
    s.create_tax_rate("Global VAT", 1000, true, false).unwrap();
    s.delete_tax_rate(&ent.id)
        .expect("with a global fallback the archive is legal");
}

#[test]
fn the_tenant_global_tier_is_never_guarded() {
    // Ok(None) is a legitimate resolver answer: "this tenant configures no
    // tax". A single-rate tenant's only row is a tenant-global one, so
    // guarding that tier would mean tax could never be switched off — a
    // feature removed, not protection added.
    let conn = fresh();
    let s = store(&conn);
    let only = s.create_tax_rate("Legacy VAT", 1000, true, false).unwrap();
    s.delete_tax_rate(&only.id)
        .expect("archiving the last row of an unscoped tenant stays possible");
    assert_eq!(s.get_default_tax_rate().unwrap(), None);
    assert_eq!(
        s.resolve_tax_rate_for_location("default", None, "2026-09-08")
            .unwrap(),
        None,
        "the seeded location now reads as no tax configured, not as an error"
    );
}

#[test]
fn the_sales_reference_check_still_wins_over_the_coverage_guard() {
    // A rate that both prices a historical sale and is a location's last cover
    // must report the HISTORY reason. The coverage message tells the operator
    // to author a replacement, which cannot help: this row is never
    // archivable, and sending them down that path is a wrong instruction.
    let conn = fresh();
    let s = store(&conn);
    seed_topology(&conn, "ent-a", "loc-a");
    let rate = s
        .create_tax_rate_scoped(
            "Historic loc rate",
            1100,
            true,
            false,
            &TaxRateScope::Location("loc-a".into()),
            &TaxRateWindow::default(),
        )
        .unwrap();
    conn.execute_batch(&format!(
        "INSERT INTO products (id, sku, name, price_minor, currency, created_at, updated_at) VALUES
            (\'p-cov\', \'SKU-COV\', \'Item\', 1000, \'USD\', \'2025-01-01T00:00:00.000Z\', \'2025-01-01T00:00:00.000Z\');
         INSERT INTO sales (id, total_minor, currency, line_count, status, created_at, updated_at) VALUES
            (\'sale-cov\', 1000, \'USD\', 1, \'completed\', \'2025-01-01T00:00:00.000Z\', \'2025-01-01T00:00:00.000Z\');
         INSERT INTO sale_lines (id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position, tax_rate_id) VALUES
            (\'sl-cov\', \'sale-cov\', \'SKU-COV\', 1, 1000, 1000, \'USD\', 1, \'{}\');",
        rate.id
    ))
    .unwrap();

    let msg = s
        .delete_tax_rate(&rate.id)
        .expect_err("referenced by a historical sale")
        .to_string();
    assert!(
        msg.contains("historical sale line"),
        "the permanent reason must be the one reported: {msg}"
    );
    assert!(
        !msg.contains("author a replacement"),
        "not the coverage wording: {msg}"
    );
}
#[test]
fn tax_rate_writers_bump_updated_at_for_the_snapshot_fingerprint() {
    // E1-4 / D64(e): the branch snapshot-cache fingerprint is
    // (COUNT, MAX(updated_at)) on tax_rates — every writer must bump
    // updated_at or a reconfigure stops invalidating the pull cache. The
    // rounding-mode column (20260929) changed no writer shape; this pin
    // guards it against regressing later. Seeded with a frozen-old
    // updated_at so the assertion cannot flake on same-millisecond writes.
    let conn = fresh();
    let s = store(&conn);

    // create_tax_rate: the INSERT stamps updated_at (row exists => COUNT moves).
    let created_rate = s.create_tax_rate("VAT 10%", 1000, true, false).unwrap();
    let id = created_rate.id.clone();
    let created: String = conn
        .query_row(
            "SELECT updated_at FROM tax_rates WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!created.is_empty(), "create must stamp updated_at");

    // update_tax_rate must BUMP it.
    conn.execute(
        "UPDATE tax_rates SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1",
        [&id],
    )
    .unwrap();
    s.update_tax_rate(&id, "VAT 11%", 1100, true, false)
        .unwrap();
    let after: String = conn
        .query_row(
            "SELECT updated_at FROM tax_rates WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_ne!(
        after, "2020-01-01T00:00:00.000Z",
        "update_tax_rate must bump updated_at"
    );

    // update_tax_rate_scoped — the B1 authoring surface — must bump too.
    conn.execute(
        "UPDATE tax_rates SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1",
        [&id],
    )
    .unwrap();
    s.update_tax_rate_scoped(
        &id,
        "VAT 12%",
        1200,
        true,
        false,
        &TaxRateScope::Global,
        &TaxRateWindow::default(),
    )
    .unwrap();
    let after_scoped: String = conn
        .query_row(
            "SELECT updated_at FROM tax_rates WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_ne!(
        after_scoped, "2020-01-01T00:00:00.000Z",
        "update_tax_rate_scoped must bump updated_at"
    );
}

#[test]
fn list_tax_rate_rounding_modes_maps_the_statutory_alphabet() {
    // E1-2: the batch read door behind the compute loops. 'half_up' and
    // 'truncate' map to their modes; '' and unknown ids read as None (the
    // preference applies). The 20260929 CHECK refuses anything else, so the
    // unparseable arm is unreachable from the schema and the reader treats
    // it as a hard error when it somehow happens.
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, rounding_mode) VALUES
         ('r-trunc', 'Trunc', 1000, 'truncate'),
         ('r-half', 'Half', 1000, 'half_up'),
         ('r-plain', 'Plain', 1000, '')",
        [],
    )
    .unwrap();
    let modes = s
        .list_tax_rate_rounding_modes(&["r-trunc", "r-half", "r-plain", "r-ghost"])
        .unwrap();
    assert_eq!(modes["r-trunc"], Some(RoundingMode::Truncate));
    assert_eq!(modes["r-half"], Some(RoundingMode::HalfUp));
    assert_eq!(modes["r-plain"], None, "'' = no statutory directive");
    assert_eq!(modes["r-ghost"], None, "unknown id reads as no directive");
}

#[test]
fn list_tax_rate_rounding_modes_ignores_archived_rows() {
    let conn = fresh();
    let s = store(&conn);
    conn.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, is_active, rounding_mode)
         VALUES ('r-arch', 'Archived', 1000, 0, 'truncate')",
        [],
    )
    .unwrap();
    let modes = s.list_tax_rate_rounding_modes(&["r-arch"]).unwrap();
    assert_eq!(
        modes["r-arch"], None,
        "an archived row's directive must not steer a computation that no \
         longer resolves it"
    );
}
