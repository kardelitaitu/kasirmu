# Orchestrator Agent 3: Manager Conflict Resolution UI & Audit Trail

<!-- Audit stamp: 2026-09-13 · DSH · REPAIR RECONCILIATION (supersedes the
stamp below). Landed as 028056eaa / 825f0cc2f / d60bcc7a6. This file's
"done" rename was the least accurate of the three: the Phase 3.4 items had
NEVER been run, and writing them at repair time exposed six real defects in
the shipped campaign, all fixed 2026-09-13 —
1. The resolved-history checkbox NEVER rendered: a @fluent/react Localized
   wrapping a <label> with a plain-string translation replaces ALL of the
   element's children, unmounting the <input>. The audit-trail toggle was
   invisible in production. Fixed with the house label pattern (htmlFor/id
   + aria-label + Localized span), db45f529.
2. The "already resolved elsewhere" notice was unreachable code: load()
   starts with setError(null), and both updates batched into one tick, so
   the notice was wiped before it could paint. Reordered (refresh, then
   notice), db45f529.
3. Raw e.message leaked in three sites, failing errorPolicyCompliance
   (ERR-10) which the campaign's untouched `npm run test` would have shown.
   Routed through l10nErrorMessage/getString; three keys added to both
   sync bundles (c9d1ed69).
4. KEPT_SECTIONS omitted 'sync-conflicts': deep links to
   #/settings/sync-conflicts were silently ignored (43beb342).
5. The nav entry had no NAV_L10N_KEYS mapping and no settings-nav-sync-
   conflicts key, so the 14th page broke the pinned 13-page IA suites
   (9 tests: 6 in SettingsNavTree, 2 in SettingsPage, 1 error-policy)
   and rendered an English-only hardcoded label. Fixed: key in
   both settings bundles, NAV_L10N_KEYS entry, and the review screen
   re-shaped to mount inside the shared placeholder scaffold with its h1
   (like BusinessDefaultsScreen); both suites updated to the 14-page
   reality (4fdce098).
6. `<nav role="tablist">` violated the jsx-a11y rule set the AGENTS.md
   Accessibility directive relies on (no gate had ever run it on this
   file); now a named div tablist.
