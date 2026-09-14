# Open Debt Program — four workstreams, four fences

<!-- Audit stamp: 2026-09-14 · DSH · status: NEW, UNEXECUTED (one measurement run) · authoring HEAD `257ff6122` on branch `0.0.39`, working tree carrying a peer session's 6 ` D` coder-N-journal.md plus ` M platform/core/src/database/migrations.rs` (neither mine, neither touched). Every anchor below was re-read in this checkout; every count was produced by the command printed beside it. Claims CARRIED from another document rather than re-measured here are labelled `[carried]` with the document and line named — nothing in this file is asserted on the strength of another doc's say-so without that label. · One command was RUN rather than cited: `cargo test -p oz-bridge --release` → 1231 passed / 76 failed, which reproduces `todo-refactor-oz-pos-app-agents-3.md:142`'s record on both axes (see Phase 1). No other test command was executed, so no green in this file is a green this pass observed. · Scope note: this is the FIRST plan doc in this repo written as ONE file covering FOUR workstreams, which deviates from the established one-workstream-per-file pattern (`todo-refactor-<area>-agents-N.md`). The deviation is deliberate and its consequence is stated under "Why this file is one document"; per AGENTS.md §4 nothing about the naming is load-bearing beyond the `todo-` token. -->

**Document:** `todo-open-debt-program.md`
**Role:** Program order — four independently dispatchable workstreams
**Goal:** Close the four debts the repository's own records already name as unfinished, in an order that respects their real dependencies, without inventing scope and without quoting a rotted number.
**Acceptance:** per phase, its own named command. AGENTS.md §4 governs the rename: a `done-` prefix is earned ONLY when that phase's acceptance command has been RUN and PASSED, and renames happen **in place at the repo root** — never into `.agents/archived/`.

---

## Why this file is one document

The owner asked for a single `todo-*.md` covering all four workstreams. Four consequences follow, and they are recorded rather than hidden:

1. **Each phase carries its own owned-path fence and its own commit-subject prefix.** Two phases can therefore run concurrently, and a worker must never edit outside its phase's fence.
2. **The phases are not equally ready.** Phase 1 and Phase 2 are executable now. Phase 3 is executable but contains one item that needs a product ruling before code. Phase 4 is *mostly blocked on inputs the repository does not have* — that is the honest finding, and it is the reason Phase 4 is last.
3. **Splitting is cheap if the owner prefers parallel files.** Cut on the `## Phase N` headings into `todo-open-debt-agents-N.md`; the fences already partition the tree, so no cross-file coordination is lost. Do not split by *task* — only by phase.
4. **The program-level acceptance is not a command.** There is no single gate that can see all four. Each phase's acceptance is its own; a green Phase 1 says nothing about Phase 2.

---

## Program rules — binding on every phase

### Hard repo rules (restated because a worker reads THIS file, not `AGENTS.md`)

- **NEVER create a branch. NEVER switch a branch. NEVER push.** This program runs on whichever branch is already checked out (authoring branch: `0.0.39`). A push to `main` runs CI *and* deploys.
- **NEVER `git add`, `git stage`, `git commit -a`, `git commit --amend`, `git stash`.** The only permitted commit form is ONE line with an explicit pathspec: `git commit -m "<type>(<area>): <subject>" -- path/one path/two`. A *new* file needs the one-call chain (`git add -- new/one && git commit -m "..." -- new/one`) and nothing else.
- **Version is locked at `0.0.39`.** Do not touch a version string anywhere.
- **`cargo fmt --all` is FORBIDDEN** in this checkout — it reformats other sessions' in-flight `.rs` files in the working tree. Format a single file with `rustfmt --edition 2024 <path>` if you must.
- **Forward slashes in every path argument.**
- **Money is `i64` minor units via `Money`. Never `f32`/`f64`.**
- **SQLite writes go through an explicit `rusqlite` transaction.**

### The shared checkout

One worktree, several live agent sessions, one shared `HEAD` and one shared index. Consequences that have already bitten this repo:

- `git status` mutates `.git/index`; a killed status call can leave a stale `.git/index.lock` that fails *every* commit repo-wide. Check the lock's mtime and whether any `git`/`cargo` process is actually alive before removing it, and back the index up first.
- A `git commit` returning *"nothing to commit, working tree clean"* when you expected otherwise does **not** mean your work is lost. Run `git show --stat HEAD` before concluding anything.
- Files may be **mid-write by another session** at the moment you read them. A test failure observed during a concurrent-agent window must be re-run before it is reported as a verdict. This exact trap produced a false vitest failure on 2026-09-14 (55 s after the run, a peer edited the failing file).

### Measurement discipline — a claim is its command

When you write a number into a doc, the command printed beside it must be run VERBATIM and must print that number. An equivalent command you chose yourself is not a substitute: `ls ui/src/__tests__/* | wc -l` prints 575 while the correct count is 572, because `ls dir/*` emits a per-subdirectory header and omits dotfiles that `find -type f` counts. *(Recorded as rule D7 in `.agents/manager-wave4-rules.md`, added 2026-09-14 after a review finding.)*

Corollaries this program depends on:

- `git ls-files` answers *"is it tracked today"*, never *"did it ever exist"*. Use `git show <sha>:<path>` for history.
- A grep of one file is evidence about one file. Before writing "only in X", grep the tree.
- **Do not trust an audit stamp's numbers.** Stamps are point-in-time records by this repo's own convention, and several quoted in this file have rotted since they were written. See "Claims that have rotted".

### Counting method for checkbox census

Any box census you write must state its method, because two defensible methods disagree:

```bash
grep -c  '^- \[ \]' <file>            # unindented boxes only
grep -cE '^[[:space:]]*- \[ \]' <file>  # any depth, including nested boxes
```

This file uses the **any-depth** form and says so where it quotes a number.

---

## Phase 1 — The release profile is red and no gate can see it

