# Module Namespace Governance (Phase 1 — now strict)

**Status:** Adopted 2026-09-30; made **strict** 2026-10-03 (Phase 4 P4.5) — an undeclared cross-vertical
dependency now fails the gate; the one remaining edge is baselined and grant-marked
**Scope:** Phase 1 of the modular scaffolding plan (`todo-modular-scaffolding.md` §9.2), following ADR-62
**Enforcement:** `scripts/verify-namespace-governance.py --strict` (gates.json id `namespace-governance`)

---

## 1. Why this document exists

ADR-62 named the two module seams and the reporting-facade exception. That ADR recorded *what the
seams are*; this document records *the rules that keep new ones from forming silently*, and the
inventory of the ones that already exist. It is deliberately **soft**: the plan's Decision 2
(`todo-modular-scaffolding.md` §9.2) requires rules and tooling that do **not** fail builds on
existing cross-vertical access, because modules share one SQLite connection today and strict
rejection would break working functionality. Strict enforcement is Phase 4.

The plan's Immediate Next Action #3 lists three rules. All three are stated here; two are checked
mechanically and one is a review rule.

---

## 2. The three soft-governance rules

### Rule 1 — No new cross-vertical raw SQL outside the approved facades

A module's repository or handler must not issue raw SQL (`SELECT`/`INSERT`/`UPDATE`/`DELETE`)
against a table owned by another vertical, except through the sanctioned reporting facade
(`kasirmu_core::db::reports`) or through an entry in the explicit allowlist in §4.

**Rationale:** a raw cross-vertical read is a hidden dependency — it does not appear in
`manifest.json`, it is not covered by the owning module's schema changes, and it is exactly what
Phase 4's `NamespacedStore` will one day reject. Freezing the *set* now means the migration to
Phase 2 can proceed without a moving target.

**How it is checked:** `scripts/verify-namespace-governance.py` scans production `.rs` files under
`modules/`, extracts the tables each one names in SQL, and compares against the table→module
ownership map in §3. A reference to a table outside the file's own module (and outside the allowlist)
is a **verdict** (exit 1) *only if it is not already in the frozen baseline*
(`scripts/namespace-governance-baseline.json`). Existing violations are inventoried, not failed.

**Grant markers (T3):** a baseline entry no longer excuses a cross-vertical read on its own. The call
site must carry an in-code marker naming exactly the table it reads:

```rust
// namespace: cross-vertical read sales granted (daily revenue aggregate; Phase 4 moves this behind a store read API)
let mut stmt = self.conn.prepare("SELECT ... FROM sales WHERE ...")?;
```

The marker must sit within a four-line window **above** the statement and name the same table; a
marker naming a different table, or sitting below the statement, does not grant. A reference that
carries a matching marker is permitted and reported as *granted* (whether or not it is baselined); a
baselined reference **without** a marker is blocking, with the marker's absence named as the
remediation. A marker that sits on a reference to the module's **own** table is a `stale-grant`
finding: the exception outlived the coupling it excused, and leaving it would let a future unrelated
read hide behind it. The intended end state is a zero-entry baseline: every remaining edge carries a
visible, reviewable grant.

### Rule 2 — No new unclassified handlers

Every registered event handler carries a classification, drawn from ADR-62 D4's vocabulary:
`command_contributor | projection_subscriber | query_facade | lifecycle | plugin_bridge |
internal_helper`. The Phase 0 census (`docs/architecture/handler-census-phase0.md` §3) supplies the
initial population.

**Rationale:** an unclassified handler is a seam nobody has decided about. ADR-62 D3's test ("would
removing it change whether a sale is valid?") can only be applied if the handler is first written
down.

**How it is checked:** the classification registry `scripts/handler-classification.json` lists every
handler name the census found. The checker scans for `impl EventHandler<` in production Rust, derives
each implementing type, and **fails on a type that is not in the registry** — i.e. on a *new* handler
added without classification. It does not fail on handlers that exist but are unclassified; the
registry already covers those, and re-grading them is the census's job, not this gate's.

Two source-reading traps the checker had to be taught, both recorded because each produced a
confident wrong answer first: a **lifetime** `<'a>` is a single quote, so a masker that treats `'`
as a string delimiter swallows the rest of the file and reports *fewer* handlers than exist (this is
how the first draft saw 13 impls instead of 14, missing the LAN `KdsSyncHandler` and the inventory
handler); and a **test file named `tests.rs`** (e.g. `platform/kernel/src/kernel/tests.rs`) is not
production, so its `BusHandler`/`StopHandler` fixtures are excluded — the same population the census
drew. The regex also requires a *bare* target name, so the blanket-impl fixture
`impl EventHandler<TestBusEvent> for std::sync::Arc<BusHandler>` does not register `std` as a handler.

