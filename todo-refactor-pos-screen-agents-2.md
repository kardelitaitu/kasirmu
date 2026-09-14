# Orchestrator Agent 2: Cart UI Panels, Modals & Peripherals

<!-- Audit stamp: 2026-09-14 · DSH · status: SUPERSEDED-BY-EXECUTION (the plan largely landed; its baselines and one path claim are wrong) · corrections applied: 8 · Every "NEW" component in the path fence already exists and `PosScreen.tsx` is 1,247 lines, not the 2,329→<600 this doc plans against — found by measuring each named path on disk with `wc -l` and `grep` rather than trusting the cbm graph index, whose `oz-pos` project points at a different worktree (`C:/dev/ozpos/0.0.35/oz-pos`). -->

**Document:** `todo-refactor-pos-screen-agents-2.md`  
**Role:** Orchestrator Agent 2 (UI Decomposition & Peripheral Wiring)  
**Goal:** Extract large JSX sub-trees from `PosScreen.tsx` (cart line items, totals footer, action bar, promotions modal, price override modal, and hardware listeners) into modular presentation components. Reduce `PosScreen.tsx` into a thin composition root.

> 📌 **Path correction (2026-09-14):** the target is `ui/src/features/sales/PosScreen.tsx`. There is **no** `ui/src/features/pos/` directory — the POS screen lives in the `sales` feature and is registered lazily at `ui/src/features/sales/register.tsx:6`, on routes `sales` and `pos` (`register.tsx:15-16`).

