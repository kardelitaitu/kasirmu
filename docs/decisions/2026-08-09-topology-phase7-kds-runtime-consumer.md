<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 1 minor) · Fresh pass over this phase record; the 2026-09-29 stamp body is merged at the bottom as original evidence. · MINOR (coordinate drift in the prior stamp's citations, not in the record): the 2026-09-29 stamp said the order writer "binds it at `:177`, emitting it as `targetInstanceId` in the audit JSON at `:186`". Neither line holds that. `:177` is the closing `);` of the `print_raw` chit argument list, and `:186` is the closing `);` of a `tracing::info!` block. The real coordinates, re-measured at HEAD on `crates/kasirmu-bridge/src/kds.rs`: the writer signature is still `target_instance_id: Option<&str>` at `:160` (correct in the prior stamp), the chit-print `tracing::info!` binds `target_instance_id` at `:184`, and the emit that produces the audit JSON key is `"targetInstanceId": target_instance_id` at `:193` — inside the `sink.emit("kds:chit-printed", …)` block that opens at `:188`. Corrected because the whole point of citing a line is that a reader can go there; two stale offsets in a "0 findings" stamp are still two wrong answers. · MATCH, re-measured at HEAD: the central mechanism holds — `crates/kasirmu-bridge/src/kds.rs:45` pulls `route.get("target_instance_id")` off the matched route and `:117` does the same for the hardware leg (both exact, as the prior stamp said); `target_instance_id` appears at kds.rs :45/:117/:160/:184/:193/:202/:463/:467 and `targetInstanceId` only at :193, so the wire-key spelling is unique. The dependent column is real and nullable on the KDS order table at `crates/kasirmu-core/migrations/20260813_init.sql:291` (`store_id TEXT, kitchen_zone TEXT, table_number TEXT, priority INTEGER NOT NULL DEFAULT 0, target_instance_id`), with the `UNIQUE (sale_id, kitchen_zone)` constraint on the next line — which is exactly the constraint the Deliberate limitation names and Phase 8 had to work around (`CREATE TABLE kds_order_targets` at `:264`). · LEFT AS WRITTEN: the Deliberate limitation (one routed target per sale while `kds_orders.sale_id` is uniquely constrained; the consumer deterministically selects the first matching operation route) remains the accurate description — Phase 8's record and `crates/kasirmu-bridge/src/pos.rs` agree. · NOT re-measured: the red-test history ("Red test reproduced the missing column before the migration") and the UI typecheck / Rust formatting acceptance lines, which are the phase's own evidence of a run on 2026-08-09, not re-run here. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim below;
     the superseded stamp body is quoted as plain text here, not as a nested comment:

Audit stamp: 2026-09-29 · docs-auditor · status: ACCURATE — 0 findings, no repairs needed · Audited on branch 0.0.40. Clean pass. The record's central mechanism — the KDS consumer reading `target_instance_id` off a runtime-plan route and persisting it — is present at the source: `crates/kasirmu-bridge/src/kds.rs:45` pulls `route.get("target_instance_id")` off the matched route, `:117` does the same for the hardware leg, and the order writer takes `target_instance_id: Option<&str>` at `:160` and binds it at `:177`, emitting it as `targetInstanceId` in the audit JSON at `:186`. The `target_instance_id` column it depends on is a real nullable column on the KDS order table (`crates/kasirmu-core/migrations/20260813_init.sql:291`, `store_id TEXT, kitchen_zone TEXT, table_number TEXT, priority INTEGER NOT NULL DEFAULT 0, target_instance_id TEXT`), so the "Red test reproduced the missing column before the migration" story has a schema that matches its outcome. The Deliberate limitation section is the kind of honesty that usually rots, so it was checked too: the claim that `kds_orders.sale_id` is uniquely constrained and therefore permits one routed target per sale is exactly the constraint Phase 8 then had to work around, and `crates/kasirmu-bridge/src/pos.rs` plus the Phase 8 record agree. · No repairs needed. · No stamp or footer existed on this file before this pass.
-->


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

> last audited 11-10-26 by docs-auditor
