# NamespacedStore — API Draft (Phase 2, design only)

**Status:** Draft for review (2026-10-01) — **no enforcement**, nothing compiles yet
**Scope:** Immediate Next Action #4 of the modular scaffolding plan (`todo-modular-scaffolding.md` §14).
Precedes Phase 2 'abstraction introduction' (§7.3, §9.2). Design must be compatible with the single shared
SQLite connection the tree uses today (§7.1).
**Predecessors:** ADR-62 (module seam taxonomy), `docs/architecture/module-namespace-governance.md` (Phase 1
soft governance), `docs/architecture/handler-census-phase0.md` (the classified handler population).
**Enforcement:** none. This document is a shape to argue with, not a gate. The Phase 1 checker
(`scripts/verify-namespace-governance.py`) remains the only mechanical boundary until Phase 2 lands.

---

## 1. Why a draft, and why now

Phase 1 (soft governance) froze the *set* of existing cross-vertical reads and named the rules that stop new
ones being added silently. It cannot, by construction, stop a module from calling `conn.prepare("SELECT ...
FROM sales")`. Two things now exist that a draft can build on:

1. The table→module ownership map is executable and agreed (`module-namespace-governance.md` §3 =
   `scripts/verify-namespace-governance.py` `TABLE_OWNERS`).
2. The manifest already carries an *unused* `database_namespace` field
   (`platform/kernel/src/manifest.rs:50-52`; declared in `docs/specs/module-manifest.schema.json` with
   pattern `^[a-z][a-z0-9_]*_$`, max 64). Every module manifest leaves it empty today; only the plugin
   path populates it (`crates/kasirmu-plugin/src/db.rs`, `plugin_<id>_`).

The plan asks to design the API *without enforcing it* and to keep it compatible with the shared connection.
This document does exactly that: it fixes the surface, defers every behaviour that would need a second
connection or a second store type.

---

## 2. The compatibility constraint (the hard one)

Every production module function today takes the shared connection directly, e.g.

    pub fn get_product(conn: &Connection, id: &str) -> Result<Option<Product>, InventoryError>   // modules/inventory/src/service.rs:19
    pub fn get(conn: &Connection, key: &str) -> Result<Option<String>, SettingsError>            // modules/settings/src/service.rs:18
    pub fn create_customer(conn: &mut Connection, customer: &Customer) -> Result<(), CrmError>   // modules/crm/src/service.rs:25
    pub fn generate_daily_report(conn: &Connection, ...)                                        // modules/reporting/src/service.rs:20

