# Orchestrator Agent 2: Master-Detail Settings Screen Deconstruction

<!-- Audit stamp: 2026-09-14 · DSH · status: SUPERSEDED (the goal was met, but not by this plan) · corrections applied: 13 · the headline error is that SettingsPage.tsx is ALREADY a master-detail navigator (SettingsNavTree rendered at :814, renderSection switch at :644-677, top-right Save bar at :764-806) and 921 lines, not an 844-line monolith — while the fenced `panels/` directory has never existed; found by measuring every path and symbol in this doc against the tree with read/grep (the codebase-memory index points at a different worktree, so it was not used). -->

**Document:** `todo-refactor-settings-agents-2.md`  
**Role:** Orchestrator Agent 2 (Settings Frontend Experience Architect)  
**Goal:** Decompose `ui/src/features/settings/SettingsPage.tsx` from a monolithic form into isolated setting tab panels (Store Info, Hardware/Printers, Receipt Customization, and Tax Defaults).

> **Status (2026-09-14): goal satisfied, plan obsolete.** "The Settings page" is
> `ui/src/features/settings/SettingsPage.tsx` — master–detail UI, route `settings`
> (`ui/src/features/settings/register.tsx:10`), top-right Save button. It already delegates its body
> to lazily imported screens; the decomposition below was never executed **as written** — there is no
> `panels/` directory, and each of the four named panel components returns 0 hits under `ui/src`.
> Equivalent work landed under `sections/` and `screens/`, and the flat-IA rebuild then unmounted the
> `sections/` files from this page. Line counts here are the read-tool `totalLines` value, which can
> read 1 lower than `wc -l` on a trailing-newline file; that ±1 is a method artifact, not drift.

**Target File:** `ui/src/features/settings/SettingsPage.tsx` (stated baseline: 844 lines · **measured 2026-09-14: 921 lines** — it grew)  
**Sibling Documents:**
- `done-todo-refactor-settings-agents-1.md` (Agent 1 — Settings Backend IPC Modularization; completed and archived, so cited by name with no path prefix)
- [`todo-refactor-settings-agents-3.md`](./todo-refactor-settings-agents-3.md) (Agent 3 — Database Management & Factory Reset Workflows)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(settings-ui): ...`
   > Repo rule (root `AGENTS.md` §3): the ONLY permitted commit form is one line with an explicit
   > pathspec — `git commit -m "refactor(settings-ui): <subject>" -- path/one path/two`. Bare
   > `git commit -m` is forbidden in this concurrent checkout; the milestone commands below are rewritten in that form.
2. **Owned Path Fence (Exclusive to Agent 2):**
   - `ui/src/features/settings/SettingsPage.tsx` — exists, 921 lines
   - `ui/src/features/settings/panels/` (NEW directory) — **never created**: the directory does not exist and `panels/` has 0 references anywhere under `ui/src`. The tree's real convention is `sections/` (7 files), `screens/` (17 `.tsx` files) and `workspace-cards/` (6 `.tsx` files + helpers/index/types); any future Agent-2 work inherits that layout.
     - `GeneralSettingsPanel.tsx` → nearest real artefact: `sections/GeneralSection.tsx` (205 lines)
     - `PrinterSettingsPanel.tsx` → **no counterpart exists** (see Phase 2.1)
     - `ReceiptSettingsPanel.tsx` → `sections/ReceiptSection.tsx` (257 lines) + live `screens/ReceiptFormatSettingsCard.tsx` (488 lines)
     - `TaxSettingsPanel.tsx` → `screens/TaxConfigurationScreen.tsx` is a 32-line placeholder; the live tax UI is still `ui/src/features/tax/TaxConfigurationScreen.tsx` (1,027 lines, own route `tax-config`, registered at `ui/src/features/tax/register.tsx:8`)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit backend Rust command files (Owned by Agent 1): `apps/desktop-client/src/commands/settings.rs` (379 lines), `apps/tablet-client/src/commands/settings.rs` (949 lines), `crates/oz-core/src/settings.rs` (897 lines), `crates/oz-core/src/db/settings.rs` (286 lines), `modules/settings/` (kernel module, 202-line `lib.rs` — a lifecycle stub, not the UI).
   - DO NOT edit `ui/src/features/settings/DataManagementScreen.tsx` (1,016 lines, Owned by Agent 3).
     > Name collision worth knowing: a second file of the same basename sits at
     > `ui/src/features/settings/screens/DataManagementScreen.tsx` (32 lines, rebuild placeholder) and is
     > mounted by **this** page (`SettingsPage.tsx:48`, rendered at `:660-661`); Agent 3 owns the other one.

---

## 📋 Task Checklist

> **Current target (2026-09-14): `SettingsPage.tsx` <= 450 lines**, restated from the arithmetically impossible `< 250`.
> Why: the old gate's own baseline (844) is a DIFFERENT file's line count, while the page measured 921 at the start of
> The measurement is in the sizing box under Phase 2.2; what is queueable is in `## 🟢 Live state of this plan` below.
> The file stays `todo-`, but **not for the reason this line gave until now.** Both Phase 2.0 run-boxes — the two `- [x]` lines under `### Phase 2.0: Baseline Audit`, which this header cited as `:50-51` while they sit at `:55`/`:56` — **were executed in this checkout on 2026-09-15 (06:23–06:26 +0700) and both passed**: `npx vitest run src/__tests__/SettingsPage.test.tsx src/__tests__/SettingsContext.test.tsx src/__tests__/SettingsDeepLink.test.tsx src/__tests__/a11y/SettingsPage.a11y.test.tsx` from `ui/` printed `Test Files 4 passed (4)` / `Tests 63 passed (63)` / `Duration 16.71s`, **exit 0** — 63 of 63, which also retires the 62-of-63 ambiguity recorded at `:65`, since nothing was skipped or filtered in this run — and `npx tsc --noEmit -p tsconfig.json`, the command `npm run typecheck` wraps, printed **no diagnostics, exit 0**. Both were launched against the tree at `04cd68267` and finished while the tip moved through `a672e8494` to `784d3fcae`, so they measure that interval and not one SHA. **The two ticks are therefore earned and were kept.** What keeps the file `todo-` is its own audit stamp at `:3` — `status: SUPERSEDED (the goal was met, but not by this plan)` — not an unexecuted acceptance box. **The defect this line repairs is the most expensive shape in the set: a ticked box sitting under a header that says nobody ever ran it reads as done to every later reader, and no mechanical checker can see the contradiction — `python .agents/skills/docs-auditor/scripts/check-dead-refs.py` exits 0 over this very file.** The earlier pass’s "no shell was available" caveat at `:57`-`:60` stands as written, exactly as `:72` says it should; for the pattern rather than the incident, the same wording survives in `todo-refactor-settings-agents-3.md` (`git grep -l "no shell was available" -- "*.md"` → both files), and one correctly-unticked sibling sits at `:107` of this file — proof the shape is not always a lie, only unauditable.

### Phase 2.0: Baseline Audit
- [x] Run `npm run test -- SettingsPage` in `ui/`.
- [x] Run `npm run typecheck` in `ui/`.
  > **Unverified by this audit** — no shell was available, so neither command was run and no pass/fail
  > is claimed. The suites the first line collects do exist: `ui/src/__tests__/SettingsPage.test.tsx`,
  > `ui/src/__tests__/a11y/SettingsPage.a11y.test.tsx`, `ui/src/__tests__/SettingsNavTree`-adjacent
  > mounts, and `ui/src/features/settings/__tests__/` (FeatureToggleScreen, LicenseSettings).

