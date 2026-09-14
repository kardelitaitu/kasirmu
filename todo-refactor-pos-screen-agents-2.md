# Orchestrator Agent 2: Cart UI Panels, Modals & Peripherals

<!-- Audit stamp: 2026-09-14 · DSH · status: SUPERSEDED-BY-EXECUTION (the plan largely landed; its baselines and one path claim are wrong) · corrections applied: 8 · Every "NEW" component in the path fence already exists and `PosScreen.tsx` is 1,247 lines, not the 2,329→<600 this doc plans against — found by measuring each named path on disk with `wc -l` and `grep` rather than trusting the cbm graph index, whose `oz-pos` project points at a different worktree (`C:/dev/ozpos/0.0.35/oz-pos`). -->

**Document:** `todo-refactor-pos-screen-agents-2.md`  
**Role:** Orchestrator Agent 2 (UI Decomposition & Peripheral Wiring)  
**Goal:** Extract large JSX sub-trees from `PosScreen.tsx` (cart line items, totals footer, action bar, promotions modal, price override modal, and hardware listeners) into modular presentation components. Reduce `PosScreen.tsx` into a thin composition root.

> 📌 **Path correction (2026-09-14):** the target is `ui/src/features/sales/PosScreen.tsx`. There is **no** `ui/src/features/pos/` directory — the POS screen lives in the `sales` feature and is registered lazily at `ui/src/features/sales/register.tsx:6`, on routes `sales` and `pos` (`register.tsx:15-16`).

**Target File:** `ui/src/features/sales/PosScreen.tsx` — measured 2026-09-14: **1,247 lines** (`wc -l ui/src/features/sales/PosScreen.tsx`; the read tool's `totalLines` reports 1,247 too, and a split-on-newline count reports 1,248 — that ±1 is a method artifact, not a doc error). HEAD `ec2edf258` matches the working tree for this file.  
> 🧮 **Arithmetic of record (2026-09-14) — the acceptance criterion "`< 600`" is NOT reachable by the extractions this file names.** Baseline `wc -l ui/src/features/sales/PosScreen.tsx` = **1,247** (2026-09-14). The ranges below were read off the file at those line numbers (confirm each with `sed -n '841,884p' ui/src/features/sales/PosScreen.tsx`):
>
> | moves out | lines | anchor |
> |---|---|---|
> | inline modal 1 | 44 | `:841-884` |
> | inline modal 2 | 43 | `:886-928` |
> | inline modal 3 | 120 | `:930-1049` |
> | inline modal 4 | 105 | `:1051-1155` |
> | inline modal 5 | 69 | `:1157-1225` |
> | the five modals, subtotal | **381** | sum of the five rows |
> | keyboard nav | **87** | `:517-603` |
> | **total moved** | **468** | 381 + 87 |
>
> What moving all of it costs: **~55** new lines of call sites and **7** new lines of imports. `1,247 − 468 + 55 + 7 = 841` → **841**, a **−33%** reduction, not the −52% "`< 600`" implies. Even crediting an optimistic `<CartPanel />` call-site grouping (~−65) the floor is **~776**. Getting below 600 additionally requires editing the **640-line non-JSX body at `:56-695`**, which this file's OWN fence forbids (item 4 below: those are Agent 1's state/calc files, and Agent 1 is finished, so they are ownerless).
> **Interim gate agreed for wave 1: `<= 760 lines`** — a gate the named extractions can actually be measured against. The `< 600` line above stands as written and is superseded by this note, not erased.

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
     - **2026-09-14 note on every commit snippet in this file:** the snippets show the *subject* only and are left untouched as history. **Bare `git commit -m "..."` violates `AGENTS.md` §3** — the only permitted form is ONE line with an explicit pathspec: `git commit -m "<type>(<area>): <subject>" -- path/one path/two`. A **new** file cannot enter a commit in that form, so new components need the same-line chain: `git add -- new/one && git commit -m "<type>(<area>): <subject>" -- new/one`. This checkout has concurrent agents, so a bare commit consumes whatever someone else staged.
