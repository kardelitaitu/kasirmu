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
> The file stays `todo-`: the Phase 2.0 acceptance boxes (`:50-51`) have never been run by anyone in this checkout.

### Phase 2.0: Baseline Audit
- [ ] Run `npm run test -- SettingsPage` in `ui/`.
- [ ] Run `npm run typecheck` in `ui/`.
  > **Unverified by this audit** — no shell was available, so neither command was run and no pass/fail
  > is claimed. The suites the first line collects do exist: `ui/src/__tests__/SettingsPage.test.tsx`,
  > `ui/src/__tests__/a11y/SettingsPage.a11y.test.tsx`, `ui/src/__tests__/SettingsNavTree`-adjacent
  > mounts, and `ui/src/features/settings/__tests__/` (FeatureToggleScreen, LicenseSettings).

### Phase 2.1: Extract Hardware & Receipt Settings Panels
- [x] Extract `<ReceiptSettingsPanel />` out of `SettingsPage.tsx` (header, footer, logo toggle, preview).
  **Superseded, not executed as named.** The receipt body did leave the page — it lives at
  `sections/ReceiptSection.tsx` (257 lines) — but no production file imports it: every importer of
  `sections/*Section` is a test under `ui/src/__tests__/`, and relative `../sections/` imports total 0.
  `ui/src/__tests__/SettingsPage.test.tsx:8-11` records the removal ("Store/Currency/Display/Receipt/
  About/Cloud-Sync form fields … inputs left the page"). A second, live receipt surface exists at
  `screens/ReceiptFormatSettingsCard.tsx`, mounted by `screens/BusinessDefaultsScreen.tsx:26`.
- [ ] Extract `<PrinterSettingsPanel />` into `panels/PrinterSettingsPanel.tsx`. — **RETIRED 2026-09-14, with proof; not open work.**
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
- [ ] Verify: `npm run typecheck`.
  **Not run, and not ticked: this session had no shell**, so no gate result is asserted either way. The
  file it would exercise is the 921-line `SettingsPage.tsx` described above.
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
- [ ] Extract `<GeneralSettingsPanel />` and `<TaxSettingsPanel />`. — **RETIRED 2026-09-14, with proof; not open work.**
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
- [ ] Verify `SettingsPage.tsx` line count drops from 844 to < 250 lines. — **RETIRED 2026-09-14 and RESTATED: the gate is `<= 450`.** Both halves of the old line were wrong at the root, not stale.
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

> last audited 2026-09-14 by DSH (docs subagent); counts re-measured with read/grep against C:/dev/ozpos
