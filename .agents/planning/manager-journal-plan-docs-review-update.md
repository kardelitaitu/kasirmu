# Manager Journal — review & update 11 plan documents

## Goal & Architecture
Objective: review and update 11 plan/todo docs at repo root of C:/dev/ozpos (branch `main`) so every
load-bearing claim (file paths, symbol names, line counts, IPC names, "already done" status)
matches the current tree. Docs are OWNED as documentation-only edits; no production code changes.

Docs (lines @ 2026-09-14 07:26):
- todo-payment-agents-4.md (144)
- todo-payment.md (713)
- todo-refactor-cloud-sync-agents-1.md (38)
- todo-refactor-devmock-agents-3.md (89)
- todo-refactor-kds-agents-1.md (49)
- todo-refactor-kds-agents-2.md (51)
- todo-refactor-kasirmu-app-agents-3.md (141)
- todo-refactor-pos-screen-agents-2.md (86)
- todo-refactor-pos-screen-agents-3.md (90)
- todo-refactor-settings-agents-2.md (52)
- todo-refactor-settings-agents-3.md (53)

Rules that bind this work: AGENTS.md — no new branches, no push, pathspec-only commits
(`git commit -m "docs(<area>): <subject>" -- <paths>`), never leave things staged, forward slashes.

## Live Dashboard
| id | role | fence | state |
|---|---|---|---|
| 67afc2e4 | researcher R1 | read-only (payment x2 + devmock) | in-flight |
| 3cee5114 | researcher R2 | read-only (8 refactor docs) | in-flight |
| a4e1b85f | ops O1 | .agents/plan-docs-facts-2026-09-14.md only | in-flight |
| 2568e522 | reviewer V1 | read-only: link/ADR/SHA/reference integrity of the 11 docs | in-flight |


## SETTLED DOSSIERS (evidence — condensed, full text lives in the worker sessions)
### R2 (3cee5114) — 8 refactor docs, measured on disk
Headline: every [x] box is real, but nearly every NUMBER rotted, and several docs prescribe work that already
landed under different names. Key measured facts (split-on-newline method, +1 vs wc -l):
- apps/cloud-server/src/sync_store.rs = 1,758 ln (doc 1,179); NO vector_clock/revision code (conflict only)
- apps/cloud-server/src/bin/migrate_sqlite_to_pg/ is a DIR (main 216/copy 169/rows 325/schema 126/tests 442) —
  the doc's "DO NOT edit bin/migrate_sqlite_to_pg.rs" fence names a nonexistent file = fences nothing
- ui/src/features/kds/KdsScreen.tsx = 1,194 ln (doc 1,127); NO WebSocket (Tauri listen + useKdsOffline);
  hooks block ~:95-:690, JSX return at :697; bumpOrder/recallOrder/holdTicket are INVENTED — real API is
  updateKdsStatusScoped/listKdsOrdersScoped/getKdsQueueScoped/ackKdsOrderScoped (ui/src/api/kds.ts:59-200);
  audio already in hooks/useNewTicketSound.ts (82); no kds/utils/ dir; RestaurantMenu.tsx is in features/restaurant/
- kds components/KdsTicketCard.tsx EXISTS 575 ln (doc says NEW); useTicketSla 197 + kdsCardColors 73 +
  KdsCardColorsContext 104 already carry SLA colour work; recall modal is in ExpoScreen.tsx not KdsScreen
- PosScreen: NO ui/src/features/pos/ — it is ui/src/features/sales/PosScreen.tsx = 1,248 ln (doc 2,329);
  ALL FIVE "NEW" cart components exist (components/CartPanel|CartLineItem|CartFooterTotals|CartActionBar|
  CourseSelectorBar), CartPanel imported at :34; Agent-1 wait-gate waits on FINISHED work
