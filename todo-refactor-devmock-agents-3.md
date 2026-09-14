# Orchestrator Agent 3: Enterprise Mocks (Staff, Workspaces, Topology & Settings)

<!-- Audit stamp: 2026-09-14 · DSH · status: ACCURATE AFTER REPAIR (9 corrections) · MAJOR — the "Lane status (measured 2026-09-13): ZERO PROGRESS" header and the phase 3.1 staff box were overtaken by the tree: `ui/src/dev-mock/handlers/staff.ts` now EXISTS (572 lines, 33 command keys, its own header at :2-6 citing this work order's phase 3.1) and is imported at `tauri-api.ts:52` / registered at `:951`, so the box is ticked on that evidence and the lane status is restated as PARTIALLY landed. · DEAD REFS — the three sibling links (`todo-refactor-devmock-agents-1/-2/-4.md`) no longer resolve: those orders were retired under the `done-todo-` naming convention, so all three are now cited as BARE NAMES with no path prefix at all — this doc asserts nothing about where they currently sit, because that location is another session's in-flux work and a path here would make this doc false when it moves; the phase-4.5 anchor that this doc's load-bearing "SUPERSEDED BY PHASE 4.5" ownership claim hung on is re-pointed AND the claim is restated in prose so it stands without a resolvable path (read from the retired order, cited by its committed name: `done-todo-refactor-devmock-agents-4.md`:166 "Phase 4.5: Final Cleanup — OWNS the router consolidation (supersedes agent 3's phase 3.3)", restated at :204). · INVENTED SYMBOLS — the phase 3.1 box named `login_with_pin` and `assign_role`, which exist as IPC commands nowhere in `ui/` or `apps/` (searched both; also searched the sibling vocabulary: the staff surface is `staff_login` / `verify_pin` / `list_staff_scoped` / `create_staff_scoped` / `list_roles_scoped` — `apps/desktop-client/src/commands/staff.rs:119`, `:147`, `:231`); a worker following the old text would hunt for mocks that never existed. · STALE COUNTS — "as of 2026-09-13 it measures 2,375 lines … with 181 literal entries": today the router measures 1,127 lines (read-tool count; `wc -l` agrees) with ~123 named handlers still inline (92 quoted object keys + 31 `handlers['…'] =` additions, counted by rg); the 4,904 figure is now labelled unreproduced (no commit was found that measures it), while 5,226 / 4,991 are kept with the command that reproduces them. · FORBIDDEN PATHS list was incomplete — 9 further modules exist in `handlers/` outside this fence (analytics, crm, floorplan, kds, locations, loyalty, payment, system, topology-state); the 14th is this lane's own landed `staff.ts`. · SCOPE — dev-mock is a UI-only surface: 20 files / 6,174 lines under `ui/src/dev-mock/`, no crates/ or platform/ devmock layer. · METHOD: read/grep against the working tree only; no git command ran in this pass, so the three phase 3.3 wait-gate SHAs are carried from the reference-integrity audit (repo-wide `git cat-file`: 71/71 resolve) rather than re-derived here. -->

**Document:** `todo-refactor-devmock-agents-3.md`  
**Role:** Orchestrator Agent 3 (Enterprise Mock Domain Architect)  
**Goal:** Extract staff profiles, authentication tokens, roles/permissions, workspace instances, topology graph persistence, hardware printer mocks, and system settings from `ui/src/dev-mock/tauri-api.ts`. Reduce `tauri-api.ts` into a clean entry router.

**Target File:** `ui/src/dev-mock/tauri-api.ts`  
**Shared-file hazard:** all four plans edit this one file, so these lanes are serial on it,
not parallel. Every commit named below carries an explicit pathspec (AGENTS.md, Git & Commit
Policy §3), because a bare `git commit` in this shared checkout files whatever another
session happened to stage under your subject. Immediately before each commit, confirm the
router is clean against HEAD: `git --no-optional-locks status --porcelain -- ui/src/dev-mock/tauri-api.ts`.
If it holds edits that are not yours, stop and report rather than committing them.  
**Lane status (re-measured 2026-09-14): PARTIALLY LANDED — staff done, the rest not.**
`ui/src/dev-mock/handlers/staff.ts` now EXISTS (572 lines, 33 staff/auth/role/preferences
command keys exported as `staffHandlers` at :266), imported by the router at
`tauri-api.ts:52` and registered at `:951`; the module header at `staff.ts:2-6` names this
work order and phase 3.1 as its reason. `handlers/workspaces.ts`, `handlers/topology.ts` and
`handlers/settings.ts` still do NOT exist — the topology *state* that did land
(`handlers/topology-state.ts`, 86 lines) is shared revision bookkeeping under sibling
ownership, not the handler map phase 3.2 planned — and `resolve_boot_store` (`tauri-api.ts:548`),
`list_workspaces` (`:601`), `create_workspace_instance_scoped` (`:609`), `load_topology`
(`:664`) and `apply_topology_diff` (`:674`) are still literal entries in the router.
So: phase 3.1's staff half CLOSED, phase 3.1's workspace half and all of phase 3.2 still OPEN.  
**Sibling Documents:**
- `done-todo-refactor-devmock-agents-1.md` (Agent 1 — Dev-Mock Storage Core & Seeding Engine) — retired work order under the `done-todo-` convention, cited by BARE NAME and deliberately with no path: its location in this checkout is in flux, so a path here would be a claim this doc does not own.
- `done-todo-refactor-devmock-agents-2.md` (Agent 2 — Operational Mocks: Sales, Inventory & Catalog) — retired work order, cited by bare name for the same reason.

