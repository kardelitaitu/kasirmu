---
num: 2
area: module-system
title: ADR #2: Event Bus Design
status: Implemented (2026-07-15)
---
<!-- Superseded audit marker (2026-07-22, body kept verbatim) · Hermes-Agent · status: ACCURATE (0 findings) · EventHandler/DomainEvent traits verified in foundation/src/contracts.rs:62/71 (handle/event_name signatures match); EventBus in platform/kernel/src/event_bus.rs:88 with subscribe/publish (subscribe takes a topic param beyond the ADR sketch — design intent preserved); Status "Implemented (2026-07-15)" consistent with the live synchronous in-process bus · related links valid -->

<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · ACCURATE, and the most consequential claim in this ADR was independently confirmed elsewhere in this campaign rather than taken on trust. §5 states the error policy: if a handler returns an error the bus logs it with context, does NOT propagate it to the publisher, and CONTINUES dispatching to remaining subscribers — the "fire-and-forget-on-error" policy that keeps a failing CRM subscriber from blocking a committed sale. That was checked at the source while auditing `docs/specs/_done/workspace-settings-phase-0e-async-event-bus.md` in this campaign: `platform/kernel/src/event_bus.rs:254-282` invokes each handler inside `std::panic::catch_unwind`, and the error arm logs with `event_name`/`handler_index`/`module_id` while the panic arm logs a recovered payload — neither arm breaks the loop. A decision document being corroborated by the file it decided about, years apart and by two unrelated audits, is the strongest form this work produces. · THE TRAIT DEFINITIONS STILL EXIST AND AT THE PATH THE ADR NAMES: `pub trait EventHandler<E>` and `pub trait DomainEvent` are both in `foundation/src/contracts.rs` (lines 82 and 91; the 2026-07-22 Hermes stamp cites `:62/71`, ordinary line drift). `foundation/` is one of the few roots the workspace restructure did NOT rename, so this ADR's `foundation/src/contracts.rs` reference is still literally correct — notable, because most of this campaign's findings are renamed paths. `platform/kernel/src/` is also correct and the `EventBus` struct, the `Arc<RwLock<EventBus>>` sharing and the three-method surface are all still there. · ⚠️ ONE DEAD REFERENCE: the Related section lists `RESTRUCTURING.md` — "Phase 3: Event Bus" — and no such file exists in the repository, tracked or on disk. Everything else in that section resolves: `ARCHITECTURE.md` is present, and ADR #1 (Module System Design) is in `docs/decisions/`. Recorded rather than deleted, because a dead pointer in a Related list is a small thing to fix and removing the line would also remove the record that the pointer ever existed; a reader chasing the event-bus phase history can see it was in a restructuring document that is no longer present. · A NOTE ON THE ADR'S OWN STATUS LINE: front matter says `Implemented (2026-07-15)` while the body Date is 2026-02-01. That is a record of when it was decided versus when it landed, not a contradiction, and it is left as written. · The Options table (A chosen / B deferred / C rejected / D deferred) and the Consequences/negative/mitigation sections are unchanged and remain the reason the ADR is worth keeping: the "slow subscriber blocks all others" and "event lost if a subscriber crashes mid-handle" costs are stated plainly rather than argued away. · The 2026-07-22 Hermes stamp is retained as the original evidence, re-labelled rather than superseded; the stacked status lines at the foot of the file are collapsed to a single machine-read footer, which is the one repair made here — the file carried TWO `> status: ACCURATE` lines under one footer, and the no-stacking rule applies to those as much as to house stamps. -->
# ADR #2: Event Bus Design

**Status:** Implemented (2026-07-15)
**Date:** 2026-02-01
**Author:** Architecture Team
**Tags:** architecture, event-bus, decoupling

---

## Context

kasir.mu requires modules to communicate without direct imports to maintain loose coupling. The primary use cases are:

1. **Sale completed** → Inventory decrements stock → CRM updates customer history → Loyalty awards points → Reporting logs the transaction.
2. **Product created** → Audit log records the creation → Sync engine queues the change.
3. **Stock adjusted** → Reporting updates inventory dashboard.

The event bus is the architectural boundary that enables this. It is defined in the target architecture in `ARCHITECTURE.md` with the principle: *"No direct module-to-module calls. Modules communicate exclusively through an event bus."*

Initial trait definitions exist in `foundation/src/contracts.rs`:

```rust
pub trait EventHandler<E>: Send + Sync where E: Send + Sync + 'static {
    fn handle(&self, event: &E) -> ModuleResult;
}

pub trait DomainEvent: Send + Sync + 'static {
    fn event_name(&self) -> &'static str;
}
```

---

## Decision

### 1. In-Process, Topic-Based, Synchronous Bus

The event bus is:

