# Orchestrator Agent 1: Cart Core, State Machines & Tax Estimation

**Document:** `todo-refactor-pos-screen-agents-1.md`  
**Role:** Orchestrator Agent 1 (Cart Engine & State Architect)  
**Goal:** Decompose the core sales state machine, cart actions, line calculations, course groupings, tax estimation, and hold/recall workflows from `PosScreen.tsx` into modular hooks and pure calculation utilities.

**Target File:** `ui/src/features/sales/PosScreen.tsx` (Baseline: 2,329 lines)  
**Sibling Documents:**
- [`todo-refactor-pos-screen-agents-2.md`](./todo-refactor-pos-screen-agents-2.md) (Agent 2 — Cart UI Panels, Modals & Peripherals)
- [`todo-refactor-pos-screen-agents-3.md`](./todo-refactor-pos-screen-agents-3.md) (Agent 3 — PaymentModal & Split Tenders Deconstruction)

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Communication happens strictly through the Git commit history and durable commit subjects.
2. **Commit Subject Convention:**
   - All commits made by Agent 1 MUST use:
     - `refactor(pos-cart): ...`
     - `refactor(pos-state): ...`
3. **Owned Path Fence (Exclusive to Agent 1):**
   - `ui/src/features/sales/hooks/usePosCartActions.ts` (NEW)
   - `ui/src/features/sales/hooks/usePosHeldCarts.ts` (NEW)
   - `ui/src/features/sales/hooks/usePosShifts.ts` (NEW)
   - `ui/src/features/sales/utils/cartCalculations.ts` (NEW)
   - `ui/src/features/sales/components/CartTaxWatcher.tsx` (NEW)
   - *Hook calls only* at the top of `ui/src/features/sales/PosScreen.tsx` (Lines 1–450).
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `ui/src/features/sales/PaymentModal.tsx` (Owned by Agent 3).
   - DO NOT edit presentation JSX in `PosScreen.tsx` below the hook declarations (Owned by Agent 2).
5. **Merge Conflict Prevention with Agent 2:**
   - Agent 1 works in new files in `hooks/` and `utils/`, only wiring the hook calls at the top of `PosScreen.tsx`.
   - Agent 2 begins UI component extraction from the bottom JSX render tree.

---

## 📋 Task Checklist

### Phase 1.0: Baseline & Characterization
- [x] Run `npm run test -- src/__tests__/PosScreen.test.tsx` in `ui/`.
- [x] Run `npm run typecheck` in `ui/`.
- [x] Record current line count of `ui/src/features/sales/PosScreen.tsx` (Baseline: ~2,329 lines).

### Phase 1.1: Pure Calculations & Tax Watcher Extraction
- [x] Extract `clampCartWidth`, `lineThumbnail`, and pure cart total/discount helpers to `utils/cartCalculations.ts`.
- [x] Extract `CartTaxWatcher` and `IDLE_TAX_STATE` from `PosScreen.tsx` into `components/CartTaxWatcher.tsx`.
- [x] Verify types and tests: `npm run typecheck`.
- [x] **Commit Milestone:**
  ```bash
  git commit -m "refactor(pos-cart): extract cart calculations and CartTaxWatcher component"
  ```

### Phase 1.2: Shift State Machine Extraction (`usePosShifts.ts`)
- [x] Extract active shift queries, shift opening, closing, cash float prompts, and PIN verification from `PosScreen.tsx` into `hooks/usePosShifts.ts`.
- [x] Wire hook into `PosScreen.tsx`.
- [x] Verify: `npm run test -- src/__tests__/PosScreen.test.tsx` and `npm run typecheck`.
- [x] **Commit Milestone:**
  ```bash
  git commit -m "refactor(pos-state): extract shift lifecycle into usePosShifts hook"
  ```

### Phase 1.3: Held Carts & Open Bills Extraction (`usePosHeldCarts.ts`)
- [x] Extract cart hold, open bill listing, recall bill, and delete bill logic into `hooks/usePosHeldCarts.ts`.
- [x] Wire hook into `PosScreen.tsx`.
- [x] Verify: `npm run test -- src/__tests__/PosScreen.test.tsx` and `npm run typecheck`.
- [x] **Commit Milestone:**
  ```bash
  git commit -m "refactor(pos-state): extract held cart management into usePosHeldCarts hook"
  ```

