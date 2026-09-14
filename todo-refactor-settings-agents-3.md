# Orchestrator Agent 3: Database Management & Factory Reset Workflows

<!-- Audit stamp: 2026-09-14 · DSH · status: NOT STARTED (baseline corrected; two of four sub-panels have no UI, one capability was first mis-called absent and is real) · corrections applied: 14 · the consequential error was in the FIRST cut of this audit, not in the doc: "audit log retention scrubbing" was written up as a feature that does not exist, and a vocabulary search disproved it — `Store::sweep_audit_retention` (crates/oz-core/src/db/audit.rs:286) is a live hourly sweep wired in BOTH shells; what is missing is only its UI, so the doc's claim was kept and narrowed instead of deleted; line counts are read-tool `totalLines` (`wc -l` reads 1 higher on these trailing-newline files). -->

**Document:** `todo-refactor-settings-agents-3.md`  
**Role:** Orchestrator Agent 3 (Data Lifecycle & Backup Architect)  
**Goal:** Decompose `ui/src/features/settings/DataManagementScreen.tsx` into modular sub-panels: SQLite database backup/restore, CSV catalog import/export, audit log retention scrubbing, and factory reset PIN confirmation modal.

> **Status (2026-09-14): not started.** No extraction from this plan has landed — the file is still a
> single 1,016-line component, and none of the four planned `data/` components exists anywhere under
> `ui/src` (0 hits each). The goal line also needs narrowing: of the four named sub-panels, **one exists**
> (backup — with no restore path), **one exists in a different format** (the export wizard writes
> `.ozpkg`, not CSV), **one has a live backend and no UI** (audit-log retention), and **one could not be
> located at any layer** (factory reset). Searched vocabularies and evidence are recorded per item below.

**Target File:** `ui/src/features/settings/DataManagementScreen.tsx` (stated baseline: 915 lines · **measured 2026-09-14: 1,016 lines** — it grew)  
**Sibling Documents:**
- `done-todo-refactor-settings-agents-1.md` (Agent 1 — Settings Backend IPC Modularization; completed and archived, so cited by name with no path prefix)
- [`todo-refactor-settings-agents-2.md`](./todo-refactor-settings-agents-2.md) (Agent 2 — Master-Detail Settings Screen Deconstruction)

---

## 🔒 Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `refactor(settings-data): ...`
   > Repo rule (root `AGENTS.md` §3): the ONLY permitted commit form is one line with an explicit
   > pathspec — `git commit -m "refactor(settings-data): <subject>" -- path/one path/two`. Bare
   > `git commit -m` is forbidden in this concurrent checkout; the milestone commands below are rewritten in that form.
2. **Owned Path Fence (Exclusive to Agent 3):**
   - `ui/src/features/settings/DataManagementScreen.tsx` — exists, 1,016 lines; `export default function
     DataManagementScreen` at `:156` (admin gate) over `DataManagementScreenContent` at `:162`; plus
     `DataManagementScreen.css`.
   - `ui/src/features/settings/data/` (NEW directory) — **never created**. The tree's real convention for
     this feature directory is `sections/` (7 files) + `screens/` (17 `.tsx` files); `workspace-cards/` is the
     third. New sub-panels should follow that convention rather than invent a fourth directory.
     - `BackupRestoreSection.tsx` → no counterpart; the backup tab is inline at `:964-1013`
     - `CatalogCsvImportExport.tsx` → no counterpart; the `.ozpkg` wizards are inline at `:541-741` (export) and `:744-961` (import)
     - `AuditRetentionSection.tsx` → no UI counterpart; the backend it would surface **does** exist (see Phase 3.2)
     - `FactoryResetConfirmationModal.tsx` → no counterpart at any layer; the feature could not be located (see Phase 3.2)
