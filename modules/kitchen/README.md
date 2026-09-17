# Kitchen Module

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

> last audited 31-08-26 by docs-auditor
