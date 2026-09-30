# Module Namespace Governance (Phase 1 — Soft Governance)

**Status:** Adopted (2026-09-30) — soft governance only; no build fails on existing access
**Scope:** Phase 1 of the modular scaffolding plan (`todo-modular-scaffolding.md` §9.2), following ADR-62
**Enforcement:** `scripts/verify-namespace-governance.py` (gates.json id `namespace-governance`)

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
a module actually names, and prints a **report line** for each edge that has no matching declaration.
Because the current tree has such edges (see §4), this is reported, not failed — making it a hard
failure is a Phase 4 change, gated on the §4 items being closed. **This is a review rule today.**

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

The table names here are the schema's own (`crates/kasirmu-core/migrations/20260813_init.sql`), not
guesses: the checker's `TABLE_OWNERS` map is the executable copy and the two must agree. The four
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
| `modules/reporting/src/repository.rs:34` | `sales` | sales | **Baselined debt + grant marker.** Reporting is the sanctioned cross-vertical reader (ADR-62 D5), but this site (`generate_daily_report`) bypasses the facade with its own SQL. Carries the T3 marker `// namespace: cross-vertical read sales granted (…)`. Plan §9.5 target: route through `kasirmu_core::db::reports`, after which the marker is deleted. `modules/reporting/src/lib.rs:33-40` already records this surface as zero non-test callers. |
| `modules/loyalty/src/repository.rs:59` | `gift_cards` | giftcards | **Baselined debt + grant marker.** `get_gift_card_by_number` reads a table owned by the `giftcards` module, but loyalty declares only `deps: ["crm"]`. Carries the T3 marker. Not surfaced by the plan; found by this inventory. |
| `modules/inventory/src/handlers.rs` (72, 89, 127, 155, 161, 180, 187, 195) | `products`, `product_recipes`, `inventory`, `stock_summary` | inventory | **Not a violation** — all four tables are inventory's own. The file's cross-file concern (it is a dead test-only handler) is the census's, not this rule's. |

**Genuine cross-vertical edges: 2** (reporting→sales, loyalty→gift_cards). Both are baselined
**and** carry a T3 grant marker; neither is new, so the gate is green today and a *new* one fails. The
baseline is now only a bookkeeping record of the edges that still need their Phase 4 replacement —
permission itself comes from the marker, so the baseline can shrink to zero without weakening the gate.

---

## 5. What Phase 4 will change

The plan's Phase 4 replaces this soft posture:

- reject unauthorised cross-namespace table access;
- require reporting to use the sanctioned facade (closes the first §4 row);
- make `NamespacedStore` (Phase 2) the only route to another vertical's data.

When those land, the allowlist and the baseline in §4 must both empty. Until then, this document and
`scripts/namespace-governance-baseline.json` are the frozen record of what is tolerated, and
`scripts/verify-namespace-governance.py` fails the moment a new violation appears.

---

## References

- ADR-62 — `docs/decisions/2026-09-30-adr62-module-seam-taxonomy.md` (the seams this governs)
- `docs/architecture/handler-census-phase0.md` §3 (the classified handler population)
- `todo-modular-scaffolding.md` §9.2 (phased enforcement), §9.5 (reporting facade), §14 (actions)
- `platform/kernel/src/manifest.rs` (the declaration Rule 3 reads)
- `scripts/verify-namespace-governance.py` (the checker)