### Phase 1.4: Cart Line Actions & Deduction Logic (`usePosCartActions.ts`)
- [x] Extract item addition, quantity modification, course assignment, line removal, and deduction location override into `hooks/usePosCartActions.ts`.
- [x] Wire hook into `PosScreen.tsx`.
- [x] Verify: `npm run test -- src/__tests__/PosScreen.test.tsx` and `npm run typecheck`.
- [x] **Commit Milestone:**
  ```bash
  git commit -m "refactor(pos-cart): extract cart line manipulations into usePosCartActions hook"
  ```

---

## Completion record (campaign: PosScreen Agent 1)

**Closed:** 2026-09-11 on branch `0.0.37` — nothing pushed. Every figure below was re-measured against the commits and the tree at close-out (`git show --numstat`, `git show <rev>:<path> | wc -l`, Vitest, `tsc --noEmit`, ESLint), not copied from the planning text above. The plan text itself is preserved unedited, including the two figures it turned out not to match (see §4).

### 1. Provenance

| Phase | Commit | Files (per `git show --numstat`) | `PosScreen.tsx` line delta |
|---|---|---|---|
| **1.0** Baseline & Characterization | — measurement only, no commit | — | **2,462** at `dffe250a5~1` (screen suite: 18 cases) |
| **1.1** Calculations + tax watcher | `dffe250a5`<br>`refactor(pos-cart): extract cart calculations and CartTaxWatcher component` | NEW `ui/src/features/sales/utils/cartCalculations.ts` +41<br>NEW `ui/src/features/sales/components/CartTaxWatcher.tsx` +34<br>`PosScreen.tsx` +3 / −74 | 2,462 → **2,391** (−71) |
| **1.2** Shift lifecycle | `a00a964ee`<br>`refactor(pos-state): extract shift lifecycle into usePosShifts hook` | NEW `ui/src/features/sales/hooks/usePosShifts.ts` +197 (returns 24 symbols)<br>`PosScreen.tsx` +27 / −142 | 2,391 → **2,276** (−115) |
| **1.3** Held carts & open bills | `b0fff0209`<br>`refactor(pos-state): extract held cart management into usePosHeldCarts hook` | NEW `ui/src/features/sales/hooks/usePosHeldCarts.ts` +173 (returns 13)<br>`PosScreen.tsx` +30 / −105 | 2,276 → **2,201** (−75) |
| **1.4** Cart line actions | `85adf2e49`<br>`refactor(pos-cart): extract cart line manipulations into usePosCartActions hook`<br><br>`c24904a7a`<br>`refactor(pos-cart): complete cart line manipulation extraction into usePosCartActions hook` | NEW `hooks/usePosCartActions.ts` +178<br>`PosScreen.tsx` +30 / −112<br><br>`hooks/usePosCartActions.ts` +95 (appended → 273 ln)<br>`PosScreen.tsx` +17 / −64 | 2,201 → **2,119** (−82)<br>→ **2,072** (−47) |

**Net: `PosScreen.tsx` 2,462 → 2,072 lines = −390 (−15.8 %), into 5 new homes** (`utils/cartCalculations.ts`, `components/CartTaxWatcher.tsx`, `hooks/usePosShifts.ts`, `hooks/usePosHeldCarts.ts`, `hooks/usePosCartActions.ts`). `git diff c24904a7a HEAD -- ui/src/features/sales/PosScreen.tsx` is empty: no later commit on the branch moved the target file.

Reproduce any row: `git show --stat <sha>` for subject + file list; `git show <rev>:ui/src/features/sales/PosScreen.tsx | wc -l` for the count.

### 2. Verification evidence (all four campaign-end suites re-run on committed bytes, 2026-09-11)

```text
 ✓ src/__tests__/PosScreen.test.tsx  (18 tests) 1240ms
      Tests  18 passed (18)

 ✓ src/__tests__/PosScreen.integration.test.tsx  (106 tests) 12.09s
      Tests  106 passed (106)

 ✓ src/__tests__/PosScreenCoreFlow.test.tsx  (23 tests | 1 skipped) 4074ms
      Tests  22 passed | 1 skipped (23)

 ✓ src/__tests__/usePosState.test.ts  (29 tests) 159ms
      Tests  29 passed (29)
```

