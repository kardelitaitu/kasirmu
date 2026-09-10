# Orchestrator Agent 1: Multi-Station KDS Routing Engine

**Document:** `todo-kds-agents-1.md`  
**Role:** Orchestrator Agent 1 (Kitchen Routing & Rules Architect)  
**Goal:** Implement backend routing rules in `oz-core` and `desktop-client` that evaluate order line items by category/tags and route them to designated station queues (Grill, Fryer, Salad, Bar, Expo).

**Target Crates:** `crates/oz-core/src/kds_routing.rs`, `apps/desktop-client/src/commands/kds_routing.rs`  
**Sibling Documents:**
- [`todo-kds-agents-2.md`](./todo-kds-agents-2.md) (Agent 2 — LAN Order Event Dispatcher & State Sync)
- [`todo-kds-agents-3.md`](./todo-kds-agents-3.md) (Agent 3 — Station UI, Modifier Badges & Expo Screen)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(kds-routing): ...`
2. **Owned Path Fence (Exclusive to Agent 1):**
   - `crates/oz-core/src/kds_routing.rs` & tests
   - `crates/oz-core/src/db/kds.rs` & `kds_lines.rs`
   - `apps/desktop-client/src/commands/kds_routing.rs`
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit LAN server multicast (Owned by Agent 2).
   - DO NOT edit UI screens (Owned by Agent 3).

---

## 📋 Task Checklist

### Phase 1.0: Baseline Audit
- [ ] Inspect existing `kds_routing.rs` and database tables `kds_routing_rules`.

### Phase 1.1: Implement Dynamic Category & Tag Rule Matcher
- [ ] Implement category-to-station routing rules with fallback to default kitchen display.
- [ ] Support split-routing: an order with a burger and a cocktail splits the burger lines to Kitchen KDS and the drink lines to Bar KDS.
- [ ] Expose IPC commands `get_kds_routing_rules_scoped` and `save_kds_routing_rules_scoped`.
- [ ] Verify: `cargo test -p oz-core kds`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(kds-routing): implement item category and tag split-routing engine"
  ```
