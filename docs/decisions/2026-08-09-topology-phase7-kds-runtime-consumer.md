<!-- Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. Clean pass. The record's central mechanism — the KDS consumer reading `target_instance_id` off a runtime-plan route and persisting it — is present at the source: `crates/kasirmu-bridge/src/kds.rs:45` pulls `route.get("target_instance_id")` off the matched route, `:117` does the same for the hardware leg, and the order writer takes `target_instance_id: Option<&str>` at `:160` and binds it at `:177`, emitting it as `targetInstanceId` in the audit JSON at `:186`. The `target_instance_id` column it depends on is a real nullable column on the KDS order table (`crates/kasirmu-core/migrations/20260813_init.sql:291`, `store_id TEXT, kitchen_zone TEXT, table_number TEXT, priority INTEGER NOT NULL DEFAULT 0, target_instance_id TEXT`), so the "Red test reproduced the missing column before the migration" story has a schema that matches its outcome. The Deliberate limitation section is the kind of honesty that usually rots, so it was checked too: the claim that `kds_orders.sale_id` is uniquely constrained and therefore permits one routed target per sale is exactly the constraint Phase 8 then had to work around, and `crates/kasirmu-bridge/src/pos.rs` plus the Phase 8 record agree. · No repairs needed. · No stamp or footer existed on this file before this pass. -->

# ADR: Topology Phase 7 — KDS Runtime Consumer

**Date:** 2026-08-09
**Status:** Implemented

## Problem

Phase 4 compiled Restaurant POS → KDS operation wires into a branch-scoped runtime plan, but the KDS creation path ignored that artifact. A ticket could therefore be created without recording which KDS workspace instance the topology selected, and every scoped KDS board could see it.

## Decision

The scoped KDS sale command consumes the runtime plan for the active branch and POS workspace instance. When it finds a validated `operation-out → operation-in` route, it persists the route's target workspace instance on the KDS order as `target_instance_id`.

Scoped KDS list and queue reads retain legacy tickets with a null target, while targeted tickets are visible only to the matching KDS session instance. This preserves existing deployments during migration without allowing a newly routed ticket to leak to another KDS instance.

The target is stored in the store database, while the runtime plan remains in the global settings database. The branch key is the session's resolved `store_id`, matching the topology branch identity established in Phase 1.

## Deliberate limitation

The current `kds_orders.sale_id` uniqueness constraint supports one routed KDS target per sale. The consumer deterministically selects the first matching operation route; topology fan-out needs a separate schema and delivery design before it is enabled.

## Verification

- Red test reproduced the missing `target_instance_id` column before the migration.
- Core routed-sale test confirms target persistence.
- Desktop runtime-plan selector test confirms source/port/relationship matching.
- UI typecheck and IPC contract tests pass.
- Rust formatting and diff checks pass.

> last audited 29-09-26 by docs-auditor
