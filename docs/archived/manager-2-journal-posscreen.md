# MANAGER-2 JOURNAL - POS-SCREEN. LIVE STATE BLOCK (authoritative head, READ FIRST)
## >>> 2026-09-11T14:2xZ - CAMPAIGN 2 IS THE ACTIVE OBJECTIVE <<<
- ACTIVE OBJECTIVE (verbatim): implement todo-refactor-pos-screen-agents-2.md carefully (Agent 2: PosScreen cart UI
  panels, modals & peripherals). Goal goal-06110e85-26f2-44c8-8c1a-062edefeb2f9, phase active, round ~17/256.
- EVERYTHING ABOVE CAMPAIGN 1 CONTEXT ONLY: todo-refactor-pos-screen-agents-1.md is DONE (19/19, renamed
  done-todo-refactor-pos-screen-agents-1.md). DO NOT RE-OPEN CAMPAIGN 1. Its P-P/P-W entries are history.
- THIS FILE = mine (campaign 1 + campaign 2 for pos-screen). manager-2-journal.md = SIBLING'S (Bridge Builder /
  Agent-2 rust campaign, also self-labelled 'Manager-2'). NEVER write the sibling's file. ASCII ONLY in both.
- Repo rules in force: branch 0.0.37 only (never create/switch), conventional commits with EXPLICIT pathspec, never
  git add . / -A / bare commit / --amend / stash, no push without an order, tsc+eslint only via npm run/npx from ui/,
  bash via the declared tool (bare bash = WSL hang). Pre-commit hook step 1 = 'cargo fmt --all' over the WHOLE
  worktree (it reformats siblings' Rust); step 9 = repo-wide ui typecheck, currently FOREIGN-red at
  ui/src/features/workspaces/WorkspaceHome.tsx (TS6133 :14, TS2440 :15) -> OZPOS_SKIP_TYPECHECK=1 is the
  pre-authorised narrow escape for that one cause; --no-verify is forbidden.

## BOX INVENTORY, campaign 2 (metric = checkbox LINES matching '- [ ]' in the todo, measured 14:20Z)
- 18 unchecked / 0 checked, file 86 lines. CORRECTION: an earlier note of mine said 16 - that count was wrong or
  used a different metric; 18 is what grep returns now. Lines :45-50 and :78-80 are sub-bullets WITHOUT checkboxes,
  which is most likely where a 16 came from. Re-measure at the completion pass; never copy a count forward.
- Box map: :43-44 Phase 2.1 analysis (2) | :51-59 Phase 2.1 extraction + milestone (6) | :63-69 Phase 2.2 (5+) |
  :75 wait gate | :76-85 Phase 2.3 (5 + milestone). Flips happen ONCE, in the P-P6 completion pass, with SHAs and
  the deviations register - not per wave.
- Mandated subjects, verbatim: :59 'refactor(pos-ui): extract CartLineItem and CourseSelectorBar presentation
  components' | :71 'refactor(pos-ui): extract CartFooterTotals and CartActionBar components' | :85 'refactor(pos-ui):
  consolidate CartPanel and reduce PosScreen to composition root'. All three used exactly; :59 and :71 LANDED.
- :81 'dropped from 2,329 to < 600 lines' = CLOSED AS A DOCUMENTED DEVIATION (wiring band alone is 611 raw lines and
  is fenced from this campaign three times over; realistic mandated-only end ~1,290). Do not re-litigate.
- :75 WAIT GATE, verified SATISFIED at 14:20Z: 85adf2e49 'refactor(pos-cart): extract cart line manipulations into
  usePosCartActions hook' exists (c24904a7a completes it). PROCESS NEAR-MISS, MINE: I dispatched wave 3 BEFORE
  running this check. The outcome was correct by luck. NEW RULE: a todo box that NAMES a wait gate is a precondition
  to verify before the dispatch, in the same call, not after it.

## GATE CONTRACT (permanent, campaign 2): NINE suites, expect 202 passed / 1 skipped
PosScreen.test 18 | PosScreen.integration 106 | PosScreenCoreFlow 22 (+1 skip) | usePosState 29 |
PosScreenDeductionLocation 5 | cartExtraction 3 | CourseSelectorBar.test 6 | nativeTooltipCompliance +
storageKeyPins 13. Report PER-FILE counts, never just the aggregate. Static gates are SOURCE-TEXT-keyed: a
byte-faithful JSX move can redden the tooltip ratchet, the dead-class rule, or a dead eslint directive.

## CAMPAIGN-2 COMMIT LEDGER (subject = durable id; HEAD moves under us constantly, do not key on a sha)
ceace1a63 2.1 CartLineItem(196)+CourseSelectorBar(53) | 15e2200ed CourseSelectorBar.test.tsx +182 (6 tests) |
5a0e87a22 2.2 CartFooterTotals(340)+CartActionBar(87), 5 paths +478/-314 | 94f7cb765 micro-commit A, dead a11y
directive in CartLineItem, 1 file +1/-1. Wave-2 gate GREEN first pass. 2.2 correctness review PASS WITH NOTES
(0 Critical/Major, actions 51/51 and footer 259/259 byte-identical).

## LIVE DASHBOARD (in-flight only)
| worker | role | fence | dispatched | state |
| c8911a4e-f06c-42b3-8ae5-4d53f27bf7b0 | coder | PosScreen.tsx + NEW components/CartPanel.tsx +
  ui/src/__tests__/cartExtraction.test.ts + scripts/native-tooltip-baseline.json | 14:12Z 45-min box | WAVE 3 RUNNING |
| subagent-29 | researcher | read-only, FROZEN ANCHOR commit (never the live PosScreen.tsx) | 14:14Z 15-min box | RUNNING |
- Timers live: schedule-9 (14:59:59Z, wave-3 coder dead-man), schedule-10 (14:30:08Z, researcher). DELETE ALL before
  any final reply. Coder slots 2-6 idle WITH REASON: 2.3 is one cohesive change-set in one file a lane must own alone.
- NEXT after 2.3, in strict order (all three edit PosScreen.tsx, so they serialize): nine-suite gate -> 2.3 correctness
  reviewer -> S1 adopt useCartWidth twin + TWO storageKeyPins edits in one commit -> S2 adopt useCartKeyboardNavigation
  -> S3 locked-cart = DO NOT DISPATCH (STALE twin, data-loss vector; report as owner-visible dedup debt) ->
  npm run check:all (box :82) -> P-P6 completion pass: flip 18 boxes, SHAs, deviations register D1-D9 re-measured,
  rename to done-todo-refactor-pos-screen-agents-2.md, one docs commit.
- Journal-loss rule (born when P2-A17..A31 evaporated): a ruling is journalled only after grepping it back OUT of the
  file. 'I wrote it' is not evidence.

--- 8< --- history below this line --- 8< ---

# Manager-2 Journal — POS-Screen campaign (todo-refactor-pos-screen-agents-1.md)

> NEW campaign journal (2026-09-10 ~16:4xZ). Shared manager-2-journal.md hit its instruction budget; this file is THIS session's memory for the pos-screen objective. Completed agents-1 campaign ledger lives in the shared journal (D-A1..D-A11). NOTE: R2 (subagent-34) misattributed this file to a "sibling pos-screen session" — it is MINE (P-P1).

## Goal & Architecture
- Objective: implement todo-refactor-pos-screen-agents-1.md carefully (user's direct order). Goal id goal-97a2efab-2440-4ef8-b655-f6edb5f51e39.
- Standing repo rules: branch 0.0.37 only, conventional commits + explicit pathspec, no push, forward slashes, Git-bash (no WSL), ≤500-line reads. Multiple sibling campaigns commit every few minutes (bridge Wave-D relocation WIP dirty: kds/refunds/shifts desktop+bridge; foreign workspaces UI lane: WorkspaceHome.tsx + components/).

## Scope (R1 subagent-33 dossier, ACCEPTED)
- Todo file: 79 ln, **19 boxes unchecked, 0 checked**; 4 commit milestones; work NOT started (confirmed: git log --grep='refactor(pos-' EMPTY @ HEAD 1df45206a; 5 owned files absent; symbols still in-file).
- Phases: 1.0 Baseline & Characterization (3 boxes: screen test + typecheck + line count) · 1.1 Pure Calcs & Tax Watcher → utils/cartCalculations.ts + components/CartTaxWatcher.tsx · 1.2 Shift State Machine → hooks/usePosShifts.ts · 1.3 Held Carts & Open Bills → hooks/usePosHeldCarts.ts · 1.4 Cart Line Actions & Deduction → hooks/usePosCartActions.ts.
- Mandated subjects (verbatim): "refactor(pos-cart): extract cart calculations and CartTaxWatcher component" · "refactor(pos-state): extract shift lifecycle into usePosShifts hook" · "refactor(pos-state): extract held cart management into usePosHeldCarts hook" · "refactor(pos-cart): extract cart line manipulations into usePosCartActions hook". Prefix rule: refactor(pos-cart)/refactor(pos-state) only.
- Gates (in ui/): npm run test -- src/__tests__/PosScreen.test.tsx (18 cases) + npm run typecheck.
- Agent-1 is the campaign's inter-agent trigger: agents-2's CartPanel assembly phase waits on my Phase 1.4 subject.

## Tree facts (R2 subagent-34 dossier)
- PosScreen.tsx measured ~2,463 ln (todo said 2,329; +133 drift). PaymentModal.tsx 2,046 (Agent 3's). Retail twin: RetailPosScreen.tsx 1,809 + own CartTaxWatcher :61 — OUT of scope.
- Pre-existing helper files with duplicates of the campaign's symbols: posScreenUtils.ts 51 ln (exports clampCartWidth/lineThumbnail) · posScreenHooks.ts 303 ln (private clampCartWidth) · usePosState.ts 343 ln. NOT in owned fence.
- Test coverage: 32 pos-related vitest files ≈663 cases (PosScreen.test 18 · PosScreen.integration 106 · PosScreenCoreFlow 22 · usePosState 29). Pre-commit hook: ui typecheck ~21s hard fail when ui/src staged; i18n lint fail-closed; bundle parity; ftl orphans.

## Rulings (P-P, recorded — all reversible)
- P-P1: manager-2-journal-posscreen.md is THIS session's file; R2's "sibling pos-screen session" attribution corrected. No other pos-screen session observed.
- P-P2 (OQ1+OQ2): "Lines 1–450" band + "hook calls only" are ADVISORY. Agent-1's PosScreen.tsx ownership = top region (imports/constants/types/pure helpers/hook decls/wiring) above the presentation JSX. Removing moved definitions from that region is in-fence. Mount of CartTaxWatcher (~:2006) stays untouched.
- P-P3 (OQ3): NO consolidation. cartCalculations.ts is a third mandated home per todo letter; posScreenUtils/posScreenHooks/usePosState untouched; dedupe = owner follow-up, recorded at completion.
- P-P4 (OQ4): Retail twin out of scope. P-P5 (OQ5): no i18n edits; if extraction surfaces a user-visible string, worker files FCR and parks it.
- P-P6 (OQ6): completion = flip 19 boxes + SHA provenance in the todo doc, then rename to done-todo-refactor-pos-screen-agents-1.md (repo convention observed: done-todo-tools-agents-1.md, done-todo-refactor-oz-pos-app-agents-1.md). Writer pass at the end.
- P-P7 (OQ7): git baseline verified by manager — zero refactor(pos-*) commits.

## Wave plan (serialization: all phases edit PosScreen.tsx → strictly sequential)
- Wave 1 = Phase 1.0 + 1.1 (one coder: 20592a5e recycled; fence: 2 NEW files + PosScreen top region).
- Wave 2 = Phase 1.2 usePosShifts · Wave 3 = Phase 1.3 usePosHeldCarts · Wave 4 = Phase 1.4 usePosCartActions (each its own coder dispatch on prior wave's gate).
- Campaign-end gate: PosScreen.test + PosScreen.integration + PosScreenCoreFlow + usePosState + typecheck; then P-P6 writer pass.

## Live Dashboard
| id | role | fence | state |
|---|---|---|---|
| 63f54409 | coder (Wave 1, respawn) | cartCalculations.ts (NEW) + CartTaxWatcher.tsx (NEW) + PosScreen.tsx top region | in flight (Wave 1) |

> SESSION BREAK ~22:26Z: prior session's coder 20592a5e did not survive the session boundary (pool empty; no settle report, no commit observed by me). Wave 1 re-spawned fresh as 63f54409 with step -1 adopt-or-verify guard (checks git log for a landed refactor(pos-cart) commit + fence-file WIP before touching anything). 20592a5e's in-flight work, if any, is on-disk WIP within the fence — handled by the respawn's step -1.


## Completed & Commit Ledger
(empty)

## Verification Evidence
- Baseline: git log --grep='refactor(pos-' = EMPTY @ HEAD 1df45206a; fence collision-free (dirty tree = foreign lanes only).

## Metrics
- waves 0 · rework 0 · violations 0 · breaker trips 0 · box overruns 0

## Assumptions
- A-P1: implement as written, autonomous. A-P2: sibling overlap mapped (none in sales/ today; re-check per dispatch). A-P3: todo's mandated gates are the per-phase minimum; campaign-end gate adds the broader pos suites.

### P-P8 (session break #2 + Wave-1 resume, 00:16Z)
- Second session boundary: Wave-1 coder 63f54409 lost with the pool (no settle report). On-disk aftermath: BOTH new files written 05:34 (cartCalculations.ts 1,714 B; CartTaxWatcher.tsx 1,085 B) + PosScreen.tsx modified (2,462→2,391 working) — but NO refactor(pos-*) commit landed. Sibling bridge campaign is deep into Waves D/E (HEAD 119ec84f4 'test(bridge): relocate kds unit tests'; pos/kds relocations already landed there).
- Wave 1 re-dispatched as RESUME-AND-FINISH coder (fresh, this turn): audit orphaned WIP → path-limited stash for TRUE Phase-1.0 baseline (pristine gates + line counts) → pop → post-extraction gates → grep proofs → commit mandated subject explicit pathspec. Fence + rulings unchanged (P-P2 band advisory; P-P3 no consolidation).
- Metrics: registry loss +2 (two session boundaries lost in-flight coders; WIP on disk survived both times — the disk, not the pool, is the durable state).

### P-P9 (third session boundary — pool survived this time, 00:19Z)
- User reported another new session; pool check shows Wave-1 RESUME coder 503a9e6f still RUNNING (spawned 00:17Z this session) — no re-summon needed. Re-verified: zero refactor(pos-*) commits; same 3 fence paths dirty (PosScreen 2,391 working / 2,462 committed; both new files present 05:34); git stash list EMPTY (coder has not reached its baseline-stash step yet). Sibling bridge campaign interleaving normally (HEAD now 'test(bridge): relocate kds unit tests to oz-bridge'); sales/ fence collision-free.
- Protocol now hardened for future boundaries: on any resume, FIRST re-verify (a) git log --grep for landed commits, (b) fence-file WIP mtimes vs HEAD blob line counts, (c) stash list — THEN decide respawn vs continue. Disk is the durable state; the pool is not.
- Metrics: registry loss stays 2 (this boundary did not lose a worker).

### P-W1 (Wave 1 LANDED + manager spot-verify GREEN @ dffe250a5)
- Commit **dffe250a5** "refactor(pos-cart): extract cart calculations and CartTaxWatcher component" (VERBATIM subject match) — parent a7485e17a, ancestor of HEAD b51ba70f9. Fence audit EXACT 3 files +78/−74: PosScreen.tsx 77→ (top region only) · components/CartTaxWatcher.tsx +34 NEW · utils/cartCalculations.ts +41 NEW. sales/ porcelain clean after commit (zero dangling WIP).
- MANAGER RE-RUN (merged tree, independent of coder tails — D-B5 protocol): PosScreen.test.tsx **18 passed / 18**, 2.95s exit 0 (identical to coder + to my pristine baseline) · typecheck = **2 errors, BOTH FOREIGN** (workspaces/WorkspaceHome.tsx TS6133 + TS2440), zero diagnostics under features/sales/ · line count 2,462 → 2,391 (−71) · 7 removed module-level symbols == 7 exported symbols (byte-equivalent move).
- Coder honest deviation ACCEPTED: used the hook's own documented narrow escape `OZPOS_SKIP_TYPECHECK=1` (.githooks/pre-commit:317-320) because the hook's repo-wide tsc step failed on the 2 FOREIGN errors; other 9 hook gates ran and passed; explicitly avoided --no-verify. Compensation = my independent typecheck re-run above. Phase 1.0 baseline evidence captured on the PRISTINE tree via PATH-LIMITED stash (2,462 ln, tests green, typecheck red-foreign pre-existing → proves the red is not mine).
- **RULING P-W1b (standing, applies to Waves 2-4)**: repo-wide `npm run typecheck` is currently RED on a foreign lane (ui/src/features/workspaces/WorkspaceHome.tsx + its untracked components/ — sibling not yet landed). Until that lane lands: (a) every ui commit's hook typecheck step will fail through no fault of mine → coders ARE PRE-AUTHORIZED to use `OZPOS_SKIP_TYPECHECK=1` (that step alone, never --no-verify, never OZPOS_SKIP_* others); (b) the gate is COMPENSATED by the manager re-running typecheck at each wave gate and requiring ZERO diagnostics under features/sales/ (delta-vs-baseline = 0), not repo-wide green; (c) campaign-end report must flag the workspaces lane as an external blocker on repo-wide ui typecheck.
- Ledger: Phase 1.1 = dffe250a5. Backlog updated: Wave 2 = usePosShifts (dispatched), Wave 3 = usePosHeldCarts, Wave 4 = usePosCartActions — strictly sequential.
- Metrics: waves integrated 1 · rework 0 · fence violations 0 · breaker trips 0 · box overruns 0 (Wave 1 landed inside its extended box after the session-boundary respawn) · registry loss 2 (session boundaries; disk WIP survived both) · narrow-escape uses 1 (pre-authorized by ruling, compensated).

### P-W2pre (Wave 3/4 sizing dossier ACCEPTED — subagent-14, ~00:5xZ)
- Todo verbatim confirmed: 1.3 = "Extract cart hold, open bill listing, recall bill, and delete bill logic into hooks/usePosHeldCarts.ts"; 1.4 = "Extract item addition, quantity modification, course assignment, line removal, and deduction location override into hooks/usePosCartActions.ts". Subjects as briefed. Fence L22-33: mandated NEW files + "Hook calls only" in PosScreen top; JSX below hook decls = Agent 2's, FORBIDDEN.
- 1.3 MEASURED: ~96 ln core in 2 blocks (:767-781, :1105-1187), ~12 symbols, 1 effect, 2 exit animations, one 1.2 pass-through (activeShift gates handleOpenBill :1123). VERDICT: one box. Ambiguous extra (LOCKED_CART_KEY :402 + restore effect :411-440 + handleLock :859-883) = park-to-localStorage family → NOT in todo 1.3 prose → STAYS in PosScreen.
- 1.4 MEASURED: ~144 ln core across 6 scattered blocks (:547-586, :635-668, :832-855, :893-951) + keyboard nav :957-1038 (82 ln, stays). VERDICT: SPLIT PRE-AUTHORIZED — 1.4a add/deduction/override (ensureCart, handleAddProduct, deduction trio, overrideTarget+handleOverrideConfirm, qty wrappers ≈95 ln); 1.4b remove/undo + discount/promotions (≈50 ln). 1.4 riskier than 1.3.
- **RULING P-W2a (composition)**: handlePaymentComplete :811-830 STAYS in PosScreen composing both hooks (JSX-bound at :1960 PaymentModal onComplete); its inner delete-held-cart block :819-826 does NOT move. If a standalone delete-bill handler exists (search HeldCart delete APIs), it moves; the inline block never does.
- **RULING P-W2b (exit animations)**: openBillsExit / openBillInputExit must move INTO usePosHeldCarts — requestClose is called INSIDE the handlers (:1151/:1183), so splitting refs from handlers would break the close animation. Hook must return them 1:1.
- **RULING P-W2c (JSX-fence hazard, load-bearing)**: TWO inline JSX sites mutate soon-to-be-hook state — ensureCart(...) at :1558 and the clear-cart arrow resetting setCartId + deduction trio at :1866. The extraction hooks MUST RETURN those raw symbols (ensureCart, setCartId, deduction setters) so JSX keeps working through destructured names with ZERO edits below the hook region. A coder tempted to "clean up" those two arrows is violating Agent 2's fence → return FCR instead.
- **RULING P-W2d (stale line numbers)**: dossier cites pre-1.2 line numbers; 1.2's ≈130 ln across 4 blocks shifts everything after :533. All later briefs instruct symbol-based location, never line-number-based.
- Near-twin map (§7): posScreenHooks.ts holds useLockedCartPersistence :236-278 ≡ PosScreen :402/:411-440/:859-883, useCartKeyboardNavigation :124-215 ≡ :957-1038, useCartWidth :47-105 ≡ :457-530, useShiftTimer :15-29 ≡ :538-546 — ALL forbidden-consolidation pairs (P-P3 reaffirmed with exact citations). Actual pre-existing files are FLAT (posScreenHooks.ts / usePosState.ts / bundleExpansion.ts at features/sales/ root); NEW hooks/ + components/ dirs are ours.
- fireCourse/fireAllCourses are usePosState natives (destructured :375-376); assignCourse is NOT consumed by PosScreen → todo 1.4's "course assignment" prose has no PosScreen-side symbol to move; record as a completion-pass deviation note, do not invent a wrapper.
- Sequencing unchanged: 1.2 → 1.3 → 1.4a → 1.4b (strictly sequential, same file). Coders 2-6 IDLE-BY-DECISION: parallelism impossible inside one file fence; reason recorded.
## Live Dashboard (POS-Screen campaign)
| id | role | fence | state |
|---|---|---|---|
| 503a9e6f-f585-402e-a545-0b28408a1f7f | coder | ui/src/features/sales/hooks/usePosShifts.ts (NEW) + PosScreen.tsx top region | RUNNING (Wave 2 / Phase 1.2, dispatched ~00:37Z, dead-man schedule-1 @ 00:52Z) |
| subagent-19 | tester | READ-ONLY (isolated worktree; main tree forbidden) | RUNNING (baseline of the 3 campaign-end suites + typecheck attribution) |
| — | | | timers: schedule-1 (one-shot dead-man), schedule-2 (every-300s capacity scan) — DELETE BOTH at campaign end / before idle |

RESUME NOTE (3 prior session boundaries killed in-flight coders; P-P9 protocol): on any session loss, first check (a) git log --grep "refactor(pos-" for landed commits, (b) fence-file mtimes vs HEAD blob for orphaned WIP to ADOPT+VERIFY rather than rewrite, (c) git stash list for my path-limited baselines. Wave 1's orphaned WIP was recovered this way twice.
Wave chain remaining after 1.2: 1.3 usePosHeldCarts (one box) -> 1.4a add/deduction/override -> 1.4b remove/undo+discount/promotions (SPLIT pre-authorized; keyboard nav :957-1038 + handleLock stay put). Rulings P-W2a/b/c/d MUST be attached to those briefs.

### P-W2 (Wave-3/4 sizing dossier ACCEPTED from researcher subagent-14 — chain re-scoped, ~00:5xZ)
- R1 facts [Fact: PosScreen.tsx @ pre-1.2 tree, 2,391 ln]: **1.3 held-carts = 96 ln core** (:767-781 bill-list state/load, :1105-1120 input state, :1122-1159 handleOpenBill, :1161-1187 handleResumeOpenBill) → **FITS ONE BOX** (~12 symbols, 1 effect, 2 exit-animation refs, 1 pass-through). **1.4 cart-actions = 144 ln core** across 6 scattered blocks (:554-586 ensureCart, :635-649 handleAddProduct, :652-668 deduction/PIN, :832-845 discount, :848-855 promotions, :893-951 remove/undo/qty/override) + 251 maximal if keyboard-nav (:957-1038) and lock (:859-883) are swept → **SPLIT PRE-AUTHORIZED: 1.4a** = ensureCart + add + deduction trio + overrideTarget/handleOverrideConfirm + qty wrappers (~95 ln); **1.4b** = remove/undo stack + discount/promotions (~50 ln). Keyboard-nav, lock/restore, fireCourse ALL STAY in PosScreen (out of todo 1.4 prose; and they duplicate posScreenHooks.ts twins — P-P3 forbids consolidating).
- **1.4 RISKIER than 1.3** (breadth + cartId lifecycle + JSX mutation sites).

### P-W3 (Wave 2 LANDED a00a964ee + spot-verify PASS + CAMPAIGN-END BASELINE FIXED, ~01:0xZ)
- Commit **a00a964ee** "refactor(pos-state): extract shift lifecycle into usePosShifts hook" (VERBATIM) — my audit: 2 files +224/-142 EXACT fence, ANCESTOR_OK, usePosShifts.ts 197 ln NEW, PosScreen.tsx **2,391 -> 2,276** (-115), sales/ porcelain = 0 lines (zero dangling WIP).


### P-W5 (Wave 4a BOX OVERRUN + steer, ~01:39Z)





---






### P2-A32 (VERIFIED EVIDENCE, wave 2 pre-commit; 13:13Z; deadline EXTENDED on measured progress, not on hope)
- The 13:12:31Z deadline coincided with PROOF of forward motion: scripts/native-tooltip-baseline.json had just gone dirty. Interrupting a lane that is demonstrably executing the last step is the false-positive I have dodged twice today, so I verified its content instead of its clock, and re-armed a HARD STOP at +5 min (previous DEADLINE CHECK timers deleted, none orphaned).
- BASELINE EDIT, verified correct by EXECUTION not by reading: git diff shows exactly two hunks -- features/sales/PosScreen.tsx 9 -> 8, and a new entry features/sales/components/CartActionBar.tsx: 1. total and schema_version untouched, no other entry altered, no reformat. DECISIVE CHECK: the key-spelling trap from my grant (a key the scanner never produces does not fail, it silently grants nobody anything while the ?? 0 default keeps enforcing zero, so a green run would be worthless). I therefore ran the suites rather than trusting the diff: npx vitest run nativeTooltipCompliance.test.ts storageKeyPins.test.ts -> 'Test Files 2 passed (2) / Tests 13 passed (13)'. Green IS the proof the key matches, because a mismatched key leaves CartActionBar at budget 0 with count 1 and fails. storageKeyPins green also independently confirms the 2.2 move did not disturb the pos-cart-width owner set.
- ONE COSMETIC DEVIATION, NOTED AND LEFT ALONE: the new entry was appended after features/sales/ReceiptPreview.tsx rather than sorted before it, so that block is no longer strictly alphabetical. JSON object key order is functionally irrelevant to a lookup, prettier does not sort keys, both suites are green, and churning a hot shared ledger for sort order costs a re-run and buys nothing. Recorded so the morning reader sees it was a decision, not an oversight.
- REMAINING BEFORE COMMIT, single item: the dead jsx-a11y/no-noninteractive-tabindex name in PosScreen.tsx's header (steer 3). Worktree eslint still reports exactly 1 unused-directive warning on that file, so that line is not yet applied. Everything else -- four code paths, the scan-set growth, the baseline relocation, nine-suite state -- is on disk and gated.
- POOL: 1 coder, hard stop 13:18Z. 2.2 reviewer armed and waiting on the SHA; 2.3 brief complete except the post-2.2 prop-surface enumeration, which cannot be taken from a file another lane is writing.
### P2-A33 (JOURNAL LOSS FOUND + WAVE-2 GATE GREEN @ 5a0e87a22, 13:2xZ)
- LOSS NOTICE, measured: this file contains NO P2-A17..P2-A31. grep '^### P2-A' returns only P2-A32; file 118 ln / 18,797 bytes. The pre-composed 2.3 brief (P2-A24) and rulings P2-A25..A31 were never persisted. RULE BORN: a ruling is journalled only after grepping it back out of the file; 'I wrote it' is not evidence. Recovery taken: 2.3 rebuilt from the LANDED 2.1/2.2 precedent files plus fresh post-2.2 measurement (researcher dispatched same round), not from lost text.
- WAVE 2 LANDED 5a0e87a22 'refactor(pos-ui): extract CartFooterTotals and CartActionBar components', parent b5eb3c7d7. Fence audit: exactly 5 paths (+478/-314) -- native-tooltip-baseline.json 5+/-, cartExtraction.test.ts +2, PosScreen.tsx 358 changed, CartActionBar.tsx 87 NEW, CartFooterTotals.tsx 340 NEW. Zero foreign sweep although three foreign files were STAGED in the index at commit time.
- ANCESTRY: 5a0e87a22 in HEAD history; 2.1 commit ceace1a63 is its ancestor. Scope porcelain (features/sales, __tests__, baseline json) = EMPTY, so zero dangling WIP.
- MERGED-TREE GATE (9 suites, manager-run): 'Test Files 9 passed (9) / Tests 202 passed | 1 skipped (203)' -- exactly the 202/1 derivation from P2-A28-era arithmetic, per-file: PosScreen 18, integration 106, CoreFlow 22(+1 skip), usePosState 29, DeductionLocation 5, cartExtraction 3, CourseSelectorBar 6, nativeTooltipCompliance+storageKeyPins 13.
- GEOMETRY with metric named (raw wc -l): PosScreen.tsx 1858 (pre-2.2) -> 1592 now. CartFooterTotals 340, CartActionBar 87. Moved source = 261 (footer block, 6-space dedent) + 51 (actions row, 8-space dedent); remainder of the new files is Props interfaces, imports, call site.
- HOOK, disclosed by worker: attempt 1 failed at 'ui typecheck (4 staged file(s))' on FOREIGN ui/src/features/workspaces/WorkspaceHome.tsx only; attempt 2 used the pre-authorised OZPOS_SKIP_TYPECHECK=1. --no-verify NOT used; verify-bundle-parity ran, 0 missing keys. Typecheck judgement therefore rides my own delta runs, not the hook.
- RATIFIED: ~55 min against a 15-min box. Root cause per worker = its own scratch-file tooling (read+write round-trip truncation >1000 chars), NOT repo work. Gate green on first manager pass, fence exact, zero rework. Metrics: box overruns +1.
- STEER CARRIED INTO 2.3: PosScreen.tsx:2-6, the eslint-disable block's explanatory comment, still reads 'The two rules above' and describes markup that left in 2.1. Held by my own one-name-deletion fence in 2.2; the correction belongs in 2.3's commit since that file is already in 2.3's fence.
- DEVIATION CLOSED, DO NOT RE-LITIGATE: tooltip grand total is 82, not 83. The suite compares sum(scanned actuals) against sum(baseline counts); the JSON 'total': 82 field is documentation, not the metric. Relocating a grandfathered native tooltip is not an introduction, so 2.3 gets the same pre-authorisation: PosScreen 8 -> measured residual plus a CartPanel entry carrying its OWN measured count. Sales allowance stays 9, repo total stays 82.
- POOL after this gate: 1 coder (micro-commit A, then 2.3), 1 researcher (post-2.2 aside map + CartPanel prop surface), 1 reviewer (correctness over the IMMUTABLE commit 5a0e87a22 -- extended-not-interrupted per the reference-is-a-commit rule). Dead-man armed +900s.

### P2-A34 (ESSENTIALS RESTORED AFTER THE LOSS, 13:4xZ -- written for crash recovery, grep-verified)
Load-bearing rulings for wave 2.3, re-persisted because their original entries never reached this file:
- A-FULL IS THE SHAPE, re-affirmed against a thinker's opposite recommendation (A-SHELL, ~8 fewer lines). Decided by the todo's own words: box ':76' demands components/CartPanel.tsx as a 'standalone COLLAPSIBLE/RESIZABLE panel' and ':85' says 'reduce PosScreen to composition root'. A shell leaves the box's PURPOSE false while its filename exists -- the worst kind of green. Its '~70 flat props is a redesign' objection fails against its own 2.2 slice (~34 props, identical names): GROUPING is the redesign, breadth is not (RetailCartPanel reached 27 props only by inventing grouped objects).
- 2.3 MECHANICS: React fragment root (handle div, then aside). Flat same-name props, no grouping. l10n via the hook PosScreen already uses. Named prop 'cartPanelRef' -- the aside ref is WRITTEN, so it threads; do not use forwardRef. No React.memo. Leave the unclosed 'style' attribute as-is if found (verbatim rule).
- THE GUARD RULE, correcting a false claim I once forwarded: CourseSelectorBar is NOT self-gating. Its bar div renders unconditionally (components/CourseSelectorBar.tsx:20); the 'return null' at :25 is PER COURSE inside COURSES.map; the real unmount gate is the PARENT's non-hold-gated 'lines.length > 0'. Therefore 2.3 must move the guard and its call site as ONE unit, and nobody may describe the component as self-gating. Proven during 2.1 with DOM 32v32 identical because the guard stayed parent-side.
- TOOLTIP RATCHET: grant is MEASURE, DO NOT COPY. PosScreen's entry drops to its measured residual and CartPanel gets its OWN measured count; sales allowance stays 9 in total, repo total stays 82. Census fact that forced the ruling: all nine titles in the file sit inside the aside, zero outside, so no verbatim aside extraction can ever be baseline-free.
- GATE ADDITIONS 2.3 MUST CARRY: (1) ui/src/__tests__/cartExtraction.test.ts ADDITIONAL_TSX_FILES must gain 'components/CartPanel.tsx' IN THE SAME COMMIT -- that list has only the two 2.1 names today, and its third case asserts NO DEAD CLASSES, so every moved class reads dead without it. (2) The gate is NINE suites, expected 202 passed / 1 skipped, and results are reported PER FILE, never as an aggregate, because equal-sized substitutions hide in sums. (3) Move proof is a reverse-diff against 'git show <sha>:' slices (lines_head == lines_new, identical, diffs=0); 'git diff -w' numstat equality is a CONFOUNDED proxy on JSX (a lone '>' or '/>' is whitespace-only content) -- report it, never reformat a moved line to satisfy it. (4) Fix the stale eslint-disable prose at PosScreen.tsx:2-6 in this commit (it is in fence) and trim ONLY rule names eslint reports unused.
- NO CSS WORK: features/sales/CartPanel.css already holds every .pos-cart-panel and .pos-resize-handle rule, none parent-scoped, so 2.3 edits zero CSS.
- THE '<600 LINES' TARGET IS CLOSED AS A DOCUMENTED DEVIATION, not chased. Measured at 5a0e87a22 with metric raw wc -l: PosScreen.tsx is 1592 (pre-2.2 1858; the todo's '2,329' baseline is stale -- it read 2,462 then 2,072 earlier in the campaign). The wiring band (lines 157-767, 611 raw) is fenced AWAY from Agent 2 three times: todo ':27' limits me to the JSX render tree at ':800+', ':29' forbids state/calc hooks (Agent 1, campaign closed), and Agent 3's todo-3:32 fences the rest. True floor is ~814 only by extracting the ~414 raw lines of modal JSX, which no agent's todo claims -- it is UNCLAIMED, out of scope, and reported to the owner as such. Realistic end state ~1,290 mandated-only, ~1,166 with the sanctioned S1+S2 dedups. No 'max-lines' rule exists anywhere under ui/, so length is not test-enforced.
- QUEUED AFTER 2.3, NOT INSIDE IT: micro-commit A (in flight now, CartLineItem header one-liner), then S1 = adopt the useCartWidth twin from posScreenHooks.ts plus TWO storageKeyPins.test.ts edits in the same commit (the :56 owner line moves AND the :188 two-owner set shrinks to one), then S2 = useCartKeyboardNavigation (proof is a byte-identical dependency array; no twin test exists). S3 = DO NOT DISPATCH: useLockedCartPersistence is STALE and its adoption is a data-loss vector (promotion rehydration lost while restore deletes the key) -- report it to the owner as visible dedup debt instead.
- POOL NOW: coder c8911a4e (micro-commit A, briefed to stop after it), researcher subagent-23 (post-2.2 geometry + flat prop surface + tooltip census + dead-directive exposure), reviewer subagent-24 (Correctness over the immutable commit 5a0e87a22). Timer schedule-8 at +900s; schedule-7 deleted after wave 2 landed.

### P2-A35 (MICRO-COMMIT A LANDED 94f7cb765 + two proof lessons, 13:5xZ)
- 94f7cb765 'chore(lint): drop an unused a11y directive from CartLineItem', parent 8630d50b9, 1 file +1/-1, one pathspec. Header now keeps only the LIVE rule name, so no bare '/* eslint-disable */' was created. Hook escape OZPOS_SKIP_TYPECHECK=1 was NEEDED and was disclosed with its cause: the hook's repo-wide typecheck is red on the FOREIGN ui/src/features/workspaces/WorkspaceHome.tsx(14,1 TS6133 / 15,15 TS2440). Zero diagnostics in the file itself; --no-verify never used; verify-bundle-parity ran clean.
- LESSON 1, BETTER THAN MY OWN PROOF, adopted as the standard: eslint EXITS 0 EVEN ON WARNINGS, so an exit code cannot demonstrate '0 problems'. The worker gated its commit on the report being ZERO OUTPUT BYTES and wrapped that check in the same script so the commit was mechanically impossible on a dirty report. For any lint judgement from now on: measure output bytes (printf %s "$X" | wc -c), never the exit status.
- LESSON 2, COST TO MY OWN ORCHESTRATION, not the worker's: my first re-dispatch program TIMED OUT at the 600s wall-clock ceiling because I awaited two one-shot specialists (spawn_researcher, spawn_reviewer) in the FOREGROUND, sequentially. Their role default is blocking. RULE: specialist spawns go in the SAME program as a run_in_background: true, or in their own call; a manager turn that BLOCKS on two serial specialists is self-cancelling and burns ~10 minutes. The timeout also taught the useful positive: everything before the first await had already landed (the journal append survived), so a timed-out program is a partial execution to inspect, not a clean failure to re-run blindly -- I re-checked state (journal present, commit absent, coder idle, no orphan timers) and re-issued only what had genuinely not run.
- WORKER'S OWN TOOLING LESSON, added to every future brief: shell '${#VAR}' inside a run_code template literal is parsed by TypeScript as a PRIVATE FIELD declaration ('Private field #OUT' SyntaxError) and kills the program before it runs. Never interpolate a shell parameter-expansion form into a JS template literal.
- PARK HYGIENE DONE: 5 parked copies whose bytes are EQUAL to a landed gated blob were deleted (CartLineItem, CourseSelectorBar, CartActionBar, CartFooterTotals, CourseSelectorBar.test); 5 that differ were renamed with a SUPERSEDED-pre2.2-- or SUPERSEDED-precommit5a0e87a22-- prefix instead of deleted, because a stale PosScreen.tsx snapshot in Temp is a confusion hazard a future session could mistake for pending work, and deleting a state I cannot reproduce is not worth the tidiness. coursebar-tester dir removed once empty. The rule that made this safe: a park copy is deleted only after 'git show <sha>:<path> | diff -q - <copy>' proves equality.
- POOL: researcher subagent-23 and reviewer subagent-24 still running; coder idle after Step 1 by design (I told it to stop rather than let it start wave 3 against an unmeasured prop surface). schedule-8 live.

### P2-A36 (2.2 CORRECTNESS REVIEW + WAVE-3 PRE-FLIGHT DOSSIER + WAVE 3 DISPATCHED, 14:1xZ)
REVIEW 2.2 (subagent-24, DIMENSION Correctness, immutable commit 5a0e87a22): VERDICT = PASS WITH NOTES, 0 Critical, 0 Major, 1 Minor + 1 Nit. Its method beat mine: it reconstructed the two old regions from git blobs, applied the ratified dedents (-6 footer, -8 actions) and LCS-diffed, giving ACTIONS 51/51 byte-identical and FOOTER 259/259 byte-identical + exactly 2 added comment lines; and it reconciled the -314 by showing the old side is 260+51=311 MOVED + 1 DELETED eslint line. It independently confirmed: no && to ternary conversion anywhere, the actions row still rides inside the footer guard as children, the ref crosses as the same object (child .current write hits the parent's read), no memo/forwardRef so identity semantics are unchanged, and the odd pre-existing indentation of the Open-Bill block was carried through rather than tidied. Both of my ratified calls (children-composition, subtotal widening, tooltip FCR) were explicitly listed as NOT-findings.
MINOR (PosScreen.tsx:1) and my RULING: 2.2 narrowed the parent's file-scope eslint-disable from two rule names to one -- runtime-inert, and the researcher later MEASURED that the remaining rule is genuinely still needed (4 triggers of no-noninteractive-element-interactions, 2 outside the fragment) and that no-noninteractive-tabindex cannot fire in the parent (its only tabIndex site is -1). So the substance was CORRECT. I ACCEPT it but record the process inconsistency honestly: for the identical class of edit in CartLineItem I made a standalone chore(lint) micro-commit (94f7cb765), yet here it rode a refactor commit. The rule I should apply next time: a directive trim is a separate commit ONLY when it is not forced by the same move; when the move itself kills the rule, it belongs in the move. Nit: the prose under that directive went factually wrong in the same hunk; it is in the 2.3 fence and the 2.3 brief orders it rewritten truthfully.
TWO OF MY OWN PRIOR ASSUMPTIONS WERE WRONG, both caught pre-dispatch by the dossier (subagent-23, read-only over 5a0e87a22):
(1) I had recorded that the parent's eslint-disable block might be DEAD after 2.3. FALSE: 2 of its 4 triggers are outside the fragment (two role=dialog panels with onKeyDown, ~1277 and ~1504), so the block MUST SURVIVE the lift. Had I briefed a trim, the coder would have reddened eslint on a correct move. The child instead needs its own new directive (in-tree precedent CartLineItem.tsx:1) naming only element-interactions.
(2) I had recorded 'CartPanel.css holds every panel rule so 2.3 needs zero CSS edits'. INCOMPLETE: 10 of the 33 fragment classes are styled from PosScreen.css, and pos-cart-panel + pos-resize-handle are declared in BOTH PosScreen.css and CartPanel.css. Zero CSS edits is still the right instruction (the parent keeps importing PosScreen.css so resolution is unchanged), but the duplicate declaration is a live threat to cartExtraction.test.ts's second case ('no class in more than one CSS file') the moment CartPanel.tsx joins the scan set. 2.3 brief therefore pre-plans the honest exit: if that case turns red, FENCE CHANGE REQUEST -- do not edit CSS, and do NOT quietly drop the file from the scan set, because that deletes the very coverage the case exists to provide.
MEASURED GEOMETRY (metric = raw wc -l at 5a0e87a22, file 1592 lines): fragment = 783-1133 = 351 lines = 22.0 percent. Handle div 783-787, blank 788, banner comment 789, aside 790-1133. Handle and aside ARE siblings with only blank+comment between them, which settles the question I had briefed it to answer. 471 JSX lines stay outside the fragment (left panel + all modals) -- unclaimed by any agent todo, so out of scope. Expected parent residual is NOT 1242: the call site carries 77 props so it is tens of lines, not one. That is why the brief demands a MEASURED residual with its metric named and forbids chasing a number.
PROP SURFACE = 78 free component-scope identifiers: 34 values + 42 setters/handlers + 2 refs + 0 mutable-non-ref. Every type resolved via ts.createProgram over the committed blob (81 identifiers, 0 missing), so I pasted all 78 into the 2.3 brief as the contract text minus l10n (77) -- per the contract-fence rule, the coder codes against pasted text, not hope. The 0 count in the fourth class is what makes a flat pass-through sufficient: nothing needs a getter/setter pair.
TOOLTIP CENSUS, measured with two independent regexes agreeing: 8 title= sites in PosScreen.tsx, ALL INSIDE the fragment, ZERO outside. So post-lift the parent holds 0 and CartPanel.tsx holds 8 -- the sales subtotal stays 9 and the repo total stays 82, which was my ratification condition for the 2.2 FCR. The 2.3 baseline edit is therefore MEASURE-DON'T-GUESS with both encodings allowed (set 0, or drop the key) because a file absent from the baseline gets budget ZERO and a count below its entry also fails the stale arm.
L10N: 24 distinct keys inside the fragment, 26 counting both arms of the conditional id at :806; 40 stay outside. The child re-obtains l10n via useLocalization() exactly as 2.2's children do -- the reviewer's drift analysis is the precedent for calling that safe.
THREE RISKS the dossier named, all answered by ONE shape decision: startResize writes isResizing.current which the parent's window effect reads; deductionLocationIdRef is written by the parent's payment path; handleCartPanelKeyDown closes over parent-local focusLineByIndex and lists 7 deps. Every one is a re-declaration trap, so the brief makes it a hard rule: all 42 functions pass as props and are NEVER re-declared in the child, and both refs pass as the same object instance. Zero behaviour change follows from that single rule.
WAVE 3 DISPATCHED to the warm coder (send_message 850963d1, 'NEW ASSIGNMENT, BEGIN NOW'), 45-min box sized from the measured 351 lines. Fence = PosScreen.tsx, NEW components/CartPanel.tsx, cartExtraction.test.ts, scripts/native-tooltip-baseline.json -- four paths, one commit, verbatim mandated subject 'refactor(pos-ui): consolidate CartPanel and reduce PosScreen to composition root' (todo :85). Explicit out-of-scope list blocks the three nearest temptations: adopting the posScreenHooks twins (S1/S2 must serialize after 2.3 because all three edit PosScreen.tsx), touching PaymentModal (Agent 3), and moving any of the 471 unclaimed outside lines. Gate = the nine suites with per-file counts, delta-judged typecheck/lint, reverse-diff move proof, subject-grep ancestry (never a HEAD sha), pathspec-exact commit, OZPOS_SKIP_TYPECHECK=1 pre-authorised only for the foreign WorkspaceHome red.
STATE: pool = 1 coder running wave 3 (fences recorded above), 0 specialists running (both lanes paid off, one-shot disposal). My only live timer replaced: schedule-8 deleted (subject settled), new 45-min dead-man armed for wave 3. Sibling Bridge-Builder keeps landing chore(bridge)/test(bridge) commits; HEAD is theirs, my lanes key on subjects.
METRICS UPDATE: rework after red gate 0 · breaker trips 0 · fence violations 0 · FCRs granted 1 (2.2 tooltip) + 1 expected-class already pre-planned for 2.3 · box overruns 1 (wave 2, ratified as worker tooling not repo work) · assumptions corrected by measurement BEFORE dispatch 2 (the dead-directive and the CSS-ownership claims above) · specialists extended past box rather than interrupted 2 (both had immutable commit references).
### P2-A37 (BOX CHECKPOINT + A BAD INVARIANT CORRECTED, 14:27:32Z)
- WAIT GATE :75 VERIFIED SATISFIED (85adf2e49 'refactor(pos-cart): extract cart line manipulations into
  usePosCartActions hook', completed by c24904a7a). RULE BORN: a todo box that NAMES a wait gate is a
  PRECONDITION to check in the same call as the dispatch. I checked it 15 min AFTER dispatching wave 3 --
  right answer, wrong process, and it was luck that the gate was green.
- BOX INVENTORY CORRECTED: the todo has 18 checkbox lines unchecked / 0 checked (metric = lines matching
  '- [ ]'), not 16. My '16' came from counting non-sub-bullet boxes. Re-measure at completion, never
  propagate a count without its metric.
- CAMPAIGN-2 SCOPE NOW ON DISK (was lost with P2-A1..A31): prepended a 60-line LIVE STATE BLOCK at the
  file top -- objective, repo rules, box map, the three mandated subjects verbatim, nine-suite gate
  contract, campaign-2 commit ledger, live dashboard, next-in-order chain, journal-loss rule. Verified by
  grep: 226 lines (165 + 61), '### P2-A32' now at :175, P-P8 =1, P2-A36 =1, no duplicate 'Goal &
  Architecture'. The old top declared the FINISHED campaign-1 objective, which is the exact state that
  would have led a crash-recovery successor to re-open 19 closed boxes.
- FALSE ALARM, AND THE LESSON IS ABOUT MY OWN INSTRUMENT: whole-file non-ASCII line count read 41 where I
  expected 40, so I suspected my prepend had injected CESU-8. It had not -- 'head -61 | grep non-ASCII'
  returned ZERO and the /tmp backup of the pre-prepend file ALSO measures 41. My expected value was stale,
  the file was fine. Always re-measure the CONTROL, not just the patient.
- INVARIANT REFINED (this is the durable one): 'ASCII only' was over-broad and generated a phantom alarm
  every time anyone wrote a em/middle-dot. The hazard that actually made the shared file unreadable was
  CESU-8 SURROGATE PAIRS from emoji through heredocs (3-byte + 3-byte halves). Single BMP chars like
  U+00B7 (bytes c2 b7) and em-dashes are benign and already sit in campaign-1's region. NEW alarm
  condition = an unpaired surrogate byte (ed a0..ed ff) or a non-ASCII line count DELTA attributed to a
  region I just wrote -- never a bare total. Line 226 holds one U+00B7 middle dot from P2-A36; left in
  place deliberately, because rewriting my own memory file to satisfy an invariant I just disproved is
  the same vanity-metric error as reformatting moved JSX to satisfy '-w'.
- POOL AT 14:27Z: coder c8911a4e 15.5 min into its 45-min wave-3 box, ZERO fence paths dirty and NO
  CartPanel.tsx on disk yet -- consistent with a lane still in the measure/diff phase (it was told to
  measure residual + child count before writing). No steer: a steer costs a step boundary and I have no
  evidence of a stall, only of silence, and silence inside a box is not a finding. Researcher subagent-29
  13.5 min into 15 -- EXTENDED, not interrupted, per the immutable-reference rule (its anchor is a frozen
  commit, so its answer cannot rot while siblings land). Timers schedule-9 (14:59:59Z) and schedule-10
  (14:30:08Z) stay armed; teardown before any final reply.
### P2-A38 (S1/S2 DOSSIER ACCEPTED + 3 RULINGS + MY GATE METRIC WAS A SUBSET, 14:36Z)
- Researcher subagent-29 LANDED its own dossier (12.7 KB, ANCHOR 927894830, 1,592-line blob parked to /tmp so it
  never read the lane's live PosScreen.tsx). Extended, not interrupted, per the immutable-reference rule. Right call.
- Q5, THE ONE THAT MATTERED: todo :76 says 'standalone COLLAPSIBLE/RESIZABLE panel'. Measured at ANCHOR, 'collaps'
  appears ZERO times in PosScreen.tsx; the aside renders unconditionally; no collapsed state, no width-zero, no
  aria-expanded, no persisted flag. Only showOptions collapses the totals block INSIDE CartFooterTotals (existing,
  unaffected). RESIZABLE is real. COLLAPSIBLE IS NOT IMPLEMENTED -> it is a feature request, and this campaign is
  behaviour-preserving. RULING: do not build it; record it as a todo doc defect in the completion pass.
  Steered the live 2.3 lane with exactly that, including 'if you already wrote collapse logic, remove it before
  committing' (delivered, message 7e433b73).
- Q1 (S1) ANSWER: inline :254-328 vs hook :47-107 are IDENTICAL on lazy init, startResize, the re-clamp effect and
  both its deps, the 'pos-cart-width' literal (3 reads/writes each side), the write path (writes during move + on
  window resize, NEVER on mouseup), clamp values 320/440/1200, and listener cleanup symmetry (no 'passive' anywhere
  on either side). EXACTLY ONE DELTA: dep array '[]' inline vs '[posScreenRef]' in the hook. RULING: adoption is
  SAFE because posScreenRef is a useRef object with component-lifetime-stable identity, so the effect never
  re-subscribes and the arrays are equivalent IN PRACTICE; the risk the dossier names (mid-drag resubscribe aborting
  the drag via cleanup's third stopResize) only bites if a caller passes a fresh object. State that in the S1 brief
  as the condition of validity.
- S1 MUST ALSO KILL A DUPLICATE: the hook declares its OWN private clamp consts at posScreenHooks.ts:31-41 while the
  inline side imports them from utils/cartCalculations.ts:13-23. If PosScreen adopts the hook it drops that import
  and the exported util becomes unpinned dead code with a silent second copy of the numbers, and NO test compares
  them. So S1's fence = PosScreen.tsx + posScreenHooks.ts + storageKeyPins.test.ts, and its deliverable includes
  making the hook import the shared consts instead of duplicating them.
- Q2 (S2) CRUX ANSWERED: the hook owns NO refs and ACCEPTS caller-owned behaviour -- params (lines, total,
  handlers: CartKeyboardHandlers), returns ONE memoized handler. cartLineRefs / setCartLineRef / focusLineByIndex
  have no hook-side counterpart. Handler bodies AND the seven-entry dep array are BYTE-IDENTICAL both sides, which
  is the substitute proof I asked for. So S2 stays viable AFTER 2.3: the keydown handler and the ref map remain in
  the parent either way; registerRef crosses into CartPanel as just another prop.
- Q4 CORRECTED ONE OF MY OWN BRIEF CLAIMS: I told the researcher useCartWidth was untested. FALSE --
  __tests__/hooks/useCartWidth.test.tsx has 9 'it(' blocks (init default/saved/clamp min/clamp max/narrow-viewport/
  startResize/persist-on-move/cleanup-on-mouseup/re-clamp-on-resize). Adoption therefore arrives PRE-PROVEN at the
  hook level, which is far better evidence than a diff. useLockedCartPersistence also has a test file; only
  useCartKeyboardNavigation lacks one. Production consumers of posScreenHooks = 0 (29 grep hits across 5 files are
  all decls or __tests__), re-confirmed with its limits stated.
- *** MY GATE METRIC WAS A SUBSET AND I MUST STOP CALLING IT THE SUITE ***: 'npm run test' is 'vitest run' over the
  WHOLE ui tree = 553 test files / 9,468 tests (measured: 550 passed | 3 failed, 9,441 passed | 3 failed | 24
  skipped, 118.67s). My 'nine suites => 202 passed / 1 skipped' is a SCOPED SALES-ADJACENT SUBSET (18+106+22+29+5+3+
  6+13 = 202 exactly -- that is why it looked like the whole thing). 167 of the missing tests are __tests__/hooks
  alone. The subset was still the RIGHT regression fence for a JSX move, but every future entry must say 'scoped
  nine-file gate' vs 'full suite'. The completion pass for box :82 runs 'node scripts/check-ui.mjs' (check:all,
  measured its identity this pass) plus the FULL suite.
- THE 3 REDS ARE ATTRIBUTED, NOT ALARMING: cartExtraction 'no dead classes' + nativeTooltipCompliance 'introduces no
  NEW native title attribute' and 'keeps the baseline honest'. Those are precisely the two source-text-keyed rules
  that MUST go red between 'JSX moved out' and 'scan set + baseline updated', and the tree at the same instant shows
  ' M ui/src/features/sales/PosScreen.tsx' + '?? components/CartPanel.tsx' = the 2.3 lane mid-write. So the reds are
  the lane's own in-flight scope and its brief already names both fixes. NO steer sent; alarming a lane about its own
  correct intermediate state is how you get a bad commit.
- POOL: 1 coder running (wave 3, ~24 min of 45). Timers schedule-9 (14:59:59Z coder dead-man) + schedule-11
  (14:45:04Z). Researcher slot free. Coder slots 2-6 idle with reason: one cohesive change-set in one file.
### P2-A39 (WAVE 3 ON TRACK + S1 BRIEF PRE-COMPOSED FROM MEASURED FACTS, 14:41Z)
- Lane status 14:40:26Z: ALL FOUR fence paths dirty in the prescribed order -- CartPanel.tsx (NEW, 609 ln),
  PosScreen.tsx (1,247 ln), and now ALSO scripts/native-tooltip-baseline.json (M) + ui/src/__tests__/
  cartExtraction.test.ts (M). The last two are the static-gate fixes (append 'components/CartPanel.tsx' to
  ADDITIONAL_TSX_FILES; tooltip truth = 8 into the new file's entry, 0 left in the moved range, sales back to 9,
  repo total stays 82). Reading: it is in gate/commit phase, ~28 min of its 45-min box. NO steer needed.
- Foreign/sibling commits since: 6cdd7d3b8 'refactor(shell): consolidate desktop invoke_handler into thin
  oz-bridge router' and 04324e85e 'docs(refactor): record bridge Wave E completion and fix stale todo claims' --
  the sibling's own completion pass. HEAD is theirs, as always; judge my ancestry by SUBJECT grep only.
- S1 READY-TO-FIRE BRIEF (dispatch the moment the wave-3 gate is GREEN; S1 edits PosScreen.tsx so it MUST NOT
  overlap the 2.3 lane). Verbatim contract facts, all measured at the frozen anchor 927894830, not remembered:
  * OBJECTIVE: PosScreen stops carrying the inline cart-width twin; adopt useCartWidth from
    ui/src/features/sales/posScreenHooks.ts. ONE commit, subject
    'refactor(pos-state): adopt useCartWidth twin and repoint its storage-key pin'.
  * FENCE: ui/src/features/sales/PosScreen.tsx, ui/src/features/sales/posScreenHooks.ts,
    ui/src/__tests__/storageKeyPins.test.ts. Nothing else.
  * THE ONLY BEHAVIOURAL DELTA (from the dossier, region-by-region otherwise IDENTICAL): inline effect dep array
    '}, []);' vs hook '}, [posScreenRef]);' at hooks:89. CONDITION OF VALIDITY: posScreenRef is a useRef object,
    stable for the component lifetime, so the mousemove/mouseup effect cannot re-subscribe mid-drag; if any caller
    ever passes a fresh object the drag aborts SILENTLY because the cleanup calls stopResize() a third time.
    Keep passing the SAME useRef.
  * API: 'export function useCartWidth(posScreenRef: React.RefObject<HTMLDivElement | null>)' returning
    '{ cartWidth, setCartWidth, startResize }' (hooks:47, :106). Delete the inline twin only; keep the JSX wiring
    'onMouseDown={startResize}' and 'style={{ width: cartWidth }}' pointing at the hook's returns.
  * MUST ALSO COLLAPSE A DUPLICATE: hooks:31-41 privately re-declares CART_WIDTH_MIN/DEFAULT/CAP + the clamp, whose
    real home is utils/cartCalculations.ts:13-23 (which PosScreen imports at :37). Make the hook IMPORT them;
    do not leave two copies of the numbers with no test comparing them.
  * PIN EDITS, BOTH IN THE SAME COMMIT (verbatim text held by the dossier): storageKeyPins.test.ts :56 changes from
    "'pos-cart-width': 'features/sales/PosScreen.tsx'," to "'pos-cart-width': 'features/sales/posScreenHooks.ts',"
    AND the two-owner list in the 'documents which keys have more than one declaring module' test (:178-190) drops
    the line "'pos-cart-width -> features/sales/PosScreen.tsx, features/sales/posScreenHooks.ts'," leaving only the
    'current-username' entry. EXPECTED_KEYS values are a single string, NOT string[] -- it cannot hold two owners,
    which is why both edits are mandatory together. The :170-176 'attributes each key to a module that really
    declares it' test ERRORS if PosScreen stops declaring the literal while the registry still names it.
  * PROOF ASSETS (already green, do not rewrite): ui/src/__tests__/hooks/useCartWidth.test.tsx has 9 'it(' blocks
    (init default / init saved / clamp min / clamp max / narrow-viewport / startResize / persist-on-move /
    cleanup-on-mouseup / re-clamp-on-resize) and the whole __tests__/hooks group measures 12 files / 167 tests
    PASSING at the anchor. Adoption evidence = those 9 pass AND the nine-file scoped sales gate stays at its
    per-file counts AND storageKeyPins 4/4.
  * KEY FACT: 'pos-cart-width' occurs 3x inline (ANCHOR :258 read, :304 write during move, :322 write on window
    resize) and 3x in the hook (:49, :80, :98); there is NO write on mouseup. Do not 'fix' that.
- S2 WAITS FOR S1 (same file). S2 = adopt useCartKeyboardNavigation; dossier proves handler bodies AND the
  seven-entry dep array are BYTE-IDENTICAL, the hook owns NO refs and returns one memoized handler, so
  cartLineRefs / setCartLineRef / focusLineByIndex stay parent-side and registerRef crosses to CartPanel as an
  ordinary prop. S2 RISK TO GUARD: it has NO test of its own, and losing 'data-line-id' or registerRef makes
  + / - / Del silent no-ops while arrows still work -- a half-broken keymap no assertion catches. S2's proof is
  therefore (a) byte-identical dep array, (b) a diff showing the closest('[data-line-id]') selector and the
  attribute both still present post-move.
- S3 (useLockedCartPersistence) STAYS DO-NOT-DISPATCH: stale twin, data-loss vector, zero consumers. Report as
  owner-visible dedup debt with the file:line evidence, do not adopt.
### P2-A40 (FENCE TEXT READ VERBATIM: S1/S2 ARE OUT OF MY FENCE -> PARKED. GOAL/CHECKLIST GAP FOUND, 14:44Z)
- Read the todo's own fence section verbatim (lines 14-38). Two decisive lines:
  * :26 '  * *JSX Render Tree only* in `ui/src/features/sales/PosScreen.tsx` (Lines 800+).' [Fact: todo:26]
  * :29-30 'DO NOT edit state hooks or calculation logic at the top of PosScreen.tsx (Owned by Agent 1).' / 'DO NOT
    edit PaymentModal.tsx (Owned by Agent 3).' [Fact: todo:29-30]
  * :21-25 Owned Path Fence enumerates EXACTLY five NEW files: CartPanel, CartLineItem, CartFooterTotals,
    CartActionBar, CourseSelectorBar. [Fact: todo:21-25]
- *** RULING: S1 AND S2 ARE PARKED, NOT DISPATCHED. *** The inline cart-width twin sits at ANCHOR :254-328 and the
  keyboard twin at :591-676 -- BOTH ABOVE line 800, i.e. in the 'state hooks ... at the top' region that this todo
  assigns to Agent 1, and both are hook-adoption edits, not JSX-render-tree edits. They also have NO checkbox among
  the 18. So adopting posScreenHooks twins under THIS objective would cross a declared fence and do unasked work.
  P2-A39's ready-to-fire S1/S2 brief is therefore DEMOTED FROM 'next wave' TO 'evidence pack for a follow-on
  objective' -- keep it, it is accurate and expensive to re-derive, but do not run it here. S3 (locked-cart, stale
  twin, data-loss vector) stays do-not-dispatch for the same reason plus its own.
  Consequence: the PosScreen.tsx serialization constraint that drove wave ordering is GONE, and the campaign's
  remaining work shrinks to: gate 2.3 -> review 2.3 -> box :82 (check:all + FULL suite) -> P-P6 completion pass
  -> plus the modal/peripheral ruling below.
  What to report to the owner instead of doing: posScreenHooks.ts carries THREE unadopted twins (useCartWidth
  :47-107, useCartKeyboardNavigation :124-213, useLockedCartPersistence :218-302) with ZERO production consumers,
  two of which are byte-equivalent to live inline code and one of which is stale; plus hooks:31-41 duplicates
  CART_WIDTH_MIN/DEFAULT/CAP that really live in utils/cartCalculations.ts:13-23 with nothing comparing them.
  All facts measured, all file:line cited, none of it mine to touch under this todo.
- GOAL vs CHECKLIST GAP (the 'Modals & Peripherals' question, answered from the doc, not the title). Goal line
  :5 verbatim: 'Extract large JSX sub-trees from PosScreen.tsx (cart line items, totals footer, action bar,
  **promotions modal, price override modal, and hardware listeners**) into modular presentation components. Reduce
  PosScreen.tsx into a thin composition root.' [Fact: todo:5] But the Task Checklist has ONLY Phases 2.0/2.1/2.2/2.3
  [Fact: todo:42,50,62,74] and NONE of the 18 boxes names a modal or a peripheral. So the Goal names three
  extractions that no box asks for. Provisional reading, pending researcher subagent-31's facts:
  * 'hardware listeners' = useEffect subscriptions at the TOP of the file -> fenced out TWICE (todo:26 lines 800+
    and todo:29 hooks at top). Treat as out of scope, record as a Goal/checklist conflict.
  * 'promotions modal' + 'price override modal' = JSX in the render tree, NOT forbidden (only PaymentModal.tsx is
    forbidden, :30). These are the only Goal extras that are even geometrically inside my fence. Whether they are
    inline JSX or already component invocations is exactly subagent-31's Q2; if they are already components, the
    Goal clause is satisfied by the composition root and nothing more is owed.
- Waiting-gate protocol :33-37 confirms the powershell grep my lane already passed (85adf2e49) and its fallback
  instruction 'create and test components ... first before replacing PosScreen.tsx markup' -- which is precisely the
  order the 2.3 lane is executing (CartPanel.tsx written at 14:34 before PosScreen was trimmed at 14:38).
- POOL: coder c8911a4e running wave 3 (all four fence paths dirty, gate/commit phase, ~32/45 min). researcher
  subagent-31 running the modal/peripheral map. 5 coder slots idle WITH REASON. Timers schedule-9 (14:59:59Z),
  schedule-12 (14:53:57Z).
- FENCE-STALENESS RULING (pre-answered for the 2.3 review): todo:26's 'JSX Render Tree only ... (Lines 800+)'
  carries a LINE-NUMBER HINT that is stale by construction -- the todo was written against a 2,329-line file and the
  file is now ~1,247 after three waves of extraction, so '800+' can no longer denote the same bytes it once did.
  The OPERATIVE words are '*JSX Render Tree only*' (italicised in the source). The 2.3 fragment 783-1133 at anchor
  927894830 is entirely JSX render tree: pos-resize-handle div, blank line, banner comment, and the <aside
  className='pos-cart-panel'>. Nothing above 800 was a state hook: :254-328 and :591-676 (the hook twins, fenced
  away by todo:29) were untouched by 2.3 -- they are NOT in the fragment and S1/S2 are parked. So the fragment is
  inside the fence's intent while sitting 17 raw lines below its literal hint. If the reviewer disagrees, the correct
  escalation is shrinking the fragment to start at 800, which would orphan the resize handle from the panel it
  resizes -- a behaviour split, strictly worse than the hint mismatch.
### P2-A41 (COMPLETE 18-BOX MAP + MODAL/PERIPHERAL SCOPE CLOSED + DEVIATIONS REGISTER, 14:50Z, measured by me)
- MODAL / PERIPHERAL QUESTION, ANSWERED FROM THE TREE. The Goal line names five extraction subjects; three were never
  boxed. All three resolve WITHOUT new extraction work:
  * promotions modal -> ui/src/features/sales/PromotionsModal.tsx ALREADY EXISTS as a module, imported at committed
    PosScreen.tsx:47, invoked as <PromotionsModal> at :1178. [Fact]
  * price override modal -> PriceOverrideModal.tsx exists, imported :46, invoked :1168. [Fact]
  * PaymentModal -> exists, imported :45, invoked :1146, and is FORBIDDEN to edit (todo:30, Agent 3). [Fact]
    So box :77's 'Reduce PosScreen to orchestrating ... Overlays / Modals' is satisfied by construction: the
    composition root already orchestrates three component invocations, not inline markup. [Fact + Inference]
  * hardware listeners -> there IS a real one: '── Barcode scanner integration ──' at :401-~460 (addToast on
    unmatched barcode :445, 'pos-scanner-error' :456, lookup :411-419). It sits ABOVE the render tree and is
    listener/hook code, so it is fenced out TWICE (todo:26 'JSX Render Tree only', todo:29 'state hooks ... at the top
    (Owned by Agent 1)'). The only other hits are window mousemove/mouseup/resize at :306-327 (the cart-width twin,
    also Agent 1's) and the literal label 'Counted cash in drawer' at :1319 (a string inside JSX, not a peripheral
    driver). No cash-drawer/scale/receipt-printer listener exists in this file. [Fact]
  => RULING: campaign 2 owes NO wave-4 extraction. 'Modals & Peripherals' in the objective TITLE is satisfied by
     (a) modals already being modules invoked from the composition root and (b) the peripheral listeners living
     outside this todo's fence. Record as a Goal/checklist conflict resolved toward the fences; the owner who wants
     the scanner block extracted must do it under the Agent 1 surface.
- VERIFICATION OBLIGATIONS, stated honestly because the boxes name the commands: :56 and :68 require
  'npm run test' AND 'npm run typecheck'. 'npm run test' IS the full suite (vitest run over the whole ui tree =
  553 files / 9,468 tests measured at 14:33Z), NOT my scoped nine-file gate. :82 requires 'npm run check:all' =
  'node ../scripts/check-ui.mjs'. :81 requires a line count. So the completion pass must show a FULL-suite run and
  a typecheck on the merged tree; my scoped gate is supporting evidence, not the box's own demand.
- 18-BOX MAP (metric = checkbox lines; all verified against the doc at 14:45Z):
  Phase 2.0 :43 inspect 1,000-2,300 JSX map | :44 identify boundaries (line-item group / course bar / totals /
  action rack) | Phase 2.1 :51 CartLineItem (+props bullet :52, +exact CSS classes of CartPanelLineItem.css and ARIA
  :53) | :54 CourseSelectorBar | :55 replace inline JSX with both | :56 verify test+typecheck | :57 commit milestone
  | Phase 2.2 :63 CartFooterTotals (subtotal/discounts/tax badge/tips/grand total) | :65 CartActionBar (Pay, Hold
  Bill, Recall, Discount, Clear Cart) | :67 replace inline JSX | :68 verify test+typecheck | :69 commit milestone |
  Phase 2.3 :75 wait gate | :76 create CartPanel | :77 reduce to composition root | :81 line-count verify | :82
  check:all | :83 commit milestone. [Fact: todo:40-86 read verbatim]
- PLAN-DOC ACCURACY CHECKS I RAN (both passed, contra my own earlier suspicion): todo:53 names
  'CartPanelLineItem.css' -- that file EXISTS at ui/src/features/sales/CartPanelLineItem.css, and so do
  CartPanel.css, CartPanelActions.css, CartPanelCourseBar.css, CartPanelFooterTotals.css, CartPanel.brand.css (6 CSS
  files in features/sales/, ZERO .css under components/ except ItemModifierModal.css). todo:65's five named buttons
  are present in landed CartActionBar.tsx (handlePay :10/:23, 'Clear' :49, Pay :53-57). [Fact]
- *** DEVIATIONS REGISTER for the completion pass (each re-measured this session, none copied forward) ***
  D1 :81 '< 600 lines' NOT MET and NOT METABLE: file was 1,858 pre-2.2, 1,592 at anchor 927894830, 1,247 with 2.3
     in flight; the wiring band :157-767 = 611 raw lines is fenced from this campaign by todo:26 + todo:29, so
     mandated-only end is ~1,240-1,330. Flip the box ONLY with this number attached. [measured]
  D2 :76 'collapsible' is an UNIMPLEMENTED FEATURE, not a refactor target: zero 'collaps' matches in the anchor
     blob, aside renders unconditionally, no collapsed state/aria-expanded/persisted flag; resizable IS real
     (:283/:784/:795). Not built (behaviour-preserving campaign). [dossier subagent-29 + my steer]
  D3 todo:5 baseline '2,329 lines' is STALE (file is 1,592 at the same anchor). Doc defect to record, not to chase.
  D4 todo:26 'Lines 800+' hint is STALE-BY-CONSTRUCTION after three waves of extraction; operative words are 'JSX
     Render Tree only'. 2.3's fragment began at 783 (resize handle) and is entirely render tree. See P2-A40.
  D5 tooltip-ratchet FCR (2.2, reused by 2.3): native-tooltip count must not GROW; relocating grandfathered
     tooltips into a new file is not an addition. scripts/native-tooltip-baseline.json absent => budget ZERO, so the
     scan-set entry must move with the JSX or the sum mismatches. Truth after 2.3: CartPanel.tsx 8, moved range 0,
     sales 9, repo 82. [ratified reasoning, gate will re-prove]
  D6 2.2 prop-narrowing: 'subtotal: Money | null -> Money' because the parent guard's narrowing cannot cross a
     component boundary; '!subtotal' / 'subtotal?.currency' left in place as dead-but-valid. [reviewed, PASS]
  D7 2.2 also narrowed the PARENT eslint-disable from two rule names to one -- reviewer Minor, ACCEPTED as
     substantively correct, with my own inconsistency recorded: I made the identical edit in CartLineItem a
     standalone chore(lint) commit (94f7cb765). REFINED RULE: trim a directive separately ONLY when the move did
     not itself kill the rule.
  D8 duplicate CSS declarations: 'pos-cart-panel' and 'pos-resize-handle' are declared in BOTH CartPanel.css and
     PosScreen.css. Zero CSS edits remains correct for 2.3 (the parent still imports PosScreen.css) but this is the
     live hazard behind cartExtraction's 'no class in >1 CSS file' case once CartPanel.tsx joins ADDITIONAL_TSX_FILES.
     If it reddens: FCR, NOT a CSS edit, NOT dropping the scan entry. [dossier + my reading]
  D9 posScreenHooks.ts carries THREE unadopted twins with ZERO production consumers (useCartWidth :47-107,
     useCartKeyboardNavigation :124-213, useLockedCartPersistence :218-302 -- the last STALE, a data-loss vector),
     plus hooks:31-41 duplicating CART_WIDTH_MIN/DEFAULT/CAP from utils/cartCalculations.ts:13-23 with no test
     comparing them. ALL OUT OF THIS TODO'S FENCE (todo:26/:29) => reported as owner-visible debt, NOT fixed here.
  D10 process deviations, mine: (i) fired wave 3 before checking its own wait gate; (ii) called my scoped nine-file
     gate 'the suite' when 553 files / 9,468 tests exist; (iii) brief-claimed useCartWidth was untested when it has
     9 tests; (iv) lost P2-A1..A31 of this journal, hence the grep-verify rule; (v) an ASCII-only invariant that
     measured bytes rather than surrogates and produced a phantom alarm.
### P2-A42 (MANAGER SPOT-VERIFY OF WAVE-3 STATIC-GATE FIXES, 14:49Z, OF THE WORKING TREE NOT A COMMIT)
- Ran my own counts instead of trusting the lane (D-B5 rule). Metric = raw 'title=' occurrences via grep -o | wc -l,
  counted at 14:48Z against the DIRTY working tree, so this is a statement about the lane's in-progress bytes:
  * PosScreen.tsx = 0 (same metric at HEAD 94f7cb765 = 8) -> all eight left the parent. [measured by me]
  * components/CartPanel.tsx = 8 exactly. [measured by me]
  * components/CartActionBar.tsx = 1 (unchanged), CartFooterTotals 0, CartLineItem 0, CourseSelectorBar 0.
  => sales-domain sum before = 8 parent + 1 actionbar = 9; after = 8 CartPanel + 1 actionbar = 9. SUM INVARIANT
     HELD, so the tooltip ratchet did not GROW -- which is the rule's substance (D5 reasoning). [measured by me]
- scripts/native-tooltip-baseline.json diff is exactly the ratified shape: features/sales/PosScreen.tsx 8 -> 0 and a
  new line features/sales/components/CartPanel.tsx: 8. Nothing else touched, so no unrelated entry was adjusted to
  force a pass. [measured]
- ui/src/__tests__/cartExtraction.test.ts diff = ONE added line "'components/CartPanel.tsx'," appended to
  ADDITIONAL_TSX_FILES alongside the three 2.1/2.2 entries. No scan entry dropped, no other case edited. [measured]
  OPEN HAZARD still to be settled by the gate run: D8 -- 'pos-cart-panel' and 'pos-resize-handle' are declared in
  BOTH CartPanel.css and PosScreen.css, and adding a fourth scanned TSX is what could make the 'no class in >1 CSS
  file' case fire. If it fires, the FCR path is a test-scope ruling from me, NOT a CSS edit and NOT dropping the
  entry (both would be the suite lying about the tree).
- Lane state: CartPanel.tsx is now STAGED ('A ' in porcelain) = it is in the commit step, ~36 min of its 45-min box.
  Researcher subagent-31 still running the modal/peripheral inventory; NOTE: my own measurement at 14:46Z already
  settled its headline question -- PaymentModal/PriceOverrideModal/PromotionsModal are all separate modules under
  ui/src/features/sales/, imported at PosScreen :45-47 and invoked at :1146/:1168/:1178, so box :77's modal clause
  is satisfied by construction (see P2-A41). Whatever subagent-31 returns on modals is corroboration, not a new
  dependency; its remaining value is Q1/Q5 (block inventory + residual), which the completion pass wants for D1.
- POOL: 1 coder running, 1 researcher running, 5 coder slots idle with reason (one cohesive change-set in one file).
  Timers: schedule-9 (14:59:59Z coder dead-man), schedule-12 (14:53:57Z researcher). TEARDOWN BEFORE FINAL REPLY.
### P2-A43 (D1 IS NOW PROVEN, NOT ESTIMATED - MEASURED 14:53-14:55Z, ALL METRIC = raw wc -l unless stated)
- PosScreen.tsx by anchor: pre-2.1 (ceace1a63^) = 2,072 | at 2.1 tip ceace1a63 = 1,858 | 2.2 tip 5a0e87a22 = 1,592
  | micro 94f7cb765 = 1,592 | sibling 927894830 = 1,592 | HEAD 59edc8fcf = 1,592 | WORKTREE with 2.3 WIP = 1,247.
  [all measured by me]. Campaign lift so far = 2,072 -> 1,247 = 825 lines out of the composition root.
- CORRECTION to my own earlier note: 2,072 (not 'pre-2.2 1,858') is the true campaign BASELINE, and todo's quoted
  '2,329' matches NO anchor I can measure => D3 (stale baseline in the doc) CONFIRMED with the right number.
- D1 UPGRADED FROM PREDICTION TO PROOF. At HEAD the component's own 'return (' is at **:770** (grep metric:
  first '^  return (' after 'export default function PosScreen' at :158). So :1-769 is ENTIRELY OUTSIDE the
  render tree: imports, three tiny local helper components (:73/:92/:113), and the hook/state/wiring band
  todo:29 fences me out of. 769 > 600, therefore todo:81's '< 600 lines' is ARITHMETICALLY UNREACHABLE inside
  this campaign's own fence -- not 'we ran out of time'. Even a 100% render-tree extraction cannot go below ~769.
  This is the strongest single sentence in the deviations register and it is now measurement, not opinion.
- ATTRIBUTION CLEANLINESS for the 2.3 review: 'git log 5a0e87a22..HEAD -- ui/src/features/sales/PosScreen.tsx'
  printed NOTHING => no sibling touched PosScreen between my 2.2 and HEAD, so the working-tree diff at gate time
  is 100% mine. The reverse-diff move proof against 5a0e87a22 is therefore valid without a sibling-noise caveat.
  2.3 net removal = 1,592 - 1,247 = 345 lines against a 351-line fragment (delta = the replacement invocation).
- EXTEND-vs-INTERRUPT RULINGS for the two lanes now past/near their boxes (rule: extend if the reference is an
  immutable commit, interrupt if it is the live tree):
  * Researcher subagent-31: anchor-scoped (its ANCHOR commit is immutable) => EXTEND. schedule-12 firing at
    14:53:57Z is EXPECTED and needs no action beyond this note; its remaining value is the block inventory.
  * Coder c8911a4e: was at ~36 min of a 45-min box and had ALREADY STAGED CartPanel.tsx at 14:48Z, i.e. it is
    inside the commit step. Interrupting mid-commit risks a stale .git/index.lock and a split-brain tree, and
    its diff reference IS immutable (the anchor). => EXTEND to completion; do NOT interrupt. schedule-9
    (14:59:59Z) is the hard ceiling: if the commit is absent then, interrupt + clean lock + re-dispatch the
    narrow 'gates + commit only' remainder to the SAME lane (warm context, D-B8 precedent that worked).
- POOL: 1 coder + 1 researcher running, 5 coder slots idle WITH REASON (one cohesive change-set in one file,
  no collision-free work remains that is inside todo:21-26's fence; S1/S2/S3 stay PARKED per P2-A41).
### P2-A44 (TWO HYPOTHESES CLOSED BY METRIC, 14:58Z - one confirms D2, one was a REAL DEFECT CANDIDATE)
- DEFECT CANDIDATE RAISED AND KILLED: 'expand' and 'setOpen' appear 4x and 5x in the anchor PosScreen but 0x in
  the new CartPanel, which would have meant the lane dropped state/handlers out of the moved fragment. Measured
  three ways: anchor PosScreen expand=4 setOpen=5 | WORKTREE PosScreen expand=4 setOpen=5 (UNCHANGED) | and the
  decisive one, grepping the anchor's moved range 783-1133 for those patterns = EMPTY. All 9 occurrences live
  OUTSIDE the fragment (metric: grep -n line numbers): :32/:357/:363/:368 expandBundleItems (bundle logic),
  :421/:858/:867 setOpenBillName (open-bill modal), :266/:1192 setOpeningBalance (drawer-count modal).
  => NO STATE DROPPED by 2.3. [all measured by me]
- CAUTION FOR THE COMPLETION RECORD: both 'setOpen' hits are SUBSTRING matches on setOpenBillName /
  setOpeningBalance, NOT a boolean open/collapse state. So there is no hidden collapse state hiding under a
  different name either.
- D2 UPGRADED TO PROOF: collaps/Collaps/toggle/Toggle/aria-expanded/fold all = 0 in the anchor file. The
  todo's 'COLLAPSIBLE' cart panel describes an affordance the source never had, so my steer ('do not invent
  collapse state, report it as a doc defect') was correct by measurement, not by preference. [measured by me]
- New file surface, metric = export lines: CartPanel.tsx :93 'export interface CartPanelProps' and :173
  'export function CartPanel' (named export, matches 2.1/2.2 precedent). Typecheck at the gate is the authority
  that the parent's import form agrees; not assumed here.
- Lane: no commit at 14:57:13Z, NO .git/index.lock, still running. Ceiling schedule-9 = 14:59:59Z with the
  pre-committed plan: if absent then, interrupt + re-dispatch 'gates + commit only' to the same warm lane.
### P2-A45 (WAVE-3 GATE AT dc148cb73 - MOSTLY GREEN, ONE OF MY OWN REGISTER ENTRIES WITHDRAWN)
COMMIT: dc148cb73 'refactor(pos-ui): consolidate CartPanel and reduce PosScreen to composition root' (todo:85 subject
  verbatim), parent 59edc8fcf (sibling landed under the lane mid-window), 5a0e87a22 confirmed ancestor by
  merge-base. Exactly 4 paths: the 2 fenced source files + the 2 static-gate files (my ratified FCR-equivalent, D5).
GATE RESULTS (all run by ME on the merged/committed tree, not worker-reported):
  1. MOVE PROOF: aside 344 ln (anchor 790-1133) vs CartPanel 263-606 = STRICT byte-identical, diff = 0 lines,
     NO dedent allowance needed (stronger than 2.2, which needed ratified dedents). Resize block old 783-789 vs
     panel 256-262 = identical modulo indentation (diff 0 after dedent).
  2. FULL NUMSTAT ACCOUNTING CLOSED: PosScreen -433/+88. Deletions = 344 aside + 7 resize band + 72 helper
     function block + 4 superseded component imports + 5 stale directive-comment lines (+2 import lines rewritten)
     = 433. Insertions = 79-line CartPanel invocation + 6 new comment lines + 1 import + 2 rewritten import lines = 88.
     The lane reached the same total independently (351 fragment + 72 band + 4 + 1 + 5 = 433). Two decompositions,
     same number.
  3. NOTHING LOST: elapsedHoursMinutes / ShoppingBagIcon / HistoryIcon / KitchenDisplayIcon each old=2 -> parent=0,
     panel=2 (MOVED, no dead copy). FEATURES parent=0/panel=2. CartLine KEPT in both (parent 4, panel 13) because
     still used in the wiring band. startResize STAYS parent-side at :209 and is threaded as a prop (panel :94
     interface, :174 destructure, :258 JSX) - behaviour in the parent, presentation in the child, exactly the split
     the todo wanted. subtotal stayed Money|null (2.2's D6 was a CartFooterTotals matter, not a 2.3 regression).
  4. FULL SUITE (npm run test, metric = all vitest files under ui): 553 passed / 553 files, 9,444 passed | 24
     skipped | 0 FAILED, 68.62s. Versus my earlier reading 3 failed / 9,441 passed = +3 tests, and those 3 are
     EXACTLY the three source-text-keyed reds I predicted would clear at commit time (dead-class case, tooltip
     'no NEW native title' case, baseline-honesty case). Discharges todo:56 and :68.
  5. TYPECHECK (npm run typecheck -> tsc --noEmit) exit=2 with 2 errors, BOTH in ui/src/features/workspaces/
     WorkspaceHome.tsx (14,1 TS6133 'ToolsCategoryGrid'; 15,15 TS2440 'ToolLockReason'). Zero diagnostics under
     features/sales - GREEN BY DELTA, foreign red correctly attributed, NOT legalized. This also closes the
     consequence of the lane's hook escape: OZPOS_SKIP_TYPECHECK=1 meant the hook's typecheck arm did not run,
     and I ran it directly instead. REPORT WorkspaceHome.tsx to its owner: it blocks every UI commit hook.
  6. ESLINT: CartPanel.tsx = ZERO-BYTE report (exit 0) - my proof standard met. PosScreen.tsx = 905 bytes / 3
     react-hooks/exhaustive-deps warnings; the ANCHOR file via --stdin = 905 bytes / the same 3 warnings, same
     rules, all inside the fenced wiring band. ZERO new diagnostics. My own brief demanded 'zero-byte reports for
     both files' - the lane correctly reported that as UNREACHABLE (tidying pre-existing hook warnings is out of
     fence) and proved equivalence in kind instead. Premise correction accepted.
  7. SCOPED GATE, METRIC LABEL FIXED: my 'scoped nine-file gate = 183 tests (182 pass, 1 skip)' and the lane's
     '203 (202 pass, 1 skip)' are BOTH right for different nine-file sets: mine included useCartWidth (9) and not
     usePosState (29); theirs the reverse. 183 + 29 - 9 = 203. Never quote a scoped number without its file list.
REGISTER CORRECTION - D8 WITHDRAWN (my error, the lane was right):
  D8 claimed 'pos-cart-panel and pos-resize-handle are declared in BOTH CartPanel.css and PosScreen.css'. Measured
  by file: PosScreen.css pos-cart-panel=0, pos-resize-handle=1 - and that one hit is :17 INSIDE A PROSE COMMENT
  ('...CartPanel.css alongside .pos-resize-handle...'), i.e. a mention, not a declaration. CartPanel.css has the
  real rules (4 / 10). So there was never a duplicate-declaration hazard and the dead-class case could not fire.
  ROOT CAUSE: I reused my own documented failure mode - counting a grep hit without checking whether it was code
  or comment (the sibling ledger warns about exactly this for Rust attributes). D8 is deleted from the register,
  not annotated. Consequence: the campaign's CSS end-state is clean; no FCR was ever owed here.
DOC-DEFECT CONFIRMED BY A THIRD MEASUREMENT: todo:76 'collapsible' - 'collaps' matches 0 times in BOTH files and
  the aside renders unconditionally. Unimplemented feature request, not preserved behaviour. No affordance invented.
STILL OPEN: check:all (todo:82) - first attempt exceeded the 300s bash ceiling and reset my persistent shell;
  restarted detached to /tmp/ca.txt, result to be read next round. Then the 2.3 correctness review and P-P6 docs.
LANE c8911a4e SETTLED (SUCCESS, 3 disclosed premise corrections, 1 disclosed process slip: OZPOS_SKIP_TYPECHECK
  escape + its own cd-prefix bug before that + a deliberate one-step overrun past the 45-min box). Box overruns +1.
POOL after this wave: coders idle (all three waves landed), researchers idle. 5 coder slots idle WITH REASON:
  remaining work is review + gate + docs, not parallel code.
### P2-A46 (WAVE-3 GATE CLOSED: check:all ATTRIBUTED ARM BY ARM - AND THE REAL CAUSE OF THE UI TYPECHECK RED)
clock 15:27Z; HEAD = dc148cb73 = MY CAMPAIGN TIP (git log top line; the tree stopped moving over my file).
npm run check:all (= node scripts/check-ui.mjs) run detached 15:15:38Z, 344.6s, 8 arms: 4 PASS / 4 FAIL. Arm table:
  PASS  i18n lint 5.5s | FTL dedupe 0.3s | Bundle budget 9.8s | Perf smoke (Playwright) 25.2s
  FAIL  ESLint 69.5s | TypeScript type check 30.7s | Unit tests (vitest) 52.1s | E2E (provisioned) 1.3s
ATTRIBUTION, each with the measurement that carries it:
  1. ESLint arm: '54 problems (1 error, 53 warnings)'. The ONE error is
     features/workspaces/WorkspaceHome.tsx 14:10 'ToolsCategoryGrid' is defined but never used. 53 warnings are
     repo-wide pre-existing (react-refresh, exhaustive-deps, consistent-type-imports) - warnings do not fail the
     arm. My scope contributes 0 errors; PosScreen.tsx shows exactly the 3 known exhaustive-deps warnings at
     :376/:399/:487 and CartPanel.tsx appears NOWHERE in the report.
  2. TypeScript arm: the same file, (14,1) TS6133 + (15,15) TS2440. Zero diagnostics in features/sales.
  ** ROOT CAUSE OF 1 AND 2 - SHARPER THAN WHAT I WROTE IN P2-A45: it is NOT committed breakage at all. **
     git status --porcelain -> ' M ui/src/features/workspaces/WorkspaceHome.tsx' (21 dirty files repo-wide);
     git diff --stat -> 1 file, 2 insertions(+); git log 5a0e87a22..HEAD -- <that file> -> EMPTY (nobody committed
     it); HEAD blob line 14 = "import './WorkspaceHome.css';" while the WORKTREE line 14 =
     "import { ToolsCategoryGrid } from './components/ToolsCategoryGrid';".
     => A SIBLING'S UNCOMMITTED 2-LINE WIP IMPORT PAIR makes the repo-wide ui typecheck + lint arms red for EVERY
     lane on this branch until it lands or reverts. That is the mechanical reason my 2.3 lane had to use
     OZPOS_SKIP_TYPECHECK=1, and it is the single highest-value coordination item for the owner. P2-A45 said
     'foreign red correctly attributed' - correct, but I must not let it read as 'pre-existing in HEAD'. It is not.
  3. Unit tests (vitest) arm: HARNESS ARTIFACT, NOT A TEST RESULT. The arm captured EXACTLY ONE vitest run (grep -c
     'RUN  v4' = 1; one 'Test Files' summary) ending 'Test Files 553 passed (553) / Tests 9444 passed | 24 skipped
     (9,468)', no failure section, no Unhandled Errors block. My OWN direct runs: npm run test exit=0 at 15:0x
     (Duration 68.62s) and AGAIN at 15:26:15-15:27:25Z exit=0 (Duration 69.49s, 553 files, 9,444 passed | 24 skipped).
     Two independent exit-0 runs of the identical command on this tree. The arm's reported 52.1s is also SHORTER
     than vitest's own internal 73.05s, which no passing-or-failing child can do - so the arm's verdict and its
     timing are both instruments measuring something other than the tests. Mechanism referred to researcher
     subagent-36 (read-only dossier on scripts/check-ui.mjs exit-code rule + per-arm timeout + one-arm flag);
     NOT patching a shared harness script, and not my fence.
  4. E2E arm: 'X Error: stale E2E images' then 'E2E SETUP FAILED - 0 tests executed (backend/Vite never came up;
     not a test failure)' - the script itself labels it not-a-test-failure. Infrastructure precondition (Docker
     images need refreshing), foreign to a JSX extraction that touches no backend.
BOX :82 VERDICT, STATED HONESTLY: I will NOT record 'npm run check:all passes'. What I can record is: it RAN; all
  four arms that can attribute to my scope pass (i18n, FTL dedupe, bundle budget, perf smoke), the unit-test suite
  passes with exit 0 by direct double measurement, and all four reds are foreign (2 = a sibling's uncommitted
  worktree edit, 1 = harness artifact, 1 = missing Docker images). This wording goes verbatim into the completion
  record so a reader cannot mistake a repo-wide red for campaign debt.
OPEN: reviewer subagent-34 (Correctness over dc148cb73) still running at 15:27Z, dispatched 15:20:16Z; researcher
  subagent-36 just dispatched. Timers: schedule-13 (reviewer dead-man 15:35:31Z) + new researcher dead-man.
POOL: 6 coder slots idle WITH REASON - all three waves landed and gated; remaining work is review + docs, which no
  coder slot improves. 2 specialists active (1 reviewer + 1 researcher), within the 8-global cap.
### P2-A47 (CAMPAIGN-2 COMMIT PROVENANCE TABLE - for the P-P6 completion pass; metric: git log --grep='refactor(pos-ui)')
ONE COMMIT PER PHASE, each subject verbatim from the todo's mandated line. No other refactor(pos-ui) commits exist.
  2.1 (todo:59) ceace1a63 'refactor(pos-ui): extract CartLineItem and CourseSelectorBar presentation components'
       4 files, +274/-224. Parent of the chain; pre-2.1 PosScreen raw wc -l = 2,072 (measured at ceace1a63^, which
       CORRECTS the doc's implied 1,858 baseline - see D3).
  2.2 (todo:71) 5a0e87a22 'refactor(pos-ui): extract CartFooterTotals and CartActionBar components'
       5 files, +478/-314. PosScreen 1,858 -> 1,592. Reviewed PASS WITH NOTES (actions 51/51, footer 259/259
       byte-identical, -314 = 311 moved + 1 deleted eslint line + 2 counted elsewhere).
  2.3 (todo:85) dc148cb73 'refactor(pos-ui): consolidate CartPanel and reduce PosScreen to composition root'
       4 files, +701/-435. PosScreen 1,592 -> 1,247; CartPanel.tsx NEW 609. Move proof STRICT byte-identical
       (P2-A45 item 1). Full suite 553/553 files, 9,444 passed / 24 skipped, exit 0 by direct double measurement.
  Campaign arithmetic (metric: raw wc -l on PosScreen.tsx): 2,072 -> 1,247 = -825 lines lifted out of the
  composition root across three commits; 5 new component modules created (CartLineItem, CourseSelectorBar,
  CartFooterTotals, CartActionBar, CartPanel) = exactly the todo:21-25 owned-path fence, nothing else added.
NOTE FOR THE DOC PASS: the todo's Goal line and boxes :77 (modals) / :79 (hardware listeners) are NOT owed a
  wave-4. Modal extraction is satisfied by construction (PaymentModal/PriceOverrideModal/PromotionsModal already
  exist as modules, imported PosScreen :45-47, invoked at anchor :1146/:1168/:1178 - researcher subagent-31 Q3,
  corroborated by my own grep), and the hardware listeners are top-of-file hook code inside the todo:29 Agent-1
  fence (barcode integration at anchor :401-:460, width listeners :306-:327). Both must be recorded as
  out-of-fence / already-satisfied, NOT silently checked off.
### P2-A48 (PAUSE AT USER REQUEST - 15:5xZ. STATE SNAPSHOT + EXACT RESUME QUEUE.)
USER ORDER: 'lets pause the development, do not spawn any more agents'. Complied: no further dispatches.
ACTIONED: goal goal-06110e85-26f2-44c8-8c1a-062edefeb2f9 PAUSED by direct human request (rev 1 -> 2). Both in-flight
  one-shot jobs cancelled (subagent-36 researcher on check-ui.mjs; subagent-37 completion-pass writer). Timers
  schedule-13 and schedule-14 deleted; schedule_list now EMPTY and job_list shows NO running or stopping jobs.
CLEAN-PAUSE PROOF (measured, this turn): HEAD is still dc148cb73 = my own wave-3 commit; the todo file is still
  named todo-refactor-pos-screen-agents-2.md with NO porcelain entry (the writer had not touched it, so nothing was
  half-renamed or half-committed); and `git status --porcelain -- ui/src/features/sales/ ui/src/__tests__/
  cartExtraction.test.ts scripts/native-tooltip-baseline.json` printed EMPTY = every campaign path is clean.

OBJECTIVE STATUS AT PAUSE: ALL THREE CODING WAVES ARE LANDED, GATED AND REVIEWED. Nothing is broken, nothing is
  uncommitted, no work is in flight. Campaign-2 ledger: 2.1 ceace1a63 (4 files +274/-224) | 2.2 5a0e87a22 (5 files
  +478/-314, reviewed PASS WITH NOTES) | 2.3 dc148cb73 (4 files +701/-435, reviewed APPROVED 0C/0M/0Minor 2 Nits).
  PosScreen.tsx 2,072 -> 1,247 raw lines (-825) with 5 new component modules = exactly the todo:21-25 fence.
  Wave-3 gate evidence lives in P2-A45 (byte-identical move proof, numstat closure, eslint/typcheck deltas, full
  suite 553 files / 9,444 passed / 24 skipped exit 0 by double measurement), P2-A46 (check:all arm-by-arm
  attribution + the foreign-uncommitted-edit root cause) and P2-A47 (provenance table).

RESUME QUEUE - EXACTLY ONE ITEM LEFT, plus two optional follow-ups:
  R1 (the only outstanding deliverable) P-P6 completion pass on todo-refactor-pos-screen-agents-2.md: flip all 18
     boxes, append a Completion Record with these nine items, rename to done-todo-refactor-pos-screen-agents-2.md,
     land as ONE docs commit 'docs(pos-ui): close agent-2 cart UI extraction todo with provenance and deviations'
     via `git mv` + explicit-pathspec commit (never add -A / --amend / --no-verify; OZPOS_SKIP_TYPECHECK=1 is the
     pre-authorised escape because the hook typecheck is red on foreign uncommitted code). The nine items, each to
     be re-verified by the writer with the named cheap command: (1) 3-commit provenance table; (2) size outcome
     2,072 -> 1,247 and WHY todo:81 '< 600 lines' is not met literally (todo:29 fences the first ~769 wiring lines;
     return already at :770; and the doc's 2,329 baseline matches no anchor); (3) the zero-diff 344-line byte-identity
     proof; (4) review verdict + its two structural proofs (all 77 props are x={x}; child has zero hooks besides
     useLocalization so no stale closure is possible); (5) npm run test exit 0 / typecheck 0 diagnostics in
     features/sales / CartPanel.tsx eslint zero bytes - and never call the typecheck a pass; (6) check:all honestly
     as run-with-4-foreign-reds, quoting the vitest-arm paradox; (7) the modal clause satisfied by construction and
     the hardware-listener clause fenced out, recorded rather than silently ticked; (8) deviation register D1-D10
     transcribed from this journal with D8 recorded as WITHDRAWN and D9 kept visible as owner-facing debt;
     (9) an 'For the owner' section on the WorkspaceHome.tsx blocker. Plus the todo:76 'collapsible' doc defect.
  R2 (optional) the check-ui.mjs vitest-arm mechanism dossier was killed mid-run; what stands without it is
     sufficient: the arm reports FAIL while its own captured output is a single complete all-pass run, and the
     identical command exits 0 when I run it directly. Instrument curiosity, NOT campaign debt.
  R3 (optional) nothing else. S1/S2/S3 (adopt the zero-consumer posScreenHooks.ts twins) remain PARKED: they edit
     lines above the render tree, i.e. Agent 1's fenced region per todo:29.
  TO RESUME: update_goal action resume on goal-06110e85-26f2-44c8-8c1a-062edefeb2f9 (current rev 2), re-check
     list_agents + job_list first per P-P9, then dispatch ONLY R1.

OPEN ITEM FOR THE OWNER (independent of this campaign, blocks every UI commit hook on this branch): an uncommitted
  foreign 2-line edit to ui/src/features/workspaces/WorkspaceHome.tsx (worktree :14 imports ToolsCategoryGrid,
  HEAD :14 is the css import) yields TS6133 + TS2440 and one eslint no-unused-vars error repo-wide. Not mine, not
  fixed, not touched. 21 files dirty tree-wide at pause; none of them mine.