Typecheck — `npx tsc --noEmit` over the whole `ui/` program returned **0 diagnostics under `ui/src/features/sales/`**. The only two diagnostics in the program are the sibling's uncommitted WIP named in deviation 8:

```text
src/features/workspaces/WorkspaceHome.tsx(14,1): error TS6133: 'ToolsCategoryGrid' is declared but its value is never read.
src/features/workspaces/WorkspaceHome.tsx(15,15): error TS2440: Import declaration conflicts with local declaration of 'ToolLockReason'.
```

Supporting facts: none of the four suite files was touched by any of the five commits (`git log dffe250a5~1..HEAD -- <the four test paths>` is empty), so the suites that are green now are the same suites Phase 1.0 recorded as green before it started; `ui/src/features/sales/**` was clean against HEAD at close-out.

### 3. Deviations (manager-ruled; recorded verbatim, with the close-out measurement appended)

1. **Phase 1.4 shipped as TWO commits.** The phase measured ~144 lines across six scattered blocks with two JSX sites that MUTATE extracted state; the todo's mandated subject is on the file-establishing commit (`85adf2e49`) and the second carries an explicit "complete…" subject (`c24904a7a`). Rationale: box discipline over one-commit letter.
2. **Phase 1.3's "delete bill logic" clause has NO standalone handler to move.** `deleteHeldCartScoped` is referenced only by the import and inside `handlePaymentComplete`, which per ruling stays in PosScreen composing the hooks. Nothing was invented to satisfy the prose.
3. **"course assignment" (todo 1.4 prose) has no PosScreen-side wrapper.** `fireCourse` / `fireAllCourses` are `usePosState` natives (`usePosState.ts:172`, `:185`) consumed via destructure, and `assignCourse` is not consumed by PosScreen at all. Left untouched.
4. **Keyboard navigation and the park-to-localStorage family intentionally STAYED in PosScreen** — `focusLineByIndex`, `handleCartPanelKeyDown`, `handleLock`, `LOCKED_CART_KEY`: outside the todo prose AND duplicated by forbidden near-twins in the pre-existing flat `posScreenHooks.ts` (`useLockedCartPersistence`, `useCartKeyboardNavigation`, `useCartWidth`, `useShiftTimer`) which the campaign rules forbid consolidating.
5. **Pre-existing flat files were NEVER edited** — `posScreenHooks.ts`, `usePosState.ts`, `posScreenUtils.ts`, `bundleExpansion.ts`; boundary types are derived from them via `import type`. The retail twin (`ui/src/features/retail/RetailPosScreen.tsx`, its own local `CartTaxWatcher` at `:61`) is out of scope.
6. **Hook-extraction consequence, accepted:** collapsing two source blocks into one hook call site necessarily re-registers effects/callbacks at a new position (Wave 3: the `showOpenBills` refresh effect, now `usePosHeldCarts.ts:86-89`; Wave 4b: `useAnimatedUndoStack`'s 200 ms fade effect, now `usePosCartActions.ts:218`). Each was DISCLOSED with a disjointness argument and proven by the 106-case integration + 22-case core-flow suites. Silent re-ordering would have been rejected.
7. **Accepted quality debt, NOT a regression:** 2 new `react-hooks/exhaustive-deps` warnings (`usePosCartActions.ts:194` / `:208`; 4 more pre-date the campaign) from threading stable `useRef` / setState identities as hook parameters. Silencing needs a non-byte-equivalent wrapper, which the campaign rules forbid. ESLint has no `--max-warnings` budget and is not a pre-commit gate, so nothing blocks.
   * *Measured at close-out (widens, does not cancel, the ruling):* `features/sales` now carries **9** `react-hooks/exhaustive-deps` warnings — `PosScreen.tsx:635,658,746`; `usePosCartActions.ts:132,194,208`; `usePosHeldCarts.ts:128`; `usePosShifts.ts:127,148` — against **0** in the pre-campaign `PosScreen.tsx` (same blob re-linted via `eslint --stdin --stdin-filename` reports 0 problems). Project-wide the count is **11**, so `python scripts/verify-exhaustive-deps.py` currently **fails** (11 > cap 4 in `scripts/exhaustive-deps-baseline.json`). That ratchet is *not* wired into `.githooks/pre-commit` (verified: the hook never invokes ESLint or the script), which is why no commit was blocked; it **is** a hard step in `scripts/check.sh:78` and `.github/workflows/dev-ci.yml:284` (`ui-test`). Consequence for the merge owner: a PR to `main` will go red on the ratchet until the campaign's deps arrays are fixed or the cap is deliberately re-baselined — the script's own note forbids raising it casually.
8. **Per-wave commit hygiene:** the repo-wide pre-commit typecheck step was skipped with the hook's own documented `OZPOS_SKIP_TYPECHECK=1` on all five commits, because a SIBLING'S UNCOMMITTED working-tree WIP in `ui/src/features/workspaces/WorkspaceHome.tsx` (TS6133 + TS2440) fails whole-program `tsc`. The repo's committed bytes typecheck CLEAN; `--no-verify` was never used and the other 9 hook gates ran every time. Compensating control: the manager independently re-ran typecheck at every wave gate and required ZERO diagnostics under `features/sales/`. Owner action implied: that lane's WIP blocks everyone's pre-commit hook.
   * *Verification status:* the skip itself is **not** recoverable from commit objects — the hook writes no metadata — so this bullet stands on the manager's log, not on git. What is independently true at close-out: the two failing diagnostics are exactly the sibling's WIP file, `OZPOS_SKIP_TYPECHECK` is the hook's documented single-step skip (`.githooks/pre-commit:317-326`, and its text explicitly prefers it to `--no-verify`), and the committed `features/sales` tree typechecks clean.

### 4. Plan-text vs. measured reconciliation (the wording above is deliberately left as written)

* **"Baseline: 2,329 lines"** (header + Phase 1.1 box): the measured baseline at `dffe250a5~1` is **2,462**. The planning figure predates the campaign's start; all deltas in §1 use 2,462.
* **"*Hook calls only* at the top of `PosScreen.tsx` (Lines 1–450)"** (rule 3): at HEAD the three extracted hook blocks sit at **515–540** (`usePosShifts`), **542–567** (`usePosCartActions`) and **670–684** (`usePosHeldCarts`), with `<CartTaxWatcher>` in JSX at 1616. The range is a stale coordinate, not a changed boundary — nothing below these blocks was touched.
* **"Extract … pure cart total/discount helpers to `utils/cartCalculations.ts`"** (Phase 1.1): the module holds what actually existed as pure functions — `CART_WIDTH_MIN/DEFAULT/MAX_CAP`, `clampCartWidth`, `lineThumbnail`. There is no standalone cart-total/discount helper in `PosScreen.tsx` to move; that math is inside `usePosState` and the render tree. Box closed on the two named helpers plus the constants.
* **Duplication this leaves behind, priced but not paid:** `clampCartWidth` and `lineThumbnail` are byte-identical in three places at HEAD — the new `utils/cartCalculations.ts` (imported by `PosScreen.tsx:36`), the pre-existing `posScreenUtils.ts` (now imported by production code by nobody; only `src/__tests__/utils/posScreenUtils.test.ts` still reads it), and a private third copy at `posScreenHooks.ts:35`. Rule 5 forbade touching the two flat files, so consolidation is a follow-up for whoever owns them, not a campaign leftover to be fixed silently.

### 5. Hand-off

* The commit subjects **`refactor(pos-cart)`** and **`refactor(pos-state)`** are now released by Agent 1 — Agent 2 (presentation JSX below the hook blocks) and Agent 3 (`PaymentModal` / split tenders) may work against them without a subject collision.
* Both agents should re-measure their own baselines against `ui/src/features/sales/PosScreen.tsx` at **2,072 lines** (or whatever HEAD then shows): the line coordinates in this document's rules refer to the 2,462-line file and have all shifted downward.
* Live consumers created here: `hooks/usePosShifts.ts` (24 symbols), `hooks/usePosHeldCarts.ts` (13), `hooks/usePosCartActions.ts` (24), `components/CartTaxWatcher.tsx`, `utils/cartCalculations.ts`. `handlePaymentComplete` remains in `PosScreen.tsx` as the composer — Agent 3's PaymentModal work starts against that seam, not against a hook.
* Open item for the merge owner, inherited from deviation 7: the `verify-exhaustive-deps.py` ratchet is red project-wide (11 vs cap 4) with 9 of the 11 in `features/sales`. Decide fix-the-deps or re-baseline-the-cap before the PR, because `check.sh` and `dev-ci#ui-test` will not pass as-is.
