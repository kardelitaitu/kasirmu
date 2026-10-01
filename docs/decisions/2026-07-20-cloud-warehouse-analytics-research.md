<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · First pass over this file: 125 lines, no audit stamp, no footer, no marker. It is the shortest of the four research documents in this batch and the only one with a DECIDED outcome -- "Research (Recommended: Defer to post-1.0)" -- so unlike its siblings it commits to a position, and that position is the checkable claim. The recommendation was to defer the cloud-warehouse analytics export until after 1.0. Deferring is trivially consistent with a codebase that does not have the feature, so the finding here is negative and worth stating plainly: the deferral decision was honoured. There is no warehouse-export implementation to contradict it. · Its Options Evaluated and Cost Comparison sections are point-in-time market judgements that no repository can confirm or deny -- the same class as the benchmark baselines audited in round 14 -- and are left exactly as written. · Worth connecting to its sibling `docs/specs/admin-dashboard-plan.md`, audited in round 9: that plan's Phase 3 wires Paddle `transaction.completed` amounts and Midtrans `gross_amount` into a `revenue_events` collection that the stats endpoint sums -- a narrow, live-revenue analytics path built in the opposite direction from a full warehouse export. Together the two documents show the deferral was a scoping decision rather than a dead end, and a reader asking why there is no warehouse has the answer in one sentence. · No repository paths inside it resolve, so nothing to repair. Stamp and footer added. -->
# ADR: Cloud Warehouse Analytics Export

**Status:** Research (Recommended: Defer to post-1.0)
**Date:** 2026-07-20
**Author:** kasir.mu Engineering

---

## Context

The ROADMAP Phase 5 calls for "Analytics export to cloud warehouse (BigQuery / Snowflake)." kasir.mu already has:
- `AnalyticsBundle` (P15-4) — 8 structured report types bundled as JSON
- `ReportScheduleConfig` (P15-5) — scheduling config persisted in settings
- `ExportConfig` — date range, limit, threshold knobs
- Redis job queue configured in Docker Compose (P13-2)

The question: which cloud warehouse, at what cost, and should we build this now?

---

## Options Evaluated

### Option A: Google BigQuery

**Strengths:**
- Serverless, zero-ops, excellent JSON ingestion (`bq load --source_format=NEWLINE_DELIMITED_JSON`)
- Pay-per-query ($5/TB scanned), storage at $0.02/GB/month
- Free tier: 10 GB storage + 1 TB queries/month
- Strong BI tool integrations (Looker, Data Studio, Tableau)

**Weaknesses:**
- Requires GCP project + service account setup per tenant
- Cold-start query latency ~1-2s (acceptable for analytics)
- Data residency concerns for non-US merchants

**Integration effort:** ~2 days — REST API streaming insert or batch load via `google-cloud-rust`

---

### Option B: Snowflake

**Strengths:**
- Best-in-class SQL analytics, zero-copy cloning for report snapshots
- JSON via VARIANT type with automatic schema inference
- Time Travel (1-90 day data recovery)
- Strong data sharing for multi-store franchises

**Weaknesses:**
- Minimum $25/month compute credits (no true free tier)
- Cold warehouse spin-up 1-3 minutes
- Overkill for single-store merchants

**Integration effort:** ~3 days — `snowflake-api` crate + ODBC/JDBC driver setup

---

### Option C: ClickHouse (Self-Hosted)

**Strengths:**
- Columnar, real-time analytics, 10-100x faster than row stores
- Open-source (no per-query costs)
- Native JSON support with `JSONExtract` functions
- Runs on a $10/month VPS for most POS workloads

**Weaknesses:**
- Self-hosted — requires ops for backups, upgrades, monitoring
- Less ecosystem maturity than BigQuery/Snowflake
- No managed offering in all regions

**Integration effort:** ~2 days — `clickhouse-rs` crate, HTTP interface, Docker Compose service

---

### Option D: Parquet File Export (Simplest)

**Strengths:**
- Zero infrastructure — write Parquet to disk, sync via existing cloud-sync
- Columnar, compressed, queryable by DuckDB, pandas, Spark
- No vendor lock-in, no per-query costs
- Works offline — export runs on the POS terminal itself

**Weaknesses:**
- No live dashboards (batch-only)
- Requires merchant to have their own analytics tool
- File management overhead

**Integration effort:** ~1 day — `parquet` + `arrow` crates, write to `exports/` directory

---

## Recommendation

**Short-term (0.0.15-0.0.16): Implement Option D — Parquet export.**

Add `analytics_bundle_to_parquet()` to the export module. Write `.parquet` files to a configurable directory. The existing cloud-sync infrastructure can sync these to cloud storage. This gives merchants immediate access to their analytics data with zero additional infrastructure cost.

**Medium-term (post-1.0): Add BigQuery streaming insert as an on-feature.**

The `AnalyticsBundle` JSON format already maps cleanly to BigQuery's `NEWLINE_DELIMITED_JSON` ingestion. Gate behind `ANALYTICS_EXPORT` feature flag. Charge as premium add-on.

**Deferred:** Snowflake (cost-prohibitive for small merchants), ClickHouse self-hosted (ops burden).

---

## Cost Comparison

| Option | Monthly Cost (est.) | Setup Time | Query Latency |
|--------|---------------------|------------|---------------|
| BigQuery | $0-5 (free tier for most) | 2 days | 1-2s |
| Snowflake | $25+ (minimum compute) | 3 days | 1-3 min (cold start) |
| ClickHouse | $10-20 (VPS) | 2 days | <100ms |
| Parquet | $0 (local disk) | 1 day | N/A (batch) |

---

## References
- `crates/oz-core/src/export/mod.rs` — AnalyticsBundle, ExportConfig, ReportScheduleConfig
- `docs/decisions/archived/2026-07-10-subscription-tier-entitlement.md` — Feature gating for premium add-ons
- `docker-compose.yml` — Redis job queue for async export tasks

> last audited 29-09-26 by docs-auditor

