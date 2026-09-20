# Orchestrator Agent 2: Operational Mocks (Sales, Inventory & Catalog)

**Document:** `todo-refactor-devmock-agents-2.md`  
**Role:** Orchestrator Agent 2 (Operational Mock Domain Architect)  
**Goal:** Extract sales, checkout, cart holding, inventory levels, stock adjustments, products, bundles, taxes, and shift command mocks from `ui/src/dev-mock/tauri-api.ts` into isolated domain handler modules.

**Target File:** `ui/src/dev-mock/tauri-api.ts`  
**Shared-file hazard:** all four plans edit this one file, so these lanes are serial on it,
not parallel. Every commit named below carries an explicit pathspec (AGENTS.md, Git & Commit
Policy §3), because a bare `git commit` in this shared checkout files whatever another
session happened to stage under your subject. Immediately before each commit, confirm the
router is clean against HEAD: `git --no-optional-locks status --porcelain -- ui/src/dev-mock/tauri-api.ts`.
If it holds edits that are not yours, stop and report rather than committing them.  
**Sibling Documents:**
- [`todo-refactor-devmock-agents-1.md`](./todo-refactor-devmock-agents-1.md) (Agent 1 — Dev-Mock Storage Core & Seeding Engine)
- [`todo-refactor-devmock-agents-3.md`](../../todo-refactor-devmock-agents-3.md) (Agent 3 — Enterprise Mocks: Staff, Workspaces, Topology & Settings)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(devmock-ops): ...`
2. **Owned Path Fence (Exclusive to Agent 2):**
   - `ui/src/dev-mock/handlers/sales.ts` (NEW)
   - `ui/src/dev-mock/handlers/inventory.ts` (NEW)
   - `ui/src/dev-mock/handlers/catalog.ts` (NEW)
   - `ui/src/dev-mock/handlers/shifts.ts` (NEW)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit mock dispatcher or storage core (Owned by Agent 1).
   - DO NOT edit staff/auth/settings mocks (Owned by Agent 3).

---

## 📋 Task Checklist

> **Coverage note (2026-09-13):** the "~196 entries have no owner" figure below was true when
> phases 2.1 and 2.2 landed; [`todo-refactor-devmock-agents-4.md`](./todo-refactor-devmock-agents-4.md)
> was opened for that tail and has since extracted most of it. The agent-2 leftovers this lane
> still owns are **14** entries (12 bundle keys + `get_low_stock_alerts` + `open_cash_drawer`),
> measured at HEAD on 2026-09-13, not the "~196" or agent 4's earlier "~12".

> **Lane status (2026-09-13):** phases 2.1 and 2.2 are **done and committed** (`6105ce224`,
> `efd766226`); the counts recorded under each match those commits. Only the unowned tail
> noted at the foot of this file is open, and [`todo-refactor-devmock-agents-4.md`](./todo-refactor-devmock-agents-4.md)
> now owns most of it — do not re-run 2.1 or 2.2.

### Phase 2.0: Baseline Audit
- [x] Map all sales, inventory, and catalog command strings in `tauri-api.ts`.
  - Literal holds **501 entries** (re-confirmed 2026-09-13 against `ce8666604`: `git show
    ce8666604:ui/src/dev-mock/tauri-api.ts | grep -cE "^[[:space:]]+'[a-z_][a-z0-9_]*':"`
    = 501). The span claimed here as "lines 2626–4781" is wrong for that same commit, which
    measures **2633–4767**; the count was right and the line numbers were not. Re-measure a
    span before quoting it — the same command with `grep -n`, first and last match. Domain split: catalog 60,
    sales/cart ~150, inventory ~30, shifts ~20; the remaining ~196 have no
    assigned owner yet (see the note under Phase 2.2).

### Phase 2.1: Extract Catalog & Tax Mocks
- [x] Move `list_products`, `create_product`, `lookup_by_barcode`, `list_categories`, `get_tax_rules` mocks to `handlers/catalog.ts`.
  - Done as commit `6105ce224`. **60** handlers moved, not 5: products (21),
    variants (10), categories (5), currency + exchange rates (15), tax (9).
    There is no `get_tax_rules` command in the mock — the tax domain is
    `list_tax_rates_scoped` + the four sibling tax-rate commands.
  - `tauri-api.ts` 4,991 → 4,664 lines; the literal drops 501 → 441 entries. (Verified
    2026-09-13 against `ce8666604` and `6105ce224`, both line count and entry count.)
  - `MOCK_PRODUCTS`/`RAW_MOCK_PRODUCTS` moved in with their consumers, as
    `core/mockSeedData.ts` reserved them to do; `MOCK_PRODUCTS` is re-exported
    for the sales/analytics/seeder readers that remain in the router.
  - `unwrapArgs` is injected (not imported) to avoid a
    `tauri-api → handlers/catalog → tauri-api` cycle.
  - Left behind on purpose: `adjust_stock` (inventory → phase 2.2), the
    document-number/fiscal-scheme entries interleaved with the tax block, and
    the analytics `get_*_category_*` reports.
- [x] Verify: `npm run typecheck`.
  - Clean for every touched file. `ui/src/features/workspaces/WorkspaceHome.tsx`
    carries two pre-existing TS6133/TS2440 errors from another workstream's
    uncommitted edit, so the commit used `OZPOS_SKIP_TYPECHECK=1`; `tsc` was run
    by hand and reports nothing in this change. The post-commit tripwire
    recorded the bypass in `.git/typecheck-tripwire.log`.
  - Also green: 9 dev-mock + storage-pin suites (95/95) and the full UI suite
    (554 files / 9,477 passed / 0 failed).
- [x] **Commit Milestone:**
  ```bash
  git add -- ui/src/dev-mock/handlers/catalog.ts && git commit -m "refactor(devmock-ops): extract catalog and tax mock handlers" -- ui/src/dev-mock/handlers/catalog.ts ui/src/dev-mock/tauri-api.ts
  ```
  Landed as `6105ce224`. The `add` is needed only because `catalog.ts` was untracked: a
  bare pathspec commit cannot introduce a new file and `--include` fails the same way (§3
  rev 2).

### Phase 2.2: Extract Sales, Checkout & Inventory Mocks
- [x] Move `start_sale`, `add_line`, `complete_sale`, `hold_cart`, `list_open_bills` mocks to `handlers/sales.ts`.
  - Done as commit `efd766226`, together with the inventory and shift domains
    (one commit, as the milestone below is written). **42** sales handlers
    moved: the cart/held-cart/sale/promotion state cluster and the checkout
    command surface (`start_sale`, `add_line`, `complete_sale`, `hold_cart`,
    `list_open_bills`, refunds, voids), plus `get_sale_promotions` so the
    promotion state stays private to its owner.
  - Left behind on purpose: the state-less promotion CRUD stubs (they own no
    state) and the KDS push helper (see the factory note below).
- [x] Move `adjust_stock`, `list_stock_levels`, `open_shift`, `close_shift` mocks to `handlers/inventory.ts` & `handlers/shifts.ts`.
  - `inventory.ts` — **44** handlers: `adjust_stock` (+`_scoped`), inventory
    locations, stock alerts, `start_inventory_shift`…`list_inventory_shifts`,
    `create_inventory_transaction`, stock thresholds, stock counts, stock
    transfers. **Self-contained**: reads one seed fixture, exports a plain map,
    needs no injection.
  - `shifts.ts` — **11** handlers: `open_shift`, `close_shift`, `list_shifts`,
    `get_shift_report`, `create_cash_payout`. The shift state cluster moved with
    it; every outside reference was its own declaration, so no injection.
  - There is no `list_stock_levels` command in the mock — the real stock surface
    is `adjust_stock`, `get_product_stock` (catalog, 2.1) and the
    stock-count/transfer commands. Same class of dead name as `get_tax_rules`
    in 2.1; substitutions recorded in the module headers.
  - Two interleavings ruled on: `finalize_sale`/`void_pending_sale` sat inside
    the inventory block but belong to sales; `adjust_stock` sat inside the
    catalog block but belongs to inventory.
- [x] Verify: `npm run typecheck`.
  - Clean for every touched file. The same two pre-existing
    `WorkspaceHome.tsx` errors persist (another workstream), so this commit
    also used `OZPOS_SKIP_TYPECHECK=1` after running `tsc` by hand; the tripwire
    recorded it.
  - Key-set equivalence asserted mechanically: router 441 → **344**;
    `inventory(44) + shifts(11) + sales(42) == 441` exactly. All **513** distinct
    moved lines reappear verbatim (4 documented intentional edits exempted:
    `CartLine` exported, `holdMockCart` parameterised, and its two entries).
  - Full UI suite green: 554 files / 9,477 passed / 0 failed.
- [x] **Commit Milestone:**
  ```bash
  git add -- ui/src/dev-mock/handlers/sales.ts ui/src/dev-mock/handlers/inventory.ts ui/src/dev-mock/handlers/shifts.ts && git commit -m "refactor(devmock-ops): extract sales, shifts, and inventory mock handlers" -- ui/src/dev-mock/handlers/sales.ts ui/src/dev-mock/handlers/inventory.ts ui/src/dev-mock/handlers/shifts.ts ui/src/dev-mock/tauri-api.ts
  ```
  - `tauri-api.ts` 4,664 → **3,905** lines. `sales.ts` is a factory because
    `unwrapArgs`/`mockHandlerPayload` cannot be imported back (cycle), and
    `pushKdsOrderFromCart` is injected whole because it closes over
    `kdsDisplayCounter`, a module-level scalar — injecting the KDS state would
    capture the counter by value and silently drop every increment.

> **Coverage gap — needs a decision before the end-state can be reached.**
> Phase 2.1 + 2.2 + agent 3's fences cover roughly 305 of the original 501
> entries. The other ~196 have **no assigned owner**: kds/loyalty/gift/promo
> (~84) and an unclassified tail (~112) covering device binding, subscription,
> the setup wizard, orgs, version, IP and screens. A fourth workstream is
> needed for those. The `< 200 lines` end-state is **unreachable** as the three
> work orders are currently written — the arithmetic does not close.