- PaymentModal.tsx = 2,437 ln (doc 1,933 — it GREW); idle/selecting_method/collecting_tender states do not
  exist; real surface tenderPresets?: number[] at :66-67; verified anchors to keep: SplitRow :43,
  startSaleScoped/addLineScoped/completeSaleScoped/finalizeSale (api/sales.ts, calls :716/:730/:776)
- SettingsPage.tsx = 922 ln (doc 844); master-detail ALREADY shipped (22 lazy screens/ + SettingsNavTree);
  NO panels/ dir — convention is sections/ (GeneralSection 206, ReceiptSection 258, ...) + screens/; NO
  printer/hardware surface in settings; tax truth = features/tax/TaxConfigurationScreen.tsx 1,028 ln behind a
  33-ln placeholder screens/TaxConfigurationScreen.tsx
- DataManagementScreen.tsx = 1,017 ln (doc 915); restore 0 hits, csv 0 hits, audit/retention 0 hits,
  FactoryReset 0 hits ANYWHERE in ui/src → the doc plans work on features that do not exist; real screen is a
  DATA_TYPES export wizard (:62-68); data/ dir does not exist
- desktop lib.rs = 1,350 ln, generate_handler! at :843, 453 entries / 59 prefixes (doc 1,281 / :780 / 448 / 57);
  lib.rs's own :21 comment still says "448-entry" (code+doc drift); commands/ census now 79 files, 10
  *_tests.rs, 5,883 ln (doc 137/70/31,803); crates/oz-bridge/src NOW EXISTS = 128 files (doc claims absent);
  tablet lib.rs 797 ln, handler :445, 338 entries (doc contradicts itself: 318 vs 320)
- R2 had NO shell: all ~71 SHAs unverified by it → flagged, then verified by V1 (below)
### V1 (2568e522) — reference integrity, 11 docs / 1,506 lines, 153 refs
- 13 dead sibling links (all renamed by 94b5da2cc): cloud-sync-1:9,:10; devmock-3:19,:20,:77; kds-1:10;
  kds-2:10; kasirmu-app-3:8,:9; pos-screen-2:9; pos-screen-3:9; settings-2:9; settings-3:9
- devmock-3:77 is the ANCHOR of the ":76 Phase 3.3 SUPERSEDED BY PHASE 4.5" ownership claim → dangles
- kasirmu-app-3:132 `.circleci/workflows/06-cargo-nextest.yml` = BROKEN (no .circleci on disk or in index);
  live = .github/workflows/dev-ci.yml#cargo-nextest (:244, no --exclude) + scripts/check.sh:106 (the excludes)
- 71/71 commit SHAs RESOLVE (git cat-file) → leave SHAs alone
- 0 ADR refs in all 11 docs; docs/adr/ does NOT exist — ADRs live in docs/decisions/ (69 of them)
- contradiction: payment.md:65 "R4-R6 open" vs agents-4:138 "R4-R7 open"; 3 parallel status overlays for the
  payment epic (payment.md:57-71, agents-4:38-45, agents-4:109-141)
### MANAGER DECISIONS (this round)
D1 sibling citations = bare name `done-todo-X.md`, no `./`, no `.agents/archived/` (survives the uncommitted move).
D2 `todo-payment-agents-4.md` is the SINGLE payment-epic status authority; payment.md:65 aligns to R4-R7.
D3 SHA citations untouched (71/71 resolve); commit-COUNTS that cannot be reproduced get marked unverified.
D4 cbm project `oz-pos` is indexed at a STALE WORKTREE C:/dev/ozpos/0.0.35/oz-pos → graph results barred
   for all facts in this task; disk measurement is the only accepted evidence. (Applies to future work too.)
D5 writers never edit code: lib.rs:21's stale "448-entry" comment is recorded as a follow-up, not fixed here.

