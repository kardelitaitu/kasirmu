<!-- Audit stamp: 2026-08-29 · docs-auditor · status: ACCURATE (stale description repaired) · F1: "Scaffold only" -> IMPLEMENTED: src/ contains daily_summary.rs, menu_engineering.rs, metrics.rs, margin.rs (real report engines) plus error.rs/lib.rs; ReportingError still present · verified: error.rs + ReportingError exist, lib.rs declares pub mod daily_summary/margin/menu_engineering/metrics/error -->

# oz-reporting

Analytics and CSV export engine for OZ-POS.

## Status

Implemented — report engines live in `src/`:

- `daily_summary.rs` — daily sales summary engine
- `menu_engineering.rs` — menu engineering analysis
- `metrics.rs` — Prometheus counters/gauges/histograms (behind `metrics` feature)
- `margin.rs` — margin computation

`ReportingError` defined in `error.rs`.

> last audited 29-08-26 by docs-auditor
