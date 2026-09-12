# Orchestrator Agent 2: Operational Mocks (Sales, Inventory & Catalog)

**Document:** `todo-refactor-devmock-agents-2.md`  
**Role:** Orchestrator Agent 2 (Operational Mock Domain Architect)  
**Goal:** Extract sales, checkout, cart holding, inventory levels, stock adjustments, products, bundles, taxes, and shift command mocks from `ui/src/dev-mock/tauri-api.ts` into isolated domain handler modules.

**Target File:** `ui/src/dev-mock/tauri-api.ts`  
**Sibling Documents:**
- [`todo-refactor-devmock-agents-1.md`](./todo-refactor-devmock-agents-1.md) (Agent 1 — Dev-Mock Storage Core & Seeding Engine)
- [`todo-refactor-devmock-agents-3.md`](./todo-refactor-devmock-agents-3.md) (Agent 3 — Enterprise Mocks: Staff, Workspaces, Topology & Settings)

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

### Phase 2.0: Baseline Audit
- [x] Map all sales, inventory, and catalog command strings in `tauri-api.ts`.
  - Literal spans lines 2626–4781 and holds **501 entries** (span-verified: the
    entries tile the literal exactly, zero gap lines). Domain split: catalog 60,
    sales/cart ~150, inventory ~30, shifts ~20; the remaining ~196 have no
    assigned owner yet (see the note under Phase 2.2).

### Phase 2.1: Extract Catalog & Tax Mocks
- [x] Move `list_products`, `create_product`, `lookup_by_barcode`, `list_categories`, `get_tax_rules` mocks to `handlers/catalog.ts`.
  - Done as commit `6105ce224`. **60** handlers moved, not 5: products (21),
    variants (10), categories (5), currency + exchange rates (15), tax (9).
    There is no `get_tax_rules` command in the mock — the tax domain is
    `list_tax_rates_scoped` + the four sibling tax-rate commands.
  - `tauri-api.ts` 4,991 → 4,664 lines; the literal drops 501 → 441 entries.
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
  git commit -m "refactor(devmock-ops): extract catalog and tax mock handlers"
  ```

### Phase 2.2: Extract Sales, Checkout & Inventory Mocks
- [ ] Move `start_sale`, `add_line`, `complete_sale`, `hold_cart`, `list_open_bills` mocks to `handlers/sales.ts`.
- [ ] Move `adjust_stock`, `list_stock_levels`, `open_shift`, `close_shift` mocks to `handlers/inventory.ts` & `handlers/shifts.ts`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(devmock-ops): extract sales, shifts, and inventory mock handlers"
  ```

> **Coverage gap — needs a decision before the end-state can be reached.**
> Phase 2.1 + 2.2 + agent 3's fences cover roughly 305 of the original 501
> entries. The other ~196 have **no assigned owner**: kds/loyalty/gift/promo
> (~84) and an unclassified tail (~112) covering device binding, subscription,
> the setup wizard, orgs, version, IP and screens. A fourth workstream is
> needed for those. The `< 200 lines` end-state is **unreachable** as the three
> work orders are currently written — the arithmetic does not close.
