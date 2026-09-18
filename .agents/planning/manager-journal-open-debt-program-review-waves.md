# Open Debt Programme — DISPATCH SCHEDULE (surviving scope: 11 boxes + 5 owner rulings)

Owner: `todo-open-debt-program.md` (384 lines at authoring, 27 open / 3 ticked). HEAD measured for this file:
`c93965f32`, branch `0.0.39`. Version locked. No branch, no push, no commits from this document.

**Supersedes the earlier draft of this file** (9 waves / 48 boxes), which was built before the ownership pass
settled. That draft scheduled 37 boxes this programme does not own. The dropped rows are kept below in §3 as
CROSS-OWNED with the rival doc and line, not deleted — the review needs the map.

## 1. Wave rules

- **W1 one owner per path.** No two boxes in the same wave name the same file. Read-only reach is not
  ownership; only paths listed in a FENCE are owned.
- **W2 one OWNING DOCUMENT per shared path per wave** (the collision rule). `scripts/check.sh`,
  `scripts/release.sh`, `.github/workflows/release.yml`, `.github/workflows/dev-ci.yml`,
  `crates/oz-bridge/src/**` and `apps/tablet-client/src/**` are claimed by BOTH this plan (`:68`, `:125`) and
  `todo-refactor-kasirmu-app-agents-3.md:113-123` + `:168`. A wave may touch those paths only while exactly one
  document is the owner for the whole wave; this programme owns them in W2 only for the ADDITION of a release
  test leg (`todo-operational-integrity.md:93` cedes it: "belongs to `todo-open-debt-program.md` Phase 1").
  Removing the `--exclude kasirmu-app --exclude kasirmu-tablet` pair is agents-3's box `:168` and must not share
  a wave, a commit, or a file-read with ours.
- **W3 the contract lane is one box at a time:** `scripts/gates.json` + `.github/workflows/dev-ci.yml` +
  `scripts/check.sh` + `scripts/check.ps1` + `docs/operations/ci-pipeline.md` + `AGENTS.md` +
  `.agents/AGENTS.md` + `.githooks/*`. Edited as one atomic box because `verify-ci-docs-drift.py`
  (`unrecorded_active_gates`, `hook_step_orphans`) and `verify-agents-mirrors.py` fail closed on a half-set.
- **W4 the migration chain is one box at a time and never concurrent** with another migration:
  `crates/oz-core/migrations/*.sql` + the registry `crates/oz-core/src/migrations.rs` (NOT the generic runner
  `platform/core/src/database/migrations.rs`) + the GENERATED `20260813_init.pg.sql`, regenerated with
  `python scripts/generate-pg-migration.py`, never hand-edited. **No box here writes a migration.**
- **W5 one owner per `crates/oz-bridge/src/**` file per wave.**
- **W6 rulings are not boxes** — §4 PARKED, never dispatched.
- **W7 shell.** Every ACCEPT is a Git-bash command. From PowerShell:
  `& 'C:\Program Files\Git\bin\bash.exe' -c '<cmd>'`. Bare `bash` is WSL and hangs; no ACCEPT below uses it.
  No ACCEPT runs a whole Vitest suite and none runs `npm run check:all` (a docs box cannot own 8 legs, two of
  which need Docker/Playwright). If a box adds a `.ftl` key it appends
  `& 'C:\Program Files\Git\bin\bash.exe' -c 'bash scripts/lint-i18n.sh'`.
- **W8 new files** use the one sanctioned chain:
  `git add -- <new> && git commit -m "<type>(<area>): <subject>" -- <new>`. **No new root `todo-*.md`** — that
  token is read by other lanes' triage and census passes (AGENTS.md §4); relocation targets live under
  `.agents/` until the owner rules otherwise (ruling P3).