## SETTLED: R1 (67afc2e4) — payment + devmock dossier (key items)
Headline: "shipped" payment claims ARE code-backed EXCEPT the EDC leg — edc/wired.rs:4,12-14, wireless.rs:4,7,
protocol/pax.rs:4,7 all FAIL CLOSED, only mock.rs:506,544 answers (forwarded to G1 as an addendum).
Charge = payment_api.rs:99 (POST /api/payment/midtrans/qris) + :101 status poll; ledger midtrans_ledger.rs:91 +
migration 20261004_midtrans_transactions.sql:21; settlement webhook webhooks.rs:73 route/:860 handler/:1083
enqueue_finalize_sale, processed_webhooks :690-742.
G1 fence items: :129 qris-manual/midtrans/edc keys have ZERO code refs (rail store useLocalPaymentRails.ts:4-7
is real); qr_string alias ALREADY shipped (drivers/qris.rs:136-137) so 3 boxes are done; :539 classifyError
delegates now (PaymentModal.tsx:225-231) but PaymentError::classify() still not done (error.rs:14-49) —
split; :452-453 IndonesianEcr/MandiriEcr PHANTOM (0 in crates/); :457-462 register_card_terminals ALREADY DONE
(platform/startup/src/hardware.rs:213-269) with box open; :536 -> :566; :5 "three routes" -> third at openapi.rs:608.
G2 fence items: agents-4 :58-60 "no online signal in the UI" is FALSE (useGatewayStatus.ts:8,:61,
useKdsOffline.ts:568, ConnectionStatus.tsx:23); :129 -> :202-208; :46 "green" not re-run -> soften.
devmock-3 :14-17 "ZERO PROGRESS" is FALSE — handlers/staff.ts exists (572 ln, header cites this order/3.1);
:56 login_with_pin/assign_role INVENTED (real staff_login/list_staff_scoped/create_staff/list_roles_scoped,
commands/staff.rs:75,89,119,147); :84 2,375->1,127; :39 fence omits 8 handler modules.
## MANAGER git verifications of R1's "not verifiable" items (shell pass, 01:16-01:18Z)
`git show ce8666604^:ui/src/dev-mock/tauri-api.ts | wc -l` = **5,226** and `ce8666604` = **4,991** → the doc's
history figures are EXACT (keep + print command); HEAD copy = **1,127**; 4,904 unattributed → mark unreproduced.
All **11/11** SHAs cited in todo-payment-agents-4.md resolve (08adf9fe8d 09eec83868 1a0277548f 1f6a162a3
26ffd89c1c 289be3959a 3d50b3ac5a 903b30a718 9e143fc5ca bffcbda97a fb9ef9042a) → the doc's self-claim is TRUE.
`git ls-files | grep -c "^references/"` = 0 → no references/ dir; line-level references/midtrans-* citations are
unverifiable on disk (relabel, do not delete). dev-mock handlers dir = 14 modules (analytics catalog crm
floorplan inventory kds locations loyalty payment sales shifts staff system topology-state).

## Live Dashboard (current)
| owner | role | group | fence | state |
|---|---|---|---|---|
| 67afc2e4 | researcher R1 | — | payment-agents-4, payment.md, devmock-3 audit | SETTLED ✔ (forwarded G1/G2) |
| a4e1b85f | ops O1 | — | .agents/plan-docs-facts-2026-09-14.md | RUNNING |
| 3cee5114 | researcher R2 | — | 8 docs | SETTLED ✔ |
| 2568e522 | reviewer V1 | — | reference integrity | SETTLED ✔ |
| 42444384 | writer G1 | G1 | todo-payment.md | RUNNING |
| 1f3ce89d | writer G2 | G2 | todo-payment-agents-4.md, todo-refactor-devmock-agents-3.md | RUNNING |
| 1625013b | writer G3 | G3 | cloud-sync-1, kds-1, kds-2 | RUNNING |
| 5acd14c3 | writer G4 | G4 | pos-screen-2, pos-screen-3 | RUNNING |
| 0e88fa4c | writer G5 | G5 | settings-2, settings-3 | RUNNING |
| d9f6fde2 | writer G6 | G6 | todo-refactor-kasirmu-app-agents-3.md | SETTLED ✔ 14 fixes |
Pool 8/8 (ceiling). All 11 docs have exactly one owner: G1(1) G2(2) G3(3) G4(2) G5(2) G6(1) = 11 ✔