**Fence:** `crates/oz-bridge/src/**`, `crates/oz-core/src/**`, the release-path runners (`scripts/check.sh`, `scripts/check.ps1`, `scripts/coverage.sh`, `scripts/coverage.ps1`, `scripts/release.sh`, `.github/workflows/release.yml`).
**Commit prefix:** `test(oz-bridge):` · `fix(oz-bridge):` · `test(oz-core):` · `ci(release):`
**Acceptance:** `cargo test -p oz-bridge --release` → **0 failed**, plus a runner that can see this failure set.

### The debt

`cargo test -p oz-bridge --release` does not pass, and **no runner in this repo builds these crates in release**, so nothing reports it.

| Figure | Value | Source |
|---|---|---|
| release result, **measured at authoring HEAD `257ff6122`** | **1231 passed / 76 failed / 0 ignored**, `finished in 181.69s`, command wall time 5m49s including the release compile | **run this pass** — `cargo test -p oz-bridge --release`, result line verbatim |
| release result, earlier record | 1228 passed / 76 FAILED / exit 101 | `[carried]` `todo-refactor-oz-pos-app-agents-3.md:142`, a dated record of one real run |
| debug result | 1305 passed / 0 failed | `[carried]` same |
| release test in `scripts/check.sh` | `grep -c -- --release scripts/check.sh` → **0** | `[carried]` same, re-run 2026-09-14 |
| release test in CI | `dev-ci.yml:244` is `cargo nextest run --workspace --all-features` — no `--release` | measured this pass |

**The re-run confirms the earlier record on both axes, and the confirmation is the interesting part.** The predicted values were 1228 + 3 = **1231 passed** and **76 failed, unchanged**; the measured values are exactly that. So:

- The **failure count did not move** — nothing has landed since the record that adds or removes a release-only failure.
- The **passed count moved by exactly +3**, which is `68e6dd356`'s three `#[tokio::test]` cases, exactly as the record predicted.
- **The per-module breakdown reproduces exactly** — subscription 21 · auth 18 · audit 11 · pos 7 · staff 6 · workspaces 5 · inventory 4 · terminals 2 · locations 2 = 76. (Counted from the failing-test name list, which the runner truncates to the tail; the 20 names not shown are the audit 11 plus the remaining auth 9, which is what makes the visible 56 sum to 76.)

**One observation the classification task must handle, and it crosses into Phase 3.** Among the failures are the *scope* tests: `subscription::subscription_tests::verdict_scope_clears_inside_the_assigned_location`, `…verdict_scope_denies_when_the_assignment_excludes_the_session_location`, `…verdict_scope_denies_when_the_workspace_dimension_excludes_the_session_type`, plus `workspaces::workspaces_tests::scoped_assignment_branch_dimension_denies_out_of_scope_store_for_session`, `…scoped_assignment_filters_session_workspace_listing`, `…scoped_assignment_workspace_dimension_filters_for_store_listing`. **Phase 3's branch/workspace scope surface is currently red in release.** The likeliest cause is the same sentinel fixture dishonesty (these tests need a verifying signature), which would make it Phase 1's problem rather than a scope-logic defect — but that is a hypothesis, not a finding. Classify it before Phase 3b writes anything against that surface.

**Environmental note, not a repo defect:** the build's stderr carried a sandbox security-policy block on `wmic.exe` and `reg.exe`. The release build and the whole test run completed regardless, and the result is consistent with the prior record, so the block is recorded as an environment characteristic of this sandbox rather than a cause of anything.

Failure families, `[carried]` from the same record and **not** re-classified by the re-run above: 39× `InvalidSubscriptionSignature … Invalid symbol 95, offset 9`; ~16× `assertion left == right`; ~10× `PermissionDenied("audit log requires the Premium plan or above (current tier: Free)")`. The re-run confirms the *counts*; it does not confirm the *causes*, which is the classification box below.

### What is already established — do not re-derive

- **The 39 base64 reds are a test-fixture defect, not a broken signature path.** `crates/oz-core/src/license_verification.rs:391-394` returns `Ok(())` for the sentinel `BOOTSTRAP_FREE` under `#[cfg(debug_assertions)]` only; in release the same string reaches a standard base64 decode at `:398` and fails on the `_` in the sentinel's own text. Producer and consumer alphabets agree (`apps/license-server/main.go:1113` `base64.StdEncoding.EncodeToString`), and a forged non-sentinel signature still fails closed in BOTH profiles. `[carried]`
- **The sentinel is also the production seed.** `crates/oz-core/migrations/20260813_init.sql:1512-1514` writes `BOOTSTRAP_FREE` into every fresh install; the PG twin repeats it at `20260813_init.pg.sql:2100-2101` and is **generated** by `scripts/generate-pg-migration.py`, never hand-edited. Activation rewrites the row (`crates/oz-bridge/src/license.rs:175` → `crates/oz-core/src/license_verification.rs:625` `INSERT OR REPLACE`), so an activated install never sees the sentinel. `[carried]`
- **The 1305 → 1304 gap is one `#[test]` compiled out of release**, not a miscount: `crates/oz-bridge/src/sync_tests.rs:35-37` is `#[cfg(debug_assertions)]`. `[carried]`
- **The both-profile assertion idiom already exists here and is proven to fail.** `crates/oz-core/src/db/audit_security_tests.rs:418` (`assert_eq!(recorded, cfg!(debug_assertions))`) and `crates/oz-bridge/src/subscription_tests.rs:26/39-48`, with `crates/oz-bridge/src/license_tests.rs:475-479` as its first use inside `oz-bridge`. So the absence of such an assertion at a site is a coverage gap, not a language limitation. `[carried]`

### Tasks

