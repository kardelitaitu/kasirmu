//! Criterion benchmarks for `Money` arithmetic and formatting.
//!
//! Measures add, subtract, compare, and formatting performance to
//! catch regressions in the hot-path monetary calculations.

// `criterion_group!` expands to a public function it does not document,
// so the workspace-wide `missing_docs` lint cannot be satisfied here.
#![allow(missing_docs)]

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use foundation::money::{Currency, Money};

fn usd() -> Currency {
    "USD".parse().unwrap()
}

fn m(minor: i64) -> Money {
    Money {
        minor_units: minor,
        currency: usd(),
    }
}

fn bench_money_add(c: &mut Criterion) {
    let a = m(1500);
    let b = m(2500);

    c.bench_function("money_checked_add", |bencher| {
        bencher.iter(|| {
            let result = black_box(a).checked_add(black_box(b));
            black_box(result)
        });
    });
}

fn bench_money_subtract(c: &mut Criterion) {
    let a = m(5000);
    let b = m(1500);

    c.bench_function("money_checked_sub", |bencher| {
        bencher.iter(|| {
            let result = black_box(a).checked_sub(black_box(b));
            black_box(result)
        });
    });
}

fn bench_money_multiply(c: &mut Criterion) {
    let a = m(1999);

    c.bench_function("money_checked_mul", |bencher| {
        bencher.iter(|| {
            let result = black_box(a).checked_mul(black_box(3));
            black_box(result)
        });
    });
}

fn bench_money_divide(c: &mut Criterion) {
    let a = m(10000);

    c.bench_function("money_checked_div", |bencher| {
        bencher.iter(|| {
            let result = black_box(a).checked_div(black_box(4));
            black_box(result)
        });
    });
}

fn bench_money_serde_roundtrip(c: &mut Criterion) {
    let a = m(9999);
    let json = serde_json::to_string(&a).unwrap();

    c.bench_function("money_serde_roundtrip", |bencher| {
        bencher.iter(|| {
            let parsed: Money = serde_json::from_str(black_box(&json)).unwrap();
            black_box(parsed)
        });
    });
}

criterion_group!(
    money_benches,
    bench_money_add,
    bench_money_subtract,
    bench_money_multiply,
    bench_money_divide,
    bench_money_serde_roundtrip,
);
criterion_main!(money_benches);
