# Manager Journal — codebase-improvement

## Goal & Architecture
Objective: user asked "let's improve the codebase - where do we start". Phase 1 = orient by evidence, not opinion.
Branch: 0.0.39 (HEAD at start: 68358a924). Version locked 0.0.39 - never bump.
Constraints: no new branches, no push, pathspec-only one-line commits, no git add/amend/stash,
Money i64 only, rusqlite tx for writes, prod .rs < 1000 lines with tests in sibling *_tests.rs.

## Live Dashboard
| id | role | fence | ETA | state |
|---|---|---|---|---|
| f3cc5922 | researcher A | read-only (plans, gates, .bak workflows, doc numbers) | 15m | running |
| c823012a | researcher B | read-only (file sizes, IPC dup, complexity, rule violations, coverage voids) | 15m | running |

Timers: schedule-1 = dead-man 900s.
Goal: goal-7187f3af-c820-493d-a3e9-0e76336dccc3 rev1 active, 256 rounds, objective "carefully improve the codebase, always commit your changes".

## OFF-LIMITS (other sessions' in-flight files, observed 2026-09-16 @ 5f4507966)
Never name in a commit pathspec while dirty: crates/oz-bridge/src/tax.rs, crates/oz-bridge/src/tax_tests.rs,
crates/oz-core/src/db/kds_tests.rs, todo-open-debt-program.md, todo-operational-integrity.md, AGENTS.md, .agents/AGENTS.md (peers dirty both mirrors since 735214ddf), two peer scratch scripts (a sweep helper and a plan-citation checker, both since removed from the tree — cited here by role, not by path, because check-dead-refs.py reads this journal as a LIVE doc and a non-existent path in it is a false reference) (untracked, someone else's in-flight tools).
Superseded note: tax.rs/tax_tests.rs were committed by a peer at 735214ddf and are no longer dirty as of this reading — re-check porcelain before every commit regardless.
Concurrent lanes ARE committing (HEAD moved 68358a924 -> 5f4507966 during this round): pathspec-only commits,
re-check porcelain immediately before naming paths.

## Completed & Commit Ledger
(none yet)

## Verification Evidence
BASELINE 2026-09-16 @ 5f4507966 (7 fast static gates, each run to its own log, all exit 0):
  verify-migration-column-types 0 · generate-pg-migration --check 0 (123 tables/156 idx/11 seeds agree)
  verify-ipc-parity 0 · verify-agents-mirrors 0 (2 mirrors agree) · verify-ci-docs-drift 0 (0 drift items)
  dedupe-ftl --dry-run 0 · test-eol-guard.sh 9/9 cases
  ipc-parity FINDINGS worth work: 15/448 UI commands unanswerable in dev-mock, all 15 allowlisted with
  ZERO reasons recorded; 25 scoped-orphan entries allowlisted, 11 flagged GATED DEAD SURFACE
  (create_payable_scoped, get_active_cart_scoped, get_key_rotation_info_scoped, list_active_carts_scoped,
   list_payables_scoped, pending_sync_count_scoped, record_payable_payment_scoped, renew_license_scoped,
   rotate_encryption_key_scoped, set_line_course_scoped, write_off_payable_scoped).
BASELINE 2026-09-16 @ 735214ddf: cd ui && npm run typecheck (tsc --noEmit) -> job status completed, NO diagnostics printed. Green on a tree that also carries peers' uncommitted edits, so it is a working-tree reading, not a claim about that commit.
  10 workflows exist only as .bak (android, ci, deploy, docker-digest-drift, docker-persistence, e2e-pr,
  ios, nightly, security, website) - all labelled retired and accepted by the drift checker.

## Wave 1
| worker | task | fence | state |
|---|---|---|---|
| coder (ipc-parity reasons) | convert 15 bare dev-mock allowlist entries to {name,reason} | allowlist data file(s) only | running |

## Backlog (sized, fenced, SLACK)
Sized after both dossiers land.
| # | task | fence | slack |
|---|---|---|---|
| W2-1 | TBD from ranked targets | TBD | TBD |

## Metrics
- rework: 0 - breaker trips: 0 - fence renegotiations: 0 - waves-to-integrate: 0
- slots idled: 0 - assumption checkpoints pending: 2 (AGENTS.md gate-gap claims re-measured, not trusted;
  README/AGENTS numeric claims may be stale at HEAD - researcher A checking)

## Assumptions
1. "Improve the codebase" = reduce real maintenance/verification debt, not add features. Reversible: if the user
   wants features instead, only the backlog changes.
2. Research wave needs no tree gate (6c exception). First gate = first code wave.
3. No push, no branch switch, version stays 0.0.39.
## DOSSIER A (researcher f3cc5922, HEAD 68358a924) — condensed
Gate claims (a)-(f) ALL HOLD at HEAD. Measured extras:
- popupBackgroundCompliance grades 1 of 6090 rules (0.016%); 825 hidden inside at-blocks; boundary refuses 0 ->
  fixing the boundary is worthless, the leak is POPUP_ROOT + wholesale at-block skip in extractRules.
- animationCompliance excludes .module.css (walks 138 of 139 sheets) = 1-line fix, no new logic;
  prints "506 transition declarations are never read"; 147/321 graded (45.8%), 74 swallowed by file-wide reduce amnesty.
- noiseDither: 123/432 graded; 309 un-tokenised shadows ESCAPE the gate (inverted incentive); refuses tokens.css+components.css by basename.
- CSS: eslint .css -> "File ignored because no matching configuration was supplied", exit 0. Hook has 0 .css mentions.
- Supply chain: cargo audit/deny/trivy/osv occur 0 times in either live workflow while deny.toml is TRACKED and unread.
  Mobile builds 0. E2E on PR 0 (only live Playwright is dev-ci.yml:156 website job). Nightly 0 -> no schedule at all.
- gates.json census moved to 54 required / 16 retired / 1 advisory -> AGENTS.md's "53 required ... 70 rows" is STALE.
- Docs drift: crates/ = 17 not 16 (crates/qris-core tracked, 18 files, landed c7009520d, ABSENT from README Repository
  Structure); #[test] 8,346 not 8,280; __tests__ files 592 not 589 (319 tsx/272 ts); feature tsx 301 not 299;
  ftl defs 9,841 / distinct 4,958 not 9,809/4,942; root *todo-* 19 not 20; migration count 59 HOLDS.
  AGENTS.md CSS-section line pointers stale: lint step :309-310 (not 266-267), npm test :320 (not 277),
  eol-guard :632 (not 576-577), eslint.config files: :94/:115 (not :92/:107).
- Plan axis broken: done-/todo- no longer encodes acceptance (3 files contradict their own filename);
  open-box counts: open-debt-program 29/12, review-type 21/15, app-agents-3 14/75, pos-screen-agents-3 11/12.
- PARKED-NEEDS-OWNER: main is 1019 commits behind 0.0.39 (origin/main..HEAD 1151) -> no CI claim is true of the
  shipped line; merge/push order is a human decision. .config/nextest.toml:15 retries=2 absorbs flakes to green
  and CI runs that profile -> changing it makes CI red with truth; parked, not touched.

## Wave 2 (dispatched after dossier A)
| worker | task | fence | verify | state |
|---|---|---|---|---|
| coder 2nd (README drift) | correct 6 stale counts + add crates/qris-core to Repository Structure, each with its command | README.md only | verify-agents-mirrors.py + the 6 commands | running |
| coder 3rd (animation .module.css) | remove the .module.css exclusion, fix what it surfaces | ui/src/__tests__/animationCompliance.test.ts (+ the sheet it exposes) | vitest animationCompliance | running |
| researcher c823012a (reused) | measure how many of the 825 at-block-hidden rules would FAIL if graded, before we widen popupBackgroundCompliance | read-only | n/a | running |
## Round 5 audit (timer schedule-3/4 fired)
All 5 workers still running. Steering chosen over killing for 564eddaa (past 15m box): it has produced NO diff
(working tree clean in scripts/), so an interrupt would cost the research and gain nothing; sent a wrap-up-now
demand with an explicit Partial/Blocked exit instead. If it misses the next checkpoint -> interrupt, record partial.
IDLE DECISION (3 coder slots free, deliberately unused): every remaining candidate collides or is undecided —
 scoped-orphan dead surface (peers dirty crates/oz-core/src/db/kds_tests.rs + platform/core/src/database/migrations.rs
 and a peer lane is actively retiring commands), the AGENTS.md stale "53 required"/line-pointer fixes (BOTH mirrors
 peer-dirty), and the 75 id-only Fluent IDs (needs a verdict on whether that asymmetry is a defect or by design --
 researcher capacity is 2/2 busy). Wrong work costs more than idle.
## Round 6 — wave 1 returned PARTIAL (clean, zero edits), re-briefed shrunk
564eddaa: no commit, tree clean, but established the CONTRACT:
 - data file = scripts/ipc-parity-allowlist.json, section dev_mock, 15 bare strings, object form legal there
   (OBJECT_ALLOWED_SECTIONS = dev_mock, scoped_orphans in verify-ipc-parity.py).
 - HAZARD found: desktop/tablet sections must stay bare strings — scripts/verify-scoped-reads.py (dev-ci.yml:596,
   check.sh:72) TypeErrors on an object. Parity itself runs at dev-ci.yml:642. No pre-commit step reads either.
 - 6 reasons structurally derivable (process-bound local_api set/rotate/mint, media-bound products_set_image);
   9 entries are "likely OWED not accepted" (gateway_status, preview_promoted_total_from_lines_scoped whose sibling
   IS mocked, products_list_images/clear_image, 4x topology_template CRUD, local_api_status borderline).
 -> Re-briefed: write the 6 real reasons + the HONEST "mockable, rationale not recorded, likely owed" wording for
    the 9. Deliverable includes the OWED COUNT for the owner. Optional separate 1-word commit: docstring says
    "all 16 dev_mock entries" while file+gate say 15.

## Drift re-measured by the manager at this round (confirms the README task is live, not duplicate work)
peer commit 4cf3bace1 (2026-09-15 09:37) stamped README with 8,280 / 589 / 16 crates / 299 — already rotted again:
  crates now 17 (crates/qris-core, absent from the structure map) · #[test] now 8,350 · __tests__ files now 592 ·
  feature .tsx now 301. 6683a08d owns README.md ONLY; mirrors stay off-limits (peer-dirty).
## DOSSIER B (c823012a, popup widening) — DECISIVE
474 at-blocks (348 top + 126 nested: 230 @media, 243 @keyframes, 1 @container); 979 hidden blocks; only 39 declare a
background side; exactly 1 hidden rule reaches the graded door under naive per-rule descent = .toast at
frontend/themes/components.css:1289 (reduced-motion @media, animation-only) -> FALSE POSITIVE, the class already
declares background: var(--color-toast-bg) at :1117. Verdict: naive descent lands RED on 1 compliant surface;
per-class merge lands GREEN and adds 474 nested rules to the population. Also: no checked-in tool re-derives these
numbers (one-off node walk) — recorded as a finding.
=> WAVE 3 dispatched: coder 5cd0a5f6 on popupBackgroundCompliance.test.ts ONLY, per-class descent, FLOORS must not
   be lowered, .toast must enter graded membership by a real run not a pasted number.
## DOSSIER (f3cc5922, supply chain) — tools EXIST, config is the problem
cargo-deny 0.19.8 + cargo-audit 0.22.2 installed and runnable here; advisory DB reachable. No live workflow installs
either. deny.toml (238 ln, 35 clarify blocks) ROT: all 35 pin hash 0x6435f60b, tool computes 0x137696cf, because
LICENSE changed at 4fae8bba2 (09-14) 13 days after deny.toml's last edit (86aa825f9, 09-01) and nothing re-ran it.
0 of 35 clarify names are absent from Cargo.lock (name rot = none); the rot is the HASH. deny check licenses RC=4
(38 unlicensed = our own path crates + modules-crm's invalid SPDX "SEE LICENSE IN LICENSE"); bans RC=0; sources RC=0;
advisories RC=1 = rustls 0.23.41 RUSTSEC-2026-0285, fix >=0.23.45 -- corroborated by cargo audit (same single real
finding, 10 allowed warnings). security.yml.bak needs ZERO new secrets; its container-scan fights
verify-release-workflow.py:121,211 which asserts trivy is absent; RUSTC_WRAPPER:'' trap must be copied if restored.
TRAPS recorded: (a) wiring cargo deny as a hard PR gate before internal-crate licensing is fixed goes red on day one
and gets muted; (b) an 8th pre-commit section breaks the "seven steps" claim policed in BOTH mirrors; (c) a
gates.json row lands next to an already-stale mirror census (54 required/16 retired/1 advisory vs text "53 ... 70").

## Wave 4 (2 small reversible slices)
| worker | task | fence | verify | state |
|---|---|---|---|---|
| coder (deny hashes) | re-pin 35 stale clarify hashes | deny.toml only | cargo deny check licenses: gather-failure 35->0 | running |
| coder (audit baseline) | remove the false "audit job is REQUIRED" claim | .cargo/audit.toml only | diff is comment-only; both checkers exit 0 | running |

## PARKED / QUEUED (needs quiet tree or owner)
- W5-1 SLACK=HIGH: `cargo update -p rustls` to >=0.23.45 closes the only real advisory (RUSTSEC-2026-0285, sev 5.3).
  Deferred: Cargo.lock is a shared hot file with 4+ lanes committing, and a dep bump needs a full cargo check +
  nextest cycle at a QUIET gate. Do not run it inside a busy wave.
- OWNER: 38 unlicensed = our own crates (modules-crm license string is invalid SPDX) -> manifest decision.
- OWNER: any live-CI supply-chain arm (required vs advisory against a run that is RED today), trivy container-scan
  return, and the gates.json + both-mirror + ci-pipeline.md ink that a new row requires while mirrors are peer-dirty.
- OWNER: main is 1,019 commits behind 0.0.39; nextest retries=2 absorbs CI flakes.
## Commit ledger
| sha | worker | files | proof |
|---|---|---|---|
| 8149d0fbf | 70714ba0 | ui/src/__tests__/animationCompliance.test.ts (+1/-1), ui/src/features/settings/WorkspaceSettingsModal.module.css (+38/-13) | walker 2 passed; sheets 138->139 = exactly the module count; graded 147->153; every other bucket unmoved (44/56/74/57/7/30); transitions 506->507. Intermediate red proved the 6 violations were real before the sheet was fixed. 4 peer walkers green (71 tests) + screenExtraction 272 + modal component tests 24. Fix idiom = Pattern A (@media no-preference), matching UpdateBanner.css:22; @keyframes left at top level; pointer-events kept OUTSIDE the gate (function, not decoration); consistent with useExitAnimation.ts:17 already returning 0ms under reduced motion. |
## COMMIT ce0c12357 (worker 564eddaa) — verified independently by manager, not just self-reported
manager's own run of HEAD blob: dev_mock entries 15, with reason 15, bare 0.
manager's own gate runs: verify-ipc-parity exit 0 AND "0 of 15 allowlisted dev-mock gaps carry no reason"
  (was 15 of 15); "15 of 448 unanswerable" UNCHANGED -> no gap weakened, only annotated.
  verify-scoped-reads exit 0 (desktop 16/16, clean).
ACCEPTED on derived structural ground (6): local_api set_enabled/set_port/set_store (live 127.0.0.1 listener),
  rotate_secret/mint_token (per-install signing secret never crossing IPC), products_set_image (media pipeline).
NEEDS-OWNER = 9, of which OWED = 8: gateway_status, preview_promoted_total_from_lines_scoped (its sibling IS
  mocked at handlers/sales.ts:420 while PaymentModal.tsx:540 calls the unmocked one), products_list_images_scoped,
  products_clear_image_scoped, save/load/list/delete_topology_template (x4). Plus 1 open call:
  local_api_status_scoped (accepted reading follows its unmockable siblings; a static off-shape IS possible).
CONTRACT for future lanes: desktop(16)/tablet(143) sections MUST stay bare strings -- verify-scoped-reads.py
  dict-lookups each member and TypeErrors on an object. OBJECT_ALLOWED_SECTIONS = dev_mock, scoped_orphans.
  Skipped: verify-ipc-parity.py was peer-dirty, so its stale "all 16 dev_mock entries" docstring (:1404) stays.
NEW LEAD: verify-scoped-reads --shell tablet -> exit 1, FAIL: 101 call sites, PRE-EXISTING (reproduces against
  HEAD's own allowlist). CI + check.sh run it BARE = desktop-only. c823012a asked to characterise it.
## WAVE GATE (manager-run on merged tree, HEAD 783ccee09) — VERDICT GREEN, 0 rework, 0 breaker trips
f25347c63 deny.toml re-pin: cargo deny check licenses -> gather-failure 35->0, error[unlicensed] 38->3, exit 4.
  File proof: 0x6435f60b 0 occurrences, 0x137696cf 35 occurrences. bans exit 0, sources exit 0.
  advisories exit 1 + cargo audit exit 1 = the ONE rustls 0.23.41 RUSTSEC-2026-0285 finding (fix >=0.23.45).
fe25e7156 .cargo/audit.toml: comment-only, ignore list byte-identical HEAD^/HEAD, verify-ci-docs-drift "0 drift
  items" exit 0, verify-agents-mirrors "all 2 mirrors agree" exit 0.
ce0c12357 allowlist: verify-ipc-parity exit 0 with "0 of 15 carry no reason" (was 15 of 15) and unanswerable
  unchanged at 15 of 448 (annotated, not weakened); verify-scoped-reads exit 0 desktop 16/16.
8149d0fbf animation walker: exit 0, 138->139 sheets (= the module count exactly), graded 147->153, all other
  buckets unmoved; 4 sibling walkers 71 tests + screenExtraction 272 + modal 24 green.
SHAPES CHANGED BY THE RE-PIN: the parked "modules-crm invalid SPDX" item is MOOT (its clarify block now applies and
## ROUND 10 -- supply chain chain closes; second full gate battery GREEN
## DOSSIER F (f3cc5922) -- VERDICT: DO NOT DELETE. A non-action I was about to order.
I had been moving toward a coder wave on "two dead files". The measurement says no, with teeth:
- Deleting MachineIdStatus.tsx STRANDS MachineIdStatus.css. focusVisibleCompliance:406 and touchTargetSizing:258
  do `if (!existsSync) continue;` -> they would SILENTLY SKIP it, while popupBackgroundCompliance (SHEETS_BASELINE
  :495-502, exact-string membership + the disappearance guard from 5ca3cd5c0) hard-fails. So the worst outcome is a
  .tsx-only deletion: one red suite and an orphan sheet nobody watches. And popup is DIRTY by a peer right now.
- Deleting useKeyAge.ts does not remove the get_key_rotation_info debt, it RELOCATES it out of the tablet 101 into
  verify-ipc-parity's scoped-orphan/GATED-DEAD-SURFACE bucket, and forces a storageKeyPins registry edit
  (:43 pins 'oz-key-created-at' -> 'hooks/useKeyAge.ts', cases at :169/:178) + a native-tooltip-baseline retire and
  retotal (total 76). The tool's own advice for unreachable ambient calls is "remove the allowlist entry", not
  "delete the file".
- POLICY: the repo's ONLY dead-code text is AGENTS.md:198 -- "is this screen dead code? needs three greps, not one"
  -- which is a burden-of-proof rule, not a licence. CONTRIBUTING/ARCHITECTURE/ADR mention dead code 0 times;
  eslint has no-unused-vars (an IMPORT rule) so no tool ever flags an unreferenced FILE.
- Nuance kept: 101 -> 99 by deletion would be a REAL reduction (a call site that cannot exist cannot make an
  unguarded read), and 101 is a census not a ratchet, so no baseline would need editing. It is still the wrong act.
- HISTORY that settles the intent question: docs/plans/0.0.36-backlog.md:2890/:2906 already catalogued useKeyAge as
  dead ("One hop to a caller is not reachability; the caller has to be reachable too") and closed it for a DIFFERENT
  purpose (permission gating). No document ever authorised removal. MachineIdStatus.tsx was even EDITED after its
  consumer died (e4974e362) -- maintained as a zombie for 15 days = oversight, not decision.
=> PARKED FOR OWNER as one atomic act, in this order: (1) MachineIdStatus.tsx + .css + its test + the stale mock +
   the 3 walker-baseline entries + the tooltip baseline, in ONE commit, AFTER the popup lane lands; (2) useKeyAge.ts
   belongs to whoever owns key rotation (retire the command or wire the reminder), it is an IPC-surface decision.
MICRO-ACTION ALLOWED INSTEAD (d014c6af): remove ONLY the inert vi.mock at LicenseActivationScreen.test.tsx:39 as a
 PROVEN experiment (green => inert; red => the dead-file census is wrong and the component is transitively reached).
## ROUND 11 -- wave 9 dispatched, and a clean NEGATIVE result
70714ba0 (3rd trip): the comment class does NOT replicate into the 4 sibling walkers. 0 phantoms, 1 walker
  exposed-by-construction (noiseDither reads components.css RAW at :570 while masking its tree walk), unexploited
  at this tip => NO EDIT, NO COMMIT. Classification with proving lines: themeToken masks at 21 sites (:615
  blankComments + :283 scanCSS), composed masks (:98 stripCommentsKeepLines, both disk reads), popup masks (:114
  maskComments -> :213 -> getBackground :258, called only on masked text -- no raw door). Tree-wide prose-only
  needles: background: 0, box-shadow: 0, animation: 3 (the three 37fa70dda removed), var(--) 38, --prop: value 36.
  DIRECTION analysis kept: a comment background: transparent in a popup rule would manufacture AND satisfy a
  graded rule = the verdict resting on prose; noiseDither's exposure is false-GREEN-shaped (:601 only warns).
RESIDUAL HOLE, NAMED NOT PATCHED: every masker in the repo incl. mine is the lazy /*..*/ non-greedy regex, which
  needs a CLOSING marker, so an unterminated /* stays visible and its prose is graded. Exactly 1 orphan opener in
  139 sheets: ui/src/features/sales/PosScreen.css:699, tail holds no '{' and none of the graded shapes => 0
  phantom rows today. The one-line-per-masker fix is available and unneeded; do not spend a wave on it.
MY LANE CAUSED README DRIFT: b61aedee0 added appShellBootDevRead.test.tsx, so the 2026-09-16 stamp's
  "592 files under ui/src/__tests__" is now wrong by one through MY OWN commit. 70714ba0 dispatched to re-measure
  all six live counts (crates, feature tsx, test files + split, #[test], migrations, FTL per-file, IPC via the
  script's own extract_handlers) with dated predecessors kept. Fence README.md only -- the same figures are stale
  in both AGENTS mirrors, but 6683a08d is inside them, so that drift is ROUTED SEPARATELY, not fixed around it.
QUEUE: 6 coders at cap => 2 researchers on Wave 10 sizing: c823012a measures the per-scope reduced-motion amnesty
  (how many of the 57 would-fail are already covered by a same-selector reduce rule -- the number that has kept
  owner item notes.md ##21 parked as a guess of 6-18 sheets); f3cc5922 censuses the empty-catch class that
  b61aedee0 fixed one instance of, ranked by whether a FAILURE renders as a FALSE NEGATIVE the UI acts on.
## ROUND 12 -- pool saturated (6 coders + 2 researchers = 8/8), so the round went to hygiene + self-cleanup
MY JOURNAL WAS A LIVING FALSE REFERENCE: check-dead-refs.py reads .agents/manager-journal-codebase-improvement.md as a LIVE
  doc (it is not name-exempt like todo-/plan-/prd- docs) and my OFF-LIMITS line cited .agents/_sweep.py, a peer scratch
  file another lane had already deleted -> 1 unresolved ref authored by ME. Fixed by citing the two scripts by ROLE
  instead of by path. Measured: before 9 unresolved refs in 2 live docs; after 8 unresolved in 1 live doc, and 0 of
  them mine (grep -c over the tool's own output). The remaining 8 are another session's journal
  (.agents/manager-journal-open-debt-program-review-waves.md, refs to docs/plans/terminal-scope-design.md and
  payment-resilience-design.md) -- NOT mine to edit, and the checker gates nothing (advisory skill script, exit 1
  already existed before this session touched anything).
ROOT SCRATCH, authored by my own lanes, flagged for deletion after their commits land:
  67fac8ff: selftest_before.txt (10,904 B) + tablet_before.txt (18,741 B) at the REPO ROOT, untracked. Identified as
    theirs from the file content (the tablet one is the verify-scoped-reads pre-run capture). Hazard: peers commit
    hourly in this checkout and untracked root files are what a broad pathspec sweeps in.
  6683a08d: .agents/_t11a.py, _t11tests.py, _t11finish.py -- scratch INSIDE a tracked directory, the worse variant.
  Rule going forward for my briefs: capture to /tmp, never to the repo root, and never write scratch under a
  versioned path. Adding this to every future brief rather than re-steering it each time.
HEAD still 284c7d4e0 at the top of this round; the peers' workspace-cards lane holds 11 dirty ui/ paths + kds_tests.rs
  + todo-open-debt-program.md, and both AGENTS mirrors are dirty under 6683a08d. Re-check porcelain before any commit.
## DOSSIER G (c823012a) -- the reduced-motion amnesty: the defect is already fixed GLOBALLY, so I cancelled the wave
Instrument reproduced the shipped harvest bit-for-bit (139/324/151/44/55/74/57/5/30/506, violations 0) and the lane
  DISCLOSED its own first-pass bug (keyed on the @media header so no inner selector was ever seen -> false
  covered=0/18 files). Corrected tiers: strict whole-selector 34 findings/11 files; +descendant 31/11; +leaf-class
  14/7. The parked note's "6-18 sheets" was wrong both ways: 30 sheets carry a reduce block but only 7-11 produce
  findings, and 28 of 30 already scope their reduce block to named CLASSES -- per-selector handling is house style.
THE FINDING THAT ENDS IT: reset.css:202-211 (loaded by BOTH entries, main.tsx:5,8 and main.tablet.tsx:18,20) puts
  '* , *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
  transition-duration: .01ms !important }' inside a reduce block, and tokens.css:637-642 adds transition/animation:
  none. An !important duration clamp beats any class shorthand, so ALL 74 swallowed declarations -- and every one
  of the 14/31/34 candidates -- are already motion-neutralised for a reduce-preferring user. The file-wide amnesty
  is not hiding an a11y defect; it is a PER-SHEET proxy for a CROSS-SHEET guarantee a one-sheet-at-a-time walker
  (:211 for (const filePath of cssFiles)) structurally cannot see.
MANAGER DECISION (reversible, recorded): do NOT brief the per-scope amnesty. 14-34 authoring-consistency findings
  bought by 7-11 stylesheet edits to satisfy a gate whose premise just fell out is churn, and briefing it "on an
  a11y rationale" would have been a false justification -- the worker would have cited a defect that does not
  exist. PARKED for the owner as the reframed choice: keep paying for consistency, OR make the walker
  global-reset-aware and DELETE Pattern B. Evidence in hand either way.
  KdsScreen.css:2287-2290 is the proof the authors already know: 'Global @media ... in tokens.css already sets
  animation: none; transition: none on all elements. Only element-specific overrides that go beyond those belong
  here.' The gate reads one file and therefore cannot see that sentence's referent.
## ROUND 12 COLLECT -- 5 commits (mine), one cancelled wave, one re-framed owner decision
COMMITS THIS ROUND: 5d0262a86 (digest-gate claim) ae96e2eef (trivyignore 15 reviewed + 2 NEVER reviewed, named
  CVE-2026-53613 + CVE-2026-14456, log-proven 15+2=17 with -CVE- matching 0 times) c99445895 (allowlist error TEXT
  fixed via AST-blank-strings proof that no logic moved) 00712334b (both AGENTS mirrors re-pointed at the
  denominators that print, clause sha256-equal across mirrors) 0b9a9feef (README 592->593 + 319->320, cause named
  as b61aedee0 and ONLY that cause; 15 figures re-confirmed unchanged).
PEER MOVEMENT I had to steer around: 7b756b9c7 (a peer) removed an ambient arm from useTerminalHardware.ts -- the
  gate counts call sites, so any of my lanes comparing 'before 101 / after N' across that commit would have
  attributed a PEER'S FIX to its own edit or confessed to hiding a call site. Re-capture on the same tree, label
  each number with its SHA, name the commits between. Sent to both affected lanes before their VERIFY ran.
  (Re-measured myself on the current tree: --shell tablet still FAIL: 101, cleared 57 across 26 files / 42 cmds.)
MANAGER JOURNAL SELF-FIX: check-dead-refs reads my journal as a LIVE doc (only todo-/plan-/prd- NAMES are exempt,
  and manager-journal-* carries none) and my OFF-LIMITS line cited a peer scratch path that had been deleted ->
  1 false reference AUTHORED BY ME. Reworded to cite by role. Measured: 9 unresolved in 2 live docs -> 8 in 1,
  0 of them mine. The other 8 are another session's journal; the checker gates nothing and I do not edit peers'.
HYGIENE: my lanes left scratch OUTSIDE the fences -- selftest_before.txt + tablet_before.txt at the REPO ROOT
  (67fac8ff) and .agents/_t11rust.py inside a TRACKED dir (585c42ed). Steered: capture to /tmp or %TEMP%, rm the
  untracked ones after the commit. I explicitly did NOT order deletion of _t11a/_t11tests/_t11finish.py -- the
  mirror lane checked its own scratch, found them not its lane, and refused to delete a live lane's file. Right
  call; new rule for my briefs: scratch never goes in the repo, so this never recurs.
CANCELLED WAVE (see DOSSIER G): per-scope reduced-motion amnesty. Would have been 14-34 findings / 7-11 stylesheets
  justified as a11y -- and reset.css:206's !important clamp already neutralises every one of them at runtime.
  Briefing it would have put a false rationale in a commit message.
NEW SEAM (c823012a running): verify-ipc-parity prints GREEN for a check whose whole population is allowlisted away
  -- 11 GATED entries of 227 dead / 83 distinct. Same shape as the walker blacksouts but in the IPC gate, where a
  green is a claim that a surface was reconciled.
QUEUE AFTER CURRENT: mirrors' TREE-COUNTS paragraph is stale in both files (589 files / 16 crates / 299 feature
  .tsx / 8,280 #[test] / IPC 453-322-297-478) vs README's re-measured 593 / 17 / 301 / 8,354 / 455-321-301-475,
  and verify-agents-mirrors CANNOT see it -- it polices gate counts, step names, commit types, version, anchors.
  One commit, both mirrors, same sha256-clause proof. Held until 6683a08d settles its denominator edit (same files).
## W5-1 rustls BUMP LANDED (8a9954d7c) -- verified by ME, with the caveat attached
COMMIT: Cargo.lock only. git show 8a9954d7c -- Cargo.lock | grep '^[+-]' -> EXACTLY two packages moved:
  rustls 0.23.41 -> 0.23.45 (+ its checksum) and 0.103.13 -> 0.103.15 (rustls-webpki, its own transitive).
  No unrelated dependency drift, which is the guardrail the brief demanded before committing.
ADVISORY CLOSED, measured twice by me: cargo deny check advisories was exit 1 on RUSTSEC-2026-0285 all session and
  now exits 0 with 0 error/vulnerability matches. This is the FIRST commit of the goal that fixes a defect rather
  than a claim about one; the other 20+ were honesty fixes and remain the majority of the work.
BUILD EVIDENCE (manager-run, not taken on report): job pwsh-56 = cargo check --workspace --all-features -> exit 0,
  'Finished dev profile in 8.17s'. THE CAVEAT IS THE 8.17s: the target dir was already warm from the lane's own
  run, so this proves the merged tree compiles, NOT that a cold rebuild was done here, and the tree carries three
  peer-dirty tablet-client paths at the same moment. Saying 'verified green' without that would be the same class
  of overclaim I have spent twelve rounds retiring. Follow-ups queued as background jobs:
  cargo nextest run -p oz-security -p oz-crypto -p oz-lan (pwsh-57 pending) and -p the rustls-declaring crate.
ONLY ONE workspace member declares rustls directly: apps/cloud-server/Cargo.toml (grep -ln over crates/*/Cargo.toml
  apps/*/Cargo.toml). So the practical blast radius of a TLS minor bump is the cloud server plus whatever pulls
  it transitively -- narrower than I assumed when I queued this two rounds ago.
PEER MOVEMENT (not mine): apps/tablet-client/{lib.rs, commands/settings.rs, registration_gate_debt.generated.rs}
  dirty at 14:2x with settings.rs SHRINKING (-26/+?) -- a lane is editing tablet command registration, the exact
  surface my --shell tablet 101 counts. Tablet still reads FAIL: 101 / cleared 57 as of my own run, so nothing has
  landed yet. Consequence for me: do NOT dispatch any tablet-parity or allowlist edit until those paths clear, and
  treat every tablet number in this round's dossiers as pre-dating that change.
## ROUND 13 -- first DEFECT wave (real bugs, not claims), + my second false premise
RUSTLS CLOSED AND INDEPENDENTLY VERIFIED BY ME: cargo check --workspace --all-features exit 0; cargo nextest run
  -p oz-security -p oz-crypto -p oz-lan -> 180 run / 180 passed / 0 skipped / exit 0; cargo deny check advisories
  exit 0 (was 1 all session, on RUSTSEC-2026-0285); cargo audit exit 0; cargo deny aggregate exit 0. Lane also
  reported what my brief did not anticipate: plain 'cargo update -p rustls' resolves 0.23.43, which does NOT clear
  a >=0.23.45 advisory -- following my steps literally would have shipped a commit that still failed both tools.
MY OWN ERROR, SECOND OCCURRENCE, RULE CHANGED: my brief to c823012a asserted the gate prints '... turns a NO-SITE
  check GREEN' with '227 dead entries / 83 distinct'. grep says the string 'no-site' does not EXIST in the repo and
  227 in that file is '1,227 of 5,607' -- a parser statistic in a docstring. The real population is 25 entries / 25
  orphans / 14 redundant twins / 11 permission-gated, and the direction is INVERTED: dropping an entry turns the
  run RED (:3559-3570), it does not turn it green. Earlier the same failure mode put '10 of the 57 carry a comment
  fragment' in a coder brief. NEW RULE for every number I send: either it was produced by a command I ran in THIS
  turn, or it is labelled UNVERIFIED-INHERITED. Two false premises in one session is a pattern, not an accident.
WHAT c823012a DID find (real, small): scripts/verify-ipc-parity.py:1885 -- orphan_permission()'s own docstring says
  '19 of the 25 seeded entries' while the function measures 14. A stale number inside the code that computes it.
  Also: 0 of the 11 permission-gated orphans is dead config (all registered in >=1 shell), so NO entry may be
  dropped, and the allowlist's own comment already calls the section 'a work queue, not a clean bill of health'.
  scoped_orphans CAN carry reasons -- OBJECT_ALLOWED_SECTIONS already includes it; the bare names are an unfinished
  migration, not a schema limit (that is the opposite of what I told the lane).
COMMITS THIS ROUND: 925494427 (auth pill: an unaskable probe now lands on UNKNOWN and stops re-arming; red-first
  2 failures -> 23/23 green; and it corrected ITSELF mid-report -- its first 'identical lists' check grepped only
  the command lines, hiding a 98->102 renumber; second pass proved my own delta was exactly 0) · e9f813856 +
  806a256b1 (mirrors: composed 464/1064, dither 123/432, and it caught its OWN new clause re-introducing a banned
  bigram, then recovered additively instead of amending) · 963a2e8c (README: check:all is NINE legs not eight --
  b89747b28 added the tablet budget leg; docs/guides/API.md does not exist, the page is api-reference.md; apps/
  holds FIVE dirs not four -- unified/ was never listed. 12 other structural claims verified TRUE and left alone,
  including the dockerAvailable 10 s timeout and the .ps1 twin) · 4208adec4 (bare scoped-reads run now states the
  ungraded shell's counts).
THE DEFECT LIST (f3cc5922, 116 .catch sites read, ~55 classified): the class is a FAILED READ RECORDED AS A
  BUSINESS FACT. Wave dispatched: tax rounding map wiped by a catch its own comment forbids (:185 vs :172-174);
  OfflineQueueScreen rendering 'no remote failures' when the read of remote failures failed; SalesHistoryScreen
  hiding the DOUBLE-REFUND guard on a failed refunds read (:402 -> :1206/:1268 length>0); four silent
  destroySession swallows on a shared terminal. Boot-store (getDeviceId -> wrong store) and tablet-nav fail-open
  are under blast-radius measurement, NOT on a coder -- one of them may be deliberate for single-store installs.
### MEASURED THIS TURN (by me, not inherited -- see the round-13 rule): both mirrors' gate histogram is stale
python -c "...Counter(x['status'] for x in json.load(open('scripts/gates.json'))['gates'])" ->
  rows 71, required 54, advisory 1, retired 16.
BUT BOTH MIRRORS SAY: '53 required / 16 retired / 1 advisory' and '70 rows' -- in TWO places in each file
  (the amendment item (5a) and the live gates.json paragraph), i.e. FOUR stale figures across two files.
CAUSE, PROVEN NOT INFERRED: 9d5c33c68 'ci(dev-ci): add a release-profile bridge test job on push to main'
  added {"id": "release-bridge-tests", "status": "required"}. Replay of the same counter on the three most
  recent gates.json commits: 9d5c33c68 -> 71/54, d3ae1e201 -> 70/53, b89747b28 -> 70/53. So the mirrors went
  stale at that commit and the number is off by exactly one row and one required.
WHY NO CHECKER SAW IT -- the session's thesis restated for the third time: verify-ci-docs-drift.py validates each
  gate's status AGAINST THE WORKFLOWS (:169-216, VALID_STATUS at :104, the required/required-on-push/advisory
  branch rules), never the AGGREGATE the prose quotes. It can therefore read a 71-row manifest and print 0 drift
  while a mirror's '70 rows / 53 required' is wrong -- the histogram exists nowhere in its comparison set. This is
  the same hole verify-agents-mirrors.py has for counts (70714ba0 proved it for 593/nine legs): two checkers police
  the STRUCTURE of the manifest and neither polices a number quoted about it.
DISPATCH WHEN A SLOT OPENS (all 8 in flight now): one coder, fence AGENTS.md + .agents/AGENTS.md, one commit naming
  both, fix all four figures, keep '70 rows / 53 required' as the dated predecessor naming 9d5c33c68 as the cause,
  compose each clause from filesystem bytes and prove sha256+byte equality across both mirrors (the 2,078->1,034
  truncation incident in this page's own editing rule is why), then verify-agents-mirrors.py must still exit 0.
  FORBIDDEN to this task: adding a histogram assertion to either checker -- that is a gate-behaviour change I am
  not ordering without the owner, and both scripts/ files are held by other lanes today.
## LIVE DASHBOARD -- round 13 wave (8/8 slots, all measured-briefed, none invented)
| lane | task | fence | outcome owed |
|---|---|---|---|
| 564eddaa | tax rounding map wiped by a catch its own comment forbids | features/tax/TaxConfigurationScreen.tsx + test | red-first -> green, SHA |
| d014c6af | 'no remote failures' rendered from a FAILED remote-failures read | features/offline/OfflineQueueScreen.tsx + test | both suites + no new FTL key |
| 6683a08d | already-refunded badge says 'Process Refund' (refund-title repoint) | SalesHistoryScreen.tsx (+ locales ONLY if no existing key fits) | prefer an existing key, else Fence_Request |
| 84f0b208 | 4 silent destroySession swallows -> observable, behaviour unchanged | contexts/WorkspaceContext.tsx + test | logs failure AND local clear still happens |
| 67fac8ff | orphan_permission docstring states 19, its own code computes 14 | scripts/verify-ipc-parity.py (comment-only) | AST-identical-modulo-strings proof |
| 585c42ed | supply-chain enforcement census (READ ONLY) | none | how long 0.23.41 sat, blast radius, cheapest fix |
| c823012a | is release-bridge-tests (the 71st row, status required) a gate that can fail? | none | real / permanent-green / real-and-blocking |
| 8d022339 | getDeviceId->wrong store and screens-list->nav fail-open blast radius | none | per-site recommendation incl. 'deliberate' |
QUEUED (no slot): MIRRORS HISTOGRAM -- AGENTS.md x2 say '53 required / 16 retired / 1 advisory' + '70 rows' in two
  places each (4 figures); measured 71 rows / 54 / 16 / 1, cause PROVEN = 9d5c33c68 added release-bridge-tests
  (status required). Replay: 9d5c33c68->71/54, d3ae1e201->70/53, b89747b28->70/53. Neither checker polices a
  histogram: verify-ci-docs-drift.py reads each row's status vs the workflow (:104,:169-216) and never len()/Counter();
  verify-agents-mirrors.py never reads a count at all (proved twice this round: 593 and 'nine legs' both green).
QUEUED: the two other stale walker denominators the mirror lane listed then fixed (composed 464/1064, dither 123/432
  -- landed in e9f813856/806a256b1), so what remains for that lane is ONLY the histogram + the 589/16-crates/299/
  8,280/453-322-297-478 tree-count paragraph vs README's 593/17/301/8,354/455-321-301-475.
PARKED FOR THE OWNER (all need a product or copy decision, none is a code defect): (1) unverifiable-refund-state UX
  -- working patch at %TEMP%\refund-guard-patch.txt, 6 sites :376/:379/:394/:402/:423/:491; the money risk is already
  closed in-transaction at refunds.rs:124/:253 (COR-25), and RefundModal ceilings qty at the ORIGINAL line qty, so a
  real gate needs the remainder arithmetic first. (2) the 9 s cost of a bare scoped-reads run to state the ungraded
  shell. (3) reduced-motion Pattern B: delete it global-reset-aware, or keep paying for authoring consistency.
  (4) the other two empty-catch families: MachineIdStatus (unrelated), useOrientation, and the (B) 20 silent no-ops.
REFUTED-BY-ME, RECORDED SO IT IS NOT RE-BRIEFED: 'double-refund guard fails open' (no gate exists at any strength;
  :1309 never consults refunds); 'dropping a scoped_orphan turns a check GREEN' (inverse, :3559-3570); '0.23.41 is a
  desktop/tablet shipping defect' (only apps/cloud-server declares rustls).
## ROUND 14 -- the word 'required' is the finding, and it is not about one gate
c823012a audited release-bridge-tests (the 71st gates.json row, status required) at my direction. Verdict: not a
  broken job and not a permanent green -- a CORRECTLY WIRED job that CANNOT RUN FROM HERE. Chain:
  dev-ci.yml:270-287 exists, its run: line is byte-identical to the note's command, needs: changes is right, no
  continue-on-error, no '|| true', oz-bridge really holds ~1.3k tests (941 #[test] + 385 #[tokio::test]) and 7
  cfg(not(debug_assertions)) arms at license.rs:670/698 + sync.rs:196 that a debug run cannot license -- the
  premise is sound. BUT its only trigger is push to main, origin/main's last commit is 2026-09-14 and contains
  neither the job nor the manifest row, and HEAD is 1,203 commits ahead. So since landing it has had ZERO
  opportunities to run, for every one of those 1,203 commits. [Inference, labelled as such by the lane: derived
  from topology, not from the GitHub API, which it could not reach.]
WHAT THAT MAKES OF MY WHOLE SESSION: gates.json says 54 gates are 'required'. docs/operations/ci-pipeline.md --
  verified accurate earlier this session -- marks rows '✅ Required (push to main only)'. Both statements are true
  and both describe a branch nobody can reach. 'Required' in this repo is POLICY ABOUT A POST-MERGE STATE, not
  protection for the work in front of us. That is why clippy has been absent from every live workflow unnoticed
  for days, why the rustls advisory sat in Cargo.lock invisible, and why verify-ci-docs-drift.py can print
  '71 gate(s) (54 required...)' while a mirror says 70/53 and still report 0 drift -- it computes the aggregate,
  prints it, and never diffs it against the prose that quotes it.
NOR IS THE HISTOGRAM POLICED: verify-ci-docs-drift.py validates each row's status against its workflow (:104,
  :160-224, advisory<->continue-on-error pairing) -- per-row only. Nothing consumes the total. Two checkers
  police the STRUCTURE of the manifest, neither polices a NUMBER said about it. Measured replay of the cause:
  9d5c33c68 -> 71/54, d3ae1e201 -> 70/53, b89747b28 -> 70/53. Cause is one commit, proven not inferred.
LANES: d014c6af refreshing both mirrors (histogram + 589->593/16->17/299->301/8,280->8,354/IPC 453-322->455-321),
  with the page's own truncation hazard spelled out (compose from filesystem bytes, prove sha256+length per
  clause; a 2,078-byte clause once committed as 1,034). c823012a scaling my one-row finding to the whole manifest:
  how many of the 54 are CI-only-unreachable vs hook-backed vs check.sh-backed, and whether check.sh actually
  runs what it is credited with. Bounded it explicitly: origin/main is a LOCAL STALE REF, so the conclusion is
  about what this checkout can see.
FIXED DEFECTS SHIPPED (real bugs, not claims): 32c402d28 a failed remote-failures read no longer renders 'No
  quarantined items' (red-first proof: 'expected <p/> to be null'; 29/29 green after; no new Fluent key; reuses
  the file's own role=alert degraded path) and 0fed0d0bb a failed server-side logout is no longer silent (4 sites,
  +200/-4 across the file and a 166-line test).
GATE EVIDENCE at 0fed0d0bb and re-run at 32c402d28/0fed0d0bb: verify-ci-docs-drift 0, verify-agents-mirrors 0,
  verify-ipc-parity 0, verify-scoped-reads 0 (clean for desktop). Untracked scratch in the tree: ZERO (git
  ls-files --others --exclude-standard empty) -- the scratch hygiene rule held across six lanes.
## ROUND 14b -- third wave cancelled, and the two sites were both DELIBERATE
8d022339 measured the two WorkspaceContext fallbacks I was about to send to coders and refuted the premise on both:
  (1) getDeviceId().catch(()=>'') cannot boot the wrong store -- get_device_id is INFALLIBLE (health.rs:76-80:
  COMPUTERNAME -> HOSTNAME -> unknown-device, always Ok) AND resolve_boot_store re-derives the same hostname when
  the UI sends null (workspaces.rs:761-768), while 'unbound -> primary' is the documented contract
  (api/workspaces.ts:67-72) pinned by 5 tablet tests (:299/:385/:396/:415/:433). Fail-closing it would break
  single-store installs, where an unbound device is NORMAL (20260813_init.sql:1401 seeds store 'default').
  (2) listWorkspaceScreens().catch(()=>[]) is not a permission surface at all: list_workspace_screens takes no role,
  no user, no assignment filter (:173-202) -- it returns a per-workspace-TYPE config list. Both render branches are
  already filtered upstream by getNavItems(enabledFeatures, userRole, permissions) (TabletAppLayout.tsx:55; role
  gating fail-closed per menu-registry/index.ts:90-92) and route entry is gated by isPageAccessible, which does NOT
  take workspaceScreens as an input (TabletAppShell.tsx:267-269). Empty is ALSO the legitimate configured value
  (:525-529). Worst case: the wrong seven PERMITTED tabs appear. Not a privilege grant.
  LESSON FOR MY OWN PATTERN-MATCHING: 'a catch yields a value the UI acts on' is only a bug when the fallback
  COLLAPSES A DISTINCTION (known-empty vs never-answered). Three were real (offline queue, tax map, logout
  silence); two were designed because the fallback reproduces a value the backend produces anyway. Brief the
  discriminator, not the shape.
OPEN ITEM RAISED BY IT (parked, KDS surface): create_session does not validate terminal_id (auth.rs:632-641) and
  complete_sale persists Some(&session.terminal_id) (pos.rs:1900), so an empty string stores as Some('') not NULL;
  KDS enrollment carries restaurant_pos_id with no empty guard (KdsScreen.tsx:588 -> KdsEnrollmentModal.tsx:236,415).
  Data-quality question for the KDS lane, whose crates/oz-core/src/db/kds_tests.rs is dirty RIGHT NOW. Not briefed.
LANES (8/8): 6683a08d badge mislabel | 67fac8ff orphan_permission stale count | 585c42ed supply-chain enforcement
  census | d014c6af mirror histogram + tree counts | 84f0b208 teardown warn->error (decision taken from its own open
  item: a possibly-live session on a shared till is a security event, not a degraded read) | c823012a how many of the
  54 'required' gates are unreachable from this branch | dda40dcd writer recording the two DECLINED tightenings in
  docs/plans/notes.md so no later session re-briefs them | 7dc436fb the 75 English-less Fluent IDs -- what an
  English user actually sees, and whether any of the four bundle gates catches a one-sided key.
COMMITS THIS ROUND: 71f2ce4a0 (tax map -- code contradicted its own comment; and the lane proved the bug survived
  34 GREEN tests because the harness returns the SAME array object so nothing re-fired the effect: a false-negative
  in the TEST DOUBLES, not in the source) | 0fed0d0bb (logout, 4 sites, +200/-4) | 32c402d28 (offline queue).
  origin/main now 1,205 behind HEAD.
### CORRECTION TO MY OWN ROUND-14 JOURNAL ENTRY (the 'required means post-merge policy' paragraph above)
Round 14's entry said, of gates.json's 54 required rows, that 'both statements are true and both describe a branch
nobody can reach' -- implying the whole required set is unreachable. c823012a measured it at 71f2ce4a0 and the
number is smaller by an order of magnitude, so the entry as written is WRONG and this line replaces it:
  54 required = 48 with a ci block (all dev-ci.yml; ZERO name release.yml, so the R36-10 class is closed here)
  + 6 without one (rust-clippy, docker-dry-run, migration, e2e, perf-smoke, updater-signature -- the honest
  runner-only shape). 50 of the 54 carry a runners key, so 50 name a command a developer can type ON THIS BRANCH.
  Only 4 are CI-only (release-bridge-tests, rust-test-apps, rust-test-full, release-readiness), and exactly ONE
  (release-bridge-tests) names an event no reachable run produces. Relabelling 50 rows as 'retired' would be
  wrong; the honest gap is a TRIGGER/EVENT axis the manifest's vocabulary cannot express, not a status change.
  check.sh itself has ZERO ROT both directions: all 47 check.sh needles and all 8 check:all needles are present in
  the scripts they are credited to, and 0 required rows name a dev-ci.yml job that does not exist.
  STILL OPEN, and now dispatched to 8d022339: 'reachable if a developer types it' is NOT 'runs on push'. The
  pre-push hook does not obviously call check.sh and contains an escape hatch reading 'not found on PATH,
  pre-push checks skipped'. Until that chain is traced, the 50-row family is 'available', not 'enforced', and
  the mirrors' sentence 'bash scripts/check.sh -- Full local pre-push gate' is the claim under test.
PATTERN NOTE (this is now the FOURTH false premise I have dispatched, third about magnitude): all four were
  MAGNITUDE errors from a single example -- one gate -> 'all 54'; one rebuilt parser -> '10 of 57'; one allowlist
  print -> '227/83'; one badge -> 'the double-refund guard fails open'. The mechanism is that I generalise from
  the most vivid case a lane reported. Countermeasure in force: any figure in a brief that describes a POPULATION
  must come with the command that counted it, run by me that turn, or be written as 'one measured instance; true
  extent unknown'. The second form is honest and costs nothing.

### CORRECTION: my rustls scoping was WRONG in the dangerous direction (585c42ed, 2 dispatches ago)
I stated 'only apps/cloud-server declares rustls', so the advisory was server-only. False: platform/sync/Cargo.toml:30
declares it as well (plus root Cargo.toml:139), and 'cargo tree -e no-dev -i rustls --depth 2' shows the DESKTOP
binary reaching it three ways (reqwest <- kasirmu-app, tauri-plugin-updater <- kasirmu-app, platform-sync <-
kasirmu-app); rustls lines per binary: desktop 17, cloud 14, tablet 8. release.yml builds desktop installers
(:110/:118/:126, cargo tauri build :176/:209/:216). So a vulnerable TLS stack was heading INTO THE SHIPPED APP.
The only reason none shipped: the repo has ONE tag, v0.0.5, no v0.0.39. The defect was pending, not absent.
EXPOSURE, measured from the lockfile's full history: rustls had exactly one version ever, 0.23.41, introduced at
5d3ec0103 (2026-06-28) and removed only by my 8a9954d7c (2026-09-16) = 8,877 commits / 80 days carrying a
supply-chain config (deny.toml, .cargo/audit.toml) that NO runner invokes. Advisory RUSTSEC-2026-0285 published
2026-09-14 with patched >=0.23.45, so 1,271 of those commits ran after the fix existed upstream and nobody knew
until a human typed the command by hand.
AND THE OPPORTUNITY: 0 of cargo audit's remaining 10 findings would fail a gate today (8 unmaintained + 2 unsound,
ALL transitive-only, 0 workspace members as direct dependents, so deny.toml's workspace-scoping keeps them at
warning; aggregate 'cargo deny check' RC=0, ~2 s warm). A gate is free, green on first run, needs no exception
baseline. APPROVED as Option A: a WARN-only leg in scripts/check.sh:232-246's precedent shape + one gates.json
row in the a11y-advisory vocabulary. NOT a workflow edit, NOT a push-behaviour change. HELD until d014c6af
finishes the mirror histogram, because the row moves 71->72 and advisory 1->2 and mirrors must not race it.
PATTERN CHECK: that is my FIFTH refuted premise this session and the first where my error minimised a risk rather
than inflating it -- 'server-only' made a desktop-shipping defect sound small. Same root cause (generalising from a
single grep hit -- 'grep -ln rustls crates/*/Cargo.toml apps/*/Cargo.toml' omitted platform/ entirely), so the
countermeasure widens: a NEGATIVE or narrowing claim ('only X', 'nothing else') needs the glob to be provably
complete, not merely the directories I happened to name.

## ROUND 17 -- WAVE GATE ON THE MERGED TREE (7 commits since 71f2ce4a0)
COMMANDS + TAILS (all run at HEAD b9e02c716):
  verify-ci-docs-drift.py -> exit 0 'verify-ci-docs-drift: 0 drift item(s).'
  verify-agents-mirrors.py -> exit 0 'all 2 mirrors agree with the repo' (so 7bb8ab0ba's 71/54/16/1 clause is CONSISTENT, and the checker
    still asserts nothing about the histogram -- its green is not evidence about that figure, per the mirrors' own sentence).
  test-runner-labels.py -> exit 0 (runner labels enforced per-needle + fixture).
  verify-bundle-parity.py --full-census -> exit 0 '0 missing key(s)' (en 4884 / id 4960 -- d678ee2be +1 pair, ec0a35c05 added ZERO keys).
  npx tsc --noEmit -> TYPECHECK_EXIT=0.
  npx vitest run (8 owned suites: OfflineQueueScreen, TaxConfigurationScreen, app-error, useAuthConnection, SalesHistoryScreen, RefundModal,
    WorkspaceContext, DataManagementBackup) -> VITEST_EXIT=0, 'Test Files 8 passed (8)', 'Tests 189 passed (189)'.
  verify-scoped-reads.py --shell desktop,tablet -> exit 1. SEE THE NEAR-MISS BELOW.
DIRT NAMED ALONGSIDE THE GREEN: 9 dirty paths at run time -- crates/oz-core/src/db/kds_tests.rs, scripts/verify-ipc-parity.py (my 67fac8ff),
  todo-open-debt-program.md, and PEER SESSION T21's scanner set: ui/src/api/hardware.ts, features/sales/useBarcodeScanner.ts,
  features/warehouse/useWarehouseScanner.ts + their 3 test files and ui/src/__tests__/test-utils/mocks/api.ts. Plus 2 UNTRACKED scratch
  files inside the repo: .agents/_t21ui.py (9,874 bytes) and .agents/_t21ui/../_t21tests.py. NOT MINE -> not deleted, reported to the user.
  useBarcodeScanner.test.tsx is 5-FOR-23 FAILED at this moment and it is NOT my regression: 84f0b208 proved 'session teardown' occurs 0 times
  in that log and the same 3 files were green earlier in its own turn; the failing assertion is mocks.listScanners never called, inside T21's edit.
NEAR-MISS, SIXTH OVER-CLAIM, AVERTED BY CHECKING BEFORE SPEAKING: I ran scoped-reads with --shell desktop,tablet, got exit 1 with 101 sites
  including has_users / get_active_shift_scoped / void_pending_sale 'not registered in that shell', and wrote in my own draft that this was 'a REAL
  RED IN COMMITTED CODE that neither the pre-commit hook nor pre-push would catch'. Before dispatching anything I counted: 101 is EXACTLY the
  standing tablet unguarded number already in this journal, and grep -c void_pending_sale apps/tablet-client/src/lib.rs -> 0 (never registered).
  NOTHING MOVED IN THE TREE -- MY FLAG DID. Bare run grades desktop only (exit 0, 'clean for desktop'); adding tablet grades the known ~48-file
  tablet product decision (parked, human call). Root cause is unchanged and already recorded: ui/vite.config.ts:29-45 aliases the Tauri API to
  dev-mock under command==='serve' while vite.tablet.config.ts:12-16 does not, which is why tablet debt is invisible.
  WHY THIS ONE ALMOST LANDED: it fitted the thesis perfectly (a required gate no local runner invokes -- true per 8d022339) AND the numbers were
  fresh in a log I had just read. A vivid mechanism plus a matching-looking number is exactly the shape of my last five errors. Countermeasure
  that worked: 'is this number already in my journal?' costs one grep and is now a mandatory step before any red is called new.
548 COMMITS TODAY in this checkout; 7 of them mine or mine-adjacent this wave. The branch is moving faster than any prose figure can be read,
  which is the standing reason every lane now labels a number with its SHA.
DISPATCHED THIS ROUND: 585c42ed -> make the desktop open-shift refusal VISIBLE (usePosShifts.ts:164-165 'catch { // Handled silently }'),
  reusing a sales-bundle key present in BOTH languages or returning Fence_Request, cross-bundle reuse explicitly forbidden; PLUS a measurement
  question it raised itself and I adopted: PosScreen.tsx:283/:345 toasts are hardcoded English literals and the house rule forbids them -- so is
  a hardcoded toast STRUCTURALLY invisible to scripts/lint-i18n.sh the way an id-only key is invisible to bundle-parity? Count the literals, fix none.

## ROUND 16 -- GATE PASSED, THEN THE TREE MOVED UNDER A LANE (un-deliverable warning, held)
GATE (recorded in round 17 block above): 8 suites 189/189, tsc 0, drift 0, mirrors 0, runner-labels 0, bundle-parity 0.
LANDED AFTER THE GATE: ee5aacd46 (564eddaa) gates.json:91 clippy note + check.sh header -- PROVEN comment-only by me independently:
  I audited git show ee5aacd46 -- scripts/check.sh | grep '^[+-]' minus comments = only the 10-line header block, and 564eddaa printed
  sha256 of grep -v '^[[:space:]]*#' = 2f83b9a8... on 251 lines IDENTICAL before/after. 11 insertions is the header growing, not logic.
  Its two best judgements, both now briefed as standards: (a) it REFUSED my citation 'check.sh:44' because ITS OWN EDIT moves that step to
  :53 -- a note written to my spec would have been false the moment it landed, so it cites the step NAME; (b) it declined to state the
  '13 Tier 0 gates' count because run-pre-push.py is another lane's in-flight buffer. Naming > counting when the file is live.
PEER COMMITS NOT MINE, both audited by file list: 3162b97b6 refactor(ui) deletes the scanner hooks' no-session arms (7 files, T21's set) and
  aacf19a9a chore(ipc) drops SIX allowlist exemptions from scripts/ipc-parity-allowlist.json + 3 lines of docs/guides/api-reference.md.
COLLISION, UNDELIVERED: aacf19a9a removed six seeded entries from the very file 67fac8ff is correcting a docstring ABOUT (its brief:
  orphan_permission says '19 of the 25 seeded entries are that', tree computed 14 at baseline). I composed the warning twice -- re-derive at
  your SHA, prefer a NUMBER-FREE sentence naming the accessor over a fresh count, report both readings with their SHAs, keep comment-only --
  and send_message returned 'subagent unavailable' BOTH times while list_agents reports it RUNNING. Two attempts is my limit; NOT retried.
  HELD ACTION: at its settle, if the committed docstring carries any figure captured before aacf19a9a, dispatch one corrective pass. If it
  carried no figure at all, no action. This is the fourth time this session a number I passed on went stale mid-flight; the mitigation that
  actually works is the one 564eddaa and ec0a35c05 discovered independently: write the command, not the count.
DISPATCHED THIS ROUND: 564eddaa -> both mirrors still quote the RETIRED clippy note verbatim ('Local-only / manual... check.sh / pre-push'),
  which is now in neither file nor manifest, and verify-agents-mirrors is BLIND to it (it compares counts/names/types/version/job anchors,
  never note prose) + .agents/skills/tdd/SKILL.md:212's copy of 'Full local pre-push gate'. Composed from fs bytes, sha256 pair required.
  fe1bac61 (already inside README) -> ADDENDUM: README.md:200 carries the same false 'Full local pre-push gate' phrase; second commit, own
  subject, and explicitly forbidden from quoting a pre-push task COUNT because 0dc2a06d is editing that file live.
  8d022339 -> VACUOUS-GREEN CENSUS: which gates print clean when their population is EMPTY (no denominator print, no self-test, filtered
  scope yields exit 0). This is the abstract shape of every finding this session.  7dfec671 (new researcher) -> re-grade the surviving
  fail-open sites (warehouse/stock-count/EDC/KDS) with the backend-guard question answered FIRST, ranked data-integrity > false-lockout >
  notice-loss, and a standing invitation to headline 'the rest of the list contains no bug'.
T21 STATUS: their useBarcodeScanner.test.tsx red cleared with 3162b97b6 landing; their two scratch files .agents/_t21ui.py and
  .agents/_t21tests.py are STILL UNTRACKED INSIDE THE REPO. Not mine to delete. Parked for the user.
TIMERS: schedule-10 deleted (it had gone overdue), schedule-11 armed 900s over the 7 in-flight lanes.

## f8c11fc5c (0dc2a06d) -- pre-push accounting, the session's biggest script change (+204/-17, one file)
- ROUTING vs SKIP rule adopted: a task the diff never routed to is CORRECTLY absent (9 of them on a no-flag run); a task routed to but
  uncreatable because <area>/node_modules is missing is a SKIP -> named line, excluded from the pass total, exit still 0.
- New closing block: 'pre-push accounting: 13 checks RAN, 0 SKIPPED (selected but could not run), 9 not selected by routing
  (ROUTING, not a skip).' and on the skip path the green is REPLACED by 'pre-push: 17 checks passed ...; 5 did NOT run: ... Not a total.'
- Clean-run summary line proved byte-identical to the old wording (only wall-time differs) -> no developer-visible change when nothing is wrong.
- --self-test added, 15 assertions, no subprocesses, plant-and-restore RED shown (len(skipped)>0 flipped to ==0 -> FAIL 'missing node_modules
  yields a skip (got 3)', self-test exit 1; restored -> 15/15 ok, exit 0 re-confirmed AT f8c11fc5c).
- Judgement to keep: a MISSING BINARY (bash/cargo/npm.cmd, or node absent while ui/node_modules exists) resolves to a bare name, lands in
  run_task and FAILS CLOSED with exit 1 -> correctly NOT reclassified as a skip. Only node_modules drops were silent-by-construction; only the
  hook's no-interpreter branch is silent AND green, which is why 0dc2a06d is now inside .githooks/pre-push (stderr, both causes named separately,
  exit 0 DELIBERATE and commented, pre-commit's opposite choice recorded so the asymmetry reads as noticed rather than missed).

## README (fe1bac61) -- landed while I was briefing
- Status + stamp now 455/320/301/474 with the extract_handlers() one-liner, the 455+320-301=474 identity, and d29a7c0f4 NAMED as the cause of 321->320 rather than absorbed. The open disagreement with the mirrors is closed on the tool's side.
- :200 row rewritten to truth: check.sh = FULL local matrix by hand, NOT what git push runs; pre-push invokes run-pre-push.py and never calls check.sh (greps included); names the tasks a push DOES run; explicitly DECLINES to quote a task tally because run-pre-push.py was another lane's in-flight buffer; notes ee5aacd46 fixed check.sh's own header carrying the same false phrase.
- LEFTOVER (message failed -- lane transitioning): two LIVE `scripts/check.sh:44` clippy citations (Backend table + Testing Strategy), false since ee5aacd46 moved the step to :53. Fix form = repoint by NAME "clippy workspace" (grep -n 'clippy workspace' scripts/check.sh), not by number, same resolution 564eddaa reached for the same reason. Also: does the phrase 'pre-push gate' survive elsewhere on the page?
- 93a95150 spawned on ui/README.md:131 'Hardcoded English in JSX is a build failure' with STEP 1 = TRY TO CANCEL (read every lint-i18n leg + eslint config first; if any leg scans non-localized text, commit nothing and say so).
- a9ef3b7e caught a defect in MY briefing: deny.toml:1-16 ASSERTS 'cargo deny check advisories exits 1 on RUSTSEC-2026-0285 (rustls 0.23.41)' while I asserted aggregate RC=0. One is stale -- likely the config's, since 8a9954d7c moved rustls to 0.23.45 past the patch bound. So step 9a491152 opens with a BLOCKING pre-flight measurement and an explicit ban on adding an ignore entry to go green. Its other real finding: this is the FIRST network-touching leg in check.sh, so an outage must degrade to SKIP by LOG SIGNATURE (never by exit code -- cargo-deny's numeric codes are not knowable from this checkout), else my new gate teaches people a red supply-chain line means the wire was down.
- a9ef3b7e Q2, the coupling answer I asked for: a declared needle with no matching label is BLOCKING (verify-ci-docs-drift.py:954-958, and it fires in CI too); an undeclared check.sh label is only informational (:1296-1303). => step+row share one commit. And the set -e trap is real: step() at check.sh:35-38 does an explicit `exit 1`, so a step()-wrapped cargo deny would abort the whole matrix -- label must be the echo -n form (:503-510 harvests labels only from step "x" and echo -n "x"; echo -e is not harvested, so the skip branch cannot mint a phantom label).
- It also rejected option (c) 'wait until the histogram is machine-policed' on a measured fact: grep -n 'gates.json' scripts/verify-agents-mirrors.py -> 0 hits, so that wait is on nothing. And it declined to mint a 72nd row: re-file the existing `audit` row retired->advisory, keeping the total at 71 (histogram 54/15/2). Sixth finding, prose-blast-radius: after the leg lands, FOUR texts go false (security-pr._note, ci-pipeline.md rows, both config headers) and no checker reads a _note for truth -- so the leg ships with those corrections or I create the exact defect class I have been hunting.

## ROUND 17 collects (f5ec19201, dfc4ded22, 2c03ae152, e517c5fcb, 1a50ef9bf)
- f5ec19201 (0dc2a06d) .githooks/pre-push +69/-3: two distinct skip causes named separately (NO INTERPRETER vs NO ORCHESTRATOR), stderr not stdout, exit 0 DELIBERATE and documented as the noticed asymmetry vs pre-commit:19-22. Names the dropped checks by the script's own Tier names verbatim; 'No count is quoted -- nothing ran, so there is no total. Not a total.'; grep proves no count leaked into the notice; echoes the live FLAGS it computed so the developer sees the routing that was dropped. CONTROL FLOW MEASURED: stdin loop :37-54 -> ANY_PUSH exit :57-59 -> FLAGS :72-80 -> guard (was :83-88). A manual `bash .githooks/pre-push` with empty stdin CANNOT reach the branch -- proven with bash -x; the harness requirement is now a comment in the hook. Normal path re-proved end-to-end: 13 checks RAN / 0 SKIPPED / 9 ROUTING, stderr empty.
  - Its meta-finding for me: the notices are shell echoes, not a pure function like the script's summary_lines, so the hook has nothing assertable to put behind a --self-test. If a future contract wants hook text pinned, it has nothing to pin today.
- 2c03ae152 + dfc4ded22 (67fac8ff) verify-ipc-parity.py, comment/docstring only, four proofs (AST-blank, outside-comment empty, token stream identical, gate stdout byte-identical GATE_IDENTICAL). Repaired FOUR rotting figures (:1885 the orphan_permission 19/25 -> live-measured 14/25 with the info[scoped-orphans] print named as where the number lives; :3673 shell-info 154/118/441/43 -> dated to both tips after rottwice mid-sentence; :3811 25-and-25 -> points at the print; :3207 326/59 -> ratio kept, absolutes removed). Kept six DATED records verbatim with the evidence for each, and refused to write '19 was true once' (unreachable claim) -- pointing at git log -S instead. That is the discipline I wanted.
  - IT ANSWERED MY RED: :3350 asserts 'len(real_fb)>=1 and "list_scanners" in real_fb'; ea4fa5492 retired list_scanners, 3162b97b6 deleted the scanner no-session arms -> real_fb now ['list_products','lookup_by_barcode']. Proved not its own doing (self-test bytes identical to HEAD blob, HEAD_SELF_RC=1). NOT data loss: the shape survives, the literal rotted. Needs an executable-line edit -> dde1ab7b redesigning the assertion (predicate vs literal vs fixture) + censusing how many other real-tree literals are waiting for the same event.
- e517c5fcb + 1a50ef9bf (fe1bac61) README: 455/320/301/474 re-derived on FIVE passes across five HEADs, identity closes, cause named (d29a7c0f4), and the check.sh row rewritten to truth (full matrix, NOT what push runs, no tally quoted because run-pre-push.py was a live buffer).
  - ITS CORRECTION TO MY BRIEFING: the path I gave, scripts/check-dead-refs.py, DOES NOT EXIST; real path .agents/skills/docs-auditor/scripts/check-dead-refs.py. Also: verify-agents-mirrors.py contains 0 occurrences of the string 'README' (MIRRORS = the two AGENTS.md files) so its green was never evidence about README work -- it said so instead of borrowing the gate's green.
  - DISCLOSURES I ACCEPTED: (1) line-12 'dead-ref-prefix-ok: docs/guides/API.md' STAYS -- true-positive against a sentence that names the path precisely to say it fails; scoped to one name, explained in-file. (2) '461/321/298/484' left alone: it carries no command and does not reproduce (a naive split now reads 479/325/289/515) -- do not repoint what you cannot re-derive.
  - STILL FALSE IN README, steering sent (delivered, lane running): clippy `check.sh:44` x2 (moved to :53 by ee5aacd46) and its own new '.githooks/pre-push:83-84' (moved to :147-148 by f5ec19201 one hour later). Form = cite the step NAME / a grep, never the number.
- MY OWN FALSE ALARM, closed: I reported 'verify-no-hardcoded-money.py FILE DOES NOT EXIST'. Wrong -- the gate is scripts/verify-no-hardcoded-money-format.py; run-pre-push.py:254 names the task 'verify-no-hardcoded-money' and points at the -format file. My loop used the task name as a path. No repo defect. (check.sh:98 labels it "no-hardcoded-money-format".)
- KNOWN-OK, parked: check-dead-refs.py tree-wide exits 1 on 12 refs inside MANAGER JOURNALS (.agents/manager-journal-codebase-improvement.md + open-debt-program-review-waves.md). Those are working memory files, not docs; an exclusion is an owner decision, and I will not edit my own journal to satisfy a checker.

## ROUND 17 -- ENFORCEMENT-CLAIM CENSUS (403f33f5) => the new backlog
Thesis extended: not just false counts, but prose promising mechanical enforcement no runner implements. 22 items; verdicts SUPPORTED / UNSUPPORTED / PARTLY / VACUOUS / BY-DESIGN-HISTORY.

### LANDED from it
- 809634eb0 (93a95150) ui/README.md:131 -> split into :131 enforced (unresolvable Fluent key fails pre-commit step 2 + CI i18n leg 3) / :132 review-only (hardcoded English forbidden but no gate scans visible text; the escaping form is addToast({message:'<English>'}, counted by command not number). STEP 1 tried to CANCEL the task and failed to: it inspected 3 additional candidates that could have (barePlaceholderScan.ts = FTL-internal, nativeTooltipCompliance = attribute presence, nativeDialogCompliance = call expressions) and tree-wide JSXText / no-literal-string = 0 hits. 'build failure' count 1 -> 1 but now attached only to the true claim.

### DISPATCHED
- QUICKSTART.md:143 (clippy as a CI PR wall) + :140-142 (hook runs cargo fmt --all and re-stages) -- LANED. #2 is the dangerous half: that step was REMOVED on 2026-09-13 precisely because whole-workspace fmt reformatted concurrent sessions' in-flight .rs files, and the guide still tells newcomers it runs.
- Three copies of 'CI will fail without the HAL mock': hal-drivers/SKILL.md:364, tdd/SKILL.md:232, onboarding-guide/SKILL.md:105 -- requirement REAL (AGENTS.md standard), enforcement ZERO (no step, no verify-*, no CI, no caller anywhere). 93a95150 reusing its ui/README idiom: keep the prohibition, delete the false consequence.

### QUEUE (sized, fenced, with SLACK)
1. scripts/gates.json:3 header names 'docs/ci-pipeline.md'; the real constant is verify-ci-docs-drift.py:81 DOCS = docs/operations/ci-pipeline.md, whose :78-79 comment records the old path once causing exit 2. One path string inside the header whose job is naming policed docs. HELD for 9a491152's settle (its fence; addendum message failed -- it settled mid-send). SLACK high: it is the file every other lane reads.
2. scripts/verify-ci-docs-drift.py:48-50 module docstring still says undocumented live jobs are 'informational notes ... never stale in the fail direction' while :1337 adds them to `problems` and :1341 returns 1 -- the docs half of that sentence is already updated in ci-pipeline.md:18-20 (SUPPORTED), the code's own docstring is not. Comment-only, one file, needs the grep -v '#' sha256 proof. SLACK med.
3. VACUOUS, the most interesting single finding: docs/guides/ROADMAP.md:490 checked-off '[x] @media (pointer: coarse) enforces --touch-target-min: 44px on all interactive elements'. The media query is authored per-sheet (11 named sheets) and ABSENT from responsive.css, while ui/src/__tests__/touchTargetSizing.test.tsx:123 SKIPS exactly those coarse-pointer blocks and its case title at :264 still reads 'all interactive elements meet minimum 44px'. A gate whose scope structurally excludes the mechanism the roadmap credits it with -- the session's thesis, in CSS. Fixing the TITLE is 1 line; fixing the SCOPE is a walker change. Needs a thinker first. SLACK med-high (touches the dirty __tests__ dir).
4. PARTLY: project-scaffold/SKILL.md:272 credits scripts/check.ps1 with the no-raw-params / scoped-coverage / IPC-parity / i18n boundary gates; its Step -Name inventory has architecture boundaries only. Windows devs run the .ps1 and believe the parity gates passed. Also: is check.ps1 itself a runner anyone polices? Not in gates.json's runners map (only check.sh / check:all). SLACK med.
5. PARTLY: foundation/src/money.rs:64 pub struct Currency(pub [u8;3]) -- rust-backend/SKILL.md:258 says the newtype 'enforces ISO-4217 shape'; the pub field means any 3 bytes construct. Prose fix (state arity-3), NOT a code change. SLACK low.
6. UNSUPPORTED vs its own neighbour: CONTRIBUTING.md:251 'Quarantining a test is a documented, temporary, ENFORCED action' contradicted 9 lines later at :260 'Nothing enforces the loop'; verify-flaky-quarantine.py has 0 callers, same for verify-quota-coverage.sh. Two orphaned scripts + one adjective. SLACK low but the orphaned-gates question is worth a researcher pass: how many scripts/verify-* have ZERO callers in check.sh/pre-push/pre-commit/workflows? (The census says at least 2.)
7. SUPPORTED-BUT-NARROW: ui/README.md's 'ESLint + jsx-a11y (accessibility enforced)' over-reads -- jsx-a11y recommended IS in CI (ui/eslint.config.js:5,16,18 + dev-ci.yml:310) but the a11y Vitest suite (ui/package.json:23 test:a11y) is local, WARN-only at check.sh:254, in no workflow (gates.json a11y-advisory). Same split-as-write-the-property idiom. SLACK low.

### NOT ROT, per the census (do not 'fix')
README.md:199/:214/:191, CONTRIBUTING.md:3/:166-171/:242-249/:260-276, ROADMAP.md:275, gates.json's 14 self-disclosing _note rows (:91,:105,:127,:135,:210,:233,:253,:308,:352,:389,:440,:451,:558,:572), admin-guide.md:40, and the repaired i18n bullets on ui/README.md. BY-DESIGN-HISTORY is a real category here and mis-tagging it is how I create work for nobody.

### UNVERIFIABLE-FROM-REPO, listed by the census and left open
[Inference] detect.sh:563 'exit "$manual_count"' wraps if findings >= 256 (exit codes are mod 256) -- needs a run to know whether a big red can read as 0. That is the vacuous-green class in a shell exit code, worth a measurement. Also: whether verify-quota-coverage.sh's zero callers is why nothing cites it; Android signing behaviour at android-keystore-guide.md:34.

## README 3rd pass landed while the census arrived (fe1bac61)
- :198 clippy row + Testing Strategy now cite the step BY NAME `clippy workspace` with the grep, and each says OUT LOUD why the number was dropped (ee5aacd46 moved :44->:53; 'a pointer verified today is false the next time anyone inserts a leg above it'). The check.sh row now cites the pre-push invocation by PATTERN and records that :83-84 moved inside the hour when f5ec19201 widened the hook. That is the de-numbering convention now written into the page itself, not just into my briefs.

## TELEMETRY -- capacity overrun (round 17), self-reported
- I dispatched to 9 concurrent lanes (8 coders) against caps of 6 coders / 8 total. Cause: I REUSED fe1bac61 believing it had settled (its README pass had indeed landed), and its turn was still live, so the steer started a second turn rather than replacing one. Reusing a lane is free only when it is idle; a lane that has committed but not settled is still a slot.
- Corrective: interrupt_agent on fe1bac61 (all three of its deliverables were already committed -- 455/320/301/474, the check.sh row, and the by-name clippy citations, so stopping cost nothing but re-verification) and on 93a95150 (four minutes into its three-SKILL.md task, nothing committed; parked to the next gate rather than losing work). Back to 7 in flight, 5 coders + 1 researcher + 1 just-parked = reserve restored during the risky leg (9a491152 is landing check.sh + gates.json edits under set -e).
- Rule for myself, recorded here so it survives compaction: before every REUSE, re-read list_agents status in the SAME program as the send, and count running-first. A 'ready' lane cannot be messaged; a 'running' lane can be messaged but that message is ADDITIVE load, not a redirect of a free slot.

## ROUND 18
### LANDED
- eb6bfa0f7 (ca2aa38f) QUICKSTART, 3 files worth of harm in one page: :143 clippy-as-PR-wall and :140-142 the REMOVED fmt hook step, both replaced with the seven real steps, the 2026-09-13 removal DATE AND REASON (whole-workspace fmt rewrote concurrent sessions' unstaged files) and 'never re-add a workspace-wide format to a hook'; :132/:135 attribution split per command (clippy -D warnings fails on a warning; plain 'eslint .' reports and exits 0, grep -c max-warnings ui/package.json -> 0; typecheck does fail). No line numbers written. IT EXECUTED ALL 7 BACKTICKED GREPS IT SHIPPED -- a newcomer can copy-paste the page and reproduce every claim. Kept :233's 'fix a clippy warning' first-issue advice (now correctly framed: you are the gate).
- MEASURED BY ME, CLOSING A CENSUS OPEN ITEM: detect.sh --report -> 'wrote skill-drift-report.md (1 findings)', exit 1, and :563 is 'exit "$manual_count"'. The >=256 exit-code wrap I was asked to check is therefore THEORETICAL at n=1 today -- 256x today's population. NO DISPATCH, recorded as measured-and-declined rather than hardened speculatively.

### THE REAL FINDING IN THAT RUN -- a live, self-inflicted matrix abort
- detect.sh's single finding is '.agents/skills/tdd/SKILL.md: .github/workflows/ci.yml'. Line 212 is the sentence MY lane 564eddaa wrote in 3a9637ece, naming ci.yml in order to say it was retired to ci.yml.bak at 23c96330 -- a deliberate NEGATIVE mention, the same case README.md's 'dead-ref-prefix-ok: docs/guides/API.md' opt-out exists for.
- SEVERITY: scripts/check.sh:152 runs that exact command inside step "skill-drift-guard", and step() (check.sh:27-43, exit 1 at :35-38) ABORTS the matrix under 'set -euo pipefail' (:16). So 'bash scripts/check.sh' currently dies at :152 and never reaches the Rust tests, i18n, or the supply-chain leg -- every lane that reaches for the full matrix inherits my abort.
- NOT IN MY WAVE GATE, WHICH IS WHY I MISSED IT: my gate has been ci-docs-drift + agents-mirrors + runner-labels + bundle-parity --full-census + tsc + owned vitest suites. check.sh:150's own comment says 'extra local guard; CI doesn't run this', and gates.json:216 files it as runners {check.sh:[skill-drift]} while its _note claims 'Runs in dev-ci.yml#static-gates' -- the note and the comment CONTRADICT each other, and the detector's report-mode exit is the thing neither prose mentions. WAVE GATE CHECKLIST UPDATED: add 'bash .agents/skills/skill-drift-guard/scripts/detect.sh --report' (and from now on, treat check.sh:152 as the authoritative statement of who runs it, not gates.json:217).
- FIXING: 93a95150, urgent-first and separately committed, with the ordering I want kept: prefer the detector's own sanctioned exemption (find it by reading how it decides staleness -- do NOT guess a marker string), else reword to identify the retired workflow without emitting a live-looking path (keeping the SHA, the load-bearing half), and explicitly FORBIDDEN are deleting the sentence (it is why the clippy note is trustworthy) or widening detect.sh's rules (check-dead-refs.py's is_historical_doc() substring widening is the documented precedent for what that costs). Proof demanded: detector exit 0 AFTER, check.sh passes :152 and continues, and check-dead-refs on the same file still exits 0 -- the two checkers must agree or I have traded one red for another.

### NEW MIRROR FALSEHOOD (queued, not dispatched -- pool at 6/6 coders, 8/8 total)
- ca2aa38f measured 11 jobs in dev-ci.yml, not the TEN that AGENTS.md/.agents/AGENTS.md enumerate by name; 'release-bridge-test' landed since (cf. 9d5c33c68's release-bridge-tests row). So the mirrors' job enumeration is stale in the same week we fixed their gate count and their clippy note, and verify-agents-mirrors only polices job names cited as 'dev-ci.yml#<job>' anchors -- not a prose count of eleven. Combine with the HELD histogram item (71/54/15/2 after the audit re-file) and fe1bac61's follow-up: both mirrors still say README's 455/321 disagreement is OPEN when README took our side at e517c5fcb. ONE mirror lane, three clauses, name-the-command form, mirrors must read clean first, compose from filesystem bytes, prove sha256 equality across both files.
- README's check.sh row parenthetical '(Rust + UI + migrations)' now omits the supply-chain leg -- hold until 9a491152's prose commit lands, per fe1bac61's own recommendation not to quote a status word before its commit is in.

## CORRECTION, and it raises the stakes (I had the skill-drift case backwards)
- dev-ci.yml:525 DOES run 'bash .agents/skills/skill-drift-guard/scripts/detect.sh --report' as the step literally named 'Skill drift guard' inside static-gates. So gates.json's skill-drift row (required + ci{dev-ci.yml,static-gates} + runners) is TRUE, and the FALSE prose is scripts/check.sh:150's comment '(extra local guard; CI doesn't run this)'. My brief told 93a95150 to trust check.sh over the manifest -- inverted, corrected by send_message before it could act on it.
- THEREFORE the 1-finding exit 1 I caused with 3a9637ece is a BLOCKING CI FAILURE, latent only because this branch triggers no workflow (PR-to-main / push-to-main / dispatch; we are 1,200+ ahead of origin/main). It becomes real the moment anyone opens that PR. Severity: not 'a local matrix abort' but 'a planted red on the merge path'. Fix is in flight (93a95150, commit separate, proof = detector prints 0 findings exit 0, the same exit a runner reads).
- PREFERENCE ORDER LIFTED accordingly: if the detector has a per-mention exemption, that now beats rewording, because the sentence is CORRECT and the tool is what is wrong about it. Requirement kept: show the source line that reads the marker -- a marker the tool does not parse silences nothing.
- ROUTED TO ME, not to that lane: check.sh:150's false comment (one line, in 9a491152's live fence). Explicitly told it NOT to fix it cross-fence -- twice tonight a helpful reach into a neighbour's file nearly cost their work.
- ALSO TRUE AND WORTH THE JOURNAL: 'static-gates' step list confirms several self-tests ARE CI-invoked (EOL guard self-test, UI typecheck gate self-test, post-commit index guard self-test, Scoped ambient reads self-test, Release workflow self-test). That PARTLY contradicts 8d022339's line-4 claim ('only 7 are ever invoked with --self-test') -- its population was check.sh + run-pre-push.py, not the workflow step list. Before I cite 'seven rotting self-tests' anywhere, re-derive per gate: is it invoked by check.sh, pre-push, OR a dev-ci.yml step? dev-ci.yml:504 even carries a comment listing gate names ('no-hardcoded-money-format','windows-config','skill-drift',...), so a machine-readable inventory may already exist in the workflow.

## TOUCH-TARGET DOSSIER (a9ef3b7e) -- premise KILLED by the thinker, new and worse
- ASKED: is the @media (pointer: coarse) skip defensible? ANSWER: the skip is DEAD CODE. touchTargetSizing.test.tsx:106 tokenises with a FLAT regex /[^{}]*\{[^{}]*\}/g which can only emit bodies containing no '{' -- so nested @media blocks yield only their INNER rule and the at-header never appears. Replicated over the 8 coarse-bearing sheets: at-block tokens = 0, coarse-header tokens = 0, while the sources hold 11 coarse headers. Therefore :114 selectors.startsWith('@') never fires, inPointerCoarse (:103) is permanently false, :123-124 'continue' is unreachable, :127 resets a flag never set. NOT reason (i)/(ii)/(iii) -- a fourth: the parser cannot see at-context at all.
- SO THE REAL DEFECTS, bigger than the census item: (a) graded today = 12 height declarations across 70 curated sheets, 0 violations, and 6 of the 12 PASS BY MENTIONING a token the suite never resolves (referencesTouchTarget :33-35 -> true; isAdequate :37-41 never reads the value); (b) frontend/themes/tokens.css is NOT in CSS_FILES -- tokens.css:275-276 hold 44px/48px and the suite never opens the file that defines the value it certifies; (c) StatusBar.css:178's coarse-only override IS graded today WITHOUT its ancestry, i.e. a coarse-only re-declaration counted as base sizing -- the actual correctness bug that (i)/(ii) both miss; (d) SIZING_PROPS :92 is height|min-height only -- the width axis of '44x44px' is ungraded (12 of 42 var(--touch-target-*) declarations are width-side); (e) curated list is 70 of 139 sheets and :258 'if (!existsSync(fullPath)) continue' drops a renamed sheet in silence -- the documented dither-blackout shape.
- CERTIFIED PLANT (the proof that decides everything): set tokens.css:275 to --touch-target-min: 24px. TODAY the suite must stay green. Post-repair it must FAIL naming the 6. That single experiment converts 'the roadmap box is over-credited' from an argument into a measurement. MUST be run in a `git worktree add` of HEAD, not this checkout -- the suite reads the working tree via fs (:2), 13 paths under ui/src are dirty right now.
- DO NOT 'HONOR THE SKIP' -- that is a scope NARROWING dressed as a repair (would drop 10 -> 8 graded and delete the only reason the box was ever checkable). And do NOT uncheck ROADMAP.md:490: its mechanism half is TRUE (11 coarse headers exist, the token is defined); the false part is the implied verifier. Same page :466 carries the identical 'all interactive elements' phrase and :412 claims >=56x72px -- a wave-2 doc commit must reconcile all three or fix none.
- CONTRACT HELD FOR FIRST FREE CODER (queue slot 1, above the self-test wiring because it is a live vacuous green): wave 1 = ui/src/__tests__/touchTargetSizing.test.tsx ONLY (file is clean at status --porcelain right now; re-inspect immediately before the pathspec commit, 13 sibling paths dirty). (1) brace-depth tokenizer returning (selector, body, atAncestry), semantics ported from popupBackgroundCompliance.test.ts's documented conditional descent (cite BY NAME -- 4ce2de7e8 did that widening; there is no shared helper, composedColorPairs.ts does not exist; .agents/AGENTS.md records five copies of the sheet-list helper so duplication is the accepted shape); (2) coarse rules stay GRADED, tagged insideCoarse, and the dead :102-127 state machine is deleted with a comment saying the flat parser emitted 0 at-block tokens across 8 sheets/11 headers so the flag never engaged; (3) read tokens.css, parse --touch-target-min/-comfortable, and make isAdequate RESOLVE to px -- an undefined token counts as a VIOLATION, never a pass; (4) case TITLE carries graded-of-total + bucket counts (the composedRuleIdenticalPair graded-of-composed lesson: the fooled reader reads Vitest's reporter, not the source) PLUS stdout buckets (animationCompliance idiom) since four buckets do not fit a title; (5) FLOORS with headroom (sheets>=60, graded>=10, insideCoarse>=1) AND a graded-membership identity check -- the 402b11660 lesson that a magnitude floor passes while a graded member silently stops being graded -- plus a toBeGreaterThan(0) so an empty population cannot read green (verify-test-shadow-copies' exit-2 discipline, and 12 is one deleted selector entry from vacuous).
- DEFERRED TO THEIR OWN WAVES, each allowed to turn green->red on sheets nobody owns: width axis in SIZING_PROPS; replace the 70-sheet curated list with a tree walk of all 139 and make a missing sheet FATAL.

## ROUND 18/19 -- citation lane settles (f5c20331, PARTIAL by design) + NEW DEFECT CLASS
- f571e63cd: 2 files (todo-operational-integrity.md:21/:150, docs/records/JOURNAL.md:41) de-numbered to grep-by-name form. check-dead-refs exit 0 on all three.
- IT CORRECTLY WITHHELD A COMMIT: todo-open-debt-program.md carries 3 of my verified de-numberings (:112/:384/:488 check.sh:106 -> the 'test workspace (nextest)' step) inside the working tree, UNSHIPPED, because the same file holds another lane's 59+/14- (skip-arm 64->66, Phase-1 re-measures, Phase-5 rows). A pathspec commit would have filed their work under my message, and it would not add selectively or stash. THAT IS THE RIGHT CALL and I am recording it as such. FOLLOW-UP FOR ME: when that file's buffer is clean, commit it -- the edits are already verified (dead-refs 0, grep -c 'check.sh:106' -> 0). RISK if I forget: the peer commits the file itself and my 3 repairs ride along under their message (harmless to the tree, invisible in the ledger), or a lane resets the buffer and my work evaporates. TRACKED AS DEBT, not as done.
- 112 pointer hits graded. BY-DESIGN-HISTORY left alone: dated journal rows, .workbuddy-ai/memory files (the filename IS the date), audit stamps, docs/plans/0.0.36-backlog.md (that page ARGUES the pointer moved), README's already-de-numbered rows, archived/*. That discrimination is the work; the 3 fixes are the trivial part.

### NEW CLASS -- MACHINE READERS WITH HAND-TRANSCRIBED COORDINATES (the most valuable thing this lane found)
Three checkers assert LITERAL line numbers inside the very files they police:
- scripts/verify-ipc-parity.py:1182,1194,1237,2816 -- an ALLOWLIST_READER_CALL_SITES constant plus its self-test strings, naming run-pre-push.py:107 (moved to :252 by f8c11fc5c, which is now a COMMENT line) and check.sh:56 (that line is now the no-raw-params step; ipc-parity itself is :65).
- scripts/verify-scoped-reads.py:184,1076,1203,1650,2970 -- check.sh:72, which is BLANK.
- scripts/verify-agents-mirrors.py:230 -- pre-commit:331 in a 262-LINE FILE, i.e. beyond EOF.
THIS IS THE SESSION'S THESIS AT A DIFFERENT LAYER: not prose claiming enforcement, but a checker whose idea of 'the runner calls me at X' is a typed integer someone maintained by hand. Every one of these is stable under exactly the edits that are most likely -- inserting a leg above the tuple -- and its failure mode is invisible because the assertion is about a coordinate, not a behaviour. f5c20331's recommendation, which I accept: replace the literals with a PATTERN/grep form (find the call site by the name it invokes) so the checker survives its own file moving. CAVEAT BEFORE ANY CODER TOUCHES THIS: a pattern form can also silently widen what is matched -- verify-ipc-parity's case is currently RED for an unrelated reason and aeb2a5a6 is inside that file, so this waits for the settle. And verify-agents-mirrors.py:230 asserting beyond EOF raises the question of what its green MEANS tonight; that is a live vacuity candidate, and it belongs to the same census the self-test researcher is running.
- Also from that lane, confirmed live-false doc pointers NOT in its fence, queued: AGENTS.md:42,:73 + .agents/AGENTS.md:42,:73 (check.sh:44 -> :53, :211 -> :285) -- the mirrors must follow README's de-numbering or the pages disagree; docs/operations/ci-pipeline.md:108; gates.json:203,210,233,426; todo-refactor-kasirmu-app-agents-3.md x5, todo-refactor-cloud-sync-agents-1.md x2, todo-font-system.md:1131, .agents/review-backlog-codebase-review.md:146.

### OTHER SETTLES THIS ROUND
- 9a491152 CLOSED the supply-chain question with a real pre-flight: 'cargo deny check' -> RC=0 at BOTH 7ef31a36b and e517c5fcb. deny.toml's claim that it exits 1 on RUSTSEC-2026-0285 was stale under its own feet -- rustls is at 0.23.45, bumped by 8a9954d7c 'to clear RUSTSEC-2026-0285'. So the advisory leg went in with a PASS branch that actually fires, no ignore entry added, nothing widened. Four-branch proof driven from a %TEMP% extraction under set -euo pipefail. Self-disclosed a malformed edit that wrote '// placeholder' over deny.toml's 10-line header and restored it next call -- body hash 6750/3930a275 identical, no residue, nothing committed. REVIEWER bbcef2cb NOW RUNNING over those two commits (abort paths, branch misclassification, the probe/invocation asymmetry, independent double-entry on the placeholder, and whether an AGGREGATE 'cargo deny check' mislabels a row that says 'advisories').
- QUEUED, AWAITING FIRST FREE CODER (was slot 1, now dispatched as aeb2a5a6-adjacent): touch-target wave 1 (see above).

## ROUND 19 -- CI-blocking red REPAIRED (273f37a02) + three durable hazards found
### LANDED
- 273f37a02 the abort my own 3a9637ece planted. detect.sh --report: before exit 1 / 1 finding -> after exit 0 / 0 findings, re-confirmed at HEAD. Same exit code a GitHub Actions runner reads at dev-ci.yml:525, so the planted red on the merge path is gone. Sentence KEPT WHOLE and the SHA kept: 'the `ci.yml` workflow under .github/workflows/ was retired to ci.yml.bak at 23c96330' -- reworded so the existence test passes on the same information (.github/workflows is a real directory). check.sh untouched; :152 runs the exact command the workflow runs.
- cf41e551c three HAL-mock pages, identical core clause in all three so they cannot drift in wording: required by the coding standard (AGENTS.md -> Database & Hardware -> HAL Drivers), ENFORCED BY REVIEW ONLY, no CI job / no hook step / no checker under scripts/ looks for it, so an unmocked driver reaches main and the first person without that hardware finds out -- and then the reason that survives without the threat: the mock IS the harness.

### HAZARD 1 -- skill-drift detect.sh has NO EXEMPTION MECHANISM, and the two checkers DISAGREED
- [Fact from the lane, with line tags] paths check :256-286 extracts with grep -oE '[a-zA-Z_.-]+(/[a-zA-Z0-9_.-]+){1,}', exempts ONLY http*/https*/file://*/node_modules*/target/*/dist/* plus truncation artifacts, then flags [ ! -e path ] for project prefixes including .github/*. Grepping the tool for dead-ref|noqa|allow|suppress|marker returns only unrelated prose. should_run() :46-51 is a WHOLE-CATEGORY selector driven by the caller's ONLY_CHECK -- so a per-mention exemption does not exist and a category skip means editing check.sh:152 or dev-ci.yml:525.
- THEREFORE the 'dead-ref-prefix-ok' house solution I told it to copy would have silenced NOTHING in this tool -- it is check-dead-refs.py's convention only. I briefed a lane to reach for a marker that the target checker cannot read; it verified the mechanism instead of applying my analogy, and that is the difference between a fix and a placebo. Rule for me: before telling a lane to reuse a house idiom, confirm the SAME tool implements it, not just a sibling tool.
- MEANWHILE: check-dead-refs.py on tdd/SKILL.md was exit 0 BEFORE the fix too -- so the two doc checkers were in open disagreement (one blocking-CI red, one green, same file, same sentence) and neither noticed the other. Now both green.

### HAZARD 2 -- BACKTICKED WORDS IN SKILL.md FILES ARE A CI LANDMINE
- The lane's own first draft wrote `main` in backticks; detect.sh's REFS check (:389-397, 'a reference to a SKILL that does not exist') flagged 'onboarding-guide: possible missing skill ref main' -- a CORRECT sentence made a BLOCKING CI STEP red by a rule nobody reads. Fixed by removing the backticks. REPORTED, not worked around: no rule change proposed, skill-drift-guard/** untouched.
- STANDING INSTRUCTION for any future .agents/skills/** edit: a backticked kebab-case or lowercase token in a SKILL.md can be graded as a skill reference. After editing those pages, ALWAYS run 'bash .agents/skills/skill-drift-guard/scripts/detect.sh --report; echo EXIT=$?' and require 0 findings before committing -- not check-dead-refs, which will happily agree with you while CI is red.

### HAZARD 3 -- I WENT OVER CAP AGAIN, CAUSE NOW NAMED
- 7 coders / 9 total for one cycle. Sequence: a lane's COMMIT landed (2b37309c -> 71596fb7b) before its SETTLE notice arrived, so my free-slot arithmetic was based on the settle count, not the commit count. 'Running' in list_agents is the only truth; a committed-but-unsettled lane still holds its slot. Second time tonight I derived capacity from the wrong signal -- now a hard preflight: count running in the SAME program that dispatches, and if running>=8 dispatch nothing.

### CENSUS CORRECTIONS (mine, propagated)
- scripts/verify-*.py = 24 FILES, not the 31 I have been quoting all evening (I inherited that number from an earlier dossier and never re-measured it; it is in several of my briefs tonight).
- 'zero callers of mock.rs' was wrong: 1 hit -- scripts/_find_doc_ignore.py:17 lists 'crates/oz-payment/src/drivers/mock.rs' in a doc-IGNORE path list for the payment crate. Not enforcement, not oz-hal, but the honest wording is 'one hit, and it is a suppression list', not 'nothing references that path'. Claim still fails as enforcement; my precision did not.
- verify-agents-mirrors.py DOES glob .agents/skills/*/SKILL.md (:1079, :1276) but only for stated gate/hook STEP COUNTS -- so it never reads a mock claim, and three copies of that sentence have no policeable. My standing line 'the mirrors checker does not read skills' was too broad; the narrow truth is 'it reads skill pages for numbers only'.

## ROUND 19 -- e52165d2e + 62ee91202 + 71596fb7b, and the --strict discovery
### LANDED
- e52165d2e two self-descriptions corrected: gates.json:3 header now names docs/operations/ci-pipeline.md (the path that actually exists), and check.sh:150's comment now reads 'blocking in CI too: dev-ci.yml#static-gates' -- the lie that made tonight's drift-guard red invisible locally. NON-COMMENT BYTES PROVABLY UNCHANGED: sha256 of grep -v '^#' both sides = 7e37d1fd... EQUAL. Phantom-label rule held (git diff -U0 | grep '^+' | grep -c 'step "|echo -n "' -> 0). It also CORRECTED MY PRECONDITION: check.sh's inline-comment count is 3, not 0 (L56 is a '#' inside a quoted label; L556-557 are heredoc instructions) -- all three identical on both sides so the whole-line hash proof still holds, but weaker than I claimed. The lane checked whether my stated precondition was true instead of assuming the proof was stronger than it is.
- 71596fb7b + 62ee91202 (2b37309c): verify-architecture-boundaries now prints its POPULATION on the green line -- '39 crate(s) in the Cargo graph, 574 dependency edge(s) followed, 579 UI file(s) scanned, 136 crates/oz-bridge file(s), 902 app-layer .rs across 4/4 root(s), 8 baseline entry(ies)' -- and --report-only appends 'NOT JUDGING: --report-only suppresses the verdict; this run's exit 0 is not a pass.' Proved with the two-runs-same-exit case: fixture --root exit 0 with a 0-crate population, real tree exit 0 with 574 edges, identical exit code and opposite scope, now readable off one line. Counters are filled BY THE WALKS, never by a second glob beside them -- the detail that makes the denominator trustworthy. Moved from 'vacuous-green, empty documented as intended' to 'has a DENOMINATOR', and explicitly NOT 'has a floor' (a floor would fail this checker's own fixture tests). Node harness 25/25 both sides.
  - ITS SELF-REPORT IS THE STANDARD: it published a second commit to correct TWO CLAIMS IT HAD JUST WRITTEN INTO THE FIRST -- 'ls -d crates/*/ | wc -l' as the way to re-derive a 39-package count (false: 39 is crates+modules+platform+foundation+apps, not the 17 dirs), and that the node harness uses --root (it doesn't: grep -c -- '--root' in the .mjs -> 0). Also: it redirected two proof runs into a.out/b.out in the repo root and deleted both before committing. Two lanes tonight have now told me my brief's number was wrong rather than shipping it.
### MEASURED BY ME THIS TURN -- the thesis in miniature
- 'python3 scripts/verify-architecture-boundaries.py --strict' is passed by FIVE callers that believe it is a control: check.sh:92, run-pre-push.py:253, dev-ci.yml:519, ci.yml.bak:219, and gates.json:113's _note asserting the job 'Runs in dev-ci.yml#static-gates with --strict'. Inside the script the flag is add_argument'd at :889 with help='Explicitly enforce the default blocking policy.' and NEVER READ. So the docstring is now honest (:41) while the --help string -- the one a caller consults to decide whether to pass it -- is the last surviving lie, and 5 places in the tree act on it.
- NOT a live bug (the blocking policy is the default, so passing it is harmless) and NOT worth a behaviour change: honouring it by making the no-flag path LENIENT would flip a blocking gate that four live callers rely on. Owner options for the report: delete the flag and all five call sites (needs a workflow edit -> parked), or leave it inert with an honest help string (chosen, dispatched to 5 slots-remaining coder 9c...). Recording this because 'an inert flag with a confident help text' is the same species as 'a clippy row in a manifest no runner reads'.
### DEBT STATUS -- todo-open-debt-program.md
- My lane's 3 unshipped de-numberings are STILL PRESENT in the working tree and CORRECT: grep -c 'check.sh:106' -> 0, grep -c 'test workspace (nextest)' -> 3. The file remains dirty with a peer's much larger Phase-5 re-measurement (skip arms 64 -> 66, cloud-server 47 -> 49, '62 PG / 2 Redis' -> '64 PG', and the Phase-5 heading renumbering 62 -> 64 real CI tests). So my repairs will ride into the PEER's commit rather than mine. Content is preserved; the LEDGER is not -- my message will not appear against those 3 lines. Accepted: the alternative was committing their 59 lines under my message, and my lane refused to do that at 15:38. Still tracked as open debt, not as done.
### HAZARD CONFIRMED BY RUN
- detect.sh --report at HEAD: 'No drift detected. All skills are in sync with the code.', exit 0. The blocking CI step is clean, and the exemption-free tool now has a working convention for negative mentions (name the directory that exists, keep the SHA).
- check-dead-refs.py scripts/gates.json -> 1 unresolved: L366 'fuzz/target'. Pre-existing, outside every lane's diff today. Being measured (not assumed stale) by the current coder -- target/* is normally exempted by that checker, so either the exemption is anchored differently or the row is describing a directory that does not exist.

## 9ce2b254c -- the :3350 red from round 14 is CLOSED, and it is now the best-documented witness in the file
- Repaired by aeb2a5a6: case re-anchored to the gap the tree STILL has -- 'list_products' (unregistered in BOTH shells while list_products_scoped is registered in both, i.e. the same shape the leg was written for) -- with the population folded into the case name: f"[n={len(real_fb)} names={sorted(real_fb)}]".
- PROOF QUALITY IS THE TEMPLATE: red before (EXIT=1, 'self-test: 1 FAILURE(S)', '23 cases + 58 extra guards, 160 assertions total'), green after with the TOTAL UNCHANGED (160 -> 160, replaced not added), and a scratch-tree plant under $TEMP/zz_plant -- 21MB read-only copy including both shell trees -- where neutering useProducts.ts:132's else-half produced exactly ONE failure printing '[n=0 names=[]]', then restore with diff -q IDENTICAL and green. No real UI file touched (status --porcelain on useProducts.ts empty before and after), scratch deleted. That is what 'the witness still has teeth' looks like as evidence rather than as an adjective.
- DIAGNOSIS STRENGTHENED BY THE LANE, not just accepted: it re-derived real_fb THROUGH THE TOOL'S OWN FUNCTIONS (no_token_fallbacks(ui_runtime_files(), extract_handlers(tablet)) -> keys=['list_products']) rather than the researcher's Node replica, and confirmed list_scanners is STILL unregistered in both shells -- the registered set never moved; 3162b97b6 deleted the UI wrapper and its else-arm (11 lines out of ui/src/api/hardware.ts, shown in that commit's diff).
- WIRNING HAZARD IT HANDED ME FOR THE SELF-TEST WIRING (which is now UNBLOCKED and waiting on dde1ab7b's census): the --self-test path is NOT allowlist-independent despite returning at :3504-3505 before the enforcement work -- it needs scripts/ipc-parity-allowlist.json and scripts/allowlist-schema.py present or it raises AllowlistUnusable and exits 2 through an uncaught path. So a wired self-test leg must be written so a MISSING ALLOWLIST reads as 'could not run', not as a green and not as a matrix abort. Under set -euo pipefail, exit 2 from step() is indistinguishable-in-effect from exit 1: the matrix dies. This is exactly the vacuous/downgraded-green family the session hunts, arriving from the other direction.
- Also: my brief's assertion totals were right for once, and it said so (160 / 23 + 58 is what the tool itself prints).
