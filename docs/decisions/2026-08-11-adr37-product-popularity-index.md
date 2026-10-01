<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · Clean pass on substance — this is the most completely implemented ADR audited so far, and every anchor in it still resolves after the workspace restructure. Verified symbol by symbol rather than from the Status line: the formula and store layers exist where D3 says they should (`crates/kasirmu-core/src/popularity.rs` and `crates/kasirmu-core/src/db/popularity.rs` — the ADR itself records the deliberate move out of `oz-reporting`, and that move is still in force), the sales-side source `crates/kasirmu-reporting/src/daily_summary.rs` is present, the `product_activity` ledger is `crates/kasirmu-core/migrations/20260813_init.sql:380`, and the `popularity_score REAL NOT NULL DEFAULT 0` column is on `products` at `:457`. Every command the ADR names exists: `record_product_search_scoped` in `apps/desktop-tauri/src/commands/products.rs`, `get_category_popularity_scoped`, `get_category_popularity_trend_scoped` and `get_category_forecast_scoped` in `apps/desktop-tauri/src/commands/reports.rs`, and `recompute_all_popularity` in `crates/kasirmu-core/src/db/popularity.rs`. The D6 section's habit of marking each deferred item as implemented with its own date is what makes this ADR auditable at all — every one of those claims (breadth weighting, per-category standings, per-period trend, demand forecast, analytics export) is checkable, and the ones checked here hold. · REPAIRED: crate and app paths. The body cited `crates/oz-core/…`, `crates/oz-reporting/…` and the numbered migration `133_product_activity.sql`; those are pre-restructure names and the sequential migration series has been replaced by date-stamped files. Repaired in place, because a live ADR is a document engineers read while working — its paths are instructions, not evidence. · NOT re-measured: the D1 formula constants (0.6/0.3/0.1, λ=0.93, m=5, 90-day window) and the commit hashes, which are design intent and a historical record respectively. -->
<!-- NOTE 2026-09-30 (Budak-Korporat): the stamp above asserts that the sales-side source `crates/kasirmu-reporting/src/daily_summary.rs` is present. It was present when the stamp was written on 2026-09-29; it was retired on 2026-09-30 under checklist C29 (zero external Rust callers, and it duplicated the live `kasirmu_core::db::reports`), so that one anchor is corrected here rather than edited in place — the stamp is the auditor's dated claim, and the correction belongs beside it. Every other anchor in the stamp was re-verified against the tree on 2026-09-30 and still resolves. -->

---
num: 37
area: products
title: ADR #37: Product Popularity Index — Weighted Activity Score for Retail Sorting
status: Implemented (2026-08-12)
---
# ADR #37: Product Popularity Index — Weighted Activity Score for Retail Sorting

Date: 2026-08-11

Status: Implemented (2026-08-12)

## Context