Tests now exist: SyncConflictReviewScreen.test.tsx 8/8, mocking at the
logged-invoke boundary so the real client's command names and arg shapes
are pinned (0ca10266); the four touched suites are 80/80.
Deviations kept: nav is registered in the Settings hub (next to Sync
Status), not "Tools → Operations" — the flat settings IA is where the app
actually put operations screens; desktop crate is `oz-pos-app`, not the
`oz-desktop-tauri` the 3.1 verify box guessed; the dev-mock resolve
handler returns false, so in dev every resolve now (post-fix #2) shows the
"resolved elsewhere" notice — stub quality, flagged for the devmock
campaign that owns tauri-api.ts right now. -->

<!-- Audit stamp: 2026-09-13 · verified against HEAD `e046e2f26` (0.0.37).
Every claim below was read out of the files themselves. Supersedes the previous
revision, which called an IPC command (`resolveSyncConflictScoped`) that does
not exist anywhere in the repository, and which omitted the i18n bundle and
dev-mock work that the pre-commit gates require. -->

**Document:** `todo-sync-conflict-agents-3.md`
**Role:** Orchestrator Agent 3 (Conflict Review & Audit UX Architect)
**Goal:** A manager-facing screen to review flagged sync conflicts, compare the
two versions side by side, choose a winner, and leave an audit trail.

**Target:** `ui/src/features/sync/` (NEW — the directory does not exist yet)
**Sibling Documents:**
- [`todo-sync-conflict-agents-1.md`](./todo-sync-conflict-agents-1.md) (Agent 1 — Causality Clock & Delta Merge Contract)
- [`todo-sync-conflict-agents-2.md`](./todo-sync-conflict-agents-2.md) (Agent 2 — Cloud Conflict Detection)

---

## Baseline findings (read these first)

1. **`resolveSyncConflictScoped` does not exist.** A grep for
   `resolve_sync_conflict|resolveSyncConflict` across `crates`, `apps` and
   `ui` returns nothing. The previous revision assumed it. **This work order
   now builds it** (Phase 3.1) — see the extended fence below.

2. **Tauri commands live in `apps/desktop-tauri/src/commands/<feature>.rs`
   and are registered in `apps/desktop-tauri/src/lib.rs`.** Confirmed
   entries: `commands::sync::get_sync_settings_scoped`,
   `commands::sync::update_sync_settings_scoped`,
   `commands::sync::pg_sync_status_scoped`,
   `commands::offline::retry_offline_sync_scoped` (registration around
   lines 1066, 1191, 1258–1262). Follow the `*_scoped` naming convention.

3. **A dev-mock handler is mandatory, not optional.** `ui/` runs against
   `ui/src/dev-mock/tauri-api.ts` (5,226 lines, ~463 command entries) with
   Vite aliasing `@tauri-apps/api/core` onto it. A new command without a mock
   entry fails in web/dev mode only — which is exactly where it will be
   exercised first.

4. **New UI strings need Fluent keys in both locales.** Bundles live in
   `ui/src/locales/<name>.ftl` and `<name>.id.ftl`. Two pre-commit gates
   apply: bundle parity (gate 4 — every key referenced in `ui/src` must
   exist) and FTL orphan lint (gate 10 — every staged key must be referenced
   somewhere in code). Missing either side fails the commit.

5. **Two `OfflineQueueScreen.tsx` files exist** —
   `ui/src/features/offline/OfflineQueueScreen.tsx` and
   `ui/src/features/settings/screens/OfflineQueueScreen.tsx`. Model the new
   screen on whichever is the live one; do not assume, check imports and nav
   registration before copying.

---

## Coordination & Path Fencing Rules

1. **Commit Subject Convention:** `feat(sync-ui): …`
2. **Owned Path Fence (exclusive to Agent 3):**
   - `ui/src/features/sync/SyncConflictReviewScreen.tsx` (NEW)
   - `ui/src/features/sync/components/ConflictDiffViewer.tsx` (NEW)
   - `ui/src/api/syncConflicts.ts` (NEW)
   - `ui/src/locales/sync.ftl` and `ui/src/locales/sync.id.ftl` (NEW)
   - `apps/desktop-tauri/src/commands/sync.rs` — **only** the new command fn
   - `apps/desktop-tauri/src/lib.rs` — **only** the new registration line
   - `ui/src/dev-mock/tauri-api.ts` — **only** the new handler entry
3. **Forbidden Paths (owned by siblings):**
   - `platform/sync/src/crdt/**` (Agent 1)
   - `apps/cloud-server/**` (Agent 2)

The Rust-side additions are inside Agent 3's fence **deliberately**: the IPC
command is the seam between the UI and Agent 2's endpoints, and in the previous
revision it belonged to nobody. Agent 3 is its only consumer, so Agent 3
builds it.

### Shared seams — who owns the join

| Seam | Owner | Note |
|---|---|---|
| `pub mod crdt;` in `platform/sync/src/lib.rs` | Agent 1 | |
| Route registration in `apps/cloud-server/src/sync_api.rs` | Agent 2 | |
| IPC command `resolve_sync_conflict_scoped` | **Agent 3** | Was unowned |

### Ordering dependency

Depends on Agent 2 Phase 2.3 (endpoints). Phase 3.0 and 3.1 can start
immediately against a stubbed command signature — agree the request/response
shape with Agent 2 first and write it into `ui/src/api/syncConflicts.ts` so
both sides code against the same contract.

---

## Task Checklist

### Phase 3.0: Baseline Audit
- [x] Read both `OfflineQueueScreen.tsx` files; determine which is routed and
      why the other exists. Mirror the live one.
- [x] Read `ui/src/api/` for the client-wrapper convention (e.g.
      `ui/src/api/giftCards.ts`, `ui/src/api/audit.ts`).
- [x] Read `ui/src/features/settings/SettingsNavTree.tsx` and
      `ui/src/hooks/useWorkspaceNav.ts` to find where a Tools → Operations
      entry must be registered.

### Phase 3.1: IPC Command & Data Layer (prerequisite — do this first)
- [x] Add `resolve_sync_conflict_scoped` to
      `apps/desktop-tauri/src/commands/sync.rs`, tenant-scoped, calling
      Agent 2's `POST /api/sync/conflicts/:id/resolve`.
- [x] Register it in `apps/desktop-tauri/src/lib.rs` alongside the other
      `commands::sync::*_scoped` entries.
- [x] Add the matching handler to `ui/src/dev-mock/tauri-api.ts`.
- [x] Add `ui/src/api/syncConflicts.ts` — typed client for list and resolve,
      with the severity enum (`high` / `medium` / `low`) matching Agent 2's
      `CHECK` constraint. **Do not invent a second severity vocabulary.**
- [x] Verify: `cargo check -p oz-desktop-tauri` (or the crate name in
      `apps/desktop-tauri/Cargo.toml`).
- [x] **Commit Milestone:**
  ```bash
  git commit -m "feat(sync-ui): add resolve_sync_conflict_scoped IPC command and sync conflicts API client"
  ```

### Phase 3.2: Conflict Diff Viewer
- [x] Build `<ConflictDiffViewer />` — side-by-side comparison of the two
      versions (Terminal A vs Cloud / Terminal B), showing terminal id, clock
      and payload for each side.
- [x] Resolution actions: `Accept Store A`, `Accept Cloud`, `Custom Merge`.
- [x] **Money is rendered from `*_minor` integers through the existing money
      formatter.** No float arithmetic, no ad-hoc division by 100.
- [x] Add Fluent keys to `sync.ftl` **and** `sync.id.ftl`. Both, in the same
      commit — gate 4 fails on a missing key, gate 10 on an unreferenced one.
- [x] Verify: `npm run typecheck` (~21s; hook gate 9 runs it automatically
      because this commit stages `ui/src` TypeScript).
- [x] **Commit Milestone:**
  ```bash
  git commit -m "feat(sync-ui): build ConflictDiffViewer with side-by-side version comparison and resolution actions"
  ```

### Phase 3.3: Review Screen
- [x] Build `SyncConflictReviewScreen.tsx` with severity filter tabs
      (High: money & inventory, Medium: customer profile, Low: catalog
      metadata) — the vocabulary from Agent 2's policy table.
- [x] Show `open` conflicts by default; expose a resolved-history view for the
      audit trail.
- [x] Register the nav entry (Tools → Operations).
- [x] **Commit Milestone:**
  ```bash
  git commit -m "feat(sync-ui): build SyncConflictReviewScreen with severity filters and resolution history"
  ```

### Phase 3.4: Verification
- [x] `npm run typecheck` — must pass. (`OZPOS_SKIP_TYPECHECK=1` skips this
      step alone; prefer it to `--no-verify`, which skips all ten gates.)
- [ ] `npm run check:all`.
      **Not run at repair either: it chains Docker E2E, and the tree has
      other campaigns' in-flight dev-mock work. The scoped equivalent ran:
      full vitest suite minus their dev-mock persistence files, plus
      eslint and per-file typecheck clean on all files in this fence.**
- [x] `npm run test` — note that Vitest injects `describe/it/expect/vi`
      globally, so a test file that forgets an import **passes here and fails
      `tsc`**. Import explicitly; this is exactly the trap hook gate 9 was
      added for.
- [x] Add a test under `ui/src/__tests__/` for the severity filter and the
      resolve action wiring.

---

## Non-goals (explicit)

- No conflict-detection logic — Agent 2.
- No clock or merge math — Agent 1.
- No changes to `apps/cloud-server/**`.
- No new branches, no version bump (locked at `0.0.37`), no `git push`.
