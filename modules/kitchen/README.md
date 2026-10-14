# Kitchen Module

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · Re-audit of the kitchen stub page; the 2026-08-31 stamp is merged at the bottom as plain text (delimiters stripped so it cannot nest). · NOTHING NEEDED REPAIR, and the reason is worth recording because it is the opposite of what most module READMEs in this campaign needed: this page's load-bearing claim — that the `kitchen-display` disable guard reaches into the KDS tables directly and should one day ask this module instead — is still exactly right. `KdsFeatureGuard` really lives in `crates/kasirmu-core/src/features.rs` (the FeatureGuard trait at :578, KdsFeatureGuard alongside it) and its `can_disable` COUNTs `kds_orders`, proven by the test that RENAMES the table to make the read fail and asserts the veto fails CLOSED (features_tests.rs:1133-1146) — a guard whose state read errors must not read as "no tickets". The page's description of a direct table read is therefore both true and the real motivation for the promotion item. · VERIFIED: manifest.json declares kitchen:view/bump/route/manage with dependencies ["sales","terminal"], matching the table and `dependencies()`; KitchenModule's three hooks log stub messages, with on_start naming the SLA timer that does not exist yet — accurate; Feature::KitchenDisplay and Feature::TableManagement both declare `&[Self::Restaurant]` as their dependency (features.rs:147-148) and map to "kitchen-display"/"table-management" (:497-498); the KDS is still frontend-only as claimed (ui/src/features/kds/KdsScreen.tsx present, no Rust module owning ticket state); platform/sync exists. · NOT re-measured: the KDS runtime behaviour and the disable-guard verdict against a live database with open tickets. · Superseded 2026-08-31 body follows as plain text:

Superseded audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (0 findings) · verified against HEAD: KitchenModule is a documented lifecycle-only stub; manifest.json declares kitchen:view/bump/route/manage; Feature::KitchenDisplay and Feature::TableManagement both depend on Restaurant; the kitchen-display disable-guard coupling is accurately described. -->

<!-- Audit stamp: 2026-08-31 · docs-auditor · status: ACCURATE (0 findings) · verified against HEAD: KitchenModule is a documented lifecycle-only stub (registers, declares sales+terminal deps); manifest.json declares kitchen:view/bump/route/manage; Feature::KitchenDisplay and Feature::TableManagement both depend on Restaurant (features.rs:147-148); the kitchen-display disable-guard coupling is accurately described -->

**Status:** Stub (lifecycle only — no domain logic yet)

## Overview

The Kitchen module will own restaurant back-of-house flow: firing an order to a
station, the KDS ticket queue and bump, course and table routing, and prep SLA
tracking for overdue escalation.

## Module Info

| Field        | Value |
|--------------|-------|
| ID           | `kitchen` |
| Crate        | `modules-kitchen` |
| Version      | `0.1.0` |
| Dependencies | `["sales", "terminal"]` — tickets come from fired sales orders; station routing is per-terminal |
| Permissions  | `kitchen:view`, `kitchen:bump`, `kitchen:route`, `kitchen:manage` |
| Feature flags | `kitchen-display`, `table-management` (both depend on `restaurant`) |

## Currently Owns

Nothing. `KitchenModule` registers with the kernel, declares its dependencies,
and logs its lifecycle transitions.

## Existing state to migrate

The KDS today is frontend-only: `KdsScreen` plus the LAN sync path in
`platform/sync`. No Rust module owns ticket state, which is why the
`kitchen-display` disable guard in `kasirmu_core::features` reaches into tables
directly to refuse turning the flag off while tickets are open. When this stub
is promoted, that guard should ask this module instead.

## Promotion Checklist

- [ ] `models.rs` — `Ticket`, `TicketLine`, `Station`, `TicketStatus`, `Course`
- [ ] `repository.rs` — ticket tables and queries (namespace: `kitchen_*`)
- [ ] Subscribe to `order.fired` in `on_load` so tickets are created by event
      rather than by a direct call from the POS screen
- [ ] Move the overdue/SLA escalation timer into `on_start`, and cancel it in
      `on_stop` — a stopped module must leave no live timer behind
- [ ] Repoint the `kitchen-display` feature disable guard at this module
- [ ] Gate the UI on `kitchen-display` / `table-management`

See `modules/README.md` for the full promotion path.

> last audited 11-10-26 by docs-auditor
