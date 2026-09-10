# Orchestrator Agent 2: LAN Order Event Dispatcher & State Sync

**Document:** `todo-kds-agents-2.md`  
**Role:** Orchestrator Agent 2 (Real-Time LAN & Synchronization Architect)  
**Goal:** Implement real-time multicasting of order status transitions (New, Preparing, Ready, Bumped) across LAN terminals so individual prep stations and the expediter (Expo) station stay synchronized with zero lag.

**Target Crates:** `crates/oz-lan/` (or `desktop-client/src/lan_server.rs`), `platform-sync`  
**Sibling Documents:**
- [`todo-kds-agents-1.md`](./todo-kds-agents-1.md) (Agent 1 — Multi-Station KDS Routing Engine)
- [`todo-kds-agents-3.md`](./todo-kds-agents-3.md) (Agent 3 — Station UI, Modifier Badges & Expo Screen)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(kds-lan): ...`
2. **Owned Path Fence (Exclusive to Agent 2):**
   - LAN event payloads for KDS in `crates/oz-lan/`
   - Real-time order synchronization listener in `apps/desktop-client/src/commands/kds.rs`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit routing tables (Owned by Agent 1).
   - DO NOT edit front-end components (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 2.0: Baseline Audit
- [ ] Inspect LAN server event broadcasting mechanisms.

### Phase 2.1: Multi-Terminal KDS Event Broadcasting
- [ ] Implement typed broadcast events: `KdsOrderPlaced`, `KdsLineItemBumped`, `KdsOrderReady`, `KdsOrderRecalled`.
- [ ] Ensure terminal filtering: only stations subscribed to specific station IDs receive detailed line updates; Expo station receives all updates.
- [ ] Handle offline/reconnect state reconciliation: newly booted KDS terminal fetches active queue snapshot from register terminal.
- [ ] Verify: `cargo test -p oz-lan` or multi-terminal integration tests.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(kds-lan): implement real-time LAN broadcast for multi-station KDS state sync"
  ```
