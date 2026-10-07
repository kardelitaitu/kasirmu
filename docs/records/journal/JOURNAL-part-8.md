# Engineering Journal - part 8 of 8

**Pre-split lines 12154-13432** of JOURNAL.md (13,433 lines, 1,338 KB). Split 2026-10-02 so each part is readable whole under AGENTS.md E4 (2,000-line cap). Content is byte-identical and in original order; the single exception is the first heading of this part, promoted from ### to ## where a cut landed mid-section.

The parent index, carrying the full line-to-part map, is [JOURNAL.md](JOURNAL.md).

---

## 2026-09-23 — Staff management: a parallel audit round, and the defects it found (staff / bridge / core / ui)

**Context:** the goal was 'continue the development of staff management, make sure everything works, spawn subagents'. Four subagents ran parallel audits with DISJOINT file ownership (UI surface, Rust surface, E2E role coverage, memo-overlap measurement) while the parent swept the surfaces none of them owned. That division is what found the defects below: each lane read code the others could not touch.

**Defects found by the parent, each verified by reading the code and then RED-proved in the fix:**
- QUOTA BYPASS on the INACTIVE -> ACTIVE transition. The tier cap was enforced only on CREATE (bridge `staff.rs` pre-check plus the W7-B post-insert veto in core `create_user`), while `count_staff_users` counts only `is_active = 1` non-owners. So on Free (limit 1): create A, deactivate A, create B, reactivate A = 2 active staff with every individual step allowed. Reachable from the product (the roster's power button -> `updateStaffScoped`). The fix needed THREE sites, not one: desktop delegates to the bridge, but the tablet FORKS `update_staff_scoped` (deliberately, for its `debug_upgrade` audit difference), so a bridge-only fix would have left the tablet bypassable.
- DEV-MOCK IDENTITY SPLIT. The login seed and the roster were two hand-written tables that disagreed about the same five people: `staff-1` named the Staff member at login and the Owner on the roster, no roster row carried the id a session was minted with, and the seed called the auditor active while the roster called them inactive. Latent only because nothing compared the two (0 hits for `session.user_id` in the feature) — which is exactly why the first self-guard anyone adds would silently never match in the preview.
- RESTORE IGNORED THE 90-DAY WINDOW. `staff.rs` stated 'a row past its deadline can never be read or restored', but only READ was enforced (the list purges then filters); `restore_user` / `restore_role` had no deadline predicate at all, so the guarantee held only as a side effect of a list having run. A trash page loaded at day 89 and clicked after the deadline restored an overdue row.

**Defects found by the subagents:**
- THE ROLES PANEL WAS STALE AFTER A ROLE RESTORE (found by the E2E lane in a live browser, fixed by the UI lane). The panel keeps its own role list and refreshed it only from a mount-keyed effect; the restore refreshed the SHELL's list, so the restored role was absent until a remount — the operator reads that as a failed restore and repeats it. The fix is a `refreshRoles` handle method called from one shared `refreshLiveLists`, which also closed THREE MORE instances of the same one-ring-short pattern in the same pass: the Roles stat tile after authoring, the shell list after a role restore, and the panel's `holder_count` after a staff create/edit.
- THE MOCK'S LOGIN NEVER READ `is_active`. Invisible while the seed called everyone active; a live divergence the moment the identity fix made the auditor inactive, because the real command refuses an inactive account with the same uniform error a wrong PIN gets (`auth.rs:403`).
- THE TABLET MEMO STACK OCCLUDED THE ROLE ROW'S DELETE BUTTON (found and measured by the layout lane, fixed by the parent). Measured at 1024x1366 with a full stack: the stack rect covered the authored 7th row's button (24 of 48 sampled points), the list did NOT overflow so no scroll position escaped, and the click could never land. At desktop the overlap is geometric but escapable by scrolling — so the passing desktop E2E was never evidence of no overlap.

**A regression the parent introduced and then fixed:** making the auditor the inactive trash fixture cost the preview the ability to log in as the auditor AT ALL, and silently invalidated the documented `auditor / 1234` credential. The fixture is now its own dismissed identity (`staff-5` 'Former Auditor', id kept stable because the committed spec deletes that id) and the auditor is a sixth, ACTIVE identity (`staff-6`).

**Verification (all by the parent unless noted):**
- `cargo test` filters: core `db::staff` 68 (was 65), core `db::roles` 41 (was 40), bridge `staff` 130, mobile `staff` 54; `staff_integration` 25. `npm run test` 606 files / 10320 passed, exit 0.
- RED proofs of the quota gate and the restore deadline, run by the parent: neutering the bridge arming FAILS 2 reactivation tests; neutering the deadline predicate FAILS the window test; both files restored byte-identically (SHA256 compared). The preset-key guard and the revalidation guard were proved the same way in the earlier entry.
- RED proof of the roles-panel fix, run by the parent: reverting only the `refreshLiveLists` wiring FAILS `re-reads the Roles panel list after a restore, without remounting the panel`; restoring the hash PASSES it.
- E2E `staff-trash.spec.ts`: 6 passed on BOTH projects (desktop Chromium + tablet WebKit), with two mutation proofs and a byte-identical mock restore; the parent re-ran and hash-matched the spec to the revision it committed.
- The memo fix was proved with a throwaway probe rather than a claim: before, 24/48 sampled points intercepted and a trial click INTERCEPTED; after, scrolling the (now overflowing) region clears the row to 0/48 and the trial click is CLICKABLE. The full stack height was MEASURED (215px for 3 bubbles) because the first measurement offered (141px) was for 2 and would have under-reserved `MAX_STACK = 3`.

**Two gate lessons worth keeping:**
- `screenExtraction` reports a class the sheet references but the screen's markup cannot contain — as it should. The right device is the entry's `externalClasses`, NOT `EXTERNAL_CLASS_LEDGER`: that ledger is for values defined ONLY inside the declaring entry, and the parent's first attempt failed the case's second direction ('no exempt member without a matching violation') because the class lives in another sheet. `additionalTsx` would also have silenced it and was the wrong tool, because it broadens the sheet's used-set and weakens the dead-class rule.
- `scripts/verify-quota-coverage.sh` scans `INSERT` statements only, which is precisely why an UPDATE-based reactivation door survived it. Extending it to activation doors is the durable fix for that class and is NOT done — recorded here rather than left implicit.

**Recorded, not fixed (each with its reason):**
- `update_user_pin` and the profile writer lack the `deleted_at` predicate their sibling has; both are unreachable for a trashed row because the guarded `update_user_in_tx` runs first in the same transaction. Defence in depth, deliberately not folded into the quota fix.
- The quota veto is armed by the COMMAND layer, so an unarmed caller keeps the old behaviour. A core-level gate was tried and rejected: the veto reads the POST-update count, so at a tenant already over cap it would refuse an ordinary edit of an active member.
- `count_staff_users` counts `users.role_id != OWNER` while authorization resolves ASSIGNMENT-first, so a divergent assignment can make the cap and the enforcement disagree. Pre-existing, out of scope.
- `purge_expired_users` keeps `role_id` on the anonymised tombstone and `role_references_on` filters nothing, so a role held only by a tombstone can never be deleted. FK truth, not a bug, but a state with no exit.
- The memo reserve is sized to a measured full stack (215px at 1024x1366); the stack's height is content-dependent, so a taller stack could still reach a row. It is gated on `body:has(.memo-stack)` so a session without memos pays no dead band.
- Dead FTL keys in the staff pair (5 unreferenced in both locales; ~20 present only in `staff.id.ftl`), proved by exact-token grep. Removing them is a locale-cleanup decision with cross-file blast radius, and the orphan gate only blocks keys a commit ADDS or strands by removing a reference, so it does not force the call.
- The Android/tablet shell is still unverified: no device attached and no AVD exists on this host. The tablet E2E project is WebKit at a POS viewport, not the device WebView.
- Peer-owned reds seen and left alone: `ProvisioningFlow` `sr-only` (fixed by that lane mid-round), `payables_tests.rs` fmt, `platform/core/src/settings/typed.rs` clippy.

**Commits:** `324c1a9cd` (one staff identity list), `f6dcb000e` (role-trash E2E), `30152281b` (mock login refuses an inactive account), `a950240ea` (Roles panel + stat tile refresh, four state-consistency fixes), `d45a78afe` (the dismissed fixture keeps every role loggable), `64a1740e8` (memo clearance for the tablet row), `2211f8da6` (quota reactivation door + restore deadline). Never push without a direct user order.

**FOLLOW-UP ROUNDS (same day) — closing the loop on the audit above.**

*A mutation audit of the staff UI, not a coverage sweep.* 44 mutations were applied to the feature source, each reverted inside `try/finally` and PROVED reverted by SHA256, with every feature-file hash unchanged at the end. 15 behaviours turned out to be UNPINNED — nothing failed when they were broken: the impersonation success toast and the `startImpersonation` record, the deactivated/deleted toast keys, `quotaBlocked` being cleared after a later success, both quota CTAs' pricing target, the workspace-unavailable notice, the trash retry button, three failure toasts, the create-success toast, `identityWithheld` reset on open, and the `#/roles` deep-link initializer. One test per behaviour, each red on its mutation and green on restore, committed as `f5b26ccb9`. Two were RED-proved independently by the parent (the quota-banner clear, chosen because it pins the parent's own fix, and the impersonation toast), so the method is validated rather than the table trusted. Two lessons from it: the deep-link case needed a `hash` ASSIGNMENT replaced by `history.replaceState`, because assigning `location.hash` fires `hashchange` and the listener masked the broken initializer; and a red suite in a shared checkout is not a finding until ownership is checked — nine RoleAuthoringPanel failures in one full-suite run were a concurrent mutation live at that moment, and the file passed 26/26 alone.