and the domain layer wraps the *same* `rusqlite::Connection` with a borrowed view:

    pub struct Store<'a> { pub conn: &'a Connection, ... }      // crates/kasirmu-core/src/db/mod.rs:206
    impl<'a> Store<'a> { pub fn new(conn: &'a Connection) -> Self }   // :231

**Constraint C1 — one connection, zero copies.** `NamespacedStore` must be a *view over a borrowed
`&Connection`*, exactly like `Store<'a>`. It must not open, clone, or own a connection, and must not
require a connection pool. Anything that would need a second connection is Phase 4 or later.

**Constraint C2 — additive, not a rewrite.** Existing `conn`-taking functions keep working unchanged.
A module opts in by wrapping, not by being rewritten:

    let ns = NamespacedStore::new(Store::new(conn), ModuleId("inventory"), Grants::none());
    let p = ns.own().query_row(schema::PRODUCTS_BY_ID, [id], row_to_product)?;

`NamespacedStore` is a facade *over* the same bytes on disk; the Phase 1 checker still governs what raw SQL
may say, and `NamespacedStore` adds a *runtime-checked* path beside it.

**Constraint C3 — no new dependency.** The validation layer reuses `kasirmu-plugin`'s proven SQL scanner
(`strip_sql_comments`, `ensure_no_quoted_identifiers`, `extract_table_references`) rather than inventing a
second parser. That scanner is already hardened against the three bypass dialects and lifetimes; the
Phase 1 checker found the same class of bug independently, so reusing the hardened one is deliberate.

---

## 3. Proposed surface

```rust
//! (DRAFT — illustrative only; does not exist in the tree.)
//! Proposed home: crates/kasirmu-core/src/db/namespaced.rs

/// A module-scoped view over a borrowed shared connection.
pub struct NamespacedStore<'a> {
    store: Store<'a>,          // reuse the existing borrowed view (C1)
    owner: ModuleId,           // e.g. "inventory"
    grants: Grants,            // which foreign namespaces this module may touch
}

/// The owning module's identity — the manifest `id`, not an ad-hoc string.
pub struct ModuleId(&'static str);

/// Sanctioned cross-namespace reads (reporting facade, ADR-62 D5).
pub struct Grants { read: Vec<ModuleId>, /* no `write` in Phase 2 */ }

impl<'a> NamespacedStore<'a> {
    /// Wrap this module's own view. `grants` come from the manifest + ADR-62 D5.
    pub fn new(store: Store<'a>, owner: ModuleId, grants: Grants) -> Self;

    /// The owning module's own namespace. Reads and writes allowed.
    pub fn own(&self) -> Namespace<'_, 'a>;

    /// A sanctioned read-only view of another module's namespace.
    /// Err(NamespaceError::NotGranted) when `module` is not in `grants.read`.
    pub fn read(&self, module: ModuleId) -> Result<Namespace<'_, 'a>, NamespaceError>;

    /// The set of foreign namespaces this store may read. Reporting's facade
    /// builds the concrete `Grants` (see §6).
    pub fn grants(&self) -> &Grants;
}
```

The `Namespace` handle carries the allow-list of table names and the read/write posture:

```rust
pub struct Namespace<'s, 'a> {
    conn: &'a Connection,       // C1: borrowed, never owned
    owner: ModuleId,
    posture: Posture,           // ReadWrite | ReadOnly
    allowed_tables: &'s [&'static str],   // from the ownership map
}

impl Namespace<'_, '_> {
    /// Run a validated statement. Phase 2: check then execute.
    pub fn query<T, P: Params>(&self, sql: &str, params: P, map: impl FnMut(&Row) -> rusqlite::Result<T>)
        -> Result<Vec<T>, NamespaceError>;
    pub fn execute<P: Params>(&self, sql: &str, params: P) -> Result<usize, NamespaceError>;
    /// Escape hatch for the migration window: runs the Phase 1 checker's rule
    /// in-process and returns the SQL it was given. Removed in Phase 4 (§7).
    pub fn raw(&self, sql: &str) -> Result<&str, NamespaceError>;
}
```

### 3.1 What the API deliberately does *not* have

- **No `write(module)`.** Phase 1's inventory found exactly two cross-vertical edges and both are *reads*.
  A cross-namespace *write* has no sanctioned use case in the current tree; adding the door now would invite
  the first one. Phase 4 may add it behind an explicit grant; today it does not exist.
- **No connection pool, no `Arc<Mutex<Connection>>`.** `PluginDb` owns its connection
  (`crates/kasirmu-plugin/src/db.rs:41-47`); `NamespacedStore` must not, because modules share one (C1).
- **No async.** Checkout and the event bus are synchronous by resolved decision
  (`todo-modular-scaffolding.md` §9.1); the facade must not be the place async sneaks in.
- **No auto-migration of existing call sites.** Phase 2 is opt-in per module.

---

## 4. How validation works (reusing the Phase 1 / plugin scanners)

`Namespace::query`/`execute` run the *Rust* scanner from `kasirmu-plugin` in-process. The gate-time checker
(`scripts/verify-namespace-governance.py`) reaches the same verdict through a *separate Python implementation*
(`mask_comments_and_strings` :170, `sql_literals` :246) — the two are deliberately parallel, not shared, and §7's
parity concern applies to them too. The steps below name the Rust functions; the ownership map they consult is
the one both sides must agree on:

1. `strip_sql_comments(sql)` — a `--`/`/* */` comment between `FROM` and a table is a bypass if comments are
   left in (`crates/kasirmu-plugin/src/db.rs:344`).
2. `ensure_no_quoted_identifiers(sql)` — `"sales"`, `` `sales` ``, `[sales]` must not slip past the bare-name
   regex (`db.rs:282`, PLG-11).
3. `extract_table_references(sql)` — the eight keyword patterns (`db.rs:404`; literals at `db.rs:173-194`).
4. For each reference, resolve its owner via the **same map** as the checker's `TABLE_OWNERS`:
   `module-namespace-governance.md` §3. A table that resolves to `self.owner` is allowed; a table that
   resolves to a module in `grants.read` is allowed read-only; anything else is `NamespaceError::Foreign`.
5. Unknown table → `NamespaceError::UnknownTable` (fail-closed, not fail-open). A table the ownership map
   does not know is a governance gap, not permission.

Error type (draft):

```rust
pub enum NamespaceError {
    Foreign { table: String, owner: ModuleId, self_owner: ModuleId },
    UnknownTable { table: String },
    NotGranted { module: ModuleId },
    WriteToForeign { table: String, owner: ModuleId },
    Sql(String),   // parse/quote/comment rejection
    Db(rusqlite::Error),
}
```

**Stated trade-off.** A runtime check is *weaker* than a compile-time one: it can be bypassed by a module
that keeps calling `conn` directly (the escape hatch), and it costs a parse per statement. In exchange it is
the only shape that fits a shared borrowed connection (C1) and it lets modules migrate one function at a
time without a flag day. §8 records the alternatives and why they were rejected.

---

## 5. Migration path (Phase 2, per module)

The plan's §9.3/§9.5 name reporting and inventory as the two bodies of work. Concrete order:

| Step | Module | Change | Why this order |
|---|---|---|---|
| 2.1 | crm, settings, staff, tax, terminal | Wrap: replace `pub fn ...(conn: &Connection)` bodies with `NamespacedStore::new(Store::new(conn), "<id>", Grants::none())` and `ns.own()`. | These modules name **only their own tables** (Phase 1 §4), so no grant is needed and the check can only ever pass. Proves the wrapper compiles and runs before any grant exists. |
| 2.2 | sales, inventory | Wrap. Both modules' **live** code names only their own tables (`modules/sales/src/repository.rs` touches `sales`/`sale_lines`; `modules/inventory/src/repository.rs` touches `products`), so this is a pure wrap with `Grants::none()`. The only file naming other inventory-owned tables is `modules/inventory/src/handlers.rs` — which the Phase 0 census found is **dead/test-only** (never registered). The genuinely cross-vertical BOM deduction lives in the **core** checkout path (`crates/kasirmu-core/src/db/sales_lifecycle.rs`), not in a module, and is out of this API's scope. | The modules' live code is self-contained, so proving the wrap is cheap. The core checkout path keeps using `&Connection` until the ownership map is lifted into core (see §7). |
| 2.3 | loyalty | Wrap; grant `giftcards.read` for `get_gift_card_by_number` (`modules/loyalty/src/repository.rs:58`). | Closes the undeclared-dependency finding from Phase 1 §4 — the grant becomes the declaration. |
| 2.4 | reporting | Wrap; grant `sales.read` (+ whichever of `inventory`/`payments` the facade's queries actually name — `revenue.rs`, `sales_summary.rs`, `product_sales.rs`). Migrate `generate_daily_report` (`modules/reporting/src/repository.rs:33`) onto the facade (§9.5). | The one module whose *purpose* is cross-vertical; its grants are the ADR-62 D5 exception made explicit. |

After 2.4, every production module function that touches the database does so through a `Namespace`, and the
`raw()` escape hatch is the only remaining route to unchecked SQL — which is what Phase 4 removes.

---

## 6. The reporting exception, concretely

ADR-62 D5 sanctions `kasirmu_core::db::reports` as the cross-vertical *read* path. In this API it is not a
table owner; it is a **grant holder**:

    // The facade builds its own store with the cross-vertical grants.
    let ns = NamespacedStore::new(Store::new(conn), ModuleId("reporting"), Grants {
        read: vec![ModuleId("sales"), ModuleId("inventory")],   // the tables the facade's queries name
    });

The existing facade submodules (`revenue.rs`, `sales_summary.rs`, `product_sales.rs`, `datetime.rs`) keep their
current `Store`-method shape; Phase 2 only changes where the `Grants` value is *constructed* (one place, the
facade's entry point) and adds the ownership-map check to their statement execution. The §9.5 target trait
is a separate, compatible refactor:

    pub trait ReportingFacade {
        fn daily_revenue(&self, range: DateRange) -> Result<DailyRevenue>;
        fn sales_summary(&self, range: DateRange) -> Result<SalesSummary>;
        fn product_sales(&self, range: DateRange) -> Result<ProductSalesReport>;
        fn low_stock_alerts(&self) -> Result<Vec<LowStockAlert>>;
    }

A reporting query added by a module repository (not the facade) is exactly what Phase 1 Rule 1 already
flags; this API gives the checker a runtime counterpart without changing the rule.

---

## 7. Where the ownership map lives

The map has two copies today and the governance doc requires them to agree: the prose table
(`module-namespace-governance.md` §3) and the checker's `TABLE_OWNERS`
(`scripts/verify-namespace-governance.py`). A third copy in Rust would be the thing that drifts.

**Proposal:** generate the Rust copy from a single source. Two acceptable options, in order of preference:

1. A **single new data file** (proposed name: `modules/ownership.json` — *not yet created*) consumed by
   (a) a small `include!`/`build.rs` codegen into `kasirmu-core`, and (b) `scripts/verify-namespace-governance.py`.
   One source, three consumers, no drift.
2. Keep `TABLE_OWNERS` in the checker as the source and generate the Rust `const` from it with a checked-in
   script, guarded by a `--check` mode in CI (the `docs/records/README.md` precedent, see
   `scripts/generate-records-index.mjs`).

Either way a **parity test** must fail when the Rust map and the checker disagree — the same posture as
`receiptElementParity.test.ts` (Rust enum ⇄ TS mirror) adopted earlier in this codebase.

**Do not** hand-maintain a third list. §3 above is a *draft*; its entries are copied from the governance doc
only so the shape reads concretely.

---

## 8. Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Compile-time namespaces** (each module gets its own types over its own tables; foreign access cannot be named) | Cannot be done without either a second connection per module or a decade-long rewrite of every `conn: &Connection` signature. The plan explicitly defers strictness to Phase 4 (§7.3). Revisit only after Phase 2 completes. |
| **SQLite `set_authorizer`** (the plugin note's suggested long-term replacement for regex validation, `crates/kasirmu-plugin/src/db.rs:5`) | Stronger and cheaper than regex *per connection* — but it is per-connection state, so on the single shared connection it would need the *current module* to be threaded through the call, which is exactly what a borrowed view cannot express without global mutable state. Deferred with the same note: a viable Phase 4 accelerator if `NamespacedStore` proves it can carry the module identity. |
| **Separate SQLite database per module** | Breaks atomic checkout (§9.1) and the single-file backup/restore contract (`BACKUP_GENERATIONS`, `crates/kasirmu-core/src/db/mod.rs:273`). Not compatible with C1. |
| **Do nothing beyond Phase 1** | Phase 1 governs *new* code by review; it cannot stop a runtime path that constructs SQL from data. The plan's Phase 2 exists to close that gap before Phase 4 can enforce anything. |

---

## 9. Open questions for review

1. **Map source of truth (§7).** A new shared ownership data file + codegen, or generate-from-checker? This
   decides where the first Phase 2 PR points.
2. **`raw()` escape hatch.** Keep it for the whole of Phase 2 (per-module migration needs it) or gate it
   behind a `#[cfg(debug_assertions)]` from the start? Suggested: keep it, but make every call emit a
   structured warning naming the module and the tables so the Phase 3 burn-down can be measured.
3. **Grant construction (§6).** Should `Grants` be built from the manifest `dependencies` array
   (`modules/*/manifest.json`) at startup, so a code-level grant with no manifest entry fails? That would
   turn Phase 1 Rule 3 (today a review rule) into a mechanical check, but it needs the manifest's dependency
   list to first be made complete (the loyalty→giftcards edge is currently undeclared).
4. **Where `NamespacedStore` lives.** Proposed `crates/kasirmu-core/src/db/namespaced.rs`, beside
   `Store`. A `platform/kernel` home would let it read manifests at wrap time but would invert the current
   dependency (kernel does not depend on core). Suggested: core, with the manifest read staying in Phase 2.4
   optional work.
5. **Naming.** `Namespace` (the handle) vs `NamespaceView`; `own()` vs `local()`. Cosmetic, but pick before
   Phase 2.1 writes code against it.

---

## 10. What would make this enforceable (Phase 4, for reference only)

Nothing here is enforced now. Phase 4 (§7.3, §9.2) becomes possible only after 2.1–2.4 land:

- delete `raw()` so no unchecked SQL path remains;
- have the ownership map's Rust copy reject at boot a grant that no manifest declares;
- require reporting to route through the facade (closes Phase 1 §4 row 1);
- keep the table-name scan as a best-effort guard *behind* `set_authorizer`, which by then has a module
  identity to key on.

---

## References

- `todo-modular-scaffolding.md` §7 (NamespacedStore strategy), §7.3 (phased enforcement), §9.1 (checkout
  synchronous), §9.2 (namespace phasing), §9.5 (reporting facade), §14 (Immediate Next Action #4)
- `docs/decisions/2026-09-30-adr62-module-seam-taxonomy.md` (the seams and the D5 reporting exception)
- `docs/architecture/module-namespace-governance.md` (Phase 1 rules, ownership map §3, inventory §4)
- `docs/architecture/handler-census-phase0.md` (the classified handler population)
- `crates/kasirmu-plugin/src/db.rs` (the reusable scanner: `validate_sql`, `strip_sql_comments`,
  `ensure_no_quoted_identifiers`, `extract_table_references`)
- `crates/kasirmu-core/src/db/mod.rs:206` (`Store<'a>` — the borrowed view this mirrors)
- `platform/kernel/src/manifest.rs:50` (`database_namespace`, the unused manifest field)