3. **Forbidden Paths (Owned by Siblings):**
   - DO NOT edit `SettingsPage.tsx` (Owned by Agent 2). Note it mounts the *placeholder* twin of this
     screen: `SettingsPage.tsx:48` lazy-imports `./screens/DataManagementScreen` and renders it for nav key
     `data-management` at `:660-661`. That 32-line placeholder (`ui/src/features/settings/screens/DataManagementScreen.tsx`,
     header `:4`: "Content moves here from `features/settings/DataManagementScreen.tsx` (Plus+ gated)") is a
     **different file from the one this plan decomposes** — same basename, different directory, and the
     settings nav currently shows the placeholder while the working screen is reached by its own route
     (`ui/src/features/settings/register.tsx:31`, route `data-management`, role `owner`).
   - **2026-09-14 · DECIDED: the placeholder twin is NOT to be fixed by inlining, and the reason is not style.** An access-semantics pass measured: `/settings` is `requiredRole: 'manager'` + `requiredPermission: 'settings:read'` (`settings/register.tsx:10`) while `/data-management` is `requiredRole: 'owner'` with NO permission key (`:31`); `passesGate` (`ui/src/platform/ui/page-registry/index.ts:139-155`) is flat and single-registration — there is no parent/child inheritance — so nothing in the settings tab path ever evaluates the data-management gate, and `SettingsNavItem` cannot express a role at all (`SettingsNavTree.tsx:16-22` — key/label/icon/subpage/plus; the drafted `:18-22` is the same block, and `plus` renders a badge, it does not gate). Inlining the real screen would therefore GRANT `.ozpkg` export, the import wizard and one-click backup to any manager holding `settings:read` whenever the subscription is active. Today's defect is an UNDER-exposure (a manager sees a 32-line stub); the cheap fix converts it into an OVER-exposure, so the correct funded unit is a role/permission field ON THE TAB, not the mount.
     - **2026-09-14 · SECURITY FINDING surfaced by that same pass, already on record in-repo and easy to miss.** `ui/src/__tests__/DataManagementBackup.test.tsx:264-284` pins as a KNOWN HAZARD that with no session token the screen calls the UNGATED `create_backup` / `get_backup_status` pair, and its own comment at `:266-274` states that the page's `requiredRole: 'owner'` does not cover the path either, because `AppShell.tsx:368` reads `session?.role_name` — a DIFFERENT credential from the one `passesGate` consults. Backend event exists: `backup_ungated_no_session` (`crates/oz-bridge/src/data.rs:292`, `:338`). So on this surface 'owner-only' is a UI route claim the backend does not enforce. Anyone executing this plan's Phase 3.1-3.4 must NOT treat the route gate as the security boundary, and when backup gating lands, `DataManagementBackup.test.tsx:286` is to be INVERTED, not deleted (its own instruction at `:279`).
     - **Also recorded so nobody re-derives it:** `docs/specs/_done/workspace-settings-phase-0a-settingspage-extraction.md:41` disposes of this move as 'no change'; `ui/src/contexts/SettingsContext.tsx` and `ui/src/api/settings.ts` are fenced by NO plan (the only mention anywhere is this file's `:59`, and there as a not-to-be-confused list — they are not this screen's backend: `api/data.ts` -> `apps/desktop-client/src/commands/data.rs:33-130` is, and it is desktop-only, `grep -c` over `apps/tablet-client/src` = 0); and three sibling placeholders (`ExchangeRatesScreen`, `OfflineQueueScreen`, `TaxConfigurationScreen`) shadow MANAGER-gated sources — `exchange-rates`, `offline-queue` and `tax-config` all read `requiredRole: 'manager'` at their own `register.tsx:8` — so their migration is privilege-neutral. Only `data-management` (`:31`) and `features` (owner at `:21`) are hazards.
   - DO NOT edit backend `commands/settings.rs` (Owned by Agent 1).
     > Precision, per the root `AGENTS.md` "Settings disambiguation" rule: there are two such files —
     > `apps/desktop-client/src/commands/settings.rs` (379 lines) and `apps/tablet-client/src/commands/settings.rs`
     > (949 lines) — and **neither is this screen's backend**. This screen's IPC is
     > `apps/desktop-client/src/commands/data.rs` (139 lines: `get_backup_status`, `get_backup_status_scoped`,
     > `create_backup`, `create_backup_scoped`, `export_data`, `import_preview`, `import_data` — `:33-130`),
     > registered at `apps/desktop-client/src/lib.rs:892-893` and typed in `ui/src/api/data.ts` (142 lines; 7
     > `loggedInvoke` call sites at `:85-139`, commands `get_backup_status`, `get_backup_status_scoped`,
     > `create_backup`, `create_backup_scoped`, `export_data`, `import_preview`, `import_data`). A grep for
     > `create_backup|export_data|import_data` under `apps/tablet-client/src` returns **0** — the data-management
     > command surface is desktop-only today, while the retention sweep daemon below runs in BOTH shells.
     > Also not to be confused with this screen: `ui/src/api/settings.ts` (314 lines), `ui/src/contexts/SettingsContext.tsx`
     > (552 lines), `crates/oz-core/src/settings.rs` (897), `crates/oz-core/src/db/settings.rs` (286), and
     > `modules/settings/` (202-line `lib.rs`; a kernel lifecycle stub, not this UI).

