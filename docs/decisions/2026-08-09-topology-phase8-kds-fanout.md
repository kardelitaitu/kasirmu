<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (1 minor, 0 major) · Audited on branch 0.0.40. MINOR repaired: "Migration 124 backfills normalized target rows from Phase 7's single-target column" cites the sequential migration numbering this workspace abandoned — `cargo metadata` aside, the numbered series simply is not present, and migrations are date-stamped (`20260813_init.sql` through `20261015_gift_cards_drop_pin.sql`). The substance is right and the table it creates is real: `kds_order_targets` is defined in the BASE schema at `crates/kasirmu-core/migrations/20260813_init.sql:264`, with `target_instance_id TEXT NOT NULL` at `:266` and the composite `PRIMARY KEY (kds_order_id, target_instance_id)` at `:268` — which is exactly the idempotent attachment the Invariants section relies on — plus the lookup index `idx_kds_order_targets_instance` on `(target_instance_id, kds_order_id)` at `:1181-1182`. Repaired to name the schema the claim is about instead of a number that no longer means anything. A reader who went looking for "124" would have found nothing, and the doc's other two claims about the same table are precise, so the one loose number is worth closing. · MATCH, re-measured: the legacy single-target column this record says stays populated for backward compatibility is present as a nullable column on the KDS order table (`crates/kasirmu-core/migrations/20260813_init.sql:291`, `target_instance_id TEXT`), so the compatibility story is consistent with the schema. The `kds_order_targets` name also appears in `crates/kasirmu-core/migrations/20260820_kds_devices.sql`, confirming the KDS area was touched by more than the base schema. The Invariants section — one order per sale/zone, zero-or-many targets, duplicate routes suppressed — describes `crates/kasirmu-bridge/src/kds.rs` and `crates/kasirmu-bridge/src/pos.rs`, which is where the runtime-plan route collection and the instance-aware list/queue reads live. · No stamp or footer existed on this file before this pass. -->

# ADR: Topology Phase 8 — KDS Fan-Out

**Date:** 2026-08-09
**Status:** Implemented

## Problem

Phase 7 stored one `target_instance_id` on each KDS order. That made a Restaurant POS → multiple KDS topology ambiguous: duplicating `kds_orders` would violate the existing unique `sale_id` constraint, while choosing only one display silently dropped a valid route.

## Decision

Keep one `kds_orders` row per sale and kitchen zone, and normalize delivery targets in:

```text
kds_order_targets(kds_order_id, target_instance_id)
```

The composite primary key makes target attachment idempotent. The legacy `target_instance_id` column remains populated with the first target for backward-compatible API consumers and old rows.

The scoped sale command now consumes every distinct validated POS operation route. Each target KDS instance sees the same ticket through instance-aware list/queue queries; an unrelated KDS instance does not. Legacy orders without target rows remain visible to all KDS instances during migration.

The `kds_order_targets` table (`crates/kasirmu-core/migrations/20260813_init.sql:264`, composite primary key at `:268`) is part of the base schema, and the legacy single-target column is backfilled from Phase 7's value, so upgrades do not lose existing routing.

## Invariants

- One sale/zone creates one `kds_orders` row.
- A sale can have zero, one, or many delivery targets.
- Duplicate runtime routes do not create duplicate target rows.
- Removing all topology routes creates an un-targeted legacy-compatible ticket; future work may choose to suppress such tickets entirely.

## Verification

- Red test reproduced the missing `kds_order_targets` table.
- Core fan-out regression confirms one order, two target rows, and visibility from both target instances.
- Runtime-plan test confirms distinct target collection and duplicate suppression.
- Existing single-target and KDS tests remain compatible.

> last audited 29-09-26 by docs-auditor
