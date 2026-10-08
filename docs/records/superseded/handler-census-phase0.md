# Phase 0 — Module Handler Truthfulness Census

**Status:** Census complete (evidence-backed)
**Produced:** Phase 0 of the modular scaffolding effort (`todo-modular-scaffolding.md` §10, §14)
**Method:** Every claim below is derived from the current working tree by reading the registration site and each handler's own source. No handler was removed by this census; it is an inventory + classification, per the Phase 0 exit criterion *"dead-code claims in the plan match the repository."*

---

## 1. Why this census exists

The modular scaffolding plan asserted two facts about module event handlers that had never been checked against the tree:

| Plan claim (todo-modular-scaffolding.md) | Line | Verdict after census |
|---|---|---|
| `SaleCompletedReporter` "has already been removed or is no longer active" | 551 | **TRUE** — removed under MSL-11 (see §4) |
| `InventoryStockHandler` "is not orphaned" | 552 | **FALSE** — never registered in production (see §3) |
| `InventoryStockHandler` "performs important BOM/recipe-aware stock deduction" | 553 | **MISLEADING** — the *domain behaviour* is real and runs on the sale path, but **not through this handler** |
| "Do not delete `InventoryStockHandler`" | 557 | **Re-scoped** — it is test-only duplicate logic; deleting it deletes tests, not production behaviour |

The single correction the plan needs: **no production code path ever subscribes `InventoryStockHandler`.** Its BOM-aware deduction exists in production in a *different, transactional* implementation. See §3.

---

## 2. Registration site (the authoritative wiring point)

All module registration and all startup event subscriptions live in **`platform/startup/src/lib.rs`**, function `init_module_system` (:86).

### 2.1 Module registration

14 module ids are registered via `k.register(Box::new(...))` at :101–:122:

```
modules_inventory::InventoryModule      :101
modules_crm::CrmModule                  :102
modules_tax::TaxModule                  :103
modules_settings::SettingsModule        :104
modules_staff::StaffModule              :105
modules_sales::SalesModule              :106
modules_reporting::ReportingModule      :107
modules_terminal::TerminalModule        :108
modules_currency::CurrencyModule        :109
modules_loyalty::LoyaltyModule          :113   // comment :110-112: previously defined but never registered
modules_purchasing::PurchasingModule    :119   // ── Stub verticals ──
modules_promotions::PromotionsModule    :120
modules_giftcards::GiftCardsModule      :121
modules_kitchen::KitchenModule          :122
```

> Correction to an earlier note: that is **14** registrations (inventory, crm, tax, settings, staff, sales, reporting, terminal, currency, loyalty, purchasing, promotions, giftcards, kitchen), and there are **14** `modules/*/manifest.json` files — an exact 1:1 match. The parity test `every_module_manifest_is_registered` (startup_tests.rs:65) and `module_count() == manifest_ids().len()` (:144) enforce this.

### 2.2 Event-bus subscriptions (production)

After opening a second WAL handler connection (:128), these subscriptions are made at :134–:196:

