# Orchestrator Agent 3: `PaymentModal` & Split Tenders Deconstruction

<!-- Audit stamp: 2026-09-14 · DSH · status: NOT-STARTED, AND MIS-BASELINED (the target grew ~500 lines since this plan was written; none of its 7 planned files exists) · corrections applied: 9 · The most consequential error is the baseline: `PaymentModal.tsx` is 2,436 lines (`wc -l`), not the 1,933 quoted four times — and 1,933 matches NO revision in the file's git history, so the number was never true here; found by re-measuring every path on disk and walking `git log` for the file, not trusting the cbm graph index (its `oz-pos` project points at `C:/dev/ozpos/0.0.35/oz-pos`, a different worktree). -->

**Document:** `todo-refactor-pos-screen-agents-3.md`  
**Role:** Orchestrator Agent 3 (Payment & Checkout Architect)  
**Goal:** Decompose `PaymentModal.tsx` (2,436 lines as measured 2026-09-14 by `wc -l ui/src/features/sales/PaymentModal.tsx`) from a monolithic checkout modal into modular tender providers, split-payment state machines, currency conversion helpers, and receipt preview layers.

> 📌 **Path correction (2026-09-14):** the file is `ui/src/features/sales/PaymentModal.tsx`. There is **no** `ui/src/features/pos/` directory in this repo; the POS surfaces live under `features/sales` and `features/retail`, registered lazily (`ui/src/features/sales/register.tsx:6,15-16`).

**Target File:** `ui/src/features/sales/PaymentModal.tsx` (**Baseline: 2,436 lines**, `wc -l`; a split-on-newline count reads 2,437 — that ±1 is a method artifact, not a doc error)  
**Sibling Documents:**
- `done-todo-refactor-pos-screen-agents-1.md` (Agent 1 — Cart Engine & State Architect) — **FINISHED**; cited by bare name with no `./` prefix: retired under the `done-todo-` convention (its only root commit is `238912974`; `git log -- todo-refactor-pos-screen-agents-1.md` under the old name is empty, so there is **no rename event to cite for this file**, and `94b5da2cc`, which renamed other work orders, never touched it), and one clause only: a separate session has an *uncommitted, in-flight* move of retired work orders out of the repo root, which is why no path is written here. This is the same fact as the "wait for Agent 1" gate in the sibling doc: that gate is waiting on completed work.
- [`todo-refactor-pos-screen-agents-2.md`](./todo-refactor-pos-screen-agents-2.md) (Agent 2 — Cart UI Panels, Modals & Peripherals)

> ⚠️ **Blast-radius correction:** this modal has **two** consumers, not one. It is imported at `ui/src/features/sales/PosScreen.tsx:43` (rendered `:800`) **and** at `ui/src/features/retail/RetailPosScreen.tsx:15` — the 1,808-line tablet/desktop `store-pos` screen (`ui/src/frontend/shell/AppShell.tsx:551`, `ui/src/frontend/shell/tablet/TabletAppShell.tsx:173`). Any decomposition here changes both POS shells.

> 🔎 **What already exists, outside this plan's fence:** the "receipt preview layer" is already a component — `ui/src/features/sales/ReceiptPreview.tsx` (279 lines, added by `dfc0d8b87`, 2026-07-20), imported at `PaymentModal.tsx:36` and used at `:1660`. `StockShortfallDialog.tsx` (508 lines, imported `:35`, used `:1540`) and `useLocalPaymentRails.ts` (93 lines, imported `:30`, used `:123`; added by `bffcbda97`, 2026-09-14) are likewise already separate. Phase 3 should re-use them rather than re-create their roles under `payment/`.

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Communication happens strictly through the Git commit history and durable commit subjects.
2. **Commit Subject Convention:**
   - All commits made by Agent 3 MUST use:
     - `refactor(payment): ...`
     - *Drift note (2026-09-14):* the payment work actually landing on `main` uses the `payment-ui` area — `refactor(payment-ui): ...` (`3d50b3ac5`) and `feat(payment-ui): ...` (`bffcbda97`, `903b30a71`, `26ffd89c1`, `289be3959`). Exactly one commit matches the fenced form: `e2fffc14d refactor(payment): extract the Square idempotency key derivation`. Confirm which prefix the campaign owns before committing.
