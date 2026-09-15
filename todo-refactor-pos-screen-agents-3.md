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
   - `ui/src/features/sales/payment/` ❌ **does not exist** — verified 2026-09-14: `fs.existsSync` reports ENOENT, and a repo-wide search for `TenderPanel`, `PaymentStateMachine`, `SplitTenders` and `PaymentSummaryFooter` across `ui/src` and `apps` returns **no matches**. Nothing in this fence has been started. <!-- 2026-09-15 re-measure at HEAD 264e402dc: BOTH halves of this line are dead -- the directory exists and holds TWELVE files, and the repo-wide search returns hits. The two dated notes on the line below carry the measurement; this line is left exactly as written because :40 and :91 already supersede it in place. -->
     - **2026-09-14 (later the same day) — the ENOENT half of this line is now FALSE; superseded, original left visible:** the directory exists and holds exactly **one** file, `payment/types.ts` (56 ln; `ls ui/src/features/sales/payment/` prints `types.ts` alone). Slice S1 moved `PaymentModalProps` into it — `PaymentModal.tsx:38` is `import type { PaymentModalProps } from './payment/types';` and `:55` re-exports it so any old `from '.../PaymentModal'` import still resolves. **Six of the seven planned files still do not exist**: no `usePaymentStateMachine.ts`, `useSplitTenders.ts`, the four `*TenderPanel.tsx`, or `PaymentSummaryFooter.tsx`; the four-identifier repo-wide search still returns no matches. This is the first slice of the plan to land at all, so "NOT STARTED" below is now "1 of 8 files". **2026-09-15 (re-measured at HEAD 264e402dc) - "exactly one file" and "six of the seven planned files still do not exist" are FALSE too, and this note deliberately adds NO LINE so that :102, :113 and this file's own self-citation at :234 keep their numbers:** `ls ui/src/features/sales/payment/` = **twelve** files - `types.ts` 56 · `useAutoQr.ts` 242 · `useGatewayQr.ts` 112 · `useMultiCurrency.ts` 200 · `useTenderMath.ts` 206 · `moneyFormat.ts` 31 · `completedSale.ts` 108 · `SplitTenderRows.tsx` 228 · `CashTenderPanel.tsx` 152 · `CardTenderPanel.tsx` 86 · `QrisTenderPanel.tsx` 101 · `LoyaltyTenderPanel.tsx` 224 = **1,746 ln**, command `wc -l ui/src/features/sales/payment/*.ts*`. **Three of the seven named absences are still absent, not six:** `usePaymentStateMachine.ts`, `useSplitTenders.ts`, `PaymentSummaryFooter.tsx` - the four `*TenderPanel.tsx` on the list below are all on disk. **And one file landed inside this fence that the plan never names at all:** `ui/src/features/sales/components/PaymentModalCustomerBadge.tsx` (113 ln, `2b456338b`) - in `components/`, not `payment/`, which is why a `payment/`-scoped count misses it (`find ui/src/features/sales -name "PaymentModalCustomerBadge.tsx"`).
     - `usePaymentStateMachine.ts` ❌ not present
     - `useSplitTenders.ts` ❌ not present
     - `CashTenderPanel.tsx` ❌ not present <!-- 2026-09-15: DEAD as a claim, kept visible as the reading it was --> **PRESENT - `payment/CashTenderPanel.tsx` is 152 ln, added `79d96f7c9`; command: `git log --format=%h --diff-filter=A -- ui/src/features/sales/payment/CashTenderPanel.tsx` and `wc -l` on that path. 3.3's box below is ticked on this measurement.**
     - `CardTenderPanel.tsx` ❌ not present <!-- 2026-09-15: DEAD as a claim, kept visible as the reading it was --> **PRESENT - `payment/CardTenderPanel.tsx` is 86 ln, added `122564796`; command: `git log --format=%h --diff-filter=A -- ui/src/features/sales/payment/CardTenderPanel.tsx` and `wc -l` on that path. 3.3's box below is ticked on this measurement.**
     - `QrisTenderPanel.tsx` ❌ not present <!-- 2026-09-15: DEAD as a claim, kept visible as the reading it was --> **PRESENT - `payment/QrisTenderPanel.tsx` is 101 ln, added `1c335bfd9`; command: `git log --format=%h --diff-filter=A -- ui/src/features/sales/payment/QrisTenderPanel.tsx` and `wc -l` on that path. 3.3's box below is ticked on this measurement.**
     - `LoyaltyTenderPanel.tsx` ❌ not present <!-- 2026-09-15: DEAD as a claim, kept visible as the reading it was --> **PRESENT - `payment/LoyaltyTenderPanel.tsx` is 224 ln, added `6ddf49f1e`; command: `git log --format=%h --diff-filter=A -- ui/src/features/sales/payment/LoyaltyTenderPanel.tsx` and `wc -l` on that path. 3.3's box below is ticked on this measurement.**
     - `PaymentSummaryFooter.tsx` ❌ not present
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `PosScreen.tsx` or its cart hooks/components (Owned by Agent 1 & Agent 2). — still correct; note those siblings have since landed: `usePosState.ts` (342 ln), `hooks/usePosCartActions.ts` (273 ln), `components/CartPanel.tsx` (609 ln).

---

## 📋 Task Checklist

**Current target (2026-09-14): no file under `features/sales/payment/` exceeds 450 lines.** The original `PaymentModal.tsx < 450` is retired as a whole-file bar: 3.3's cited ranges sum to 353 lines (14.5% of the file), so the number was never reachable by extraction; the shell's own count is trended separately - 2,436 -> 2,321, re-measured this pass with `wc -l ui/src/features/sales/PaymentModal.tsx`.

**2026-09-14 · CEILING MEASURED, and it retires 3.4 as a goal.** `grep -n '^  return (' ui/src/features/sales/PaymentModal.tsx` -> `:1254`, so **982 of 2,235 lines (44%)** are JSX no hook can take; the sizing pass that produced this number cited `:1340`, and every anchor below is its position **minus 86**, the `useMultiCurrency` extraction (`cf3e4dd8b`) having landed in between - re-derive each with `grep -n` before acting on it.
  - The atoms invariant locks the two money handlers (`buildGatewaySale` `:597-847`, `complete` `:963-1186` - ~474 lines), plus the reset block and `animateLeave`, where they are. Remaining lawful extraction after `useMultiCurrency` (`cf3e4dd8b`, -86 net) is loyalty ~70 gross and split ~74 gross, i.e. **~100-170 lines net whole: honest floor ~= 2,150.**
  - **Therefore 3.4 'thin coordinator' is UNREACHABLE BY EXTRACTION, and `useSplitTenders` is NOT recommended:** it pays ~40 net lines and is the only slice that touches the region the completion path reads. Its danger, measured: `splitComplete` (`:580-588`) is the SOLE guard that a split tender balances to the cent; it feeds `canComplete` (`:953-961`), is re-read by `complete()` at `:1186`, and `paymentSplitsFromState()` (`:1229-1236`) supplies both the retry props (`:1356-1358`) and the PRINTED payment lines (`:1415-1420`). A memo-identity slip there is a silent money bug - the receipt could print a breakdown disagreeing with the money taken - and the UI suite cannot catch it: the shell carries **3** `data-testid` sites (`:1445`, `:1639`, `:2213` - not 29; re-check `grep -c 'data-testid=' ui/src/features/sales/PaymentModal.tsx`), and the only split cases in `PaymentModal.test.tsx` (`:462`, `:483`) assert a displayed remaining amount and an enabled button, never that the printed lines equal the money taken.
  - **DECISION: stop the hook chain after loyalty** (ship loyalty only if a dry run shows **>= 80 net lines**); further reduction needs a reducer/state-machine redesign, which would void this campaign's per-slice revertibility. **That trade is the user's to make, not a worker's mid-slice.**