- [x] **Reproduce and record.** `cargo test -p oz-bridge --release` at HEAD `257ff6122` → **1231 passed / 76 failed**, `finished in 181.69s`. Reproduces the earlier record exactly (see the table above). Done in this pass; the numbers are in "The debt".
- [ ] **Classify each of the 76.** Per failing test, decide (a) *fixture is profile-dishonest* — it seeds the sentinel and asserts a debug-only outcome, or (b) *genuine profile difference*. The count 76 must not be "corrected" by a passing test: a test that passes in both profiles lands in `passed` and cannot move the failure count.  RE-SCOPED, not done. The per-test arm now sits downstream of ONE root cause the owner page carries as **item 14, "Is a seeded sentinel debt at all if no CI leg ever compiles the profile that rejects it?"** (`docs/plans/notes.md:1380`), and the population is stated there as 368 test-shaped sites rather than 76 independent failures. Box stays open: the classification verdict table was never written.
  - Start with the six scope tests named above — they are the ones Phase 3b will build on.
  - `crates/oz-bridge/src/locations_tests.rs:147-148` is a worked example of the failure mode in the other direction: *"Plus is used instead of Free because debug builds upgrade only the bootstrap Free tier"* — i.e. the author routed AROUND the bypass rather than asserting it in either profile.