### Rule 3 — No new module dependencies without declared capabilities

A module that reads or writes another vertical's data declares the dependency in its
`modules/<id>/manifest.json` `dependencies` array and the capability in `permissions`. A new
cross-vertical edge introduced in code without the matching manifest declaration is a review finding.

**Rationale:** the manifest is the only machine-readable statement of what a module needs
(`platform/kernel/src/manifest.rs:42-48`). A dependency that exists in SQL but not in the manifest is
invisible to `every_module_manifest_is_registered` and to any future ordering check.

**How it is checked:** the checker compares declared `dependencies` against the cross-vertical tables
a module actually names. Phase 4 P4.5 flipped the gate to `--strict` (step "namespace governance" in
`scripts/check.sh`), so an undeclared dependency is now **blocking**, not informational. Strictness is
safe because the population was clean at flip time (0 undeclared edges); the one remaining cross-vertical
edge carries a baseline entry and a grant marker (§4).

#### Capability gating at boot (Phase 2 P3)

The declaration side of Rule 3 has a runtime half. A module's `capabilities` list
(`modules/<id>/manifest.json`) uses the plan's vocabulary (`todo-modular-scaffolding.md` §11.4):
`read:<module>`, `write:<module>`, `subscribe:<event>`, `use:reporting_facade`,
`use:lua_hook:<name>`. The kernel parses each entry as `<namespace>:<action>` and, at boot,
`load_all` **fails fast** with `KernelError::MissingCapability` when a required capability was not
granted (`platform/kernel/src/kernel/lifecycle.rs`).

Event subscriptions are gated the same way: `Kernel::subscribe_gated(module, topic, capability, handler)`
refuses a subscription when the module declares a capability set without holding the topic's
`subscribe:<event>` grant, allows it with a deprecation warning when the module declares nothing (the
legacy path during migration), and registers the handler under **module ownership** so stopping the module
unsubscribes it. `platform/startup/src/lib.rs` routes every boot subscription through this gate under the
`startup` wiring owner; its four topics live in one const (`STARTUP_WIRING_CAPABILITIES`) rather than
scattered across call sites.

**Manifests now declare capabilities.** Phase 4 P4.1 populated every `modules/<id>/manifest.json`
`capabilities` array from the ownership map plus declared dependencies (`read:<id>` + `write:<id>` when
the module owns tables, plus `read:<dep>` per dependency — 36 capabilities across 14 manifests). The
`capability-parity` gate (`scripts/gates.json`; `verify-namespace-governance.py --check-capabilities`)
fails on any drift, and `--emit-capabilities` rewrites the manifests. The **runtime** half — routing the
`NamespacedStore` grant set from the manifest at wrap time, and rejecting a grant naming an undeclared
module — remains open (recorded as PARTIAL in `docs/architecture/phase4-implementation-tickets.md`); each
module still constructs its store with an explicit `Grants` value.

---

## 3. Table ownership map

Ownership is by the module that declares the entity in its manifest and whose repository owns the
schema. Derived from the tree, not from any plan.

| Module | Owns (tables) |
|---|---|
| sales | `sales`, `sale_lines` |
| inventory | `products`, `product_recipes`, `inventory`, `stock_summary` |
| crm | `customers` |
| settings | `settings` |
| currency | `currencies`, `exchange_rates` |
| loyalty | `loyalty_accounts`, `loyalty_tiers`, `loyalty_transactions` |
| staff | `users`, `roles` |
| tax | `tax_rates`, `category_taxes`, `product_taxes` |
| terminal | `terminals`, `terminal_profiles`, `terminal_feature_overrides` |
| giftcards | `gift_cards`, `gift_card_transactions` |
| kitchen | `kds_daily_counters`, `kds_line_items`, `kds_order_targets` |
| promotions | `promotions`, `promotion_applications` |
| purchasing | `purchase_orders`, `purchase_order_lines` |
| reporting | *(owns no tables — it reads through the facade)* |

