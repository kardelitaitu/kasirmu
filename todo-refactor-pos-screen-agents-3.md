# Orchestrator Agent 3: `PaymentModal` & Split Tenders Deconstruction

<!-- Audit stamp: 2026-09-14 · DSH · status: NOT-STARTED, AND MIS-BASELINED (the target grew ~500 lines since this plan was written; none of its 7 planned files exists) · corrections applied: 9 · The most consequential error is the baseline: `PaymentModal.tsx` is 2,436 lines (`wc -l`), not the 1,933 quoted four times — and 1,933 matches NO revision in the file's git history, so the number was never true here; found by re-measuring every path on disk and walking `git log` for the file, not trusting the cbm graph index (its `oz-pos` project points at `C:/dev/ozpos/0.0.35/oz-pos`, a different worktree). -->

**Document:** `todo-refactor-pos-screen-agents-3.md`  
**Role:** Orchestrator Agent 3 (Payment & Checkout Architect)  
**Goal:** Decompose `PaymentModal.tsx` (2,436 lines as measured 2026-09-14 by `wc -l ui/src/features/sales/PaymentModal.tsx`) from a monolithic checkout modal into modular tender providers, split-payment state machines, currency conversion helpers, and receipt preview layers.

> 📌 **Path correction (2026-09-14):** the file is `ui/src/features/sales/PaymentModal.tsx`. There is **no** `ui/src/features/pos/` directory in this repo; the POS surfaces live under `features/sales` and `features/retail`, registered lazily (`ui/src/features/sales/register.tsx:6,15-16`).

**Target File:** `ui/src/features/sales/PaymentModal.tsx` (**Baseline: 2,436 lines**, `wc -l`; a split-on-newline count reads 2,437 — that ±1 is a method artifact, not a doc error)  
- **2026-09-14 (re-measured the same day) - the 2,436 above is the baseline of record, not today's count: `wc -l ui/src/features/sales/PaymentModal.tsx` = **2,321**.** Path: 2,436 -> 2,321 (-115) across the three extracts now in `payment/` - `types.ts` (`3cb313277`), `useAutoQr.ts` (`0b13ff3e1`), `useGatewayQr.ts` (`1328510ed`). The 2,436 reading stays visible as the arithmetic denominator above and at 3.4; NO `< 450`-era box is ticked by this note.

**Sibling Documents:**
- `done-todo-refactor-pos-screen-agents-1.md` (Agent 1 — Cart Engine & State Architect) — **FINISHED**; cited by bare name with no `./` prefix: retired under the `done-todo-` convention (its only root commit is `238912974`; `git log -- todo-refactor-pos-screen-agents-1.md` under the old name is empty, so there is **no rename event to cite for this file**, and `94b5da2cc`, which renamed other work orders, never touched it), and one clause only: a separate session has an *uncommitted, in-flight* move of retired work orders out of the repo root, which is why no path is written here. This is the same fact as the "wait for Agent 1" gate in the sibling doc: that gate is waiting on completed work.
- [`todo-refactor-pos-screen-agents-2.md`](./todo-refactor-pos-screen-agents-2.md) (Agent 2 — Cart UI Panels, Modals & Peripherals)

