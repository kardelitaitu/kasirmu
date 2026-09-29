<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE and IMPLEMENTED — 0 findings, no repairs needed · Audited on branch 0.0.40. This plan's header still says "Status: Draft — mock data phase", and that is the one line in it that is out of date: the mock phase it describes is behind the tree, not ahead of it. The `GET /api/v1/admin/stats` endpoint this plan specifies as Phase 2 is real and routed — it is `apps/license-server/admin_stats.go`, with the path pinned in tests at `apps/license-server/admin_auth_session_test.go:64`, and Phase 3/4 (real aggregates and server-side FX) are covered by the same file plus `admin_stats_test.go`. The companion plan for the revenue source, `docs/specs/revenue-data-pipeline-plan.md`, is implemented too. I have deliberately NOT edited the Status line: this is a dated plan document whose phases describe a build order, and the "Draft — mock data phase" line is its own scope statement from the day it was written. Flipping it would be the plan commenting on itself. Recording the current state here is more useful than silently rewriting the plan. · The ADR this plan implements is real: `docs/decisions/2026-08-28-adr42-website-admin-and-user-dashboard.md` exists, matching the "ADR #42" in the title. · The PocketBase collections the KPI table reads from (`tenants`, `subscriptions`, `tenant_machines`, `trial_claims`) and the `revenue_events` collection the Phase 3 plan adds are all real in the license-server schema, `apps/license-server/pb_schema.json`. · ⚠️ SECOND AGENTS.md ENV-VAR DRIFT, found while verifying this file and reported NOT patched: this plan says the endpoint is gated by `OZ_ADMIN_KEY`, and the CODE agrees — `OZ_ADMIN_KEY` is the name the license server documents and uses (`apps/license-server/DEPLOY.md:325`, `:519`, `:521`, `:531`). But `AGENTS.md:117` lists `$env:KASIRMU_ADMIN_KEY  # admin dashboard API key`. That is the same defect already recorded against `KASIRMU_ENFORCE_PLANS` vs the code's `OZ_ENFORCE_PLANS` (`apps/cloud-server/src/config.rs:208`). Two independent variables in the same AGENTS.md section now disagree with the code, which is enough to stop treating the first as a one-off typo: the `KASIRMU_*` list appears to have been normalised wholesale at some point without the server-side variables following. An operator setting the `KASIRMU_` names would set variables nothing reads, and in this case it is the admin API key — the same silent-open-failure mode the `OZ_ENFORCE_PLANS` finding carries. Both are left for the AGENTS.md owner because agent-configuration files are outside a `docs/` audit. · NOT re-measured: the mock KPI values (1,247 users, $4,280 MRR, 22.4% conversion) and the sample JSON, which are illustrative figures for a mock phase, not claims about production. · No stamp or footer existed on this file before this pass. -->

# Admin Dashboard — Feature Plan (ADR #42 Phase 3+)

**Status:** Draft — mock data phase  
**Data source:** Mock for now; real Paddle/Midtrans wiring later  
**Target:** `admin.ozpos.my.id` (existing auth-gated admin SPA)

---

## 1. KPIs (stat cards)

| KPI | Definition | Source (final) | Mock value |
|---|---|---|---|
| **Total Users** | Count of `tenants` records (all statuses) | `GET /api/v1/admin/stats` → `tenants` count | 1,247 |
| **Active Users** | `tenants.status == 'active'` | same | 1,084 |
| **Total Subscribers** | Tenants with a **non-free** subscription (plus/pro/premium/enterprise) | `subscriptions` where `tier_key != 'free'` + `status == 'active'` | 386 |
| **Monthly Gross (IDR)** | Sum of active subscriptions' monthly price → converted USD→IDR live | Paddle/Midtrans `amount` + live FX | Rp 68,4 jt (≈ $4,280 × 16,000) |
| **MRR (Monthly Recurring Revenue)** | Monthly-equivalent of active subscriptions | Paddle/Midtrans price map | $4,280 |
| **ARPU** | MRR ÷ active subscribers | computed | $11.09 |
| **Active Devices** | `tenant_machines` where `revoked_at` empty | same | 812 |
| **Trial → Paid conv.** | Trial tenants that became subscribers | `trial_claims` + `subscriptions` | 22.4% |

---

