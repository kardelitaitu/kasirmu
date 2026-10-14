<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · Re-audit; the 2026-08-29 body and the 2026-09-30 NOTE below it are merged as original evidence. RE-DERIVED at HEAD: src/ holds exactly `error.rs`, `lib.rs`, `margin.rs`, `menu_engineering.rs` (plus their `*_tests.rs` siblings), so the two surviving engines the Status section names are the two that exist; `daily_summary.rs` and `metrics.rs` are CONFIRMED GONE in both directions — the files are absent from the tree and no `pub mod` line declares them — so the 2026-09-30 retirement record is accurate rather than aspirational; the crate declares three `pub mod`s (error, margin, menu_engineering, lib.rs:46-48) and `ReportingError` is still defined in error.rs. NOT re-measured: the output of either engine against real data, and whether any consumer reads the margin report today. · Superseded bodies follow as plain quoted text:

Audit stamp: 2026-08-29 · docs-auditor · status: ACCURATE (stale description repaired) · F1: "Scaffold only" -> IMPLEMENTED: src/ contains daily_summary.rs, menu_engineering.rs, metrics.rs, margin.rs (real report engines) plus error.rs/lib.rs; ReportingError still present · verified: error.rs + ReportingError exist, lib.rs declares pub mod daily_summary/margin/menu_engineering/metrics/error -->
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

> last audited 11-10-26 by docs-auditor