---

## 📋 Task Checklist

### Phase 3.0: Baseline Audit
- [x] Run `npm run test -- DataManagement` in `ui/`.
- [x] Run `npm run typecheck` in `ui/`.
  > **Unverified by this audit — no shell was available to this session**, so neither command was run and
  > no pass/fail is claimed. The suites the first line would collect do exist:
  > `ui/src/__tests__/DataManagementScreen.test.tsx`, `DataManagementBackup.test.tsx`,
  > `DataManagementExport.test.tsx`, `DataManagementImport.test.tsx`, and the IPC contract test
  > `ui/src/__tests__/api-data-contract.test.ts` (whose `:44` names this screen as the caller that must not
  > pass an empty `sessionToken`).
- Scope correction: the screen has exactly **three tabs** — export, import, backup (`activeTab` at `:173`;
  panels at `:541`, `:744`, `:964`) — matching its own module header at `:1-7`. The plan's four sub-panels do
  not map 1:1 onto that structure.

### Phase 3.1: Extract Backup & `.ozpkg` Import/Export Sections
- [ ] Extract `<BackupSection />` (was: `<BackupRestoreSection />`).
  **Renamed, not done.** Nothing has been extracted; the backup panel is inline at `:964-1013` — "Database
  backup" card, last-backup + size rows, `Create backup now` → `handleBackup` →
  `createBackupScoped(sessionToken)` / `createBackup()` at `:275-276`. **"restore" is 0 hits in this file**
  (66 for `backup`), so "backup/restore" overstates it: `getBackupStatus` + `createBackup` exist, no
  `restoreBackup` does. The nearest thing to a restore is the `.ozpkg` **import** wizard's dry-run merge
  (`ImportState.dryRun` added/updated/skipped counts, `:83-92`; `importPreview` → `importData` at `:24-25`) —
  a per-type upsert, not a database restore. If a true restore is wanted it needs a new command in
  `commands/data.rs` plus a wrapper in `api/data.ts`; it cannot be extracted from code that isn't there.
- [ ] Extract `<CatalogOzpkgImportExport />` (was: `<CatalogCsvImportExport />`).
  **Wrong format in the plan — and no CSV exists in this feature.** `csv` returns 0 hits under
  `ui/src/features/settings/`. What ships is an encrypted `.ozpkg` export: `DATA_TYPES` = products,
  categories, sales, customers, users, settings (`:62-69`), optional date range, password + confirm
  (`ExportState`, `:71-81`), path chosen via `pickExportPath`, payload via `export_data` (`:347`).
  Repo-wide, CSV *does* exist — but in other lanes: `crates/oz-reporting` is "Analytics and CSV export
  engine" (Cargo.toml:8) and audit CSV export is `ui/src/api/audit.ts:123-134` /
  `ui/src/features/audit/AuditLogScreen.tsx:239-286`. Neither is a catalog import. A spreadsheet-shaped
  catalog import would be a new feature, not an extraction; searched `csv`, `spreadsheet`, `xlsx`,
  `bulk_import`, `import_products`, `catalog_import` under `ui/src` and found no such path.
