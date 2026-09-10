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
- [ ] Map all sales, inventory, and catalog command strings in `tauri-api.ts`.

### Phase 2.1: Extract Catalog & Tax Mocks
- [ ] Move `list_products`, `create_product`, `lookup_by_barcode`, `list_categories`, `get_tax_rules` mocks to `handlers/catalog.ts`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
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