*A false instruction in a device-test guide.* `docs/guides/platform/android-install-test.md` told a tester that the PIN step has a Submit button and that sub-4-digit PINs show `staff-login-pin-min-length`. Both are false: the PIN step has NO submit control (the only `type="submit"` is the username step's) because the pad auto-submits on the 4th digit, and that locale key is referenced nowhere in the code. A tester following the guide would have filed a FAIL against correct behaviour. Corrected, with the real line references (`945732893`).

*Clippy, which nothing else in this repo will fix.* The gate ran in no live workflow, so its findings sat: 4 redundant `Ok(...?)` wrappers in `platform/core/src/settings/typed.rs` (`e4ae99df1`) and 2 collapsible guards in `crates/kasirmu-core/src/db/{mod.rs,refunds.rs}` (`9a66c166e`), each applied with clippy's OWN suggested edit, then reformatted. Clearing one crate's findings revealed the next crate's, which is the shape of this debt. Two traps were hit and handled: `cargo clippy --fix --allow-dirty` can rewrite OTHER agents' dirty files (two core test files showed as modified; their diffs were rustfmt-shaped and clippy itself reported fixing only the two files, so nothing of theirs was touched), and `rustfmt` on a `mod.rs` FOLLOWS THE MODULE TREE — which is why a peer's `purchase_orders.rs` appeared in a check of a different file, and why `cargo fmt -p <crate>` is unsafe here. The reflow was hand-applied to the two files instead.

*Verification hygiene, learned the hard way twice.* `rustfmt --edition 2021` cannot parse this workspace's edition-2024 `let` chains and emits a full-file rewrite, so its diffs are meaningless; and piping a check through PowerShell's first-N lines had silently TRUNCATED a file list, so 'the only diff is X' was never established. Both errors pointed at code that was fine. Separately, running the full UI suite CONCURRENTLY with the E2E run and a cargo build produced 7 failures across 5 unrelated files — every staff file green, and the one failing file the parent owns passed 30/30 alone. Heavy gates are run one at a time from now on.

**Still not closed at the time of writing:** the workspace-wide `cargo test` had 3 failing targets, all peer-owned (`gate_audit` census pin, cloud-server OpenAPI wire shape, `platform-sync` doctest `E0603`); workspace clippy and fmt were red only in peer files; the Android shell remains unverifiable (no device, no AVD); and the staff FTL dead keys (4 proven dead, plus one cited only by the corrected doc row) are left for a locale owner's call.


**Workspace-gate blockers observed while verifying (all PEER-owned; recorded so the next reader attributes them without re-deriving):**
- `cargo test --workspace --all-features` cannot COMPILE: `platform/sync/src/queue.rs` (dirty, in flight) added `origin_terminal_id` to `OfflineQueueItem` and two committed construction sites lag — `platform/sync/src/conflict.rs:162` and `crates/kasirmu-core/src/sync_client_tests.rs:354` (E0063). Nothing to do with staff.
- `cargo clippy --all-targets --all-features -- -D warnings` findings, every one outside staff: `crates/kasirmu-core/src/db/mod.rs:406` (collapsible `if`, in `rotate_generations`, the snapshot backup path — committed by another lane) plus the same E0063; and `platform/core/src/settings/typed.rs` carries four `enclosing Ok and ? operator are unneeded` errors in the COMMITTED tree (clippy runs in no live workflow, so nothing surfaced them). Checked by listing every `-->` location the clippy run printed: none names a file this session touched.
- `cargo fmt --all -- --check` diffs, none in staff: `apps/cloud-server/src/sync_store/pg.rs`, `crates/kasirmu-core/src/db/products_crud_tests.rs`, `crates/kasirmu-core/src/db/purchase_orders.rs`, `crates/kasirmu-plugin/src/manifest_tests.rs`, `platform/sync/src/queue_tests.rs`.
- Staff scope IS green on the same tree: `npm run test` 606 files / 10320 passed; core `db::staff` 68, `db::roles` 41, bridge `staff` 130, mobile `staff` 54; `staff-trash.spec.ts` 6 passed on both projects.

**Two process corrections, both worth more than the findings they produced:**
- `rustfmt --edition 2021 --check <files>` printed DOZENS of diffs for the staff files and was WRONG. This workspace is edition 2024 and the staff code uses `let` chains, which rustfmt cannot parse on 2021 — a parse failure makes it emit a full-file rewrite. `cargo fmt`, which reads the edition, reports those files clean. Trusting the hand-rolled invocation would have sent me to 'fix' formatting that was already correct.
- Piping a check through `Select-Object -First N` had silently TRUNCATED the file list in two earlier attributions of this same round, so 'the only diff is X' was never established. Both mistakes pointed the same way — at code that was fine — which is exactly the failure mode a verification step exists to prevent.

## 2026-09-23 — Two workspace gates driven to green: clippy and fmt (repo)

**Context:** the staff audit left three repo-wide gates red, and clippy is the one NOTHING else in this repo will fix — `dev-ci.yml` runs no clippy job, so a finding there ships silently. This round closed the two mechanical ones and left the third attributed.

**CLIPPY: exit 0.** Five changes across four files, each applied to a file that was CLEAN (committed) at the time — the rule is that a dirty file means someone else is mid-edit and gets skipped and reported, which is what happened to `platform/sync/src/queue.rs` (an in-flight C3 feature, whose own transient compile errors also surfaced and then resolved when that lane finished).
- `apps/desktop-tauri/src/state.rs`: two unused imports (`Path`, `Duration`).
- THE CONSEQUENCE WORTH RECORDING: removing them broke the desktop test target, because `state_tests.rs` is a `#[path]` child module and its `use super::*` does NOT count as a use of the parent's imports — they had only ever been 'used' by the tests. The fix was to move the two imports into the file that actually uses them, not to re-add them to the parent and certainly not to silence the lint.
- `apps/cloud-server/src/sync_store_tests.rs`: `let mut` that never needed `mut`.
- `crates/kasirmu-bridge/src/data_tests.rs`: `assert_eq!(x, false, ..)` -> `assert!(!x, ..)`.

**FMT: exit 0.** Two findings, both in committed files: an import order in `crates/kasirmu-core/src/db/purchase_orders.rs` and one unwrapped `assert!` in `crates/kasirmu-plugin/src/manifest_tests.rs`. `rustfmt --edition 2024` was run on those two paths ONLY, never `cargo fmt -p <crate>` — and the changed-file set was then verified by MTIME, because two other core test files are dirty with another lane's formatting work: they were last written 90 minutes earlier, so the formatter had not touched them.

**Both gates were then re-run by the parent, not taken from the reports:** `CLIPPY_EXIT=0` and `FMT_EXIT=0`. Commits `b72d8d89a` (clippy, four files) and `8b9720d5a` (fmt, two files).

**The quota guard now sees the door that was missed** (`4e0838f84`). `scripts/verify-quota-coverage.sh` scans INSERTs only, which is exactly why an UPDATE-based reactivation bypassed it. It gained a second narrow rule for `UPDATE users SET ... is_active = <truthy>`, graded on the SAME ladder (the existing verdicts were extracted into one `grade_site()` rather than duplicated), with file discovery widened so the rule is not blind to `bridge/staff.rs` (which gates an activation but holds no INSERT). The parent ran it: plain `sites: 19 covered: 12 known gaps: 3 violations: 4`; self-test `sites=5 covered=3 violations=2` with a gated activation reading GATED-IN-FN, an ungated one UNCOVERED, and a DEACTIVATION deliberately not a site at all. Measured correction from that run, which the subagent made against its own first draft: the real activation SQL lives only in `core/db/staff.rs::update_user_in_tx` and reads GATED-IN-CALLER, not GATED-IN-FN, because the gate lives in its callers. The 4 violations are PRE-EXISTING (proven by running HEAD's own script against the same tree: same four) and sit in the ADR-56 bootstrap path (`provision_device_inner`, `create_workspaces_in_tx`, `seed_provisioned_baseline`). The guard is wired into NO workflow, so this red is visible debt rather than a blocking gate — which is exactly what it is: four doors nobody has yet gated or excused.

**Still open:** the workspace test run's peer-owned failing targets, the peers' in-flight files, the Android shell (no device, no AVD), and the dead staff FTL keys (four proven dead, plus one cited only by the corrected guide row).

## 2026-09-23 — Staff management: final verification bundle (repo)

Every gate re-run by the parent on a QUIET machine (one heavy job at a time):

| Gate | Result |
| --- | --- |
| clippy `--all-targets --all-features -- -D warnings` | exit 0 |
| fmt `--all -- --check` | exit 0 |
| `cargo test --workspace --all-features --no-fail-fast` | 127 targets, 9825 passed / 0 failed; 2 targets failed, both PEER-owned |
| `npm run test` (UI) | 606 files, 10352 passed, exit 0 |
| `e2e/staff-trash.spec.ts` (Playwright) | 6 passed, desktop Chromium + tablet WebKit |
| IPC parity / bundle parity / FTL dedupe / FTL orphans / PG drift / migration column types | all green (0 missing keys; 127 tables/158 indexes/7 seeds; 65 migration files) |

**Neither remaining test failure is staff, and neither is a staff regression:** `desktop_command_census_matches_pin` reports 2 of 67 pinned rows disagreeing (`data` pin 6 vs source 7, `pos` pin 17 vs source 18) after another lane added commands, and cloud-server's `push_outcome_documented_schema_matches_serde_wire_shape` fails in that lane. The census pins were deliberately NOT bumped: the metric is not a raw registration count (the desktop shell registers 8 `data::` and 18 `pos::` commands while the census reports 7 and 18), so a blind arithmetic update would be precisely the UNdeliberate edit the pin's own message warns against (`Update every pin deliberately - the full set is the review signal`). It belongs to whoever added those commands.

**A flake that was mine, not the code's:** an earlier full UI run reported 7 failures across 5 unrelated files (`AppShell`, `SettingsPage`, `TopologyRevisionBrowser`, `useNewTicketSound`, dev-mock auth contract). Every staff file was green, the one failing file this session owns passed 30/30 in isolation, and the same suite is now 10352/10352 with the machine quiet. The cause was running it CONCURRENTLY with the E2E run and a cargo build. Heavy gates run one at a time.

**Left open deliberately, each with the decision it needs:** workspace-wide gates stay in motion while other lanes hold dirty files; the Android/tablet shell is unverified because no device is attached and no AVD exists on this host (the tablet E2E project is WebKit at a POS viewport, not the device WebView); the dead staff FTL keys (four referenced nowhere in either locale, plus one cited only by the guide row corrected above) need a locale owner's call; and `scripts/verify-quota-coverage.sh` reports 4 PRE-EXISTING violations in the ADR-56 bootstrap path (`provision_device_inner`, `create_workspaces_in_tx`, `seed_provisioned_baseline` x2) which likely deserve the same reasoned KNOWN-GAP treatment `seed_primary_store` already carries - but excusing a provisioning door is that lane's call, and the guard is wired into no workflow, so the red is visible debt rather than a blocking gate.

## 2026-09-23 — Absorb: the wizard's email sign-in raises the desktop debt ceiling 75 → 78 (desktop-tauri/records)

**Context:**
`drift_pin_three_way_partition_is_complete_and_sums` and
`drift_pin_generated_ledger_is_the_sweeps_own_output` were RED at HEAD. The sweep measures three
registered names as ungated that the ledger does not carry: `desktop_link::request_email_login_code`,
`desktop_link::verify_email_login_code` and `desktop_link::login_with_email_password`. Measured before
this pass: 75 ungated (`NO_SESSION_RESOLUTION` 48 + `RESOLVES_SESSION_NAMES_NO_PERMISSION` 27) against
a `DEBT_CEILING` of 75; after: 78 against 75. `REGISTERED_TOTAL` (472) and `REGISTERED_FLOOR` (472)
were also stale against a tree that now registers 475: the three commands were registered by
`fc2ea1938` (feat(setup): add the desktop-link email login commands to both shells), which touched
neither the floor nor the ledger, so both legs were red for that reason too.

**The decision — gate them, or raise the ceiling?**
**Raise it.** The three commands are the wizard's email sign-in, and they are class 1
(`no_session_resolution`) STRUCTURALLY, not by omission. They are reached from
`ui/src/features/auth/LicenseActivationScreen.tsx` (call sites `:144`, `:159`, `:172`, via
`ui/src/api/license.ts:140/145/156`), which is the pre-session boot gate: `AppShell.tsx:852-871`
renders it as step `activate` of `ActivationFlow`, whose `onActivated` is what lets the shell past
activation at all. Each of the three either creates the web session (`verify_email_login_code`,
`login_with_email_password`) or is the step that precedes creating it (`request_email_login_code`). A
`require_permission_for_session` here would ask for a credential that cannot exist at the moment the
call is made — the exact shape the ledger's own history already prices: `license::activate_license`,
`link_device_google` and `setup::get_preset_features` have sat in this class since the gate was
written. Gating them would have required inventing a pre-auth exemption keyed to a constant, which is
a new mechanism in the permission vocabulary for no gain: the door is authenticated by the licence
server's `/web/*` endpoint, not by a local session.

The split is deliberate and it is not symmetric across the three, which is worth stating rather than
smoothing: `request_email_login_code` sends a code to a caller-supplied address and returns nothing,
while the other two return a `WebSession` token — so a reader could reasonably argue the two session-
minting doors deserve more than a ledger row. They do not get a gate here either, for the same reason:
the session they mint is the one a gate would be checked against. What they would need is rate-limiting
at the endpoint (a server concern, `apps/cloud-server`), not an IPC permission, and that is a different
lane.

**Changes:**
1. `apps/desktop-tauri/src/commands/registration_gate_debt.generated.rs` — regenerated with
   `KASIRMU_REGENERATE_GATE_LEDGER=1`: three new rows (`desktop_link::login_with_email_password`,
   `desktop_link::request_email_login_code`, `desktop_link::verify_email_login_code`, all
   `no_session_resolution`) and `REGISTERED_TOTAL` 472 → 475. The generator wrote only its own
   output, as designed.
2. The same file, by hand — the two pins the generator deliberately does not recompute
   (`rendered_ledger_file`'s doc: "a pin is a decision"). `DEBT_CEILING` 75 → 78 with the dated
   reason above the const; `NO_SESSION_RESOLUTION` 48 → 51, partition comment `51 + 27 = 78`.
3. `apps/desktop-tauri/src/commands/registration_gate_tests.rs` — `REGISTERED_FLOOR` 472 → 475, the
   number the tree measures rather than a chosen one, with the `fc2ea1938` step named in the doc
   comment above it. This is the same EQUALITY the staff/role-trash pass moved: it is the only leg in
   that file that can see a registration at all, and it moved because the three names were already in
   `lib.rs` at HEAD — nothing was registered or deregistered by this pass, only measured.
   `RESOLVES_SESSION_NAMES_NO_PERMISSION` (27) and `UNSOURCED` (0) are unchanged.

**What it means:**
This is the third rise `DEBT_CEILING` has taken and the second for a `desktop_link` row, and it is
filed as an **absorb**: the three commands belong to the ADR #54/#56 email sign-in lane, and this pass
records what landed rather than approving it. If that lane's sign-in is reverted, the three rows, the
ceiling and the class count come off together.

**Verification:**
- `KASIRMU_REGENERATE_GATE_LEDGER=1 cargo test -p kasirmu-app --lib
  drift_pin_generated_ledger_is_the_sweeps_own_output -- --nocapture` → 1 passed; generator printed
  "78 debt row(s), registered total 475".
- `cargo test -p kasirmu-app --lib registration_gate` → 14 passed / 0 failed (pre-fix: 10 passed /
  4 failed — the floor, partition, ceiling and generator legs).
- `cargo test -p kasirmu-app --test gate_audit` → 3 passed / 0 failed (the census pin needed no
  update, as the paragraph below explains).
- `cargo fmt -p kasirmu-app -- --check` → exit 0.

**Not in this pass:** `apps/desktop-tauri/tests/gate_audit.rs`'s census row for `desktop_link` still
reads `("desktop_link", 0, &[])`, which is CORRECT under this decision — the census counts gated
commands and these three are not gated. Its comment at `:57` ("desktop_link gates nothing yet") also
still holds.

## 2026-09-23 — Absorb: the same three commands raise the TABLET debt ceiling 89 → 92 (mobile-tauri/records)

**Context:**
The tablet twin of the entry above, from the same commit and the same omission. `fc2ea1938`
('add the desktop-link email login commands to both shells') registered
`desktop_link::request_email_login_code`, `desktop_link::verify_email_login_code` and
`desktop_link::login_with_email_password` in `apps/mobile-tauri/src/lib.rs` and updated the pins in
NEITHER shell, so the tablet's three drift pins were red at HEAD:
`drift_pin_debt_ceilings_only_shrink` ("92 ungated registered commands against a ceiling of 89"),
`drift_pin_three_way_partition_is_complete_and_sums` (3 names measured and absent from the ledger)
and `drift_pin_generated_ledger_is_the_sweeps_own_output` ("first row out of order: row 47").
`drift_pin_registration_floor_is_met` was green only by accident of the tablet's slack: it asserts
`REGISTERED_FLOOR == REGISTERED_TOTAL` (339 == 339) plus `parsed <= floor + 24`, and the tree parses
342 — inside the slack, so a stale floor passed while the ledger's total lagged the tree by three.

**The decision is the desktop's, applied:** the three are legitimately ungated pre-auth doors and are
carried as class-1 (`no_session_resolution`) debt. Nothing is re-argued here; the reasoning, the call
sites and the split among the three are in the entry above and are not restated. What differs is only
the numbers, and they were read from each pin's own message rather than copied from the desktop.

**Changes:**
1. `apps/mobile-tauri/src/commands/registration_gate_debt.generated.rs` — regenerated with
   `KASIRMU_REGENERATE_GATE_LEDGER=1`: three new rows, all `no_session_resolution`, and
   `REGISTERED_TOTAL` written by the generator (it stayed 342 — the tree was already at 342, which is
   exactly the lag the floor leg could not see). The generator wrote only its own output, as designed.
2. The same file, by hand — the two pins `rendered_ledger_file` deliberately does not recompute:
   `DEBT_CEILING` 89 → 92 and `NO_SESSION_RESOLUTION` 45 → 48, with the dated reason above each and
   the partition comment `48 + 44 = 92`. `RESOLVES_SESSION_NAMES_NO_PERMISSION` (44) is unchanged —
   all three joined class 1, which is the same shape the desktop's rise had.
3. `apps/mobile-tauri/src/commands/registration_gate_tests.rs` — `REGISTERED_FLOOR` 339 → 342, the
   number the tree parses rather than a chosen one, with the `fc2ea1938` step named in the doc comment
   above it. This is the tablet's own equality (`REGISTERED_FLOOR == REGISTERED_TOTAL`) and it had to
   move with the ledger's total in one pass: the ledger is regenerated, and a regenerated total that
   disagrees with a hand-kept floor fails the build by design.
   `REGISTERED_SLACK` (24) and `UNSOURCED` (0) are unchanged.

**Before → after, every pin that moved:**

| pin | before | after |
|---|---|---|
| `DEBT_CEILING` | 89 | 92 |
| `NO_SESSION_RESOLUTION` | 45 | 48 |
| `REGISTERED_FLOOR` | 339 | 342 |
| `REGISTERED_TOTAL` | 339 | 342 |
| debt rows in the ledger | 89 | 92 |
| measured ungated vs ceiling | 92 vs 89 | 92 vs 92 |
| `RESOLVES_SESSION_NAMES_NO_PERMISSION` | 44 | 44 (unmoved) |
| partition | 45 + 44 = 89 | 48 + 44 = 92 |

**What it means:**
Filed as an **absorb**, the same standing as the desktop entry above and as `auth::has_users`: the
three commands belong to the ADR #54/#56 email sign-in lane, and this pass records what landed rather
than approving it. If that lane's sign-in is reverted, the three rows, the ceiling, the class-1 count
and the floor come off together in both shells.

The two shells were red for one commit and were fixed in two passes because their pins are separate
files. That is worth naming rather than smoothing: a commit that registers a command in both shells
has to move two floors, two ceilings, two class counts and two ledgers, and `fc2ea1938` moved none of
them. The desktop pass (`7a5292530`) and this one close that gap; nothing in either pin prevents the
next one, which is why the provenance is written into the ledger comments rather than only here.

**Verification:**
- `cargo test -p kasirmu-mobile --lib registration_gate` → 11 passed / 0 failed (pre-fix: 8 passed /
  3 failed — the ceiling, partition and generator legs).
- `KASIRMU_REGENERATE_GATE_LEDGER=1 cargo test -p kasirmu-mobile --lib
  drift_pin_generated_ledger_is_the_sweeps_own_output -- --nocapture` → 1 passed; generator printed
  "92 debt row(s), registered total 342".
- `cargo test -p kasirmu-mobile --lib commands::offline` → 22 passed / 0 failed.
- `cargo fmt -p kasirmu-mobile -- --check` → exit 0.
- Desktop pins re-run and still green: `cargo test -p kasirmu-app --lib registration_gate` →
  14 passed / 0 failed; `cargo test -p kasirmu-app --test gate_audit` → 3 passed / 0 failed (the
  census pin's `tablet_command_census_matches_pin` included).

**Not in this pass:** `apps/mobile-tauri/src/lib.rs` was not touched — the registrations are already
committed and that file may be dirty in a sibling lane. `scripts/verify-scoped-coverage.sh` is out of
scope (fixed separately in `19568c216`). No census row moved: `desktop_link` gates nothing in either
shell under this decision.

## 2026-09-25 — Animation audit: four validated defects repaired, one claim disproved (ui/hooks, ui/theme, ui/features/kds)

**Request:** "a very deep bug hunting on animation for our app both windows or mobile." The audit swept
140 sheets / 63 keyframes files / 513 transitions / 18 `requestAnimationFrame` sites / 24
exit-animation callers across both entries (`index.html`+`main.tsx`, `index.mobile.html`+
`main.mobile.tsx`). Seven candidate defects came out of it; **every one was validated before a line of
implementation was touched** — Red first, and one of them did not survive validation.

**Validation (evidence, not assertion).** Each claim got its own failing test or a measurement:

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `useAnimatedModal` reopen race strands a modal at opacity 0 | **confirmed** | 2 Red tests, `exiting` stuck `true` |
| 2 | `useAnimatedModal` ignores reduced motion | **confirmed** | 2 Red tests, `mounted` held 200ms |
| 3 | `!important` transitions outrank the blanket reduce kill | **confirmed** | 6 escapes, two independent scans (Python + the new TS gate) agreeing line-for-line |
| 4 | KDS WAAPI tab pill ignores reduced motion | **confirmed** | control test plays `{duration:340}`, reduce test shows it still playing |
| 5 | WorkspaceSettingsModal/FastPIN exit timer longer than the CSS | **DISPROVED as a bug** | see below |
| 6 | `components/UpdateBanner` is dead while the shipped twin has no exit | **confirmed** | 3 greps: only its own test imports it |
| 7 | backdrop-filter / layout-prop / `transition:all` / box-shadow-pulse jank | **measured, not unit-testable** | keyframe property scan + `animationCompliance`'s own harvest line |

**#5 is the finding that failed validation, and it is the one worth remembering.** My claim was
"the panel is invisible but still hit-testable for 100ms." Reading the markup instead of guessing:
`WorkspaceSettingsModal.tsx:156-171` nests `.panel` INSIDE `.backdrop`, and
`WorkspaceSettingsModal.module.css:21` puts `pointer-events: none` on `.backdrop--exiting` deliberately
ungated — "refusing stale clicks while closing is function, not decoration." The panel inherits it.
`FastPINOverlay.css:60` does the same for its overlay, and the card inherits from that. So neither
mismatch is a hit-test hazard; what survives is only that `overlayOut`/`slideoverOut` reach opacity 0
at 200ms while the backdrop runs to 300ms — a visual asymmetry, and a documentation inconsistency
(`useExitAnimation.ts:66-70` states the duration MUST equal the surface's own rule, then cites this
very component as a correct example of passing one explicitly). Left alone this round on purpose:
changing 200→300 is a design judgement about entry/exit symmetry, not a defect repair.

**Solution — three repairs, each driven by its Red test:**

1. `ui/src/hooks/useAnimatedModal.ts` — the close branch used to `return () => clearTimeout(timer)`
   before `prevShow.current = show`, so the ref read `true` for the whole exit. A reopen inside the
   window then matched NEITHER branch: React's cleanup cancelled the unmount (so `mounted` survived)
   while nothing cleared `exiting`, pinning the surface on its `animation: … forwards` keyframe at
   opacity 0 with the caller's focus trap off (`mOpen && !eOpen`). Recording the edge on that path is
   the whole fix — it lets the opening branch fire on the way back in. Same file: the delay now runs
   through `animDuration()`, the last exit path in the app that did not.
2. `ui/src/features/kds/useKdsTabIndicator.ts` — gated the `Element.animate()` flourish on
   `prefersReducedMotion()`. **WAAPI is invisible to both stylesheet guards**: `reset.css`'s blanket
   `animation-duration: 0.01ms !important` and `tokens.css`'s `animation: none` address CSS animations
   only, so a reduced-motion user was getting a full-speed 340ms squeeze-and-overshoot on every KDS
   tab change. Same class as the topology simulation pulse fixed 2026-08-12; the pill still MOVES
   (position is state-driven), only the flourish is suppressed.
3. **Six `!important` escapes**, each scoped under `@media (prefers-reduced-motion: no-preference)`
   rather than stripped of `!important` — stripping would have changed cascade behaviour in the normal
   case for no gain, while the media gate makes the declaration not exist under `reduce`. The blanket
   kill is an `!important` longhand on `*` = (0,0,0); two important declarations are settled by
   specificity, so anything at ≥(0,1,0) beat it: `tokens.css` `html.is-theme-transitioning *` (0,1,1)
   and its `.kds-theme-indicator` override (0,2,1) — a 200ms document crossfade plus a 280ms pill slide
   after every theme toggle — and `KdsScreen.css` `.kds-switch` (0,1,0) / `.kds-switch::after` (0,2,0),
   the last one carrying real motion (the knob slides 24px). The `tokens.css` pair is exactly the
   "pre-existing quirk … worth a future round" this journal already logged on 2026-09-11; it is now
   closed. The misleading comment at `KdsScreen.css:2399` that justified omitting `.kds-switch` (it
   claimed tokens.css kills animation/transition "on all elements") was rewritten to state the real
   rule.

**Why a new gate was needed:** `animationCompliance.test.ts`'s own harvest line says
"513 transition declarations are never read" — all six escapes were transitions, so the existing
suite was structurally incapable of surfacing them. `ui/src/__tests__/motionImportantEscapes.test.ts`
closes that hole and is written so it cannot go vacuous: four synthetic cases pin the predicate (bare
escape flagged; `no-preference`-scoped accepted; `none`/`0.01ms`/iteration-count-1 kills accepted;
a comment that narrates a reduce block does NOT excuse a real declaration), and a corpus case asserts
the walker still sees >100 sheets including `reset.css`/`tokens.css`/`KdsScreen.css`. CI picks it up
for free — `dev-ci.yml:421` runs bare `npm test`.

**Verification:** `tsc --noEmit` clean; `eslint` 0 errors (56 warnings, all pre-existing); targeted
suites 94/94 (animation + modal + hook), 847/847 (KDS + shift), 111/111 (5 CSS compliance + 4 theme),
6/6 (new gate); full `vitest run` 10,495 passed / 2 failed — those 2 were load flakes (different files
every run: AnalyticsScreen, DesignSystem, useNewTicketSound, TopologyRevisionBrowser,
SalesDashboardScreen), and all five pass in isolation. `animationCompliance` harvest numbers are
byte-identical to the pre-change baseline (140 sheets / 334 declarations / 161 graded / 48.2% /
76 swallowed / 30 reduce blocks / 513 transitions), so restructuring those six declarations changed
no graded count. Skill drift guard: 2 findings, both pre-existing in `figma-bridge/SKILL.md`.

**Deliberately NOT done:** (a) the perf findings — `backdrop-filter` animated in 11 modal enter/exit
keyframe families, `left`+`width` transitions with permanent `will-change` on `.kds-tab-indicator`,
55 `transition: all` declarations, infinite `box-shadow` pulses on always-on KDS/kiosk/payment
surfaces, and `mousemove`-only cart-resize drag (inert to touch) — are measured and evidenced but not
unit-testable, so they need a perf/E2E slice rather than a TDD one. (b) The dead `components/UpdateBanner`
twin: confirmed dead (only its own test imports it; not exported from `components/index.ts`), while the
shipped `app/UpdateBanner.tsx` snaps away on dismiss (`app/UpdateBanner.css` has 0 `exiting` rules) and
is the sole one of 63 keyframes sheets with no reduced-motion handling at all. That is a retirement
plus a feature, so it is its own slice. (c) `index.html:116` still claims React clears `#boot-splash` on
mount — false, the node is a sibling before `#root`; `index.mobile.html` documents it correctly.

**Commits:** `cfbf3199a` fix(ui): clear exiting on mid-fade reopen and honour reduced motion ·
`fd159742d` fix(ui): gate KDS tab pill WAAPI flourish on reduced motion ·
`22caae2d5` fix(ui): scope important motion declarations to no-preference — plus this docs entry.


### 2026-09-28 — TDD round 1: the tax scope/window/entity probes no longer swallow a DB fault

**Problem:** Three one-row readers in `crates/kasirmu-core/src/db/tax/scopes.rs` ended their
`query_row` in a bare `.ok()` — `tax_rate_scope` (`:490`), `tax_rate_window` (`:294`) and
`location_legal_entity` (`:524`) — and `tax_rate_applies_at` (`:564`) did the same. A bare
`.ok()` collapses EVERY `rusqlite::Error` to `None`, and `None` is defined by these methods as
"no such active row" / "no entity assigned". So a DB failure was reported as a configuration
answer: the authoring screen (`list_tax_rate_scopes` callers, bridge `tax.rs:296`, tablet
`tax.rs:114`) and the sale path (`db/sales_tax.rs:511`, `:517`) were handed "this rate has no
scope", "this rate has no window" and "this location has no legal entity" while the database was
actually failing. The entity answer is the one with a money consequence: `Some(s) =>
self.location_legal_entity(&s.location_id)?` in `sales_tax.rs` decides whether level 2 of the
resolver walk applies at all.

This is the exact MSL-27 class the same file already documents fixing twice — `update_tax_rate_scoped`
(`:133`) and `validate_scope_target` (`:250`) both carry comments naming the `.ok()` trap — so the
defect was a known pattern that had not been swept to these four probes.

**Solution:** Each probe now uses `.optional()?` — rusqlite's idiom that maps ONLY
`QueryReturnedNoRows` to `None` and propagates every other error as `CoreError::Db`. Two Red-first
tests in `db/tax_tests.rs` force a real fault the way the sibling MSL-27 pin does
(`ALTER TABLE ... RENAME TO ..._hidden`) and assert the failure surfaces as `CoreError::Db`, not as
`None`. Both went red for the right reason ("a DB failure must not read as 'no such rate': None")
before the fix and green after.

**Verified:** full `kasirmu-core` lib suite **3395 passed / 0 failed**; tax module 80/80;
`cargo fmt -p kasirmu-core -- --check` reports no diff in either touched file (the two diffs it does
report are pre-existing, in `user_tests.rs`, and are the red recorded in
`docs/records/snapshots/2026-09-28-rustfmt-gate-red.md`); `cargo clippy -p kasirmu-core --all-targets`
emits no diagnostic naming either touched file (6 pre-existing errors elsewhere).

**Deliberately NOT done:** the same `.ok()` shape still stands at 14 sites across `db/` — `kds_lines.rs:154`,
`kds_orders.rs:442`, `loyalty.rs:674`, `popularity.rs:591`/`:627`, `promotions.rs:289`/`:421`,
`products_stock_adjust/adjust.rs:466`/`:475`, `sales_tax.rs:548` and others — plus `tax/scopes.rs:629`
(the last-coverage guard's own read, where a swallowed fault reads as "nothing is covered" and
DECLINES a refusal the guard exists to raise). Whether each of those is a bug depends on what its
`None` means to its caller, so the sweep is a per-site TDD slice, not a mechanical replace. That is
round 2+.

**Commits:** this entry + the fix land in the pathspec commit below.


### 2026-09-28 — TDD round 2: the loyalty earn path stops inventing an award rate

**Problem:** two probes in `crates/kasirmu-core/src/db/loyalty.rs` turned a database fault into
an ANSWER, not an error.

1. The tier-formula probe (`:665-676`) ended in `.ok()` and was then answered with
   `unwrap_or((10, 1_000_000))` — a hardcoded rate. So a failing `loyalty_tiers` read did not
   fail the award; it **awarded points at a rate the operator never configured**, silently. The
   tier IS the rate ladder; a wrong rate here is money-shaped, and the mistake is only
   discoverable by reconciling points after the fact. The Red test proves the severity: with the
   probe faulted, `earn_points` returned `Ok(Some(... points: 100 ...))` instead of an error.
2. The customer-existence probe used `.unwrap_or(false)`, so "the `customers` table could not be
   queried" was answered `CoreError::NotFound { entity: "customer" }` — "this customer does not
   exist" while the row was present and the database was failing. The same shape sat in
   `get_or_create_loyalty_account` (`:105-112`), which is the second door into the same probe.

**Solution:** both probes now use `.optional()?`. A genuinely MISSING tier (or a NULL `tier_id`)
keeps the documented default rate; a row that EXISTS but whose read FAILED is now `CoreError::Db`.
Two Red-first tests in `db/loyalty_tests.rs` force a real fault and assert `CoreError::Db`.

**A test that passed for the wrong reason, caught and fixed.** The first draft of the formula test
renamed the whole `loyalty_tiers` table. That passed BEFORE the fix — but not because the probe was
pinned: the whole-table rename also broke the later tier-recompute subquery in the
`UPDATE loyalty_accounts` statement, so the function failed for an unrelated reason. The fault is
now injected by renaming ONLY the column the probe reads
(`ALTER TABLE loyalty_tiers RENAME COLUMN earn_multiplier_millionths TO ..._hidden`), which leaves
the later `SELECT id FROM loyalty_tiers` resolving and therefore pins the probe itself. Both tests
now go red for the right reason and green after.

**Verified:** full `kasirmu-core` lib suite **3397 passed / 0 failed** (3395 + the 2 new);
loyalty module 49/49; `cargo fmt -p kasirmu-core -- --check` reports no diff in either touched
file; `cargo clippy -p kasirmu-core --all-targets` emits no diagnostic naming either touched file.

**Deliberately NOT done — the candidates this pass surveyed and rejected as distinct slices:**
`adjust.rs:466`/`:475` (stock-threshold lookup collapsing a fault to "no threshold configured",
dropping a low-stock alert) and `:494` `unwrap_or(false)` (dedup probe collapsing to "no existing
alert", duplicating an alert); `promotions.rs:289`/`:421` (`get_product(...).ok()` in the
category-scope closure, silently treating an unreadable product as uncategorized and dropping its
line from the discount base — that closure's `Option` contract makes it a signature change, not a
one-liner); and `tax/scopes.rs:629` in `ensure_scoped_coverage_survives`, where a swallowed fault
reads as "nothing covers this location" and DECLINES a refusal the guard exists to raise. Each needs
its own red-first slice.

**Commits:** this entry + the fix land in the pathspec commit below.


### 2026-09-28 — TDD round 3: the tax coverage guard stops failing open

**Problem:** `Store::ensure_scoped_coverage_survives` (`crates/kasirmu-core/src/db/tax/scopes.rs:617-629`)
exists to REFUSE archiving the last rate row covering a scoped location — the "somebody authored a
scope for a branch, and archiving its last row silently relocates that branch onto a fallback three
tiers away, or onto nothing at all" case its own doc describes. Its first read of the row being
archived ended in `.ok()`, and the very next lines define `None` as "no such active row — nothing
scoped is being erased" and return `Ok(())`. So a database fault made the guard **allow the archive
it exists to refuse**: fail-open on a money-configuration guard. The Red test proves it — with the
probe faulted, `delete_tax_rate` returned `Ok(())`.

**Solution:** the probe now uses `.optional()?`, so only a genuinely absent row is "nothing scoped
is being erased" and a real fault is `CoreError::Db`. The Red-first test injects the fault by
renaming only the column that read touches (`RENAME COLUMN location_id TO location_id_hidden`), so
the failure is the guard's own and not a later statement's.

**Verified:** full `kasirmu-core` lib suite **3398 passed / 0 failed** (3397 + 1 new); tax module
81/81; `cargo fmt -p kasirmu-core -- --check` and `cargo clippy -p kasirmu-core --all-targets` both
silent on the two touched files.

**Investigated and deliberately NOT changed — `adjust.rs:466`/`:475`/`:494`.** These were queued
for this round and are NOT defects: the caller documents the threshold check as "NON-FATAL by design:
a threshold alert is advisory, so a failure here must not roll back the stock adjustment", routes it
through `if let Err(e) = ... { tracing::warn!(...) }` (`:345-359`, the MSL-26 log), and
`products_tests.rs::a_failing_threshold_check_does_not_block_the_stock_adjustment` pins that a failed
threshold check must not fail the adjustment. Converting the probes to hard errors would break that
pinned contract. The residual (a fault reads as "no threshold configured" or "no existing alert")
changes which advisory alert is written, never the adjustment — so it belongs to the threshold
feature, not to this probe-class sweep. Recorded rather than churned.

**New leads this pass surveyed, queued for their own slices (not fixed here):**
1. `db/sales_tax.rs:541-549` — `resolve_best_tax_rates_for_sku_at` reads the product's
   `category_id` with `.ok().and_then(|v| v)`; a fault makes a product read as UNCATEGORIZED and
   silently falls through to the tenant-default rate. That is a wrong TAX RATE on a sale. Same
   MSL-27 class, and the strongest remaining candidate found so far.
2. `db/popularity.rs:620-628` — `sku_means` reads the product's category with
   `.ok().flatten()`; a fault silently drops to the global mean, quietly shifting the popularity
   score for that SKU's search events.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 4: a category-probe fault stops billing the tenant-default rate

**Problem:** `Store::resolve_best_tax_rates_for_sku_at` (`crates/kasirmu-core/src/db/sales_tax.rs`)
picks a sale line's tax rates from three levels: product-assigned, then category-assigned via the
product's `category_id`, then the store default. The level-2 probe read `category_id` with
`.ok().and_then(|v| v)`, so a database fault collapsed to `None` — and `None` there means "this
product has no category". Resolution fell through to level 3 and returned the TENANT-DEFAULT rate.
The Red test made the money impact literal: an 8% category rate and a 5% default configured, the
probe faulted, and `resolve_best_tax_rates_for_sku` returned the "Default Store Tax 5%" row — a
wrong tax rate on a real sale, with no error raised anywhere.

**Solution:** `.optional()?` — but the obvious form was wrong and the suite caught it. Keeping the
bare `row.get(0)` let inference pick `String`, so a product with a NULL `category_id` — the
ordinary "no category" case — errored `InvalidColumnType` and broke 12 existing tests, among them
`resolve_best_tax_rates_falls_back_to_default_store_rate` and
`resolve_best_tax_rates_returns_empty_when_no_rates_exist`. The correct form names the column's
nullability in the getter — `row.get::<_, Option<String>>(0)` — and flattens:
`.optional()?.flatten()`. Row-missing, column-NULL, and DB fault are three distinct outcomes
again: the first two really are "no category", the third propagates as `CoreError::Db`. The test
injects the fault by renaming only `products.category_id`, so the failure is the probe's own.

**Verified:** Red first — the new test failed returning the default-rate row; after the fix the
sales module passed 156/156 and the full `kasirmu-core` lib suite passed **3399 / 0**
(3398 + 1 new); `cargo fmt --check` and `cargo clippy --all-targets` clean on both touched files.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 5: a category-probe fault stops scoring popularity against the global mean

**Problem:** `Store::recompute_popularity` (`crates/kasirmu-core/src/db/popularity.rs`)
refreshes a single SKU's popularity score after a sale or search event, smoothing its raw
signals against cached per-category means. The probe deciding WHICH means to use — reading the
product's `category_id` — used `.ok().flatten()`, so a database fault collapsed to `None`.
`None` there reads as "uncategorized": the SKU fell back to the GLOBAL catalog means, a
global-mean-smoothed score overwrote the correct category-mean one, and the recompute reported
`Ok(())`. The retail grid's default popularity sort silently drifted for that SKU with no
error anywhere — the same MSL-27 defect class as round 4, one file over.

**Solution:** `.optional()?`, with the round-4 lesson applied on the first attempt: the getter
is typed `row.get::<_, Option<String>>(0)` so a NULL `category_id` (the ordinary uncategorized
case) still resolves to `None`, and `flatten()` keeps row-missing and column-NULL as the same
"no category" while a real fault propagates. `sku_means` became
`Result<(f64, f64, f64), CoreError>`; its only caller — `recompute_popularity`, already
`Result`-returning — now propagates with `?`.

**Verified:** Red first — under a faulted probe (renaming only `products.category_id`) the
recompute reported success: `expect_err` got `Ok(())`. After the fix the popularity module
passed 15/15 and the full `kasirmu-core` lib suite passed **3400 / 0** (3399 + 1 new);
`cargo fmt --check` and `cargo clippy --all-targets` clean on both touched files. The test
pins the healthy path before injecting the fault — a missing category cache would otherwise
make the fault test pass for the wrong reason — and asserts the failed run left the stored
score untouched.

**Investigated & deliberately NOT done:** `read_setting`'s own `.ok()` still collapses a
settings-read fault into a cache miss, falling back to global means — same drift, lower
severity, different fault surface. Queued as its own slice.

### 2026-09-28 — TDD round 6: receipt-barcode lookup stops swallowing DB errors (COR-9)

**Problem:** `Store::lookup_sale_by_receipt_barcode` (`crates/kasirmu-core/src/db/sales.rs`)
used `.ok()` on its query into the `receipt_barcodes` table. Any database failure (table/column
corruption, lock error, schema drift) silently collapsed into `None`, causing the function to
report `Ok(None)` ("sale not found") instead of propagating `CoreError::Db`. This could cause
an active sale to be treated as non-existent during receipt verification or returns.

**Solution:** Replaced `.ok()` with `.optional()?` on the query row result, returning
`Result<Option<Sale>, CoreError>` where DB errors are properly propagated and missing barcodes
cleanly resolve to `Ok(None)`. Updated the audit header to mark COR-9 CLOSED.

**Verified:** Red first (`a_db_failure_in_lookup_sale_by_receipt_barcode_surfaces_the_error`
panicked with `a DB failure must not silently return Ok(None): None`). After `.optional()?`
the test passed, along with `cargo fmt`.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 7: primary regional config stops swallowing DB errors

**Problem:** `Store::primary_regional_config` (`crates/kasirmu-core/src/db/regional.rs`)
queries `SELECT id FROM locations WHERE is_primary = 1 LIMIT 1` using `.ok()`. Any database
query fault (table lock, schema corruption, I/O failure) collapsed into `None`, returning
`Ok(None)` ("no primary location / not seeded yet") instead of propagating `CoreError::Db`.
Callers would incorrectly treat an active store with a faulted DB as an unseeded deployment.

**Solution:** Replaced `.ok()` with `.optional()?` on the query row result, returning
`Result<Option<RegionalConfig>, CoreError>` where genuine DB failures propagate as `Err(CoreError::Db)`
while an unseeded/no-primary state cleanly resolves to `Ok(None)`.

**Verified:** Red first (`primary_regional_config_propagates_database_error` panicked with
`a database error must not silently return Ok(None): None`). After `.optional()?`, the test
passed and `cargo fmt` was applied.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 8: monthly forecasts, a means-read fault, and a torn means cache

**Problem (1/3):** `Store::category_forecast` (`crates/kasirmu-core/src/db/popularity.rs`)
parsed every trend bucket key with `NaiveDate::parse_from_str(&p.period_start, "%Y-%m-%d")`.
The monthly bucket key is `YYYY-MM` (`strftime('%Y-%m', …)`), which never matches, so every
monthly point was dropped from its category's series and the forecast returned a confident row
of zeros — `forecast_units: 0`, `trend_per_period: 0.0`, `recent_avg_units: 0.0` — for a catalog
with real monthly sales history. The granularity is reachable: the bridge's `validate_trend_args`
admits `monthly` (`TREND_GRANULARITIES`) and `ui/src/api/reports.ts` types the argument
`'daily' | 'weekly' | 'monthly'`. The caller got a confident zero instead of an error.

**Solution (1/3):** a `parse_period_start` helper accepts both bucket-key shapes — `%Y-%m-%d` for
the daily/weekly buckets and `%Y-%m` anchored to the first of the month. Only the per-period
ordering and count feed the fit, so the anchor day is immaterial; the function doc now says so.

**Problem (2/3):** `read_setting` used `.ok()`, collapsing a `settings` read fault onto the same
`None` as a genuinely absent key. `read_mean`, `category_means` and `sku_means` were built on
that, so a fault read as an empty cache: the SKU was scored against 0.0 means — the fresh-DB
path — and `recompute_popularity` returned `Ok(())`. Same defect class as MSL-27 (the category
probe, round 5, one level up); round 5's entry queued exactly this slice.

**Solution (2/3):** `read_setting` now returns `Result<Option<String>, CoreError>` via
`.optional()?`, so only row-absence is `None`; `read_mean` and `category_means` propagate, and
`category_popularity_trend`'s means read propagates with them. An absent or unparseable cache
still degrades to the global fallback by design — it is a locally rebuilt cache, not a source of
truth — while a database fault is now an error.

**Problem (3/3):** `recompute_all_popularity` persisted the means cache (`CATEGORY_MEANS` plus the
three `MEAN_*` keys) through `self.conn` and only then opened the transaction that writes the
scores. A score write that failed left the cache ahead of the catalog, so every later single-SKU
recompute smoothed against means that no stored score was built from until some later full pass
happened to succeed — and AGENTS.md puts SQLite writes in one transaction.

**Solution (3/3):** a free `write_setting_in_tx(tx, key, value)` helper; the cache and the scores
now commit in one transaction. The old `write_setting`/`write_mean` methods went away with their
now-only caller.

**Verified:** Red first on all three. (1) `left: 0, right: 16` on a 10 → 12 → 14 units-per-month
series; (2) `expect_err` got `Ok(())` after renaming only `settings.value`; (3) `left:
"145.61720018347634"` vs `right: "35.35050620855721"` after a trigger blocked the score UPDATE.
After the fixes the popularity module passed **36/36** (33 before this round) and
`cargo fmt -p kasirmu-core -- --check` is clean on both touched files. The full `kasirmu-core` lib
suite is **3376 passed / 29 failed**, and all 29 are pre-existing environment failures — the
file-DB race, backup and export tests panicking on `Os { code: 5, PermissionDenied }` while
building a database under `std::env::temp_dir()` — untouched by this round.

**Investigated & deliberately NOT done:** a void does not recompute popularity, but `void_sale`
only voids `status = 'active'` sales, which the `status = 'completed'` filter never counted, so no
score can be left stale by one. The popularity window filters compare an RFC3339 `…T…Z` value
against SQL-side `datetime('now')`, but that prefilter is always a superset of the
`[0, WINDOW_DAYS)` window `decayed_sum`/`total_events` enforce afterwards, so nothing is
mis-included.

**Commits:** this entry + the fixes land in the pathspec commit below.

### 2026-09-28 — TDD round 9: legal entity regional resolution stops swallowing DB errors

**Problem:** `Store::regional_config_for_location` (`crates/kasirmu-core/src/db/regional.rs`)
queries `legal_entities` to construct the `LegalEntity` layer. The query row execution used
`.ok()`, collapsing any row parsing, type conversion, or query fault into `None`. When faulted,
the location silently ignored its configured legal entity and fell back to organization/built-in
defaults (e.g. "en-US", built-in currency) and returned `Ok(RegionalConfig)` rather than
propagating `CoreError::Db`.

**Solution:** Replaced `.ok()` with `.optional()?` on the `query_row` call. Row-absence
(or cross-tenant isolation where no row matches) still cleanly resolves to `None` preserving
fail-closed tenant isolation, while SQLite type conversion or database errors propagate as
`Err(CoreError::Db)`.

**Verified:** Red first (`regional_config_for_location_propagates_legal_entity_db_error`
panicked with `a database error reading legal entity must not silently fall back: RegionalConfig { ... locale: RegionalValue { value: "en-US", scope: BuiltIn } ... }`).
After `.optional()?`, the test passed, all 21 regional tests passed, and `cargo fmt` was clean.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 10: void_pending_sale audit detail stops swallowing total_minor DB errors

**Problem:** `Store::void_pending_sale` (`crates/kasirmu-core/src/db/sales_lifecycle.rs`)
queries `total_minor` from the updated sale row to record in the `sale.void` audit log entry.
The query used `.ok()`, causing any SQLite read/type-conversion/database error to collapse to
`None`. This caused the audit log to record `"total_minor": null` for a voided sale without
signaling any error, corrupting audit trails.

**Solution:** Replaced `.ok()` with `.optional()?` on `tx.query_row`, propagating
`CoreError::Db` when reading `total_minor` fails.

**Verified:** Red first (`void_pending_sale_propagates_db_error_when_reading_sale_total`
panicked with `a database error reading total_minor must not be swallowed into null audit details: ()`).
After the fix, the test passed cleanly and `cargo fmt` was applied.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 11: legacy stock bridge and location qty stop swallowing DB errors

**Problem:** `Store::bridge_legacy_inventory_into_stock_summary_in_tx` and
`Store::legacy_aware_location_qty` (`crates/kasirmu-core/src/db/products_stock_adjust/adjust.rs`)
query `SELECT qty FROM inventory WHERE product_id = ?1` using `.ok()`. Any SQLite
read/type-conversion/database error collapsed into `None`. In the legacy bridge, this silently
skipped backfilling existing inventory into `stock_summary` with `Ok(())`. In location qty
resolution, it caused current stock to be evaluated as 0, potentially overwriting legacy inventory
upon stock adjustment.

**Solution:** Replaced `.ok()` with `.optional()?` on both `inventory` query calls, ensuring
database errors propagate as `Err(CoreError::Db)` instead of corrupting inventory calculations.

**Verified:** Red first (`bridge_legacy_inventory_propagates_db_error_when_reading_inventory`
panicked with `a database error reading legacy inventory must not silently be ignored: ()`).
After `.optional()?`, the test passed, all 17 stock adjust tests passed, and formatting was clean.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD batch 2: Postgres-twin monthly drift, and a Sunday reported a week early

**Problem (1/2):** the Postgres mirror of the forecast
(`apps/cloud-server/src/email_pg/popularity.rs`) parsed every trend bucket key with
`NaiveDate::parse_from_str(&p.period_start, "%Y-%m-%d")` — the exact defect the previous round
fixed on the SQLite side, still live in the twin. Its own trend emits `LEFT(created_at, 7)`,
that is `YYYY-MM`, for the monthly granularity, so every monthly point was dropped from its
category's series and the web dashboard's monthly forecast returned rows of zeros for catalogs
with real monthly history. A duplicated implementation drifted from the original: the twin had
no tests at all, which is why nothing caught it.

**Solution (1/2):** one parser, not two. `parse_period_start` is now `pub` in
`kasirmu_core::db::popularity` (the container type the twin already imports from) and the twin
delegates to it, so the two implementations can no longer disagree about which bucket-key shapes
the trend can emit. The new `email_pg/popularity_tests.rs` pins the contract the twin relies on.

**Problem (2/2):** the weekly trend bucket used `DATE(x, tz, 'weekday 0', '-7 days')` (SQLite)
and `date_trunc('week', x::date)::date - 1` (PG). Both put the boundary Sunday in the PREVIOUS
week: `'weekday 0'` leaves a Sunday where it is and the `-7 days` then subtracts a week, so every
Sunday sale was reported a week early and split away from the Monday that follows it.
`Store::weekly_revenue` documents and has already fixed this exact class for its own Monday form
(`'weekday 1', '-7 days'` pushes a Monday into the previous week; the fix is to shift first).
The trend's doc comment also claimed to mirror `weekly_revenue`'s expression, which no longer
exists — a maintainer trusting it would have concluded the two surfaces share a week boundary
when they do not.

**Solution (2/2):** shift first, then advance — `DATE(x, tz, '-6 days', 'weekday 0')` — so the
boundary Sunday opens its own week; the PG mirror advances the day by one before truncating
(`date_trunc('week', x::date + 1)::date - 1`). The comment now states the real convention: weekly
trend buckets are Sunday-start, deliberately unlike `weekly_revenue`'s Monday-first weeks.

**Verified:** Red first for both. (1) `a_monthly_bucket_key_parses_into_a_date` failed on the
monthly key while the daily key passed. (2) `weekly_trend_buckets_a_sunday_with_the_week_it_starts`
failed with `left: ["2026-08-02", "2026-08-09"]` for a Sunday+Monday pair that is one week.
After the fixes: popularity **37/37**, cloud **363/363**, reports **115/115**, and the full
`kasirmu-core` lib suite **3409 / 0**. ⚠️ The PG weekly expression cannot be run in this
ecosystem — the twin's integration arms are `pg-tests`-gated (54 skipped, no Postgres available)
— so that edit is inspection-verified only; the SQLite side of the same idiom is run-verified.

**Environment, and why the earlier "29 environmental failures" claim was only half right:**
every one of those 29 failures was `Os { code: 5, PermissionDenied }` raised while a test built a
file database under `std::env::temp_dir()`, which this sandbox denies. Redirecting `TMP`/`TEMP`
to a writable directory (`target/tdd-tmp`) lets them all run: the suite goes from **3376 / 29** to
**3409 / 0**. Tests that need a real file database are runnable here after all — only the
database-backed ones (Postgres) are not.

**Investigated & deliberately NOT done:** `tz_modifier` still reads the primary location's
timezone with `.ok()`, but its UTC fallback is documented and logged, and making it an error means
an `Result` signature through nine modules — left for its own slice. The Sunday-vs-Monday week
convention difference between the popularity trend and `weekly_revenue` is now documented rather
than changed: unifying it is a product decision with UI consequences, not a defect fix.

**Commits:** this entry + the fixes land in the pathspec commit below.

### 2026-09-28 — TDD round 13: KDS complete_sale_to_kds stops swallowing product name DB errors

**Problem:** `Store::complete_sale_to_kds_fanout` (`crates/kasirmu-core/src/db/kds_lines.rs`)
resolves product display names for kitchen tickets using
`self.product_name_by_sku(&l.sku).ok().flatten().unwrap_or_else(|| l.sku.clone())`.
Any database query error (disk I/O, table lock, corrupted index) silently collapsed into `None`
via `.ok()`, causing the kitchen ticket to print the raw SKU string instead of failing the
ticket transaction and alerting the system.

**Solution:** Changed `.ok().flatten()` to `?` on `product_name_by_sku(&l.sku)`, properly
propagating `CoreError::Db` when querying product details fails, while legitimately un-named
or missing product rows still fall back cleanly to `l.sku.clone()`.

**Verified:** Red first (`complete_sale_to_kds_propagates_db_error_when_resolving_product_name`
panicked with `a database error reading product name must not silently fall back to raw SKU`).
After the fix, the test passed cleanly and `cargo fmt` was applied.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD batch 3: unvalidated date bounds on the custom-report door

**Loose end from batch 2, closed by RUNNING it rather than inspecting it.** That batch changed the
Postgres twin's weekly bucket to `date_trunc('week', x::date + 1)::date - 1` and could only inspect
the result. It is now evaluated against a real `postgres:17-alpine` (throwaway container, no host
port, stopped afterwards): for Sunday 2026-08-09 the old form yields `2026-08-02` — the previous
week, i.e. the bug — and the new one `2026-08-09`, the Sunday it opens; a Monday and a Saturday map
identically before and after. The change fixes the boundary case and moves nothing else, so it
stands. It stays an expression-level proof: the cloud's 54 `pg-tests` arms need a full
`init.pg.sql` bootstrap, not merely a reachable server.

**Problem:** `Store::build_custom_report` (`crates/kasirmu-core/src/export/mod.rs`) is the IPC door
behind `build_custom_report_scoped` — the custom-report builder a user types a date range into — and
it interpolated `start_date`/`end_date` straight into `DATE(col, tz) BETWEEN ?2 AND ?3` without
validating them. Every other date-bounded report in the crate validates at the door, because
`check_date_bound` exists precisely for this: SQLite compares a boundary as a plain string, so
`"2026-13-45"` matches no row and the report returns **empty with no error** — the shape this repo
treats as the worst one, "nothing errors and the numbers just read zero". The 24-09-26 crate review
had already been through this function (MSL-57 fixed its *bound format*), and its own entry records
that the export filter sat outside the audit fence — which is how the validation half stayed open.

**Solution:** validate both bounds with `crate::db::reports::check_date_bound` when present, before
the `0000-01-01`/`9999-12-31` defaults are applied, and inside the `has_date_filter` branch only —
so a dataset with no date filter still ignores stray dates instead of rejecting them.

**Verified:** Red first, and re-proven by temporarily reverting the fix (the honest way to show the
failure was not incidental): the test failed with
`CustomReportResponse { columns: ["id"], rows: [], truncated: false }` handed to `expect_err` — an
empty report, not an error. Green after the fix: export **145/145**, `cargo fmt -p kasirmu-core`
clean on both touched files.

**Also checked and found sound (no change made):** `csv_cell` quotes cells and doubles embedded
quotes; all ten CSV writers' headers match their row widths; the cloud's `revenue_profit_fields` is
a faithful REP-08 mirror of the core arithmetic; and all six custom-report dataset definitions name
real columns (`shifts` correctly filters on `opened_at`, not `created_at`).

**Not fixed, recorded:** `truncated = rows.len() >= limit as usize` reports truncation for a result
set that exactly fills the limit, because the query can only ever fetch `limit` rows — a truthful
flag needs a `limit + 1` fetch. Still open from earlier batches: `tz_modifier`'s `.ok()` (documented
UTC fallback, nine-module blast radius) and the cloud's `pg-tests` arms.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 14: promotion category resolution stops swallowing product DB errors

**Problem:** `Store::apply_promotion_to_sale` and `Store::apply_promotions_batch`
(`crates/kasirmu-core/src/db/promotions.rs`) resolved product categories for category-scoped
promotions via `self.get_product(sku).ok().flatten().and_then(|p| p.product.category_id)`.
Any database read or type-conversion fault when looking up the product collapsed into `None`
via `.ok()`. This caused category-scoped promotions to view eligible products as uncategorized,
silently reducing or eliminating discounts (e.g. charging full price without error).

**Solution:** Pre-resolve the product categories of the sale's lines when `promo.category_id.is_some()`,
propagating any database error with `self.get_product(&line.sku)?` before discount evaluation.

**Verified:** Red first (`apply_category_promotion_propagates_db_error_when_resolving_product`
panicked with `a database error resolving product category must not silently collapse to zero discount: PromotionApplication { ... discount_minor: 0 ... }`).
After the fix, the test passed, all 40 promotions tests passed, and formatting was clean.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 15: checkout shortfall alternative resolution stops swallowing DB errors

**Problem:** In `Store::complete_sale_deduction` (`crates/kasirmu-core/src/db/sales_checkout.rs`),
when stock shortfall occurs, alternative inventory locations are resolved via
`resolve_location_chain_for_sku(...).unwrap_or_default()`. If a database error occurs (e.g.
locked tables, corruption, or I/O failure during binding traversal), `.unwrap_or_default()`
swallowed the error and returned an empty vector. This caused the checkout flow to falsely
report zero available alternatives in the shortfall validation payload rather than surfacing
`CoreError::Db`.

**Solution:** Replaced `.unwrap_or_default()` with `?` in both line item and BOM ingredient
shortfall resolution blocks, propagating database errors immediately.

**Verified:** Red first (`complete_sale_deduction_propagates_db_error_when_resolving_shortfall_alternatives`
panicked expecting `CoreError::Db` but got `Validation { field: "stock", ... alternatives: [] }`).
After changing to `?`, the test passed cleanly and `cargo fmt` was applied.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 16: legacy workspace assignment stops swallowing row decoding DB errors

**Problem:** In `Store::list_workspaces_legacy` (`crates/kasirmu-core/src/db/workspaces.rs`),
user workspace assignments were queried from `user_workspaces` via
`query_map(...)?.filter_map(|r| r.ok()).collect()`. Any row decoding or database error
silently caused the corrupt row to be filtered out. If all rows or specific assignments failed,
the user's workspace keys became empty and unexpectedly fell through to role-level workspace
assignments, failing open with broader or unintended permissions.

**Solution:** Changed `.filter_map(|r| r.ok())` to `.collect::<Result<Vec<_>, _>>()?`,
ensuring row decoding or query errors fail closed and propagate as `Err(CoreError::Db)`.

**Verified:** Red first (`list_workspaces_legacy_propagates_db_error_on_corrupt_user_workspace_row`
panicked with `corrupt user_workspaces row must abort resolution with DB error: []`).
After changing to `.collect::<Result<Vec<_>, _>>()?`, the test passed cleanly and `cargo fmt` was applied.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 17: one table turn per sale, one bucket per unlabelled discount (core/reports)

**Problem (1/2):** `Store::table_turnover` and `Store::hourly_table_activity`
(`crates/kasirmu-core/src/db/reports/sales_summary.rs`) counted `COUNT(*)` over `kds_orders`
joined to `sales`. `kds_orders` is `UNIQUE (sale_id, kitchen_zone)`, and the migration's own
comment says a sale whose items span two kitchen zones fans out into one ticket per zone — so one
party at one table was reported as two table turns, and the occupancy curve double-counted the
same sale.

**Problem (2/2):** `Store::discounts_summary` selected
`COALESCE(NULLIF(discount_label, ''), 'discount') AS label` but grouped on the RAW
`discount_label` column. An unlabelled discount is stored either as NULL (no label) or as `''`
(empty label), so the same displayed code came back as two rows both labelled `discount`, each
with half the count, and the pair spent two of the five `LIMIT 5` slots.

**Solution:** `COUNT(DISTINCT s.id)` in both KDS-joined rollups, and
`GROUP BY COALESCE(NULLIF(discount_label, ''), 'discount')` in `discounts_summary`, so the group
key is the label that is actually displayed. Both doc comments now state the invariant (one turn
per sale whatever the zone fan-out; bucketing on the displayed label). No other change.

**Verified:** Red first, three independent failures. `table_turnover_counts_one_turn_per_table_not_per_kitchen_ticket`
failed `left: 2, right: 1` (one sale, two zones, one table);
`hourly_table_activity_counts_one_turn_per_table_not_per_kitchen_ticket` failed the same way;
`discounts_summary_treats_null_and_empty_labels_as_one_bucket` failed `left: 3, right: 2` with
codes `[WELCOME10 1, discount 1, discount 1]`. Green after the fix: reports + export + popularity
**297/297**, `cargo fmt -p kasirmu-core -- --check` clean.

**Closed from an earlier batch:** `truncated = rows.len() >= limit as usize` is fixed in
`8c38443cb` — the query now fetches `limit + 1`, so a page that exactly fills the limit reports
`truncated: false` while the genuine case still reports `true` and the page stays capped.

**Probed and found sound (no change made):** a store offset past ±14:00 is not the silent-wipe
hazard it looks like — SQLite accepts it (`DATE('2026-01-01T10:00:00Z', '+15:00')` → `2026-01-02`),
so no NULL dates; an impossible day is likewise harmless (`DATE('2026-02-31')` → `2026-03-03`, and
the range bounds compare as TEXT, so `2026-02-31` is a loose but harmless upper bound rather than
an empty report) — `check_date_bound`'s month/day-range contract therefore stands as documented;
`filter_analytics_bundle` never clears `category_popularity` / `category_forecast`, which is
harmless because the email builder renders neither section, and the UI's seven
daily/weekly/monthly/top-products/heatmap/category/stock checkboxes are exactly the seven keys the
filter DOES clear; the cloud bundle calls `category_popularity(3)` and
`category_forecast(.., "weekly", 10)`, matching the core call sites exactly. The cloud modules with
no tests at all were read in full (`email_pg/analytics.rs`, `email_pg/settings_store.rs`,
`email_pg/queue_worker.rs`, `sync_store/{sqlite,pg,conflicts,tenant}.rs`, `openapi/cloud.rs`) and
no provable defect surfaced from reading: their PG arms need the full `init.pg.sql` bootstrap,
which this checkout cannot run.

**Not fixed, recorded:** the cloud report loop polls every 300 s
(`start_report_sender_loop_pg`, `apps/cloud-server/src/email_pg/queue_worker.rs`) while
`should_send_scheduled_with_last_sent` accepts a send only inside a ±120 s window — a wake-up that
falls outside it is a silent miss for that whole period (~20% of wake-ups). The function reads the
wall clock, so there was no deterministic Red, and widening the window is a behaviour change rather
than a fix.

**Commits:** the `truncated` fix is `8c38443cb`; the two rollup fixes are `bec59ac3b`; this entry
lands in its own pathspec commit.

### 2026-09-28 — TDD round 18: stock threshold alert checks stop swallowing DB errors

**Problem:** In `Store::check_stock_threshold_and_alert_in_tx` (`crates/kasirmu-core/src/db/products_stock_adjust/adjust.rs`),
querying `stock_thresholds` (for product+location or global product thresholds) chained `.ok().or_else(|| ...ok())`.
Any query or row decoding error (e.g. invalid threshold integer or DB read error) was collapsed to `None`,
failing open and silently skipping threshold alerts as if no threshold had been configured.
Similarly, querying `stock_alert_events` used `.unwrap_or(false)`, masking database query errors when checking for
existing alerts.

**Solution:** Replaced `.ok()` with `.optional()?` on the threshold queries and `.optional()?.unwrap_or(false)`
on the alert events query, ensuring database and decoding errors properly propagate as `CoreError::Db`.

**Verified:** Red first (`check_stock_threshold_and_alert_propagates_db_error` panicked with
`database error reading threshold must propagate: ()`). After changing to `.optional()?`, the test passed cleanly
along with all 18 stock adjustment tests.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 18: a custom stock threshold no longer sits under the default (core/reports + cloud mirror)

**Problem:** `Store::low_stock_alerts_at_location`
(`crates/kasirmu-core/src/db/reports/product_sales.rs`) resolved the reported `threshold` with a
three-way `COALESCE(product+location, product+global, default)` but decided the WHERE with a
DISJUNCTION — `COALESCE(ss.qty, 0) <= ?2 OR (custom ≤ threshold)` — so the default branch fired
even when an enabled custom threshold existed. A product configured with a threshold of 4 and 5
units on hand was returned as a low-stock alert carrying `current_qty: 5` beside `threshold: 4`: a
row whose own fields contradict it, surfaced in the UI's low-stock badge. The Postgres twin
(`apps/cloud-server/src/email_pg/analytics.rs::low_stock_alerts_at_location_pg`) had the identical
predicate, so the scheduled email's low-stock section reported the same false alert.

**Solution:** the filter now compares the current quantity against the SAME resolved threshold the
`threshold` column reports — one `COALESCE(...)` in the WHERE, mirroring the SELECT list — so an
enabled custom threshold replaces the default for the decision as well as for the value. Applied to
both twins.

**Verified:** Red first:
`low_stock_alerts_at_location_does_not_fall_back_to_the_default_over_a_custom_threshold` failed with
`[... current_qty: 5, threshold: 4 ...]` ("custom threshold 4 with 5 on hand is not low stock").
Green after the fix, with the unpinned half asserted too (a product with no threshold still reports
at the default). The Postgres twin was proved at expression level in a throwaway
`postgres:17-alpine`: the OLD predicate returned `CALM (qty 5, threshold 4)`, `DEEP (15, custom 20)`
and `PLAIN (5, default 10)`; the NEW one drops `CALM` and keeps `DEEP` and `PLAIN`. Suites: core
reports + export + popularity **298/298**, cloud `sync_store` **22/22**, `cargo fmt -- --check` clean
for both crates.

**Also fixed (doc):** `WeeklyRevenueRow::week_start` was documented as "the week start (Sunday)"
while the query buckets Monday-first (`'-6 days', 'weekday 1'`) and the UI keys yearly heatmap cells
off a Monday `week_start` — a row doc contradicting the value it describes.

**Folded in, no behaviour change:** the two table-activity rollups now share a `TABLE_TURN_SOURCE`
constant holding the `COUNT(DISTINCT s.id)` source and its predicate. Two hand-copied versions
drifting apart is exactly what produced the same double-count bug in both queries in round 17.

**Probed and found sound (no change made):** the audit's premise that `sync_store/sqlite.rs` has no
tests was WRONG — its arms are exercised through the parent's `sync_store_tests.rs` (origin-terminal
round trip, fallback INSERT, all three pull shapes, conflict detection with auto-merge and
last-writer-wins, duplicate rejection, tax-rate scope, and a sibling's three-shape filter test). Two
genuinely uncovered paths were closed with tests and both are CLEAN, not finds: the multi-statement
chunk boundary (`sqlite_push_batch_keeps_outcomes_across_the_multirow_chunk_boundary`, 501 items with
a duplicate straddling the boundary: first `Accepted`, second `Rejected`, 500 rows stored) and the
SYNC-10 fail-loud decode path (`sqlite_pull_fails_loudly_when_a_row_cannot_be_decoded`). Also sound:
`sqlite_snapshot_products` reading `price_updated_at` as required is NOT the outlier the PG arm's
`unwrap_or_default` suggests — core's own product row mapper (`db/mod.rs:617`) reads it as required
too, so a NULL is outside the column's contract; `inventory_turnover`'s `sku_count =
COUNT(*) FROM products` is exact because `delete_product` is a hard DELETE; and the tenant-scoped
products join the cloud PG queries carry (`AND p.tenant_id = s.tenant_id`) has no core equivalent to
fix, because the local `sales` table has no `tenant_id`/`store_id` column at all.

**Commits:** this entry + the fixes land in the pathspec commit below.

### 2026-09-28 — TDD round 19: reverse_loyalty_on_refund stops swallowing DB errors on earn lookup

**Problem:** In `reverse_loyalty_on_refund` (`crates/kasirmu-core/src/db/loyalty.rs`), the query looking up
the original `earn` transaction for a refunded sale used `.ok()`. Any database query error or column decoding
failure (e.g. invalid integer points representation) was collapsed to `None`. The function treated this as
"sale earned nothing or predates loyalty" and returned `Ok(None)`, silently completing the refund without
reversing the customer's earned loyalty points.

**Solution:** Replaced `.ok()` with `.optional()?` on the earn query, so legitimate missing rows return `Ok(None)`
while true database and decoding errors properly propagate as `Err(CoreError::Db)`.

**Verified:** Red first (`reverse_loyalty_on_refund_propagates_db_error_when_reading_earn_row` panicked with
`database error reading earn transaction must propagate, not return Ok(None): None`). After `.optional()?`,
the test passed cleanly along with all 50 loyalty tests.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 20: next_count_number stops swallowing DB errors on sequence lookup

**Problem:** In `Store::next_count_number` (`crates/kasirmu-core/src/db/stock_counts.rs`),
the query computing `COALESCE(MAX(CAST(SUBSTR(count_number, ...) AS INTEGER)), 0)` used `.unwrap_or(0)`.
Because `COALESCE` guarantees a row with 0 if no matching counts exist, `query_row` returns `Err` only on genuine
database failures (e.g. database locks, disk failures, or schema errors). The `.unwrap_or(0)` swallowed
these errors and returned `Ok(format!("{prefix}001"))`, causing collisions and constraint violations on subsequent inserts.

**Solution:** Replaced `.unwrap_or(0)` with `?`, ensuring database errors properly propagate as `Err(CoreError::Db)`.

**Verified:** Red first (`next_count_number_propagates_db_error` panicked with
`database error in next_count_number must propagate, not fallback to 0: "CNT-20260928-001"`).
After adding `?`, the test passed cleanly along with all 25 stock count tests.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 21: set_terminal_profile stops misreporting DB errors as NotFound

**Problem:** In `Store::set_terminal_profile` (`crates/kasirmu-core/src/db/terminal_profiles.rs`),
the pre-check verifying terminal existence queried `SELECT COUNT(*) FROM terminals WHERE id = ?1` and mapped
it with `.unwrap_or(false)`. If a database error occurred during the count query (e.g. disk fault or table lock),
`.unwrap_or(false)` treated it as 0 terminals found and returned `Err(CoreError::NotFound { entity: "terminal", .. })`.
This misreported underlying database faults as missing entities.

**Solution:** Replaced `.map(...).unwrap_or(false)` with direct `?` propagation on the count query,
only returning `CoreError::NotFound` when `count == 0` without DB errors.

**Verified:** Red first (`set_terminal_profile_propagates_db_error_when_checking_terminal_exists` panicked with
`expected CoreError::Db, got NotFound { entity: "terminal", id: "t1" }`).
After adding `?`, the test passed cleanly along with all 19 terminal profile tests.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 22: mark_push_attempt stops swallowing DB errors on attempts lookup

**Problem:** In `Store::mark_push_attempt` (`crates/kasirmu-core/src/db/image_refs.rs`),
when recording an image push failure, the current attempt count was queried via
`SELECT attempts FROM image_push_queue WHERE hash = ?1` chained with `.unwrap_or((0,))`.
If reading the `attempts` column failed due to a database error or invalid column type,
the error was swallowed and treated as `0` attempts, endlessly resetting backoff attempts and
preventing dead-letter handling.

**Solution:** Replaced `.unwrap_or((0,))` with `.optional()?.unwrap_or(0)`, ensuring true database
errors propagate as `Err(CoreError::Db)`.

**Verified:** Red first (`mark_push_attempt_propagates_db_error_when_reading_attempts` panicked with
`database error reading attempts must propagate, not fallback to (0,): ()`).
After adding `.optional()?`, the test passed cleanly along with all 16 image ref tests.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-28 — TDD round 23: complete_sale_with_resolved_shortfalls stops swallowing DB errors on stock check

**Problem:** In `Store::complete_sale_with_resolved_shortfalls` (`crates/kasirmu-core/src/db/sales_lifecycle.rs`),
when re-checking stock availability at alternative locations for shortfall resolutions, `stock_summary` and
`workspace_inventory_locations` were queried using bare `.unwrap_or(0)`. If a database query or column decoding
failure occurred (e.g. invalid integer format or DB error), the error was swallowed and treated as `available = 0`,
causing the sale to fail with `CoreError::InsufficientStockAtLocation` instead of propagating `Err(CoreError::Db)`.

**Solution:** Replaced `.unwrap_or(0)` with `.optional()?.unwrap_or(0)` on both the `stock_summary` availability
query and the `workspace_inventory_locations` negative stock allowance check, properly propagating database errors.

**Verified:** Red first (`complete_sale_with_resolved_shortfalls_propagates_db_error_when_checking_stock_summary`
panicked with `expected CoreError::Db, got InsufficientStockAtLocation ...`).
After adding `.optional()?`, the test passed cleanly along with all 12 shortfall settlement tests.

**Commits:** this entry + the fix land in the pathspec commit below.

### 2026-09-29 — Registration ratchet: floor 475 -> 481 for the EDC CRUD and e-Faktur doors

**Problem:** Two feature commits registered six desktop commands and moved neither
`REGISTERED_FLOOR` nor the generated debt ledger, so
`drift_pin_registration_floor_is_met` and the ledger's own total were red at HEAD. The
floor leg reads the tree on purpose — the only way it can fail is that names were
registered — which is exactly what happened.

**What landed:**

- `8d3222d37` (feat(edc): implement multi-terminal binding routing and UI selection)
  registered `edc::list_edc_terminals_scoped`, `edc::create_edc_terminal_scoped`,
  `edc::update_edc_terminal_scoped`, `edc::delete_edc_terminal_scoped`.
- `7e2ddcbe5` (feat(bridge): expose e-faktur stamping and pengganti endpoints)
  registered `history::stamp_faktur_pajak_scoped`, `history::create_faktur_pengganti_scoped`.

**All six arrive GATED**, which is the difference from the 472 -> 475 step: `edc::*`
carries `SETTINGS_READ`/`SETTINGS_EDIT` and `history::*` carries `SALES_PROCESS`. So no
ceiling and no ledger row moved — regenerating the ledger rewrote only
`REGISTERED_TOTAL` (475 -> 481) and left all 68 debt rows byte-identical. This pass
records what landed; it does not approve it.

**Also fixed in the same pass:** four `gate_audit` census pins had drifted from source
and one had never matched. Re-measured, not copied from the red message — desktop `edc`
3 -> 8 calls and +`SETTINGS_EDIT`/`SETTINGS_READ`; desktop `history` 5 -> 7
(+`SALES_PROCESS`). Tablet `history` 5 -> 7 (+`SALES_PROCESS`); tablet `categories`
count 1 -> 3 with `PRODUCTS_READ` deliberately NOT added (its only occurrence is prose
the census skips); tablet `tax` count 1 -> 8. The `rust-doc` gate was red on seven
intra-doc errors across five crates and is now green.

**Verified:** Reran the generator (`KASIRMU_REGENERATE_GATE_LEDGER=1`) rather than
typing rows, as its header requires; 68 rows / 481 registered. `cargo test -p kasirmu-app
--lib commands::registration_gate_tests` → 14 passed. `cargo test -p kasirmu-app --test
gate_audit` → 3 passed. `RUSTDOCFLAGS='-D warnings' cargo doc --workspace --no-deps` →
clean. `cargo fmt --all --check` and workspace clippy `-D warnings` → clean.

### 2026-09-29 — Tablet twin of the same ratchet: mobile floor 343 -> 345

**Problem:** The desktop entry above covers the app shell. The SAME commit registered the
same pair on the tablet shell (`7e2ddcbe5` added
`history::stamp_faktur_pajak_scoped` and `history::create_faktur_pengganti_scoped` to
both `lib.rs` files), and it moved neither the mobile floor nor the mobile ledger — so
`cargo test -p kasirmu-mobile` was red at HEAD too. Found by a full-workspace run, not by
the per-crate checks.

**What landed:** the two names above and nothing else, verified by diffing the
`generate_handler![` block against `ebdca2758` (the commit that last set the constant):
343 names then, 345 now, zero removals. Both arrive GATED on `SALES_PROCESS`, so
regenerating the ledger rewrote only `REGISTERED_TOTAL` (343 -> 345) and left all 92 debt
rows identical.

**Note on the two-leg shape:** the mobile file checks the floor against the ledger's
generated total as well as against the tree, so raising the floor alone turns it red with
"the floor is now guarding a number nobody measured". Regenerating the ledger is required
in the same pass; that is the pin working as designed, not a second defect.

**Verified:** `KASIRMU_REGENERATE_GATE_LEDGER=1 cargo test -p kasirmu-mobile --lib
drift_pin_generated_ledger_is_the_sweeps_own_output` → regenerated, 92 rows / 345
registered. `cargo test -p kasirmu-mobile --lib commands::registration_gate_tests` → 12
passed.

### 2026-09-29 — RESOLVED: the records index is stamped and generated at once

**Found while running the `scripts/check.sh` static gates.** `node
scripts/generate-records-index.mjs --check` failed at HEAD, and the two mechanisms that
touch `docs/records/README.md` were mutually exclusive:

- `2b345fea4` (docs: audit the CI pipeline, records registry, …) committed an
  **audit stamp** as the file's first line, per the docs-auditor convention every
  other record now carries.
- `scripts/generate-records-index.mjs` **rewrote the whole file** and had no
  stamp-preservation logic. Running it therefore deleted the stamp; the freshness gate
  then compared the stamped file against unstamped output and failed.

So the gate was red for as long as the stamp existed, and the stamp was destroyed the
moment someone followed the gate's own instruction ("run:
node scripts/generate-records-index.mjs"). Neither the generator's header nor the gate's
message mentioned the stamp, so the loop was silent until a reader noticed the stamp was
gone.

**RESOLVED the same day, and it was worse than the stamp alone.** Diagnosing the diff
properly turned up a second defect underneath it: the generator's `frontMatter()` reader
required `---` on the literal FIRST line, and the audit campaign stamps records ABOVE
their front matter. ADR #37, #38 and #47 therefore lost their `num`, dropped out of the
numbered table, and were reclassified as unnumbered records — the committed index listed
55 ADRs while the generator could only see 52. That is the same class of defect the gate's
own `_note` records finding at wiring time ("148 generated vs 158 committed lines, ADR #60
missing").

Three changes, all in `scripts/generate-records-index.mjs`:

1. `frontMatter()` steps over a leading HTML comment before looking for `---`. Only
   comments are skipped; any other leading text still means "no front matter".
2. `leadingStamp()` carries the committed file's leading `<!-- … -->` block into the
   render verbatim.
3. `trailingFooter()` carries the trailing `> last audited …` line, which the campaign
   writes as the stamp's other half.

The generator still owns everything it authors — title, banner, sections, rows — so
"header + conventions are regenerated too" holds for the index itself; only human
provenance is passed through, which the script cannot know. Both ungated generated files
(`docs/README.md` via `scripts/gen-summary.py`, and the SEO review) carry stamps today
precisely because nothing compares them to a generator; this gives the one GATED file the
same reach.

**Verified:** `--check` now reports `ok: … (55 ADRs, …)`, exit 0, with the committed file
byte-identical to HEAD — `--check` writes nothing. Negative control: tampering one body
line still fails the gate, so the pass-through did not blunt it.

**Damage check:** an earlier diagnosis run DID delete the committed stamp in the working
tree. Restored with `git checkout --`, verified byte-identical to HEAD. Nothing was
committed from that run.

### 2026-09-29 — Two dead tables beside the receipt index allocator

**Found while checking that `5f59498df`'s tombstone removal left nothing dangling.**
That refactor is CORRECT and I verified the reason rather than assuming it: it replaces
the old "an index id is never reused" rule with a **lowest-available slot recycler**, and
the code genuinely implements it — `allocate_entity_index_with_ceiling_on_conn`
(`crates/kasirmu-core/src/db/receipt_code.rs:170-191`) returns `1` when free and otherwise
the first gap (`t1.index_id + 1` where `index_id + 1` is unused), which matches the module
doc written in the same commit and plan §4.1 / §10. Dropping the tombstone WRITE path is
therefore right: with recycling, a retired id is meant to come back.

**What the refactor left behind.** Two tables are created and replicated but read and
written by nothing:

- `entity_index_cursors` — `20261006_receipt_hierarchy_code.sql:37` plus the PG replica.
- `entity_index_tombstones` — the same file `:49`.

Neither is touched by any `.rs` outside two COMMENTS in
`crates/kasirmu-core/src/migrations_tests.rs` (`:823`, `:1078`), both of which merely count
tables. The old module doc's "Allocation is monotonic, driven by `entity_index_cursors`"
was the only thing that ever claimed otherwise, and `5f59498df` removed that sentence along
with the tombstone writer — so the header is now honest and the tables are simply orphaned.
Plan `_active/receipt-hierarchy-code.md` documents the recycler in three places (§4.1, §10,
the checklist) and mentions **neither table**.

**NOT dropped here, deliberately.** Removing them is a migration change, which AGENTS.md
§E6 puts on the ask-first list, and it is wider than it looks: both are pinned by the
table-count assertion (`migrations_tests.rs:833`, `127`) and appear in the generated
`20260813_init.pg.sql` whitelist at `:621-630` and its RLS array at `:3754`, so a drop must
move the count pin and regenerate the PG replica in the same pass. They are inert today
(no reader, no writer, no policy that depends on them), so the cost of leaving them is
schema noise rather than risk. Recorded for the allocator's owner to decide.

## 2026-10-04 — The credit-sale listing shows a payment gateway reference in its Customer column (`kasirmu-bridge`)

Found while sweeping row mappers for reads that degrade instead of propagating. Not a swallow —
a **column/field misalignment**, which is the worse version of the same family: the value is
present, correctly typed, and wrong.

`run_list_credit_sales` (`crates/kasirmu-bridge/src/settings/core.rs:66`) selects
`s.id, p.gateway_reference, s.total_minor, s.currency, s.created_at, p.settled_at,
COALESCE(u.display_name, '')` and maps those seven columns onto `CreditSaleDto` **positionally**.
Index 1 is `p.gateway_reference`, and it lands in `customer_name`; `cashier_name` takes index 6,
the display name. So the projection never reads any customer column at all — it reads the
payment gateway's reference into the field the UI shows as the buyer.

**Measured, then pinned** (`kasirmu-bridge/src/settings_tests.rs`,
`the_credit_sale_projection_maps_gateway_reference_into_the_customer_column`, added by
`a3c871787`): a completed credit sale for customer 'Bagus' (`sales.customer_id` → `customers.id`),
with a payment whose `gateway_reference` is `GW-REF-9`, returns `customer_name == "GW-REF-9"`.
The retail credit list renders that field in a **Customer** column
(`ui/src/features/retail/RetailModals.tsx:376`, `{c.customerName || '—'}`), so an operator reads
`GW-REF-9` where a name belongs.

**Why it survived.** The existing pin for this type
(`credit_sale_dto_emits_the_camel_case_wire_the_retail_list_reads`) constructs a `CreditSaleDto`
from hand-written literals and asserts its serialized shape. That is a real pin — it caught the
2026-09-15 snake_case/camelCase break — but it is blind to the query, because it never runs one.
A DTO-shape pin and a query-mapping pin are different facts, and only the first existed. The
struct's doc comment makes the confusion concrete: it calls this field "the cashier name", while
the column at its index is the gateway reference — three different readings of one line, none of
them checked by anything.

**NOT fixed here, deliberately.** Which column a customer name should come from is a product
ruling, not a repair: `customers.name` exists (`migrations/20260813_init.sql:102`) and the
projection does not join it, but choosing between adding that join, renaming the field to match
what it currently carries, or dropping the field from the wire changes what a cashier sees and
is a behaviour change to a surface already repaired once under this name. What this round could
do honestly is remove the blindness, so the pin now fails on any future edit to the projection
and the swap can no longer happen unseen. Recorded for the credit-list owner to decide.
### 2026-10-06 — Registration ratchet: desktop floor 481 -> 485 for the payment-gateway door

**Problem:** `a5212ca5f` (feat(payments): persist payment gateways with at-rest
encryption and wire frontend settings) registered four desktop commands and moved
neither `REGISTERED_FLOOR` nor the generated debt ledger, so
`drift_pin_registration_floor_is_met` was red at HEAD in a suite no other lane's
per-crate checks were running. The floor leg reads the tree on purpose — the only way
it can fail is that names were registered — which is exactly what happened. Found by a
full-workspace run, not by the per-crate checks, the same way the 343 -> 345 tablet
twin above was found.

**What landed:** `commands::local_payment::get_payment_gateway_config_scoped`,
`list_payment_gateways_scoped`, `set_payment_gateway_config_scoped` and
`delete_payment_gateway_scoped` — four names, and nothing else.

**Attributed by measurement, not by the red message.** The pre-raise assertion reported
`left: 481, right: 485`, and the four `+` lines in that commit's `lib.rs` diff are
exactly the four names above, so the delta and the cause agree. That check matters
because the pin's remedy — raise the floor to the measured number — is the same action
whether four names landed or the sweep stopped parsing; only the diff distinguishes
a real registration from a broken harness, which is the failure the leg's own doc warns
about in its first assertion.

**All four arrive GATED**, so as in the 475 -> 481 step above no ceiling and no ledger
row moved: regenerating the ledger rewrote only `REGISTERED_TOTAL` and left the debt
rows byte-identical. This pass records what landed; it does not approve it.

**The tablet floor (345) is NOT affected** and was checked rather than assumed: that
commit touched the desktop `lib.rs` only, and
`cargo test -p kasirmu-mobile --lib registration_gate` is green at 345. Recorded so the
desktop-vs-tablet twin scan is not needed here — unlike the 343 -> 345 entry above,
where the same commit moved both.

**Verified:** `cargo test -p kasirmu-app --lib commands::registration_gate_tests` → 14
passed. `cargo test -p kasirmu-mobile --lib registration_gate` → 12 passed, floor
unchanged.


## 2026-10-07 — The desktop registration floor lagged by eight, and three of them were real debt (`kasirmu-app` / `kasirmu-mobile`)

Found by re-running the gate the two shells carry rather than trusting the file that
describes it. **Both floors were red on committed code and neither was in-flight** —
which is the state that makes a gate finding actionable rather than someone else's edit:
`git status --porcelain -- apps/desktop-tauri/src/lib.rs apps/mobile-tauri/src/lib.rs`
was empty.

**The tablet was already fixed and the desktop was not.** `806a443d3` (2026-10-07 19:59,
*chore(mobile): graduate device identity plan and align gate registration floor*) raised
`REGISTERED_FLOOR` 413 -> 419 and named all six additions in its own comment — the ritual
the failing assertion asks for, done properly. The desktop twin was left at **486** while
`lib.rs` registered **494**.

**The eight, with provenance — five gated, three not:**

| name | arrived in |
|---|---|
| `edc::edc_inquiry` | `656f109a0` |
| `edc::edc_settle`, `hardware::print_edc_settlement_slip_scoped` | `fbf2b35d5` |
| `fiscal::issue_tax_invoice_scoped`, `fiscal::get_sale_statutory_number_scoped` | `859d5d44b` |
| `health::export_diagnostics` | `bf8e004f9` |
| `health::record_crash_report` | `f25a91e7c` |
| `health::get_storage_health` | `9d46d3912` |

**What makes this step different from every one recorded above it.** The floor comment's
own history is a run of *"all N arrive GATED, so this step touches the floor alone: there
is no new debt to record, only new registrations to count."* That is not true here. The
three `health::` names arrive **ungated** — `get_storage_health` and
`record_crash_report` as `no_session_resolution`, `export_diagnostics` as
`resolves_session_names_no_permission` — so the same sweep that moved the floor also had
to move a **per-state ceiling**, which is the first time this file has spent debt headroom
while raising the count. The ledger went **68 -> 71 rows** against `DEBT_CEILING` 78.

**Measured, in the failing assertion's own words:** `measured 53 no_session_resolution
(ceiling 51) and 18 resolves_session_names_no_permission (ceiling 27)`. So
`NO_SESSION_RESOLUTION` 51 -> 53, and **class 2's pin was deliberately left at 27** because
its own measurement FELL to 18. Forcing the two back to a `51 + 27 = 78` sum would mean
raising a ceiling for a class that had shrunk — the opposite of what this ratchet exists to
do. The honest partition is now `53 + 18 = 71`, the live row count.

**Regenerated, not typed.** The ledger first got a hand-edit and it was reverted
byte-identical to HEAD (`3f4e92e1e1eae87b435d244cd9695ce8e34c98c2`) before doing it the
supported way: `KASIRMU_REGENERATE_GATE_LEDGER=1 cargo test -p kasirmu-app --lib
drift_pin_generated_ledger_is_the_sweeps_own_output` → *"regenerated …: 71 debt row(s),
registered total 494"*. That command rewrites the rows and `REGISTERED_TOTAL` but **not**
the two per-state pins — its own comment says they are "a pin the generator does not
recompute", which is why those two move by hand in the same pass.

**Verified:** `cargo test -p kasirmu-app --lib registration_gate` → **14 passed, 0 failed**;
`cargo test -p kasirmu-mobile --lib registration_gate` → **12 passed, 0 failed**. Both were
red before this entry: the desktop at 10 passed / 4 failed, the tablet at 8 / 4.