- [x] Verify: `npm run typecheck`.
  **Cannot be re-run by this audit** (no shell). Treat as UNVERIFIED, not as a green gate.
- [ ] **Commit Milestone:** (unreached — both extractions above are still open)
  ```bash
  git commit -m "refactor(settings-data): extract BackupSection" -- ui/src/features/settings/DataManagementScreen.tsx ui/src/features/settings/screens/
  ```

### Phase 3.2: Extract Factory Reset Modal & Screen Reduction
- [ ] Extract `<AuditRetentionSection />`.
  **The mechanism is real; only the UI is missing — do not delete this item.** The capability was first
  mis-reported to this audit as non-existent on the strength of one absent keyword (`retention` = 0 hits in
  this file); a vocabulary search disproved that. What exists:
  `SubscriptionTier::audit_retention_days()` (`crates/oz-core/src/subscription.rs:243-251` — Plus 90 /
  Pro 180 / Premium 365 / Enterprise 1,095 days; Free and OneTime = no entitlement, and `None` here means
  "nothing retained", the deliberate inversion of `sales_history_days`, `:239-241`), surfaced through
  `Entitlements::audit_retention_days()` (`crates/oz-core/src/entitlements.rs:190`), enforced by
  `Store::sweep_audit_retention()` (`crates/oz-core/src/db/audit.rs:286`, doc `:252-265` — one transaction
  bracketed by the `audit.retention_sweep_active` marker, `:250`, the carve-out the `20260920_audit_retention`
  trigger allows), run by an hourly daemon in **both** shells (`apps/desktop-client/src/lib.rs:617`, `:642`;
  `apps/tablet-client/src/lib.rs:250-292`). Policy prose: `docs/security/data-residency-and-retention.md:66-118`.
  On the UI side this screen has **nothing**: 0 hits for `retention`/`audit` in
  `ui/src/features/settings/DataManagementScreen.tsx`; the only settings-adjacent display is the read-only
  "Sales history retention" diagnostics row (`sections/DiagnosticsSection.tsx:23`, key
  `sales_history_days`; `ui/src/locales/settings.ftl:1048`) — a different axis (sales history, not audit log)
  and display-only. So this is **build-the-panel work reading the existing entitlement/sweep state**, not
  an extraction from this file. Note the sweep is automatic: a UI here can show the window and next sweep,
  and any manual "scrub now" needs a new command.
- [ ] Extract `<FactoryResetConfirmationModal />` (double PIN check + confirmation keyword input).
  **Could not be located at any layer. Searched:** `FactoryReset`, `factory reset`, `factory-reset`,
  `factory_reset`, `reset_to_factory`, `hard reset`, `reset_database`, `database_reset`, `clear_all_data`,
  `wipe_all`, `wipe_data`, `erase_data`, `purge_data` — across `ui/src`, `crates/`, `apps/`, `platform/`,
  `modules/`. Zero product hits; the only matches are this doc family's own title, an unrelated
  TCP-lingering comment (`crates/oz-hal/tests/tcp_reconnect.rs:62`) and mock/object "factory" words in
  `ui/src/dev-mock/`. The confirmation UX this modal would copy *does* exist nearby — a generic
  `ConfirmDialog` import at `:16` driven by `showImportConfirm` (`:176`) for the import step — and PINs
  exist as a concept only for staff auth (`ui/src/features/auth/StaffLoginScreen.tsx`,
  `SessionLockScreen`; `verify_pin` per `apps/desktop-client/src/commands/auth.rs`). This screen's access
  control is a subscription gate, not a PIN: `useAdminGate()` → `<AdminLockedFeature />` (`:156-160`).
  **Recommendation: keep the item as spec work, do not delete it** — a destructive factory reset needs a
  backend command and a migration-safe policy before any UI can be extracted or written. Whether this was
  ever implemented and removed is **not determinable from the tree** (see the open question at the bottom).