## 2. Advanced charts

| Chart | Type | X axis | Series | Data |
|---|---|---|---|---|
| **Revenue trend** | Line/area | Last 12 months | Monthly gross (USD + IDR) | Mock series, later Paddle `transaction.completed` |
| **Subscriber growth** | Area | Last 12 months | Cumulative subscribers | `subscriptions.starts_at` bucketed |
| **Tier distribution** | Donut | — | plus / pro / premium / enterprise | `subscriptions.tier_key` |
| **Signups per month** | Bar | Last 12 months | New tenants | `tenants.created` |
| **Churn / canceled** | Line | Last 12 months | Canceled per month | `subscriptions.status == 'expired'/'revoked'` |
| **Payment provider split** | Donut | — | Paddle / Midtrans | `subscriptions.payment_provider` |

---

## 3. Tables

- **Top subscribers** — tenant email, tier, MRR, next renewal, provider
- **Recent signups** — email, created, verified, current tier
- **Expiring soon** — subscriptions expiring within 30 days (renewal outreach)

---

## 4. USD → IDR live conversion

- **Live source:** `https://open.er-api.com/v6/latest/USD` (free, no key) — returns `rates.IDR`.
- **Fallback:** hardcoded last-known rate (e.g. 16,000) if the API is unreachable; the card shows `≈` and a "live rate" chip with the timestamp.
- **Cache:** 1-hour in the SPA so it doesn't hammer the FX API on every tab switch.
- **Final (Phase 3 real):** Midtrans charges fixed IDR directly (no conversion needed); Paddle charges USD — convert only Paddle revenue.

---

## 5. API contract (final shape — mock returns the same JSON)

```jsonc
// GET /api/v1/admin/stats  (OZ_ADMIN_KEY / admin tenant session)
{
  "kpis": {
    "totalUsers": 1247,
    "activeUsers": 1084,
    "totalSubscribers": 386,
    "mrrUsd": 4280,
    "mrrIdr": 68480000,
    "arpuUsd": 11.09,
    "activeDevices": 812,
    "trialToPaidRate": 22.4,
    "fxRate": 16000,
    "fxUpdatedAt": "2026-08-29T12:00:00Z"
  },
  "revenueTrend": [ { "month": "2026-09", "usd": 4120, "idr": 65920000 }, ... ],
  "subscriberGrowth": [ { "month": "2026-09", "count": 386 }, ... ],
  "signupsPerMonth": [ { "month": "2026-09", "count": 87 }, ... ],
  "churnPerMonth": [ { "month": "2026-09", "count": 12 }, ... ],
  "tierDistribution": [ { "tier": "plus", "count": 210 }, ... ],
  "providerSplit": [ { "provider": "paddle", "count": 264 }, { "provider": "midtrans", "count": 122 } ],
  "topSubscribers": [ { "email": "...", "tier": "pro", "mrrUsd": 9.99, "renewal": "...", "provider": "paddle" }, ... ],
  "recentSignups": [ { "email": "...", "created": "...", "verified": true, "tier": "free" }, ... ],
  "expiringSoon": [ { "email": "...", "tier": "plus", "expiresAt": "...", "daysLeft": 12 } ]
}
```

---

## 6. Implementation phases

1. **Mock (now):** admin SPA renders a full Dashboard tab from a `MOCK_STATS` object (this file). Live FX fetch + fallback. SVG charts (no external lib).
2. **API endpoint:** add `GET /api/v1/admin/stats` to the license server returning real aggregates from `tenants`/`subscriptions`/`tenant_machines` (counts + tier/provider splits).
3. **Revenue wiring:** persist Paddle `transaction.completed` amounts + Midtrans `gross_amount` into a `revenue_events` collection; the stats endpoint sums them.
4. **Live FX in backend:** the stats endpoint refreshes the USD→IDR rate server-side (cache 1h) so the dashboard is consistent.

---

## 7. Notes / decisions

- **Monthly gross = MRR** in this build (recurring, not one-time). One-time bundle purchases are separate if needed later.
- **IDR conversion:** only Paddle (USD) revenue converts; Midtrans is already IDR. When real data lands, sum each provider's native currency then convert.
- Mock figures are clearly labeled so operators don't mistake them for live data.

> last audited 29-09-26 by docs-auditor
