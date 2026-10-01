//! Criterion benchmarks for barcode-to-product lookup through `Store`.

// `criterion_group!` expands to a public function it does not document, so
// the workspace-wide `missing_docs` warning cannot be satisfied here.
#![allow(missing_docs)]

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use kasirmu_core::Money;
use kasirmu_core::db::Store;

fn currency_usd() -> kasirmu_core::Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: currency_usd(),
    }
}

// The caller owns the connection; no `Box::leak` to manufacture a
// `'static` for the `Store` (O-T03). `fresh_db()` also replaces the
// 68-migration replay with a ~3 ms snapshot clone.
fn setup_store_with_products(count: usize, db: &rusqlite::Connection) -> Store<'_> {
    let store = Store::new(db);

    for i in 0..count {
        let sku = format!("SKU-{i:05}");
        store
            .create_product(
                &sku,
                &format!("Product {i}"),
                price(1000),
                None,
                None,
                0,
                None,
            )
            .unwrap();
    }

    store
}

fn bench_barcode_lookup(c: &mut Criterion) {
    let store_db = kasirmu_core::migrations::fresh_db();
    let store = setup_store_with_products(1000, &store_db);
    let _ = store.get_product("SKU-00000");

    c.bench_function("barcode_lookup_1000_products", |b| {
        b.iter(|| {
            let result = store.get_product(black_box("SKU-00500"));
            black_box(result)
        });
    });
}

fn bench_barcode_lookup_cache_hit(c: &mut Criterion) {
    let store_db = kasirmu_core::migrations::fresh_db();
    let store = setup_store_with_products(1000, &store_db);
    let _ = store.get_product("SKU-00001");

    c.bench_function("barcode_lookup_cache_hit", |b| {
        b.iter(|| {
            let result = store.get_product(black_box("SKU-00001"));
            black_box(result)
        });
    });
}

fn bench_barcode_lookup_miss(c: &mut Criterion) {
    let store_db = kasirmu_core::migrations::fresh_db();
    let store = setup_store_with_products(100, &store_db);

    c.bench_function("barcode_lookup_miss", |b| {
        b.iter(|| {
            let result = store.get_product(black_box("NONEXISTENT"));
            black_box(result)
        });
    });
}

criterion_group!(
    benches,
    bench_barcode_lookup,
    bench_barcode_lookup_cache_hit,
    bench_barcode_lookup_miss
);
criterion_main!(benches);