- [ ] Reduce `DataManagementScreen.tsx` to a clean section coordinator.
  Not started: still one 1,016-line component with three inline tab panels and inline SVG icon helpers
  (`:45-60`, `:127`).
- [ ] Verify `DataManagementScreen.tsx` line count drops from 915 to < 250 lines.
  **Not met — the file grew past its own baseline to 1,016 lines (`wc -l`: 1,017).** Re-baseline against
  1,016. The honest first cut is three panels (`OzpkgExportWizard`, `OzpkgImportWizard`, `BackupSection`),
  which is also what the placeholder `screens/DataManagementScreen.tsx` is waiting for; the wizard state
  machines (`:71-92`, `:102-123`) can move with them, so a < 250 coordinator is reachable without
  inventing the two features above.
- [ ] **Commit Milestone:** (unreached)
  ```bash
  git commit -m "refactor(settings-data): extract ozpkg wizards into section components" -- ui/src/features/settings/DataManagementScreen.tsx ui/src/features/settings/screens/
  ```

---

## 📌 Corrections of record (2026-09-14)

| Claim in the original plan | Measured reality | Evidence |
|---|---|---|
| Baseline 915 lines | 1,016 lines (grew) | read-tool `totalLines`; `wc -l` = 1,017 |
| "backup/restore" | backup only — `restore` = 0 hits in the file (66 for `backup`) | `:964-1013`, `:275-276` |
| "CSV catalog import/export" | `.ozpkg` export/import by data type; `csv` = 0 hits in the feature | `:62-69`, `:347`, `ui/src/api/data.ts` |
| "audit log retention scrubbing" | **backend exists, UI does not** (see Phase 3.2) | `db/audit.rs:286`, `subscription.rs:243`, `desktop lib.rs:617,642`, `tablet lib.rs:284` |
| "factory reset PIN modal" | not located at any layer; searched 14 terms | Phase 3.2 search list |
| `data/` directory fence | never created; convention is `sections/` + `screens/` | empty glob |
| `DataManagementScreen.tsx` names one file | names two (1,016-line screen + 32-line placeholder twin) | `SettingsPage.tsx:48,660-661` vs `register.tsx:31` |
| Backend is `commands/settings.rs` | backend is `commands/data.rs`, desktop-only | `commands/data.rs:33-130`, `lib.rs:892-893`, tablet grep = 0 |
| Sibling `todo-refactor-settings-agents-1.md` | completed and archived as `done-todo-refactor-settings-agents-1.md` | cited by name, no path |
| 4 sub-panels ↔ screen structure | screen has 3 tabs: export / import / backup | `:173`, `:541`, `:744`, `:964` |

**Open question for the owner, not an assertion:** factory reset may be planned work that never landed
rather than something removed — this audit has **no git access**, so no commit, rename or deletion can be
confirmed or denied for any claim above. What is asserted is only the tree as measured on 2026-09-14.

> last audited 2026-09-14 by DSH (docs subagent); every path, count and symbol re-measured with read/grep against C:/dev/ozpos. No git command was available to this session, so no commit-level claim is made.

---

## Correction (2026-09-14) - measured against HEAD 828247454

Nothing above is rewritten; the originals stand as dated records. All figures re-measured with read/grep against the working tree (they also hold at `bb484066b` — the two commits after `828247454` touched `AppShell.tsx`, `WorkspaceContext.tsx` and two test files, none of them measured here). This is the richest correction in the family: five findings, and one of them blocks all the others.

