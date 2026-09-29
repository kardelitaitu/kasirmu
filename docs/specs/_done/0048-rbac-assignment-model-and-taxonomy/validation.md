<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (crate/path renames) — 0 behavioural findings · Audited on branch 0.0.40. Every `cargo` package this file names was renamed when the workspace was restructured, and that was proven by execution rather than by reading a manifest: `cargo pkgid -p oz-core` and `cargo pkgid -p oz-pos-app` both return "did not match any packages", and `cargo metadata --no-deps` lists 40 packages, none of them under the old `oz-*` names. The current mapping, read from each manifest path: `oz-core` -> `kasirmu-core` (`crates/kasirmu-core/Cargo.toml`), `oz-pos-app` -> `kasirmu-app` (`apps/desktop-tauri/Cargo.toml`), `oz-pos-tablet` -> `kasirmu-mobile` (`apps/mobile-tauri/Cargo.toml`), `oz-security` -> `kasirmu-security` (`crates/kasirmu-security/Cargo.toml`). The old client directories moved with them: `apps/desktop-client/` -> `apps/desktop-tauri/` and `apps/tablet-client/` -> `apps/mobile-tauri/`. All of these were repaired in place. The numbered migration series this file cites is likewise gone: migrations are date-stamped and the tables are folded into `crates/kasirmu-core/migrations/20260813_init.sql`. Dated executed-checks table left as run; the counts belong to the 2026-08-11 tree. The acceptance criteria all still describe existing code, verified individually: `assignments.user_id` as the primary key with the migration backfill, `matches_scope` for `Global` ignoring dimensions, the `set_assignment` transactional upsert at `crates/kasirmu-core/src/db/assignments.rs:430` that replaces dimension rows so stale grants cannot survive a scope change, and `is_sensitive` in the registry that keeps the profile-sensitive keys off wildcards. Both cited UI tests exist — `ui/src/__tests__/StaffManagementScreen.test.tsx` and `ui/src/__tests__/api-staff-contract.test.ts` — so the wire-shape pin this record claims is real rather than aspirational. One correction carried in this pass: the doc's own status line says it awaits maintainer approval, yet the sibling plan file's §10 records it as IMPLEMENTED and moved to `_done/` on the same date; that is an internal inconsistency in the pair, noted here rather than silently resolved, because which of the two is authoritative is an owner call. · The original plan text is preserved as approved; only the identifiers that stopped resolving were changed, no design claim was rewritten. · No stamp or footer existed on this file before this pass. -->
# Validation — 0048 assignment model and role taxonomy

**Status: needs-human-approval — 2026-08-11.** All cycles executed (1, 2a,
2b, 2c, 3 — see plan §10). Criteria below are marked ✅ (met). The sole
remaining step is the maintainers' approval to move the spec to `_done`.

## Executed checks (all cycles)