3. **Owned Path Fence (Exclusive to Agent 2):** — *all five exist; nothing here is NEW any more*
   - `ui/src/features/sales/components/CartPanel.tsx` ✅ 609 lines — created by `dc148cb73`
   - `ui/src/features/sales/components/CartLineItem.tsx` ✅ 196 lines — created by `ceace1a63`
   - `ui/src/features/sales/components/CartFooterTotals.tsx` ✅ 340 lines — created by `5a0e87a22`
   - `ui/src/features/sales/components/CartActionBar.tsx` ✅ 87 lines — created by `5a0e87a22`
   - `ui/src/features/sales/components/CourseSelectorBar.tsx` ✅ 53 lines — created by `ceace1a63`
   - *JSX Render Tree only* in `ui/src/features/sales/PosScreen.tsx` — that tree is now **`:696`–`:1,247`**, not "Lines 800+".
   - *Also in that directory, added outside this plan:* `components/CartTaxWatcher.tsx` (34 lines, `dffe250a5`) and `components/ItemModifierModal.tsx` (420 lines).
4. **Forbidden Paths (Owned by Siblings):**
   - ~~DO NOT edit state hooks or calculation logic at the top of `PosScreen.tsx` (Owned by Agent 1).~~ **Moot as written** — Agent 1's extraction landed, so that logic no longer lives at the top of the file. It is now `usePosState.ts` (342), `useBarcodeScanner.ts` (131), `useCustomerDisplay.ts` (119), `hooks/usePosShifts.ts` (197), `hooks/usePosHeldCarts.ts` (173), `hooks/usePosCartActions.ts` (273), `utils/cartCalculations.ts` (41) and `posScreenHooks.ts` (302). — *re-counted 2026-09-14: **303** lines (`wc -l ui/src/features/sales/posScreenHooks.ts`). Immaterial to the fence; recorded so the file's numbers stay exact.* The rule still binds: those files remain Agent 1's fence.
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
  - Line items list (`<div role="group">`) → `components/CartLineItem.tsx`; class `cart-panel-line-item` at `CartLineItem.tsx:103`. — **2026-09-14: FALSE on both counts, superseded.** `:103` is `data-testid="cart-panel-line-item"`, not a class; the className on that element is `pos-cart-line` at `:99` (`grep -n "className=\"\|data-testid=" ui/src/features/sales/components/CartLineItem.tsx`). And `cart-panel-line-item` appears **ZERO** times as a CSS selector — `grep -rn --include='*.css' cart-panel-line-item ui/src | wc -l` = 0 — it is only ever a test id (`PosScreenCoreFlow.test.tsx`, `PosScreen.integration.test.tsx`, `PosScreen.test.tsx` read it via `getByTestId`). Anything that re-styles "the line item" must target `.pos-cart-line` / `.pos-cart-line-wrap` (`:95`), not that string.
  - Course selection bar → `components/CourseSelectorBar.tsx`.
  - Totals calculation display → `components/CartFooterTotals.tsx`.
  - Bottom action rack (Pay, Hold, Discount, Clear) → `components/CartActionBar.tsx`. — **2026-09-14: the button list in this line is FALSE and is superseded.** `components/CartActionBar.tsx` renders **THREE** buttons — Clear at `:38`, Pay/Charge at `:54`, Open Bill at `:67` (`grep -n '<button' ui/src/features/sales/components/CartActionBar.tsx` returns exactly three hits: `:38`, `:54`, `:67`; the label text is `Clear` at `:49`, `<span>Charge</span>` at `:62`, and the `{/* Open Bill button */}` comment at `:66` above the `pos-cart-open-bill-btn` class at `:69`). **No hold / recall / discount button exists in that file** — `grep -c 'Hold\|Recall\|Discount' ui/src/features/sales/components/CartActionBar.tsx` = **0**. The four labels above stay visible as the point-in-time claim they were.

### Phase 2.1: Extract Cart Line Items & Course Bar — ✅ DONE (`ceace1a63`, 2026-09-11)
- [x] Extract `<CartLineItem />` component into `components/CartLineItem.tsx` (196 lines; consumed at `CartPanel.tsx:15`).
  - Props: line data, item index, selection, handlers for qty +/-/remove/course change.
  - ~~Maintain exact CSS classes (`CartPanelLineItem.css`) and ARIA labels.~~ → **Correction, and a live defect:** `CartPanelLineItem.css` exists but stayed at `ui/src/features/sales/CartPanelLineItem.css` — it did not move with the component, and `CartLineItem.tsx` imports **no** CSS at all. The stylesheet is side-effect-loaded by the parent at `PosScreen.tsx:51`, so the extracted child renders unstyled if `PosScreen` drops that import. Same pattern for `CartPanelFooterTotals.css` (`:52`), `CartPanelActions.css` (`:53`), `CartPanel.brand.css` (`:54`), `CartPanelCourseBar.css` (`:55`). ARIA-label coverage was not re-checked by this audit — unverified.
