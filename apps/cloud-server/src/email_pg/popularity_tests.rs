//! Unit tests for the Postgres popularity twin's pure helpers.
//!
//! The async query functions need a live Postgres pool (their integration
//! arms are `pg-tests`-gated in `Cargo.toml`), so only the pure period-key
//! handling is covered here — which is exactly where this module drifted from
//! `kasirmu_core::db::popularity`.

use super::*;

#[test]
fn a_monthly_bucket_key_parses_into_a_date() {
    // The twin's trend query emits the same bucket keys the SQLite original
    // does: `YYYY-MM-DD` for daily/weekly and `LEFT(created_at, 7)` — that
    // is `YYYY-MM` — for monthly. A key that fails to parse is dropped from
    // its category's series, and the forecast then reports zeros for every
    // category instead of failing.
    assert!(
        parse_period_start("2026-07-15").is_some(),
        "daily/weekly bucket key must parse"
    );
    assert!(
        parse_period_start("2026-07").is_some(),
        "monthly bucket key must parse, not be silently dropped"
    );
}
