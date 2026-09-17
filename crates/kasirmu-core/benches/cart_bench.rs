//! Criterion benchmarks for cart line insertion and total calculation.

// `criterion_group!` expands to a public function it does not document, so
// the workspace-wide `missing_docs` warning cannot be satisfied here.
#![allow(missing_docs)]

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use foundation::cart::{Cart, CartLine};
use foundation::money::{Currency, Money};
use foundation::sku::Sku;

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn m(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

fn bench_cart_add_line(c: &mut Criterion) {
    let sku = Sku::new("SKU-025");

    c.bench_function("cart_add_line", |bencher| {
        bencher.iter(|| {
            let mut cart = Cart::new(usd());
            let line = CartLine::new(black_box(sku.clone()), 1, m(3000));
            let result = cart.add_line(line);
            black_box(result)
        });
    });
}

fn bench_cart_calculate_total(c: &mut Criterion) {
    let mut cart = Cart::new(usd());
    for i in 0..20 {
        cart.add_line(CartLine::new(
            Sku::new(format!("SKU-{:03}", i)),
            1,
            m(500 + i as i64 * 100),
        ))
        .unwrap();
    }

    c.bench_function("cart_total_20_items", |bencher| {
        bencher.iter(|| {
            let total = black_box(black_box(cart.clone()).total());
            black_box(total)
        });
    });
}

criterion_group!(
    cart_benches,
    bench_cart_add_line,
    bench_cart_calculate_total,
);
criterion_main!(cart_benches);
