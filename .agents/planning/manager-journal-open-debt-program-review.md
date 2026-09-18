# Manager Journal — open-debt-program-review

# CLOSED @ 03:40Z HEAD 2aa8fb170 — all 8 workers settled, 0 timers, 0 coders dispatched (review-only run).

## Wave 4 result — THINKER bf1e4cd5 (27/27 boxes arbitrated) -> .agents/...-ownership.md (54 lines)
TIE-BREAK RULE adopted: fence-and-grade, falsified-last. (iii) premise-still-true > (i) fence names the mutated
artifact > (ii) acceptance grades that artifact > explicit cession note > self-declared canonicity > recency. A
'CANONICAL' banner governs prose verdicts inside its own epic, NEVER another doc's work queue.
TALLY: 10 KEEP / 7 park-or-move (6 into docs/plans/notes.md, which has 0 boxes by design) / 3 delete-as-paid /
7 not-work-or-blocked. 20 of 27 rows carry a rival doc, matching the earlier map.
KEEP: :109 :111 :112 :154 :156 :157 :204 :205 :261 :262. DELETE-AS-PAID: :106 :110 :203 (+ :263 paid). NOT-WORK:
:114 :158 :159 :209 :265 :378. PARK/MOVE: :113 :206 :207 :374 :375 :376 :377.
RECOMMENDATION: Option A (keep four phases + four fences, prune to 10) + 3 mechanical edits, NOT Option B (thin
index): an index carries no fence and no per-phase acceptance command, so the program becomes un-renameable under
AGENTS.md 4, scripts/ loses its only owner, and the cross-phase sequencing at :281-:290 is stated nowhere else.
EXPENSIVE-IF-WRONG: :206/:207 (a second identity axis for one grant = schema change; migrations cannot be amended
in a shared checkout) and :106/:110 (the prior campaign closed reds by FORKING on a seed predicate and spent five
named security properties doing it — a blind re-run can leave a release leg permanently uninformative).

## TWO THINGS THE ARBITRATION GOT WRONG / THAT MOVED AFTER IT — manager re-measured at 2aa8fb170
(1) ITS SCOPE EVIDENCE IS FALSE. It asserted 'every non-test writer is Organization; LegalEntity/Location appear
    only in test rows.' Measured, non-test lines: apps/tablet-client/src/commands/auth.rs:387 and :623 pass
    ScopeType::LegalEntity to assignment_covers_resource, and apps/tablet-client/src/commands/subscription.rs:388
    passes ScopeType::Location to assignment_covers_session. So the non-Organization arms are LIVE IN PRODUCTION,
    not test-only. DIRECTION OF THE VERDICT IS UNCHANGED AND STRONGER: designing a competing axis now would
    double-model grants that are already being enforced on three scope kinds. :206 stays parked.
