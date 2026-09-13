# Orchestrator Agent 1: Multi-Station KDS Routing Engine

<!-- Partial stamp: 2026-09-13 · DSH · THIS IS STILL OPEN FEATURE WORK,
but the design was superseded in part. Static station routing SHIPPED:
`crates/oz-core/src/kds.rs::resolve_kds_targets` (station_ids match with
broadcast fallback and dedup; device pairing via SHA-256 token) and is
heavily tested in `db/kds_tests.rs` (SKU→station map, target selection).
What this doc's Phase 1.1 still asks for and does NOT exist: a dynamic
rules TABLE (`kds_routing_rules` — no migration, no table), category/TAG
rule matching beyond the static station map, split-routing rule config,
and the `get/save_kds_routing_rules_scoped` IPC pair. Any UI/IPC work must
also ship dev-mock handlers — `ui/src/dev-mock/` is mid-extraction by
another session (typecheck-red at stamp time). Defer until that settles,
then reconcile this doc against the bridge layout first. -->

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
