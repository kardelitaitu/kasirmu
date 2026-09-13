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

<!-- BACKEND stamp: 2026-09-13 · DSH (dispatch todo-kds-agents-1.md, backend-only
slice) · the 13-09-26 partial stamp above SUPERSIDED IN PART:
LANDED (backend only, this session), one commit per milestone:
  b7ab48870 pure rule-matcher engine + resolve_kds_targets_with_rules (oz-core/kds.rs)
  652f18494 kds_routing_rules migration + registry + PG regen + Store CRUD (db/kds_rules.rs)
  f8b91e5be bridge get/save bodies + rule-aware resolve composition
  a63fd08b6 desktop shims + generate_handler (+2) + floor pin 449→451
- RULES TABLE: migration `20261005_kds_routing_rules.sql` + registry entry;
  columns id/restaurant_pos_id/priority/matcher_kind CHECK('sku','category',
  'tag')/matcher_value/target_station/is_active/created_at/updated_at;
  FK restaurant_pos_id→terminals ON DELETE CASCADE; no index (rule sets stay
  O(tens) per terminal). init.pg.sql regenerated with it, same commit.
- RULE ENGINE: `resolve_kds_targets_with_rules(line_items, devices, rules,
  station_for_sku, category_for_sku)` in `crates/oz-core/src/kds.rs`. The
  frozen `resolve_kds_targets` keeps its exact signature and semantics —
  it now delegates to a shared private 3-phase core and the rule-aware
  variant only changes WHICH STATION each line resolves to (highest-ranked
  active rule per line, else the zone default). rules=[] is proven
  byte-identical to the static router by pinned tests (pure layer AND
  bridge layer). Ranking: priority ascending (lower number = higher),
  ties: Sku matcher before Category, then input order.
  DEVIATION STAMPED: the callback set grew to two (a Category matcher is
  impossible with zone facts alone); `category_for_sku` resolves via the
  new `Store::product_category_id_by_sku` (products.category_id →
  categories). Tags are NOT MODELED in the catalog (verified: no tags table,
  no by-sku tags helper) — per the dispatch branch, sku+category match
  routing is what shipped and 'tag' was KEPT in the CHECK for schema
  stability: a Tag rule stores/round-trips and NEVER matches (documented
  on KdsRuleMatcher + in the migration + pinned by tests). A follow-up that
  adds tags needs only a tags-by-sku fact source + one match arm.
- STORE CRUD: `crates/oz-core/src/db/kds_rules.rs` — list (priority asc,
  deterministic), save = WHOLE-SET REPLACE per restaurant in one rusqlite
  transaction (server-assigns UUID-v7 ids + timestamps; [] clears),
  Validation rejects blank scope/matcher_value/target_station with rollback
  proven. Facade: one `pub mod kds_rules;` line in db/mod.rs.
- IPC: `get_kds_routing_rules_scoped` (KDS_VIEW) /
  `save_kds_routing_rules_scoped` (KDS_UPDATE) — bridge bodies in
  `crates/oz-bridge/src/kds_routing.rs`, shims in
  `apps/desktop-client/src/commands/kds_routing.rs`, registered in
  lib.rs generate_handler (+2, nowhere else), floor pin 449→451.
  Restaurant scope = session.restaurant_pos_id else terminal_id (same
  fallback the resolver already used).
- DEVIATION STAMPED (milestone order): the dispatch ordered migration last
  because init.pg.sql was "foreign dirty" — that was a PHANTOM at
  measurement (disk==index==HEAD blob proven; the later real foreign
  dirtiness is the concurrent 20261004_midtrans work). Ordering was
  therefore re-cut: migration+registry+CRUD+tests as one atomic commit
  (DB-01 `migration_registry_matches_filesystem` forbids an unregistered
  .sql on disk, so the dispatch's original 1-4 order could never ship
  green M2 tests anyway); bridge after it; desktop last.
- DEFERRED, OUT OF THIS DISPATCH (live sessions own those zones):
  the UI rule editor (ui/**) and the `ui/src/dev-mock/` handlers for the
  two new IPC names — the wire types are `oz_core::kds::KdsRoutingRule` /
  `KdsRoutingRuleInput` (snake_case serde; `matcher` ∈ "sku"|"category"|
  "tag"; is_active default true on save; save returns the persisted set,
  ordered). Follow-ups must also: add ui/src/api kds types + the dev-mock
  pair; bump `apps/desktop-client/tests/gate_audit.rs`
  ("kds_routing",1,["KDS_VIEW"]) → ("kds_routing",3,["KDS_UPDATE","KDS_VIEW"])
  (that census test was ALREADY red at dispatch baseline — tablet/desktop
  pins stale by foreign commands — this line lands with its owner's repair).
- PRE-EXISTING FOREIGN REDS observed at baseline, untouched by design:
  `cargo test -p oz-core migrations` → init_sql_creates_complete_schema_
  surface + existing_db_with_legacy_rows_upgrades_idempotently pin 119
  tables while committed registry is 121 (sync sessions 20261002/03 added
  tables without moving the pin; my rules table makes the measured value
  122 — the repair belongs in migrations_tests.rs, NOT on this dispatch's
  fence); gate_audit census (above); in-flight invoke-surface work inside
  registration_gate_tests.rs (two self-test reds unrelated to the floor).
-->

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
- [x] Implement category-to-station routing rules with fallback to default kitchen display. *(2026-09-13 backend stamp: `resolve_kds_targets_with_rules` + `kds_routing_rules` shipped; category via `products.category_id`; TAG matcher stored but never matches — tags unmodeled, see stamp)*
- [x] Support split-routing: an order with a burger and a cocktail splits the burger lines to Kitchen KDS and the drink lines to Bar KDS. *(rule per line over the frozen router; pinned end-to-end: `resolve_with_rule_splits_cocktail_line_to_bar_device`)*
- [x] Expose IPC commands `get_kds_routing_rules_scoped` and `save_kds_routing_rules_scoped`. *(bridge+shim+generate_handler; floor 449→451)*
- [x] Verify: `cargo test -p oz-core kds`. *(164 passed post-M2: baseline 136 + 14 pure + 14 CRUD; oz-bridge kds 41→50)*
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "feat(kds-routing): implement item category and tag split-routing engine"
  ```
  *(superseded — actual landings are per-milestone `feat(kds-routing):` commits listed in the backend stamp / final report)*

### Phase 1.2: Rule config UI + dev-mock (DEFERRED — out of backend dispatch)
- [ ] UI rule editor over `get/save_kds_routing_rules_scoped` (ui/** — live sessions own).
- [ ] `ui/src/dev-mock/` handlers for both names (mid-extraction by another session — live sessions own).
