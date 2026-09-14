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
- [ ] Extract `<PrinterSettingsPanel />` into `panels/PrinterSettingsPanel.tsx`.
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
- [ ] Extract `<GeneralSettingsPanel />` and `<TaxSettingsPanel />`.
  **Half-stalled.** General: `sections/GeneralSection.tsx` (205 lines) is extracted but mounted only by
  tests, and its planned destination `screens/GeneralScreen.tsx` is a 32-line placeholder (header `:4`:
  "Content moves here from `features/settings/sections/GeneralSection.tsx`"). Tax: not extracted —
  `screens/TaxConfigurationScreen.tsx` (32 lines) is the same placeholder ("Content moves here from
  `features/tax/TaxConfigurationScreen.tsx`", `:4`) while the real UI is still the standalone
  `ui/src/features/tax/TaxConfigurationScreen.tsx` (1,027 lines, route `tax-config`).
- [ ] Verify `SettingsPage.tsx` line count drops from 844 to < 250 lines.
  **Not met — the file grew to 921 lines (read-tool count; 922 by `wc -l`).** The residual weight is the
  shell, not form fields: save/revert orchestration, topbar, skeleton/loading (`:560-640`), keyboard and
  close-request guards. Reaching < 250 means lifting the save orchestration into a hook — work this plan
  never scoped, so the target should be re-baselined against 921 before anyone re-attempts it.
- [x] **Commit Milestone:** — landed as the flat-IA rebuild rather than as an Agent-2 commit; no SHA is
  asserted (git unavailable to this audit). Mandated form:
  ```bash
  git commit -m "refactor(settings-ui): reduce SettingsPage to navigation root" -- ui/src/features/settings/SettingsPage.tsx ui/src/features/settings/screens/
  ```

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