**Target File:** `ui/src/features/sales/PosScreen.tsx` — measured 2026-09-14: **1,247 lines** (`wc -l ui/src/features/sales/PosScreen.tsx`; the read tool's `totalLines` reports 1,247 too, and a split-on-newline count reports 1,248 — that ±1 is a method artifact, not a doc error). HEAD `ec2edf258` matches the working tree for this file.  
**Sibling Documents:**
- `done-todo-refactor-pos-screen-agents-1.md` (Agent 1 — Cart Engine & State Architect) — **FINISHED**; cited by bare name with no `./` prefix: retired under the `done-todo-` convention (its only root commit is `238912974`; `git log -- todo-refactor-pos-screen-agents-1.md` under the old name is empty, so there is **no rename event to cite for this file**, and `94b5da2cc`, which renamed other work orders, never touched it), and one clause only: a separate session has an *uncommitted, in-flight* move of retired work orders out of the repo root, which is why no path is written here.
- [`todo-refactor-pos-screen-agents-3.md`](./todo-refactor-pos-screen-agents-3.md) (Agent 3 — PaymentModal & Split Tenders Deconstruction)

> ⚠️ **Scope gap found by the audit:** `PosScreen.tsx` is not the only POS screen. The `store-pos` workspace renders `ui/src/features/retail/RetailPosScreen.tsx` (**1,808 lines**) — `ui/src/frontend/shell/AppShell.tsx:36,:519,:551` and `ui/src/frontend/shell/tablet/TabletAppShell.tsx:19,:173` — which owns its own `RetailCartPanel.tsx` and is untouched by this plan. The "reduce to a composition root" goal below therefore covers the sales/restaurant POS only.

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Communication happens strictly through the Git commit history and durable commit subjects.
2. **Commit Subject Convention:**
   - All commits made by Agent 2 MUST use:
     - `refactor(pos-ui): ...` — the three commits that executed this plan do (`ceace1a63`, `5a0e87a22`, `dc148cb73`).
3. **Owned Path Fence (Exclusive to Agent 2):** — *all five exist; nothing here is NEW any more*
   - `ui/src/features/sales/components/CartPanel.tsx` ✅ 609 lines — created by `dc148cb73`
   - `ui/src/features/sales/components/CartLineItem.tsx` ✅ 196 lines — created by `ceace1a63`
   - `ui/src/features/sales/components/CartFooterTotals.tsx` ✅ 340 lines — created by `5a0e87a22`
   - `ui/src/features/sales/components/CartActionBar.tsx` ✅ 87 lines — created by `5a0e87a22`
   - `ui/src/features/sales/components/CourseSelectorBar.tsx` ✅ 53 lines — created by `ceace1a63`
   - *JSX Render Tree only* in `ui/src/features/sales/PosScreen.tsx` — that tree is now **`:696`–`:1,247`**, not "Lines 800+".
   - *Also in that directory, added outside this plan:* `components/CartTaxWatcher.tsx` (34 lines, `dffe250a5`) and `components/ItemModifierModal.tsx` (420 lines).
4. **Forbidden Paths (Owned by Siblings):**
   - ~~DO NOT edit state hooks or calculation logic at the top of `PosScreen.tsx` (Owned by Agent 1).~~ **Moot as written** — Agent 1's extraction landed, so that logic no longer lives at the top of the file. It is now `usePosState.ts` (342), `useBarcodeScanner.ts` (131), `useCustomerDisplay.ts` (119), `hooks/usePosShifts.ts` (197), `hooks/usePosHeldCarts.ts` (173), `hooks/usePosCartActions.ts` (273), `utils/cartCalculations.ts` (41) and `posScreenHooks.ts` (302). The rule still binds: those files remain Agent 1's fence.
   - DO NOT edit `PaymentModal.tsx` (Owned by Agent 3). — still present at `ui/src/features/sales/PaymentModal.tsx`, 2,436 lines.
5. **Git Dependency Waiting Protocol:** — **SATISFIED: the gate was waiting on finished work.**
   - Before Phase 2.3, verify Agent 1 has committed hook extractions:
     ```powershell
     git log -n 50 --oneline --grep="refactor(pos-cart): extract cart line manipulations"
     # 85adf2e49 refactor(pos-cart): extract cart line manipulations into usePosCartActions hook
     ```
   - Companion commits: `c24904a7a` (complete the extraction), `dffe250a5` (cart calculations + `CartTaxWatcher`), `a00a964ee` (`usePosShifts`), `b0fff0209` (`usePosHeldCarts`) — all dated 2026-09-11.
   - `PosScreen.tsx:37-42` already imports `usePosState`, `useBarcodeScanner`, `useCustomerDisplay`, `usePosShifts`, `usePosHeldCarts`, `usePosCartActions`: the delegation this gate existed to wait for.
   - The fall-back instruction ("create and test components first, before replacing markup") is likewise spent — those components are in place and wired.

---

## 📋 Task Checklist

### Phase 2.0: Component Seam Planning
- [x] ~~Inspect lines 1,000–2,300 of `PosScreen.tsx`~~ → **range is stale.** It describes a ~2,329-line file; 2,329 was real (`fa9a6eba8`, `d8bdf07ea`, 2026-08-21/29) but the file was already **2,462** lines at this document's own commit (`1af143f23`, 2026-09-10), and is **1,247** today. The JSX render tree now runs `PosScreen.tsx:696`–`:1,247`.
- [x] Identify component boundaries — **each of the four has become a file:**
  - Line items list (`<div role="group">`) → `components/CartLineItem.tsx`; class `cart-panel-line-item` at `CartLineItem.tsx:103`.
  - Course selection bar → `components/CourseSelectorBar.tsx`.
  - Totals calculation display → `components/CartFooterTotals.tsx`.
  - Bottom action rack (Pay, Hold, Discount, Clear) → `components/CartActionBar.tsx`.

### Phase 2.1: Extract Cart Line Items & Course Bar — ✅ DONE (`ceace1a63`, 2026-09-11)
- [x] Extract `<CartLineItem />` component into `components/CartLineItem.tsx` (196 lines; consumed at `CartPanel.tsx:15`).
  - Props: line data, item index, selection, handlers for qty +/-/remove/course change.
  - ~~Maintain exact CSS classes (`CartPanelLineItem.css`) and ARIA labels.~~ → **Correction, and a live defect:** `CartPanelLineItem.css` exists but stayed at `ui/src/features/sales/CartPanelLineItem.css` — it did not move with the component, and `CartLineItem.tsx` imports **no** CSS at all. The stylesheet is side-effect-loaded by the parent at `PosScreen.tsx:51`, so the extracted child renders unstyled if `PosScreen` drops that import. Same pattern for `CartPanelFooterTotals.css` (`:52`), `CartPanelActions.css` (`:53`), `CartPanel.brand.css` (`:54`), `CartPanelCourseBar.css` (`:55`). ARIA-label coverage was not re-checked by this audit — unverified.
- [x] Extract `<CourseSelectorBar />` into `components/CourseSelectorBar.tsx` (53 lines; `CartPanel.tsx:16`).
- [x] Replace inline JSX in `PosScreen.tsx` — imported at `PosScreen.tsx:34`, rendered at `:709`.
- [ ] Verify: `npm run test` and `npm run typecheck`. — **NOT RUN by this audit.** Test surface only was measured: `ui/src/__tests__/CourseSelectorBar.test.tsx` exists; no test file for `CartPanel`, `CartLineItem`, `CartFooterTotals` or `CartActionBar` was found (screen-level coverage sits in `PosScreen.test.tsx`, `PosScreen.integration.test.tsx`, `PosScreenCoreFlow.test.tsx`).
- [x] **Commit Milestone:** landed as `ceace1a63 refactor(pos-ui): extract CartLineItem and CourseSelectorBar presentation components`.
  ```bash
  git commit -m "refactor(pos-ui): extract CartLineItem and CourseSelectorBar presentation components"
  ```

### Phase 2.2: Extract Cart Footer Totals & Action Rack — ✅ DONE (`5a0e87a22`, 2026-09-11)
- [x] Extract `<CartFooterTotals />` into `components/CartFooterTotals.tsx` (340 lines; `CartPanel.tsx:17`).
  - Displays subtotal, discounts, tax estimate badge, tips, and grand total. — the tax badge actually lives in `components/CartTaxWatcher.tsx` (imported at `PosScreen.tsx:33`); tip/service-charge values are passed down from `PosScreen`. The line-by-line contents of `CartFooterTotals.tsx` were **not** re-verified by this audit.
- [x] Extract `<CartActionBar />` into `components/CartActionBar.tsx` (87 lines; `CartPanel.tsx:18`).
  - Buttons: Pay, Hold Bill, Recall, Discount, Clear Cart. — **not re-verified** against the file's actual button set; recorded as unverified.
- [x] Replace inline JSX in `PosScreen.tsx` (via `<CartPanel />`).
- [ ] Verify: `npm run test` and `npm run typecheck`. — **NOT RUN by this audit.**
- [x] **Commit Milestone:** landed as `5a0e87a22 refactor(pos-ui): extract CartFooterTotals and CartActionBar components`.
  ```bash
  git commit -m "refactor(pos-ui): extract CartFooterTotals and CartActionBar components"
  ```

### Phase 2.3: Assemble `<CartPanel />` Container & Final Shell Reduction — 🟡 PARTLY DONE
- [x] *Wait Gate:* satisfied — `85adf2e49` (+ completion `c24904a7a`) is on `main`.
- [x] Create `components/CartPanel.tsx` combining line items, course bar, totals and action bar (`dc148cb73`, 609 lines). — *"standalone collapsible/resizable panel"* is only partly true: width state and the resize handle are still owned by the parent (`clampCartWidth`, `CART_WIDTH_DEFAULT` imported at `PosScreen.tsx:35`; `startResize`/`cartPanelRef`/`cartWidth` passed in at the `<CartPanel` call starting `PosScreen.tsx:709`).
- [x] Reduce `PosScreen.tsx` to orchestrating:
  - Left panel: Catalog / Restaurant Menu / Table Management — imports at `PosScreen.tsx:14` (`ProductLookupScreen`), `:15` (`RestaurantMenu`), `:18` (`TableManagementScreen`), switched on `activeWorkspace` inside the render tree that starts at `:696`.
  - Right panel: `<CartPanel />` — `:34`, rendered `:709`.
  - Overlays / Modals: `<PaymentModal />` `:43` / rendered `:800`; `<PriceOverrideModal />` `:44` / `:822`; `<PromotionsModal />` `:45` / `:832`.
- [ ] **Verify line count in `PosScreen.tsx` dropped from 2,329 to < 600 lines.** → **Target MISSED, baseline stale.** Actual: **1,247 lines**. The reduction really happened — 2,462 (`1af143f23` era) → 1,858 (`ceace1a63`) → 1,592 (`5a0e87a22`) → 1,247 (`dc148cb73`) — but it stopped near half, not below 600. This is open work again, not a verification step.
- [ ] Verify all tests green: `npm run check:all`. — **NOT RUN by this audit.**
- [x] **Commit Milestone:** landed as `dc148cb73 refactor(pos-ui): consolidate CartPanel and reduce PosScreen to composition root`.
  ```bash
  git commit -m "refactor(pos-ui): consolidate CartPanel and reduce PosScreen to composition root"
  ```

---

## 🧭 Remaining Work (re-scoped by the 2026-09-14 audit)

1. Take `PosScreen.tsx` from 1,247 to the planned < 600: the surviving bulk is workspace/overlay wiring and the resize plumbing `CartPanel` still borrows from its parent.
2. Move `CartPanel*.css` next to (or into) the components that use it, replacing the side-effect imports at `PosScreen.tsx:50-55`.
3. Add component tests for `CartPanel`, `CartLineItem`, `CartFooterTotals`, `CartActionBar` — only `CourseSelectorBar` has one.
4. Decide whether `RetailPosScreen.tsx` (1,808 lines, the tablet/desktop `store-pos` POS) joins this campaign or needs its own plan.

> last audited 2026-09-14 by DSH (docs-auditor)