**Single source of truth (Phase 2, 2026-10-02).** This table had two hand-maintained copies (this
prose and the checker's `TABLE_OWNERS`); Phase 2's runtime `NamespacedStore` check needs a third copy
in Rust, so the map was reduced to ONE source: `modules/ownership.json`. It is consumed by

- `scripts/generate-ownership-map.mjs` → `crates/kasirmu-core/src/db/ownership.rs`
  (`cargo test -p kasirmu-core --lib ownership`), checked by `--check`;
- `scripts/verify-namespace-governance.py` `TABLE_OWNERS`, checked by `--check-ownership`.

Do not hand-edit either generated copy; change `modules/ownership.json` and re-run the generator. The
table below is prose *about* that file and must be updated with it.

The table names here are the schema's own (`crates/kasirmu-core/migrations/20260813_init.sql`), not
guesses. The four
stub verticals (kitchen, promotions, purchasing, and the giftcard/terminal sub-tables) own their
schema tables even though no production module code queries them yet — a stub that grows SQL later
must not look like a foreign read.

The sanctioned facade `kasirmu_core::db::reports` is **not** a table owner; it is the permitted
read path across all of them (ADR-62 D5).

---

## 4. Inventory of existing cross-vertical access (the allowlist)

Measured against the current tree. These are the ONLY cross-vertical raw-SQL references in production
module code. Each is either allowlisted (deliberate, with a reason) or baselined (existing debt).

| Site | Reads | Owner module | Verdict |
|---|---|---|---|
| `modules/loyalty/src/repository.rs:59` | `gift_cards` | giftcards | **Baselined debt + grant marker.** `get_gift_card_by_number` reads a table owned by the `giftcards` module, but loyalty declares only `deps: ["crm"]`. Carries the T3 marker. Not surfaced by the plan; found by this inventory. |
| `modules/inventory/src/handlers.rs` (72, 89, 127, 155, 161, 180, 187, 195) | `products`, `product_recipes`, `inventory`, `stock_summary` | inventory | **Not a violation** — all four tables are inventory's own. The file's cross-file concern (it is a dead test-only handler) is the census's, not this rule's. |

**Genuine cross-vertical edges: 1** (loyalty→gift_cards). It is baselined **and** carries a T3 grant
marker; it is not new, so the gate is green today and a *new* one fails. The baseline is now only a
bookkeeping record of the edges that still need their Phase 4 replacement — permission itself comes from
the marker, so the baseline can shrink to zero without weakening the gate.

**Retired 2026-10-03 (Phase 3 P3.1):** the second edge (reporting→sales,
`modules/reporting/src/repository.rs:34` `generate_daily_report`) was deleted, not rerouted — its whole
domain surface had zero non-test callers and the facade `kasirmu_core::db::reports` already ships the
capability. Its baseline entry and T3 marker went with it. See
`docs/architecture/reporting-facade-inventory.md` §3, §6.

---

## 5. What Phase 4 changes

The plan's Phase 4 replaces the soft posture. Delivered so far:

- **P4.3** deleted `NamespacedStore::raw()`, so there is no unchecked-SQL hatch;
- **P4.1 (manifest half)** populated every manifest `capabilities` array and added the `capability-parity`
  gate; the runtime grant routing remains open;
- **P4.4** proved the manifest capability set is the boot-path boundary
  (`platform/startup/tests/boot_capability.rs`);
- **P4.5** flipped this gate to `--strict`, so an undeclared dependency blocks;
- reporting already uses the sanctioned facade (the sole bypass edge retired in Phase 3 P3.1).

Still open: **P4.1 runtime half** (route `Grants` from the manifest at wrap time), **P4.2**
(`trait ReportingFacade`), and **P4.6** (the completion page). The breakdown is in
`docs/architecture/phase4-implementation-tickets.md`; the map is `modules/ownership.json`.

When P4.6 lands, the allowlist and the baseline in §4 both empty. Until then, this document and
`scripts/namespace-governance-baseline.json` are the frozen record of what is tolerated, and
`scripts/verify-namespace-governance.py --strict` fails the moment a new violation appears.

---

## References

- ADR-62 — `docs/decisions/2026-09-30-adr62-module-seam-taxonomy.md` (the seams this governs)
- `docs/architecture/handler-census-phase0.md` §3 (the classified handler population)
- `todo-modular-scaffolding.md` §9.2 (phased enforcement), §9.5 (reporting facade), §14 (actions)
- `platform/kernel/src/manifest.rs` (the declaration Rule 3 reads)
- `scripts/verify-namespace-governance.py` (the checker)
- `docs/architecture/phase2-implementation-tickets.md` (the Phase 2 tickets these rules feed)
- `docs/architecture/module-boot-sequence.md` (how a module is registered, gated, loaded, and started)
- `modules/ownership.json` (the single source of the §3 table map)
