# Orchestrator Agent 3: Enterprise Mocks (Staff, Workspaces, Topology & Settings)

<!-- Audit stamp: 2026-09-14 · DSH · status: ACCURATE AFTER REPAIR (9 corrections) · MAJOR — the "Lane status (measured 2026-09-13): ZERO PROGRESS" header and the phase 3.1 staff box were overtaken by the tree: `ui/src/dev-mock/handlers/staff.ts` now EXISTS (572 lines, 33 command keys, its own header at :2-6 citing this work order's phase 3.1) and is imported at `tauri-api.ts:52` / registered at `:951`, so the box is ticked on that evidence and the lane status is restated as PARTIALLY landed. · DEAD REFS — the three sibling links (`todo-refactor-devmock-agents-1/-2/-4.md`) no longer resolve: those orders were retired under the `done-todo-` naming convention, so all three are now cited as BARE NAMES with no path prefix at all — this doc asserts nothing about where they currently sit, because that location is another session's in-flux work and a path here would make this doc false when it moves; the phase-4.5 anchor that this doc's load-bearing "SUPERSEDED BY PHASE 4.5" ownership claim hung on is re-pointed AND the claim is restated in prose so it stands without a resolvable path (read from the retired order, cited by its committed name: `done-todo-refactor-devmock-agents-4.md`:166 "Phase 4.5: Final Cleanup — OWNS the router consolidation (supersedes agent 3's phase 3.3)", restated at :204). · INVENTED SYMBOLS — the phase 3.1 box named `login_with_pin` and `assign_role`, which exist as IPC commands nowhere in `ui/` or `apps/` (searched both; also searched the sibling vocabulary: the staff surface is `staff_login` / `verify_pin` / `list_staff_scoped` / `create_staff_scoped` / `list_roles_scoped` — `apps/desktop-client/src/commands/staff.rs:119`, `:147`, `:231`); a worker following the old text would hunt for mocks that never existed. · STALE COUNTS — "as of 2026-09-13 it measures 2,375 lines … with 181 literal entries": today the router measures 1,127 lines (read-tool count; `wc -l` agrees) with ~123 named handlers still inline (92 quoted object keys + 31 `handlers['…'] =` additions, counted by rg); the 4,904 figure is now labelled unreproduced (no commit was found that measures it), while 5,226 / 4,991 are kept with the command that reproduces them. · FORBIDDEN PATHS list was incomplete — 9 further modules exist in `handlers/` outside this fence (analytics, crm, floorplan, kds, locations, loyalty, payment, system, topology-state); the 14th is this lane's own landed `staff.ts`. · SCOPE — dev-mock is a UI-only surface: 20 files / 6,174 lines under `ui/src/dev-mock/`, no crates/ or platform/ devmock layer. · METHOD: read/grep against the working tree only; no git command ran in this pass, so the three phase 3.3 wait-gate SHAs are carried from the reference-integrity audit (repo-wide `git cat-file`: 71/71 resolve) rather than re-derived here. -->

**Document:** `done-todo-refactor-devmock-agents-3.md` *(renamed in place from `todo-refactor-devmock-agents-3.md` by owner directive 2026-09-15 — see the dated owner-waiver note at the foot of this file for why the `done-` mark rests on a §4 waiver, not on a green `check:all`)*  
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

---

## 📌 Dated addendum — 2026-09-14 · DSH · two premises above are false on disk at HEAD `d7230a5d6`

*Purely additive, and appended below the last line so no line number above shifts. No box here is ticked, unticked, struck, reworded or renumbered — the file still measures 14 boxes / 10 ticked / 4 open before and after this note — and the ownership ruling and the milestone disposition stand exactly as written: a dated note supersedes, it does not rewrite.*

### A. The `get_setting` premise at :104-106 and the fix prescribed at :114 — superseded, not resolved