## Wave 2 LAUNCHED (T0+~6min, self-verifying writers; researchers still feeding cross-checks)
| owner | group | fence | state |
|---|---|---|---|
| 42444384 | G1 | todo-payment.md | in-flight |
| 1625013b | G3 | cloud-sync-agents-1, kds-agents-1, kds-agents-2 | in-flight |
| 5acd14c3 | G4 | pos-screen-agents-2, pos-screen-agents-3 | in-flight |
| 0e88fa4c | G5 | settings-agents-2, settings-agents-3 | in-flight |
QUEUED (pool at global ceiling 8/8): G2 = todo-payment-agents-4.md + todo-refactor-devmock-agents-3.md;
G6 = todo-refactor-kasirmu-app-agents-3.md. Launch as soon as any slot settles.
Decision: do NOT wait for R1/R2 before launching the edit wave — each writer verifies its own claims
(it must read its own doc anyway), and the dossiers arrive as an independent cross-check to be
forwarded to the SAME owner (no fence change, no re-dispatch).

Timers: schedule-1 = dead-man (900s, dispatched wave 1); schedule-2 = capacity scan (every 300s).
Must both be deleted before final reply / when no work is queued.

## Wave 2 write fences (planned, one owner per doc, no overlap)
| group | docs (exact paths, repo root) | owner role |
|---|---|---|
| G1 | todo-payment.md | writer W1 |
| G2 | todo-payment-agents-4.md, todo-refactor-devmock-agents-3.md | writer W2 |
| G3 | todo-refactor-cloud-sync-agents-1.md, todo-refactor-kds-agents-1.md, todo-refactor-kds-agents-2.md | writer W3 |
| G4 | todo-refactor-pos-screen-agents-2.md, todo-refactor-pos-screen-agents-3.md | writer W4 |
| G5 | todo-refactor-settings-agents-2.md, todo-refactor-settings-agents-3.md | writer W5 |
| G6 | todo-refactor-kasirmu-app-agents-3.md | writer W6 |
All 11 docs confirmed tracked + clean in `git status --porcelain` at 2026-09-14 (pre-wave-1), so no
cross-session collision; each doc has exactly one owner. Writers must NOT touch production code,
must NOT commit (manager does the pathspec commits at the gate).

## Completed & Commit Ledger
(empty)