- **In-process** — No network, no serialization. Events are plain Rust structs passed by reference.
- **Topic-based** — Events are dispatched by name (e.g., `"sale.completed"`). Subscribers register for specific topics.
- **Synchronously dispatched by default** — The publisher blocks until all subscribers have handled the event. This ensures causal consistency: when `complete_sale` returns, all side effects (stock decremented, loyalty points awarded) are committed.

### 2. EventBus Struct

The `EventBus` lives in `platform/kernel/src/` and is shared via `Arc<RwLock<EventBus>>`:

```rust
pub struct EventBus {
    subscribers: HashMap<&'static str, Vec<Box<dyn EventHandler<dyn DomainEvent>>>>,
}
```

```rust
impl EventBus {
    pub fn new() -> Self;
    pub fn subscribe<E: DomainEvent>(&mut self, handler: Box<dyn EventHandler<E>>);
    pub fn publish<E: DomainEvent>(&self, event: &E) -> ModuleResult;
}
```

### 3. Typed Event Handlers

Each event type is a plain Rust struct implementing `DomainEvent`:

```rust
#[derive(Clone, Debug)]
pub struct SaleCompleted {
    pub sale_id: String,
    pub total: Money,
    pub lines: Vec<SaleLine>,
    pub customer_id: Option<String>,
    pub completed_at: String,
}

impl DomainEvent for SaleCompleted {
    fn event_name(&self) -> &'static str { "sale.completed" }
}
```

Subscribers implement `EventHandler<T>` for a specific event type:

```rust
struct InventoryHandler;

impl EventHandler<SaleCompleted> for InventoryHandler {
    fn handle(&self, event: &SaleCompleted) -> ModuleResult {
        // Decrement stock for each sold line
        Ok(())
    }
}
```

### 4. Subscription Registration

Modules register their event handlers during `on_load`:

```rust
impl Module for SalesModule {
    fn id(&self) -> &'static str { "sales" }

    fn on_load(&mut self) -> ModuleResult {
        let bus = kernel.event_bus();
        bus.subscribe(Box::new(InventoryHandler));
        bus.subscribe(Box::new(CrmHandler));
        Ok(())
    }
}
```

### 5. Error Handling

If a handler returns an error, the bus:
1. Logs the error with full context (event name, handler ID, error message).
2. Does NOT propagate the error to the publisher (the sale is already committed).
3. Continues dispatching to remaining subscribers.

This "fire-and-forget-on-error" policy ensures that a failing subscriber (e.g., CRM is down) does not block the core sale flow.

### 6. No Async Dispatch (Phase 2)

The initial implementation is synchronous. Async dispatch (background processing with a work queue) is deferred to Phase 3 once the sync engine is built, since the sync engine will need the same queue infrastructure.

---

## Options Considered

### Option A — Synchronous, In-Process, Typed (Chosen)

- **Pro:** Simple implementation, strong type safety, no serialization overhead.
- **Pro:** Causal consistency — side effects are committed before the publisher returns.
- **Con:** Slow subscribers block the entire pipeline.
- **Mitigation:** Subscribers should be fast (DB writes only, no I/O waits).

### Option B — Asynchronous, Channel-Based (Deferred)

Events are sent over a `tokio::mpsc` channel and processed by a background worker.

- **Pro:** Publisher never blocks — maximal throughput.
- **Con:** No causal guarantee — the sale returns before stock is decremented.
- **Con:** Error handling is more complex (retry, dead-letter queues).
- **Decision:** Defer to Phase 3 when the sync engine requires async processing.

### Option C — Message Queue (RabbitMQ / Redis Pub/Sub) (Rejected)

- **Pro:** Strong decoupling, multi-process, durable delivery.
- **Con:** Over-engineered for a single-process POS. Adds network dependency, serialization, and operational complexity.

### Option D — Event Sourcing (Deferred)

Store events as the primary data source, derive current state from event replay.

- **Pro:** Complete audit trail, temporal queries, rebuild state from scratch.
- **Con:** Massive architectural shift, query complexity, storage overhead.
- **Decision:** Revisit for Phase 5+ if audit requirements demand it.

---

## Consequences

### Positive

- Modules are fully decoupled — no direct imports between business modules.
- Adding a new subscriber does not require changing the publisher.
- Events are plain Rust structs with full type safety.
- The synchronous dispatch is easy to reason about and debug.

### Negative

- A slow subscriber blocks all other subscribers and the publisher.
- No built-in retry or dead-letter queue.
- If a subscriber crashes mid-handle, the event is lost.

### Mitigations

- Subscribers are expected to be fast (DB writes, no network calls).
- Each subscriber runs in its own transaction — a crash in one handler does not affect others.
- The sync engine (Phase 6) will provide durable event persistence for critical events.

---

## Related

- `foundation/src/contracts.rs` — `EventHandler` and `DomainEvent` traits
- `ARCHITECTURE.md` — Target architecture (Event Bus section)
- ADR #1 — Module System Design (modules register handlers during `on_load`)
- `RESTRUCTURING.md` — Phase 3: Event Bus

> last audited 29-09-26 by docs-auditor