- [x] Extract `<CourseSelectorBar />` into `components/CourseSelectorBar.tsx` (53 lines; `CartPanel.tsx:16`).
- [x] Replace inline JSX in `PosScreen.tsx` — imported at `PosScreen.tsx:34`, rendered at `:709`.
- [ ] Verify: `npm run test` and `npm run typecheck`. — **NOT RUN by this audit.** Test surface only was measured: `ui/src/__tests__/CourseSelectorBar.test.tsx` exists; no test file for `CartPanel`, `CartLineItem`, `CartFooterTotals` or `CartActionBar` was found (screen-level coverage sits in `PosScreen.test.tsx`, `PosScreen.integration.test.tsx`, `PosScreenCoreFlow.test.tsx`).
  - **2026-09-14 · this unchecked box is stale bookkeeping, not an unknown — the baseline measured GREEN today.** From `ui/`: `npm run typecheck` → **exit 0, 0 errors**; the targeted run over **18** PosScreen+cart files → **325 passed / 0 failed / 1 skipped**; `npm run lint` → **0 errors / 48 warnings**. The single skip is **pre-existing** and unrelated to this plan: `it.skip('opens FastPIN overlay when deduction badge clicked')` at `ui/src/__tests__/PosScreenCoreFlow.test.tsx:1470`. What is genuinely missing is **coverage, not verification**: `components/CartPanel.tsx`, `CartFooterTotals.tsx` and `CartActionBar.tsx` have **no direct test file** (only `CourseSelectorBar` has one). Two corrections while this is being re-read: (i) the box stays unchecked on purpose — the gap above is a test-coverage gap, so ticking it would claim the missing tests exist; (ii) the path in the older text is wrong — the extracted components live in `ui/src/features/sales/components/`, **not** flat in `ui/src/features/sales/` (`ls ui/src/features/sales/components/*.tsx` → CartActionBar, CartFooterTotals, CartLineItem, CartPanel, CartTaxWatcher, CourseSelectorBar, ItemModifierModal).
  - **2026-09-14 · coverage moved while this note was being written, so the sentence above is already partly stale:** `CartActionBar.test.tsx` and `CartFooterTotals.test.tsx` now exist with **6** `it(` cases each, and `CourseSelectorBar.test.tsx` is also **6** (`grep -cE '^[[:space:]]*(it|test)\(' ui/src/__tests__/Cart{ActionBar,FooterTotals}.test.tsx ui/src/__tests__/CourseSelectorBar.test.tsx`). Still **no** test file for `CartPanel` or `CartLineItem` (`ls ui/src/__tests__/CartPanel.test.tsx ui/src/__tests__/CartLineItem.test.tsx` → not found). Re-run that check before acting on this bullet — see the drift warning at the end of this file.
- [x] **Commit Milestone:** landed as `ceace1a63 refactor(pos-ui): extract CartLineItem and CourseSelectorBar presentation components`.
  ```bash
  git commit -m "refactor(pos-ui): extract CartLineItem and CourseSelectorBar presentation components"
  ```

### Phase 2.2: Extract Cart Footer Totals & Action Rack — ✅ DONE (`5a0e87a22`, 2026-09-11)
- [x] Extract `<CartFooterTotals />` into `components/CartFooterTotals.tsx` (340 lines; `CartPanel.tsx:17`).
  - Displays subtotal, discounts, tax estimate badge, tips, and grand total. — the tax badge actually lives in `components/CartTaxWatcher.tsx` (imported at `PosScreen.tsx:33`); tip/service-charge values are passed down from `PosScreen`. The line-by-line contents of `CartFooterTotals.tsx` were **not** re-verified by this audit. — **2026-09-14, and the tax-badge claim above it is FALSE:** `components/CartTaxWatcher.tsx` (34 lines) returns **NO JSX** — its render path ends in `return null;` at `:33` — so it is a headless sync that exports `IDLE_TAX_STATE` at `:10` (`grep -n "return null\|IDLE_TAX_STATE" ui/src/features/sales/components/CartTaxWatcher.tsx`). The tax badge is rendered in **`components/CartFooterTotals.tsx`**: the `taxEstimated` prop is declared `:36`, destructured `:70`, and used in the className ternary at `:319` (`pos-cart-tax-estimated`). The old sentence stays as written and is superseded here.
