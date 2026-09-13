# Orchestrator Agent 4: Services & Platform Mocks (KDS, Loyalty, Payment, CRM, Floorplan, Analytics, Locations & System)

**Document:** `todo-refactor-devmock-agents-4.md`
**Role:** Orchestrator Agent 4 (Services & Platform Mock Domain Architect)
**Goal:** Extract KDS, loyalty / gift / promotion, payment, CRM, floorplan, analytics, locations, and system / platform mocks from `ui/src/dev-mock/tauri-api.ts` into isolated domain handler modules. Close the coverage gap so that `tauri-api.ts` can reach the < 200-line end-state once Agent 2 removes its remaining leftovers.

**Target File:** `ui/src/dev-mock/tauri-api.ts`
**Sibling Documents:**
- [`todo-refactor-devmock-agents-1.md`](./todo-refactor-devmock-agents-1.md) (Agent 1 — Dev-Mock Storage Core & Seeding Engine)
- [`todo-refactor-devmock-agents-2.md`](./todo-refactor-devmock-agents-2.md) (Agent 2 — Operational Mocks: Sales, Inventory & Catalog)
- [`todo-refactor-devmock-agents-3.md`](./todo-refactor-devmock-agents-3.md) (Agent 3 — Enterprise Mocks: Staff, Workspaces, Topology & Settings)

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Communication happens strictly through the Git commit history and durable commit subjects.
2. **Commit Subject Convention:**
   - All commits made by Agent 4 MUST use:
     - `refactor(devmock-services): ...`
3. **Owned Path Fence (Exclusive to Agent 4):**
   - `ui/src/dev-mock/handlers/kds.ts` (NEW)
   - `ui/src/dev-mock/handlers/loyalty.ts` (NEW)
   - `ui/src/dev-mock/handlers/payment.ts` (NEW)
   - `ui/src/dev-mock/handlers/analytics.ts` (NEW)
   - `ui/src/dev-mock/handlers/crm.ts` (NEW)
   - `ui/src/dev-mock/handlers/floorplan.ts` (NEW)
   - `ui/src/dev-mock/handlers/locations.ts` (NEW)
   - `ui/src/dev-mock/handlers/system.ts` (NEW)
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit mock storage engine in `ui/src/dev-mock/core/` (Owned by Agent 1).
   - DO NOT edit operational command mocks in `ui/src/dev-mock/handlers/{sales,inventory,catalog,shifts}.ts` (Owned by Agent 2).
   - DO NOT edit enterprise command mocks in `ui/src/dev-mock/handlers/{staff,workspaces,topology,settings}.ts` (Owned by Agent 3).
5. **Git Dependency Waiting Protocol:**
   - Agent 4 can create and test the eight new modules independently.
   - Before Phase 4.5 (final cleanup of `tauri-api.ts`), verify that Agent 2 and Agent 3 have committed their phases:
     ```powershell
     git log -n 50 --oneline --grep="refactor(devmock-ops):"
     git log -n 50 --oneline --grep="refactor(devmock-enterprise):"
     ```
   - Agent 2 still has ~12 leftover entries in `tauri-api.ts` (bundle CRUD and a few inventory / shift stubs) that sit inside Agent 2's fence and were not extracted in phases 2.1–2.2. These MUST be extracted by Agent 2 before the < 200-line end-state is reachable. Agent 4 must NOT touch them.

---

## 📋 Task Checklist