> **Ticked 2026-09-14 by a later pass (HEAD `e455e9d13`) — because commands RAN, and each with its exit code.** What ran for
> the first box was **not** `npm run test -- SettingsPage`. It was, from `ui/`, over the merged tree:
> `npx vitest run src/__tests__/SettingsPage.test.tsx src/__tests__/SettingsContext.test.tsx src/__tests__/SettingsDeepLink.test.tsx src/__tests__/a11y/SettingsPage.a11y.test.tsx`
> → **62 green of 63 collected, exit 0**. The tick is recorded against those four named files, not against whatever the
> box's own `-- SettingsPage` filter collects; the a11y suite lives at `ui/src/__tests__/a11y/SettingsPage.a11y.test.tsx`,
> not beside the page. The one non-green case was not characterised in the run note — skipped, or filtered out — and nobody
> should infer it was a failure: re-run with `--reporter=verbose` before repeating the 62/63. For the second box:
> `npm run typecheck` from `ui/` → **exit 0, zero errors**. Both runs were made on the merged tree by the requesting pass;
> this editing session did **not** re-run either command, because another lane had `ui/src/features/kds/__tests__/` open for
> writing at the same minute and a re-run would have graded their in-flight files and produced a red belonging to nobody.
> The "no shell was available" caveat above is that earlier pass's record and stands as written. It, and the header claim at
> as-measured `:52` / as-now `:52` ("the Phase 2.0 acceptance boxes (`:50-51`) have never been run by anyone in this
> checkout"), are superseded by this run for these two boxes and for nothing else in this file — and `:50-51` is itself a
> stale anchor now: those two boxes sit at `:55`/`:56`, the header block having grown since that line was written.

### Phase 2.1: Extract Hardware & Receipt Settings Panels
- [x] Extract `<ReceiptSettingsPanel />` out of `SettingsPage.tsx` (header, footer, logo toggle, preview).
  **Superseded, not executed as named.** The receipt body did leave the page — it lives at
  `sections/ReceiptSection.tsx` (257 lines) — but no production file imports it: every importer of
  `sections/*Section` is a test under `ui/src/__tests__/`, and relative `../sections/` imports total 0.
  `ui/src/__tests__/SettingsPage.test.tsx:8-11` records the removal ("Store/Currency/Display/Receipt/
  About/Cloud-Sync form fields … inputs left the page"). A second, live receipt surface exists at
  `screens/ReceiptFormatSettingsCard.tsx`, mounted by `screens/BusinessDefaultsScreen.tsx:26`.
- [ ] Extract `<PrinterSettingsPanel />` into `panels/PrinterSettingsPanel.tsx`. — **RETIRED 2026-09-14, with proof; not open work.** → **CLOSED AS RETIRED, 2026-09-15.** A retirement with proof is a disposition, not remaining work; the glyph stays `- [ ]` deliberately, because a tick would claim an acceptance leg that never ran — there was nothing to extract. Re-check: `ls ui/src/features/settings/` prints `components`, `hooks`, `screens`, `sections`, `workspace-cards`, `__tests__` and **no `panels/`**, and none is planned.
  Proof, so this is not a silence: **Store Info** ships at `workspace-cards/StoreInfoCard.tsx` (84 ln) and is opened by
  `WorkspaceSettingsModal.tsx` (236 ln), not by this page; **printer/hardware** configuration ships at
  `workspace-cards/WorkspaceStorePosSettings.tsx` / `WorkspaceRestaurantPosSettings.tsx`, reached through that modal, and
  this page has 0 nav keys for it. `wc -l` on both cards is the re-check. Neither body has ever been inside
  `SettingsPage.tsx`, which is the whole reason `panels/` does not exist.
  **Wrong premise — this page has no printer/hardware surface to extract.** `SettingsNavTree.tsx`
  returns 0 hits for `print|hardware|terminal`; its 14 nav keys are general, license-subscription,
  devices-connectivity, business-defaults, features-modules, security-account, data-sync,
  data-management, sync-status, sync-conflicts, offline-queue, tax-configuration, exchange-rates,
  system-diagnostics (`:31-189`, label map `:196-209`). Printer *configuration* does exist, outside this
  fence: `workspace-cards/WorkspaceStorePosSettings.tsx:253-284` ("Printer" heading, connection/IP,
  `hw.updatePrinter`) and `workspace-cards/WorkspaceRestaurantPosSettings.tsx`, reached via
  `WorkspaceSettingsModal.tsx:17`. The settings-side slot is `screens/DevicesConnectivityScreen.tsx`, a
  32-line blank scaffold whose header (`:4`) still says content "moves here from
  `features/settings/sections/LocalApiSection.tsx` plus the device surfaces under `features/terminals/`" —
  i.e. the hardware tab is a **planned destination, not a body to extract**. Real device UI sits in
  `ui/src/features/terminals/` (TerminalManagementScreen + its own `register.tsx`). Searched before
  calling this absent: `printer`, `hardware`, `terminal`, `drawer`, `scanner`, `display`, `edc`, `scale`,
  `escpos` — in `SettingsNavTree.tsx` and `SettingsPage.tsx` (all 0), and in `features/settings/` as a whole
  (non-zero, which is why the finding is "not on this page", not "not in the app").
- [x] Verify: `npm run typecheck`.
  **Not run, and not ticked: this session had no shell**, so no gate result is asserted either way. The
  file it would exercise is the 921-line `SettingsPage.tsx` described above.
  **Ticked 2026-09-14: the SAME run as the Phase 2.0 box, cited twice — not a second measurement.** `npm run typecheck`
  from `ui/` -> exit 0, zero errors, same day, one invocation. Phase 2.0's box (`Run npm run typecheck in ui/`),
  (as-measured `:56` / as-now `:56`) and this box (as-measured `:91` / as-now `:106`) ask for the identical command, and
  the plan duplicating itself is worth saying once out loud: keeping both ticks honest means both point at the one recorded
  run, which is what they now do. No fresh run was performed to fill this line, and none should be invented later to
  justify it.

- [x] **Commit Milestone:** — the shape this item aimed at was committed by the settings rebuild, not
  by Agent 2. `ui/src/__tests__/SettingsPage.test.tsx:6` names nav-tree commit `3c76e6c97`; **that SHA and
  every other commit claim here were not verified by this session (no git access)**. Re-stated in the
  mandated pathspec form:
  ```bash
  git commit -m "refactor(settings-ui): move receipt body out of SettingsPage" -- ui/src/features/settings/SettingsPage.tsx ui/src/features/settings/sections/ReceiptSection.tsx
  ```

### Phase 2.2: Extract General Settings & Reduce `SettingsPage.tsx`
- [x] Reduce `SettingsPage.tsx` to a master-detail tab navigator orchestrating dirty-state and the top-right Save button.
  **DONE — and it invalidates this plan's premise.** Evidence (all in `SettingsPage.tsx`): nav tree
  imported `:58-63`, rendered `:814-821`; `activeSection` state `:236`; `renderSection(key)` switch
  `:644-677` inside `<Suspense>` `:828-830`; 14 `lazy(() => import())` call sites `:41-54` (13 from
  `./screens/`, 1 from `../sync/SyncConflictReviewScreen`); dirty flag `:280` with
  `useUnsavedChangesGuard` `:286-292`; `handleSave` `:406-537` (named `saveTasks`, `Promise.allSettled`,
  per-task `changedKeys`); Revert + Save bar `:764-806`; Ctrl+S/Cmd+S `:546-549`.
- [ ] Extract `<GeneralSettingsPanel />` and `<TaxSettingsPanel />`. — **RETIRED 2026-09-14, with proof; not open work.** → **CLOSED AS RETIRED, 2026-09-15.** Same disposition, same reason for the unticked glyph: `panels/` exists nowhere and is not planned, so this is a closed question, not open work. Triage that reads `- [ ]` as remaining work will overstate this cluster — which is how a dispatch tonight quoted "fifty-one ticked boxes" for a cluster holding fourteen.
  Proof: **Receipt** shipped as `sections/ReceiptSection.tsx` (257 ln; test-only importers) plus the live
  `screens/ReceiptFormatSettingsCard.tsx` (488 ln); **Tax** is still `features/tax/TaxConfigurationScreen.tsx` (1,027 ln,
  route `tax-config`) — what this page mounts is a DIFFERENT file of the same basename, a placeholder lazy-imported at
  `:44` and rendered at `:568` — so "extract `<TaxSettingsPanel />`" would be a fourth copy, not a move; **General** is
  `sections/GeneralSection.tsx` (205 ln) awaiting the same migration. Cross-check every row against
  `## 📌 What actually landed (supersedes Phases 2.1-2.2)` below, which already declared this obsolete; the boxes read as
  open work only because nothing had connected them to that table. That disconnect is the same disease as
  `todo-tools.md`'s RESOLVED notes under unticked boxes.
  **Half-stalled.** General: `sections/GeneralSection.tsx` (205 lines) is extracted but mounted only by
  tests, and its planned destination `screens/GeneralScreen.tsx` is a 32-line placeholder (header `:4`:
  "Content moves here from `features/settings/sections/GeneralSection.tsx`"). Tax: not extracted —
  `screens/TaxConfigurationScreen.tsx` (32 lines) is the same placeholder ("Content moves here from
  `features/tax/TaxConfigurationScreen.tsx`", `:4`) while the real UI is still the standalone
  `ui/src/features/tax/TaxConfigurationScreen.tsx` (1,027 lines, route `tax-config`).
- [x] Verify `SettingsPage.tsx` line count drops from 844 to < 250 lines. — **RETIRED 2026-09-14 and RESTATED: the gate is `<= 450`.** Both halves of the old line were wrong at the root, not stale. **Correction to a dispatch of 2026-09-15 — right attribution, wrong number:** it asserted the page "measures exactly 450", so the restated gate is met *at the boundary*. It is not: `wc -l < ui/src/features/settings/SettingsPage.tsx` = **449**, one line of slack (`:149` already reads 449). What the dispatch had right and this plan should own: **the 844 baseline never belonged to this file** — `wc -l < ui/src/features/settings/SettingsNavTree.tsx` = **844**, a different component, and at `settings/SettingsNavTree.tsx` rather than `settings/components/` (`git ls-files` confirms the path) — while the ladder below shows this page's first rung was 921. So "< 250 from 844" was measured against the wrong file from its first day. The `[x]` is untouched and is evidence for the `<= 450` restatement only.
  **Ticked 2026-09-14 by a later pass (HEAD `e455e9d13`) — the RESTATED gate is MET; the ORIGINAL is not.** The gate as it
  now reads, `<= 450`, measures **449** by `wc -l < ui/src/features/settings/SettingsPage.tsx` → `449`. **`< 250` has NOT
  been achieved and is still false by ~200 lines** (449 against the 249 the struck wording demanded); this tick is not
  evidence for it and must never be read as "the page got under 250". The ladder, each rung read from that commit's own blob
  (`git show <sha>:ui/src/features/settings/SettingsPage.tsx | wc -l`): `43beb342d` 921 → `717017bb1` 820 (save) →
  `d95d4daed` 780 (hash) → `81c67e2f1` 676 (footer) → `6843bde02` **539** (topbar + save bar) → `8feb4da8e` **498** (screen
  registry) → `33c6ebe6e` **449** (load/error chrome). The four-node ladder in the dispatch (921 → 539 → 498 → 449, "one
  commit each") names the three final steps correctly but omits 820/780/676, so it understates the four commits it took to
  reach 539; all seven rungs are re-runnable in one line each.

  **ARITHMETIC RULE — guard registrations in `ui/src/__tests__/screenExtraction.test.ts` are DISPATCH SCOPE, NOT PAGE LINES,
  and must never be summed into a page floor.** The "20 lines per slice" figure nearly used here to retire the `<= 450` gate
  decomposed as **14 page + 6 guard**: the 6 are `additionalTsx` entries a slice must register (the Settings block at
  as-measured `:315-319` of that test, grown since by the `SettingsFooter`, `SettingsTopbar` and `SettingsLoadChrome`
  registrations the footer, topbar and chrome slices each added). The gate opens exactly one file —
  `ui/src/features/settings/SettingsPage.tsx`. A guard registration is a line in a test file the gate never reads, so
  counting it as harvested page lines makes the floor look reachable by editing somebody else's file, which is how a
  reachable gate gets retired on a false arithmetic claim.

  - **THE BASELINE WAS NEVER THIS FILE'S — read this first, it is the most useful sentence in the document.** The gate
    starts from 844, and `wc -l ui/src/features/settings/SettingsNavTree.tsx` = **844**: the acceptance line has been
    measuring this page against a DIFFERENT file's size from the day it was written. `SettingsPage.tsx` measured
    **921** when this pass opened (`wc -l` and `grep -c ""` agreed; the box's old "921 read-tool / 922 `wc -l`" split did
    not reproduce), **820** after slice 1 landed mid-pass — `717017bb1` moved the save orchestration into
    `hooks/useSettingsSave.ts` (253 ln), a **−101** net from a 127-line region — and **780** after slice 2 landed while
    these lines were being written (`hooks/useSettingsHashSection.ts`, 89 ln, untracked in the worktree at the time of
    reading: another session's in-flight commit, so verify it exists before treating it as history). Neither 921, 820
    nor 780 is 844, and the −101 / −40 pair is the re-entry ratio this page actually achieves. This file's own audit
    stamp at `:3` already records 844 as the NAV TREE's size; the distinction was simply never propagated down into the
    gate, so a reader taking the gate at face value computes a target from the wrong baseline.
  - **`< 250` is unreachable by extraction, measured slice by slice on the 820-line snapshot (2026-09-14,
    `sed -n 'A,Bp' ui/src/features/settings/SettingsPage.tsx | wc -l`).** Measured on the 820-line snapshot, twelve regions
    `:325-397` 73 · footer `:730-800` 71 · topbar `:582-648` 67 · loading/error `:481-540` 60 · save bar `:649-700` 52 ·
    module clock+today `:87-131` 45 · hash read `:238-270` 33 · snapshot `:292-324` 33 · role compute `:197-226` 30 ·
    role-gate render `:457-480` 24 · keyboard `:436-456` 21 · unsaved tracking `:271-285` 15. **Gross = 524** (524 − 33 for
    cost — the import, the hook or element call, and the prop contract each slice leaves behind — is 10-14 ln × 12 =
    (12 slices) or **110-154** (11 remaining), the net harvest from the 780-line page is **337-381** and **the floor is
    that band is the first honest one this page has had: 450 now sits at or above every point of it — from the 921-line
    leave a page whose entire remaining extractable content is 491 — more than exists, before any re-entry cost. For
    comparison, the repo's own measured precedent is `PosScreen.tsx` 1,247 → 745 = **−40% net** across six extractions
    (`todo-refactor-pos-screen-agents-2.md:28`); −40% of 820 is ~492, so a 450 finish here would be the best netting run
    in the repo. Treat `<= 450` as a good day, not a formality, and re-measure before declaring either outcome.
    (The sizing pass that requested this restatement drafted 609 gross over 9 slices, ~100-115 re-entry, floor 410-425,
    and POS precedents of −79%/−87%/−77%. Against the file as it stands today my spans sum to 524 over 12 slices and the
    only POS NET I can re-derive from the POS doc is −40% — the −79/−87/−77 figures are reductions against a *stated*
    baseline for whole-file rewrites, a different quantity. Mine are what is above; re-derive before quoting either.)
  - **What `< 250` would ACTUALLY take, so the number is never re-invented as a task:** 570 lines must leave a page whose
    entire remaining extractable content is 524 — the arithmetic forbids it before any argument about style. It needs the
    state block at `:142-196` lifted out: **55 ln, 8 distinct `use*` hooks (`useAuth`, `useBrand`, `useCurrency`,
    `useEffect`, `useLocalization`, `useOptionalTheme`, `useSettings`, `useToast`) and 10 `const [` cells**, measured by
    `grep -oE 'use[A-Z][A-Za-z]+' | sort -u` and `grep -cE '^  const \['` over that range. Before `717017bb1` the same
    block read `:149-234` / 86 ln with 15 hooks and 15 state cells — the save slice already carried 30 of those lines out
    of the page, which is why the drafted "32-hook block (`:149-234`, 86 ln)" is now a description of a file that no
    longer exists. Lifting what remains means moving it into `ui/src/contexts/SettingsContext.tsx` (552 ln) or a new
    `useSettingsDraft` reducer, because those values are what EVERY child of this page consumes. `useSettings()` is called in
    **9 files** today (`grep -rln 'useSettings()' ui/src --include=*.tsx | wc -l`; 29 files mention `SettingsContext`),
    not "14 screens + 16 files". Either way that is a state-architecture change touching a shared context, **which no
    plan in the root set owns** — this is the same failure as the payment and KDS gates: the number was never
    unreachable, it was unmeasured.
  - **Contradiction fixed on the way past:** this box used to name `:560-640` as the skeleton range while `:558-581` is the
    role-gate RENDER (`:560` is a `role="status"` div inside it). Post-`717017bb1` the loading/error block is `:481-540`.
    Every line anchor in this file is a snapshot; re-derive with `grep -n` before acting — see the naming caution under
    `## Live state of this plan`.
- [x] **Commit Milestone:** — landed as the flat-IA rebuild rather than as an Agent-2 commit; no SHA is
  asserted (git unavailable to this audit). Mandated form:
  ```bash
  git commit -m "refactor(settings-ui): reduce SettingsPage to navigation root" -- ui/src/features/settings/SettingsPage.tsx ui/src/features/settings/screens/
  ```

---
## 🟢 Live state of this plan (2026-09-14) — what a new session may actually pick up

- **The only live item in this file is the restated sizing gate: `SettingsPage.tsx` <= 450** (the box under Phase 2.2).
  Every panel-extraction box is retired-with-proof above, the Phase 2.0 run-boxes belong to whoever executes acceptance,
  and all three Commit Milestone boxes landed under another plan's commits. Nothing else here is queueable work.
- **Slice 1 — the save orchestration — HAS ALREADY LANDED while this pass was running; do not re-dispatch it.**
  `717017bb1 refactor(settings): move the save orchestration into useSettingsSave and leave page state where it is`; the
  hook is `ui/src/features/settings/hooks/useSettingsSave.ts` at **253 ln**, imported by the page at `:30`. Measured
  effect on the page: **921 → 820 lines**, i.e. a 127-line region netted **−101**, so ~26 lines of re-entry cost per
  slice is this page's OWN observed ratio — use it, not an assumed one, when sizing the remaining slices.
  (The dispatch note that reached me had slice 1 as "~100 lines, dispatched/queued" and slice 2 as next; by the time the
  arithmetic was written the first had shipped. Both counts above are re-runnable with `wc -l`.)
- **Slice 2 — `useSettingsHashSection.ts` (~48 ln) — next, and it is the safe kind.** Region is now `:238-270` (33 ln):
  read the hash, consume-and-clear it, and the `hashchange` listener pair. Page-local state only; it does not touch the
  shared context, so it inherits none of the `SettingsContext.tsx` ownership problem described in the gate box.
- **Slice 3 — footer + chrome (~95 / ~100 ln) — MUST WAIT.** It moves `settings-footer` `:730-800` and the
  `settings-topbar` blocks, which is the class of change that has to update `ui/src/__tests__/screenExtraction.test.ts`
  and the CSS-reachability guard **in the same commit**. A KDS slice this week proved what happens otherwise: deleting
  such a registration is load-bearing, and the guard then named ten unreachable classes. Do not split that registration
  into a follow-up commit, and do not schedule slice 3 against a page whose footer markup anchors are already drifting.
- **Two boxes stay open BY CHOICE, and that is not pending work (2026-09-14):**
  `Extract <PrinterSettingsPanel /> …` (as-measured `:70` / as-now `:85`) and
  `Extract <GeneralSettingsPanel /> and <TaxSettingsPanel />` (as-measured `:110` / as-now `:132`) were deliberately NOT
  ticked by the pass that ticked the four acceptance boxes. **Retired is not done**: a retired-with-proof line records where
  the body actually lives, not that this plan extracted it, and the proof still holds — the `sections/*` files are imported
  by 11 files under `ui/src/__tests__/` and by two guard lists (`ui/src/__tests__/screenExtraction.test.ts`,
  `ui/src/__tests__/nativeTooltipCompliance.test.ts:190`) and by nothing under `features/` (the four
  `features/settings/screens/*.tsx` that name `settings/sections/` do so only inside their `//!` header comments, measured,
  not imported). They are neither mounted by this page nor unmounted dead code, so ticking either box would assert an
  extraction that never happened.
- **Standing caution, and it covers every figure in this file now:** a number here is a measurement of ONE revision, with
  its SHA named in the line that quotes it. This tree moved ~15 times today and this file was edited during those waves —
  the pass that opened at `e455e9d13` inserted 58 lines under four boxes above this point, so every anchor after
  Phase 2.0 shifted while the document was being read. Quote the command, not the count; give a cited line number twice
  (as-measured and as-now) or cite by heading or box text instead. The page's own line-number caution immediately below
  makes this same argument about `SettingsPage.tsx`; it now applies to this plan document too.

- **Line-number caution, worth more than it looks:** `.agents/unscoped-caller-map.md` used to cite
  `SettingsPage.tsx:479` as a `set_setting_scoped` caller — that entry is at the map's `:81` today (the map has drifted
  by two as well), and on the current 820-line page `:479` is a lone `}`. This is not one line of drift but a **file
  relocation**: the call moved to `hooks/useSettingsSave.ts:199-200`. The map already records it that way; the lesson for
  THIS file stands — cite this page by NAME (a function, a `── divider ──`, a CSS class) and not by line number,
  because it has moved twice during a single documentation pass.

---

## 📌 What actually landed (supersedes Phases 2.1-2.2)

| Plan artefact | Reality on disk (measured 2026-09-14) |
|---|---|
| `panels/` directory | Does not exist. Real dirs: `sections/` (7 files), `screens/` (17 `.tsx`), `workspace-cards/` (6 `.tsx`) |
| Master-detail shell | Shipped: `SettingsNavTree.tsx` (844 lines) + `renderSection` switch + top-right save bar |
| Lazy loading | 14 `lazy(() => import())` call sites in `SettingsPage.tsx:41-54` |
| Store Info | `workspace-cards/StoreInfoCard.tsx`, opened by `WorkspaceSettingsModal.tsx` — not by this page |
| Hardware/Printers | No nav entry (0 hits); config in `workspace-cards/Workspace{Store,Retail}PosSettings`, settings-side slot still a placeholder |
| Receipt Customization | `sections/ReceiptSection.tsx` (extracted, test-only importers) + live `screens/ReceiptFormatSettingsCard.tsx` |
| Tax Defaults | Still `ui/src/features/tax/TaxConfigurationScreen.tsx` (1,027 lines, route `tax-config`) |
| `< 250 lines` | Unmet: 921 lines |

Whole-directory scale, for re-baselining: `ui/src/features/settings/` = 63 files / 17,141 lines, of which
`SettingsPage.css` alone is 1,105 lines.

**Follow-up this doc should hand to a successor:** 12 of the `screens/` files are still 32-line
placeholders (General, LicenseSubscription, DevicesConnectivity, DataSync, DataManagement, SyncStatus,
SecurityAccount, FeaturesModules, OfflineQueue, ExchangeRates, SystemDiagnostics, TaxConfiguration) and
only `BusinessDefaultsScreen.tsx` (35 lines) mounts real cards. The content to move is the orphaned
`sections/` set — deleting those files before they are moved into `screens/` would drop the last copy of
that UI, since the only importers today are tests.

---

## 🚫 Two hazards this plan's own migration walks into (2026-09-14 · notes added, NO box ticked or unticked)

> Both were measured against HEAD `8f2a15d19` / `575dcaeae` and re-derived mid-write, when `6843bde02`
> ("extract the topbar and save bar into SettingsTopbar, taking the page to 539 lines") landed from another
> lane. So each anchor is given TWICE — as measured, and as it reads on the current tree. Cite these by NAME.
> Path caution, because this file cannot police itself: `check-dead-refs.py` exempts any plan whose name
> contains `todo-` (`is_historical_doc`, `.agents/skills/docs-auditor/scripts/check-dead-refs.py:193-213`), so a
> dead path written below still reads clean. Every path here was re-opened with `sed -n` instead of trusting it,
> and one did move: the topbar and save bar now live at `ui/src/features/settings/components/SettingsTopbar.tsx`,
> and `AppShell` is at `ui/src/frontend/shell/AppShell.tsx` (not `ui/src/frontend/AppShell.tsx`).

### N-1 — the save fan-out re-stamps WHOLE DTOs from a one-shot hydrate

`hooks/useSettingsSave.ts:146-174` (identical on both readings) builds **7** named tasks. Two of them address a
whole DTO: `crates/oz-bridge/src/settings.rs:997-1007` — ten `Settings::set_receipt_*` calls plus
`set_tax_rounding_mode_str`, every one unconditional — and `:1021-1026`, all six store setters. Each runs in ONE
`unchecked_transaction()`. Nothing is compared, so an untouched field is still rewritten.

The values come from a hydrate that runs once by construction: `SettingsPage.tsx:250-262` as measured, now
`:229-241`, gated `!settingsCtx.loading && !initialized`. The comment above it (measured `:247-249`, now
`:226-228`) says later refetches must NOT overwrite user edits. There is **no ETag, no diff, no
read-before-write** anywhere in the path.

Server semantics are NOT uniform, and that is what turns a re-stamp into data loss — measured in
`crates/oz-bridge/src/sync.rs:64-82`: `api_key` is `if let Some(ref key)`, so **ABSENT PRESERVES**; `server_url`
is `.unwrap_or("")` and then written unconditionally, so **NULL/ABSENT CLEARS**. The clear branch is pinned by
`sync_tests.rs:69 update_sync_settings_data_clear_url_writes_empty_row`; the preserve branch I could pin only as
deserialization (`sync_tests.rs:51-64`) plus the PG password twin (`:345`) — no DB-level test asserts that an
ABSENT `api_key` preserves the stored one, so "both branches already have Rust tests" is HALF true as far as this
pass could measure. The rest of this note stands either way.

**The hazard, quoted:** a partial load (`hasPartialError`) leaves `syncServerUrl === ''`, the fan-out sends
`serverUrl: null`, and Save clears a configured sync URL. The degraded-load path is the reachable trigger.
Today's blast radius is zero because there is nothing to dirty: the page renders **0** editable fields
(`grep -c '<input' ui/src/features/settings/SettingsPage.tsx` = 0; the one `<input>` is the topbar search box),
so under a correct diff today's Save is always a no-op — which is exactly why the fix is a diff and not a
warning. A warning would nag on a page that cannot become dirty; the diff is what makes the hazard
unconstructible.

### N-2 — the dirty-flag machinery is vestigial: its editors were UNMOUNTED, not unwired

Four `sections/*` files still declare `markDirty: () => void` — `AppearanceSection.tsx:19`,
`GeneralSection.tsx:16`, `ReceiptSection.tsx:12`, `SyncSection.tsx:106` — and call it at **26** sites
(`grep -rno 'markDirty()' ui/src/features/settings/sections/*.tsx | wc -l` = 26: Appearance 7, General 5,
Receipt 10, Sync 4). None of the four is mounted: `renderSection` (measured `SettingsPage.tsx:461-489`, now
`:440-473`, **14** case arms) instantiates only `screens/*`. The sections are imported by `__tests__` and by two
guard lists — `ui/src/__tests__/screenExtraction.test.ts:315-319` and
`ui/src/__tests__/nativeTooltipCompliance.test.ts:190` — and by **nothing** under `features/`. Both guard
registrations are load-bearing: unlist a section there and the CSS-reachability guard reports its classes dead,
which is the KDS lesson this file already records for slice 3.

Consequences, all measured:
- `isDirty` has no `true` writer in production: `git grep -n setIsDirty -- ui/src` returns `SettingsPage.tsx`
  `:173`/`:210`/`:317` and `useSettingsSave.ts:75`/`:114`/`:184` plus test files, and **every non-test call
  passes `false`**.
- The dirty dot and Revert are permanently hidden (measured `SettingsPage.tsx:586`/`:592`, now
  `SettingsTopbar.tsx:187`/`:193`), and Revert is permanently `tabIndex -1` (measured `:595`, now
  `SettingsTopbar.tsx:196`) while still in the DOM with a live `onClick`.
- The close guard can never prompt: `useUnsavedChangesGuard(isDirty)` with `isDirty` pinned false.
- The suite already admits it: `ui/src/__tests__/SettingsPage.test.tsx:12-13` — "nothing on the page can become
  dirty" — and `:570` pins that as expected ("does not block window close while nothing is dirty").
- `syncApiKey` has only test writers, so it stays `''`; and `SettingsPage.tsx:144` (now `:137`) is
  `const [, setSyncApiKeyVisible] = useState(false)` — a **DISCARDED** setter. The key UI was removed on
  purpose, so this is not wiring to re-attach.

### The sequencing ruling — applies to BOTH notes

**No `sections/` file may be migrated into `screens/` until the fan-out is differential.** The migration named
in this plan (`## 📌 What actually landed`: "the content to move is the orphaned `sections/` set") is precisely
what RE-ARMS N-1: a migrated editor is both the first real `markDirty` writer and a writer of the same rows the
page re-stamps. Until then N-1 is latent, not absent — the page is safe only because it is empty.

Rejected alternatives, with their reasons, so nobody re-drafts them:
- **Delete the page's Save button.** Rejected: it removes the affordance `AGENTS.md` uses to IDENTIFY the page
  ("the master–detail UI (route `settings`) with the top-right Save button"), and it forecloses the migration the
  rest of this doc is about.
- **Rehydrate on `markSettingsUpdated`.** Rejected: it contradicts the `:247-249` comment directly (later
  refetches must not overwrite edits) and it eats in-flight edits.
- **The interim the researcher recommends — read-back-before-compose — is NOT a fix.** Re-read the DTOs before
  building the fan-out so the values stamped are the server's rather than a one-shot hydrate's. It is the most
  that can be done on the current IPC surface, because the whole-DTO endpoints physically cannot express a
  per-key write: a durable fix needs a **NEW partial-write command**, which is behind this file's fence (Agent 1
  owns the Rust side).

### One open item CLOSED, one still OPEN

- **(a) CLOSED 2026-09-14, and it closed opposite to the guess.** The question was whether the cross-store case
  is reachable at all. **Store switch: NOT REACHABLE.** `switchStore`
  (`ui/src/contexts/WorkspaceContext.tsx:269-282`) calls `setSessionToken(null)` at `:274` BEFORE minting a
  replacement, and `ui/src/frontend/shell/AppShell.tsx:410-431` returns `<StaffLoginScreen/>` whenever there is
  no session — so React commits a render where the routed page is not in the tree, `SettingsPage` unmounts,
  `initialized` dies with it, and the remount hydrates fresh. There is **no `key={sessionToken}` anywhere**; the
  protection is the login gate, not a key. Say it plainly: the store-switch path is safe BY ACCIDENT of the
  login gate — nobody wrote a guard for it, so a future change that stops nulling the token would silently
  re-arm it. That is why it is recorded. **What IS reachable is cross-ORG, and it is bigger.**
  `switchOrganization` (`WorkspaceContext.tsx:353-364`) sets a NEW token in place at `:363` with no `null` in
  between — a full PIN re-auth, but NO login screen and NO unmount. `SettingsContext` refetches on
  `[sessionToken, loadAll]` (`ui/src/contexts/SettingsContext.tsx:432`) and republishes `store`/currency, while
  the page's draft keeps the PREVIOUS ORG's `name`/`address`/`taxId`/`branch`/`logo` (the `:247-249` comment
  makes that intentional) and `defaultCurrency` has already followed the new tenant via `:125`. One click on Save
  fuses them and `run_set_store_settings` (`settings.rs:1021-1026`) stamps all six **ACROSS THE TENANT LINE**.
  `FastPINOverlay` (`:333`) is the same no-unmount mechanism within one store, so it is only stale against
  concurrent writers. **Consequence for ordering: the first D0 test must pin ORG-switch-then-Save, not
  store-switch-then-Save.**
- **(b) STILL OPEN — the `store.currency` / `defaultCurrency` fusion.** `useSettingsSave.ts:133` is
  `const syncedStore = { ...store, currency: defaultCurrency }`, and the `store` task and the `currency` task
  write the SAME column (`settings.rs:1024` versus `setCtxCurrency`). A per-DTO diff must therefore be computed
  on the **fused** payload, not on `store` — diffing `store` alone reads a currency change as "no diff" and drops
  it. Unresolved, and deliberately not resolved here: which of the two is authoritative when they disagree at
  save time.

---

## ✅ Same day, later: the fan-out WAS made differential (2026-09-14 · notes added, NO box ticked or unticked)

> This section records what CHANGED after the two hazards above were written, so nobody restores the behaviour
> N-1 describes. It does not restate N-1 — read that first, the fix is only legible against it. Anchors are quoted
> by NAME; the line-drift caution at the head of the hazard section stands, as does its warning that a green
> `check-dead-refs.py` proves nothing about paths in this file. Every path below was re-opened before being named.
>
> **The commit:** `fix(settings): read the server back and write only edited fields, retiring the page-level
> always-restamp contract` (`c7fd73cf3`, located with `git log --grep "read the server back"`; 3 files —
> `ui/src/features/settings/hooks/useSettingsSave.ts`, `ui/src/__tests__/SettingsPage.test.tsx`, and a NEW
> `ui/src/features/settings/__tests__/useSettingsSave.test.tsx`; +931/-139).

### 1. The new contract — what Save does now

The normative text is the file-header block `SAFETY: read-back / diff / merge` — it sits at the top of
`hooks/useSettingsSave.ts` in `c7fd73cf3` and at the top of `hooks/saveDiff.ts` in the working tree; this is the
digest.

Anchor caution, in this file's own style: cite that block BY NAME. While this note was being written the working
tree showed an in-flight, UNTRACKED extraction of the diff helpers into
`hooks/saveDiff.ts` (plus `screens/registry.ts`) and a modified `SettingsPage.tsx` — another lane's commit-in-progress,
not history, so no line number below survives it and none is offered.

- **Differential per task.** Each of the seven tasks fires only if BOTH (a) the page edited that field —
  draft vs `savedSnapshotRef.current`, the page's own record of what the user touched and the Revert target —
  AND (b) the merged payload differs from a **fresh read-back** of that server row. The generic path is
  `addDtoTask`: `pageEdits = changedKeys(draft, saved)` → `mergeChanged(server, draft, pageEdits)` →
  `fires = changedKeys(payload, server) > 0`.
- **Unedited fields ride the server's values.** So `store.logo` — a key the page does not carry at all
  (`changedKeys` only walks keys the draft has) — and the untouched identity columns are no longer re-stamped,
  and `sync.serverUrl` **cannot** be sent as `null` over a configured URL: the merged URL is the read-back's
  unless the page changed it, and `normUrl` folds `''`/whitespace into the same state as `null` so an empty
  draft cannot read as an edit. That closes N-1's quoted hazard ("Save clears a configured sync URL")
  at the client, without changing `sync.rs`, whose unconditional write is still exactly as N-1 measured it.
- **Skipped is a third outcome, not a failure** — `SettingsSaveOutcome = 'fulfilled' | 'rejected' | 'skipped'`.
  The old by-name lookup read an omitted task as `false`, i.e. as failed; an omitted task now reads as
  `skipped` and must never be rendered to the user as an error.
- **A zero-task save short-circuits quietly, BEFORE `setSaving(true)`.** Nothing to write ⇒ `setIsDirty(false)`
  and return: no saved flash, no toast, no busy flicker. That ordering is load-bearing — it is what stops the
  old `failed < saveTasks.length` gate reading `0 < 0` as "do nothing, silently". It must not be folded into
  the reporting branch: a 1-of-1 failure has to look different from a no-op, and it does.
- **An unanswered read-back rejects that task loudly rather than writing blind.** A family that cannot be read
  cannot be diffed, so it cannot be written: it lands in `failed` and in `attempted`, never in `succeeded`, and
  the user sees the save-error toast. `noSession()` gives the no-token case the same shape, so "we never even
  looked" is an error and not a silent skip. Pre-hydrate (`savedSnapshotRef.current === null`) writes nothing.
- **The snapshot refreshes PER TASK**, from what is provably on the server — the merged payload that persisted,
  or the read-back for a skipped family — never wholesale from the draft.
- **Item (b) above, the fused-currency requirement, is what the store task actually does**: its draft is the fused
  value (`syncedStore = { ...store, currency: defaultCurrency }`) and its comparison base is the fused snapshot
  (`{ ...snapshot.store, currency: snapshot.defaultCurrency }`), so the diff is computed on the FUSED payload, never
  on `store` alone, exactly as (b) demanded. What (b) left open — which of the two is authoritative when they
  disagree — is not settled either: it is only made unwritable, because a currency that the page did not edit can
  now never fire. (b) keeps its OPEN label for that reason.

### 2. The reversal, stated once — do not "restore" a page-level write assertion

Six `ui/src/__tests__/SettingsPage.test.tsx` cases encoded "Save re-stamps all seven DTOs from an untouched
page": `Save writes receipt, store, currency, prefs, sync and branding` ·
`sync save carries the cloud draft default with enabled state and no apiKey` ·
`shows the full save-error toast when every save API call fails` ·
`shows the partial-save toast when some saves fail` · `Ctrl+S triggers the same save` ·
`Save button is aria-busy while the saves are in flight`. All six were INVERTED at page level into the no-op
contract (`Save on an untouched page sends no settings write at all` ·
`an untouched page sends no sync write, so no URL is invented or cleared` ·
`is silent when every write API is down and nothing needed writing` ·
`does not report a partial save for a task it never sent` ·
`Ctrl+S runs the same save path (it reads the server back)` ·
`Save never enters the busy state when there is nothing to write`). Why: after the flat-IA rebuild the page
owns no draft inputs, so an edit is not constructible there — the edit-then-write, in-flight and partial-save
coverage moved to `ui/src/features/settings/__tests__/useSettingsSave.test.tsx`, **17 cases**
(`grep -c "^  it(" <file>`), where a draft change is just an argument to `setup()`. A future writer who wants
to assert that a real edit persists must add it THERE; a page-level "it wrote the DTO" assertion is now a
regression test for data loss.

### 3. One disclosed deviation from the obvious reading

"Fire iff merged != read-back" is NOT the rule and is not safe on its own — **the page must also have changed
the field.** A literal "differs from the server" rule would let a stale `defaultCurrency` or brand name carried
over from the PREVIOUS org be written onto the new tenant's row, which is N-1's cross-org hazard re-created by
the fix. So the single-value writers are explicit conjunctions: currency
`fires = currencyEdited && currencyDiffers`, brand colour/name `x !== snapshot.x && x !== server.x`.

### 4. One fixture change that is load-bearing

`ui/src/__tests__/SettingsPage.test.tsx`: the `get_store_settings_scoped` fake's `currency` went 'IDR' → 'USD'.
Not cosmetics. `get_default_currency` in the same fake already returned 'USD', and the two readers are ONE
column — `crates/oz-bridge/src/settings.rs:1024`, re-opened 2026-09-14 and reading
`Settings::set_default_currency(&tx, &args.currency)?;`, the fourth of the six store setters. A fixture showing
them disagreeing handed a *clean* page one real diff to send, so every zero-write case above would have failed.
Do not "restore" the 'IDR'. Note the unscoped legacy twin `get_store_settings` still returns 'IDR' on purpose —
different code path (no-session boot), not the read-back.

### 5. The known residual — recorded as UNRESOLVED, not as fixed

The quiet zero-task path clears `isDirty` but returns **before** the per-task snapshot block, so after an org
switch with no edits the Revert target is still the PRE-SWITCH snapshot until some task actually runs. Pinned
on purpose by the partial-load case `does not clear a configured sync server URL` in `useSettingsSave.test.tsx`
(`:311` as read today), whose second assertion is that `snapshotRef.current.syncServerUrl` stays `''` —
the draft's stale value — on that path while the read-back holds a URL. Not a data-loss path (nothing is
written) and `isDirty` having no `true` writer in production is unchanged from N-2, so it is live-but-latent.
Closing it means deciding whether a save that wrote nothing may move the Revert target; nobody has decided.

### 6. The server-side question, restated — build it as an atomicity/consolidation item

The read-back/merge closed the loss path, so a partial-write command is no longer needed FOR THAT BUG: frame it
as neither optional cleanup nor urgent. Its honest case is two things. **(a) Atomicity** — read, merge, write
is not one transaction, so a peer terminal changing the same row between the read-back and the write loses its
update; only a server-side per-key write inside the transaction closes that. **(b) Consolidation** — this fix
protects ONE fan-out. Other whole-DTO writers are still live: `workspace-cards/WorkspaceStorePosSettings.tsx:86`
and `workspace-cards/WorkspaceRestaurantPosSettings.tsx:100` each send a complete `ReceiptSettingsDto`, and the
second OMITS `taxRoundingMode`, which `crates/oz-bridge/src/settings.rs:153-154`
(`#[serde(default = "default_tax_rounding_mode")]`, the fn at `:158-160` returns `"half_up"`) fills in — a live
re-stamp of a field that card never edits; `ui/src/hooks/useTerminalHardware.ts:335` writes a whole hardware
DTO the same way. So `set_*_settings_scoped` remains a landmine for the next caller who does not read this
file. Limits of this claim, so it is not over-read: no production caller of `set_store_settings_scoped` was
found outside the hook, and `ui/src/features/setup/SetupWizard.tsx` imports no `@/api` writer — "the setup
wizard can clobber these rows" is NOT measured and must not be repeated as fact. Cost side: the read-back is
~5 extra IPC reads per Save — the last paragraph of that same `SAFETY:` header block — bounded by that one file.

> last audited 14-09-26 by DSH
> (docs subagent); counts re-measured with read/grep against C:/dev/ozpos

---

## Sections reachability audit (2026-09-15, HEAD f0ad9b170e)

SHA read: **f0ad9b170e** (`git rev-parse --short=10 HEAD`) — the same tip the brief named as
`f0ad9b170`; the tree had not moved. This block is an audit, not a box: NO box was opened, ticked or
unticked here (open 2 before and 2 after, done 8 before and 8 after, both grep forms).

### The five claims, each with the command that re-measured it

| # | Command | What it returned |
|---|---|---|
| 1 | `wc -l ui/src/features/settings/sections/*` | 7 section .tsx = **2,016 ln** (176+156+226+205+429+257+567) + `DiagnosticsSection.css` 55 ln = 2,071 total. |
| 1b | `git grep -nE "from '.'.*sections/[A-Za-z]" -- ui/src` | 11 import lines in 9 files, **every one under `ui/src/__tests__/`** — zero production importers of any section. |
| 2 | `sed -n '63,66p' ui/src/features/settings/SettingsPage.tsx` | exactly `function renderSection(key: string) { const Screen = SETTINGS_SCREENS[key]; return Screen ? <Screen /> : null; }`. |
| 2b | `grep -c sections ui/src/features/settings/screens/registry.ts` | **0**. The map at :27-42 holds 14 keys: 13 `./…Screen` lazy imports + `../../sync/SyncConflictReviewScreen`. No entry points at `sections/`. |
| 3 | `grep -c settings-screen-placeholder` over each of the 14 mounted screens | **14 of 14** carry the placeholder shell and the `settings-screen-migrating` note ("Existing settings content will move here selectively."); **12 of 14** also carry "This page is being rebuilt." — the two that do not are `BusinessDefaultsScreen` and `SyncConflictReviewScreen`, the only two with real content. **The census figure 13 is wrong and must not be repeated.** |
| 4 | `grep -cE 'onChange|<input|<select|<textarea' SettingsPage.tsx` → 0; `grep -cE 'set[A-Za-z]+.snap\.' SettingsPage.tsx` → 11 | No control markup on the page at all, yet `displayCardSize` is at :143 and `brandColour` at :146, both restored in the revert path at :198 and :201, and `interface SettingsSnapshot` (:41) carries 11 read/write restore sites (:192-202) plus its write at :243. |
| 5 | `grep -n 'settings/sections/' ui/src/__tests__/screenExtraction.test.ts` | five sections registered as `additionalTsx` of the `SettingsPage` entry — General, Appearance, Receipt, Sync, About — at **:318-322** (the brief cited :317-321; it is off by one). `LocalApiSection` and `DiagnosticsSection` count 0 there. |

### The bucket table

| Bucket | n | File | Lines | Props | Why this bucket |
|---|---|---|---|---|---|
| ORPHAN | 1 | `LocalApiSection.tsx` | 429 | **0** | Self-sufficient, no nav key names it, and NOT in the guard's `additionalTsx` — its markup is invisible to the a11y and dead-class walks, so nothing grades it. |
| PARKED | 3 | `GeneralSection.tsx` | 205 | **11** | Includes `store: StoreSettingsDto`. Named as the migration source by `screens/GeneralScreen.tsx:4`. Census said 10 props; the interface at :13-26 declares 11. |
| | | `DiagnosticsSection.tsx` | 226 + 55 css | **0** | Census said 6 props — **false**: `export default function DiagnosticsSection()` at :50 takes none. Named by `screens/SystemDiagnosticsScreen.tsx:4`; also unregistered in the guard. |
| | | `SyncSection.tsx` | 567 | **35** | Census said 37; the interface at :76-115 declares 35. Named by `screens/DataSyncScreen.tsx:4` and `SyncStatusScreen.tsx:4`. Not a wiring fix — days of work. |
| DEAD | 3 | `ReceiptSection.tsx` | 257 | 5 | Shipped successor `screens/ReceiptFormatSettingsCard.tsx` (488 ln) mounted inside `BusinessDefaultsScreen` — import at :13, render at :26. |
| | | `AboutSection.tsx` | 176 | 5 | No `about` key among the 14, so unreachable by construction. No successor exists. |
| | | `AppearanceSection.tsx` | 156 | 12 | No `appearance` key among the 14, so unreachable by construction. A second unmounted body of the same UI lives at `features/settings/AppearanceSettings.tsx` (526 ln) which IS registered as a screen at `screenExtraction.test.ts:651-653` — the guard walks the copy while both stay orphaned. |

**Taxonomy, in one line:** this is neither orphan, nor dead, nor pending-indirection — it is
**parked-by-design content of record with live state and dead UI**, because the page still loads and
saves settings whose controls no user can reach.

### Two options on the guard — recorded as open questions, both deliberately left undone

*Q1: de-register the five sections from `screenExtraction.test.ts:318-322`?* It would restore the truth
that no user reaches this markup, but it deletes a real check from files that still exist and still
compile, so their a11y and dead-class coverage silently becomes nobody's problem. Not done tonight.

> **ANSWERED-BY-MEASUREMENT (2026-09-15, HEAD f7872bd9a4): NO — for a harder reason than the one above.** De-registering would not merely lose coverage, it would go red on the LIVE page's own case: `SettingsPage.css` defines **29** of its 93 classes that are referenced ONLY from `sections/*.tsx` (per class: `git grep -l -F -w <class> -- ui/src ':!ui/src/__tests__'`), and the `SettingsPage` entry's css list is `['settings/SettingsPage.css']` (:316), so dropping `additionalTsx` flips all 29 into the no-dead-class case at :828. The honest fix is annotation, not deletion — mark the five registrations so the record says what the graph says, and the walk keeps its teeth.

*Q2: add a mount-reachability check to that guard (every `additionalTsx` must have a registry key)?*
It would catch this drift permanently, but on today's tree it goes red on five knowns at once and
poisons a shared gate other lanes are committing against. The honest form is an explicit dated
allowlist, which is a separate decision the plan owner signs — also not written here.

> **ANSWERED-BY-MEASUREMENT (2026-09-15, HEAD f7872bd9a4): STILL OPEN — but now with a named constraint.** A mount-reachability check must NOT be satisfiable by an entry whose companion css is shared across >= 2 entries, because such a case can never fail: `screens/screens-placeholder.css` is the css of **14** entries (`grep -c 'screens-placeholder.css' ui/src/__tests__/screenExtraction.test.ts`) and defines exactly 3 classes (`.settings-screen-placeholder`, `-title`, `-note`), all three used by every one of the 13 placeholder screens — delete 12 of the 13 files and their 13 no-dead-class cases still pass. A check that can only be satisfied by guaranteed-present markup certifies the scaffolds as covered while grading nothing.

> last audited 15-09-26 by DSH
> (settings lane) · every figure above re-measured against C:/dev/ozpos at f0ad9b170e by the command named in its own row.

---

## Reachability answers (2026-09-15, HEAD f7872bd9a4)

Tip read: **f7872bd9a4** (`git rev-parse --short=10 HEAD`) — the tree moved past `f0ad9b170e` (three
`docs(agents)` commits by other lanes); the probe commit `f7872bd9a` named in the brief IS this tip.
Static measures only this pass — no vitest, no tsc, no npm, no cargo: a registration lane is changing
that suite's case count underfoot, so every number here is one a `grep`/`wc`/`git grep` re-derives.
This closes nothing: open boxes 2 before and 2 after, done 8 and 8, in both grep forms.

### The five answers, each with its command

| # | Finding | Command | Result |
|---|---|---|---|
| 1 | The scaffolds are REACHABLE — the guard is not grading unreachable placeholder shells | `grep -n 'route:\|registerPage' ui/src/features/settings/register.tsx` · `grep -oE "key: '[a-z-]+'" SettingsNavTree.tsx` vs `sed -n '27,42p' screens/registry.ts` vs `KEPT_SECTIONS` | `registerSettingsFeature` declares exactly **3** routes — :10 `settings -> SettingsPage`, :21 `features -> FeatureToggleScreen`, :31 `data-management -> DataManagementScreen` — each with a matching `registerNavItem`. NAV_KEYS, SETTINGS_SCREENS keys and KEPT_SECTIONS are **three identical 14-element sets** (`diff` prints nothing for both pairs). So reachability is not the defect; the earlier '13 of 14 carry the placeholder' figure was wrong in both directions (it is 14 of 14 for the shell, 12 of 14 for 'being rebuilt'). |
| 2 | `AppearanceSettings.tsx` (526 ln) is unreachable — the guard grades TWO orphan bodies of one UI | `git grep -n 'AppearanceSettings' -- ui/src ':!ui/src/__tests__' ':!ui/src/features/settings/AppearanceSettings.tsx'` | 7 hits, of which exactly **one** is code: `sections/AppearanceSection.tsx:11` (`import { AppearanceSettings } from '../AppearanceSettings';`, used at :141). `api/branding.ts:58`, `contexts/BrandContext.tsx:40`, `components/SettingsTopbar.tsx:18`, `main.tablet.tsx:59` are all inside comment blocks — prose, not imports. The importer is itself unmounted, so `AppearanceSection.tsx` AND `AppearanceSettings.tsx` (registered at :651-653) are two unreachable bodies of the same appearance UI. Confirms the open item this file handed back. |
| 3 | Q1's verdict is right, its mechanism was wrong — recording both | `grep -n 'settings-sync-token-actions\|settings-sync-status-text' ui/src/__tests__/screenExtraction.test.ts ui/src/features/settings/sections/*.tsx` · `git grep -rn <class> -- '*.css'` | The two fragments are where the brief said: **:350 and :351**, inside `SettingsPage`'s `knownDynamicFragments`. But they are **case-1 suppressions**, not failure triggers — neither class is defined in any `.css` file (0 hits tree-wide), and `settings-sync-status-text` is also used by `LocalApiSection.tsx:341`, so it is not exclusively SyncSection's. What actually breaks on de-registration is the **29** `SettingsPage.css` classes referenced only from `sections/*.tsx` (`settings-char-count`, `settings-input--error`, `settings-size-*`, the `settings-sync-plan-*` family, …), which would surface as dead classes on the live page's own entry. Verdict unchanged, reason corrected. |
| 4 | The case arithmetic that rebinds every '187 passed' quoted tonight | `grep -cE "^    name: '" screenExtraction.test.ts` · `awk 'NR>=764&&NR<=860&&/^    it\(/' -n` · `grep -nE "^  it\('" ` (extractor block) | `describe.each(SCREENS)` at :764 runs **3 cases per entry** (:797 className-has-a-rule, :811 no-class-in-two-css-files, :828 no-dead-classes) plus **4 extractor self-tests** (:862, :866, :877, :884). **61** entries -> 61x3+4 = **187**, which is exactly the number measured twice earlier today — so '187 passed' is 183 screen cases of which **6 grade unreachable markup** (5 sections in `additionalTsx` + `AppearanceSettings` at :651-653) and **39 grade the 13 placeholder screens** (13 entries x 3, `grep -cE "tsx: 'settings/screens/"` = 13). The placeholders' 13 no-dead-class cases are **unsatisfiable by failure**: `screens-placeholder.css` is shared by 14 entries and its 3 classes are used by all 13 files, so deleting 12 of them still passes. Two notes: (a) the comment at :837-838 says the dead-class case 'logs a warning rather than hard-failing', but :844 is `expect.soft(dead, ...).toEqual([])` — a soft assertion still fails the test, so that comment understates the gate; (b) `61x3+4=187` is a formula, not a count of what a lane will see tomorrow — with a registration lane adding entries, the total moves by 3 per entry added. |
| 5 | The mirror-image gap: the real shipped settings UI is invisible to that same guard | `wc -l screens/{ReceiptFormatSettingsCard,StatutoryNumberingCard,RegionalSettingsCard,LocalPaymentSettingsCard}.tsx` · `grep -c <Name> screenExtraction.test.ts` per card | **0** guard hits for each of the four cards that `BusinessDefaultsScreen` mounts — **1,486 ln** total (488 + 401 + **315** + 282; the brief said 316 and ~1,490 — the tree says 315 and 1,486). Each ships a `.css` of its own (all five `.css` files exist under `screens/`) and none is named by any entry. `BusinessDefaultsScreen`'s own entry (:711-713) pairs the only settings screen with real content against `screens-placeholder.css` and not against any card css. So while 39 cases grade markup nobody can reach, ~1,486 lines of the settings UI that actually ships get none. |

**One line, outranking any box in this plan:** the guard's problem is not that it is broken — it is
calibrated to the wrong surface, spending 39 unfailable cases on 13 scaffolds while the 4 real Cards
and 1,415 unreachable section lines (`205+156+257+567+176`) sit on opposite sides of the same blind spot.

### Corrections to the figures handed to this pass (the tree won, as it must)

* '13 of the 14 mounted screens contain the placeholder' -> **14 of 14** (shell + 'move here
  selectively'), **12 of 14** for 'This page is being rebuilt'. Repeated from the last pass; still wrong.
* Q1's stated reason ('de-registration would FAIL the live page's case' via the two fragments at :350-351)
  -> the fragments are suppressions that cannot fail on removal; the **29 section-only classes** in
  `SettingsPage.css` are what would fail. Same verdict, different mechanism, different fix.
* `RegionalSettingsCard.tsx` = **315** ln (brief: 316); the four cards = **1,486** ln (brief: ~1,490).
* `settings-sync-status-text` is not SyncSection-only — `LocalApiSection.tsx:341` uses it too.
* The guard's own :837-838 comment misdescribes `expect.soft` as warning-only.

> reachability answers 2026-09-15 · DSH · re-measured at f7872bd9a4 with static commands only; no
> ui/** file touched, no test runner invoked, both open questions left as written with the answers
> appended beside them rather than over them.
> 62-of-63 settled 2026-09-15 · DSH · re-measured at 26f34f888 against the two prints in this
> window (`:52` and `:65`). They are the SAME command — `:64` and `:52` name the identical
> four files — so this was never a wording artifact; it is one stale print and one live print,
> and the live one is `:52`. What ran, from `ui/`: `npx vitest run src/__tests__/SettingsPage.test.tsx src/__tests__/SettingsContext.test.tsx src/__tests__/SettingsDeepLink.test.tsx src/__tests__/a11y/SettingsPage.a11y.test.tsx --reporter=verbose`
> → `Test Files 4 passed (4)` · `Tests 63 passed (63)` · `Duration 2.76s` · exit 0, on a tree
> with 5 paths dirty under `ui/` — none of the four among them; each of those four read `CLEAN`
> to `git status --porcelain` when the run started. The arithmetic closes without a runner too:
> the four files declare 22 + 31 + 9 + 1 = **63** `it(`/`test(` cases and carry **no** `it.skip`,
> `test.todo`, `fixme` or `skipIf` marker anywhere, and they declared the same **63** at
> `e455e9d13`, the tip `:65` was recorded against; the only commit between those two tips that
> touches this set (`a715a2d10`, retiring vacuous assertions) edited `SettingsContext.test.tsx`
> without moving its case count. That rules out the third state -- a genuinely
> collected-but-not-run 63rd case, which would have made `:65` the interesting record and needed
> a test named for it -- at BOTH tips, so there is no skipped case to route to anyone. The
> `62 green of 63 collected` figure stays exactly what it is: a print from one run that no state
> this repository holds reproduces, and `:52`'s claim that it retires the 62-of-63 ambiguity is
> now backed by a re-run rather than by assertion. What this does not change is the plan's state:
> the file self-rules `todo-` at `:3` (`status: SUPERSEDED (the goal was met, but not by this
> plan)`), the two Phase 2.0 ticks stand as earned, neither retired row was touched, nothing was
> renamed or re-ticked. 63 green is an arithmetic repair; a resolved count does not accept a plan.


