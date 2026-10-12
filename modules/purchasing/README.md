# Purchasing Module

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · Re-audit of the purchasing stub page; the 2026-08-31 stamp is merged at the bottom as plain text (delimiters stripped so it cannot nest). · NOTHING NEEDED REPAIR. Every claim re-derived at HEAD holds: manifest.json declares purchasing:view/order/receive/manage with dependencies ["inventory"], matching the Module Info table and `dependencies()`'s &["inventory"] and its rationale comment; PurchasingModule is genuinely lifecycle-only — the three hooks log stub messages and the crate holds no tables, no commands and no subscribe call, which is what the "Currently Owns" section correctly says it does NOT own; Feature::PurchaseOrders maps to "purchase-orders" (features.rs:493); the every_module_manifest_is_registered parity test the page leans on is real and lives in platform/startup/src/startup_tests.rs, with the per-crate manifest_json_matches_module_declaration sibling at modules/purchasing/src/lib_tests.rs:36. · The "why it exists now" argument is the interesting part and it is sound: registering a stub is what puts the purchasing -> inventory edge through the kernel's topological sort from the first commit, so the ordering is exercised before any business logic depends on it. · NOT re-measured: the receive-a-PO single-transaction invariant the checklist describes — it is work the promotion is meant to do, not a claim about present behaviour. · Superseded 2026-08-31 body follows as plain text:

Superseded audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (0 findings) · verified against HEAD: PurchasingModule is a documented lifecycle-only stub; manifest.json declares purchasing:view/order/receive/manage; Feature::PurchaseOrders maps to 'purchase-orders'; every_module_manifest_is_registered parity test referenced in modules/README.md. -->

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (0 findings) · verified against HEAD: PurchasingModule is a documented lifecycle-only stub (registers, declares inventory dep, no tables/commands); manifest.json declares purchasing:view/order/receive/manage; Feature::PurchaseOrders maps to 'purchase-orders' (features.rs:98,449); every_module_manifest_is_registered parity test referenced in modules/README.md -->

**Status:** Stub (lifecycle only — no domain logic yet)

## Overview

The Purchasing module will own the inbound side of stock: supplier records,
purchase orders, goods receipt, and supplier returns. It is the counterpart to
`inventory`, which owns on-hand quantities but not how they got there.

## Module Info

| Field        | Value |
|--------------|-------|
| ID           | `purchasing` |
| Crate        | `modules-purchasing` |
| Version      | `0.1.0` |
| Dependencies | `["inventory"]` — receiving a PO increments stock |
| Permissions  | `purchasing:view`, `purchasing:order`, `purchasing:receive`, `purchasing:manage` |
| Feature flag | `purchase-orders` (`crates/kasirmu-core/src/features.rs`) |

## Currently Owns

Nothing. `PurchasingModule` registers with the kernel, declares its dependency
on `inventory`, and logs its lifecycle transitions. No tables, no commands, no
event subscriptions.

## Why it exists now

Registering the stub means the dependency edge `purchasing → inventory` is
exercised by the kernel's topological sort from the first commit, and the
`every_module_manifest_is_registered` parity test keeps it wired. Adding real
logic later is then an additive change inside one crate rather than a
cross-cutting one.

## Promotion Checklist

- [ ] `models.rs` — `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, `GoodsReceipt`
- [ ] `repository.rs` — PO tables and queries (namespace: `purchasing_*`)
- [ ] `service.rs` — receive-a-PO in a single transaction so stock and the PO
      status can never disagree
- [ ] Emit `stock.adjusted` on receipt rather than writing inventory tables
      directly
- [ ] Tauri commands in the owning app's `commands/` directory
- [ ] Gate the UI on the `purchase-orders` feature flag

All monetary amounts use `Money` (`i64` minor units) — unit cost, landed cost,
and PO totals included. See `modules/README.md` for the full promotion path.

> last audited 11-10-26 by docs-auditor