3. **Owned Path Fence (Exclusive to Agent 3):** — *one existing file, then seven files that do not exist yet*
   - `ui/src/features/sales/PaymentModal.tsx` (Primary target) ✅ 2,436 lines
   - `ui/src/features/sales/payment/` ❌ **does not exist** — verified 2026-09-14: `fs.existsSync` reports ENOENT, and a repo-wide search for `TenderPanel`, `PaymentStateMachine`, `SplitTenders` and `PaymentSummaryFooter` across `ui/src` and `apps` returns **no matches**. Nothing in this fence has been started.
     - `usePaymentStateMachine.ts` ❌ not present
     - `useSplitTenders.ts` ❌ not present
     - `CashTenderPanel.tsx` ❌ not present
     - `CardTenderPanel.tsx` ❌ not present
     - `QrisTenderPanel.tsx` ❌ not present
     - `LoyaltyTenderPanel.tsx` ❌ not present
     - `PaymentSummaryFooter.tsx` ❌ not present
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `PosScreen.tsx` or its cart hooks/components (Owned by Agent 1 & Agent 2). — still correct; note those siblings have since landed: `usePosState.ts` (342 ln), `hooks/usePosCartActions.ts` (273 ln), `components/CartPanel.tsx` (609 ln).

---

## 📋 Task Checklist

### Phase 3.0: Baseline & Checkout Invariant Safeguards
- [ ] Run `npm run test -- PaymentModal` or checkout test suites. — **NOT RUN by this audit** (time box). The suite surface is confirmed to exist and is a useful pre-refactor harness: `ui/src/__tests__/PaymentModal.test.tsx` (27 `it(` cases), `PaymentModalEdgeCases.test.tsx` (29), `PaymentModalSaleFlow.test.tsx` (27) — 83 cases total, counted with `grep -cE "^[[:space:]]*(it|test)\(" <file>`.
- [x] Record lines of code in `PaymentModal.tsx` — **2,436** (`wc -l`, 2026-09-14). The previously recorded "~1,933 lines" matches **no revision** of this file: walking every commit that ever touched it (`git log --format=%h -- ui/src/features/sales/PaymentModal.tsx`, 94 commits) yields 1,887 (`8f79bd43f`) and 1,987 (`a09aa73cb`) as the nearest values, and the file was already 2,045 lines at `e89e37c12` on 2026-09-10 — the day this plan document itself was committed (`1af143f23`).
- [x] Document critical invariants — verified present in the file, with anchors:
  - Exact minor-unit math; tender must equal the sale total before completion → `splitSum`/`remaining` at `:669`, and the gate `if (splitTotals.remaining !== 0n) return false;` at `:673` (BigInt, not float — matches the repo-wide `Money` rule).
  - Cash change with multi-currency rounding → `changeDue` state `:136`, the `minorUnitExponent()` re-rounding inside the quick-tender handler at `:1947`, and the MONEY-01/MONEY-02 exact-conversion comments at `:507`, `:519`, `:615`, `:658`.
  - Mixed tender types (Cash + Card, Points + QRIS) → `SplitRow` `:43`, `splits` state `:263`, `updateSplit` `:1137`; loyalty redemption participates via `getLoyaltyAccount`/`redeemLoyaltyPoints`/`getPointsValue` `:26` and `loyaltyDiscount` `:142`.
  - Stock shortfall blocks completion when negative inventory is disallowed → `PartialStockResult` `:9`, `shortfallResult` `:257`, `<StockShortfallDialog>` `:1540`.