The blockquote above describes `get_setting` as mocked `() => ''` for every key and offers, as its candidate one-line shape, `'get_setting': (args) => MOCK_SETTINGS[args?.key ?? ''] ?? ''`. Neither is the tree now. `ui/src/dev-mock/handlers/settings.ts:71` reads `'get_setting': () => null`. It landed as `b78b0c577 test(dev-mock): make get_setting answer null for unset keys like the bridge and split the alias cases by data expectation` — a three-file commit that changed that one line in `settings.ts`, added `const OBSERVED_MAY_BE_NULL = ['get_setting_scoped']` at `ui/src/__tests__/dev-mock-scoped-aliases.test.ts:40`, and deleted `ui/src/__tests__/dev-mock-get-setting-empty-characterization.test.ts` outright (132 lines removed; `git log --diff-filter=D` on that path returns exactly `b78b0c577`, so the path is gone by design and is cited here only as the thing that was removed). **The seeded-map fix this plan prescribed is not the fix that shipped:** no map is consulted and no argument is read.

Do not let a later pass read that as "fixed", and do not write the word here. The complaint at :108 was that the mock "cannot distinguish **unset** from **stored as the empty string**". `() => ''` collapsed that pair onto the empty string; `() => null` collapses the same pair onto null — a key genuinely stored as `""` is still indistinguishable from an unset one, so the defect the blockquote named is fully intact and only its polarity moved. That is also why the characterization test was deleted rather than updated: there is no longer an empty-string behaviour left to characterise. What the mock loses is now the other value of the two.

### B. The gap count is stale, and the test that carries it proves registration identity only

The inherited figure — the comment `// 115 such gaps exist on the current tree; this asserts one.` at `ui/src/__tests__/dev-mock-scoped-aliases.test.ts:47`, which the plan prose then repeats — no longer matches the tree. Measured at HEAD `d7230a5d6`: **343** distinct `*_scoped` command names are invoked from `ui/src`; **241** of them are explicitly registered in the mock; **73** are served *only* by `applyScopedAliases` (`ui/src/dev-mock/core/mockDispatcher.ts:83-94`), which assigns the base handler as the scoped twin and never reads `args`; **29** have neither a twin nor a handler of their own and therefore at least reach the loud `console.warn('[TAURI MOCK] Unhandled command:', cmd)` at `mockDispatcher.ts:121` — `search_customers_scoped` and `local_api_status_scoped` are two of them. So 102 scoped names have no mock of their own, and 73 of those silently answer as though the call had never been scoped. The category the 115 comment describes — a base registered while its `_scoped` twin is not — measures 73 today, not 115.

*Method, so a reader re-derives instead of trusting this note:* enumerate the distinct `*_scoped` names invoked anywhere under `ui/src`, subtract the handler keys registered across `ui/src/dev-mock/**`, then partition the remainder by whether the unscoped base is registered — registered ⇒ the alias fallback answers it, unregistered ⇒ the warn. Pass every pattern to `grep -E`, not bare `grep`: an earlier pass silently lost its ERE alternation group to BRE, and that is how it under-counted.

**The rule for the next reader of this plan, and the reason this addendum adds no box tick:** `dev-mock-scoped-aliases.test.ts` asserts `expect(unhandled).toBe(false)` — that a scoped name does not fall through to the warn. That is **registration identity**. It never asserts that a scoped call honoured its arguments, and 73 of the names such a claim would cover are answered by the argument-discarding fallback. Nobody may tick a scoped-fidelity claim off that test: "the alias test is green" and "the scoped mock behaves like the scoped bridge command" are different propositions, and only the first is checked.

*Disposition of the four open boxes, recorded once, 2026-09-14:* `:136`, `:138` and `:142` stay open because the router consolidation and its commit belong to Agent 4's phase 4.5 on another agent's fence; `:140` stays open because `npm run test` and `npm run check:all` have still been run by nobody in this tree; and this addendum changes none of that and proposes no rename in either direction.

---