The retail POS product grid (ADR #36) needs a **popularity sort**: order
products by how popular they are, so the items customers actually want surface
first. The product owner requested a score driven by three signals: **sold**,
**searched**, and **edited**. The agreed scope is the full V2 design — all
three signals blended — not a sales-only v1.

Current state of each signal:

1. **Sold** — durable history already exists. `sale_lines` (sku, qty) joined to
   `sales` (`status = 'completed'`, created_at) is the authoritative record,
   and `Store::top_products` in `db/reports.rs` already aggregates it. No
   new write path needed for the dominant signal — including historical
   backfill.
   *(2026-09-30: this paragraph also named `query_top_products` in
   `crates/kasirmu-reporting/src/daily_summary.rs`. That module was retired the
   same day under checklist C29 — it had zero external callers and duplicated
   `db/reports.rs` — so the live source is the one named above.)*
2. **Searched** — nothing exists. Retail search is client-side filtering
   (`RetailPosScreen.tsx` searchQuery, `ProductLookupScreen.tsx`), so a search
   that results in a sale currently leaves no trace. Tracking requires a new
   event ledger and a light IPC write.
3. **Edited** — nothing per-product. The audit log (`010_audit_log.sql`) is a
   generic trail, not a counter. ADR #36 D5 wires the retail edit modal to
   `update_product_scoped`, which gives a natural hook for an edit event.

Two design hazards drive the formula:

- **Recency.** "Popularity" must mean *recent* popularity. A product that sold
  1,000 units six months ago and nothing since should not rule the sort.
- **Small catalogs.** A product with two sales must not outrank a steady
  1,000-sale seller. Any raw counter is full of flukes at retail catalog
  scale; the score needs Bayesian-style smoothing toward the catalog mean.

## Decision

### D1 — Score formula: decayed, smoothed, weighted

```
score = 0.6·Sales′ + 0.3·Search′ + 0.1·Edits′
```

Each raw component is a **recency-decayed event count** over a 90-day window:

```
raw_c = Σ_t events(t) × λ^t        t = days ago, λ = 0.93, window = 90 days
```

- **Sales raw** = units sold per day (`sale_lines.qty`, completed sales only).
- **Search raw** = acted-upon searches per day (search → product added to cart).
- **Edits raw** = product edit events per day.

Each component is then **Bayesian-smoothed** toward the catalog mean (the
IMDb weighted-rating approach):

```
c′ = (mean_c × m + raw_c × v) / (m + v)     v = contributing event count, m = 5
```

- **Decay (λ = 0.93/day)** gives ≈ 2 weeks of effective memory
  (1/(1−λ) ≈ 14 days) inside a 90-day hard window, with no window cliff — a
  product fades out smoothly instead of vanishing when it exits a flat
  window. At the window edge λ^90 ≈ 0.0015, so truncation loses nothing.
- **Smoothing (m = 5)** shrinks low-evidence scores toward the catalog mean, so
  a 2-sale fluke ranks mid-catalog, not #1, until it earns its place. This is
  the single most important property for a small catalog.
- **Weights 60/30/10** reflect signal confidence. Sales is the correct dominant
  signal; search is strong but noisier (raw search counts are polluted by typos
  and "we don't carry it" lookups, which is why only acted-upon searches count);
  edits are *operational attention*, not customer popularity, and are
  deliberately capped at 10% so data cleanup cannot distort the sort.

### D2 — Signal sources

- **Sales**: read from `sale_lines` — it is already the durable, synced ledger.
  No new sale-event rows; a single-SKU recompute re-aggregates the product's
  `sale_lines` directly. Backfill is free from existing history.
- **Search**: new `product_activity` rows with `event_type = 'search'`,
  emitted only when a product is added to the cart from a **non-empty search**
  (the `RetailPosScreen` search flow and the `ProductLookupScreen` Stock
  Inquiry sub-view). Search events fire through a new fire-and-forget command
  (D3).
- **Edits**: `product_activity` rows with `event_type = 'edit'`, emitted by the
  retail product-update path (ADR #36 D5 `update_product_scoped`) in the same
  transaction.

### D3 — Storage, computation, and IPC

One migration, `product_activity` (dated-migration series; the table is now in `crates/kasirmu-core/migrations/20260813_init.sql:380`) (registered in the `ALL` array,
unique prefix after 132):

```sql
CREATE TABLE IF NOT EXISTS product_activity (
    id         TEXT PRIMARY KEY,
    sku        TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('search', 'edit')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_product_activity_sku ON product_activity(sku);

ALTER TABLE products ADD COLUMN popularity_score REAL NOT NULL DEFAULT 0;
```

- The ledger keeps **history**, the column keeps the **materialized score**:
  history lets the formula be retuned later without a migration; the column
  makes sorting O(1) and rides through the existing PERF-08 catalog cache in
  `ProductDto`.
- **`popularity.rs`** in `crates/kasirmu-core` (not `crates/kasirmu-reporting` as
  originally scoped): `src/popularity.rs` holds the pure, unit-tested function
  `compute_score(units_by_day, searches_by_day, edits_by_day, catalog_mean)
  -> f64` implementing D1, and `db/popularity.rs` holds the store-layer
  recompute/ledger access. The formula sits beside the code that writes scores
  (sale completion, search/edit recording, full-catalog backfill pass) rather
  than beside the reporting queries.
- **Recompute strategy:** single-SKU recompute after each contributing event —
  sale completion (for the sold SKUs), search record, edit record — plus a
  full-catalog backfill pass on first run and a repair command. Reads are
  always O(1) per product; writes are a ledger row plus a single-row UPDATE.
- **New IPC:** `record_product_search_scoped(sessionToken, sku)` in both
  clients (registered in `lib.rs`) — fire-and-forget, no return payload, must
  never block or fail the add-to-cart it accompanies. Edit events ride
  `update_product_scoped` (no new command).

### D4 — Local-only (never synced)

`popularity_score` and `product_activity` are **excluded from cloud sync**.
Popularity is a per-store sort aid: each store recomputes its sales component
from its own local `sale_lines`, and search/edit events are local actions. The
sync surface (ADR #36 D2 touched `SnapshotProduct`) is untouched by this ADR,
consistent with the cost-residency philosophy — popularity is derived, local,
and cheap to recompute, so it has no business on the wire. The sync product
upsert imports only its snapshot columns, so `popularity_score` and
`product_activity` rows are never transferred or overwritten by a pull.

### D5 — Sort integration

- The retail grid `SortField` union gains **`'popularity'`**.
  **The default sort on load is popularity descending** (most popular first),
  with SKU as the tiebreak (deterministic order for equal scores).
- The existing click-to-sort header behavior is unchanged: clicking any
  sortable column header (SKU, Stock, Name, Price) switches the sort to that
  column and toggles its direction on repeat clicks. **Popularity is itself a
  sortable option in the same control** — first click sorts descending (most
  popular first, the natural direction), repeat click flips to ascending — so
  the operator can leave and return to popularity at any time.
- `ProductDto` carries `popularity_score`; the sort is applied client-side on
  the cached catalog (PERF-08), matching how the existing sort fields work.
- A cosmetic 🔥 badge for the top-N popular products is optional and deferred
  (D6).

### D6 — Explicitly deferred

- Breadth weighting (`× ln(1 + distinct transactions)`) — ✅ implemented
  (2026-08-12): the decayed unit volume is multiplied by `ln(1 + distinct
  transactions inside the window)` inside `score_from_raw` — the single place
  the sales raw is scaled — so the full pass, the per-event recompute, and
  the trend series can never drift apart. The catalog/category smoothing
  means are computed over the breadth-scaled raws to keep the scale
  consistent. Rewards reach over one-customer bulk: same volume across more
  customers ranks higher.
- Per-category popularity — ✅ implemented (2026-08-12): the full pass now
  caches per-category smoothing means (`popularity.category_means`) and
  scores each product against its own category, so the grid's popularity sort
  is fair within a selected category; uncategorized products fall back to the
  global mean. The per-category evolution (2026-08-12) then surfaced those
  standings as a first-class report: `Store::category_popularity` in
  `crates/kasirmu-core/src/db/popularity.rs` returns every category's product
  count, mean score, ratio to the catalog average, and top-N products ranked
  by score with category-relative rank + percentile, exposed as
  `get_category_popularity_scoped` in both clients and rendered as the
  Category Popularity card on the sales report. Per-period popularity is now
  implemented too (2026-08-12): `Store::category_popularity_trend` buckets
  the sale/search/edit ledgers by `daily` | `weekly` | `monthly` (weekly
  mirrors `weekly_revenue`'s `DATE(created_at, 'weekday 0', '-7 days')`)
  and evaluates the same blend per (period, category) smoothed toward the
  cached category means — same scale as the materialized scores — exposed as
  `get_category_popularity_trend_scoped` in both clients and rendered as the
  Popularity Trend line chart on the sales report. A prototype-level demand
  forecast ships too (2026-08-12): `Store::category_forecast` fits a linear
  least-squares model over each category's recent trend units (last ≤6
  points) and projects the next period, exposed as
  `get_category_forecast_scoped` and rendered as the Demand Forecast table
  on the sales report; daily series of a full week or more are first
  de-seasonalized by day-of-week (weak Mondays, strong weekends) before the
  fit (`seasonal_daily_forecast`), so the next-day projection respects the
  weekday pattern; the learned on-device model from the 2026-07-20 research
  remains out of scope.
- Surfacing the score in analytics exports — ✅ implemented (2026-08-12):
  `AnalyticsBundle` (the JSON/CSV/cloud-NDJSON export schema) now carries
  `category_popularity` (standings with top-3 products, rank, percentile) and
  `category_forecast` (next-period demand), written to
  `category_popularity.csv` / `category_forecast.csv` and stamped into the
  cloud destination rows — the external analytics tool can consume the
  scores through the same bundle path as everything else.

## Consequences

- The retail grid sorts by meaningful recent popularity from day one: the
  sales component is backfilled from existing `sale_lines`, while search/edit
  accumulate from zero.
- New products get a fair cold start — Bayesian smoothing places them mid-
  catalog rather than bottom (or a fluky top).
- Small footprint: one ledger row per search/edit, one single-row score
  recompute per event, O(1) sort reads. No sync surface change.
- Edits cannot distort the ranking (10% weight, smoothed).

## Tradeoffs / risks

- **Search IPC is a per-add round trip.** Mitigation: fire-and-forget with
  errors logged, never surfaced, and never awaited before the cart update; the
  offline queue is not involved (a dropped event costs one popularity tick).
- **Decay, window, and weights are opinions.** Mitigation: the ledgers preserve
  history, so retuning is a formula change in `popularity.rs`, not a migration.
- **Materialized score can go stale** if a recompute path is missed. Mitigation:
  exhaustive recompute hooks (sale completion, search, edit, backfill) plus a
  staleness test that exercises each hook.
- **Deleted products lose popularity history** (the same caveat already
  documented for `top_products` in audit/03 REP-05 — deleting a product
  erases its historical sales from product-level aggregates). Accepted —
  popularity is a live-sort aid, not an archival report.

## Verification

- `popularity.rs`: unit tests for decay math (λ, window edge), Bayesian
  smoothing (low-evidence shrink toward mean, m boundary), weight blend, empty
  catalog, single-event catalog.
- Migration: `product_activity` table + `popularity_score` column exist;
  registry/filesystem parity and monotonic-prefix tests stay green.
- Commands: `record_product_search_scoped` writes a ledger row (scoped auth);
  `update_product_scoped` writes an edit row in the same transaction;
  `complete_sale` recomputes the sold SKUs' scores; backfill command produces
  expected scores from seeded `sale_lines`.
- UI: grid defaults to popularity sort, tiebreaks on SKU, `ProductDto`
  carries `popularity_score`; add-from-search fires the event (mocked IPC,
  non-blocking); i18n key for the sort option in both bundles.
- The single verification pass from ADR #36 covers the combined change.

---

## Implementation Status

**Implemented (2026-08-12).** D1–D5 shipped, including the day-one backfill:
the full-catalog recompute pass is wired at store open
(`recompute_all_popularity` in both client apps) and migration 134 seeds edit
history from product timestamps, so the default popularity sort is meaningful
on first launch. Key commits: `e5cab0a9`, `2913d49c`, `be37eac1`
(implementation), `33b44571` (backfill), `9c8bc6cd` (ADR location
correction), `43bc280f` (per-category standings surface). Note the formula
landed in `crates/kasirmu-core/src/popularity.rs` with the recompute/ledger access
in `crates/kasirmu-core/src/db/popularity.rs`, not `crates/kasirmu-reporting` as
originally scoped — the score is written by the store layer, so the formula
sits beside that code. The D6 breadth weighting and per-category/per-period
popularity items are all now implemented (see D6); the only remaining
out-of-scope item is the demand-forecasting integration, and the analytics
export path remains the external analytics tool's consumer of the local
store DB.

> last audited 29-09-26 by docs-auditor