### Phase 3.1: Extract Payment State Machine (`usePaymentStateMachine.ts`) — ❌ NOT STARTED
- [ ] Extract payment state transition logic.
  - ⚠️ **Correction to the prescribed modes.** The six identifiers `idle`, `selecting_method`, `collecting_tender`, `processing`, `completed`, `receipt` appear **zero** times in `PaymentModal.tsx` — but that is a naming mismatch, not proof the flow is absent (searched: those six literals, plus `phase`, `stage`, `status ===`, `isProcessing`, `submitting`). The state vocabulary that IS in the file today is:
    - `type PaymentMethod = 'cash' | 'card' | 'qris' | 'other' | 'open_bill' | 'credit'` at `:41` (note: six members — `other` and `credit` have no planned panel below),
    - the EDC sub-machine `phase: 'preflight' | 'waiting' | 'declined'` at `:1055` (set at `:1062`, `:1078`, `:1085`; rendered `:1494`, `:1498`, `:1523`),
    - `splitMode` + `splits` `:263`, `shortfallResult` `:257`, `receiptArgs` `:258`, `paymentError` `:260`, `autoQr` `:905`, and `gatewayStatus: 'completed'` `:885`.
    Re-scope this phase as: name the real states, then extract — do not port a machine that the file never had.
  - Integration points confirmed (imports at `:9` from `@/api/sales`, which is 773 lines):
    - `startSaleScoped` — called `:697` and `:1203`
    - `addLineScoped` — called `:716` and `:1222`
    - `completeSaleScoped` — called `:730`
    - `finalizeSale` — called `:841` and `:1279` (the `pending` → `completed` transition, commented at `:1274`)
    Two call chains exist (`:697-841` and `:1203-1279`) — the duplication is itself the strongest argument for this extraction, and it is not mentioned by the original plan.
- [ ] Move into `ui/src/features/sales/payment/usePaymentStateMachine.ts`. — target directory still absent.
- [ ] Verify: `npm run typecheck`. — not run.
- [ ] **Commit Milestone:** nothing to commit yet.
  ```bash
  git commit -m "refactor(payment): extract checkout workflow into usePaymentStateMachine hook"
  ```

### Phase 3.2: Extract Split Tenders & Currency Hook (`useSplitTenders.ts`) — ❌ NOT STARTED
- [ ] Extract split rows state, balance remaining, multi-currency conversion, and quick cash. Anchors to cut against:
  - `interface SplitRow` `:43` · `useState<SplitRow[]>([` `:263` · `updateSplit` `:1137` · `splitSum`/`remaining` `:669` · the completion guard `:673` · the remaining-balance footer `:2154-2164`.
  - Currency side: `currencies` `:272`, `exchangeRates` `:273`, `latestRate` `:336`, `minorUnitExponent` conversions `:507`/`:519`/`:615`/`:658`.
  - ⚠️ **Correction:** "quick cash suggestions (`[50k, 100k, exact]`)" is not what the code does. The presets are a **prop** — `tenderPresets?: number[]` at `:67`, destructured `:109` — rendered at `:1943` as `(tenderPresets ?? [5000, 10000, 20000, 50000, 100000])`, i.e. five major-unit Rp denominations (5,000 / 10,000 / 20,000 / 50,000 / 100,000) computed as `Math.ceil(totalMajor / amount) * amount` (`:1949`), plus a separate "Exact" button at `:1962-1971`. Any extracted hook must keep the prop, not hardcode three amounts.
- [ ] Move into `ui/src/features/sales/payment/useSplitTenders.ts`. — target directory still absent.
- [ ] Verify: `npm run typecheck`. — not run.
- [ ] **Commit Milestone:** nothing to commit yet.
  ```bash
  git commit -m "refactor(payment): extract tender splitting and currency logic into useSplitTenders hook"
  ```