## Acceptance leg, run and reported: 2026-09-15, branch 0.0.39, HEAD `362fe13cd`

Line numbers in this section are stamped to `362fe13cd` and move with every commit; the rows
are identified by TITLE, not by number. Titles cited: `Run full UI tests: `npm run test` and
`npm run check:all`` (the row this section settles), and the three rows the file already says
belong to another phase -- `Reduce `ui/src/dev-mock/tauri-api.ts` to registering the domain
handler maps into `mockDispatcher``, `Verify `tauri-api.ts` line count drops from 4,904 to
< 200 lines`, and `**Commit Milestone:**`.

**The acceptance row is NOT ticked, because the run it asks for came back red and the second
command in it was never attempted.** What ran, and what it printed:

1. `cd ui && npx tsc --noEmit -p tsconfig.json` -- the command `npm run typecheck` is
   (`ui/package.json:19`, `"typecheck": "tsc --noEmit"`). **Exit 0, no output, 2 m 20 s.**
   The typecheck leg of this plan is clean at this HEAD. That is not one of the row's two
   commands, so it does not move the row.
2. `cd ui && npx vitest run` -- the command `npm run test` is (`ui/package.json:22`,
   `"test": "vitest run"`). **The full UI suite is RED:**
   `Test Files  1 failed | 579 passed (580)` / `Tests  4 failed | 9942 passed | 25 skipped (9971)`
   / `Duration  82.35s`. All four failures are in one file and one describe block, verbatim:
   `FAIL  src/__tests__/PosScreen.test.tsx > PosScreen – bundle scanning toast > shows a success toast when a bundle barcode is scanned`,
   `… > includes the expanded items in the cart when a bundle is scanned`,
   `… > adds product directly when lookupByBarcode returns a DTO (no bundle path)`,
   `… > gives product barcode priority when the same code matches both a product and a bundle`.
   The rendered stack the run attaches to them bottoms out in
   `❯ PaymentModal src/features/sales/PaymentModal.tsx:289:26` at
   `const workspaceScope = useWorkspaceScope();`, which reads as a provider missing in that
   test setup rather than as anything devmock touched.
   Nothing was fixed: this box's fence is this file, and every `ui/src` lane is elsewhere. The
   9,971 is a property of this run, per the README rule that no static command re-derives a
   Vitest case total.
3. `npm run check:all` -- **not run**, out of this box (it starts Docker and E2E), which is the
   leg the 09-14 note at `:141` already recorded as never having been run by anybody in this
   tree. That sentence stands and is now dated twice rather than once.

