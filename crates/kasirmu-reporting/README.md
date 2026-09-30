<!-- Audit stamp: 2026-08-29 · docs-auditor · status: ACCURATE (stale description repaired) · F1: "Scaffold only" -> IMPLEMENTED: src/ contains daily_summary.rs, menu_engineering.rs, metrics.rs, margin.rs (real report engines) plus error.rs/lib.rs; ReportingError still present · verified: error.rs + ReportingError exist, lib.rs declares pub mod daily_summary/margin/menu_engineering/metrics/error -->
<!-- NOTE 2026-09-30 (Budak-Korporat): the module list inside the stamp above is HISTORICAL. `daily_summary.rs` and `metrics.rs` were retired on 2026-09-30 under checklist C29 — `metrics` was gated on a feature no dependent enabled (so it compiled in no production build), and `daily_summary` had zero external callers while duplicating the live `kasirmu_core::db::reports`. The Status list below is current. -->

# kasirmu-reporting

Analytics and CSV export engine for kasir.mu.

## Status

Implemented — two report engines live in `src/`:

- `menu_engineering.rs` — menu engineering analysis
- `margin.rs` — margin computation

`ReportingError` is defined in `error.rs`.

**Retired 2026-09-30 (checklist C29):** `daily_summary.rs` (zero external Rust callers; it duplicated
`kasirmu_core::db::reports`, which is the live aggregate surface) and `metrics.rs` (gated on a `metrics`
feature that no dependent enabled, so it compiled in no production build — `platform/startup` retired an
identical feature-gated module on 2026-09-12 for the same reason, and that is the precedent followed here).

> last audited 29-08-26 by docs-auditor