## Verification Evidence (manager-run gate probes)
`git log --grep "test(bridge): relocate" | wc -l` = **43** → doc 8's "43 ×" claim EXACT (forwarded to G6).
`git log --oneline -- crates/oz-bridge | wc -l` = 148 · `-- apps/desktop-client/src/commands` = 748 ·
`--since 2026-09-01` = 2,285 · `ls crates/oz-bridge/src/*.rs | wc -l` = 121 top-level (vs R2's "128 files",
method difference — every count in these docs must now print its command).
`git show --stat 3143b6a0b` = DOCS-ONLY (todo-payment-agents-1.md, todo-payment.md) yet its subject asserts
"charge endpoint and settlement webhook shipped" → **a docs commit is not evidence that code shipped**;
forwarded to G1+G2 as the standing rule that any [x]-shipped whose only proof is a docs commit must be
re-verified in code or escalated.
`ls docs/decisions/*.md | wc -l` = 68 (V1 said 69) — no docs/adr/ dir exists.
Payment-doc history not to redo: 02140071e, 95ed37afa, 10a2a038b, eadffb4e0, 47ade2148 (several claim
"corrected" — re-verify, do not trust the message).
### Payment "shipped" claims — CODE-VERIFIED (answers the docs-only-commit hole above)
VERDICT: real code, not a doc stamp. This server's charge route = `POST /api/payment/midtrans/qris`
(apps/cloud-server/src/payment_api.rs:99 -> qris_charge_handler :153, mounted main.rs:689). Settlement routes =
/api/webhooks/{stripe,square,midtrans} (webhooks.rs:69-73); midtrans settlement logic :846-920
(`settle_like = status=="settlement"||"capture"` :920) via midtrans_ledger.rs (settlement must win over
out-of-order notices, :187-219). Contract text: openapi.rs:559-577 — HTTP 200 = QR ISSUED, not PAID.
TRAP forwarded to G1+G2: `/v2/charge` appears TWICE with different owners — crates/oz-payment/src/drivers/
qris.rs:435 posts the UPSTREAM Midtrans endpoint, and payment_api_tests.rs:47 mocks that upstream; neither is
this server's route. Behaviour is test-backed (payment_api_tests.rs:80,:120,:138,:153,:181,:195).
### Fact sheet (.agents/plan-docs-facts-2026-09-14.md, 11.4 KB, O1) — key rows
version 0.0.37 in all 5 places · migrations 59 (58 SQLite + 1 generated PG) · desktop IPC 453 distinct paths
(block lib.rs:843-1338) · tablet 322 distinct (block :445-784) but another worker counted 338 ENTRIES -> G6 told
to publish both with commands · 297 paths shared by both clients · ui features 277 .tsx / 482 files ·
ui/__tests__ 572 files · #[test] 8,252 · locales 54 .ftl (27 en + 27 id) · settings = 28 tablet vs 19 desktop cmds.
(pending: full wave gate)

## SETTLED: O1 (a4e1b85f) - STATUS: Partial. Fact sheet landed: 239 lines, sections 1-11 (12-15 not appended)
Authoritative measured table at HEAD ec2edf258: version 0.0.37 in all 5 places (only tag in clone = v0.0.5, NO
v0.0.37 tag) - migrations 59 (58 SQLite + 1 PG) - IPC desktop 453 / tablet 322 distinct / 297 shared / union 478
(blocks apps/desktop-client/src/lib.rs:843-1338, tablet :445-784, no intra-block duplicates) - ui features 277
.tsx - ui/src/__tests__ 572 files - #[test] 8,252 (crates 5659/platform 877/apps 753/modules 511/foundation 452) -
Fluent 54 .ftl, 9,824 definitions, 4,950 distinct IDs, 75 IDs with NO English definition - CI live 2 + .bak 11 -
payment crate 23 files/4,504 ln and ONLY 4 OF 5 DRIVERS COMPILE BY DEFAULT (paddle is #[cfg(feature = "paddle")],
header 'PLANNED - stub'); there is NO commands::payment::* namespace - kds ui 33 files (15 tsx, 10,865 ln),
desktop commands::kds::* = 9 - platform/sync 36 files/15,677 ln - cloud-server/src 51 files/26,191 ln - settings ui
63 files/17,141 ln (SettingsPage.css 1,105, DataManagementScreen 1,016, SettingsPage.tsx 921) - desktop settings
IPC file 379 ln vs tablet 949 - devmock ui/src/dev-mock 20 files/6,174 ln, no backend devmock module - Vitest CASE
count NOT MEASURED (needs npm run test from ui/).
+-1 CONFIRMED as a method artifact (wc -l vs read totalLines): KdsScreen 1,193/1,194, SettingsPage 921/922,
DataManagementScreen 1,016/1,017, PaymentModal 2,436/2,437 -> writers told to name the method, not chase the 1.
O1's failure mode: two run_code payloads rejected at the encoding layer ('Expected unicode escape') by
backslash-heavy markdown; worked around with backslash-free heredoc appends.

## ASSUMPTION CHECKPOINT FIRED (wave gate rule) — my forwarded finding was WRONG, a writer caught it
G3 landed todo-refactor-cloud-sync-agents-1.md (+51/-9) and REJECTED R2's claim (which I had forwarded verbatim)