So the row's own two commands are: first one run and RED, second one still never run. The
file stays `todo-` by the naming rule in `AGENTS.md` section 4 (`done-todo-` is earned only when
the file's own acceptance command was RUN and PASSED), and `:141`'s claim that nobody has run
either command is now superseded in one direction only: somebody has run the first one, and it
failed.

**One harness artifact, recorded so nobody routes it as a red in this tree.** The first attempt
at step 2 was started from the repo root, because a PowerShell command built its working
directory with `Join-Path $env:PWD 'ui'` and `$env:PWD` is null there (the call failed with
`Join-Path: Cannot bind argument to parameter `Path` because it is null` and left the cwd
alone). `npx` then resolved a vitest from the npm cache outside `ui/node_modules` and walked
`website/` as well, printing `Test Files  569 failed | 47 passed (616)` /
`Tests  138 failed | 556 passed (694)` with `Cannot find package 'jsdom'` on every worker.
Those two lines describe a broken runner, not this repository: the same 569-file collapse is
what a missing environment dependency looks like, and the only measurement of value in that run
is the one it destroyed. Re-run from inside `ui` with the project-local binary produced the
figures in step 2. A run whose file count exceeds `find ui/src/__tests__ -type f | wc -l` is not
the UI suite.

**Pointer hygiene for the three other-phase rows, added without ticking or deleting anything.**
The file cites its owner at `:123-125` as `done-todo-refactor-devmock-agents-4.md`, deliberately
by bare name with no path, "because its location in this checkout is in flux". It is no longer
in flux and the path resolves: `git ls-files | grep -i refactor-devmock-agents-4` ->
`.agents/archived/done-todo-refactor-devmock-agents-4.md`. The three rows above stay open here
for the reason the file already gives at `:137`, `:139` and in the 09-14 disposition at the foot
of this file -- router consolidation is Agent 4's phase 4.5, one job, one owner, another
fence -- and no line number into that archived plan is quoted here because this box never opened
it.

### Test leg re-run green: 2026-09-15, HEAD `3b8d8b20e`, the row `Run full UI tests: npm run test and npm run check:all` stays OPEN

The test half of that row has now been run whole, from inside `ui/`, by the command
`npm run test` is: `cd ui && npx vitest run`. It printed **`Test Files  580 passed (580)`** and
**`Tests  9948 passed | 25 skipped (9973)`**, `Duration  82.67s`, started at 06:48:26 +0700 and
settled 82.67 s later at about 06:49:49 +0700 (the wall clock read 06:50:15 when the log was collected), against tip `3b8d8b20e` (re-read before the run;
other lanes commit under a long run, so the tip is the interval's start, not its end).
Zero files failed, so nothing here is a red to route. The four `PosScreen.test.tsx` cases this
section's earlier entry recorded as red are closed, and closed by the harness rather than the
component: `f27338da6` added the terminal-identity read at `PaymentModal.tsx:289-290` and updated
its own two harnesses, missing the local `vi.mock` factory for `@/contexts/WorkspaceContext` in
`src/__tests__/PosScreen.test.tsx`, which `3b8d8b20e` gave the `useWorkspaceScope` export; that
is a different lane's surface and this file only records that it is no longer red.

**The row is not ticked, and this paragraph is why.** It names two commands and one of them has
still never run anywhere in this checkout: `npm run check:all` chains lint, typecheck, test, i18n
and an E2E leg, and the E2E leg needs Docker, which this box has not been given. So the
disposition is the one `:141` recorded on 09-14 and it survives a green test leg: the row stays
open, the file stays `todo-`, and `check:all` is the named outstanding half rather than an
unstated one. What changed today is narrower and worth keeping straight: this morning the test
leg was red and the reason was a foreign missing mock export; this evening it is green at 580
files, and the row is still open on the same single command.

**Denominators, because a file count and a collected count are not the same measurement.** On
disk: `find ui/src/__tests__ -type f | wc -l` = **589** files, which is more than the 580 vitest
reported, and the difference is not lost work — the matching pair is
`find ui/src -name '*.test.*' -o -name '*.spec.*' | wc -l` = **580**, exactly what vitest
collected, so the nine extra files under `__tests__` are fixtures and helpers that are not suites
by name. Against the standing whole-tree figure this session has been quoting — 577 files /
9,795 passed / 25 skipped, several hours and roughly forty commits old — the tree has gained
**3 files and 153 cases** and lost nothing: the skipped count is identical at 25. Both the 577
and the 580 are run properties, not static counts, per the README rule that nothing re-derives a
Vitest case total.

One measurement discipline repeated because it produced the bad number earlier today: this run
started from inside `ui/`. A run started at the repo root resolves a cached vitest outside
`ui/node_modules`, walks `website/` too, and prints a file count above the number of files under
`ui/src/__tests__` alongside `Cannot find package jsdom` on every worker — that reading is a
broken runner, and the tell is the denominator, not the red.

### `check:all` ran and returned RED: 2026-09-15, HEAD interval `001351e0f` → `274ef0304`, row stays OPEN, and the lane is now named done-by-scope

*Additive, appended below the last line so no number above shifts. No box is ticked, unticked,
struck, reworded or renumbered — this note only settles the second command the acceptance row
named and had never run.*

The row `npm run test` and `npm run check:all` had, up to this section, exactly one leg that had
never been run anywhere in this checkout: `npm run check:all`. It ran now (`cd ui && npm run
check:all`, which is `node ../scripts/check-ui.mjs`), started against HEAD `001351e0f`, and the
run itself took 249.4 s during which another lane committed `274ef0304` — so the tip the legs
executed against is an interval, not a point. **Exit 1. The acceptance command was RUN and did
NOT PASS**, and per the `AGENTS.md` §4 rule (`done-todo-` is earned only when the file's own
acceptance command was run and passed) a red — even a wholly borrowed one — is disqualifying:
**the file stays `todo-`.** What it does not stay is *in progress*, and that distinction is the
point of this section.

**Per leg, verbatim from the runner's own summary:** ESLint `PASS (37.0s)` · TypeScript type
check `PASS (21.6s)` · **Unit tests (vitest) `FAIL (76.4s)`** · i18n lint `PASS (6.1s)` · FTL
dedupe `PASS (0.4s)` · Bundle budget `PASS (7.8s)` · E2E (Playwright) `SKIP` (Docker daemon down,
`docker info` fails — the skip this section predicted) · Perf smoke (Playwright) `PASS (22.7s)`.
`6 passed · 1 skipped · 1 failed`. The failure is confined to one leg, vitest, and vitest is
`npm run test` — the same command this file's previous section ran green at `580` files / `9948`
cases; it now reads `Test Files 2 failed | 580 passed (582)` / `Tests 3 failed | 9972 passed | 24
skipped | 3 todo (10002)`. Same command, different tree, three hours apart: the flip is a property
of foreign edits landing underneath the walk, not of anything this lane changed.

**The three reds, and why none of them belongs to this lane** (`grep` of every `AssertionError` in
the run for a `dev-mock` path returns **0**, so this lane's extracted handlers are unimplicated the
way the phase 3.1/3.2 typecheck caveats claimed — except that typecheck is now genuinely green
whole-tree, which clears even the "exits 2 on a foreign KDS file" caveat those boxes carried):

1. `themeTokenCompliance.test.ts:1641` — `--shadow-md @ ui/src/features/sales/CartPanelLineItem.css`,
   a new literal tail on a value-varying token. `CartPanelLineItem.css` is **` M` in `git status`
   right now** — an uncommitted edit by another session. This is the borrowed-red the `AGENTS.md`
   CSS section documents by name for this exact file and this exact suite: the walker reads disk
   with no channel to HEAD. Not a commit's red, not this lane's.
2. `popoverSurfaceCompliance.test.ts:166` and `:187` — `features/restaurant/RestaurantMenu.css`,
   `.restaurant-hamburger-dropdown` carries `var(--color-bg-surface)` where the gate wants
   `var(--color-bg-popover)`. `RestaurantMenu.css` is **clean/committed** at this tip (`git status`
   empty for it), so this one is a real red on HEAD — but on the restaurant lane's stylesheet,
   categorically outside this file's fence (`handlers/{staff,workspaces,topology,settings}.ts` +
   `tauri-api.ts`). A foreign lane's genuine failure, still not this lane's to fix.

**Disposition, stated once so the next reader does not re-litigate it:** the file's owned scope —
phases 3.1 and 3.2 (staff, workspaces, topology, settings extracted; the four handler modules exist,
are tracked, are wired into the router, and the router is clean against HEAD) — is **complete and
verified**. The three still-open boxes are router-consolidation items this file already handed to
Agent 4's phase 4.5 on another fence, and the fourth, this acceptance row, is blocked by foreign
working-tree and foreign-lane reds rather than by any code Agent 3 owns. So the accurate label for
this file is neither `in progress` nor `done`: it is **done-by-scope, acceptance-blocked-externally**.
Renaming it to `done-todo-` is off the table while `check:all` reads red for reasons that are not
this lane's; the two paths that would legitimately close it are (a) an owner re-running `check:all`
once the restaurant stylesheet and the `CartPanelLineItem.css` edit are green, or (b) the owner
choosing to scope the acceptance row to this lane's surfaces — which is an owner decision, not a
bookkeeping edit, and is deliberately not taken here. The run log is `ui/checkall.log` (23,191
lines), itself a working-tree artifact of this interval.

**Owner waiver — applied to the name, 2026-09-15 — this note supersedes the "not earned / off the
table / NOT applied" statements above it:** Those lines record a state that was true the moment they
were written (acceptance red, `done-` not literally earned, rename on hold) and they stay here as the
dated record they are. The owner then made the call that withheld it: judging the lane closed on its
**done-by-scope** merits — code complete and verified (phases 3.1 + 3.2), and the `check:all` red
*provably foreign* (0 assertion errors name a `dev-mock` path; the two blockers are
`RestaurantMenu.css`, a committed restaurant-lane surface, and `CartPanelLineItem.css`, an uncommitted
foreign edit, neither inside this file's fence) — the owner directed the in-place rename to
`done-todo-refactor-devmock-agents-3.md` via `git mv` (at the root, where §4 renames happen — *not* a
move into `.agents/archived/`). Deciding "done" is the owner's prerogative, not an agent's to block on
a literal gate; §4 itself types this as "an owner decision, not a bookkeeping edit," and an agent
refusing a decided owner is the rule-lawyering that note was warning against.

**What makes the flag honest rather than silent, since the `done-` prefix is a one-bit signal
automation reads (`ls todo-*.md` = open work, and this file now drops out of it):** the mark here
rests on a §4 **rename waiver**, not on a §4 rename **trigger**. The acceptance command was RUN and
did NOT PASS (`check:all` exited 1); the sibling `todo-tools-agents-3.md → done-todo-tools-agents-3.md`
(`346e9771a`, same day) is the proof of the bar normally enforced — that one renamed only on an
exit-0 run. This line is the reason, so a future reader who greps the file sees the green was absent
and *why* the owner renamed anyway. Net state, and stop here rather than re-running the command from
this lane: **done-by-scope · owner-closed · renamed under an explicit §4 waiver (green NOT present) ·
whole-tree `check:all` handed to whoever drives Agent 4's router consolidation.** No box reticked, no
line above this rewritten — only this dated note and the `**Document:**` self-reference at the header.

**Re-run, 2026-09-15, HEAD `f7e2a0e42`:** `npm run check:all` ran a second time from inside `ui/`
(log `ui/checkall-rerun.log`) and reproduced the identical foreign red — `6 passed · 1 skipped ·
1 failed`, the single failed leg being vitest at `Tests 3 failed | 9975 passed (10005)`, all three on
`RestaurantMenu.css` (clean/committed, restaurant lane) and `CartPanelLineItem.css` (still ` M`, an
uncommitted foreign edit), with `dev-mock`-named assertion errors **0**. Two independent runs, same
not-ours failure; the waiver disposition above stands and the lane stays closed as done-by-scope.

**Correction of a claim in the two notes above — 2026-09-15, HEAD `f7e2a0e42`: the "handed to Agent 4's
fence" line is stale; the router consolidation is orphaned.** Both prior notes (and the earlier phase-3.3
blockquote) said the remaining work was "handed to whoever drives Agent 4's router consolidation." That
was inherited from the doc chain without opening the file it points at — the exact "a value received is
not a value verified" error this repo warns about. Opened now, it is not what the sentence implies:

- The file is `.agents/archived/done-todo-refactor-devmock-agents-4.md` — renamed to `done-todo-` **and**
  archived. A closed lane, not an open owner.
- Its **phase 4.5** ("OWNS the router consolidation", `:166`) never consolidated. Every box is a deferral:
  `:174` reduce the router "**as far as Agent 4's fence permits**"; `:177` "zero literal entries … Achieved:
  the 9 `a4_locations` entries … **will move once Agent 3** extracts its fence"; the final cleanup commit is
  "**held until Agent 2 and Agent 3 complete their fences. At that point the router WILL be reduced to**
  [dispatcher form]" (`:182`-`:184`, future tense, never executed); and **`Run full UI tests: npm run test`
  and `npm run check:all` is left `[ ]`** (`:181`, unchecked) while `:203` declares "Agent 4's fence is complete."
- The artifact matches the deferral, not the tick: **`tauri-api.ts` is still 851 lines**, last touched by
  **our own `b27fad9ba`** (nobody consolidated after this lane), and still carries **54 inline quoted command
  keys + 22 `handlers[…]` additions** — sibling-owned domains (Agent 2's bundles / cash-drawer / low-stock;
  Agent 4's locations / device-binding / kds / sync / receipt), each deferred to a lane that has since archived
  `done-todo-`.
- All four `refactor-devmock-agents-*` lanes are now `done-todo-` (`-1`/`-2`/`-4` archived, `-3` this file),
  so when this note was first written the router's final reduction had **no live owner** — open debt, not a
  closed handoff. **Superseded the same day:** that orphan status is exactly why
  `todo-refactor-devmock-router-consolidation.md` (Orchestrator Agent 5) was opened at **`1938a0782`** to
  claim the released job, with the `entryHandlers` baseline and the `mockStores` blocker recorded in it; the
  debt is now owned, not ownerless.

**Keep two things distinct, because conflating them would be the next wrong claim:** this consolidation
(owned by Agent 5's `todo-refactor-devmock-router-consolidation.md` since **`1938a0782`**) is **not** why
`check:all` is red. That red is, and remains, the two foreign CSS suites
(popover on `RestaurantMenu.css`, theme on the uncommitted `CartPanelLineItem.css`); an un-reduced router
fails no test. The fat router is quality debt, orthogonal to this file's acceptance — no longer ownerless.

**Blast radius of the rename — recorded, then repaired:** the new name broke two links inside `agents-4`
— `:23` and `:167` pointed at `../../todo-refactor-devmock-agents-3.md`, which stopped resolving.
Factually dead, though inert to the dead-ref checker (`check-dead-refs.py` `is_historical_doc()` is a
`todo-` substring test and agents-4's own name carries it). Repointing is a small edit to another,
archived lane's file; the owner directed it this round, so both were repointed to
`../../done-todo-refactor-devmock-agents-3.md` in **`2f5406acb`**. Two sibling links in that same
`agents-4` block — `:21` and `:22`, pointing at `./todo-refactor-devmock-agents-1.md` / `-2.md` — were
also stale (broken earlier by those lanes' `done-todo-` rename + move into `archived/`, not by this one);
recorded here first as another lane's cleanup, then repointed to `./done-todo-…` in **`80bafa27f`** on the
owner's "continue" directive. All four back-links in that `agents-4` sibling block now resolve
(`:21`, `:22` into `-1`/`-2`; `:23`, `:167` into this file).

**Dated update, 2026-09-15, HEAD `3aa02090f` — supersedes the "the two foreign CSS suites" wording in the
"Keep two things distinct" note above, which stays verbatim as the record it was:** of those two, the
`popoverSurfaceCompliance` red on `RestaurantMenu.css` has **cleared** — re-run scoped it prints
`Tests 3 passed (3)`; another lane fixed it. So only `themeTokenCompliance` on the **still-uncommitted**
`CartPanelLineItem.css` remains, and that is a working-tree read, not a fact about HEAD. This does not
move this file's disposition: it is still `done-todo-` on the owner §4 waiver recorded above (an acceptance
that was *run and did not pass*), still has no dev-mock failure to its name, and its closed scope is
unchanged. The point of the update is only that the external blocker on the Agent 5 work order shrank from
two suites to one — recorded in the work order itself, not here.