(2) TWO RIVAL FILES VANISHED MID-REVIEW: git status shows ' D todo-payment-agents-4.md' and ' D todo-payment.md'
    and BOTH are gone from disk (ls: No such file). Another session's uncommitted deletion — NOT touched, NOT
    restored, NOT committed by this lane (AGENTS.md 3: never stash/commit another lane's in-flight file).
    CONSEQUENCE: :261/:262's 'only tickable home' and every agents-4:LINE anchor cited across this review
    (:53-:61 canonicity, :126/:137 the fixed anchors, :141 the status verdict) are UNRESOLVABLE if that deletion
    is committed. Phase 4's two surviving boxes are therefore CONDITIONAL, and the review flags them rather than
    recommending a deletion the user cannot undo.
(3) RE-CONFIRMED A THIRD TIME at 2aa8fb170: 'git grep -c -- --release' over dev-ci.yml and check.sh exits 1 (no
    match) -> :112 is genuinely open, and open-debt-program.md is still 27 open / 3 ticked, still clean.

## Goal & Architecture
Review the plan document 'todo-open-debt-program.md' at repo root (C:/dev/ozpos): judge its
structure, sizing/fenceability, and truthfulness against the current tree; deliver a verdict plus
a re-sliced wave backlog for the user. Manager does NOT implement. Review-only task.

## Live Dashboard (in-flight only)
| id | role | fence | state | ETA |
|---|---|---|---|---|
| bb29d6cd | researcher | NEW: re-measure cross-ownership numbers + P3 fail-open truth | running | 15m |
| efa2ac3f | researcher | NEW: where do the 2 residual release failures belong | running | 15m |
| efa2ac3f | researcher | NEW: overlap/double-ownership map vs other live plans (read-only) | running | 15m |
| 7150af85 | tester | runs cargo tests only; CARGO_TARGET_DIR=target-release; NO file edits, NO commits | running | 15m |
| a2ba568d | thinker | writes .agents/manager-journal-open-debt-program-review-waves.md ONLY | running | 15m |
| efa2ac3f (pass 1) | researcher | SETTLED — structure dossier logged | done | — |
| bb29d6cd (pass 1) | researcher | SETTLED — claim/drift audit logged (16 stale claims) | done | — |
| a2ba568d (pass 1) | thinker | SETTLED — Option B verdict logged | done | — |


## Wave 1 result — THINKER a2ba568d (design review, SETTLED)
VERDICT: **Option B — minimal restructure.** 'Analytically excellent, operationally non-executable as written.'
Keep all four phases and every piece of evidence verbatim; add fences, scope the commands, lift the appendix out.

Five blocking defects found (each cited into the plan):
1. FIFTH UNFENCED WORKSTREAM: :366-384 dead-class append — 5 boxes, no fence, no acceptance command, collides
   with three other fences (screenExtraction.test.ts unowned; PaymentModal.tsx and restaurant/RestaurantMenu.css
   claimed elsewhere). It is a second programme wearing an appendix.
2. ACCEPTANCE COMMANDS ARE PHASE-WIDE, not item-scoped: 'cd ui && npx vitest run' = all 589 files, and the
   CSS walkers read the WORKING TREE, so that suite is red right now from another session's dirty
   ui/src/features/sales/CartPanelLineItem.css. A phase cannot own that green. P4's 'npm run check:all' is
   worse: 8 legs incl. Docker E2E + Playwright — unattainable acceptance for a docs-only deliverable.
3. THREE COMMANDS CANNOT RUN AS PRINTED in this harness: bash scripts/lint-i18n.sh (:172) and
   bash scripts/verify-scoped-coverage.sh (:158) hang (bare bash -> WSL). Must be rewritten via
   & 'C:\Program Files\Git\bin\bash.exe' -c 'bash scripts/...' .
4. SHARED-CONTRACT FILE OUTSIDE EVERY FENCE: the P1 '--release runner' item spans 4-5 files across
   dev-ci.yml / scripts/check.sh / scripts/gates.json / docs/operations/ci-pipeline.md / BOTH AGENTS mirrors,
   and gates.json sits in NO phase fence — yet verify-ci-docs-drift.py fails closed on a half-updated manifest,
   so that box can turn CI red for every other lane. Must be sequenced LAST, single owner.
5. FENCE PARTITION ALREADY VIOLATED BY THE TREE: 10 dirty files sit inside P1/P2 fences (crates/oz-bridge/src/
   pos.rs, local_payment_tests.rs, refunds_tests.rs, data.rs), 4 inside P4's ui/src/features/sales/** .
   Also: the plan's own self-census disagrees (:349 says 27 open, :380 says 22; measured today 27 open / 3 ticked),
   and 5 'Commit milestone' boxes are self-declared NOT WORK (9 such strings) inflating the census.

Sizing verdicts (15min / <=2 files / one outcome):
  FITS: P1 fixture fixes (1 test file) · P2 audits per domain (5) · P3a.2 one gate per box IF its test files
  join the fence · P4 R5 design doc · P4 R4/R6/R7 decision record.
  DOES NOT FIT: P1 classify-76 (split x9 by module: subscription 21, auth 18, audit 11, pos 7, staff 6,
  workspaces 5, inventory 4, terminals 2, locations 2) · P2 share-DTOs (3 files/domain -> split bridge+test,
  then tablet re-export) · P2 AppState->BridgeCtx (multi-crate churn, reaches apps/desktop-client/** owned by
  no fence: PARK) · P3 3a.3 roleAtLeast/ROLE_HIERARCHY (>=5 files, RoleBadge/RoleIcon unfenced) · P3 3b.2
  (migration SQL + migrations.rs registry [not fenced; and a SECOND same-named file exists at
  platform/core/src/database/migrations.rs — the plan never says which] + generated init.pg.sql + staff.rs 785L
  + subscription.rs 756L + tests: strictly serial, gated on two owner rulings).
COLLISION: P2 wire audit's five boxes ALL WRITE INTO ONE FILE — plan :154 says 'publish the audit as a table in
  this file'. Needs per-domain sibling journals instead.

Serial chains (one owner each): (a) gates.json <-> dev-ci.yml <-> check.sh labels <-> ci-pipeline.md <-> both
mirrors; (b) migration chain SQL -> migrations.rs -> generate-pg-migration.py -> 20260813_init.pg.sql -> hook
steps 4+5 -> static-gates; (c) the plan doc itself (tick hygiene + audit tables); (d) crates/oz-bridge/src/*
claimed by P1 fixtures, P2 DTOs and P3 gate_permission -> one bridge owner per wave.
CRITICAL PATH: lowest slack = P1 classification (gates P2 sequencing at :164 and P3b's surface at :90 — five
downstream boxes wait). Highest unblock/effort = one-time 'cargo test -p oz-bridge --release --no-run' (~6min
-> seconds thereafter). Run the release RUNNER last (blast radius = 4 contract files); run the release BUILD first.
PARKED (needs human ruling, not dispatchable): license.rs:670-683 ruling · 3b org/terminal axis ruling ·
AppState->BridgeCtx · todo-payment-agents-4.md anchor fix (another lane's file).
Sound seams the thinker vetted as keep-as-is: python scripts/verify-ipc-parity.py · cargo check -p kasirmu-tablet ·
cargo test -p {oz-bridge,oz-core,oz-payment,oz-hal} · and --release truly appears 0x in check.sh, dev-ci.yml,
release.sh today, so P1's premise is still true. AGENTS.md 4-rule confirmed: P1's one executed command FAILED,
so this file correctly stays todo- and is not renameable.
## Wave 1 result — RESEARCHER efa2ac3f (structure dossier, SETTLED)
File: 385 lines / 66,898 B. Title 'Open Debt Program — four workstreams, four fences' (:1). Goal :7; per-phase
acceptance only, 'no single gate can see all four' (:19); rules re-stated :27-33; shared-index hazards :39-41;
'a claim is its command' + rule D7 :45; box-census method :57-62. Readiness split :17 (P1/P2 now, P3 needs a
product ruling, P4 mostly blocked on inputs the repo does not have — its stated reason for being last).
Boxes (ID = line): P1 :105[x] reproduce 1231 pass/76 fail at 257ff6122 · :106 classify 76 · :109 bypass
locations.rs:231-236 · :110 profile-dishonest fixtures · :111 sync_tests.rs:35-37 · :112 add --release runner ·
:113 parked license.rs:670-683 · :114 milestones. P2 :154 wire audit 5 domains · :156 share DTOs · :157
AppState->BridgeCtx (7 of 14 fields match) · :158 parity gate · :159 milestones. P3 :203 3a.1 fold rank table ·
:204 3a.2 replace rank gates · :205 3a.3 roleAtLeast fate · :206 3b.1 design doc · :207 3b.2 implement · :208[x]
keypad e51fa247c · :209 milestones. P4 :259[x] triage 08b11846e · :261 R5 doc · :262 R4/R6/R7 record · :263 fix
anchor in todo-payment-agents-4.md · :265 milestones. Appendix: :374-378 five dead-class boxes.
Census verified: 27 open / 3 ticked (:105, :208, :259), no indented boxes.
STRUCTURAL DEFECTS (doc-internal, additive to the thinker's five):
  A. ONLY 2 OF 27 open boxes carry a per-box verifiable command (:112, :158). :110,:111,:154,:156,:157,:203-207,
     :261-263,:374-378 carry none — so 'acceptance is phase-wide' understates it: acceptance is mostly ABSENT.
  B. CONTRADICTORY STATE :203 — row open, says 'ANCHOR MOVED, DEBT LIVE', while its own amendment and :351 say
     the duplication 'is gone, not pending' / 'DEBT WAS PAID ... NOT WORK'. Same for the four milestone rows
     (:114,:159,:209,:265) counted as open while annotated NOT WORK (thinker counted 5, researcher 4 — trust the
     line list above).
  C. STALE FIGURES KEPT LIVE IN BODY TEXT: :230 '36 open / 11 done' vs :333 '30 / 20'; :313 '5/18/21/11' vs
     :334 '7/11/2/5'. Competing self-censuses 24/1 (:349 area), 23/2, 22/3, 27/3 (:380).
  D. CONFLICTING POPULATIONS for one debt: '76 independent failures' (:106) vs '368 test-shaped sites' (:359).
  E. STALE LINE POINTERS INSIDE LIVE ROWS: :204 cites WorkspaceHome.tsx:363/372/378/414 while :352 says those
     lines are blank/comment/arrows and the real gates are :351/:360/:366/:402. :191 and :176 still print old ones.
  F. RECORDED TICK REVERSAL at :355: a row ticked by 784d3fcae then un-ticked; a NOT WORK count quoted 7->8
     that measures 6->8.
  G. GIANT BOXES: :203 is 2,942 chars, :208 3,109, :204 1,966 — a 'box' that is an essay is not a work item.
PARKED-ON-HUMAN list (5, one the thinker missed): license.rs:670-683 (a) injected verifier vs (b) cfg(test) key,
  rec = stay parked (:113,:323) · 3b org/terminal axis ruling (:206,:212-214,:324) · unknown minimumRole default
  fail-OPEN WorkspaceHome.tsx:366 vs fail-CLOSED roleAtLeast role.ts:72 — 'an owner call, not a refactor', to be
  decided BEFORE the first gate moves (:204 tail) [NEW — thinker missed this] · split this file into
  todo-open-debt-agents-N.md is 'Owner's call', cut only on '## Phase N' (:18,:325) · R4 2nd terminal / R6
  credentials / R7 hardware-vendor docs are non-human blocks (:236-239,:243,:261).
## Wave 1 result — RESEARCHER bb29d6cd (claim/drift audit, SETTLED, 16 stale claims)
SOUND: all 58 named paths exist; all cargo package ids resolve (oz-bridge, oz-core, oz-payment, oz-hal,
kasirmu-tablet, kasirmu-app); Phase 2 scope table reproduces EXACTLY (98 modules / 54 tablet *Args / 11 pub use
oz_bridge / 103 bridge *Args); Phase 4 anchors exact (EDC stub line counts, HalError::Unsupported 2/2/1/1/1, no
drivers/edc/, registry.rs:57-68 PLANNED); plan:291's inert-0.0.*-deploy-arm claim verified at dev-ci.yml:695;
clippy correctly named nowhere; no CSS-linter overclaim; version lock intact at 0.0.39 (Cargo.toml:37,
ui/package.json:4); repo is on branch 0.0.39 as the plan says.
STALE-DONE (delete these boxes, do not dispatch): 3a.1 'fold duplicate rank table' (:203) — already folded
(WorkspaceHome.tsx:13 imports ROLE_HIERARCHY; role.ts:31-35 says the duplication 'is gone, not pending'); and
:263-264 'anchor in todo-payment-agents-4.md STILL UNFIXED' — it is fixed and crate-prefixed at :126/:136-137.
PREMISE ROT: plan:105's '1231 passed / 76 failed' is not re-derivable read-only AND the fixture landscape moved
under it (seeded_row_loads 144->126 uses; JOURNAL.md:11057/:11118 record 'close the release-profile fixture
campaign'). STILL LIVE and true: the --release runner gap (--release = 0 hits in dev-ci.yml, check.sh,
release.sh; excludes at check.sh:106, release.sh:62/65, release.yml:149 — only build-exe-release.ps1:82 builds
release, no test leg) and the P2 wire audit (zero mentions outside this plan; pub use still 11) and R5's absent
doc (ResilientProcessor 0x under docs/, docs/plans = 8 files none of them).
NUMBERS NOW WRONG IN PRINT: :380 says 22 open (actual 27/3, :349 correct) · :230 says todo-payment 36/11
(actual 30/20, self-corrected at :333) · :313 out-of-scope 18/21/11/5 (actual 7/11/2/5 per :334) · :301
PaymentModal 1,999 L (actual 1,810, shrinking) · :146 '322 tablet registered' (actual 323 by the repo's own
comma-split, a lane's F10 commit landed) · :203/:358 '44 ROLE_HIERARCHY|roleAtLeast hits' (actual 42, of which
role.test.ts holds 24) · :270-272 check-ui.mjs leg pointers 123..169 (actual 132..187; the eight+manifest COUNT
is right, the lines are not) · notes.md item 14 at :1389 not :1380, item 10 at :1360 not :1352.
POINTER ROT IS STRUCTURAL, NOT INCIDENTAL: BOTH of the plan's own rank-gate pointer sets are wrong now —
:204's :363/372/378/414 AND its re-anchor at :352's :351/360/366/402; actual :364/373/379/415. A re-anchor that
was wrong on the day it was written is the strongest argument for 'cite symbols, never line numbers' in any
revision of this plan. Also :109/:358 call sync_tests.rs:35 '#[cfg(test)] + #[cfg(debug_assertions)]' — :35 is
debug_assertions, :36 is #[test] (substance holds). Only real path gap: :188 cites RoleBadge.tsx:9/RoleIcon.tsx:6
with no directory; they live in ui/src/components/, not features/workspaces/ (lines correct).
RULE CONFLICT FOUND (new, neither prior worker caught it): plan:30 says 'cargo fmt --all is FORBIDDEN', but
AGENTS.md says run it before pushing and release.sh:59 checks it — the plan is STRICTER than the rulebook, so a
Phase-1 lane that rustfmts only its own files risks a red pre-push/CI fmt gate. Needs a decision at the gate,
not per-box improvisation.
CITATION HAZARD: plan:45 grounds rule D7 in .agents/manager-wave4-rules.md — D7 is there (:22-23) but that same
file says branch 'main' (:3) and 'Version is locked at 0.0.37' (:7). A worker told to read it inherits a wrong
version lock. Do not brief workers with that file.
UNRUNNABLE-AS-WRITTEN CONFIRMED, and worse than thought: the WSL hazard is TRANSITIVE — ui/package.json:17 is
'lint:i18n': 'bash ../scripts/lint-i18n.sh', and that is check:all leg 4 (check-ui.mjs:151), so Phase 4's
acceptance inherits the hang too. (Hang is [Inference] here — not executed by a read-only pass.)
## Wave 2 result — RESEARCHER efa2ac3f (overlap / double-ownership map, SETTLED) — THE HEADLINE FINDING
VERDICT: the plan is a PARTIAL CONSOLIDATION, not a source of truth. 20 of its 27 open boxes have a named rival
owner in another live plan; two rivals declare themselves canonical; and JOURNAL records the release campaign as
already CLOSED at '1,307 passed / 2 failed'. Phase 1's headline 76-reds is a stale number.
Live plan census (boxes read off dated headers, HEAD 846940e29): open-debt 27/3 · operational-integrity 17/2 ·
todo-payment 30/20 · topology-editor 38 · review-type 36/0 · refactor-kasirmu-app-agents-3 4/43 ·
refactor-kds-agents-merged 7/16 · pos-screen-agents-3 11/12 · font-system 5/8 · tools 1/13 · settings-agents-3 2/9.
Non-work-lists: payment-agents-4 0 boxes, declares 'single status authority, R1-R7 CANONICAL' (:53-61) ·
todo-kds superseded banner · docs/plans/notes.md = 'Owner decisions pending 2026-09-15', 23 items, 0 boxes.
AREA OVERLAP: (a) release profile / 76 reds / --release leg owned in FOUR places — debt :105-113,
agents-3:142 (same 1228/76 run, same sync_tests.rs:35-37 gap, same license.rs parked arm),
JOURNAL.md:10691/:10950/:11057 (65 failing -> campaign CLOSED 1,307/2), notes.md items 12 and 14 which the debt
file itself cites as its owner page. Authority: NEITHER — operational-integrity.md:93 explicitly CEDS the
release-leg decision TO the debt programme. (b) tablet wire audit / DTO / AppState->BridgeCtx duplicated by
agents-3:117 (same T1/T2/T3 SHAs, same 5-domain 'bigs' queue, same 7/14-field deferral) and claimed again by
review-type.md:131-142 (ADR #49 half, verify-dto-parity.py). (c) role rank -> permissions duplicated by
todo-tools.md:443 (open, 'PARKED 2026-09-15 as an owner ruling', arms a/b/c) + its carried-forward list :866-872 +
notes item 18; AND todo-tools.md:445 records the org axis as SHIPPED (ScopeType at assignments.rs:127,
20260916_role_assignment_scopes.sql, staff.rs:274) which CONTRADICTS this plan's 3b premise at :206. (d) payment
R4-R7: debt :226-228 QUOTES agents-4's self-declaration of authority and then RE-LISTS the same R4-R7 as its own
:236-239 table and :261-262 boxes; dead-class :374-378 collide with notes items 17/21 and 0.0.36-backlog:1775-1827.
HARD COLLISIONS: scripts/check.sh:106 + release.sh:62,65 + release.yml:149 are inside debt Phase-1's fence (:68)
AND agents-3's open box :168. crates/oz-bridge/src/** + apps/tablet-client/src/** claimed by both (:68,:125 vs
agents-3:113-123). Paid-elsewhere-open-here: :263/:264 anchor fix landed f09c5e28e/048411986 (bare-path hits now 0).
Disposition collision 3a.1 :203 open while its own text + :351 say paid, and todo-tools.md:873-878 records the
same duplication retired at c8efd4b2a. HANDED-OFF-BUT-STILL-OPEN: debt :315 says tools' one open box was assigned
elsewhere, yet todo-tools.md:443 is still '- [ ]'; and done-todo-tools-agents-3.md:68/:84 shows a '- [ ]' box
while its own line records check:all GREEN — a tick that contradicts its own evidence.
CROSS-LISTED FENCE: todo-operational-integrity.md:173 fences todo-payment-agents-4.md — a SECOND plan licensed to