### Phase 3.3: Extract Tender Panels — ❌ NOT STARTED (the inline blocks are still inline)
- [ ] **Cash Tender Panel:** `payment/CashTenderPanel.tsx` (quick tender pills, change calculation, cash drawer trigger). — the JSX to cut is `{method === 'cash' && (` at `:1925` through the presets block `:1943-1971`.
- [ ] **Card & EDC Tender Panel:** `payment/CardTenderPanel.tsx` (card type, EDC bridge, reference/auth codes). — JSX `{method === 'card' && !splitMode && edcOffered && (` at `:1995`; the EDC state machine `:1054-1085` and its status UI `:1494-1530`. Note the panel is gated on `edcOffered` (`:125`) — a rail from `useLocalPaymentRails`, added 2026-09-14 and not in the original plan.
- [ ] **QRIS & Digital Tender Panel:** `payment/QrisTenderPanel.tsx` (dynamic QR, confirmation polling). — JSX `{method === 'qris' &&` at `:2016`; `autoQr` state `:905`; `qrisOffered` gate `:124` with the fallback that demotes the method at `:280`. Real dynamic-QR + settlement polling landed in `289be3959` (2026-09-13) and static-merchant-QR in `903b30a71` (2026-09-14) — this is most of the growth the baseline missed.
- [ ] **Loyalty & Store Credit Panel:** `payment/LoyaltyTenderPanel.tsx` (points balance, redemption calculator, customer link). — JSX `{isEnabled(FEATURES.LOYALTY_PROGRAM) && loyaltyAccount && (` at `:2225`, section `:2226-2270`; state `loyaltyAccount` `:140`, `pointsWorthMinor` `:149`, `selectedCustomer` `:138`, `customerSearchResults` `:174`.
- [ ] ❌ **Missing from the plan:** the `open_bill` (`:1890`, `:1902`, `:2417`) and `credit` (`:1166`, `:1263`, `:2421`) methods carry real UI and their own completion rules, and `'other'` (`:41`, whose `otherLabel` value feeds the completion payload at `:1395`) too — three tender modes with no planned panel. A decomposition that ships only four panels leaves ~`2,436 − (extracted)` still inline.
- [ ] Verify: `npm run typecheck` and unit tests. — not run.
- [ ] **Commit Milestone:** nothing to commit yet.
  ```bash
  git commit -m "refactor(payment): extract modular tender panels (Cash, Card, QRIS, Loyalty)"
  ```

### Phase 3.4: Reassemble `PaymentModal.tsx` & Verify — ❌ NOT STARTED
- [ ] Reassemble `PaymentModal.tsx` as a clean coordinator wiring the state machine, the active tender panel, and receipt preview (reuse `ReceiptPreview.tsx` rather than re-implementing it).
- [ ] Verify `PaymentModal.tsx` line count dropped from **2,436** to < 450 lines. — Re-baselined: that is **−1,986 lines, a −82% reduction**, not the −77% the old 1,933 baseline implied. The file has moved the other way since this plan was written: 2,045 lines at `e89e37c12` (2026-09-10) → 2,436 today, i.e. **+391 lines across 7 commits** (`289be3959`, `26ffd89c1`, `8dc3ae7ef`, `0d0c1eda5`, `bffcbda97`, `903b30a71`, `3d50b3ac5`). Re-check the baseline again before starting — it is a moving target.
- [ ] Run full UI tests: `npm run test` and `npm run typecheck`. — not run by this audit.
- [ ] Run pre-commit checks: `npm run check:all`. — not run.
- [ ] **Commit Milestone:** nothing to commit yet.
  ```bash
  git commit -m "refactor(payment): consolidate PaymentModal into thin coordinator component"
  ```

---

## 🧭 Notes for whoever picks this up (added by the 2026-09-14 audit)

1. **All four phases are untouched.** `ui/src/features/sales/payment/` does not exist; no checkbox under 3.1–3.4 can be ticked honestly.
2. **Re-baseline before every step**, and freeze it in the commit subject: five `payment-ui` commits landed in the four days this plan sat unexecuted.
3. **The two-customer problem:** `PosScreen.tsx` and `RetailPosScreen.tsx` both mount this modal. Extraction is only safe with the 83 existing cases green plus a new `RetailPosScreenCheckout`-side check.
4. **Name the real states before extracting them** (Phase 3.1): the prescribed `idle → … → receipt` chain is a wish, not a description of `PaymentModal.tsx`.
5. Three tender modes (`other`, `open_bill`, `credit`) have no planned destination panel.

> last audited 2026-09-14 by DSH (docs-auditor)