### Phase 4.0: Baseline Audit
- [ ] Map the remaining unowned command strings in `tauri-api.ts` by domain.
  - Exact counts measured at 06:44 on 2026-09-13 against commit `efd766226`:
    - **KDS** — ~23 entries (`kds_*`, `kitchen_*`, `create_kds_order_from_sale`, `get_kds_order_lines`, `update_kds_line_item_status`)
    - **Loyalty / Gift / Promo** — ~44 entries (`loyalty_*`, `member_*`, `reward_*`, `points_*`, `gift_*`, `voucher_*`, `coupon_*`, `promo_*`, `discount_*`, `campaign_*`, `get_promotion*`, `create_promotion*`, `update_promotion*`, `delete_promotion*`, `apply_promotion*`)
    - **Payment** — ~30 entries (`payment_*`, `card_*`, `terminal_*`, `edc_sale`, `edc_refund`, `edc_void`, `list_credit_sales*`, `settle_credit*`)
    - **Analytics & Reports** — ~22 entries (`analytics_*`, `report_*`, `get_top_products`, `get_category_popularity*`, `get_category_forecast`, `get_category_breakdown`, `get_daily_revenue`, `get_weekly_revenue`, `get_monthly_revenue`, `get_hourly_heatmap`, `get_menu_engineering`, `export_sales_by_hour*`, `export_daily_summary*`)
    - **CRM & Supply Chain** — ~25 entries (`list_customers*`, `get_customer`, `create_customer`, `update_customer`, `delete_customer`, `list_suppliers*`, `get_supplier*`, `create_supplier*`, `update_supplier*`, `list_purchase_orders*`, `get_purchase_order*`, `create_purchase_order*`, `update_po_status*`, `receive_purchase_order*`)
    - **Floorplan** — ~18 entries (`list_tables*`, `get_table*`, `create_table*`, `update_table*`, `delete_table*`, `update_table_status*`, `assign_table_order*`, `release_table*`, `list_sections*`)
    - **Locations & Administration** — ~23 entries (`list_locations*`, `get_location_profile*`, `get_primary_location*`, `create_location_profile*`, `update_location_profile*`, `set_primary_location*`, `delete_location_profile*`, `get_location_ticket_prefix*`, `set_location_ticket_prefix*`, `list_legal_entities*`, `get_legal_entity*`, `create_legal_entity*`, `update_legal_entity*`, `get_regional_config*`, `set_regional_config*`, `list_active_memos*`, `acknowledge_memo*`, `create_memo*`, `publish_memo*`, `stop_memo*`, `revise_memo*`, `get_cart_deduction_location`, `override_cart_deduction_location*`)
    - **System & Platform** — ~65 entries (sessions, features, branding, org, subscription, version, IP, document numbers, fiscal schemes, hardware, backup, export/import, audit, remote failures, deployment, setup, screen, bootstrap, machine fingerprint, offline queue)
  - **Agent 2 leftovers** (~12 entries inside Agent 2's fence, NOT owned by Agent 4): bundle CRUD (`list_bundles*`, `get_bundle*`, `create_bundle*`, `update_bundle*`, `delete_bundle*`, `lookup_bundle_by_sku*`), low-stock alert, cash drawer. These MUST be extracted by Agent 2 in a follow-up phase.
  - **Agent 3 scope** (~88 entries inside Agent 3's fence, NOT owned by Agent 4): staff / auth / roles (27), workspace (12), topology (6), settings (43).
  - *Note:* the above counts are approximate because some command names cross domains (e.g. `print_sales_receipt` is settings, `list_role_holders_scoped` is staff). The baseline audit will reclassify each entry exactly before carving.

### Phase 4.1: Extract KDS & Loyalty Mocks
- [x] Move KDS command surface to `handlers/kds.ts`.
  - Done as commit `ba557c54a`. **17** literal entries + 5 state blocks + 3 out-of-literal patches.
  - `kdsDisplayCounter` exported as mutable wrapper object `{ value: number }` so the
    router's `pushKdsOrderFromCart` can increment it without violating ES-module
    import immutability. `mockKdsOrders`, `mockKdsLineItems`, `saveMockKdsState`
    also exported for the router. `MEMO_CADENCE` was mistakenly swept in by the
    `kds` keyword heuristic and was returned to the router.
- [x] Move loyalty, gift card, voucher, coupon, and promotion command surface to `handlers/loyalty.ts`.
  - Done as commit `2d2da4ba6` (phase 4.1+4.3 combined). **34** entries, no state cluster — all stubs.
  - Self-contained plain map; zero deps.
- [x] Verify: `npm run typecheck` — clean (only pre-existing `WorkspaceHome.tsx` errors).
- [x] **Commit Milestone:**
  ```bash
  git commit -m "refactor(dev-mock): extract KDS handlers to kds.ts"
  ```

### Phase 4.2: Extract Payment & Analytics Mocks
- [x] Move payment command surface to `handlers/payment.ts`.
  - Done as commit `2d0e064c5` (phase 4.2 payment half). **34** entries, state cluster moved
    (`mockLocalPaymentRails`, `getMockLocalPaymentMethods`, `setMockLocalPaymentMethods`).
  - Factory module: `getMockLocalPaymentMethods` and `setMockLocalPaymentMethods` need
    `unwrapArgs` (router helper), so they are parameterised and injected. `mockStores`
    cross-dependency simplified to `MOCK_STORE` fallback — the lookup was location-domain
    state that has not yet been extracted.
- [x] Move analytics, revenue, and report command surface to `handlers/analytics.ts`.
  - Done as commit `9f0b61043`. **22** entries, `getMockOverQuotaReport` and `mockRevenue`
    state functions moved. `isoDays` helper also moved (was only used by analytics).
    `handlers` registry imported from `mockDispatcher` for `get_category_forecast` which
    calls `get_category_popularity_trend` internally. `MOCK_PRODUCTS` and `MOCK_CATEGORIES`
    imported from catalog/seed data.
- [x] Verify: `npm run typecheck` — clean (only pre-existing `WorkspaceHome.tsx` errors).
- [x] **Commit Milestone:**
  ```bash
  git commit -m "refactor(dev-mock): extract analytics handlers to analytics.ts"
  ```

### Phase 4.3: Extract CRM & Floorplan Mocks
- [x] Move customer, supplier, and purchase-order command surface to `handlers/crm.ts`.
  - Done as commit `2d2da4ba6`. **25** entries, `MOCK_CUSTOMERS` fixture moved and
    re-exported for the router's in-place patches (`search_customers_scoped`,
    `get_customer_history_scoped`).
- [x] Move table, section, and floor-plan command surface to `handlers/floorplan.ts`.
  - Done as commit `2d2da4ba6`. **18** entries, `tablesSnapshot` moved.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(devmock-services): extract crm and floorplan mock handlers"
  ```

### Phase 4.4: Extract Locations & System Mocks
- [ ] Move location, legal-entity, regional-config, and memo command surface to `handlers/locations.ts`.
- [ ] Move session, feature, branding, org, hardware, backup, audit, and system command surface to `handlers/system.ts`.
- [ ] Verify: `npm run typecheck`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(devmock-services): extract locations and system mock handlers"
  ```

### Phase 4.5: Final Cleanup
- [ ] *Wait Gate:* Verify Agent 2 has extracted its ~12 leftover entries and Agent 3 has committed `refactor(devmock-enterprise):`.
- [ ] Reduce `ui/src/dev-mock/tauri-api.ts` to a clean entry router registering only the domain handler maps.
- [ ] Target: literal entries < 40, total file < 200 lines.
- [ ] Run full UI tests: `npm run test` and `npm run check:all`.
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(devmock-services): reduce tauri-api.ts to router root"
  ```

> **Arithmetic check.**
> Original literal: 501 entries. Current literal: **194** entries.
> Extracted so far: 2.1 (–60) + 2.2 (–97) + loyalty (–34) + floorplan (–18) + CRM (–25) + payment (–34) + KDS (–17) + analytics (–22) = 307 removed.
> Remaining: agent 3 (–100) + agent 2 leftovers (–14) + locations (~–19) + system (~–59) = 192.
> The 2-entry gap (194 vs 192) is the unclassified tail. After all extractions and cleanup,
> < 200 lines is reachable.
>
> `tauri-api.ts` currently **2,660** lines (was 3,905).
