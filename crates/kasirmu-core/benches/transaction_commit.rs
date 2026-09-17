//! Criterion benchmarks for sale-commit transaction throughput.

// `criterion_group!` expands to a public function it does not document, so
// the workspace-wide `missing_docs` warning cannot be satisfied here.
#![allow(missing_docs)]

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use kasirmu_core::db::Store;
use kasirmu_core::{Cart, CartLine, Money, Sale, Sku};

fn currency_usd() -> kasirmu_core::Currency {
    "USD".parse().unwrap()
}

fn price(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: currency_usd(),
    }
}

fn setup_store() -> Store<'static> {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    kasirmu_core::migrations::run(&mut conn).unwrap();
    let conn: &'static rusqlite::Connection = Box::leak(Box::new(conn));
    let store = Store::new(conn);

    store
        .create_product(
            "SKU-BENCH",
            "Bench Product",
            price(1500),
            None,
            None,
            100,
            None,
        )
        .unwrap();

    store
}

fn bench_create_sale_minimal(c: &mut Criterion) {
    let store = setup_store();

    c.bench_function("create_sale_minimal", |b| {
        b.iter(|| {
            let mut cart = Cart::new(currency_usd());
            cart.add_line(CartLine::new(Sku::new("SKU-BENCH"), 1, price(1500)))
                .unwrap();
            let sale = Sale::from_cart(&cart).unwrap();
            store.create_sale(black_box(&sale)).unwrap();
        });
    });
}

fn bench_create_sale_with_lines(c: &mut Criterion) {
    let store = setup_store();

    c.bench_function("create_sale_with_5_lines", |b| {
        b.iter(|| {
            let mut cart = Cart::new(currency_usd());
            for i in 0..5 {
                cart.add_line(CartLine::new(Sku::new("SKU-BENCH"), 1 + i, price(1500)))
                    .unwrap();
            }
            let sale = Sale::from_cart(&cart).unwrap();
            store.create_sale(black_box(&sale)).unwrap();
        });
    });
}

fn bench_complete_checkout(c: &mut Criterion) {
    let store = setup_store();

    c.bench_function("complete_checkout_5_items", |b| {
        b.iter(|| {
            let mut cart = Cart::new(currency_usd());
            for _ in 0..5 {
                cart.add_line(CartLine::new(Sku::new("SKU-BENCH"), 1, price(1500)))
                    .unwrap();
            }
            let sale = Sale::from_cart(&cart).unwrap();
            store.create_sale(&sale).unwrap();
        });
    });
}

criterion_group!(
    benches,
    bench_create_sale_minimal,
    bench_create_sale_with_lines,
    bench_complete_checkout
);
criterion_main!(benches);