- [ ] **Close the one bypass still unreachable under test: `crates/oz-bridge/src/locations.rs:231-236`.** All three calling tests currently die one line earlier at `:227` `sub.verify_signature()?` on the sentinel. Determine whether a release-side assertion is reachable at all; **if it is not, record it as a parked arm beside `license.rs:670-683` rather than weakening production or faking a test.** Do not apply a shared bootstrap/Free helper to the ~21 token-required sites — that would convert a loud forged-row error (pinned in both profiles at `crates/oz-bridge/src/auth_tests.rs:400-402`) into a silent Free run.  ANCHORS HOLD, live: `crates/oz-bridge/src/locations.rs:231-236` is still the `#[cfg(debug_assertions)]` tier swap ahead of `store.enforce_location_quota(&tier)?` at `:237`, and `crates/oz-bridge/src/sync_tests.rs:35-37` is still `#[cfg(test)]` + `#[cfg(debug_assertions)]`.
- [ ] **Fix the profile-dishonest fixtures** using the existing both-profile idiom, so each assertion is true in debug AND release rather than weakened in one. Prove each fix is *failable*: mutate the line, confirm the opposite profile goes red, restore.
- [ ] **Decide `crates/oz-bridge/src/sync_tests.rs:35-37`.** Either it should run in release (drop the `cfg`) or the doc should stop presenting the debug/release total gap as unexplained.
- [ ] **Add a `--release` runner.** The recorded options are `scripts/release.sh:62,65` and `.github/workflows/release.yml:149` — note both currently carry `--exclude oz-pos-app --exclude oz-pos-tablet`. Do **not** drop those excludes on the strength of a green debug run. A cheap alternative that satisfies "some gate can see it" without touching the release path is a dedicated release-test step in `dev-ci.yml` or `scripts/check.sh`.  STILL A LIVE DEFECT, re-measured tonight: `git grep -n -e '--release' -- .github/workflows/dev-ci.yml` → NOMATCH, and the three recorded runners still exclude by crate — `scripts/release.sh:62,65`, `.github/workflows/release.yml:149` and `scripts/check.sh:106` each carry `--exclude oz-pos-app --exclude oz-pos-tablet` with no `--release`. No leg compiles the profile that rejects the seed.
- [ ] **Owner ruling required — the parked arm.** `crates/oz-bridge/src/license.rs:670-683` (expired past grace → `is_active: false` + `Expired`) cannot be executed from this crate: reaching it needs a payload whose signature verifies, and `license_verification.rs:36` embeds only the public half. Both ways to cover it change production (an injected verifier on the call path, or a `#[cfg(test)]` key compiled in). **Recommendation on record: leave it parked rather than weakening production to make a test reachable.** Get the ruling; do not decide it in a worker lane.  STILL PARKED, anchor verified at `crates/oz-bridge/src/license.rs:670-673` (`#[cfg(not(debug_assertions))]` → `is_active: false`). Blocked on the ruling named in this row, not on code.
- [ ] **Commit milestones** — one per logical step, e.g. `test(oz-bridge): assert the location-quota bypass in both build profiles`.
  - **2026-09-15, docs audit at HEAD `460e33285`:** NOT WORK. The box restates a rule that already binds every worker (`AGENTS.md` §3, one pathspec commit per logical step; this file's own Program rules at `:23`) — it can be neither done nor undone, so it is counted here as not-work rather than as a debt.

### Why this phase is first

It is the only one of the four where the repository is **already failing a command**, and its blast radius includes Phase 2: the failure is *live* on the tablet shell, which registers zero license commands (`grep -c license apps/tablet-client/src/lib.rs` → **0**, measured) and has no licence gate in `ui/src/frontend/shell/tablet/TabletAppShell.tsx:64-84`. `[carried]` Reachable today only via a hand-built release APK, because `android.yml`/`ios.yml` are `.bak` and no live workflow builds mobile.

---

## Phase 2 — Tablet ↔ desktop wire parity

**Fence:** `apps/tablet-client/src/**`, shared DTOs under `crates/oz-bridge/src/**` (additions only — never change a desktop-side wire shape without a back-compat alias).
**Commit prefix:** `refactor(tablet):` · `test(tablet):` · `refactor(bridge):`
**Acceptance:** `cargo check -p oz-pos-tablet` clean · `cargo test -p oz-pos-tablet` green · `python scripts/verify-ipc-parity.py` → `IPC parity: OK`.

### The debt

Desktop and tablet each declare their own argument structs for the same commands, and the divergence class is **not hypothetical**: the two most recent slices of this work each found a live wire bug.

- T2 (`7a7c1c3dc2`) — void/browser/scale contracts shared; closed a tablet-only wire bug where the UI sends camelCase `args: { saleId, reason }` while the local `VoidSaleScopedArgs` was snake_case-only.
- T3 (`e821c2814b`) — regional + `local_payment` DTOs shared; closed a **three-shell** wire bug dating to slice 6 where `LocalPaymentRailArgs` declared `rename_all = "camelCase"` on desktop, bridge and tablet while the only UI caller has always sent snake_case, so the settings card's save never worked against a real backend. Fixed with back-compat aliases plus the first wire-deserialization tests.

The pattern is **2-for-2 on finding hidden casing bugs**, which is the justification for doing the audit before the next domain rather than after.

### Measured scope

| Measure | Command | Value |
|---|---|---|
| tablet command modules | `ls apps/tablet-client/src/commands/*.rs \| wc -l` | 98 |
| tablet-local `*Args` structs | `grep -rn "^pub struct [A-Za-z]*Args" apps/tablet-client/src/commands/*.rs \| wc -l` | **54** |
| tablet re-exports from the bridge | `grep -rn "pub use oz_bridge" apps/tablet-client/src/commands/*.rs \| wc -l` | **11** |
| bridge `*Args` structs | `grep -rn "^pub struct [A-Za-z]*Args" crates/oz-bridge/src/*.rs \| wc -l` | 103 |
| tablet registered commands | `[carried]` `todo-refactor-oz-pos-app-agents-3.md:121` | 322 in `apps/tablet-client/src/lib.rs:445-784` |

The 54 locally-declared structs against 11 already shared is the audit's working set. It is an **upper bound on candidates, not a defect count** — some tablet structs are legitimately tablet-only.

**Reference implementations to copy:** `crates/oz-bridge/src/local_payment.rs:30` (`LocalPaymentRailArgs`) and `crates/oz-bridge/src/void.rs:33` (`VoidSaleScopedArgs`), with the tablet side re-exporting at `apps/tablet-client/src/commands/local_payment.rs:25` (`pub use oz_bridge::local_payment::LocalPaymentRailArgs;`). The wire-deserialization test shape is in `crates/oz-bridge/src/void_tests.rs:66-92`.

### Tasks

- [ ] **Wire audit first, per domain, before moving any DTO.** For each of `pos`, `staff`, `auth`, `products`, `settings`: diff the tablet-local struct against the bridge's for the same command and record, per field, (a) same name, (b) different name, (c) **different serde rename strategy**. Class (c) is the bug class; class (b) is the next most likely. Publish the audit as a table in this file or in a sibling journal — the audit is the deliverable, the refactor is the follow-up.
  - Cross-shell caution: `settings` registers **28** commands on tablet vs **19** on desktop `[carried]`, so never quote one settings count for both shells.
- [ ] **Then share the DTOs, one domain per commit**, following the T2/T3 pattern: bridge owns the type, the tablet re-exports it, a back-compat alias carries the old spelling, and a wire-deserialization test pins the frontend's actual payload.
- [ ] **Decide the `AppState` → `BridgeCtx` seam.** Measured field-by-field and deferred: 7 of 14 fields match; `Arc`-ing `db`/`terminal_id` is mechanical; `plugins` would drag the `mlua` Lua VM into the Android APK for a forever-`None` field. `[carried]` This needs a Phase-1-fence decision on the bridge side before it can move.
- [ ] **Keep the parity gate green at every step.** `python scripts/verify-ipc-parity.py` and `bash scripts/verify-scoped-coverage.sh` both read the registration macros verbatim; a DTO move that changes a registered path breaks them.
- [ ] **Commit milestones** — e.g. `refactor(tablet): share the pos wire contracts with oz-bridge`.
  - **2026-09-15, docs audit at HEAD `460e33285`:** NOT WORK — same reason as the Phase 1 milestone box: it names a commit form, not a defect.

### Interaction with Phase 1 — do not run these two blind

The tablet shell is where the release-profile rejection is live, and it registers **zero** license commands. A Phase 2 worker adding tablet command registrations touches the surface a Phase 1 worker is trying to make testable. Sequence Phase 1's classification task first, or keep the two fences strictly disjoint.

---

## Phase 3 — Gate on the permission vocabulary, not on a role rank

**Fence:** `ui/src/utils/role.ts`, `ui/src/features/workspaces/WorkspaceHome.tsx`, `ui/src/features/settings/SettingsPage.tsx`, and — for the scope axes — `crates/oz-core/src/db/staff.rs`, `crates/oz-bridge/src/subscription.rs`, plus a new migration if the design requires one.
**Commit prefix:** `refactor(ui):` · `feat(rbac):` · `docs(rbac):`
**Acceptance:** `cd ui && npx vitest run` green · `cargo test -p oz-core` green · `python scripts/verify-ipc-parity.py` → `IPC parity: OK` · `bash scripts/lint-i18n.sh` clean if any `.ftl` key is added.

### 3a — The ruling already made, and the two code shapes it contradicts

**Ruling (2026-09-14): stop asking a role name for a rank.** Gate the Tools section on the permission vocabulary like every other gate, instead of `WorkspaceHome.tsx:363`'s `ROLE_HIERARCHY[roleName] ?? 0`.

The doctrine is already written into the bridge. `crates/oz-bridge/src/subscription.rs:238-241`:

> *The registry permission whose holding decides the verdict's `role` axis, per feature. Permissions are the vocabulary (ADR #47 stop_memo ruling A2): no rank map is invented, and a custom role holding the gate permission passes the same way a preset would.*

`gate_permission()` at `:241` is the established pattern, including its non-obvious consumer: `AvailabilityFeature::Locations | PosInstances` both map onto `permissions::TOPOLOGY_WRITE`.

Against that, the UI has a rank map in two places:

| Site | What it is |
|---|---|
| `ui/src/utils/role.ts:37` | canonical `ROLE_HIERARCHY`, with `roleAtLeast()` at `:70-74`; consumed by `SettingsPage.tsx:10`, `RoleBadge.tsx:9`, `RoleIcon.tsx:6` |
| `ui/src/features/workspaces/WorkspaceHome.tsx:97` | a **duplicate** of the same table, acknowledged in `role.ts:32-35` as *"a recorded follow-up — that file is out of scope for this change and stays untouched, so the duplication is known and temporary rather than accidental"* |

Rank-based gates in `WorkspaceHome.tsx`, all measured this pass: `:363` (`roleLevel`), `:372` (`canAddWorkspace`), `:378` (`canAccess`), `:414` (`canSeeTools`).

Supporting fact, read this pass: the `roles` table (`crates/oz-core/migrations/20260813_init.sql:571-578`) declares exactly `id, name, description, permissions, created_at, updated_at` — **no parent/clone column**, so "inherit the cloned preset" is not expressible without a migration.

### 3b — The two scope axes that do not exist

`require_permission_scoped` already evaluates **branch and workspace** scope on the write path — `crates/oz-core/src/db/staff.rs:229`, doc comment `:225-228` (*"the scope-aware gate (ADR #35 D5 / spec 0048): … plus the assignment's branch/workspace scope is evaluated for scoped assignments"*), refusal at `:243-245`. The same axis reaches the availability resolver as a first-class fact (`crates/oz-core/src/entitlements.rs:234-235`, `:247`, `:262`; `crates/oz-core/src/availability.rs:395` `let scope_denies = facts.scope_granted == Some(false);`). `[carried]`

**What remains is organisation-wide and terminal-level scope, and nothing evaluates either.** `[carried]` `todo-tools.md:443`, whose own closing note says this *"needs its own `todo-` order"* — which is this phase. Note that ADR #35 D5 (`docs/decisions/2026-08-11-adr35-rbac-role-assignments-user-profile.md:104`) and spec 0048 (`docs/specs/_done/0048-rbac-assignment-model-and-taxonomy/`, §8 non-goals) both **defer** the org-tenant layer to D7. So this is not unfinished work from 0048; it is work 0048 explicitly declined, now being picked up.

### Tasks

- [ ] **3a.1 — Fold the duplicate rank table.** `WorkspaceHome.tsx:97` onto `ui/src/utils/role.ts:37`, closing the follow-up recorded at `role.ts:32-35`. Pure refactor; the settings-page gate (`SettingsPage.tsx:10`) is the regression surface.  ANCHOR MOVED, DEBT LIVE — a second instance of the defect this file corrects for Phase 4. The row spells the file `WorkspaceHome.tsx`; at this HEAD it is `ui/src/features/workspaces/WorkspaceHome.tsx` (plural directory) and `:96-98` is a comment about the Tools catalogue, not a rank table. `git grep -rn -E 'ROLE_HIERARCHY|roleAtLeast' -- ui/src` → 44 hits, so the second vocabulary still stands.
- [ ] **3a.2 — Replace the rank comparisons with permission checks.** One gate at a time (`:363`/`:372`/`:378`/`:414`), each with a test that pins a **custom role holding the gate permission passing the same way a preset would** — that is the property the doctrine exists to protect, and a test that only covers presets does not pin it. `WorkspaceHomeTools.test.tsx` (9) + `WorkspaceHomeTools.navParity.test.tsx` (2) + `pageRegistry.test.ts` (28) are the existing parity surface — **39 tests across 3 files**, a figure recorded as *run* in an earlier pass on 2026-09-14, not re-measured here. Re-run them before relying on the number.
- [ ] **3a.3 — Decide the fate of `roleAtLeast` / `ROLE_HIERARCHY`.** If nothing needs a rank after 3a.2, delete them rather than leaving a second vocabulary in place; `ui/src/__tests__/role.test.ts:2` is the test that has to change with them.
- [ ] **3b.1 — Design doc first, no code.** Organisation-wide and terminal-level scope needs its own design before any migration: which entity owns the organisation axis, how a terminal-scoped assignment resolves at the enforcement boundary (ADR #4 keeps store data in per-store DBs while roles live in the global identity DB), and what "explicit `all`" means on each new axis. Treat the design doc as the deliverable for this box — a worker that writes a migration without it is inventing the axis the owner has not ruled on.
- [ ] **3b.2 — Implement only after 3b.1 is accepted.** Migration + evaluation + gate wiring + tests, following the `assignments` precedent from 0048 cycle 1.
- [ ] **Small adjacent defect, fix while in the file.** `WorkspaceHome.tsx:561` accepts only keys `1`–`9` (`if (e.key >= '1' && e.key <= '9' && …)`), but the hint renders `Press {idx + 1} to open` uncapped — `<Localized id="workspace-home-shortcut-hint">` opens at `:860`, the text is at `:861` — so a card past index 9 advertises a shortcut that does nothing. Either cap the hint or extend the handler; pick one and pin it with a test.
- [ ] **Commit milestones** — e.g. `refactor(ui): gate the workspace tools section on the permission vocabulary`.
  - **2026-09-15, docs audit at HEAD `460e33285`:** NOT WORK — same reason; the thing this phase actually waits on is the 3b product ruling named in the row above.

### Why this phase needs a product ruling before 3b

Nothing about the organisation axis is inferable from the code: `roles` has no hierarchy column, the assignment tables carry branch and workspace dimensions only, and 0048's own non-goals section declined this layer. A worker that invents the axis will produce a migration the owner then has to reject.

---

## Phase 4 — Payment: the remainder is smaller than the master doc suggests, and mostly blocked

**Fence:** `crates/oz-payment/src/**`, `crates/oz-hal/src/drivers/edc/**`, `apps/cloud-server/src/payment_api.rs`, `apps/cloud-server/src/webhooks.rs`, `ui/src/features/sales/**`.
**Commit prefix:** `feat(payment):` · `refactor(payment):` · `docs(payment):` · `test(payment):`
**Acceptance:** `cargo test -p oz-payment` green · `cargo test -p oz-hal` green · `cd ui && npm run check:all` (see the gate list below) · `python scripts/verify-ipc-parity.py` → `IPC parity: OK`.

### Read this before reading `todo-payment.md`

`todo-payment.md` is a **research artifact written before the epic**, not a status surface. Its own sibling declares this outright (`todo-payment-agents-4.md:53-61`):

> *This document is the single status authority for the payment epic, and the per-item verdicts in this section — the R1–R7 headings with their own CLOSED/OPEN lines — are **CANONICAL**. … `todo-payment.md` is the research artifact, not a status surface.*

The master doc still shows **36 any-depth open boxes / 11 done** (`grep -cE '^[[:space:]]*- \[ \]' todo-payment.md` → 36; `…- \[x\]` → 11, measured this pass). **Those boxes are not a triage queue.** Roughly half have shipped under other commits than the order that planned them, and several were superseded by decisions the epic made on the wire. The epic closed as agents-1…3 plus `09eec83868`.

### The genuine remainder — R4 through R7

| Item | Status | What it actually needs |
|---|---|---|
| **R4** Multi-terminal EDC | OPEN | A **second real terminal** to exist. Single implicit terminal ships; `crates/oz-core/src/db/edc_terminals.rs:5` reads *"commands should take a terminal_id once more than one terminal is configured"* (read this pass). The interim default is an alias, not a design — `platform/startup/src/hardware.rs:203-212` says so in its own words: *"The alias is interim, not design: `edc_terminals` has no `is_default` column, so 'which terminal is this register's' is answered by creation order"* (read this pass). |
| **R5** Resilience cluster | OPEN | A **design doc first**. `crates/oz-payment/src/registry.rs:57-67` `build_from_config` is a documented PLANNED stub failing closed; no `method -> Vec<processor>` chain, no `ResilientProcessor`, no expiry/reconciliation job. Largest remaining slice, cloud + crate blast radius. `[carried]` |
| **R6** Evidence debt | OPEN | **Credentials and a merchant account, not code.** Sandbox probe for generic-QR interop, targeted-QR restriction, refund behaviour, per-merchant acquirer activation. `[carried]` |
| **R7** No real EDC hardware driver | OPEN | **Real hardware or vendor protocol documentation.** Every layer of the EDC chain shipped except the one that touches money-holding hardware. `[carried]` |

### The honest conclusion about this phase

**Three of the four items cannot be started by a coding agent from this checkout.** R4 waits on hardware, R6 waits on credentials, R7 waits on hardware or vendor docs. Only R5 is code-workable, and it requires a design pass before its first box. Phase 4's real deliverable is therefore **documentation and a decision record**, not code — and it is sequenced last for that reason. Do not dispatch a lane to "work the payment backlog": the backlog is not the list of open boxes.

### Anchor correction — the EDC stub paths are recorded without their crate

`todo-payment-agents-4.md:137-139` cites `drivers/edc/wired.rs` (112 lines), `wireless.rs` (132) and `protocol/{pax,ingenico,verifone}.rs` (46 lines each). **Those paths are correct only relative to `crates/oz-hal/src/`.** Measured this pass:

```bash
wc -l crates/oz-hal/src/drivers/edc/wired.rs crates/oz-hal/src/drivers/edc/wireless.rs \
      crates/oz-hal/src/drivers/edc/protocol/{pax,ingenico,verifone}.rs
#  112 / 132 / 46 / 46 / 46   ← the line counts reproduce exactly
```

`crates/oz-payment/src/drivers/` contains `mock.rs`, `paddle.rs`, `qris.rs`, `square.rs`, `stripe.rs` — **no `edc/` and no `protocol/` directory**, and `grep -rn "HalError::Unsupported" crates/oz-payment` → **0**. The stubs moved into `oz-hal` during the HAL unification; `crates/oz-hal/src/drivers/edc/wired.rs:2` says so in its own header: *"moved in from oz-payment during the HAL unification"*. A worker who greps the recorded path finds nothing and may conclude the stub is gone. Both files fail closed with `HalError::Unsupported` (2 occurrences in `wired.rs`, 2 in `wireless.rs`, 1 in `pax.rs`, measured).

### Tasks

- [x] **Triage, not implementation.** Re-run the agents-4 method — every open box in `todo-payment.md` re-tested with `git grep` against the code — and produce a fresh verdict table. The prior pass's own recorded limit is instructive: *"A box-by-box audit of claims catches lies; it does not catch true-but-misleading summaries"* — R7 was invisible to the checkbox pass and was found only by reading a stub's doc comment. Read the code, not the boxes.
  - **CLOSED 2026-09-15 (`08b11846e docs(payment): close the nine boxes the code already implements and name the twenty-one parked`, `todo-payment.md` only, +22/-14), and re-counted here rather than by that subject line: at HEAD `460e33285` `todo-payment.md` reads 30 open / 20 ticked by BOTH counting forms.** The verdicts were written per row inside `todo-payment.md` instead of as a separate table, which is what this box asked for in substance. What it does NOT settle, and stays open beside it: **R5 design doc** (no such file in `docs/plans/`) and the **R4/R6/R7 decision record**.
- [ ] **R5 design doc** (`docs/plans/`), covering the `method -> Vec<processor>` chain, `ResilientProcessor`, the breaker's `(tenant_id, gateway)` keying, and the expiry/reconciliation job. No code until accepted.
- [ ] **R4/R6/R7 decision record.** State each as blocked-on-input with the specific input named, so the next reader does not re-open them as "unknown". Include the correction above so the next anchor search starts in `oz-hal`.
- [ ] **Fix the anchor in `todo-payment-agents-4.md`** — add the crate prefix to the R7 paths. This is a one-line docs fix and it is the reason a worker would otherwise lose an hour.
  - **2026-09-15, docs audit at HEAD `460e33285`:** STILL UNFIXED, and its target is outside this fence — `todo-payment-agents-4.md:126` and `:137` still print `drivers/edc/wired.rs` / `wireless.rs` with no crate prefix. Reported here, not edited there: the file belongs to another lane, and the discipline two lanes used tonight applies (supersession recorded by title and path, other file untouched).
- [ ] **Commit milestones** — e.g. `docs(payment): correct the EDC stub crate in the remainder inventory`.
  - **2026-09-15, docs audit at HEAD `460e33285`:** NOT WORK — same reason, and the docs fix it follows is still unfixed (see the anchor row above).

### `check:all` — the gate list, stated from the file

`ui/package.json:11` is `"check:all": "node ../scripts/check-ui.mjs"`. `scripts/check-ui.mjs` runs **eight numbered gates** plus a manifest self-audit:

1. Lint (`:123`) · 2. TypeScript (`:126`) · 3. Unit tests (`:129`) · 4. i18n lint (`:132`) · 5. FTL dedupe (`:135`) · 6. Bundle budget (`:138`) · 7. E2E (`:141`, Docker-gated) · 8. Perf smoke (`:153`, skipped without Playwright browsers) — then the gate-manifest self-audit against `scripts/gates.json` (`:169`), which fails closed if a manifest `check:all` gate is not declared in the runner.

Two recorded traps for whoever runs it: the perf-smoke leg cannot pass inside a sandbox whose delete shim refuses Playwright's cleanup of `ui/test-results`, and that is an environment limit, not a repo defect; and the gate list is **eight + manifest**, not the five-step chain some documents still describe.

---

## Dispatch order and dependencies

```
Phase 1 (release red)  ──┬─→ must classify BEFORE Phase 2 registers more tablet commands
                         └─→ needs an OWNER RULING on the parked arm
Phase 2 (tablet wire)  ──→ independent of Phase 3; keep fences disjoint from Phase 1
Phase 3 (authz)        ──→ 3a executable now; 3b needs a design doc, then a ruling
Phase 4 (payment)      ──→ docs first; R5 design doc is the only code-adjacent deliverable
```

- **Phase 1 and Phase 3a can run concurrently** — disjoint fences, no shared file.
- **Phase 2 should follow Phase 1's classification**, not run alongside it: both touch the tablet surface that Phase 1's release failure is live on.
- **Phase 4 is last and mostly blocked.** Dispatch it only for documentation.
- **Nothing here authorises a push.** `dev-ci.yml:695` gates the deploy on `push` to `main` **or** to a `0.0.*` branch, and the `0.0.*` arm is currently inert only because `on.push.branches` lists `main` alone. Widening that list would make every release-branch push deploy to production.

---

## Claims that have rotted — do not quote these

Recorded because each one is still live in some document a worker might read, and each was re-measured this pass.

| Rotted claim | Where | Measured now |
|---|---|---|
| `PaymentModal.tsx = 2,436` lines | `todo-payment.md` audit stamp | **1,999** (`wc -l ui/src/features/sales/PaymentModal.tsx`; 89,855 bytes, trailing newline present). Was 2,436 at `ec2edf258` (`git show ec2edf258:… \| wc -l` → 2436) — the refactor campaign shrank it via `79d96f7c9` (cash tender panel extracted), `1583ff08b`, `e455e9d13` |
| box census `39 unchecked / 8 checked` | same stamp | **36 / 11** any-depth. The stamp's own claim that its counting method "equals `wc -l` here" was about line counts, not boxes |
| the master doc's open boxes are the work | same stamp + `## Phased TODO` | they are absorbed or superseded; `todo-payment-agents-4.md:53-61` declares R1–R7 canonical |
| `payment:qris-manual` / `:midtrans` / `:edc` feature keys | `todo-payment.md` Phase 0/2/3 | **never existed in code.** One occurrence repo-wide, and it is a comment saying so: `ui/src/features/sales/useLocalPaymentRails.ts:4` |
| `drivers/edc/*.rs` | `todo-payment-agents-4.md:137-139` | the files are real but live under `crates/oz-hal/src/`, not `crates/oz-payment/src/` |
| `.circleci/workflows/06-cargo-nextest.yml:37` | several plans | retired by `e3aff7b56` (2026-09-14); `git ls-files \| grep -c circleci` → 0. Use `git show e3aff7b56^:<path>` |
| "a push to `main` deploys" as a one-liner | older notes | still true, but incomplete — see `dev-ci.yml:695` |

---

## Out of scope for this program

- `todo-font-system.md` (5 open) · `todo-refactor-kds-agents-merged.md` (18 open) · `todo-refactor-pos-screen-agents-3.md` (21 open) · `todo-refactor-settings-agents-3.md` (11 open) — any-depth box counts, measured this pass. Each is its own plan; none is covered here.
- `todo-kds.md` is **superseded** by `todo-refactor-kds-agents-merged.md` and carries 0 boxes — do not treat its absence of boxes as completion.
- `todo-tools.md` and `todo-tools-agents-3.md` each hold one open box that their own retirement notes assign elsewhere: the org/terminal scope is Phase 3b here; `check:all` is Phase 4's acceptance surface.
- Anything requiring a push, a branch, or a version bump.

---

## Open items this file deliberately leaves open

- **The release-profile failure set is now measured, but not yet classified.** `cargo test -p oz-bridge --release` → 1231 passed / 76 failed at HEAD `257ff6122`, reproducing the earlier record exactly. *Why* each of the 76 fails is still open, and Phase 1's second box exists to close it.
- **The parked arm** (`license.rs:670-683`) needs an owner ruling. Named as a task, not decided.
- **The organisation scope axis** needs a design doc before a migration. Named as a task, not decided.
- **Whether this file should be split** into `todo-open-debt-agents-N.md`. Owner's call; the fences already support it.

---

## Box-count reconciliation (2026-09-15, docs audit, HEAD 9ab4e58da) — no historical number above is rewritten

Two places in this file state a box total beside a command that no longer produces it. The commands as written are correct in form; the numbers are stale. Re-measured with this file's own `:59` any-depth pattern, brackets backslash-escaped:

- `:227` states **36 any-depth open / 11 done** for `todo-payment.md`. Today: `grep -cE '^[[:space:]]*[-*][[:space:]]+\[ \]' todo-payment.md` -> **30**, and the same pattern with `\[[xX]\]` -> **20**. Six boxes were ticked after that line was written, which is the line's own success, and the `11 done` figure cannot be reproduced by any form now on the tree.
- `:307` states `todo-refactor-kds-agents-merged.md` **18 open**, `todo-refactor-pos-screen-agents-3.md` **21 open**, `todo-refactor-settings-agents-3.md` **11 open**, `todo-font-system.md` **5 open**. The canonical command returns **7**, **11**, **2** and **5** respectively. One of four reproduced; three did not, and the direction is not uniform — two overstate and one understates — so this is not one stale snapshot but a census nobody re-ran. The `5 open` for `todo-font-system.md` is the only one of the four that a reader may still trust, and only until the next tick.

Canonical pair, marker- and indent- and bracket-spacing-tolerant, for use in any brief or clause in this tree:

```bash
grep -cE '^[[:space:]]*[-*][[:space:]]+\[[[:space:]]\]' file.md   # OPEN boxes
grep -cE '^[[:space:]]*[-*][[:space:]]+\[[xX]\]'        file.md   # TICKED boxes (accepts [X])
```

Two traps these lines exist to close, both measured the same day: (1) **unescaped brackets are not literals in ERE** — `grep -cE '^- [ ] '` returns **0** on `todo-font-system.md`, which holds **5** open boxes, because `[ ]` is a bracket expression matching one space, so the pattern silently asks for hyphen-plus-three-spaces. A zero from that form is a regex artifact, never a harvest. (2) **anchoring the marker to column zero under-counts TICKED and only ticked** — `todo-refactor-oz-pos-app-agents-3.md` reads **22** with `^- \[[xX]\]` and **43** with the canonical line, because 21 of its boxes are indented sub-rows, while its open count is 4 either way (no indented or `*`-marker open box exists anywhere in the 19 root plans, so open counts are form-insensitive today and that is luck, not a property). A completion ratio computed from anchored numerators and any-depth denominators is wrong in both directions at once.

## Reconciled against what this tree closed — 2026-09-15 (docs audit at HEAD `460e33285`)

This section is the ledger read against tonight, not a new work list. Every number is a measurement taken this pass, grep and read only — no suite, no cargo, no build, no Docker.

- **This file's own census, by both forms the Counting method section names:** the any-depth bracket-class form `grep -cE '^[[:space:]]*[-*][[:space:]]+\[ \]' todo-open-debt-program.md` → **24 open** and its `\[[xX]\]` counterpart → **1 ticked**; the anchored form `grep -c '^- \[ \]'` → **24 / 1**. The two agree because this file has **no indented checkbox rows** — the only indented lines under a row are non-marker sub-bullets (`:107-108`, `:154`) — so the 22-row under-read that a plan with nested boxes suffers tonight cannot happen here. After this pass: **23 open / 2 ticked**, of which **4 are now marked NOT WORK**, leaving **19 rows that name a debt**.
- **Still a live defect (re-measured):** the `#[cfg(debug_assertions)]` tier swap at `crates/oz-bridge/src/locations.rs:231-236` ahead of `enforce_location_quota` at `:237`; `crates/oz-bridge/src/sync_tests.rs:35-37` still `#[cfg(test)]` + `#[cfg(debug_assertions)]`; the parked arm at `crates/oz-bridge/src/license.rs:670-673`; **no `--release` leg anywhere** — `git grep -n -e '--release' -- .github/workflows/dev-ci.yml` → NOMATCH, and `scripts/release.sh:62,65`, `.github/workflows/release.yml:149`, `scripts/check.sh:106` all carry `--exclude oz-pos-app --exclude oz-pos-tablet` with no release profile; Phase 2 has shared **nothing** since its own table (`git grep -rn -F 'pub use oz_bridge' -- apps/tablet-client/src/commands` → **11**, the same number the scope table records); the rank vocabulary is still standing (`git grep -rn -E 'ROLE_HIERARCHY|roleAtLeast' -- ui/src` → **44**); no R5 design doc in `docs/plans/`.
- **No longer describes what it was written against (disposed in place, no tick):** **Classify each of the 76** — the per-test arm sits downstream of one seed now, and the owner page carries the profiling question as **item 14, "Is a seeded sentinel debt at all if no CI leg ever compiles the profile that rejects it?"** (`docs/plans/notes.md:1380`) against a 368-site population, not 76 independent reds; **3a.1 — Fold the duplicate rank table** — the row spells the file `WorkspaceHome.tsx` while the tree has `ui/src/features/workspaces/WorkspaceHome.tsx` and `:96-98` is a comment, the same anchor class this file corrects for Phase 4; **Fix the anchor in `todo-payment-agents-4.md`** — still crate-less at `todo-payment-agents-4.md:126` and `:137`, and reported rather than edited because that plan is another lane's fence.
- **Now a debt on the owner page, not in the tree:** the release-profile question (item 14, above) and the **132 off-scale leading tokens** left when the leading-token programme closed 31 of 31 sites — owner page **item 10, "Is the leading scale a target the UI normalises onto, or an exception the literals are allowed to keep?"** (`docs/plans/notes.md:1352`). Neither is funded by a code path, so neither is a box here.
- **Carried in, not rows of this file:** the sheet guard registered 2 screens and 2 sections tonight and its `BASELINE_UNCITED` array went **54 → 23** `.css` paths (`ui/src/__tests__/screenExtraction.test.ts:1690`, counted by hand in the array), with two rows proved unclosable by citation — one sheet has no mount, the other is named only in prose; root-only fallback tails cleared or priced across three sweeps, **126 + 93 + 77**, the third still in flight in two shared sheets; the seeded-row refusal helper went from eight copies to one home with three sites still to fold; and four plans were reconciled, **two of which turned out to be a decision record and an audit rather than work lists, so their open boxes were never debts** — the same mistake the four NOT WORK boxes above were.