- **W9 release runs** use `CARGO_TARGET_DIR=target-release` (ignored by `.gitignore:3` `/target-*/`, so a lane
  cannot pollute another's `git status`). Never `cargo fmt --all` (peer reformats); format a file with
  `rustfmt --edition 2024 <path>`.
- **W10 two-writer files, one answer:** every box in this schedule writes either a NEW file it names alone, or
  a file no other live plan's fence lists; the two rows that would have written `todo-payment-agents-4.md` are
  gone — that file is fenced by `todo-operational-integrity.md:173`, and its anchor fix is already committed
  (ruling-verified: `todo-payment-agents-4.md:126` and `:137` now print `crates/oz-hal/src/drivers/edc/...`).
  Where a plan doc must be written (`:todo-open-debt-program.md` deletions), it happens alone, in a wave where
  no other box names it.

## 2. Waves

### WAVE 1 — measure, then the three docs boxes and the bypass probe (4 boxes + 1 support row)
| wave | box | TASK (one outcome) | FENCE (exact paths, single owner) | ACCEPT | ROLE | BLOCKED-BY |
|---|---|---|---|---|---|---|
| 1 | S1 (support, not one of the 11) | Re-measure the release profile before anyone acts on a stale count: `docs/records/JOURNAL.md:11057` claims "the release-profile fixture campaign cleared every mechanical red", while this plan's `1231 passed / 76 failed` still stands in prose. One number, one date. | none (read-only) | `cd $(git rev-parse --show-toplevel) && CARGO_TARGET_DIR=target-release cargo test -p oz-bridge --release 2>&1 | tail -4` | tester | - |
| 1 | **B1 `:206`** | Design doc for the scope axis that is LEFT. The organisation half is **already shipped**, so the doc must say so and rule only on the terminal axis: which entity owns a terminal-scoped assignment at the enforcement boundary under ADR #4 (per-store DBs vs global identity DB) and what explicit `all` means. No migration, no code. | `docs/plans/terminal-scope-design.md` (new) | `test $(grep -cE '^## ' docs/plans/terminal-scope-design.md) -ge 4 && grep -c 'ScopeType::Organization' docs/plans/terminal-scope-design.md` | docs | - |
| 1 | **B2 `:261`** | R5 design doc: `method -> Vec<processor>` chain, `ResilientProcessor`, breaker keying on `(tenant_id, gateway)`, expiry/reconciliation job — written AGAINST the code a peer already has in flight, labelled in-flight, not as accepted design. | `docs/plans/payment-resilience-design.md` (new) | `test $(for w in 'method' 'ResilientProcessor' 'tenant_id' 'expiry'; do grep -c "$w" docs/plans/payment-resilience-design.md; done | grep -vc '^0$') -ge 4` | docs | - |
| 1 | **B3 `:262`** | R4/R6/R7 decision record: each stated as blocked-on-input naming the exact input (second real EDC terminal · sandbox credentials + merchant account + per-merchant acquirer activation · hardware or vendor protocol docs), so nobody re-opens them as "unknown". Reads `todo-payment-agents-4.md`; writes only its own file. | `docs/records/payment-remainder-blocked-inputs.md` (new) | `test $(grep -cE 'R4|R6|R7' docs/records/payment-remainder-blocked-inputs.md) -ge 3 && grep -c 'crates/oz-hal/src/drivers/edc' docs/records/payment-remainder-blocked-inputs.md` | docs | - |
| 1 | **B4 `:109`** | Settle the one bypass still unreachable under test: the `#[cfg(debug_assertions)]` tier swap at `crates/oz-bridge/src/locations.rs` ahead of `enforce_location_quota`, whose three callers all die one line earlier on the sentinel. If no release-side assertion is reachable, write that verdict into the file as a parked arm beside `license.rs:670-683`. Do NOT weaken production, do NOT fake a test, and do NOT apply the shared bootstrap/Free helper to the ~21 token-required sites. | `crates/oz-bridge/src/locations.rs`, `crates/oz-bridge/src/locations_tests.rs` | `cd $(git rev-parse --show-toplevel) && CARGO_TARGET_DIR=target-release cargo test -p oz-bridge --release locations:: 2>&1 | tail -3 && grep -cE 'PARKED|REACHABLE' crates/oz-bridge/src/locations.rs` | coder | S1 |

**WAVE GATE:** `cd $(git rev-parse --show-toplevel) && python scripts/generate-pg-migration.py --check && python scripts/verify-ipc-parity.py` — both exit 0 in seconds, and neither is a whole-suite run.
**RE-CHECK BEFORE ANY COMMIT:** `git --no-optional-locks status --porcelain -- crates/oz-bridge/src crates/oz-payment/src docs/plans docs/records` — measured dirty at authoring: `crates/oz-bridge/src/{data.rs, pos.rs, local_payment_tests.rs, refunds_tests.rs}` and `crates/oz-payment/src/{error.rs, error_tests.rs, lib.rs, registry.rs, registry_tests.rs}` plus UNTRACKED `crates/oz-payment/src/{resilience.rs, resilience_tests.rs}`.

### WAVE 2 — the contract lane, the first deletion, the UI vocabulary box (3 boxes)
| wave | box | TASK (one outcome) | FENCE | ACCEPT | ROLE | BLOCKED-BY |
|---|---|---|---|---|---|---|
| 2 | **B5 `:112`** | **Contract lane, exclusive.** Add a release-profile test leg the repo can actually see: a step in `scripts/check.sh` + its `scripts/gates.json` row + the matching sentences in `docs/operations/ci-pipeline.md`, `AGENTS.md` and `.agents/AGENTS.md`. Keep both `--exclude`s intact (removing them is agents-3 `:168`, not this box). CI leg is NOT added here — ruling P5. | `scripts/check.sh`, `scripts/gates.json`, `docs/operations/ci-pipeline.md`, `AGENTS.md`, `.agents/AGENTS.md` | `cd $(git rev-parse --show-toplevel) && grep -c -- '--release' scripts/check.sh && python scripts/verify-ci-docs-drift.py && python scripts/verify-agents-mirrors.py` | coder | S1, B4 |
| 2 | **B6 `:204`** | Replace all four rank comparisons in `WorkspaceHome.tsx` with permission-vocabulary checks, one edit each, so the file stops asking a role name for a rank. Measured live positions at `c93965f32`: `:364` `roleLevel`, `:373` `canAddWorkspace`, `:379` `canAccess`, `:415` `canSeeTools` (the plan's `:363/:372/:378/:414` are off by one), plus the `ROLE_HIERARCHY` import at `:13`. Each gate needs a test that a **custom role holding the gate permission passes the way a preset would** — presets-only pins nothing. Note the fail-open asymmetry the same file carries: an unrecognised `minimumRole` demands 0. | `ui/src/features/workspaces/WorkspaceHome.tsx`, `ui/src/__tests__/WorkspaceHomeTools.test.tsx`, `ui/src/__tests__/WorkspaceHomeTools.navParity.test.tsx` | `cd ui && npx vitest run src/__tests__/WorkspaceHomeTools.test.tsx src/__tests__/WorkspaceHomeTools.navParity.test.tsx` | coder | - |
| 2 | **B7 `:114`** | Delete the first NOT-WORK milestone row (`todo-open-debt-program.md:114`) and leave its reason on the record in one dated line: it names a commit form that `AGENTS.md` §3 already makes binding, so it can be neither done nor undone. Sole writer of that file this wave. | `todo-open-debt-program.md` | `cd $(git rev-parse --show-toplevel) && test $(grep -cE '^[[:space:]]*[-*][[:space:]]+\[ \]' todo-open-debt-program.md) -le 26 && test $(grep -c 'NOT WORK' todo-open-debt-program.md) -le 8` | docs | - |

**WAVE GATE:** `cd $(git rev-parse --show-toplevel) && python scripts/verify-ci-docs-drift.py && python scripts/verify-agents-mirrors.py && python scripts/verify-ipc-parity.py` — all three exit 0 and all three are
seconds, not builds.
**RE-CHECK BEFORE ANY COMMIT:** `git --no-optional-locks status --porcelain -- scripts/gates.json scripts/check.sh AGENTS.md .agents/AGENTS.md docs/operations/ci-pipeline.md todo-open-debt-program.md ui/src/features/workspaces` —
the manifest/mirror set plus the plan doc are the most-edited paths in this checkout; if ANY is dirty, B5 and B7
wait (a pathspec commit would file a peer's hunk under our subject, and a pathspec commit cannot collect their
staged work either).

### WAVE 3 — second deletion + the appendix relocation (2 boxes)
| wave | box | TASK (one outcome) | FENCE | ACCEPT | ROLE | BLOCKED-BY |
|---|---|---|---|---|---|---|
| 3 | **B8 `:159`** | Delete the Phase-2 NOT-WORK milestone row (`:159`), same rule as B7, sole writer of the plan doc this wave. | `todo-open-debt-program.md` | `cd $(git rev-parse --show-toplevel) && test $(grep -cE '^[[:space:]]*[-*][[:space:]]+\[ \]' todo-open-debt-program.md) -le 25 && test $(grep -c 'NOT WORK' todo-open-debt-program.md) -le 7` | docs | B7 |
| 3 | **B9 `:374-378`** | Copy the five dead-class rows out of the plan doc into a fenced sibling that carries, per row, an owning doc, a commit prefix and one runnable command. The population figures are properties of an extractor at a tip, so each relocated row must cite the command that re-derives its number, and the sibling must state the `externalClasses` ledger rule (an entry is earned only by an OPEN value domain). | `todo-open-debt-program.md` `:374-378` (READ-ONLY: copied, not deleted), `.agents/open-debt-dead-class-appendix.md` (new) | `cd $(git rev-parse --show-toplevel) && test $(grep -cE '^[[:space:]]*[-*][[:space:]]+\[ \]' .agents/open-debt-dead-class-appendix.md) -eq 5 && test $(grep -c 'ACCEPT' .agents/open-debt-dead-class-appendix.md) -ge 5` | docs | - |

**WAVE GATE:** `cd $(git rev-parse --show-toplevel) && python scripts/verify-agents-mirrors.py && python scripts/verify-ci-docs-drift.py`.
**RE-CHECK:** `git --no-optional-locks status --porcelain -- .agents/open-debt-dead-class-appendix.md todo-open-debt-program.md` — B9 is read-only against the plan doc, so wave 3 shares no file between B8 and B9; the collision the earlier draft flagged is gone by construction, not by hand-serialising two commits.

### WAVE 4 / WAVE 5 — the last two deletions (1 box each, forced serial by W1)
| wave | box | TASK (one outcome) | FENCE | ACCEPT | ROLE | BLOCKED-BY |
|---|---|---|---|---|---|---|
| 4 | **B10 `:209`** | Delete the Phase-3 NOT-WORK milestone row (`:209`). | `todo-open-debt-program.md` | `cd $(git rev-parse --show-toplevel) && test $(grep -cE '^[[:space:]]*[-*][[:space:]]+\[ \]' todo-open-debt-program.md) -le 24 && test $(grep -c 'NOT WORK' todo-open-debt-program.md) -le 6` | docs | B8 |
| 5 | **B11 `:265`** | Delete the Phase-4 NOT-WORK milestone row (`:265`). | `todo-open-debt-program.md` | `cd $(git rev-parse --show-toplevel) && test $(grep -cE '^[[:space:]]*[-*][[:space:]]+\[ \]' todo-open-debt-program.md) -le 23 && test $(grep -c 'NOT WORK' todo-open-debt-program.md) -le 5` | docs | B10 |

**WAVE GATE (both):** `cd $(git rev-parse --show-toplevel) && python scripts/verify-agents-mirrors.py` exit 0 —
deletions must not strand a claim the mirrors repeat.
**RE-CHECK:** `git --no-optional-locks status --porcelain -- todo-open-debt-program.md` alone; this file is the
programme's own scoreboard and another lane edits it hourly — the four floors above are dated to the 27-open
census measured at `c93965f32` and re-confirmed identical (open=27 / NOT WORK=9) at `49bd8b8ac` twenty minutes later, where the dirty set had already grown from 33 paths to 37 and must be re-derived before use, because a peer ticking an unrelated row moves
them (that is this repo's own documented failure mode, not a defect in the boxes).

**Collapse option (recommended if the plan doc's owning lane grants one window):** B7+B8+B10+B11 are four
edits to ONE file, so as a single box they drop waves 2-5 to one and the schedule becomes 3 waves. They are
kept apart here only because rule W1 forbids two boxes sharing a file in a wave.

## 3. CROSS-OWNED — rows this programme does NOT schedule (map, not deletion)

| plan row | Box it names | Rival owner (doc:line) | Note |
|---|---|---|---|
| `:106` | Classify each of the 76 | `todo-refactor-kasirmu-app-agents-3.md:142` + `docs/records/JOURNAL.md:11057` | The journal entry is titled as a completed campaign ("cleared every mechanical red"), so S1 re-measures before anyone re-dispatches this |
| `:110` | Fix the profile-dishonest fixtures | same two lines | The both-profile idiom already exists at `crates/oz-core/src/db/audit_security_tests.rs` and `crates/oz-bridge/src/subscription_tests.rs` |
| `:111` | Decide `sync_tests.rs` cfg | same two lines | Ridged into the fixture campaign, not this programme's call |
| `:154` | Per-domain wire audit | `todo-refactor-kasirmu-app-agents-3.md:113-123` ("Phase 3.3: Tablet Client Command Sharing") | My earlier draft's A-boxes all live there |
| `:156` | Share the DTOs, one domain per commit | agents-3 `:117` + `todo-review-type.md:127` ("## Item 3 — Finish the headless seam, then kill DTO drift") | Two rivals claim the seam; a third must not start it |
| `:157` | `AppState` -> `BridgeCtx` | agents-3 `:113-123` | Also spans `apps/desktop-client/**`, owned by no fence here |
| `:203` | Fold the duplicate rank table | already paid — measured | `WorkspaceHome.tsx:13` imports `ROLE_HIERARCHY` from `@/utils/role`; no second table in the file. Only `:204` is live |
| `:207` | Implement the scope axes | `todo-tools.md:443` (open as an owner ruling) + the `docs/plans/notes.md:1301` pending list | Its premise is half-false: `enum ScopeType { Organization, ... }` exists (`crates/oz-core/src/db/assignments.rs`) and `crates/oz-core/migrations/20260916_role_assignment_scopes.sql` is on disk |
| `:263` | Fix the EDC stub anchor | paid at `f09c5e28e` and `048411986` | `todo-payment-agents-4.md:126/:137` now carry the `crates/oz-hal/` prefix; the file is fenced by `todo-operational-integrity.md:173` anyway |
| `:374-378` | Dead-class census rows | collides with the `docs/plans/notes.md:1301` pending items and `docs/plans/0.0.36-backlog.md` 1770-1830 (screenExtraction parity) | No fence, no commit prefix, no acceptance line in the source; B9 gives them one each |
| `:68`/`:125` | Phase 1 + Phase 2 fences | agents-3 `:113-123`, `:168` | Resolved by rule W2 (one owning document per shared path per wave), not by editing either fence |

**Deferred, not rival-owned (no box, because the settled scope excluded them):** `:205` the fate of
`roleAtLeast`/`ROLE_HIERARCHY` — it is whatever `B6` leaves behind, and deleting the table is a second,
separate decision on `ui/src/utils/role.ts` + `ui/src/__tests__/role.test.ts`; and the CI-side release leg
(ruling P5).

## 4. PARKED — 5 owner rulings, with a recommendation each

| id | Ruling requested | Where it already sits | Recommendation |
|---|---|---|---|
| P1 | Cover `crates/oz-bridge/src/license.rs:670-683` (expired past grace -> `is_active: false`) by changing production (injected verifier, or a `#[cfg(test)]` key compiled in), or leave it uncovered | `todo-open-debt-program.md:113` | **Leave it parked.** Both routes weaken the signature path to buy a test; the loud forged-row error is pinned in both profiles at `auth_tests.rs` |
| P2 | Does any TERMINAL-level scope remain, now that the ORGANISATION axis shipped | `todo-tools.md:443-445` + `docs/plans/notes.md:1301` pending list | **Close the org half as shipped, rule on the terminal axis only, and correct `:206`'s premise.** A worker given the org axis would write a migration for a column that already exists |
| P3 | Who owns the five dead-class rows, and may a root `todo-*.md` be created for them | `docs/plans/notes.md:1301` pending items + `docs/plans/0.0.36-backlog.md` 1770-1830 + this plan `:366-384` | **B9 relocates to `.agents/`, no new root token.** Root plan names are read by other lanes' triage and census passes; a phantom costs every reader |
| P4 | Is the in-flight `crates/oz-payment/src/{resilience.rs, resilience_tests.rs}` (untracked, `registry.rs` dirty) the R5 implementation or a sketch | `todo-open-debt-program.md:261` says design-first; `todo-payment-agents-4.md:53-61` declares itself R1-R7 canonical | **Accept B2's doc against the code that exists, and rule whether that code lands.** `build_from_config` is a documented fail-closed stub; the chain must not merge before the breaker keying is decided |
| P5 | Which release-profile leg this repo grows first — local `check.sh` only, or a `dev-ci.yml` step too, given `--exclude`s and the 6-min wall time | `todo-operational-integrity.md:93` cedes the leg to this programme; `agents-3:168` wants the excludes gone | **Local leg (B5) first; CI leg only after B5 has one recorded run and S1 shows the count is stable.** Adding a red leg to a shared workflow is how gates get quietly made advisory |

## 5. Shape

- 5 waves, 11 dispatched boxes + 1 support row (S1) + 5 parked rulings; max 4 boxes in a wave; 6 slots unused
  in every wave, because rule W1 (one file, one owner) and rule W3 (the contract lane) bind harder than coder
  count.
- **Longest serial lane = the plan doc itself: B7 -> B8 -> B10 -> B11, 4 links, all one file.** Not a work
  dependency, an ownership artifact; the collapse option in §2 removes it.
- Second longest: S1 -> B4 -> B5 (3 links) — the release measurement before the probe, the probe before the
  leg, so the new gate cannot be built around a fake green.
- Only three boxes touch code: B4 (bridge `locations`), B5 (contract lane), B6 (`WorkspaceHome` + 2 tests).
  Everything else writes a new file nobody else owns. That is what the surviving scope actually is.
- First three to dispatch: **S1, B1, B3** — S1 because two rival docs disagree about whether the 76 reds still
  exist and everything else quotes that number; B1 and B3 because they are pure writes with no fence collision
  and they retire two of the programme's three blocked items.
- Numbers to re-derive, never quote: the 27/3 box census, the 33-entry dirty set (21 of them inside paths this
  schedule fences), the `1231 / 76` release pair, and the `54` tablet-struct population (measured at
  `c93965f32`; test files land hourly and `docs/records/JOURNAL.md:11057` already claims part of it is done).

