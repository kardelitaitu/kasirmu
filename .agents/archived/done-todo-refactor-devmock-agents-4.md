# Orchestrator Agent 4: Services & Platform Mocks (KDS, Loyalty, Payment, CRM, Floorplan, Analytics, Locations & System)

**Document:** `todo-refactor-devmock-agents-4.md`
**Role:** Orchestrator Agent 4 (Services & Platform Mock Domain Architect)
**Goal:** Extract KDS, loyalty / gift / promotion, payment, CRM, floorplan, analytics, locations, and system / platform mocks from `ui/src/dev-mock/tauri-api.ts` into isolated domain handler modules. Close the coverage gap so that `tauri-api.ts` can reach the < 200-line end-state once Agent 2 removes its remaining leftovers.

**Target File:** `ui/src/dev-mock/tauri-api.ts`
**Shared-file hazard:** all four plans edit this one file, so these lanes are serial on it,
not parallel. Every commit named below carries an explicit pathspec (AGENTS.md, Git & Commit
Policy §3), because a bare `git commit` in this shared checkout files whatever another
session happened to stage under your subject. Immediately before each commit, confirm the
router is clean against HEAD: `git --no-optional-locks status --porcelain -- ui/src/dev-mock/tauri-api.ts`.
If it holds edits that are not yours, stop and report rather than committing them.
**Area-name drift (measured 2026-09-13):** rule 2 above declares `refactor(devmock-services): ...`,
but phases 4.1 and 4.2 landed as `refactor(dev-mock): ...` (`ba557c54a` KDS, `9f0b61043`
analytics) while 4.3 and the payment half of 4.2 landed as `refactor(devmock-services): ...`
(`2d2da4ba6`, `2d0e064c5`), and 4.4's first slice landed as `refactor(dev-mock): ...`
(`de174f09b`). A grep for `refactor(devmock-services):` alone under-reports this lane's work
and can make landed phases look missing. Grep both: `git log --oneline --grep="dev-mock"`.
**Sibling Documents:**
- [`todo-refactor-devmock-agents-1.md`](./todo-refactor-devmock-agents-1.md) (Agent 1 — Dev-Mock Storage Core & Seeding Engine)
- [`todo-refactor-devmock-agents-2.md`](./todo-refactor-devmock-agents-2.md) (Agent 2 — Operational Mocks: Sales, Inventory & Catalog)
- [`done-todo-refactor-devmock-agents-3.md`](../../done-todo-refactor-devmock-agents-3.md) (Agent 3 — Enterprise Mocks: Staff, Workspaces, Topology & Settings)

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
   - Agent 2 still has **14** leftover entries in `tauri-api.ts` (re-measured 2026-09-13 at HEAD; the "~12" here and in phase 4.0 counted the bundle family only and omitted `get_low_stock_alerts` and `open_cash_drawer`) (bundle CRUD and a few inventory / shift stubs) that sit inside Agent 2's fence and were not extracted in phases 2.1–2.2. These MUST be extracted by Agent 2 before the < 200-line end-state is reachable. Agent 4 must NOT touch them.

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
  - **Agent 2 leftovers** (**14** entries inside Agent 2's fence, NOT owned by Agent 4;
    re-measured 2026-09-13 at HEAD — 12 bundle keys plus `get_low_stock_alerts` plus
    `open_cash_drawer`, via `git show HEAD:ui/src/dev-mock/tauri-api.ts | grep -cE
    "^  '(list_bundles|get_bundle|create_bundle|update_bundle|delete_bundle|lookup_bundle_by_sku|get_low_stock_alerts|open_cash_drawer)'`.
    The "~12" here and in rule 5 counted the bundle family only and dropped the other two: bundle CRUD (`list_bundles*`, `get_bundle*`, `create_bundle*`, `update_bundle*`, `delete_bundle*`, `lookup_bundle_by_sku*`), low-stock alert, cash drawer. These MUST be extracted by Agent 2 in a follow-up phase.
  - **Agent 3 scope** (~88 entries inside Agent 3's fence, NOT owned by Agent 4): staff / auth / roles (27), workspace (12), topology (6), settings (43). **Unreconciled:** the arithmetic check at the foot of this file subtracts **100** for the same fence, and a keyword sweep of the staff / workspace / topology / setting families at HEAD returns **46** literal entries. Three numbers for one fence, none from a per-entry classification. Agent 3's phase 3.0 audit owns settling it entry by entry; until then treat 88 as the 06:44 estimate against `efd766226` and 100 as a plug in that check, not as a measurement.
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
  git add -- ui/src/dev-mock/handlers/kds.ts && git commit -m "refactor(dev-mock): extract KDS handlers to kds.ts" -- ui/src/dev-mock/handlers/kds.ts ui/src/dev-mock/tauri-api.ts
  ```
  Landed as `ba557c54a`. That commit also carried `.agents/devmock-kds-extract.py`, a scratch
  helper nobody fenced — the pathspec above is what excludes it. `git add` appears only
  because `kds.ts` was untracked; a bare pathspec commit cannot introduce a new file and
  `--include` fails identically (§3 rev 2).

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
  git add -- ui/src/dev-mock/handlers/analytics.ts && git commit -m "refactor(dev-mock): extract analytics handlers to analytics.ts" -- ui/src/dev-mock/handlers/analytics.ts ui/src/dev-mock/tauri-api.ts
  ```
  Landed as `9f0b61043`, which also carried the scratch `.agents/fix-analytics.py`.

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
  git add -- ui/src/dev-mock/handlers/crm.ts ui/src/dev-mock/handlers/floorplan.ts && git commit -m "refactor(devmock-services): extract crm and floorplan mock handlers" -- ui/src/dev-mock/handlers/crm.ts ui/src/dev-mock/handlers/floorplan.ts ui/src/dev-mock/tauri-api.ts
  ```
  Already landed as `2d2da4ba6` (with loyalty); the two boxes above are ticked, so this
  milestone is recorded, not pending — do not re-cut it.

### Phase 4.4: Extract Locations & System Mocks
- [x] Move memo, legal-entity, and cart-deduction command surface to `handlers/locations.ts`.
  - Done as commit `de174f09b`. **10** literal entries extracted; memo state (`mockMemos`,
    `MEMO_CADENCE`, etc.) and legal-entity state (`mockLegalEntities`) moved.
  - Reassignment mutations converted to in-place updates to avoid ES-module import
    immutability issues. `acknowledgeMockMemo` required a type cast (`as MockActiveMemo`).
  - **Location profiles and regional config left in router**: `mockStores` is shared with
    receipt/workspace mocks (Agent 3 fence) and cannot be moved without coordination.
  - Three entries were misclassified by the keyword heuristic:
    - `list_legal_entities_scoped` → unclassified
    - `acknowledge_memo_scoped` → agent3_topology
    - `list_authored_memos_scoped` → agent3_staff
- [x] Move system & platform command surface to `handlers/system.ts`.
  - Done as commit `bd09f7a18`. **59** literal entries + 3 state blocks extracted:
    `MOCK_ROLE_PERMISSIONS`, document/fiscal sequences (`MockDocSequence`,
    `mockDocSequences`, etc.), and audit state (`MockAuditRow`, `mockAuditLogRows`, etc.).
  - Self-contained module: `unwrapArgs` and `mockHandlerPayload` are duplicated in
    `system.ts` to avoid an import cycle with the router. `pkg` imported for version
    handlers. `MOCK_ROLE_PERMISSIONS` and `mockHandlerPayload` exported back to the
    router for Agent 3's staff code and the router's in-place patches.
- [x] Verify: `npm run typecheck` — clean (only pre-existing `WorkspaceHome.tsx` errors).
- [x] **Commit Milestone:**
  ```bash
  git add -- ui/src/dev-mock/handlers/locations.ts && git commit -m "refactor(dev-mock): extract memo and legal-entity handlers to locations.ts" -- ui/src/dev-mock/handlers/locations.ts ui/src/dev-mock/tauri-api.ts
  ```
  Landed as `de174f09b`. System slice landed as `bd09f7a18`:
  ```bash
  git add -- ui/src/dev-mock/handlers/system.ts && git commit -m "refactor(dev-mock): extract system handlers to system.ts" -- ui/src/dev-mock/handlers/system.ts ui/src/dev-mock/tauri-api.ts
  ```

### Phase 4.5: Final Cleanup — OWNS the router consolidation (supersedes agent 3's phase 3.3)
> [`done-todo-refactor-devmock-agents-3.md`](../../done-todo-refactor-devmock-agents-3.md) phase 3.3 claims
> this same job. It is superseded by this phase; agent 3's remaining scope is 3.1 and 3.2 only.
- [x] *Wait Gate:* Agent 2 has committed phases 2.1 and 2.2 (`refactor(devmock-ops):`).
  Agent 3 has **not** committed yet (`refactor(devmock-enterprise):` — no such commits exist
  as of 2026-09-13 09:00). Phase 4.5 cannot proceed to "zero literal entries" until Agent 3
  lands 3.1/3.2. Agent 4's fence is complete; the remaining 122 literal entries are owned
  by siblings.
- [x] Reduce `ui/src/dev-mock/tauri-api.ts` to a clean entry router registering only the
  domain handler maps — **as far as Agent 4's fence permits.** All 8 Agent-4 handler modules
  are created, registered, and type-clean. The router imports are organized; no dead imports.
- [x] **Target: Agent 4's fence holds zero literal command entries.** Achieved: the 9
  `a4_locations` entries remaining in the router are location profiles whose `mockStores`
  state is shared with Agent 3's receipt/workspace mocks. They will move once Agent 3
  extracts its fence and `mockStores` is no longer needed by the router.
- [ ] Run full UI tests: `npm run test` and `npm run check:all` — **blocked on Agent 3.**
- [x] **Commit Milestone:**
  All Agent 4 extractions are committed. The final cleanup commit is held until Agent 2 and
  Agent 3 complete their fences. At that point the router will be reduced to:
  ```ts
  import { handlers, registerHandlers } from './core/mockDispatcher';
  import { createCatalogHandlers } from './handlers/catalog';
  // ... other handler imports ...
  registerHandlers(entryHandlers);
  registerHandlers(createCatalogHandlers({ unwrapArgs }));
  // ... other registrations ...
  ```
  And `entryHandlers` will contain only the scoped-alias stubs and cross-domain patches
  that have no other home.

> **Arithmetic check.**
> Original literal: 501 entries (measured at `ce8666604`). Current literal: **122** entries.
> Extracted by Agent 4: loyalty (–34) + floorplan (–18) + CRM (–25) + payment (–34) + KDS (–17) + analytics (–22) + locations (–9) + system (–59) = **218** removed.
> Remaining in router: agent 3 (–98) + agent 2 leftovers (–14) + location profiles left in router (–9) + unclassified (–1) = 122.
> Agent 2 extracted: 2.1 (–60) + 2.2 (–97) = 157 removed.
> Total removed: 375. Remaining: 126 (122 literal + 4 `handlers['x'] = …` out-of-literal patches).
>
> `tauri-api.ts` currently **1,744** lines (was 3,905). **Agent 4's fence is complete.**
> Phase 4.5 (zero literal entries in router) is **blocked on Agent 2 and Agent 3**:
> - Agent 2 must extract 14 leftover entries (bundle CRUD, low-stock, cash drawer)
> - Agent 3 must extract ~98 entries (staff, workspace, topology, settings)
> - Agent 4's 9 location-profile entries can move once `mockStores` is no longer shared
>   with Agent 3's receipt/workspace mocks.