- **(a) THE BACKUPSECTION EXTRACTION IS DONE.** `ui/src/features/settings/components/BackupSection.tsx` exists (93 ln) and is registered in the guard at `ui/src/__tests__/screenExtraction.test.ts:389` (`additionalTsx: ['settings/components/BackupSection.tsx']`, rationale at `:386`-`:388`). The open box at `:84` and the "unreached" Commit Milestone at `:105` describe shipped work — and the milestone's own command still says `extract BackupSection`.

- **(b) "THE FILE IS STILL A SINGLE 1,016-LINE COMPONENT" (`:10`, repeated `:16`, `:30`, `:145`, `:148`, `:164`) IS FALSE.** `wc -l ui/src/features/settings/DataManagementScreen.tsx` = **864**, and it is already split: `sections/` holds 8 files (AboutSection, AppearanceSection, DiagnosticsSection + its `.css`, GeneralSection, LocalApiSection, ReceiptSection, SyncSection) and `hooks/` holds `useSettingsSave.ts`, `useSettingsHashSection.ts` and `saveDiff.ts`. **This plan never mentions that restructure** — which is why its count reads impossible: the file shrank for a reason the plan cannot see.

- **(c) THE REAL RESIDUE IS TWO BOXES, AND ONE IS NOT A TASK.** `:111` `AuditRetentionSection` and `:130` `FactoryResetConfirmationModal` are the only named components still absent: `git grep -l AuditRetentionSection -- ui/src` -> 0. Factory reset exists at **no layer** — `git grep -nE 'factoryReset|factory_reset|retention_days' -- ui/src` -> **0** — so `:130` is a **product question** (may this screen wipe the database, and with what gate?) rather than an extraction someone can begin by reading a file. `:111` is likewise build-the-panel work, as its own sub-text already says.

- **(d) THE NAMING TRAP — READ THIS AS A RULE BEFORE OPENING ANY FILE NAMED DataManagementScreen.** `ui/src/features/settings/screens/DataManagementScreen.tsx` (32 ln) is **not** a shim, **not** a re-export, **not** a lazy boundary: it is a **blank placeholder** from the in-flight settings-screens rebuild, and its body renders `This page is being rebuilt.` (`settings-screen-placeholder`, keys `settings-nav-data-management` + `settings-screen-migrating`). Its module doc states the intent: "Content moves here from `features/settings/DataManagementScreen.tsx`".
  **FENCE BY FULL PATH, NEVER BY SCREEN NAME**, and here is the machine reason: the guard has **TWO entries with the identical `name: 'DataManagementScreen'`** — the real 864-line screen at `screenExtraction.test.ts:383`-`:384` (`tsx: 'settings/DataManagementScreen.tsx'`) and the 32-line placeholder at `:728`-`:730` (`tsx: 'settings/screens/DataManagementScreen.tsx'`) — and the suite is `describe.each(SCREENS)` at `:761`, so both are labelled the same string in the reporter. **A coder cannot tell from test output which one failed.** The same collision defeats `:147`: "line count drops ... to < 250" is **already satisfied** by the placeholder, so a name-keyed acceptance can go green by measuring the wrong file. Restate every size or class acceptance against a full path.

- **(e) BLOCKED DIRECTION QUESTION — MUST BE RULED BEFORE ANY NEW `sections/` FILE IS CUT.** The two live lanes point at the same content in opposite directions: **this** plan wants to extract OUT of `settings/DataManagementScreen.tsx` (864 ln, `:144` "reduce to a clean section coordinator"), while the **settings-screens rebuild** wants to MOVE that file's content INTO `settings/screens/DataManagementScreen.tsx` (its rebuild contract, quoted in (d)). Two lanes, one source of truth. Cut a section today and the move may carry it twice, or land it in the file being emptied; do the move today and every `:111`-style extraction here re-targets. **The direction has to be ruled first, and this correction deliberately does not pick it** — it is recorded as an open owner decision, the same class as the `:62` ruling in `todo-font-system.md`.
---

