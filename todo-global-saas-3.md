# Global SaaS POS — Phase 3: P2 Scale & Operations

Phase 3 of 3. Sibling phases:
[`todo-global-saas-1.md`](./todo-global-saas-1.md) (Phase 1 — P0 platform
foundations; carries the shared contract: baseline, access contract, canonical
hierarchy, adopted policy §A/B/E/F/G/H/I, and the decisions list) ·
[`todo-global-saas-2.md`](./todo-global-saas-2.md) (Phase 2 — P1 product
maturity).

This file holds the P2 work list and the regional/compliance policy (§K) it
implements. Phases 1 and 2 gate this work.

Supersedes the single-file `todo-global-saas.md` (split into phases
2026-09-05).

## Regional and compliance rollout (adopted §K)

Keep Brand and Region optional in the ownership model. Start with organization
region and legal-entity tax/fiscal settings, then add location overrides. Store
money as integer minor units with an explicit currency, timestamps in UTC, and
business dates in the location timezone. Select data residency at organization
creation; moving residency later should be an explicit support/migration
workflow, not a silent setting change.

## P2 — future capability and operational maturity

- [ ] **Implement custom roles safely.** Keep built-in roles as defaults, but
      make custom roles explicit permission sets with explicit scopes. Unknown
      roles default to deny; do not assign unknown names a numeric hierarchy
      level automatically.
- [ ] **Add regional billing and plan presentation.** Pricing, currencies, tax,
      payment providers, invoices, and plan availability may vary by market.
- [ ] **Define data residency and retention policy.** Document where tenant data,
      backups, audit events, telemetry, and license records are stored and how
      deletion/export requests are handled.
- [ ] **Add support/operator tooling.** Enterprise support may require scoped
      impersonation, diagnostics, tenant health, deployment version, sync health,
      and safe incident access without bypassing tenant isolation.
- [ ] **Define service health contracts.** Add user-visible status for license
      server, sync service, payment service, and device connectivity, with clear
      retry and degraded-mode behavior.
- [ ] **Make feature flags and entitlements observable.** Support diagnostics
      should show why a feature is unavailable: role, scope, tier, quota, expiry,
      or server policy.
- [ ] **Add multi-Organization user switching.** One human identity may hold
      memberships in several Organizations; switching between them is a later
      capability built on scoped assignments, not a second hierarchy layer.
- [ ] **Extend Location Memos to multiple selected locations.** The first
      version targets one location per Location Memo; a later capability lets
      one Memo target several locations at once.
      - **Cheaper than it reads (verified 2026-09-06 against the landed
        schema).** Publish fans out into `memo_recipients` rows and
        `list_active_for_terminal` reads from those rows — it never reads
        `memos.location_id`. So display, acknowledgement, expiry and the
        per-tenant filters are already Location-agnostic. This item is three
        changes, not a rewrite: the column (`memos.location_id` → a
        `memo_locations` join table), the one fan-out query
        (`WHERE bound_location_id = ?1` → `IN (...)`), and the authoring UI.
        See `todo-global-saas-2.md` §"`memos.location_id ON DELETE CASCADE`"
        before designing the join table — that FK needs reworking in the same
        migration, and a `memo_locations` table inherits the same question.
