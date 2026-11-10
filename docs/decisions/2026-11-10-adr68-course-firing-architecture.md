---
num: 68
area: pos
title: "ADR-68: Course Firing Architecture — Cart Pre-Checkout Persistence vs KDS Event Pipeline"
status: PROPOSED — awaiting owner ruling between Option 1 and Option 2
---

# ADR-68: Course Firing Architecture — Cart Pre-Checkout Persistence vs KDS Event Pipeline

**Status:** PROPOSED — awaiting owner ruling between Option 1 and Option 2  
**Date:** 2026-11-10  
**Recorded against:** branch `0.0.41`  
**Related:** ADR-63 (event sink seam), `docs/plans/_active/notes.md` (coursing gap finding), `crates/kasirmu-bridge/src/pos/cart.rs`, `ui/src/features/sales/usePosState.ts`.  
**Tags:** pos, kitchen, kds, coursing, events  

---

## 1. Context

In full-service restaurant operations, courses (e.g. Starter, Main, Dessert) are assigned to items on a cart and selectively "fired" to alert the kitchen to begin preparation.

Currently, the coursing lifecycle in `kasir.mu` exhibits an architectural asymmetry:

1. **Course Assignment (`assignCourse` / `set_line_course_scoped`):**
   - Stored in the cart model (`foundation/src/cart.rs:157`, `pub fn set_course`).
   - Materialized at checkout and printed on kitchen chits.

2. **Course Firing (`fireCourse` / `fireAllCourses`):**
   - In the frontend (`ui/src/features/sales/usePosState.ts:247,260`), `fireCourse` mutates local React state only (`setLines`).
   - At checkout (`ui/src/features/sales/PaymentModal.tsx:831`), `publish_course_fired_scoped` is called to publish `order.course_fired` events to the local event bus and LAN peers (`crates/kasirmu-lan/src/lib.rs:1087`).
   - **The Pre-Checkout Gap:** Before the sale is finalized at checkout, firing a course produces no backend effect and is not persisted. If the POS reloads or the session restarts, coursing assignments remain, but the fired event state is lost. Furthermore, the KDS cannot receive an early fire signal before checkout unless a draft order / open tab has been created.

---

## 2. The Architectural Decision

The system requires an authoritative product ruling to decide what "firing a course" actually means in the software architecture:

### Option 1: Cart-Level State Persistence (POS-Centric)
* **Design:** Add `coursing_status: Option<String>` (e.g. `"unfired"`, `"fired"`) to `CartLine` serialization in `foundation/src/cart.rs` and the local cart store.
* **Semantics:** Firing a course is a pre-checkout state machine on the cart. Fired status survives app reloads and tablet disconnects.
* **Trade-offs:**
  - ✅ Smallest diff; isolated to POS cart persistence.
  - ✅ Does not alter kitchen timing guarantees or require KDS schema changes.
  - ⚠️ The kitchen does not receive tickets until the cashier commits the bill or opens a formal tab.

### Option 2: Real-Time KDS Event Release (Kitchen-Centric)
* **Design:** Introduce `fire_course_scoped(session_token, course_id, table_or_tab_id)` in `kasirmu-bridge`. Firing a course immediately provisions or advances the corresponding `kds_line_items` to `item_status = 'preparing'`.
* **Semantics:** Firing a course is a direct operational dispatch command to the kitchen. `kds_line_items.item_status` is the single source of truth.
* **Trade-offs:**
  - ✅ True restaurant operational workflow: appetizers and mains can be released to the line independently in real time.
  - ⚠️ Requires open tab / table anchoring before firing can be recorded against a durable order entity.
  - ⚠️ Makes POS throughput tightly coupled to KDS order state management.

---

## 3. Comparison Matrix

| Factor | Option 1 (Cart State) | Option 2 (KDS Dispatch) |
|---|---|---|
| **Scope of Change** | `foundation/src/cart.rs`, cart persistence | `kasirmu-bridge`, `kasirmu-core/src/kds.rs`, IPC |
| **Kitchen Throughput Impact** | None (delayed until checkout) | Immediate (orders release dynamically) |
| **Pre-Requisite** | None | Active Tab or Table Order ID |
| **Offline Robustness** | High (fully local to terminal) | Medium (relies on LAN KDS sync) |

---

## 4. Proposed Execution Path

Upon owner selection:
- If **Option 1**: Update `foundation/src/cart.rs` line models, add migration/serialization fields, and update `usePosState.ts` to sync with local cart store.
- If **Option 2**: Add `fire_course_scoped` IPC bridge handler, implement course-level release in `kasirmu-core::kds`, and bind `CourseSelectorBar.tsx` Fire button to invoke the command.
