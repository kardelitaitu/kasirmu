---
num: 8
area: module-system
title: ADR #8: Scoped Real-Time Event Bus
status: Implemented (2026-07-10)
---
<!-- Audit stamp: 2026-07-22 · Hermes-Agent · status: ACCURATE (0 findings) · store_id: Option<String> verified on SaleCompleted (crates/oz-core/src/events.rs:27) and CourseFired (events.rs:126); apps/desktop-client/src/lan_server.rs (LAN forwarder, port 9180) exists; complete_sale_scoped emits store_id; tablet complete_sale uses None per the doc · ADR #4/#7 cross-refs valid · Status "Implemented (2026-07-10)" consistent -->

# ADR #8: Scoped Real-Time Event Bus

**Status:** Implemented (2026-07-10)
**Date:** 2026-07-10
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** events, scoping, multi-store, lan-forwarder, kds

---

## Context

ADR #4 established store-scoped databases and device-bound terminals. The event bus (`platform/kernel/src/event_bus.rs`) decouples modules by allowing them to publish and subscribe to domain events in-process. However, domain events (`SaleCompleted`, `CourseFired`, `ProductCreated`, `StockAdjusted`) carry no `store_id`, making it impossible for multi-store deployments to distinguish which store an event belongs to.

The LAN forwarder (`apps/desktop-client/src/lan_server.rs`) broadcasts `sale.completed` and `order.course_fired` events to KDS tablet peers over TCP. Without store scoping, if two stores share the same LAN segment, a KDS tablet in the Downtown store could receive kitchen orders from the Mall store — a data leak and operational hazard.

Additionally, ADR #4's security architecture requires that _"events must only broadcast to terminals in the same store."_

---

## Decision

### 1. Add `store_id` to Domain Events

Domain events that cross process boundaries (over LAN or in future IPC channels) now carry a `store_id` field:

```rust
pub struct SaleCompleted {
    pub sale_id: String,
    pub store_id: Option<String>,    // NEW — the store where the sale occurred
    pub line_items: Vec<SaleCompletedLine>,
    pub total_minor: i64,
    pub currency: String,
    pub customer_id: Option<String>,
}

pub struct CourseFired {
    pub sale_id: String,
    pub store_id: Option<String>,    // NEW — the store where the order was placed
    pub course_id: String,
    pub display_number: Option<i64>,
    pub items: Vec<CourseItem>,
}
```

- `ProductCreated` and `StockAdjusted` do **not** get `store_id` — they are in-process only (handled by sync enqueuers and audit loggers) and the database connection already provides implicit store scope.
- `store_id` is `Option<String>` (not `String`) for backward compatibility with existing serialized payloads and to avoid breaking unit tests that construct events without a store context.
- When `store_id` is `None`, the event is treated as unscoped (legacy/single-store behavior).

### 2. Emission Sites Include `store_id` from Session

All Tauri commands that emit `SaleCompleted` or `CourseFired` now extract `store_id` from the resolved session and include it in the event:

```rust
let event = SaleCompleted {
    sale_id: id.clone(),
    store_id: Some(session.store_id.clone()),
    line_items,
    total_minor: cart.total_minor,
    currency: cart.currency.clone(),
    customer_id: cart.customer_id.clone(),
};
let bus = kernel.event_bus();
bus.publish(&event)?;
```

### 3. LAN Forwarder — Per-Store Isolation

Since each POS terminal is device-bound to exactly one store (ADR #4), the `LanEventForwarder` running on that terminal is inherently store-scoped. All events emitted by that terminal already carry the terminal's `store_id`.

- **No changes needed to the forwarder itself** — the `store_id` is already in the serialized JSON payload.
- **KDS tablets filter by store**: when a KDS tablet receives a broadcast, it compares the event's `store_id` against its own device-bound store. Non-matching events are silently dropped.
- If two POS terminals (different stores) share the same LAN, each runs its own forwarder on port 9180. The KDS tablet connects to the forwarder with the strongest signal (or a configured address) and receives only that forwarder's events — which are already scoped to that forwarder's store.

This design keeps the forwarder stateless and avoids adding store negotiation to the TCP handshake.

### 4. Port Collision Mitigation (Future)

If two POS terminals on the same LAN conflict on port 9180, the fallback behavior is:
- The second terminal's forwarder fails to bind and logs a warning.
- KDS tablets connect to the first responder.
- For multi-store LANs, this is acceptable because each forwarder already only emits events from its own store.

A future enhancement (not in this ADR) could add port auto-discovery or a store-announcement protocol.

---

## Implementation Checklist

All items completed 2026-07-10.

- [x] Add `store_id: Option<String>` to `SaleCompleted` and `CourseFired` event structs (in `crates/oz-core/src/events.rs`).
- [x] Update desktop `complete_sale_scoped` to include `store_id: Some(session.store_id.clone())`; deprecated commands get `store_id: None`.
- [x] Update tablet `complete_sale` to include `store_id: None`.
- [x] Update all 8 files with SaleCompleted/CourseFired test constructions (~35 sites) to include `store_id: None`.
- [x] `cargo check` ✅ — clean (17 pre-existing doc warnings).
- [x] `cargo test` ✅ — oz-core (10/10), platform-startup (27/27), modules-inventory (16/16), modules-crm (13/13), modules-reporting (12/12).
- [x] `cargo fmt` ✅ — clean.
- [x] Verify zero regressions — all existing suites pass.

---

## Consequences

### Positive

- Multi-store deployments on the same LAN are safe — KDS tablets only see orders for their store.
- Minimal change — only two event types gain a field; emission sites are mechanical updates.
- Backward compatible — `Option<String>` defaults to `None` in tests, preserving all existing behavior.
- The LAN forwarder remains stateless and simple.

### Negative

- All call sites that construct `SaleCompleted` or `CourseFired` must be updated.
- No compile-time enforcement that `store_id` is always set in production — it relies on code review and the session token pattern (ADR #7).

### Mitigations

- The session token pattern (ADR #7) already ensures every scoped command has access to `session.store_id`.
- A future `clippy` lint could flag `SaleCompleted { store_id: None, .. }` in non-test code.

---

## Related

- ADR #4 — Store-First Tenancy & Workspace Type/Instance Architecture
- ADR #7 — Data Scope Guard & Query Enforcement (Session Token Pattern)
- `crates/oz-core/src/events.rs` — Domain event definitions
- `apps/desktop-client/src/lan_server.rs` — LAN event forwarder
- `apps/desktop-client/src/commands/pos.rs` — Sale completion emission
- `apps/tablet-client/src/commands/pos.rs` — Tablet sale completion emission
- `apps/desktop-client/src/commands/products.rs` — Product/stock event emission

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit; Phase 4 ADR Deep Audit
> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers
> status: ACCURATE (verified against actual codebase)