## Acceptance runs (2026-09-14, HEAD 6a32cc9dd)

Nothing above is rewritten; the originals stand as dated records. Three boxes flipped below (`:71`, `:72`, `:103`) were ticked because the command each names was **RUN and PASSED** at `6a32cc9dd`; every figure here re-derives from that revision without a checkout.

- **`:71` TICKED — RUN, exit 0.** Both spellings were run from `ui/`: `npx vitest run src/__tests__/DataManagement` -> **exit 0, 5 test files, 61 tests**, and `npm run test -- DataManagement` -> **exit 0, the same 5 files / 61 tests**. The box names the second spelling; it is satisfied by it.
- **`:72` TICKED — RUN, exit 0.** `npm run typecheck` from `ui/` -> **exit 0** at `6a32cc9dd`.
- **`:103` TICKED — the same run, exit 0.** `:103` restates the Phase 3.1 `npm run typecheck` gate, so one run covers `:72` and `:103`. Its tail at `:104` — "Cannot be re-run by this audit (no shell)" — is a dated statement of that session's tooling, and this block leaves it verbatim per `:185`; it is overtaken, not corrected. Same for `:73`'s "no shell was available to this session".
- **DISCREPANCY 1 — THE RUN COLLECTED FIVE SUITES, NOT THE FOUR `:75`-`:78` ENUMERATES.** `git ls-tree --name-only 6a32cc9dd:ui/src/__tests__ | grep -i datamanagement` -> `DataManagementBackup.test.tsx`, `DataManagementExport.test.tsx`, `DataManagementImport.test.tsx`, `DataManagementScreen.test.tsx` **and `dataManagementModel.test.ts`** — five files. The fifth joins because a Vitest positional filter is a **case-insensitive substring** match, not a prefix and not a glob: `dataManagementModel` contains `datamanagement`. So **61 tests across 5 files** is the honest collection behind `:71`'s tick, and the four-name list at `:75`-`:78` under-states what the command actually runs. Anyone budgeting the Phase 3.0 baseline should read the run, not the enumeration.
- **DISCREPANCY 2 — `api-data-contract.test.ts` IS NOT COLLECTED BY EITHER SPELLING, SO THE CONTRACT IT NAMES IS STILL UNRUN.** `:76`-`:78` lists it among "the suites the first line would collect". It is not: the file exists at `ui/src/__tests__/api-data-contract.test.ts` at this revision (`git ls-tree --name-only 6a32cc9dd:ui/src/__tests__ | grep -c api-data-contract` -> 1), but neither `src/__tests__/DataManagement` nor `DataManagement` matches its name, so neither spelling touched it and the 5/61 above does not include it. Its `:44` claim — this screen must not pass an empty `sessionToken` — needs **its own run** (`cd ui && npx vitest run src/__tests__/api-data-contract.test.ts`), which this leg did not perform. **No box is claimed for it, and `:71`'s tick does not cover it.**
- **BOXES DELIBERATELY LEFT OPEN.** `:84`, `:93`, `:111`, `:130`, `:144` are extraction / build-the-panel / product work — no run answers them. `:105` and `:153` are Commit Milestones; their subjects have not landed. `:147` is a size gate and it is **not met** by the 864-line screen measured at `:189` — and it is exactly the name-keyed trap correction (d) at `:194` warns about, since the 32-line placeholder twin satisfies `< 250` on its own. Nothing was ticked for it here.
- **NOT A RENAME.** Per root `AGENTS.md` §4, `done-` is earned when the plan's own acceptance ran AND passed. Three verification boxes are now bookkeeping for runs that happened; `:147` is unmet, `:93`/`:111`/`:130` are unwritten work, `api-data-contract.test.ts` is unrun, and the direction question recorded as (e) at `:196` is an open owner ruling. This file stays `todo-refactor-settings-agents-3.md`.