| # | Topic | Handler | Subscription line |
|---|-------|---------|-------------------|
| 1 | `sale.completed` | `SaleSyncEnqueuer` | :134 |
| 2 | `sale.completed` | `AuditLogHandler` | :149 |
| 3 | `product.created` | `AuditLogHandler` | :155 |
| 4 | `product.created` | `InventorySyncEnqueuer` | :161 |
| 5 | `stock.adjusted` | `AuditLogHandler` | :167 |
| 6 | `stock.adjusted` | `InventorySyncEnqueuer` | :173 |
| 7 | `sale.completed` | `LoyaltyEarnHandler` | :187 |
| 8 | `settings.updated` | `SettingsUpdatedHandler` | :193 (ADR #22 Phase 0e) |

Feature-gated block `#[cfg(feature = "whatsapp-notifications")]` (:199–:274):

| # | Topic | Handler | Condition |
|---|-------|---------|-----------|
| 9 | `sale.completed` | `OrderConfirmationHandler` | when the client initialises OK |
| 10 | `sale.completed` | `PaymentReceiptHandler` | only when `WHATSAPP_RECEIPT_PHONE` set |
| 11 | `stock.adjusted` | `StockLowAlertHandler` | only when `WHATSAPP_MANAGER_PHONE` set (threshold `WHATSAPP_STOCK_ALERT_THRESHOLD`, default 5) |

Then `init_pending_sale_reaper(db_path)` at :280.

### 2.3 Handlers registered OUTSIDE `init_module_system`

The LAN forwarder handlers are wired by the **desktop shell**, not by the startup crate — `apps/desktop-tauri/src/lib.rs:978–989`, inside a bounded retry loop (`LAN_LOCK_RETRIES = 10`, :971) because `.setup()` is synchronous:

| # | Topic | Handler | Subscription line |
|---|-------|---------|-------------------|
| 12 | `sale.completed` | `kasirmu_lan::SaleCompletedHandler` | :978 |
| 13 | `order.course_fired` | `kasirmu_lan::CourseFiredHandler` | :982 |
| 14 | `kds.sync` | `kasirmu_lan::KdsSyncHandler` | :989 |

`LanForwarderHandle::sale_completed_handler()` / `course_fired_handler()` / `kds_sync_handler()` are the accessors (crates/kasirmu-lan/src/lib.rs:937/:945/:964).

---

## 3. Handler census table

Classification uses the plan's Phase 0 taxonomy: *command contributor | projection subscriber | query facade implementation | lifecycle handler | plugin bridge | internal helper*.

| Handler (source) | Module / crate | Subscribed topic(s) | Registrant | Class | Live? |
|---|---|---|---|---|---|
| `SaleSyncEnqueuer` (platform/startup/src/event_handlers.rs:44) | startup | `sale.completed` | init_module_system:134 | projection subscriber (sync outbox) | **LIVE** |
| `InventorySyncEnqueuer` (:147, :190) | startup | `product.created`, `stock.adjusted` | init_module_system:161,:173 | projection subscriber (sync outbox) | **LIVE** |
| `AuditLogHandler` (:248, :322, :372) | startup | `sale.completed`, `stock.adjusted`, `product.created` | init_module_system:149,:155,:167 | projection subscriber (audit log) | **LIVE** |
| `LoyaltyEarnHandler` (:439) | startup | `sale.completed` | init_module_system:187 | command contributor | **LIVE** |
| `SettingsUpdatedHandler` (:510) | startup | `settings.updated` | init_module_system:193 | projection subscriber (ADR #22 relay) | **LIVE** |
| `OrderConfirmationHandler` (crates/kasirmu-notification/src/handlers.rs:80) | notification | `sale.completed` | init_module_system:211 (feature-gated) | command contributor (external side-effect) | **LIVE (feature-gated)** |
| `PaymentReceiptHandler` (:249) | notification | `sale.completed` | init_module_system:229 (feature + env gated) | command contributor | **LIVE (conditionally)** |
| `StockLowAlertHandler` (:170) | notification | `stock.adjusted` | init_module_system:252 (feature + env gated) | command contributor | **LIVE (conditionally)** |
| `SaleCompletedHandler` (crates/kasirmu-lan/src/lib.rs:978) | lan | `sale.completed` | apps/desktop-tauri/src/lib.rs:978 | plugin bridge (LAN fan-out) | **LIVE (desktop)** |
| `CourseFiredHandler` (:998) | lan | `order.course_fired` | apps/desktop-tauri/src/lib.rs:982 | plugin bridge | **LIVE (desktop)** |
| `KdsSyncHandler` (crates/kasirmu-lan/src/kds_sync.rs:245) | lan | `kds.sync` | apps/desktop-tauri/src/lib.rs:989 | plugin bridge | **LIVE (desktop)** |
| `InventoryStockHandler` (modules/inventory/src/handlers.rs:220) | inventory | *(none)* | **none** | orphan / duplicate | **DEAD (test-only)** |
| `SaleCompletedReporter` | reporting | *(none)* | **removed** | — | **REMOVED (MSL-11)** |

Test-only `EventHandler` impls (platform/kernel tests, foundation tests, platform/startup tests) are excluded — they exist to exercise the bus, not to carry behaviour.

---

## 4. Detailed verdicts

### 4.1 `SaleCompletedReporter` — REMOVED (plan already correct)

The plan (line 551) is accurate. Evidence:
- `modules/reporting/src/handlers.rs:3` — "findings: MSL-11 REMOVED — `SaleCompletedReporter` was registered on the live ..."
- `modules/reporting/README.md:11` — "It owns no event handlers. It previously subscribed `SaleCompletedReporter` to ..."; :40 — lifecycle hooks are stubs.
- `platform/startup/src/startup_tests.rs:535` records the removal rationale.
- The in-place removal note in `platform/startup/src/lib.rs:179–186` records it wrote to "a table with no reader".

**Stale doc (not code):** `docs/architecture/MODULAR_APP_PLAN.md:77` still shows `LocalBus -->|Subscribed: SaleCompletedReporter|` in its ASCII diagram. That is a tracking document, not a live wiring claim.

### 4.2 `InventoryStockHandler` — DEAD in production; the plan's "is active" claim is FALSE

The handler is defined at `modules/inventory/src/handlers.rs:37` and implements `EventHandler<SaleCompleted>` at :220. Its `handle` opens a transaction and calls `handle_line` per line (:229), which:
- skips non-inventory products (:100–:103);
- reads `SELECT ingredient_product_id, quantity_required FROM product_recipes WHERE parent_product_id = ?1` (:127);
- deducts the finished good when there is no recipe (:154–:175) and each ingredient `qty * quantity_required` when there is one (:176–:215).

**Why it is dead.** Grepping the whole tree, `InventoryStockHandler` appears **only** in `modules/inventory/src/handlers_tests.rs` (lines 58, 107, 143, 173, 228, 268, 302, 350, 388, 434, 499) and its own definition file. It is **never** `subscribe`d and **never** constructed outside tests. `InventoryModule`'s lifecycle hooks are log-only stubs — `modules/inventory/src/lib.rs:93–:99` (`on_load`), :102, :110 — and the comment at :95–:98 says outright:

> "In future phases, this will: 1. Register event handlers with the event bus (e.g., handle sale.completed to decrement stock) ..."

So registering this handler is *unimplemented future work*, not a live path.

**The behaviour is real — on the sale path, not this handler.** BOM-aware deduction runs transactionally in `crates/kasirmu-core/src/db/sales_lifecycle.rs`:
- `Store::complete_sale_with_resolved_shortfalls` (:152) reads `self.get_recipe_ingredients(pid)?` (:237), computes `has_recipe` (:240) and `needs_stock = tracks_inventory || has_recipe` (:242), and deducts per resolution/location (:246 onward).
- `get_recipe_ingredients` is `crates/kasirmu-core/src/db/recipes.rs:25`, reading the same `product_recipes` table.
- `Store::finalize_sale` (:86) / `finalize_sale_in_tx` (:110) complete the transition and apply customer stats atomically.
- The MSL-28 comment (:224–:235) documents a *deliberate* `?` (not `.unwrap_or_default()`) so a failed recipe read fails the settlement instead of silently skipping deduction; `sales_checkout.rs:259` reads the same function through the other door.

**Verdict:** the handler duplicates (in a weaker, non-location-aware form) logic the production path already owns. It is the *census* kind of dead code the Phase 0 policy ("duplicated by an active implementation") exists to catch. The plan's instruction "do not delete `InventoryStockHandler`" (§9.3 policy 1) should be re-scoped: the **behaviour** must be retained (it is, on the sale path); the *handler* is a test-only artifact and may be deleted together with its tests once a reviewer confirms no migration depends on it. No deletion is performed by this census.

### 4.3 Registered modules that own NO event handler

`inventory`, `crm`, `tax`, `settings`, `staff`, `sales`, `reporting`, `terminal`, `currency`, `loyalty`, and the four stub verticals (`purchasing`, `promotions`, `giftcards`, `kitchen`) register **no** event handlers. Their `on_load/on_start/on_stop` hooks log and return `Ok(())`. This is consistent with `manager-codebase-review.md:366/:463`: 4 of 14 module crates self-describe as "Stub: lifecycle only" (~85-line lib.rs) and 10 modules' business logic is graded **TEST-ONLY**.

---

## 5. Phase 0 exit-criteria check

| Exit criterion | Status |
|---|---|
| Inventory all registered module handlers | **Done** — §2, §3 (14 production subscriptions + 3 desktop LAN) |
| Identify live / dead / duplicate | **Done** — §3 column "Live?"; only `InventoryStockHandler` is dead |
| Confirm `InventoryStockHandler` remains active | **Answered, plan corrected** — it is *not* active; behaviour lives on the sale path |
| Confirm `SaleCompletedReporter` status | **Done** — removed (MSL-11), plan already correct |
| Produce a handler census table | **Done** — §3 (plan's §9.3 stub of 2 rows replaced by 13 rows) |
| Delete only verified dead handlers | **Deferred** — census finds one dead handler; deletion needs reviewer sign-off and is out of Phase 0 scope |
| Classify every handler | **Done** — §3 "Class" column |

---

## 6. Action items surfaced (not executed here)

1. **Re-scope plan §9.3 policy 1.** Replace "Do not delete `InventoryStockHandler`" with: *"Retain BOM-aware deduction on the sale path (`complete_sale_with_resolved_shortfalls`); `InventoryStockHandler` is a test-only duplicate and may be deleted with its tests."*
2. **Fix plan §9.3 table rows 569–570** so the verdict column reflects §3/§4 above.
3. **Feed §11.3 (handler classification gate).** The `handler_type` metadata the gate will require is exactly the §3 "Class" column; no production handler lacks a classification.
4. **Stale diagram.** Optionally annotate `docs/architecture/MODULAR_APP_PLAN.md:77` (already superseded, body left verbatim by policy).