> ⚠️ **Blast-radius correction:** this modal has **two** consumers, not one. It is imported at `ui/src/features/sales/PosScreen.tsx:43` (rendered `:800`) **and** at `ui/src/features/retail/RetailPosScreen.tsx:15` — the 1,808-line tablet/desktop `store-pos` screen (`ui/src/frontend/shell/AppShell.tsx:551`, `ui/src/frontend/shell/tablet/TabletAppShell.tsx:173`). Any decomposition here changes both POS shells.
>
> 🧷 **Contract as measured 2026-09-14** (`ui/src/features/sales/payment/types.ts:19-56`; members counted with `grep -cE '^  [a-zA-Z_$]+\??:' ui/src/features/sales/payment/types.ts`): `PaymentModalProps` is **18 props — 6 required, 12 optional**. The six the two callers disagree about (`promotionIds`, `tableNumber`, `tenderPresets`, `serialNumbers`, `selectedCustomer`, `onCustomerChange`) are **all optional**, which is exactly why both call sites — `ui/src/features/sales/PosScreen.tsx:800` and `ui/src/features/retail/RetailPosScreen.tsx:1425` (`grep -n '<PaymentModal' ui/src/features/sales/PosScreen.tsx ui/src/features/retail/RetailPosScreen.tsx`) — stay legal untouched.
> **The honest half: nothing imports the type.** Both callers pass **inline literals**; the only importer is `PaymentModal.tsx:38` itself (`from './payment/types'`, re-exported at `:55`), and the three test files import the component, not the props (`grep -rn PaymentModalProps ui/src` → hits only `payment/types.ts` and `PaymentModal.tsx`). So this contract is guarded by **typecheck at those two call sites**, not by an import graph — narrow or delete a prop and the only thing that fails is `npm run typecheck`, once both shells compile.
> **Recorded for the same reason:** `components/CartPanel.tsx`'s **77-field** `CartPanelProps` is a shared surface too — `ui/src/features/retail/RetailCartPanel.tsx:57` re-declares it as `RetailCartPanelProps` and `ui/src/__tests__/RetailCartPanel.test.tsx` asserts it in **26** cases (`grep -cE '^[[:space:]]*(it|test)\(' ui/src/__tests__/RetailCartPanel.test.tsx` = 26; the 77 fields are counted inside the interface with `grep -c '^  [a-zA-Z_$]+\?:'`). Neither this fence nor Agent 2's covers it.

> 🔎 **What already exists, outside this plan's fence:** the "receipt preview layer" is already a component — `ui/src/features/sales/ReceiptPreview.tsx` (279 lines, added by `dfc0d8b87`, 2026-07-20), imported at `PaymentModal.tsx:36` and used at `:1660`. `StockShortfallDialog.tsx` (508 lines, imported `:35`, used `:1540`) and `useLocalPaymentRails.ts` (93 lines, imported `:30`, used `:123`; added by `bffcbda97`, 2026-09-14) are likewise already separate. Phase 3 should re-use them rather than re-create their roles under `payment/`.

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Communication happens strictly through the Git commit history and durable commit subjects.
2. **Commit Subject Convention:**
   - All commits made by Agent 3 MUST use:
     - `refactor(payment): ...`
     - **2026-09-14 note on every commit snippet in this file:** the snippets show the *subject* only and are left untouched as history. **Bare `git commit -m "..."` violates `AGENTS.md` §3** — the only permitted form is ONE line with an explicit pathspec, `git commit -m "<type>(<area>): <subject>" -- path/one path/two`; and since every file this plan creates is new, each needs the same-line chain `git add -- new/one && git commit -m "<type>(<area>): <subject>" -- new/one`.
     - *Drift note (2026-09-14):* the payment work actually landing on `main` uses the `payment-ui` area — `refactor(payment-ui): ...` (`3d50b3ac5`) and `feat(payment-ui): ...` (`bffcbda97`, `903b30a71`, `26ffd89c1`, `289be3959`). Exactly one commit matches the fenced form: `e2fffc14d refactor(payment): extract the Square idempotency key derivation`. Confirm which prefix the campaign owns before committing.
3. **Owned Path Fence (Exclusive to Agent 3):** — *one existing file, then seven files that do not exist yet*
   - `ui/src/features/sales/PaymentModal.tsx` (Primary target) ✅ 2,436 lines
   - `ui/src/features/sales/payment/` ❌ **does not exist** — verified 2026-09-14: `fs.existsSync` reports ENOENT, and a repo-wide search for `TenderPanel`, `PaymentStateMachine`, `SplitTenders` and `PaymentSummaryFooter` across `ui/src` and `apps` returns **no matches**. Nothing in this fence has been started.
     - **2026-09-14 (later the same day) — the ENOENT half of this line is now FALSE; superseded, original left visible:** the directory exists and holds exactly **one** file, `payment/types.ts` (56 ln; `ls ui/src/features/sales/payment/` prints `types.ts` alone). Slice S1 moved `PaymentModalProps` into it — `PaymentModal.tsx:38` is `import type { PaymentModalProps } from './payment/types';` and `:55` re-exports it so any old `from '.../PaymentModal'` import still resolves. **Six of the seven planned files still do not exist**: no `usePaymentStateMachine.ts`, `useSplitTenders.ts`, the four `*TenderPanel.tsx`, or `PaymentSummaryFooter.tsx`; the four-identifier repo-wide search still returns no matches. This is the first slice of the plan to land at all, so "NOT STARTED" below is now "1 of 8 files".
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

**Current target (2026-09-14): no file under `features/sales/payment/` exceeds 450 lines.** The original `PaymentModal.tsx < 450` is retired as a whole-file bar: 3.3's cited ranges sum to 353 lines (14.5% of the file), so the number was never reachable by extraction; the shell's own count is trended separately - 2,436 -> 2,321, re-measured this pass with `wc -l ui/src/features/sales/PaymentModal.tsx`.

### Phase 3.0: Baseline & Checkout Invariant Safeguards
- [ ] Run `npm run test -- PaymentModal` or checkout test suites. — **NOT RUN by this audit** (time box). The suite surface is confirmed to exist and is a useful pre-refactor harness: `ui/src/__tests__/PaymentModal.test.tsx` (27 `it(` cases), `PaymentModalEdgeCases.test.tsx` (29), `PaymentModalSaleFlow.test.tsx` (27) — 83 cases total, counted with `grep -cE "^[[:space:]]*(it|test)\(" <file>`.
- [x] Record lines of code in `PaymentModal.tsx` — **2,436** (`wc -l`, 2026-09-14). The previously recorded "~1,933 lines" matches **no revision** of this file: walking every commit that ever touched it (`git log --format=%h -- ui/src/features/sales/PaymentModal.tsx`, 94 commits) yields 1,887 (`8f79bd43f`) and 1,987 (`a09aa73cb`) as the nearest values, and the file was already 2,045 lines at `e89e37c12` on 2026-09-10 — the day this plan document itself was committed (`1af143f23`).
- [x] Document critical invariants — verified present in the file, with anchors:
  - Exact minor-unit math; tender must equal the sale total before completion → `splitSum`/`remaining` at `:669`, and the gate `if (splitTotals.remaining !== 0n) return false;` at `:673` (BigInt, not float — matches the repo-wide `Money` rule).
  - Cash change with multi-currency rounding → `changeDue` state `:136`, the `minorUnitExponent()` re-rounding inside the quick-tender handler at `:1947`, and the MONEY-01/MONEY-02 exact-conversion comments at `:507`, `:519`, `:615`, `:658`.
  - 💸 **2026-09-14 · the money invariant is ALREADY VIOLATED in this file, and two of the three fixes cannot ride an extraction.** `AGENTS.md` says "Monetary Values: store as integer minor units (`i64`) using `Money`. Never use `f32`/`f64`" (and the `Money` struct rule for IPC). `PaymentModal.tsx` has **3 float sites** — `:1151`, `:1948`, `:1968` — and a **hardcoded** `toLocaleString('id-ID')` at `:1958` (`grep -n "toLocaleString('id-ID')" ui/src/features/sales/PaymentModal.tsx` → 1 hit; re-grepped at HEAD `3cb313277` it reads `:1926`, the same −32 drift as everywhere else below the moved interface).
    - **Two of the three float sites and the locale call sit INSIDE the parked span `:1840-2060`** (fact under Phase 3.3), so **the money fix cannot be folded into a 3.3 extraction** — it needs its own commit, sequenced after `todo-payment.md` releases that span. Only `:1151` is outside the parked region and rides **3.2**.
    - **The canonical helper already exists — do not write a new one:** `formatMoney` at `ui/src/types/domain.ts:223` (`grep -n "export const formatMoney" ui/src/types/domain.ts` → `223`), and this file already uses it **11×** (`grep -c formatMoney ui/src/features/sales/PaymentModal.tsx` = 11, e.g. `:1955`, `:2131`, `:2244`). The `id-ID` default is a parameter of `formatMoney` (`locale: string = 'id-ID'`, `:225`), so the hardcoded call is a bypass of a helper that already takes the locale.
  - Mixed tender types (Cash + Card, Points + QRIS) → `SplitRow` `:43`, `splits` state `:263`, `updateSplit` `:1137`; loyalty redemption participates via `getLoyaltyAccount`/`redeemLoyaltyPoints`/`getPointsValue` `:26` and `loyaltyDiscount` `:142`.
  - Stock shortfall blocks completion when negative inventory is disallowed → `PartialStockResult` `:9`, `shortfallResult` `:257`, `<StockShortfallDialog>` `:1540`.

### Phase 3.1: Extract Payment State Machine (`usePaymentStateMachine.ts`) — ❌ NOT STARTED
- [ ] Extract payment state transition logic.
  - ⚠️ **Correction to the prescribed modes.** The six identifiers `idle`, `selecting_method`, `collecting_tender`, `processing`, `completed`, `receipt` appear **zero** times in `PaymentModal.tsx` — but that is a naming mismatch, not proof the flow is absent (searched: those six literals, plus `phase`, `stage`, `status ===`, `isProcessing`, `submitting`). The state vocabulary that IS in the file today is:
    - `type PaymentMethod = 'cash' | 'card' | 'qris' | 'other' | 'open_bill' | 'credit'` at `:41` (note: six members — `other` and `credit` have no planned panel below),
    - the EDC sub-machine `phase: 'preflight' | 'waiting' | 'declined'` at `:1055` (set at `:1062`, `:1078`, `:1085`; rendered `:1494`, `:1498`, `:1523`),
    - `splitMode` + `splits` `:263`, `shortfallResult` `:257`, `receiptArgs` `:258`, `paymentError` `:260`, `autoQr` `:905`, and `gatewayStatus: 'completed'` `:885`.
    Re-scope this phase as: name the real states, then extract — do not port a machine that the file never had.
  - ⚠️ **2026-09-14 — the premise above is WRONG IN BOTH DIRECTIONS, and the "appear zero times" claim is false for three of the six names.** `processing` is **not** absent: it is a live `useState` — `grep -c '\bprocessing\b' ui/src/features/sales/PaymentModal.tsx` = **9** mentions — and so are `completed` (**3**) and `receipt` (**18**) by the same command. The other three (`idle`, `selecting_method`, `collecting_tender`) really do appear zero times. Anchors as measured at `ec2edf258`: `processing` `:134`, `done` `:135`, `leaving` `:177`, `paymentError` `:260`, `receiptArgs` `:258`; re-grepped at HEAD `3cb313277` these read `:102`, `:103`, `:145`, `:228`, `:226` — a uniform **−32** because slice S1 lifted `PaymentModalProps` out of the file (`grep -n 'const \[processing' ui/src/features/sales/PaymentModal.tsx` is the command to re-derive them).
  - **So the correction is the opposite of the one written above:** there is no machine to extract either. `processing`, `done`, `leaving`, `paymentError`, `receiptArgs` are **five independent boolean/object atoms**, not states of one thing; only `edc.phase` (`:1054`) and `autoQr` (`:905`) are genuinely phase-typed. A `usePaymentStateMachine.ts` would be invented, not extracted.
  - 🔒 **The invariant this campaign must respect: NO extracted hook may own `processing`.** It is read by the shell's close/reopen guard, so the shared atoms stay in `PaymentModal.tsx` and are **received as props** by whatever comes out of 3.1/3.2. Any extraction that moves `setProcessing` behind a hook boundary breaks the double-submit guard rather than relocating it.
  - Integration points confirmed (imports at `:9` from `@/api/sales`, which is 773 lines):
    - `startSaleScoped` — called `:697` and `:1203`
    - `addLineScoped` — called `:716` and `:1222`
    - `completeSaleScoped` — called `:730`
    - `finalizeSale` — called `:841` and `:1279` (the `pending` → `completed` transition, commented at `:1274`)
    Two call chains exist (`:697-841` and `:1203-1279`) — the duplication is itself the strongest argument for this extraction, and it is not mentioned by the original plan.
- [ ] Move into `ui/src/features/sales/payment/usePaymentStateMachine.ts`. — target directory still absent.
  - **2026-09-14 - SUPERSEDES 'target directory still absent' here and in 3.2; both originals stay visible.** `payment/` EXISTS with three landed extracts: `types.ts` (56 ln, `3cb313277`), `useAutoQr.ts` (242 ln, `0b13ff3e1`), `useGatewayQr.ts` (112 ln, `1328510ed`) - re-check with `ls ui/src/features/sales/payment/`. Neither `usePaymentStateMachine.ts` nor `useSplitTenders.ts` is on that list, so THIS box remains open and unticked; what the extracts did was move QR plumbing, not the state machine 3.1 names.
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
  - **2026-09-14 - 'target directory still absent' is superseded here too:** see the 3.1 note - `payment/` holds `types.ts` + `useAutoQr.ts` + `useGatewayQr.ts`, and `useSplitTenders.ts` is NOT among them. Box stays open and unticked.
- [ ] Verify: `npm run typecheck`. — not run.
- [ ] **Commit Milestone:** nothing to commit yet.
  ```bash
  git commit -m "refactor(payment): extract tender splitting and currency logic into useSplitTenders hook"
  ```

### Phase 3.3: Extract Tender Panels — ❌ NOT STARTED (the inline blocks are still inline)

> 🚧 **2026-09-14 · 3.3 is PARTLY PARKED, and the cost has to be stated before anyone budgets it.** `PaymentModal.tsx:1840-2060` contains **the four tender pickers this phase exists to move** — and that same span is the **region root** `todo-payment.md` (**882** ln, **38** unchecked boxes; `wc -l todo-payment.md`, `grep -c '^- [ ]' todo-payment.md`) plans its changes into, citing live anchors inside it. Two writers into one span is how an extraction gets reverted, so **that span is parked**: **~167 of 3.3's 353 ln are deferred**, and **~186 ln remain safe** to cut now — the EDC overlay `:1491-~1560`, the split rows `:2064-~2160`, the footer conditional `:2416-2431`, and QR/auto-QR `:1470-1490`. 3.3 is therefore a ~53% phase until `todo-payment.md` releases `:1840-2060`, not a 100% one.

- [ ] **Cash Tender Panel:** `payment/CashTenderPanel.tsx` (quick tender pills, change calculation, cash drawer trigger). — the JSX to cut is `{method === 'cash' && (` at `:1925` through the presets block `:1943-1971`.
- [ ] **Card & EDC Tender Panel:** `payment/CardTenderPanel.tsx` (card type, EDC bridge, reference/auth codes). — JSX `{method === 'card' && !splitMode && edcOffered && (` at `:1995`; the EDC state machine `:1054-1085` and its status UI `:1494-1530`. Note the panel is gated on `edcOffered` (`:125`) — a rail from `useLocalPaymentRails`, added 2026-09-14 and not in the original plan.
- [ ] **QRIS & Digital Tender Panel:** `payment/QrisTenderPanel.tsx` (dynamic QR, confirmation polling). — JSX `{method === 'qris' &&` at `:2016`; `autoQr` state `:905`; `qrisOffered` gate `:124` with the fallback that demotes the method at `:280`. Real dynamic-QR + settlement polling landed in `289be3959` (2026-09-13) and static-merchant-QR in `903b30a71` (2026-09-14) — this is most of the growth the baseline missed.
- [ ] **Loyalty & Store Credit Panel:** `payment/LoyaltyTenderPanel.tsx` (points balance, redemption calculator, customer link). — JSX `{isEnabled(FEATURES.LOYALTY_PROGRAM) && loyaltyAccount && (` at `:2225`, section `:2226-2270`; state `loyaltyAccount` `:140`, `pointsWorthMinor` `:149`, `selectedCustomer` `:138`, `customerSearchResults` `:174`.
- [ ] ❌ **Missing from the plan:** the `open_bill` (`:1890`, `:1902`, `:2417`) and `credit` (`:1166`, `:1263`, `:2421`) methods carry real UI and their own completion rules, — **2026-09-14: re-confirmed that these anchors (`:1890`, `:1902`, `:2417`) fall inside the parked span of the blockquote above, so this item is PARKED pending `todo-payment.md` sequencing (which owns `:1840-2060`); do not re-plan or re-cut against those line numbers until that span is released.** and `'other'` (`:41`, whose `otherLabel` value feeds the completion payload at `:1395`) too — three tender modes with no planned panel. A decomposition that ships only four panels leaves ~`2,436 − (extracted)` still inline.
- [ ] Verify: `npm run typecheck` and unit tests. — not run.
- [ ] **Commit Milestone:** nothing to commit yet.
  ```bash
  git commit -m "refactor(payment): extract modular tender panels (Cash, Card, QRIS, Loyalty)"
  ```

### Phase 3.4: Reassemble `PaymentModal.tsx` & Verify — ❌ NOT STARTED
- [ ] Reassemble `PaymentModal.tsx` as a clean coordinator wiring the state machine, the active tender panel, and receipt preview (reuse `ReceiptPreview.tsx` rather than re-implementing it).
- [ ] Verify `PaymentModal.tsx` line count dropped from **2,436** to < 450 lines. — Re-baselined: that is **−1,986 lines, a −82% reduction**, not the −77% the old 1,933 baseline implied. (retired 2026-09-14 - see Current target above)
  - **2026-09-14 · as an acceptance test for THIS checkbox the number is unusable: restate it as a PER-FILE ceiling.** `wc -l ui/src/features/sales/PaymentModal.tsx` = **2,436**, **every range 3.3 cites sums to 353 ln**, i.e. **14.5%** of the file (method: the spans printed under Phase 3.3 — `:1925` with `:1943-1971`, `:1995`, `:1054-1085`, `:1494-1530`, `:2016`, `:2225-2270` — added as written, then `353 / 2,436 = 14.5%`; no per-panel split is measured here). Even if 3.3 shipped in full, a shell cannot reach 450 by shedding 14.5%. So the gate is: **no file under `features/sales/payment/` exceeds 450 ln** (measure with `wc -l ui/src/features/sales/payment/*.ts*` after each slice), and `PaymentModal.tsx` itself is **measured separately and reported as a trend**, not gated.
  - **Where the other ~1,600 ln are:** they are carried by **3.1 and 3.2**, not 3.3 — the two call chains at `:697-841` and `:1203-1279` plus the split/currency block 3.2 lists. 3.4's number therefore tracks 3.1/3.2 completion and must not be quoted as evidence about 3.3. The file has moved the other way since this plan was written: 2,045 lines at `e89e37c12` (2026-09-10) → 2,436 today, i.e. **+391 lines across 7 commits** (`289be3959`, `26ffd89c1`, `8dc3ae7ef`, `0d0c1eda5`, `bffcbda97`, `903b30a71`, `3d50b3ac5`). Re-check the baseline again before starting — it is a moving target.
- [ ] Run full UI tests: `npm run test` and `npm run typecheck`. — not run by this audit.
- [ ] Run pre-commit checks: `npm run check:all`. — not run.
- [ ] **Commit Milestone:** nothing to commit yet.
  ```bash
  git commit -m "refactor(payment): consolidate PaymentModal into thin coordinator component"
  ```

---

## 📦 Shipped in this campaign (2026-09-14)

| commit | what landed | measured proof |
|---|---|---|
| `3cb313277` `refactor(payment): move the frozen PaymentModalProps contract into payment/types` | the interface lifted out of the shell, **verbatim** — 18 props, 6 required, 12 optional — and re-exported so the old import path still resolves | `ui/src/features/sales/payment/types.ts` = **56** ln, `PaymentModalProps` at `:19`; `PaymentModal.tsx:38` imports it, `:55` `export type { PaymentModalProps };`. ⚠️ **The caveat recorded in the blast-radius note stands: nothing imports the type, so the "freeze" has NO import witness** — the only real guard is `npm run typecheck` at `PosScreen.tsx:800` and `RetailPosScreen.tsx:1425`. |
| `ca5d58957` `fix(sales): render quick tender amounts through formatMoney with no float math` | the three `10 ** exp` float sites and the hardcoded `toLocaleString('id-ID')` label are **gone** | `grep -c '\*\* exp\|toLocaleString' ui/src/features/sales/PaymentModal.tsx` = **0** (was 1 for the locale, at `:1958`). **Two** sites whose output feeds an editable `<input>` deliberately do **NOT** use `formatMoney`: digit placement is done with integers/strings instead, because feeding `formatMoney`'s output into `parseMinorUnits` returns `null` and would **silently zero a tender**. `PaymentModal.test.tsx:662` was retargeted from the float-era string to a property matcher over either separator. **Left alone on purpose:** the exchange **rate** at `:1774` (`rate_millionths`, not `Money`) and the integer floor division at `:1137-1138` (`BigInt` arithmetic, not float). |

**No checkbox under 3.1–3.4 is ticked by these two commits, and that is deliberate:** neither the contract move nor the money fix is a line item in this plan — 3.1/3.2/3.3/3.4's own boxes are extraction steps, and all of them are still open. The fence list above changes only in that `payment/types.ts` now exists (1 of 8).

**Phase status after these two:** 3.1 / 3.2 — `useAutoQr` is **IN FLIGHT** as the first cut (`a1078a05`), and it is a narrowed slice, not the state machine 3.1 names. 3.3 — the parked-span cost recorded above (~**167 of 353** ln deferred to `todo-payment.md`'s `:1840-2060`) **stands unchanged**; nothing in it has been released. 3.4 — **not started**; `wc -l ui/src/features/sales/PaymentModal.tsx` still reads four digits.

**Two follow-ups deliberately NOT folded into `ca5d58957`, recorded as OPEN:**
1. **`new Date().toLocaleDateString('en-US', …)` × 3** — `PaymentModal.tsx:775`, `:1293`, `:1595` (`grep -n toLocaleDateString ui/src/features/sales/PaymentModal.tsx`). Same hardcoded-locale law, different surface: these are **receipt payload dates**, not displayed `Money`, so they are not part of the money fix and must not be silently swept into it.
2. **`disabled={!subtotal}` at `components/CartFooterTotals.tsx:147` is DEAD BY TYPE** — `subtotal` is declared non-nullable `Money` at `:11` (an object), so `!subtotal` can never be true and the guard never fires. A real fix compares `subtotal.minor_units === 0` inside the component. Filed here, unfixed: `CartFooterTotals.tsx` is Agent 2's fence, not this one's.

## 🧭 Notes for whoever picks this up (added by the 2026-09-14 audit)

1. **All four phases are untouched.** `ui/src/features/sales/payment/` does not exist; no checkbox under 3.1–3.4 can be ticked honestly. → **2026-09-14, later the same day: partly FALSE and superseded (the sentence stands as written).** `payment/` exists with one file, `types.ts` (56 ln), and 1 of the fence's 8 paths is now on disk. "Untouched" is still true of every *behavioural* checkbox: no state machine, no split hook, no panel, no footer, and `PaymentModal.tsx` is still a monolith.
2. **Re-baseline before every step**, and freeze it in the commit subject: five `payment-ui` commits landed in the four days this plan sat unexecuted.
3. **The two-customer problem:** `PosScreen.tsx` and `RetailPosScreen.tsx` both mount this modal. Extraction is only safe with the 83 existing cases green plus a new `RetailPosScreenCheckout`-side check.
4. **Name the real states before extracting them** (Phase 3.1): the prescribed `idle → … → receipt` chain is a wish, not a description of `PaymentModal.tsx`. → **2026-09-14 addendum: read the 3.1 note before acting on this one.** Three of the six names (`processing` 9 mentions, `completed` 3, `receipt` 18) ARE in the file, so "name the real states" is not the whole job — the finding is that there is **no single machine** to extract (five independent atoms; only `edc.phase` and `autoQr` are phase-typed), and the binding constraint is that **no extracted hook may own `processing`**
5. Three tender modes (`other`, `open_bill`, `credit`) have no planned destination panel.
6. **`< 450` here, and `< 600` in the sibling file, are UNENFORCED numbers:** `grep -c max-lines ui/eslint.config.js` = 0 (re-run 2026-09-14), no row among the 70 in `scripts/gates.json` is a size gate (`grep -c '"id":' scripts/gates.json` = 70), and `AGENTS.md` §2 scopes the under-1,000 / preferably-under-600 rule to production `.rs` files. So they are editorial, and must not be cited as CI failures.

> ⚠️ **2026-09-14 · anchor drift is live in this file.** `wc -l ui/src/features/sales/PaymentModal.tsx` = **2,436** was the day's first reading; three reads minutes later returned **2,404** and **2,435** while slice S1 landed, and every `:NNNN` above is anchored below the moved `PaymentModalProps` interface — the shift so far is a uniform **−32** for lines under `:56` (`processing` `:134`→`:102`, `id-ID` locale `:1958`→`:1926`, `<PaymentModal` in `PosScreen.tsx` `:800`→`:794`). Re-derive each anchor with `grep -n` against the file you are about to cut, and re-check `ls ui/src/features/sales/payment/` before assuming a planned file is absent.
>
> last audited 2026-09-14 by DSH (docs-auditor)