- [x] Extract `<CartActionBar />` into `components/CartActionBar.tsx` (87 lines; `CartPanel.tsx:18`).
  - Buttons: Pay, Hold Bill, Recall, Discount, Clear Cart. — **not re-verified** against the file's actual button set; recorded as unverified. — **2026-09-14: now verified, and it is WRONG.** Measured set is THREE: Clear (`:38`), Pay/Charge (`:54`, label `Charge` at `:62`), Open Bill (`:67`). Hold Bill / Recall / Discount are not in `CartActionBar.tsx` at all; `grep -c "Hold\|Recall\|Discount" ui/src/features/sales/components/CartActionBar.tsx` = **0**.
- [x] Replace inline JSX in `PosScreen.tsx` (via `<CartPanel />`).
- [ ] Verify: `npm run test` and `npm run typecheck`. — **NOT RUN by this audit.** → **2026-09-14: stale bookkeeping, both commands were run today and are green** — `npm run typecheck` exit 0 / 0 errors, 325 passed / 0 failed / 1 skipped across the 18 targeted PosScreen+cart files, `npm run lint` 0 errors / 48 warnings; the skip is pre-existing (`PosScreenCoreFlow.test.tsx:1470`). Kept unchecked: the coverage gap it stands next to (no direct test for `CartPanel` / `CartFooterTotals` / `CartActionBar`) is still open.
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
  - **2026-09-14 · UNREACHABLE AS WRITTEN — restate the gate as `<= 760`.** The arithmetic is in the "Arithmetic of record" block under **Target File**: the five inline modals total **381 ln** (`:841-884` 44, `:886-928` 43, `:930-1049` 120, `:1051-1155` 105, `:1157-1225` 69) and keyboard nav `:517-603` is **87 ln**; removing all **468** and adding ~55 ln of new call sites + 7 ln of imports lands at **~841 (−33%)**, and an optimistic `<CartPanel />` call-site grouping (~−65) still leaves **~776**. `< 600` would additionally require editing the **640-line non-JSX body `:56-695`**, which item 4 of the Path Fencing forbids (Agent 1's state/calc files, and Agent 1 is FINISHED — nobody owns them now). So the honest wave-1 gate is **`<= 760 lines`** (`wc -l ui/src/features/sales/PosScreen.tsx`), and `< 600` is only reachable by a fence change, not by these extractions.
  - **2026-09-14 · and "`< 600` for a `.tsx`" is not a gate at all:** `ui/eslint.config.js` defines **no `max-lines`** rule (`grep -c 'max-lines' ui/eslint.config.js` = 0) and `scripts/gates.json` has **no size gate** in its **70** rows (`grep -c '"id":' scripts/gates.json` = 70). `AGENTS.md` §2 scopes the "under 1,000 / preferably < 600" rule to **production `.rs` files**. Treat 600 as an editorial target, not something a build will ever fail on.
- [ ] Verify all tests green: `npm run check:all`. — **NOT RUN by this audit.** → **2026-09-14: the three Verify boxes in this file (2.1, 2.2, 2.3) are stale bookkeeping, not an unknown.** Baseline measured green today from `ui/`: `npm run typecheck` exit 0 / 0 errors · 18 targeted PosScreen+cart test files → **325 passed / 0 failed / 1 skipped** · `npm run lint` **0 errors / 48 warnings** · the 1 skip is pre-existing (`ui/src/__tests__/PosScreenCoreFlow.test.tsx:1470`, an `it.skip` on the FastPIN overlay). `npm run check:all` itself was **not** re-run today (it chains E2E behind Docker) — **not measured**; what was re-run is typecheck, the targeted Vitest files and lint. Left unchecked deliberately: the real remaining item is component-test coverage, not a colour on a finished run.
- [x] **Commit Milestone:** landed as `dc148cb73 refactor(pos-ui): consolidate CartPanel and reduce PosScreen to composition root`.
  ```bash
  git commit -m "refactor(pos-ui): consolidate CartPanel and reduce PosScreen to composition root"
  ```

---

## 🧭 Remaining Work (re-scoped by the 2026-09-14 audit)

1. Take `PosScreen.tsx` from 1,247 to the planned < 600: the surviving bulk is workspace/overlay wiring and the resize plumbing `CartPanel` still borrows from its parent. → **2026-09-14: the target for this item is `<= 760`, not `< 600`** (see "Arithmetic of record" above; `< 600` needs the `:56-695` body, which the fence forbids). Re-measure before judging it: the working tree is already dirty with the next extraction — cbm `detect_changes` (git-diff based, vs `main`) names `ui/src/features/sales/PosScreen.tsx`, `ui/src/__tests__/cartExtraction.test.ts` and a new `ui/src/features/sales/components/ShiftModals.tsx` (417 ln by the read tool's `totalLines`), and `PosScreen.tsx` now reads **972** ln against the **1,247** ln at `ec2edf258`. Every `:NNNN` anchor in this file is a point-in-time anchor into the 1,247-line file; re-derive them with `grep -n` before cutting anything.
2. Move `CartPanel*.css` next to (or into) the components that use it, replacing the side-effect imports at `PosScreen.tsx:50-55`.
   - **2026-09-14 · the mechanism has to be restated before anyone "verifies" it: NO test asserts WHICH file imports a stylesheet.** `ui/src/__tests__/cartExtraction.test.ts` enforces exactly three things — (a) every `className` used has a rule, (b) no `className` is defined in more than one of the **6** sheets it reads (`:56-61`: `PosScreen.css`, `CartPanel.css`, `CartPanelLineItem.css`, `CartPanelFooterTotals.css`, `CartPanelActions.css`, `CartPanelCourseBar.css`; `CartPanel.brand.css` is excluded by the header comment at `:10-12`), and (c) every `className` defined in CSS is **REACHABLE** from the files it reads. Moving an `import './x.css'` from parent to child therefore changes nothing the test can see — the file move is unguarded, and only (c) can fail.
   - **The consequence that does bind:** any extraction that MOVES markup into a new component must register that component in `ADDITIONAL_TSX_FILES` (`cartExtraction.test.ts:35-40`) **in the same commit**, or (c) reports the moved classes as unreachable CSS and the suite goes red. Verified current list: `components/{CartLineItem,CourseSelectorBar,CartFooterTotals,CartActionBar,CartPanel}.tsx` (`sed -n '35,41p' ui/src/__tests__/cartExtraction.test.ts`).
3. Add component tests for `CartPanel`, `CartLineItem`, `CartFooterTotals`, `CartActionBar` — only `CourseSelectorBar` has one. *(2026-09-14: paths are `ui/src/features/sales/components/...`, not flat in `sales/`. The "only one has a test" claim is **already stale**: `ls ui/src/__tests__/*Cart*.test.tsx` today returns `CartActionBar.test.tsx` and `CartFooterTotals.test.tsx` as well (6 `it(` cases each), so the surviving half of this item is `CartPanel` and `CartLineItem`.)*
   - **2026-09-14 · one shared surface this plan does not fence:** `components/CartPanel.tsx`'s **77-field** `CartPanelProps` (`grep -c '^  [a-zA-Z_$]*\\?:' ui/src/features/sales/components/CartPanel.tsx` = 77) is mirrored by `ui/src/features/retail/RetailCartPanel.tsx` (`RetailCartPanelProps`, `:57`) and asserted by `ui/src/__tests__/RetailCartPanel.test.tsx` — **26** cases (`grep -cE '^[[:space:]]*(it|test)\(' ui/src/__tests__/RetailCartPanel.test.tsx` = 26). Changing a prop's optionality here reaches the retail shell; neither this file nor Agent 3's fences that surface.
4. Decide whether `RetailPosScreen.tsx` (1,808 lines, the tablet/desktop `store-pos` POS) joins this campaign or needs its own plan.

> ⚠️ **2026-09-14 · this file's `wc -l ui/src/features/sales/PosScreen.tsx` = 1,247 is a HEAD reading, not the working tree.** Three reads of that file taken minutes apart inside this same audit pass reported **1,247 → 972 → 899** lines, and `PaymentModal.tsx` reported 2,404 then 2,435, with a new `components/ShiftModals.tsx` (417 ln) appearing mid-pass: concurrent agents are landing the extractions this plan describes **while these notes are being written**. Every `:NNNN` anchor above is into the 1,247-line file. Re-run `wc -l ui/src/features/sales/PosScreen.tsx` and re-derive each anchor with `grep -n` before cutting anything, and re-test the `<= 760` gate against whatever number comes back — on the reading above (899) the gate is already met and `< 600` is the live question again.
>
> last audited 2026-09-14 by DSH (docs-auditor)