| Check | Command | Result |
|---|---|---|
| kasirmu-core lib (full) | `cargo test -p kasirmu-core --lib` | ✅ 1746/1746 (assignments 13/13 incl. `set_assignment` write + rollback join, profile 17/17, migration_128/129 2/2) |
| Migration registry | `cargo test -p kasirmu-core --lib -- migrations::tests` | ✅ incl. `migration_128_backfills_assignments_from_legacy_role_ids`, `migration_129_retires_cashier_kitchen` |
| Staff integration | `cargo test -p kasirmu-core --test staff_integration` | ✅ green |
| platform-core | `cargo test -p platform-core --lib` | ✅ 236/236 (retirement regression: no preset id is cashier/kitchen) |
| Desktop app | `cargo test -p kasirmu-app --lib` | ✅ 893/893 (staff 41/41 incl. `scoped_update_staff_writes_assignment_scope_atomically`; authz 26/26) |
| Tablet app | `cargo test -p kasirmu-mobile --lib` | ✅ 429/429 (staff 19/19; authz green) |
| gate_audit census | `cargo test -p kasirmu-app --test gate_audit` | ✅ 3/3 (staff.rs pin bumped 5→6 for 0049's `get_staff_profile_scoped`) |
| Formatting | `cargo fmt --all -- --check` | ✅ clean |
| Lint | `cargo clippy -p kasirmu-core -p kasirmu-app -p kasirmu-mobile --lib --tests -- -D warnings` | ✅ clean (changed area) |
| Drift guard | `bash .agents/skills/skill-drift-guard/scripts/detect.sh` | ✅ no drift |
| Bundle parity | `python scripts/verify-bundle-parity.py` | ✅ 0 missing keys (new assignment keys in both `staff.ftl` + `staff.id.ftl`) |
| i18n lint + FTL dedupe | `bash scripts/lint-i18n.sh` / `python scripts/dedupe-ftl.py --dry-run` | ✅ clean |
| UI typecheck | `cd ui && npx tsc --noEmit` | ✅ staff screen + contract clean (only pre-existing foreign retail WIP errors remain) |
| UI lint | `cd ui && npm run lint` | ✅ staff screen clean (only pre-existing foreign retail WIP errors remain) |
| Staff screen tests | `cd ui && npx vitest run src/__tests__/StaffManagementScreen.test.tsx` | ✅ 21/21 (taxonomy dropdown, editor pre-fill, scoped save, empty-list block) |
| IPC contract test | `cd ui && npx vitest run src/__tests__/api-staff-contract.test.ts` | ✅ 7/7 (assignment wire shape pinned) |

## Acceptance criteria

- ✅ **Every user has exactly one effective assignment; `users.role_id`
  rows migrate to default global-mode assignments.** `assignments.user_id`
  is the primary key; migration 128 backfills every legacy row
  (round-trip test), and `create_user` / `create_user_with_profile` write
  one on user creation.
- ✅ **Global-mode roles (Owner, Admin, Auditor) ignore branch and workspace
  scope.** `matches_scope` for `Global` ignores dimensions; pinned by
  `matches_scope_global_ignores_dimensions` and
  `gate_scoped_global_assignment_ignores_scope`.
- ✅ **Scoped evaluation requires branch and workspace in scope (or
  explicit `all`); empty lists are invalid, never "all".** Pinned by the
  `matches_scope_*` matrix (all/one/combination, empty-list-denies,
  `None`-context-denies) and `gate_scoped_denies_*` at the gate; the
  write path (`set_assignment`) replaces dimension rows so stale grants
  never survive a scope change, and the staff screen blocks saving a
  scoped assignment with an empty list dimension.
- ✅ **`role-cashier` / `role-kitchen` are retired; their users resolve to
  Staff + the workspace scope their current permission set implies.**
  Migration 129 re-points `users.role_id` / `assignments.role_id` to
  `role-staff` and deletes the role rows; CASHIER/KITCHEN presets +
  constants are gone; the ~22-file seed sweep maps staff-like fixtures to
  `role-staff` and limited-access assertions to a narrow custom role; the
  retirement regression test pins no preset id is cashier/kitchen.
- ✅ **Migration round-trip tests pass on a seeded legacy database:
  behavior unchanged, no role references to retired IDs.** Round-trip +
  idempotency pass for 128/129; the final reference census shows only
  intentional remaining mentions (a historical comment and the
  retirement regression test itself).
- ✅ **The staff screen presents exactly the five-role taxonomy with no
  cashier/kitchen options, and the assignment editor expresses scope_mode
  plus per-dimension explicit all/list.** The dropdown filters to the five
  preset ids (Owner → Admin → Manager → Staff → Auditor); the editor has a
  global | scoped radio and per-dimension branch (store profiles) +
  workspace pickers with explicit all/list toggles; the workspace column
  derives from the DTO assignment.
- ✅ **The staff IPC wire shape is pinned by the contract test.** The DTO
  carries `assignment` (scope_mode, branches_all, branch_ids,
  workspaces_all, workspace_keys); create/update args carry the optional
  assignment and the backend writes it atomically with the user +
  profile (in-tx writer, no nested BEGIN).

> last audited 29-09-26 by docs-auditor