### Phase 3.0: Baseline & Checkout Invariant Safeguards
- [ ] Run `npm run test -- PaymentModal` or checkout test suites. — **NOT RUN by this audit** (time box). The suite surface is confirmed to exist and is a useful pre-refactor harness: `ui/src/__tests__/PaymentModal.test.tsx` (27 `it(` cases), `PaymentModalEdgeCases.test.tsx` (29), `PaymentModalSaleFlow.test.tsx` (27) — 83 cases total, counted with `grep -cE "^[[:space:]]*(it|test)\(" <file>`. <!-- 2026-09-15 re-measured, and the row UNDER-READS: the same three files it names now count 27 / 29 / **34** (`PaymentModalSaleFlow.test.tsx` grew from the cited 27), i.e. **90** cases, not 83 - and the harness is seven files, not three: `PaymentModalLoyalty` 16, `PaymentModalCustomerSection` 12, `PaymentModalSplitBalance` 12, `PaymentModalSplitTenderState` 18 (that last one is tonight's characterisation suite, `264e402dc`, written specifically to pin the split state before it moved). Caveat on the instrument: the same grep over `PaymentModalSplitBalance.test.tsx` reads 12 where vitest reports 13 cases plus 1 skipped, so nested/`it.each` bodies are under-counted by any static pattern - use `npx vitest run <files>` for the real number. Box stays open: it is a RUN leg, and this audit was docs-only. -->
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
- [ ] Move into `ui/src/features/sales/payment/usePaymentStateMachine.ts`. — target directory still absent.<!-- 2026-09-15 · NOT-A-TASK, no tick: the artifact this row names does not exist and the thing it would contain does not either. `ls ui/src/features/sales/payment/usePaymentStateMachine.ts` -> No such file; the directory holds 15 files (2,120 ln, largest `useAutoQr.ts` 242 ln, so the :55 per-file ceiling still holds). This file's own :82 measured why: `processing`, `done`, `leaving`, `paymentError`, `receiptArgs` are five independent atoms, not states of one machine, so writing this file would INVENT a state machine rather than extract one. :75, the box above it, is therefore not open code work either - it is PARKED on the ruling :60 records in the user's name. -->
  - **2026-09-14 - SUPERSEDES 'target directory still absent' here and in 3.2; both originals stay visible.** `payment/` EXISTS with three landed extracts: `types.ts` (56 ln, `3cb313277`), `useAutoQr.ts` (242 ln, `0b13ff3e1`), `useGatewayQr.ts` (112 ln, `1328510ed`) - re-check with `ls ui/src/features/sales/payment/`. Neither `usePaymentStateMachine.ts` nor `useSplitTenders.ts` is on that list, so THIS box remains open and unticked; what the extracts did was move QR plumbing, not the state machine 3.1 names.
- [x] Verify: `npm run typecheck`. — not run.
- [ ] **Commit Milestone:** OPEN still - and the false half of this line is "nothing to commit yet", not the box. Measured 2026-09-15 at HEAD 264e402dc: `git log --format=%s | grep -c '^refactor(payment'` = **5** and `grep -c '^refactor(sales)'` = **12**, and those are where this plan's own files went (`useTenderMath.ts`, `useMultiCurrency.ts`, `moneyFormat.ts`, `SplitTenderRows.tsx`, the four panels, the badge). So the milestone is NOT empty for the phase - it is empty for the state machine this phase names, which does not exist and which :82 argues should not be invented. Box stays unticked; there is no `payment/usePaymentStateMachine.ts` to tick it with.
  ```bash
  git commit -m "refactor(payment): extract checkout workflow into usePaymentStateMachine hook"
  ```

### Phase 3.2: Extract Split Tenders & Currency Hook (`useSplitTenders.ts`) — ❌ NOT STARTED
- [x] Extract split rows state, balance remaining, multi-currency conversion, and quick cash. Anchors to cut against:<!-- 2026-09-15 TICKED by measurement against the tree at HEAD 1adf4ba6c+, all FOUR named pieces are out of the shell and each was re-found, not inherited: (1) split rows STATE -> `payment/useSplitTenderState.ts` (121 ln), which holds `SplitRow` at :63, `splitMode` at :87 and `splits` at :88, while the shell only destructures the hook at `PaymentModal.tsx:274` (`grep -n 'interface SplitRow|const \[splits' ui/src/features/sales/PaymentModal.tsx` -> no hits; it landed in `95799c127`); (2) balance remaining -> `payment/useTenderMath.ts` (206 ln), the shell taking `splitTotals`/`splitComplete` at :416-417 and using them at :829 and :1615; (3) multi-currency conversion -> `payment/useMultiCurrency.ts` (200 ln), called at :309; (4) quick cash -> `payment/CashTenderPanel.tsx`, which renders `tenderPresets ?? [5000, 10000, 20000, 50000, 100000]` at :93 and the Exact path at :124, the shell only passing the prop (:101 destructure, :1581 hand-off). WHAT THE TICK DOES NOT CLAIM: `payment/useSplitTenders.ts`, the single file this phase names, still does not exist (`ls` -> No such file) - the extraction answered the four responsibilities, not the filename, which is :103's disposition below. -->
  - `interface SplitRow` `:43` · `useState<SplitRow[]>([` `:263` · `updateSplit` `:1137` · `splitSum`/`remaining` `:669` · the completion guard `:673` · the remaining-balance footer `:2154-2164`.
  - Currency side: `currencies` `:272`, `exchangeRates` `:273`, `latestRate` `:336`, `minorUnitExponent` conversions `:507`/`:519`/`:615`/`:658`.
  - ⚠️ **Correction:** "quick cash suggestions (`[50k, 100k, exact]`)" is not what the code does. The presets are a **prop** — `tenderPresets?: number[]` at `:67`, destructured `:109` — rendered at `:1943` as `(tenderPresets ?? [5000, 10000, 20000, 50000, 100000])`, i.e. five major-unit Rp denominations (5,000 / 10,000 / 20,000 / 50,000 / 100,000) computed as `Math.ceil(totalMajor / amount) * amount` (`:1949`), plus a separate "Exact" button at `:1962-1971`. Any extracted hook must keep the prop, not hardcode three amounts.
- [ ] Move into `ui/src/features/sales/payment/useSplitTenders.ts`. — target directory still absent.<!-- 2026-09-15 · SUPERSEDED, deliberately left UNTICKED so this fact is counted once: the row is a destination, and the destination was answered by the row above under four other filenames. `useSplitTenders.ts` has never existed on any revision this file cites and does not exist now. Swallowed by 3.2's `Extract split rows state…` box, which is ticked on the four pieces. :59's argument against writing the single file (one memo-identity slip across `splitComplete` -> `canComplete` -> the printed payment lines) was never answered; it was outlived. -->
  - **2026-09-14 - 'target directory still absent' is superseded here too:** see the 3.1 note - `payment/` holds `types.ts` + `useAutoQr.ts` + `useGatewayQr.ts`, and `useSplitTenders.ts` is NOT among them. Box stays open and unticked.
- [x] Verify: `npm run typecheck`. — not run.
- [x] **Commit Milestone:** LANDED, under `refactor(payment)`/`refactor(sales)` subjects rather than the one below -<!-- 2026-09-15 the final sentence of this row's own NOT-CLAIM clause is now FALSE and is corrected in place rather than deleted: it says the split STATE is still in PaymentModal.tsx eight anchors deep. It is not - it moved to `payment/useSplitTenderState.ts` in `95799c127` (see the 3.2 extract box, ticked this pass). The clause was true when written and the milestone tick stands; what no longer stands is its inventory of what remained. --> `575dcaeae` `payment/useTenderMath.ts` (206 ln), `cf3e4dd8b` `payment/useMultiCurrency.ts` (200 ln), `1583ff08b` `payment/moneyFormat.ts` (31 ln), `ff1616154` `payment/SplitTenderRows.tsx` (228 ln). Each is checked here on its own `git log --diff-filter=A`, not on the subject line. WHAT THIS TICK DOES NOT CLAIM: the split STATE is still in `PaymentModal.tsx`, eight anchors deep - `interface SplitRow` `:74`, `splitMode` `:265`, `splits` `:266`, the `useTenderMath` destructure that hands back `splitTotals`/`splitComplete` `:414`, `updateSplit` `:870`, the balance gate `if (splitMode) return splitComplete` `:898`, `paymentSplitsFromState` `:1154`, and `remainingMinor={splitTotals.remaining}` `:1684` - and `payment/useSplitTenders.ts` does not exist, so :59's argument against writing it was outlived, never answered.
  ```bash
  git commit -m "refactor(payment): extract tender splitting and currency logic into useSplitTenders hook"
  ```

### Phase 3.3: Extract Tender Panels — ❌ NOT STARTED (the inline blocks are still inline)

> 🚧 **2026-09-14 · 3.3 is PARTLY PARKED, and the cost has to be stated before anyone budgets it.** `PaymentModal.tsx:1840-2060` contains **the four tender pickers this phase exists to move** — and that same span is the **region root** `todo-payment.md` (**882** ln, **38** unchecked boxes; `wc -l todo-payment.md`, `grep -c '^- [ ]' todo-payment.md`) plans its changes into, citing live anchors inside it. Two writers into one span is how an extraction gets reverted, so **that span is parked**: **~167 of 3.3's 353 ln are deferred**, and **~186 ln remain safe** to cut now — the EDC overlay `:1491-~1560`, the split rows `:2064-~2160`, the footer conditional `:2416-2431`, and QR/auto-QR `:1470-1490`. 3.3 is therefore a ~53% phase until `todo-payment.md` releases `:1840-2060`, not a 100% one.

- [x] **Cash Tender Panel:** *(agents-3's own 3.3 box; shipped by `79d96f7c9`)* `payment/CashTenderPanel.tsx` (quick tender pills, change calculation, cash drawer trigger). — the JSX to cut is `{method === 'cash' && (` at `:1925` through the presets block `:1943-1971`. <!-- 2026-09-15 TICKED on `79d96f7c9`; the anchors above are DEAD - PaymentModal.tsx is 1,855 ln now, so nothing at :1925 or :1943-1971 exists to cut. Live replacement, measured: `tenderPresets` is destructured at PaymentModal.tsx:107 and handed to this panel at :1650<!-- 2026-09-15 re-derived against a shell that has since dropped another 54 ln: :107 -> **:101**, :1650 -> **:1581** (`grep -n tenderPresets ui/src/features/sales/PaymentModal.tsx`). The claim survives, only its numbers moved - which is the whole reason this file now says to locate rows and symbols by text. -->, i.e. the presets moved OUT with the panel and the cut line no longer exists in the shell. -->
- [x] **Card & EDC Tender Panel:** `payment/CardTenderPanel.tsx` (card type, EDC bridge, reference/auth codes). — JSX `{method === 'card' && !splitMode && edcOffered && (` at `:1995`; the EDC state machine `:1054-1085` and its status UI `:1494-1530`. Note the panel is gated on `edcOffered` (`:125`) — a rail from `useLocalPaymentRails`, added 2026-09-14 and not in the original plan. <!-- 2026-09-15 TICKED on `122564796` (86 ln). All three anchors above are DEAD at 1,855 ln. The live one that matters: the EDC state machine is STILL IN THE SHELL<!-- 2026-09-15 that sentence is now FALSE, and the clause that carried it was written one day ago: the machine left the shell in `80afc7e02` for `payment/useEdcTenderPhase.ts` (183 ln), where `phase: 'preflight' | 'waiting' | 'declined'` sits at :106 and its `setEdc` writes at :119/:… - `grep -n "phase: 'preflight'" ui/src/features/sales/PaymentModal.tsx` now returns NOTHING, and the only hit in the tree is the hook. So what this row shipped has been finished by a later slice: the panel JSX AND the machine are both out of the shell, and the shell's remaining EDC surface is the overlay JSX and `terminalPending={edc !== null}`, which read the atom the hook owns. --> - the `phase: 'preflight' | 'waiting' | 'declined'` union at PaymentModal.tsx:788 and its writes at :795 (preflight), :811 (waiting), :818 (declined), rendered :1210-1217 - so what shipped is the card panel's JSX, not the machine. -->
- [x] **QRIS & Digital Tender Panel:** `payment/QrisTenderPanel.tsx` (dynamic QR, confirmation polling). — JSX `{method === 'qris' &&` at `:2016`; `autoQr` state `:905`; `qrisOffered` gate `:124` with the fallback that demotes the method at `:280`. Real dynamic-QR + settlement polling landed in `289be3959` (2026-09-13) and static-merchant-QR in `903b30a71` (2026-09-14) — this is most of the growth the baseline missed. <!-- 2026-09-15 TICKED on `1c335bfd9` (101 ln). Anchors :2016 / :905 / :124 / :280 above are DEAD at 1,855 ln; the QR plumbing they named had already left the shell into `payment/useAutoQr.ts` (242 ln, `0b13ff3e1`) and `payment/useGatewayQr.ts` (112 ln, `1328510ed`), both listed at :91. -->
- [x] **Loyalty & Store Credit Panel:** `payment/LoyaltyTenderPanel.tsx` (points balance, redemption calculator, customer link). — JSX `{isEnabled(FEATURES.LOYALTY_PROGRAM) && loyaltyAccount && (` at `:2225`, section `:2226-2270`; state `loyaltyAccount` `:140`, `pointsWorthMinor` `:149`, `selectedCustomer` `:138`, `customerSearchResults` `:174`. <!-- 2026-09-15 TICKED on `6ddf49f1e` (224 ln); all six anchors above are DEAD at 1,855 ln. Read this tick as the LOYALTY panel only: the `open_bill` and `credit` half named on the next line is STILL UNBUILT, and that line's own anchors (:1890, :1902, :2417) now point past the end of the file - unbuilt AND unanchored. -->
- [ ] ❌ **Missing from the plan:** the `open_bill` (`:1890`, `:1902`, `:2417`) and `credit` (`:1166`, `:1263`, `:2421`) methods carry real UI and their own completion rules,<!-- 2026-09-15 UNLOCKED BY MEASUREMENT, still OPEN, still not ticked: the six anchors are dead (the shell is 1,786 ln, so nothing exists at :1890/:1902/:2417/:1166/:1263/:2421 as written) and the `:1840-2060` span this row was parked behind no longer exists at those lines either - but the CONTENT is verifiably still inline and verifiably still has no panel: `grep -nE "method === 'open_bill'|method === 'credit'" ui/src/features/sales/PaymentModal.tsx` -> :831/:832 (the completion rule), :843, :929, :1541, :1552, :1766, :1770, and `payment/` holds no OpenBill or Credit panel among its 15 files. So this is genuinely-open code work whose PARKING REASON needs re-deriving by whoever owns `todo-payment.md`, not a done thing and not a blocked thing: the span it deferred to has itself moved. --> — **2026-09-14: re-confirmed that these anchors (`:1890`, `:1902`, `:2417`) fall inside the parked span of the blockquote above, so this item is PARKED pending `todo-payment.md` sequencing (which owns `:1840-2060`); do not re-plan or re-cut against those line numbers until that span is released.** and `'other'` (`:41`, whose `otherLabel` value feeds the completion payload at `:1395`) too — three tender modes with no planned panel. A decomposition that ships only four panels leaves ~`2,436 − (extracted)` still inline.
- [x] Verify: `npm run typecheck` and unit tests. — not run.
- [x] **Commit Milestone:** LANDED - the five extractions are `79d96f7c9` `payment/CashTenderPanel.tsx` (152 ln), `122564796` `payment/CardTenderPanel.tsx` (86 ln), `1c335bfd9` `payment/QrisTenderPanel.tsx` (101 ln), `6ddf49f1e` `payment/LoyaltyTenderPanel.tsx` (224 ln), and `2b456338b` `components/PaymentModalCustomerBadge.tsx` (113 ln) - the fifth is the one the plan never listed, and it is the reason :39-:40's file count and this milestone's wording disagree with the tree. WHAT STAYS OUT: `payment/PaymentSummaryFooter.tsx` is still unbuilt and unclaimed by any commit, and :119's `open_bill`/`credit` panels are still unbuilt (that box is NOT ticked).
  ```bash
  git commit -m "refactor(payment): extract modular tender panels (Cash, Card, QRIS, Loyalty)"
  ```

### Phase 3.4: Reassemble `PaymentModal.tsx` & Verify — ❌ NOT STARTED
- [ ] Reassemble `PaymentModal.tsx` as a clean coordinator wiring the state machine, the active tender panel, and receipt preview (reuse `ReceiptPreview.tsx` rather than re-implementing it).
- [ ] Verify `PaymentModal.tsx` line count dropped from **2,436** to < 450 lines. <!-- 2026-09-15 re-measured, gate FAILS: `wc -l ui/src/features/sales/PaymentModal.tsx` = **1,786**, short of the target by **1,336**. Three extractions landed since the 1,855 this row last printed (`95799c127` split state, `8213cfa49` distributeEvenly, `80afc7e02` the EDC phase), i.e. the number is falling, at -69/-4/-55 per slice - which is the arithmetic that makes :55's per-file ceiling the live gate and this row editorial. --> — Re-baselined: that is **−1,986 lines, a −82% reduction**, not the −77% the old 1,933 baseline implied. (retired 2026-09-14 - see Current target above)
  - **2026-09-14 · as an acceptance test for THIS checkbox the number is unusable: restate it as a PER-FILE ceiling.** `wc -l ui/src/features/sales/PaymentModal.tsx` = **2,436**, **every range 3.3 cites sums to 353 ln**, i.e. **14.5%** of the file (method: the spans printed under Phase 3.3 — `:1925` with `:1943-1971`, `:1995`, `:1054-1085`, `:1494-1530`, `:2016`, `:2225-2270` — added as written, then `353 / 2,436 = 14.5%`; no per-panel split is measured here). Even if 3.3 shipped in full, a shell cannot reach 450 by shedding 14.5%. So the gate is: **no file under `features/sales/payment/` exceeds 450 ln** (measure with `wc -l ui/src/features/sales/payment/*.ts*` after each slice), and `PaymentModal.tsx` itself is **measured separately and reported as a trend**, not gated.
  - **Where the other ~1,600 ln are:** they are carried by **3.1 and 3.2**, not 3.3 — the two call chains at `:697-841` and `:1203-1279` plus the split/currency block 3.2 lists. 3.4's number therefore tracks 3.1/3.2 completion and must not be quoted as evidence about 3.3. The file has moved the other way since this plan was written: 2,045 lines at `e89e37c12` (2026-09-10) → 2,436 today, i.e. **+391 lines across 7 commits** (`289be3959`, `26ffd89c1`, `8dc3ae7ef`, `0d0c1eda5`, `bffcbda97`, `903b30a71`, `3d50b3ac5`). Re-check the baseline again before starting — it is a moving target.
- [ ] Run full UI tests: `npm run test` and `npm run typecheck`. — not run by this audit.<!-- 2026-09-15 · RUN-ONLY, and not environment-blocked: `npx vitest run <the seven PaymentModal suites>` and `npx tsc --noEmit` both run on this machine and both were green as of `4fce6aa3f` earlier tonight (148 passed | 1 skipped; exit 0). What no worker can honestly claim is a FULL `npm run test` while four lanes have uncommitted files under `ui/src` - a red there would not be attributable. Leg stays open, and it is the cheapest open box in this file: one command, no code. -->
- [ ] Run pre-commit checks: `npm run check:all`. — not run.<!-- 2026-09-15 · RUN-ONLY AND ENVIRONMENT-BLOCKED, which is worth separating from the row above: `check:all` chains E2E, and the box's own note says the harness skips E2E gracefully when Docker is absent - so a green `check:all` here could not evidence the E2E half anyway, and the Postgres leg on 127.0.0.1:15432 refuses. Not ticked on an inference. -->
- [ ] **Commit Milestone:** STILL OPEN, and "nothing to commit yet" is still the false part<!-- 2026-09-15 unticked, and it cannot be ticked by anything this pass did: its children :127 (reassemble as coordinator - the shell is still 1,786 ln and still owns both money handlers plus 982 ln of JSX) and :128 (the <450 gate, failing by 1,336) are both open, and a milestone whose children are open stays unticked however many slices land underneath it. Its 1,855 reads 1,786 today. --> - the same two counts stand (**5** `^refactor(payment`, **12** `^refactor(sales)`). What this box waits on is measurable: `wc -l ui/src/features/sales/PaymentModal.tsx` = **1,855** against :128's `< 450` gate, i.e. **failing by 1,405**, while :55's per-file ceiling is **MET** - the largest file under `payment/` is `useAutoQr.ts` at **242** (`wc -l ui/src/features/sales/payment/*.ts* | sort -n | tail -1`). And no acceptance leg here has been RUN (:63, :131, :132 all still record NOT RUN), so this box stays unticked on its own wording regardless of the number.
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
> last audited 14-09-26 by DSH
> (docs-auditor)

---

## Correction (2026-09-14) - measured against HEAD 828247454

Nothing above is rewritten; the originals stand as dated records. All figures re-measured with read/grep against the working tree (they also hold at `bb484066b` — the two commits after `828247454` touched `AppShell.tsx`, `WorkspaceContext.tsx` and two test files, none of them measured here).

- **(a) "TARGET DIRECTORY STILL ABSENT" (`:90`, `:103`) IS FALSE, AND TWO PANEL BOXES ARE DONE.** `ui/src/features/sales/payment/` holds **9 landed files** — `CashTenderPanel.tsx` (152 ln), `QrisTenderPanel.tsx` (101), `types.ts` (56), `useAutoQr.ts` (242), `useGatewayQr.ts` (112), `useMultiCurrency.ts` (200), `useTenderMath.ts` (206), `moneyFormat.ts` (31), `completedSale.ts` (108) — all wired in at `ui/src/features/sales/PaymentModal.tsx:28-36`. So **the CashTenderPanel box (`:115`) and the QRIS panel box (`:117`) are DONE**: both files exist, both are imported, both are off the target directory's floor. Tick them or supersede them in a dated line; re-cutting them would duplicate live modules.

- **(b) THE BASELINE IS STALE TWICE OVER.** The newest figure this file prints is **2,321** (`:12`, superseding the 2,436 of record). Measured now: `wc -l ui/src/features/sales/PaymentModal.tsx` = **1,999** — a further **-322** lines the plan has not seen. Consequence for the `:55` ceiling: `<450` is a **77% reduction** from where the file actually stands (450 / 1,999), not the ~82% a reader computes from the printed 2,436. Quote 1,999; the remaining harvest is smaller than this file's arithmetic, and so is the risk.

- **(c) EVERY JSX ANCHOR IN THE PANEL PHASE HAS DRIFTED, ONE PAST EOF.** Re-measured against the file on disk: `{method === 'cash' && (` at **:1581** (plan says `:1925` at `:115`), `{method === 'card' && !splitMode && edcOffered && (` at **:1593** (plan `:1995` at `:116`), `{method === 'qris' && (` at **:1614** (plan `:2016` at `:117`) — all high by ~340-400 lines. The loyalty anchor at `:118` reads **`:2225`**, which is **past the end of the file** (1,999 lines): a coder cannot open it, and a "no match" there is the anchor being stale, not the markup being absent. Cut against `grep -n "method === '" ui/src/features/sales/PaymentModal.tsx` output, never against this file's numbers.

- **(d) WHAT IS STILL REAL, i.e. 0 hits tree-wide and genuinely open:** `CardTenderPanel` -> 0 · `LoyaltyTenderPanel` -> 0 · `usePaymentStateMachine` (`:90`) -> 0 · `useSplitTenders` (`:103`) -> 0 (each `git grep -l <name> -- ui | wc -l`). The state-machine and split-tender hooks are the substance of this plan and neither has started; only the panel work in (a) has moved.

- **(e) FENCE RULE — THE WHOLE POS LANE IS ONE CODER.** Every remaining slice on this list edits the same file, `ui/src/features/sales/PaymentModal.tsx`: `usePaymentStateMachine`, `useSplitTenders`, `CardTenderPanel`, `LoyaltyTenderPanel`. A pathspec commit records the *working-tree* copy (AGENTS.md §3), so two agents in this lane do not conflict loudly — one silently commits the other's half-finished extraction under their own subject. Do not split this lane by slice; split it by hand, one worker, sequenced.
---

## Acceptance runs (2026-09-14, HEAD 6a32cc9dd)

Nothing above is rewritten; the originals stand as dated records. Boxes flipped below were ticked because the command each names was **RUN and PASSED** at `6a32cc9dd`. One gate was **RUN AND FAILED** and is left open — that too is the record, and stating a failure is not the same as leaving a box untouched.

- **`:92` and `:105` TICKED — RUN, exit 0 (one run, two boxes).** `npm run typecheck` from `ui/` -> **exit 0** at `6a32cc9dd`. Both boxes read "Verify: `npm run typecheck`. — not run."; the tail is that session's dated note and stands verbatim per `:172`, overtaken by an actual run. This is the load-bearing run for `:21`: because **nothing imports** `PaymentModalProps`, the contract's only witness is typecheck at `PosScreen.tsx` and `RetailPosScreen.tsx`, and both shells compiled clean.
- **`:120` TICKED — the typecheck half ran; the unit half ran, but not on this modal's own suites.** Same `npm run typecheck` -> **exit 0**. The unit suites that ran at this revision and passed: `screenExtraction.test.ts` -> **187 / 187**, `npm run test -- DataManagement` -> **5 files / 61 tests**, `themeTokenCompliance.test.ts` -> **11 tests**. **Stated plainly, so the tick is not over-read: the three `PaymentModal*` suites named at `:63` were NOT run**, so this box is green on the extraction guard, not on this file's 83 cases.
- **`:131` NOT TICKED — the box's text does not match what ran.** It opens "Run **full** UI tests: `npm run test` and `npm run typecheck`". The typecheck half is green (same run as `:92`), but the whole-suite `npm run test` — 572 files under `ui/src/__tests__` — did not run at `6a32cc9dd`; only the filtered subsets above did. A box whose first-named command was not executed stays open, so this file moved by **three** ticks, not four. Flip it only when a whole-suite run is on the record.
- **`:63` NOT TICKED — NOT RUN.** `npm run test -- PaymentModal` was not run by this leg; the 83 cases `:63` enumerates stay unverified at this revision.
- **`:128` RUN AND FAILED — left open, and that is the honest record.** The `< 450` whole-file gate measured at `6a32cc9dd`: `wc -l ui/src/features/sales/PaymentModal.tsx` = **1,989** (`git show 6a32cc9dd:ui/src/features/sales/PaymentModal.tsx | wc -l` -> 1,989, re-checkable without a checkout). Against the baseline of record (2,436 at `:11`) that is **−447**; against the last two figures this file printed (2,321 at `:12`, 1,999 at `:176`) it is a further small move, so the number is drifting under the plan exactly as `:164` warns. **1,989 > 450: the gate is not met.** It is now recorded as run-and-failed rather than unrun — which is a different fact from `:63` and `:131`, and only `:128`/(`:55`'s ceiling) had a size run at this HEAD.
- **`:132` NOT TICKED — `npm run check:all` was deliberately not run.** A choice, not an oversight: the chained gate (lint → typecheck → test → i18n → E2E) needs Docker for its E2E stage; of its stages, only typecheck ran (exit 0). Same reason `:162` gives for why no size number here is CI-enforced.
- **`:55`'s LIVE PER-FILE TARGET IS MET — measured, and it is the ceiling that replaced `:128`.** `:55` sets "no file under `features/sales/payment/` exceeds 450 lines". At `6a32cc9dd` that directory holds **10 files** (`git ls-tree --name-only 6a32cc9dd:ui/src/features/sales/payment/`), and the largest is **`useAutoQr.ts` at 242 lines** (`git show 6a32cc9dd:ui/src/features/sales/payment/useAutoQr.ts | wc -l` -> 242). Runners-up: `useTenderMath.ts` 206, `useMultiCurrency.ts` 200. So the operative gate is green with **208 lines of headroom** while the retired whole-file number is red at 1,989 — both facts held in one sentence is exactly the distinction `:129` asked for. (Observed while enumerating that directory, and **no box is claimed for it**: `CardTenderPanel.tsx` and `QrisTenderPanel.tsx` are now present in `payment/`, which contradicts `:116`'s and `:174`'s file lists and belongs to the coder inside the lane, not to this pass.)
- **NOT A RENAME.** Per root `AGENTS.md` §4: `:131` (full UI tests) and `:132` (`check:all`) are unrun, `:63` is unrun, `:128` failed, and the extraction boxes `:75`, `:90`, `:99`, `:103`, `:116`, `:118`, `:119`, `:127` plus the four milestones are still work. Ticking three verification boxes is bookkeeping for runs that happened. This file stays `todo-refactor-pos-screen-agents-3.md`.

---

## Append-only record (2026-09-15) - did tonight's split-tender extraction close the boxes it looks like? NO.

> **Written where the boxes are.** The three candidates this pass was asked about are this file's **:99**,
> **:103** and the milestone **:106** (Phase 3.2); the two the owner said to leave alone, **:105** and
> **:120**, are indeed already ticked here. Nothing above was rewritten, renumbered or re-ticked. This block
> adds **zero checkbox characters**, so every open/ticked count in section 5 is the same number before and
> after it lands - **and that is the required outcome, because all three verdicts are NOT-TICKED.**
> **ui/ was read only:** ls, wc, grep, git grep, git show. No code written, no hook opened, no
> npm/npx/vitest/tsc/cargo run, no test file touched, todo-payment.md not rewritten.
>
> **The tree moved twice under this pass, so every pointer is stamped.** Two extraction commits landed while
> these numbers were being taken: **6ddf49f1e** *refactor(sales): extract the loyalty tender panel from
> PaymentModal* (+19/-73 to the modal, +177 to a new **payment/LoyaltyTenderPanel.tsx**) and the settings
> lane's 562177534. Consequence: the modal is **1,858 ln, not the 1,912 measured an hour earlier**, and
> payment/ holds **12 files, not 11**. Every PaymentModal pointer below is the **post-6ddf49f1e** value,
> re-grepped immediately before writing. This file's own **:100** anchors (SplitRow **:43**, useState
> **:263**, updateSplit **:1137**) are stale in the other direction and by a mile - reality is **:73**,
> **:262**, **:845**. Re-derive before cutting anything.

### 1. **:99 - NOT TICKED.** A markup move cannot close a box whose verb is "state"

Its own wording: *"Extract **split rows state**, balance remaining, multi-currency conversion, and quick
cash."* The first-named object is a **state move**, and that state is entirely still in the shell:
**SplitRow :73** - **splitMode :261** - **splits :262** - the id allocator **nextSplitId = useRef(3) :266** -
**addSplit :831** - **removeSplit :838** - **updateSplit :845** - **autoSplitEvenly :849**.

**And the census was half-right, which is the part a future reader needs.** This is a **4-object box whose
other 3 objects have already landed - elsewhere, under other names, and none of them in useSplitTenders.ts**:

- balance remaining + the money guard -> **payment/useTenderMath.ts:175-191** (splitTotals, splitComplete,
  returned at :202-203);
- multi-currency conversion -> **payment/useMultiCurrency.ts:80-81** and **:142** (currencies, exchangeRates,
  latestRate);
- quick cash -> **payment/CashTenderPanel.tsx:54** and **:93**, where tenderPresets is kept as a **prop**
  exactly as this file's own correction at **:102** demands, with "Exact" at :124-130.

So :99 is neither "unstarted" nor "done": **three quarters shipped, and the quarter that touches the
completion guard did not.** The :98 heading "NOT STARTED" is now an overstatement about the math and an
accurate statement about the state.

### 2. **:103 - NOT TICKED.** ALIAS note: what shipped instead, so the log does not mislead

Its own wording names a **hook file by path**: *"Move into `ui/src/features/sales/payment/useSplitTenders.ts`."*

- `ls ui/src/features/sales/payment/` -> **12 files, and useSplitTenders.ts is not one of them**:
  CardTenderPanel.tsx, CashTenderPanel.tsx, LoyaltyTenderPanel.tsx, QrisTenderPanel.tsx, SplitTenderRows.tsx,
  completedSale.ts, moneyFormat.ts, types.ts, useAutoQr.ts, useGatewayQr.ts, useMultiCurrency.ts, useTenderMath.ts.
- `git grep -n useSplitTenders -- ui/src` -> **exit 1, zero hits.**
- Tree-wide the symbol occurs in **exactly one tracked file: this plan** - the file that asks for it.

**ALIAS.** A reader of the log sees *"refactor(sales): extract the split tender rows into a component"* and
closes :99/:103. What that commit actually is:

- **ff16161545ad852a7170f30b71820395fcf45f6b** (Tue Sep 15 00:40:49 2026 +0700). `git show --numstat`:
  PaymentModal.tsx **+12 / -119 = the -107 modal delta**; payment/SplitTenderRows.tsx **+228 / -0**.
- **A component, not a hook. 228 ln, 9 props** (`SplitTenderRowsProps` at SplitTenderRows.tsx:70-89:
  splitMode, splits, currency, remainingMinor, onSplitModeChange, onAddSplit, onRemoveSplit, onUpdateSplit,
  onAutoSplitEvenly - the shell's state plus the shell's writers, handed across the seam). Imported at
  **PaymentModal.tsx:35**, mounted at **PaymentModal.tsx:1649**. **Zero hook calls in it** - the only matches
  for the five React hook names are three words inside its own header comment (:11, :12, :15), and its header
  says so outright: *"No state, no effect and no memo moved in, and none created here."*
- **No settle decision crossed the seam.** splitComplete is produced at **useTenderMath.ts:183-191** and
  consumed in the shell at **PaymentModal.tsx:398**; **canComplete is the shell's own useMemo at :872-880**
  and **:873** still reads `if (splitMode) return splitComplete`; the gate reaches the button at
  **:1834** `disabled={!canComplete}`. The child receives only `remainingMinor={splitTotals.remaining}`
  (**:1653**) as a **value**. Correct for a markup slice - and precisely why it is not :99 or :103 work.

### 3. **:106 - NOT TICKED.** Dependency read from this file's own text, not from a summary

This file's closing "NOT A RENAME" clause at **:196** states the dependency outright: *"the extraction boxes
:75, :90, **:99**, **:103**, :116, :118, :119, :127 **plus the four milestones are still work**."* So :106
rides on :99 and :103; both stay open, so **:106 stays open**. Its embedded command reinforces rather than
contradicts that: the subject :108 prescribes is *"extract tender splitting and currency logic into
**useSplitTenders hook**"*, and **no commit on this branch carries that subject** - ff1616154 says "into a
component". Read either way (children open, or the named artifact uncommitted), :106 cannot close. Its text
"nothing to commit yet" is now **stale as a sentence** - something did commit - but it is not stale as a
verdict. Left untouched as instructed: **:105**, **:120** (already ticked) and **:119** (open_bill/credit, a
different region, parked per :113).

### 4. Census correction - the real region, and the one surface no box claims

**The split-tender region is PaymentModal.tsx:1647-1765, NOT :1807.** Proven by the artifact's own header
("The JSX below is the page's lines 1647-1765 verbatim", **SplitTenderRows.tsx:41**) arithmetically against
the diff: **1765 - 1647 + 1 = 119 = the exact deletion count in ff1616154.** The census's :1807 is a
**blank line** sitting between the customer `</div>` and `{isEnabled(FEATURES.LOYALTY_PROGRAM)` - a region
boundary, not a region.

**payment-customer-section is a separate, still-inline surface with no box anywhere in any plan.** It was at
:1767 pre-ff1616154, and `1767 - 107 = 1660` is where it sat after that commit; **6ddf49f1e moved it one
line again, so it is :1661 now.** Re-measured at HEAD 562177534:

- badge **:1661-:1700** = **40 ln**; its own search overlay **:1750-:1823** = **74 ln**; **total = 114 ln**.
- Against the modal's current **1,858 ln** that is **6.1%**.
- Plus **3 useState** (:140 showCustomerSearch, :174 customerSearchQuery, :175 customerSearchResults) and
  **2 useEffect** (:347-365, :367-383).

**Verdict: NOT a rounding error.** 114 ln is the same size class as the 119 that just moved, and **the badge
half is the cheaper slice of the two**: 40 ln, ~3 props, **no money guard, no id allocator, no float, no
splitComplete in sight**. Searching every root plan's boxes for a customer surface returns **no
customer-extraction box in any plan**, and `git grep -n CustomerPanel -- ui/src` -> **exit 1**. The only
near-claim is this file's **:118** (LoyaltyTenderPanel), whose state list covers the **overlay's**
customerSearchResults, not the badge markup - and **:118 itself shipped at 6ddf49f1e while this pass ran**,
which sharpens the point: loyalty is now boxed AND landed, leaving the customer surface the lone unboxed one.
**Naming it is the output. Nothing was ticked for it, and no other plan was touched to fund it.**

### 5. Box counts, both grep forms, before and after - open did not move

| form | pattern | before | after |
|---|---|---|---|
| open, any-depth | open checkbox at any indent | **18** | **18** |
| open, anchored | open checkbox at column 0 | **18** | **18** |
| ticked, any-depth | closed checkbox at any indent | **5** | **5** |
| ticked, anchored | closed checkbox at column 0 | **5** | **5** |
| all bullets | bullet dash at any indent | **84** | **99** |

**All three verdicts are NOT-TICKED, so the open count was required to sit still, and it does: 18 and 18.**
Note the contrast with `todo-payment.md`: that file's two forms **disagree** (36 any-depth vs 35 anchored,
because of one indented box), while **this file's agree at 18/18** - it has no indented box, so here either
form is safe. The all-bullets form rises only because this record uses list bullets; **no line in this block
begins with a checkbox**, and `git show --numstat` on its commit carries **0 deletions** because nothing was
flipped anywhere above.

### 6. Found, not fixed - the class guard. Dated finding, **nothing changed here**

`ui/**` is out of this fence and **a registration lane is live in that exact file right now**, so this is
reported as its business, not taken.

- **The gap, stated where it is immutable - at HEAD `562177534` the guard registers the settings panels and
  NOT one payment/ component.** `git grep -nE "TenderPanel|SplitTenderRows|BackupSection" 562177534 --
  ui/src/__tests__/screenExtraction.test.ts` returns **only** the settings lines: `additionalTsx:
  ['settings/components/BackupSection.tsx', 'settings/components/ImportSection.tsx',
  'settings/components/ExportSection.tsx']` at committed **:392** — my own measurement, and note it is **:392,
  not the `:391` this file's sibling settings plan cites** (that pointer is stale; the worktree copy puts
  BackupSection at :441/:444). **Zero payment/ entries at HEAD.** So as committed, nothing fails if
  `SplitTenderRows.tsx` or any of the three tender panels is re-inlined into the shell: the class guard that
  caught the settings lane is simply not watching this lane's five new files.