---

## 🔒 Coordination & Path Fencing Rules

1. **No Direct Inter-Agent Communication:**
   - Communication happens strictly through the Git commit history and durable commit subjects.
2. **Commit Subject Convention:**
   - All commits made by Agent 3 MUST use:
     - `refactor(devmock-enterprise): ...`
3. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/dev-mock/handlers/staff.ts` (LANDED 2026-09-14, 572 lines — this is phase 3.1's staff output, not a pending file)
   - `ui/src/dev-mock/handlers/workspaces.ts` (NEW)
   - `ui/src/dev-mock/handlers/topology.ts` (NEW)
   - `ui/src/dev-mock/handlers/settings.ts` (NEW)
   - Final consolidation in `ui/src/dev-mock/tauri-api.ts`.
4. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit mock storage engine in `ui/src/dev-mock/core/` (Owned by Agent 1).
   - DO NOT edit operational command mocks in `ui/src/dev-mock/handlers/{sales,inventory,catalog,shifts}.ts` (Owned by Agent 2).
   - Measured 2026-09-14, `ui/src/dev-mock/handlers/` holds 14 modules, so this list names only some of them: `analytics.ts`, `crm.ts`, `floorplan.ts`, `kds.ts`, `locations.ts`, `loyalty.ts`, `payment.ts`, `system.ts` and `topology-state.ts` also exist, none owned by Agent 3 (`system.ts` and `topology-state.ts` are Agent 4's; `staff.ts` is this lane's own finished phase 3.1 output). Treat any path not named in §3 above as off-limits.
5. **Git Dependency Waiting Protocol:**
   - Agent 3 can create and test `staff.ts`, `workspaces.ts`, `topology.ts`, and `settings.ts` independently.
   - Before Phase 3.3 (final consolidation of `tauri-api.ts`), check that Agent 1 and Agent 2 have committed:
     ```powershell
     git log -n 50 --oneline --grep="refactor(devmock-core):"
     git log -n 50 --oneline --grep="refactor(devmock-ops):"
     ```

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [x] Map remaining staff, workspace, topology, and settings command strings in `tauri-api.ts`. Mapped 2026-09-14: staff = 33 keys, extracted (see 3.1); workspace = `resolve_boot_store` :548, `list_workspaces` :601, `list_workspaces_scoped` :602, `create_workspace_instance_scoped` :609, `list_workspaces_for_store_scoped` :1088; topology = `load_topology` :664, `apply_topology_diff` :674, `load_topology_revision` :769 (+ revision state in `topology-state.ts`); settings = `get_receipt_settings` :651/:656, `set_receipt_settings` :661, `set_receipt_settings_scoped` :797, `pg_sync_status` :1079, license `get_license_status` :555 / `check_license_status` :556 / `activate_license` :558. *(anchors re-checked 2026-09-14: every one of them was correct at the 1,127-line baseline `fba0002a7` and is dead at HEAD, where these keys live in `handlers/{workspaces,topology,settings}.ts` — see the phase 3.2 settings box for the replacement line numbers; this map is kept as the audit record it is, not as a locator.)*

### Phase 3.1: Extract Staff & Workspace Mocks
- [x] Move the staff/auth/role mocks to `handlers/staff.ts` — **LANDED** 2026-09-14: `staff.ts:266` exports `staffHandlers` (33 keys incl. `staff_login` :278, `verify_pin`, `list_staff_scoped` :430, `create_staff_scoped` :509, `list_roles_scoped`, `get/set_user_preferences*`), wired by `tauri-api.ts:52` + `:951`. The commands this box originally named — `login_with_pin` and `assign_role` — were invented: neither exists in `ui/` or `apps/` (searched both, plus the sibling vocabulary above); `list_staff`/`create_staff` exist only in their `_scoped` form.
- [x] Move `list_workspaces`, `create_workspace_instance_scoped`, `resolve_boot_store` mocks to `handlers/workspaces.ts` — **LANDED as 1fb272000** (verified 2026-09-14: `git show --name-status 1fb272000` -> A `ui/src/dev-mock/handlers/workspaces.ts` (83 ln) + M `ui/src/dev-mock/tauri-api.ts`; the three keys now read `workspaces.ts:50`, `:58`, `:40` and the router imports the map at `tauri-api.ts:44`; a `grep -c` of the HEAD router for one key from each moved set -> 0; router `wc -l` per commit: `fba0002a7` 1,127 -> `1fb272000` 1,084). The "STILL OPEN / does not exist" reading above stands as written for the moment it was true and is superseded by this pass.
- [x] Verify: `npm run typecheck`. — **(verified 2026-09-14: `npm run typecheck` from `ui/` exits 2 TODAY with 9 errors, 8 in `src/features/kds/components/KdsHeaderLeft.tsx` and 1 in `KdsScreen.tsx` — an untracked file another session has in flight right now, `?? ui/src/features/kds/components/KdsHeaderLeft.tsx` — and **0 errors naming any `ui/src/dev-mock` path**, which is the half this box verifies. Read the tick as "this lane compiles", not as "the project gate is green": it is not, on someone else's file.)**
- [x] **Commit Milestone:** — **(verified 2026-09-14: landed as ONE commit, `1fb272000`, whose `--name-status` is exactly A `workspaces.ts` + M `tauri-api.ts` — `staff.ts` correctly did not ride along, since it had already landed with the staff half and had no diff to take. **DEVIATION, recorded not hidden: the subject is `refactor(ui)`, not the `refactor(devmock-enterprise)` area this file mandates at :37-:39**, so this is the one of the lane's three commits that broke the convention; see the phase 3.2 **Commit Milestone** box for the two that obeyed (line references inside this doc are unsafe to cite across an edit that lengthens it).)**
  ```bash
  git add -- ui/src/dev-mock/handlers/workspaces.ts && git commit -m "refactor(devmock-enterprise): extract staff and workspace mock handlers" -- ui/src/dev-mock/handlers/staff.ts ui/src/dev-mock/handlers/workspaces.ts ui/src/dev-mock/tauri-api.ts
  #  ^ ONLY workspaces.ts is added: it is the one untracked path this phase creates.
  #    staff.ts is already tracked (it landed with the staff half), so `git add` of it is the
  #    forbidden staging (AGENTS.md §3) — yet it stays in the COMMIT pathspec, which is legal and
  #    necessary, because a pathspec commit takes it from the working tree with no add at all.
  ```
  *Half-executed (measured 2026-09-14): the `staff.ts` half of this commit already landed —
  it exists on disk at 572 lines and is registered by the router — so only the
  `workspaces.ts` path (and `tauri-api.ts`) remains open. Do not re-add `staff.ts` to a new
  pathspec commit; it is tracked, and a `git add` of a tracked file is the forbidden staging
  (AGENTS.md §3).*

  The `add` is required only for the genuinely UNTRACKED file: a bare pathspec commit cannot
  introduce an untracked path and `git commit --include` fails the same way (§3 rev 2). Which of
  this lane's four files are untracked decides the form, and as measured 2026-09-14 it is NOT all
  four: `handlers/staff.ts` is TRACKED and on disk (572 lines), while `handlers/workspaces.ts`,
  `handlers/topology.ts` and `handlers/settings.ts` do not exist yet and are therefore the ones a
  chain may `add`. `tauri-api.ts` is tracked too — pathspec in the commit, never in the add.
  Chain the add and the commit on one line so no staged window is left open for another agent.

### Phase 3.2: Extract Topology & Settings Mocks
- [x] Move `load_topology`, `apply_topology_diff` mocks to `handlers/topology.ts` — **LANDED as abb87ba37** (verified 2026-09-14: `git show --name-status abb87ba37` -> A `ui/src/dev-mock/handlers/topology.ts` (211 ln) + M `tauri-api.ts`; the two keys now read `topology.ts:79` and `:89`; router `wc -l` `abb87ba37^` 1,084 -> `abb87ba37` 902). Note `handlers/topology-state.ts` (86 lines, Agent 4) already holds the revision state both of these read, so the extraction is thinner than it looks.
- [x] Move printer/receipt settings, cloud sync status, and license mocks to `handlers/settings.ts` — **LANDED as b27fad9ba** (verified 2026-09-14: `git show --name-status b27fad9ba` -> A `ui/src/dev-mock/handlers/settings.ts` (107 ln) + M `tauri-api.ts`; router `wc -l` `b27fad9ba^` 902 -> 851; the lane's own tip is that commit (`git log -1 --grep='refactor(devmock-enterprise)'` -> `b27fad9ba`) and `git status --porcelain -- ui/src/dev-mock/` -> empty, i.e. nothing in this lane is still in flight. Do **not** read that as "HEAD": HEAD moved under this very pass (`10639cf18`, another session's `docs(plans)` commit), which is why the claim is pinned to a grep and not to a tip). **The router anchors in this box, and in the phase 3.0 map above, are now a map to nowhere — corrected rather than left:** they were **right** when written, re-checked at `fba0002a7` (1,127 ln) where `:651` is `get_receipt_settings`, `:656` `get_receipt_settings_scoped`, `:661` `set_receipt_settings`, `:797` `set_receipt_settings_scoped`, `:1079` `pg_sync_status` and `:555`/`:558` the license pair; the three 09-14 moves shifted them (in the 902-line intermediate they read `:550`/`:556`/`:560`/`:562`, `:857`, `:484`/`:487`) and at HEAD **none of them is in the router at all** — they are `settings.ts:58`, `:68`, `:101`, `:37`, `:40`. Use those, not the router numbers.
- [x] Verify: `npm run typecheck`. — **(verified 2026-09-14 with the same reading and the same caveat as phase 3.1's verify: `grep -c dev-mock` over the typecheck output -> **0**, so nothing in this lane is implicated; the project run itself exits 2 on another session's untracked KDS file. The "exit 0 reported for all three commits" account is **received, not verified** — a commit-time tree is unreachable without a git write, and this file's own rule says a value received is not a value verified.)**
- [x] **Commit Milestone:** — **(verified 2026-09-14: **both commits used the mandated area** — `abb87ba37` and `b27fad9ba` are each `refactor(devmock-enterprise): ...` — which is exactly the convention `1fb272000` broke; two of the lane's three obeyed, and the one that did not is named on its own box above. **Second deviation, anticipated by the box's own comment:** the plan asked for ONE commit carrying both handler paths; TWO landed, one per handler, each with its own router edit. The box's line "If either lands in a prior commit, drop it from the add" is the sentence that covers it, so this is a split executed, not a rule ignored.)**
  ```bash
  # Both paths in this add are legal: neither file exists yet (measured 2026-09-14), so both are
  # untracked — the one case §3 sanctions an add for. If either lands in a prior commit, drop it
  # from the add and leave it in the commit pathspec only.
  git add -- ui/src/dev-mock/handlers/topology.ts ui/src/dev-mock/handlers/settings.ts && git commit -m "refactor(devmock-enterprise): extract topology and settings mock handlers" -- ui/src/dev-mock/handlers/topology.ts ui/src/dev-mock/handlers/settings.ts ui/src/dev-mock/tauri-api.ts
  ```

> **A defect found while moving — deliberately not fixed by the mover, and not fixed by this
> bookkeeping pass (2026-09-14; a note, not a box).** `get_setting` is mocked as
> `() => ''` for **every** key (`handlers/settings.ts:71`, the same constant the router
> carried before `b27fad9ba` — one definition tree-wide, `grep -rn "'get_setting'"
> ui/src/dev-mock` -> 1 hit), so a card that reads any settings key in browser preview
> cannot distinguish **"unset"** from **"stored as the empty string"**. That is precisely
> why `handlers/topology.ts` keeps its node/wire diagram in **localStorage under its own
> key** instead of going through the settings mock — its own header says so at `:34-40`
> ("The real backend persists the node/wire diagram as JSON under the `oz-pos/topology`
> settings key. The mock previously returned hardcoded positions ... while discarding
> saves"). Candidate one-line shape, symbol not chosen and no such helper exists today:
> `'get_setting': (args) => MOCK_SETTINGS[args?.key ?? ''] ?? ''` — a seeded map whose
> miss is distinguishable from its empty value. **Recorded unresolved alongside it:** the
> moved set answers three adjacent writes with three different success shapes —
> `set_setting` -> `true` (`:91`), `set_setting_scoped` -> `null` (`:72`),
> `set_store_settings` -> `null` (`:55`) — which **may or may not** match the real
> commands; nothing in this lane checks that, and nobody who owns the settings surface has
> been told yet.

### Phase 3.3: Final Reduction of `tauri-api.ts` — SUPERSEDED BY PHASE 4.5
> **Do not execute this phase.** The Agent 4 work order — `done-todo-refactor-devmock-agents-4.md`,
> retired under the `done-todo-` convention and cited here by bare name with no path, because its
> location in this checkout is in flux — claims this same final consolidation as its
> **phase 4.5, "Final Cleanup — OWNS the router consolidation (supersedes agent 3's phase 3.3)"**
> (its :166 heading, restated in its own status note at :204). Router consolidation is ONE job with
> ONE owner, and that owner is Agent 4's phase 4.5. This sentence is deliberately spelled out in
> prose: the claim used to hang on a relative link to a file that has since been renamed and moved,
> so a reader who could not follow the link lost the ownership ruling entirely. Agent 3's
> remaining scope is phases 3.1 and 3.2 only — extract the enterprise handler modules still
> missing (workspaces, topology, settings; staff already landed) and leave the router to
> Agent 4. The milestone below is kept in corrected form solely so a stale grep for a bare
> commit cannot resurrect it.
- [x] ~~*Wait Gate:* Verify Agent 1 has landed `refactor(devmock-core):` and Agent 2 has landed `refactor(devmock-ops):`.~~ Both landed: `ce8666604`, `6105ce224`, `efd766226` (SHAs carried from the reference audit — repo-wide `git cat-file` resolved all cited SHAs; not re-derived in this pass, which had no git command available). *That last caveat is now closed: re-derived 2026-09-14, `git log --grep="refactor(devmock-core):"` -> `ce8666604`, `git log --grep="refactor(devmock-ops):"` -> `efd766226` + `6105ce224`, and `git cat-file -t` on all three -> `commit`. **Ticking the gate records that its precondition is met; it is not permission to run this phase** — the phase heading above still reads SUPERSEDED BY PHASE 4.5.*
- [ ] ~~Reduce `ui/src/dev-mock/tauri-api.ts` to registering the domain handler maps into `mockDispatcher`.~~ see phase 4.5
  *left open 2026-09-14, no argument added: struck by this file's own ruling in the 'SUPERSEDED BY PHASE 4.5' blockquote under the Phase 3.3 heading — router consolidation is Agent 4's phase 4.5, one job one owner.*
- [ ] ~~Verify `tauri-api.ts` line count drops from 4,904 to < 200 lines.~~ Both numbers were wrong. The file never measured 4,904 at any commit this audit could reach — that figure is **unreproduced**, kept only as the claim being corrected. The two history numbers ARE reproducible: `git show ce8666604^:ui/src/dev-mock/tauri-api.ts | wc -l` = 5,226 and `ce8666604` = 4,991 (both re-checked against those commits by the 09-14 reference pass). Current: 2026-09-14 re-measure = **1,127 lines** (`wc -l` and the read-tool line count agree; ±1 elsewhere is a method artifact, not an error) with roughly **123 named handlers still inline** — 92 quoted object keys plus 31 `handlers['…'] =` additions, both counted by `rg -c` on the file — down from the 2,375 lines / 181 entries recorded on 2026-09-13, because phase 3.1's staff extraction and Agent 4's `system.ts`/`topology-state.ts` landings removed them. A line-count target is still not a definition of done while entries remain unowned. Measure with `git show HEAD:ui/src/dev-mock/tauri-api.ts | wc -l` and `rg -c "^\s*'" ui/src/dev-mock/tauri-api.ts`.
  *left open 2026-09-14: premise gone, per this box's own retraction ("~~Verify 4,904 to < 200 lines~~ Both numbers were wrong", and "a line-count target is still not a definition of done while entries remain unowned") — the measured trend is real (1,127 -> 1,084 -> 902 -> 851, `wc -l < ui/src/dev-mock/tauri-api.ts` per commit) but < 200 was never the target this file believes in.*
- [ ] Run full UI tests: `npm run test` and `npm run check:all`.
  *left open 2026-09-14, and this is the reason the file does not become `done-todo-`: **nobody has run either command in this tree.** Neither was run here — `check:all` starts Docker/E2E and the full suite touches files other sessions have in flight, so a spurious red would be worse than no signal. A full-suite gate run is scheduled separately and will record its own exit code against this box.*
- [ ] **Commit Milestone:**
  ```bash
  git commit -m "refactor(devmock-enterprise): modularize dispatcher and reduce tauri-api.ts to router root" -- ui/src/dev-mock/tauri-api.ts ui/src/dev-mock/core/mockDispatcher.ts
  ```
  *left open 2026-09-14: owned by another agent's fence — `tauri-api.ts` consolidation plus `mockDispatcher.ts` is the phase 4.5 job this file SUPERSEDES itself into in that same blockquote, so this lane has no commit to make here.*
