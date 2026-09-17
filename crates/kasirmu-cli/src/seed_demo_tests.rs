//! Tests for `seed_demo.rs` pure helpers.
//!
//! The full seeder is DB-integration heavy (raw INSERT loops over
//! migrated SQLite), so these tests pin the extractable pure logic:
//! payment-method threshold boundaries and the per-store filename
//! matcher.

use super::*;

/* ── retail_payment_method thresholds ────────────────────────────── */

#[test]
fn retail_payment_method_boundaries() {
    // 45% cash: rolls 0..=44.
    assert_eq!(retail_payment_method(0), "cash");
    assert_eq!(retail_payment_method(44), "cash");
    // 30% QRIS: rolls 45..=74.
    assert_eq!(retail_payment_method(45), "qris");
    assert_eq!(retail_payment_method(74), "qris");
    // 20% debit: rolls 75..=94.
    assert_eq!(retail_payment_method(75), "debit");
    assert_eq!(retail_payment_method(94), "debit");
    // 5% split: rolls 95..=99.
    assert_eq!(retail_payment_method(95), "split");
    assert_eq!(retail_payment_method(99), "split");
}

#[test]
fn retail_payment_method_is_total_over_0_99() {
    let mut seen = std::collections::HashSet::new();
    for roll in 0..100 {
        seen.insert(retail_payment_method(roll));
    }
    assert_eq!(
        seen,
        ["cash", "qris", "debit", "split"].into_iter().collect(),
        "every bucket must be reachable in 0..100"
    );
}

/* ── restaurant_payment_method thresholds ────────────────────────── */

#[test]
fn restaurant_payment_method_boundaries() {
    // 40% cash: rolls 0..=39.
    assert_eq!(restaurant_payment_method(0), "cash");
    assert_eq!(restaurant_payment_method(39), "cash");
    // 30% QRIS: rolls 40..=69.
    assert_eq!(restaurant_payment_method(40), "qris");
    assert_eq!(restaurant_payment_method(69), "qris");
    // 20% debit: rolls 70..=89.
    assert_eq!(restaurant_payment_method(70), "debit");
    assert_eq!(restaurant_payment_method(89), "debit");
    // 10% split: rolls 90..=99.
    assert_eq!(restaurant_payment_method(90), "split");
    assert_eq!(restaurant_payment_method(99), "split");
}

#[test]
fn restaurant_payment_method_is_total_over_0_99() {
    let mut seen = std::collections::HashSet::new();
    for roll in 0..100 {
        seen.insert(restaurant_payment_method(roll));
    }
    assert_eq!(
        seen,
        ["cash", "qris", "debit", "split"].into_iter().collect(),
        "every bucket must be reachable in 0..100"
    );
}

#[test]
fn retail_and_restaurant_distributions_differ() {
    // The retail split bucket starts later (95 vs 90) — the two seeder
    // profiles must not have silently converged.
    assert_ne!(
        retail_payment_method(90),
        restaurant_payment_method(90),
        "retail roll 90 is still debit; restaurant roll 90 is split"
    );
    assert_eq!(retail_payment_method(94), "debit");
    assert_eq!(restaurant_payment_method(94), "split");
}

/* ── is_store_db_filename ────────────────────────────────────────── */

#[test]
fn store_db_filename_matcher() {
    assert!(is_store_db_filename("store-abc.sqlite"));
    assert!(is_store_db_filename("store-1.sqlite"));
    assert!(is_store_db_filename("store-branch-02.sqlite"));
}

#[test]
fn store_db_filename_rejects_non_matches() {
    assert!(
        !is_store_db_filename("kasir.db"),
        "main db is not a store db"
    );
    assert!(
        !is_store_db_filename("products.sqlite"),
        "missing store- prefix"
    );
    assert!(!is_store_db_filename("store-abc.db"), "wrong extension");
    assert!(!is_store_db_filename(""), "empty name");
}

#[test]
fn store_db_filename_excludes_wal_and_shm() {
    assert!(!is_store_db_filename("store-abc.sqlite-wal"));
    assert!(!is_store_db_filename("store-abc.sqlite-shm"));
    // The exact file (with .sqlite suffix) still matches — the WAL/SHM
    // siblings end with -wal/-shm AFTER the .sqlite extension.
    assert!(is_store_db_filename("store-abc.sqlite"));
}