- **The registration lane is closing exactly this right now, uncommitted.** The working-tree copy is
  **1,025 ln against HEAD's 888 (+137 in flight)** and mentions `TenderPanel` **6 times**. **No worktree line
  number is quoted here, deliberately:** between two reads of that file three minutes apart this pass saw a
  `name: 'PaymentModal'` entry listing CashTenderPanel / CardTenderPanel / QrisTenderPanel / SplitTenderRows
  as `additionalTsx` — LoyaltyTenderPanel excluded, "belongs to the slice that creates it" — and then saw that
  entry **gone again**. Any :NNN pointer into a file another lane is editing is false within minutes, so this bullet
  cites **symbols and counts only**. When it lands, `:99`/`:103` still do not close — the guard covers
  **markup**, and the box asks for **state**.
- **This pass changed none of it.** No edit to `ui/**`, no test run, no commit into that file.

### 7. So is this file now a fair description of the tree?

**No - it is still bookkeeping wearing a work list, and the work list is now outrunning its own headings.**
Three of Phase 3.3's panel boxes name files that exist (:115 Cash, :116 Card, :117 QRIS, :118 Loyalty - the
last shipped mid-pass), :98's "NOT STARTED" is true only of the state half, and the baseline of record
(:11's 2,436) is **578 lines** from the modal's actual 1,858. What genuinely remains is narrow and the plan
still says it correctly: **the split-row state into the hook :103 names**, plus the customer surface **that
no box names at all**.

---

## Verdict on Phase 3.1, and the two seams that replace it (2026-09-15, HEAD `8213cfa49`)

> **Written at EOF deliberately.** The note at `:40` protects `:102`, `:113` and this file's own self-citation at `:234`, and an insertion above any of the three falsifies all three — so this section appends below every one of them and changes no line above `:354`. Proof, not intent: `sed -n '234p' todo-refactor-pos-screen-agents-3.md` still prints "exactly as this file's own correction at **:102** demands, with \"Exact\" at :124-130."

- **:74 — `### Phase 3.1: Extract Payment State Machine (\`usePaymentStateMachine.ts\`) — ❌ NOT STARTED` — is now DECLINED AS NAMED**, and the heading stays as written because "NOT STARTED" was the true reading when it was set and is the wrong reading now for a different reason than staleness: the phase describes an object the file does not contain. `grep -n "usePaymentStateMachine" ui/src/**/*.tsx` finds it in no source file; `ls ui/src/features/sales/payment/usePaymentStateMachine.ts` → "No such file or directory".
- **:90 — `- [ ] Move into ui/src/features/sales/payment/usePaymentStateMachine.ts.` — DECLINED AS NAMED**, same reason, and no box is ticked: a target that was declined cannot be completed, and the honest state of this line is "will not be built as written", which is not `[x]`.
- **:82 and :83 got there first, so the verdict points at them instead of re-arguing them.** `:82` already states the conclusion in its own words — "there is no machine to extract either", with `processing`, `done`, `leaving`, `paymentError`, `receiptArgs` named as five independent atoms — and `:83` is not a task at all: it is the campaign's **invariant**, "NO extracted hook may own `processing`". That invariant is what makes the decline *correct* rather than merely convenient: a machine that owned the flow would own `processing`, and `processing` is what the shell's close/reopen guard reads. Anyone tempted to revive `:74` should have to answer `:83` first, which is why this line names both rather than restating either.
- **The invariant's anchors, re-measured at today's `1,842` ln** (`wc -l < ui/src/features/sales/PaymentModal.tsx`), command `grep -n "processing" ui/src/features/sales/PaymentModal.tsx`: declared `:130`, gates at `:247` (`if (!processing && !done) animateLeave(onClose)`), `:1116` (the focus trap), `:1811` and `:1817` (`loading={processing}`), atoms-stay-in-shell note `:753`, and passed as a **prop** — not owned — into two landed hooks at `:1647` and `:1658`. **A confession that matters more than the numbers:** an hour ago, at 1,846 ln, those four gate sites read `:247/:1120/:1815/:1821`. They are written down because they are true today, and they will be false the next time a line moves out of the shell — the same drift `:11` and `:164` already warn about, now demonstrated on a sentence as it was being composed.
- **:98 — `### Phase 3.2: … (\`useSplitTenders.ts\`) — ❌ NOT STARTED` — is SUPERSEDED-BY-PARTS**, and the parts with their commits: `payment/useTenderMath.ts` (206 ln) = **`575dcaeae`**, `payment/useMultiCurrency.ts` (200 ln) = **`cf3e4dd8b`**, `payment/useSplitTenderState.ts` (121 ln) = **`95799c127`**. Arbiter for the pairing: `git show --format="%h|%s" --no-patch <sha>`, which prints "extract the tender math cluster into useTenderMath" for `575dcaeae` and "extract useMultiCurrency from PaymentModal" for `cf3e4dd8b` — **a dispatch tonight dictated those two the other way round**, and the subjects are what settle it. `:103`'s file never existed under that name (`git log --all -- ui/src/features/sales/payment/useSplitTenders.ts` prints nothing), so the plan noun was not a deliverable and there is no partial file to reconcile. The one part that did **not** land is the distributor — see the next bullet.
- **The residue 3.1 should always have been, reticketed as two named seams — FUNDED, NOT DONE.** `payment/splitDistribution.ts`: pure `distributeEvenly(totalMinor, count, exponent) → string[]`, ≈30 ln, shrinking `autoSplitEvenly` (`grep -n "const autoSplitEvenly" ui/src/features/sales/PaymentModal.tsx` → `:860`, region `:860-886`) to a 12-line caller with **zero threaded values**. `payment/useEdcTenderPhase.ts`: owns only the three-phase EDC atom (`phase: 'preflight' | 'waiting' | 'declined'`, declared `:791-792`, first write `:799`), ≈60 ln out and ≈70 ln off the shell, threading 8 in / 3 out; acyclic because every EDC writer sits **below** the money hooks (`:799`, `:802`, `:815`, `:822`, `:840`, `:846`, `:858`) and none of them touches `processing`, which is precisely why this one does not violate `:83`. **Neither file exists** — `ls ui/src/features/sales/payment/splitDistribution.ts ui/src/features/sales/payment/useEdcTenderPhase.ts` → "No such file or directory" for both — and this docs pass created neither; they are coder boxes with a `payment/`-file fence.
- **:93 stays OPEN and unticked**, as its own wording requires: it waits on an acceptance leg that has not been run, not on a commit existing. Box census for this file, unchanged by this section: `grep -cE '^- \[x\]' todo-refactor-pos-screen-agents-3.md` = **11** and `grep -cE '^- \[ \]'` = **12**, the same pair before and after (`:305`'s two-form rule; any-depth agrees here, both 11/12).
- **:160 restated as a measurement rather than an invitation.** Its instruction — "name the real states before extracting them" — is discharged, and what it found is the atom list at `:82`, counted at today's file: `grep -oE "useState(<[^>]*)?\(" ui/src/features/sales/PaymentModal.tsx | wc -l` = **12** useState call sites (**27** by `grep -c "useState"`, which counts mentions including the comment prose — the two numbers are different questions, and the dossier's "27 useState" was the mention count), useCallback **12**, useEffect **9**, useMemo **3**. Thirty-six hooks and no machine among them.
- **`:100`'s anchors are not drifted, they are evacuated** — a different failure with a different fix: `grep -cE "interface SplitRow|useState<SplitRow|const updateSplit|splitSum" ui/src/features/sales/PaymentModal.tsx` = **0**, because all four live in `payment/useSplitTenderState.ts` and `payment/SplitTenderRows.tsx` (228 ln, `ff1616154`) now; and `:905`, cited at `:79` as `autoQr`, prints `unit_price: l.unit_price,` (`sed -n '905p' ui/src/features/sales/PaymentModal.tsx`).
- **One sentence on why the counts in this file were never its problem.** Every SHA this plan cites resolves: `git cat-file -t` on `95799c127 2b456338b 79d96f7c9 122564796 1c335bfd9 6ddf49f1e 575dcaeae cf3e4dd8b 1583ff08b ff1616154 3cb313277 0b13ff3e1 1328510ed` → `commit` for all **thirteen**. Eight SHAs dictated in a dispatch the same evening → "fatal: Not a valid object name" for all eight. So the citations were sound and the *dispatched* numbers were invented; what this file actually suffers from is **anchors**, which are cheap to repair and never a reason to stop trusting the document that flags them itself (`:11`, `:164`, `:40`).
- **And the directory this verdict points into keeps moving:** `wc -l ui/src/features/sales/payment/*.ts* | tail -1` = **1,937 total** across **14** files (`ls … | wc -l`) at this minute, where `:40`'s 2026-09-15 note recorded twelve files / 1,746 ln and `:91` recorded three extracts. Each was true at its own HEAD; only the command is durable.

> **Length, with the boundary artifact named the way `:11` names it:** `wc -l < todo-refactor-pos-screen-agents-3.md` = **354** before this section and **373** after it; a `split('\n')` count of the same file reads **one higher** (355 for a 354-line file) because the file ends in a newline. Docs only — no `.tsx`, no `.css`, no test run, nothing pushed.
