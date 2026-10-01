<!-- Audit stamp: 2026-09-29 · docs-auditor · status: REPAIRED (crate/path renames) — 0 behavioural findings · Audited on branch 0.0.40. Every `cargo` package this file names was renamed when the workspace was restructured, and that was proven by execution rather than by reading a manifest: `cargo pkgid -p oz-core` and `cargo pkgid -p oz-pos-app` both return "did not match any packages", and `cargo metadata --no-deps` lists 40 packages, none of them under the old `oz-*` names. The current mapping, read from each manifest path: `oz-core` -> `kasirmu-core` (`crates/kasirmu-core/Cargo.toml`), `oz-pos-app` -> `kasirmu-app` (`apps/desktop-tauri/Cargo.toml`), `oz-pos-tablet` -> `kasirmu-mobile` (`apps/mobile-tauri/Cargo.toml`), `oz-security` -> `kasirmu-security` (`crates/kasirmu-security/Cargo.toml`). The old client directories moved with them: `apps/desktop-client/` -> `apps/desktop-tauri/` and `apps/tablet-client/` -> `apps/mobile-tauri/`. All of these were repaired in place. The numbered migration series this file cites is likewise gone: migrations are date-stamped and the tables are folded into `crates/kasirmu-core/migrations/20260813_init.sql`. This slice's schema and evaluation API are all real and were located rather than assumed: `assignments`, `assignment_branches` and `assignment_workspaces` are `crates/kasirmu-core/migrations/20260813_init.sql:27`, `:15` and `:21`; `ScopeMode` is `crates/kasirmu-core/src/db/assignments.rs:27`; the fail-closed matcher `matches_scope` is `:198`; `assignment_for_user` is `:242`; `set_assignment` is `:430`; and `require_permission_scoped` — the assignment-aware gate this plan's Cycle 2b added — is documented in that same module at `:360`. The plan's central security invariant, that an empty list never means "all", is exactly what `matches_scope` is described as enforcing, so the code still carries the rule the plan was written to protect. The `modules/staff/src/models.rs` role consts and the `platform/core` / `platform/kernel` paths this plan cites were unaffected by the restructure and still resolve. · The original plan text is preserved as approved; only the identifiers that stopped resolving were changed, no design claim was rewritten. · No stamp or footer existed on this file before this pass. -->
# RBAC assignment model and role taxonomy alignment

> **Status: IN PROGRESS — 2026-08-11.** Cycles 1 (assignment schema +
> evaluation API), 2a (five-role taxonomy seeds), and 2b (assignment-aware
> gate) are implemented and committed. Cycle 2c (retirement + seed sweep)
> and cycle 3 (UI) remain. See §10 for the running progress record; the
> sections below are the original plan as approved.

## 1. Decision requested

Introduce the assignment model ADR #35 D5 specifies (`assignments` with
`scope_mode` + branch/workspace scopes), migrate `users.role_id` to a default
global-mode assignment, and align the role taxonomy to D4 (seed Owner, Admin,
Auditor; fold cashier/kitchen into Staff + workspace assignments; retire
`role-cashier`/`role-kitchen`). This is D9 steps 3–4 and depends on 0046/0047.

## 2. Evidence baseline

- `modules/staff/src/models.rs` defines the six today roles: `role-owner`,
  `role-manager`, `role-cashier`, `role-kitchen`, `role-staff`, `role-custom`.
- `users.role_id` is a single global column (migration `007_customers.sql`);
  tests seed `('user-cashier', ..., 'role-cashier')` rows throughout
  `apps/*/src/commands/*.rs`.
- `role-cashier` grants include `sales:process` (+ payment/customer/discount
  keys); `role-kitchen` grants include `kds:view`, `kds:update`, `sales:view`,
  `workspaces:switch` (`crates/kasirmu-core/src/db/staff.rs` tests assert `kds:view`
  / `kds:update`).
- Branch and workspace entities exist (`stores`, `terminals`,
  `workspaces`); the audit's CUR-03 flagged unscoped currency commands as a P0
  that this model is the structural fix for.
- Migration conventions: numbered `.sql` files registered in
  `crates/kasirmu-core/src/migrations.rs`; data migrations repair existing rows
  (see `117_scoping_store_id_fk.sql`).

## 3. Problem statement

A global `role_id` cannot express "Manager for Branch A and Branch B, limited
to warehouse and retail-pos" or "Staff for the kds workspace" — the exact
shapes ADR #35 makes the product's core. And the six-role set contradicts D4's
five-role taxonomy, with cashier/kitchen as roles instead of Staff +
workspace assignments. The slice replaces the flat model without breaking
existing databases.

## 4. Scope of the slice

### 4.1 Schema

New migration: `assignments` (`id`, `user_id`, `role_id`, `scope_mode`
`global`|`scoped`, `expires_at` deferred), `assignment_branches`
(`assignment_id`, `branch_id`), `assignment_workspaces` (`assignment_id`,
`workspace_key`). Unique constraint: one effective assignment per user.

### 4.2 Migration behavior

- `users.role_id` rows become a default **global-mode** assignment — behavior
  unchanged for existing databases.
- Cashier/kitchen users map to Staff with the workspace scope their current
  permission set implies (`retail-pos` / `kds`); `role-cashier` and
  `role-kitchen` rows are retired after remapping.
- Owner keeps global mode; Manager keeps global-mode default (scoped mode is a
  new capability, not a forced change).

### 4.3 Evaluation

Scoped mode: branch dimension and workspace dimension, each explicit `all` or
a list. Global mode: both dimensions ignored. Request authorization requires
permission (gate) AND branch/workspace in scope for scoped roles.

### 4.4 Front-end (ui/src)

- The staff screen's role list renders the five-role taxonomy; cashier/kitchen
  are never selectable roles — their labels derive from workspace assignment
  and the optional `job_title` field.
- The existing assignment editor (StaffManagementScreen already manages
  workspace assignments) gains scope_mode and the branch dimension; each
  dimension is an explicit all or a list.
- New strings land in both `staff.ftl` bundles (en + id) to pass the parity
  gate; the staff IPC wire shape (`RoleDto`, staff args) is pinned by a new
  `api-staff-contract.test.ts` — no staff contract test exists today.

## 5. Implementation plan

1. Write migration tests first (Red): default-assignment round-trip,
   role-retirement mapping, scope evaluation (all/one/combination),
   global-ignores-scope.
2. Add the migration + runner registration (Green).
3. Add the assignment evaluation API and migrate role resolution in the gate
   (0047) to consult assignments.
4. Seed Owner/Admin/Auditor; keep `role-manager`/`role-staff`; retire
   cashier/kitchen via the migration.
5. Update test seeds that hardcode `role-cashier`/`role-kitchen` to the new
   Staff + workspace shape.
6. Update the staff screen: five-role list, assignment editor (scope_mode +
   branch/workspace pickers), localized strings, and the new staff IPC
   contract test.
7. Run area tests: `test-tdd.sh -p crates/kasirmu-core`, `cargo test -p kasirmu-app
   --lib`, `cargo test -p kasirmu-mobile --lib`, fmt, clippy, plus the UI
   checks from validation.md.

## 6. Test plan

### Existing tests to modify (the role-ID sweep)

Seeds hardcode `('user-cashier', ..., 'role-cashier')` and
`('user-kitchen', ..., 'role-kitchen')` across command tests; re-point them
to the Staff + workspace-assignment shape, keeping behavior assertions
unchanged:

- Desktop commands: `auth.rs`, `authz.rs`, `categories.rs`, `customers.rs`,
  `inventory.rs`, `loyalty.rs`, `shifts.rs`, `staff.rs`, `stock_transfers.rs`,
  `tax.rs`, `topology.rs`, `workspaces.rs`.
- Tablet commands: `auth.rs`, `authz.rs`, `categories.rs`, `customers.rs`,
  `loyalty.rs`, `pos.rs`, `settings.rs`, `tax.rs`, `workspaces.rs`.
- Integration/other: `crates/kasirmu-core/tests/staff_integration.rs`,
  `settings_integration.rs`, `shift_integration.rs`,
  `crates/kasirmu-cli/src/commands.rs`.
- Role sources: `modules/staff/src/models.rs` (consts),
  `modules/staff/src/lib.rs` (`Role::new("role-cashier")`),
  `apps/cloud-server/src/openapi.rs` (docs and examples),
  `apps/desktop-tauri/src/state.rs` (session resolution).

### New tests (Red first)

- Migration round-trip: a legacy DB with `role-cashier`/`role-kitchen` rows
  upgrades to default global-mode assignments; retired IDs are unreferenced.
- Role-retirement mapping: cashier → Staff + `retail-pos`, kitchen → Staff +
  `kds` (the workspace scope their current grants imply).
- Scope evaluation matrix: `all`/one/combination per dimension; denial when
  branch or workspace is out of scope.
- Global-ignores-scope: Owner/Admin/Auditor assignments ignore both dimensions.
- One-effective-assignment invariant per user.

### UI tests (new)

- `StaffManagementScreen.test.tsx` — the role list shows exactly the five
  roles; cashier/kitchen are absent; the assignment editor drives scope_mode
  and the per-dimension all/list pickers.
- `api-staff-contract.test.ts` (new) — pins the RoleDto / assignment wire
  shape consumed by the screen.

## 7. Security and correctness considerations

- Fail closed: an assignment with an unknown role or scope_mode never grants.
- "All" is explicit — empty lists are invalid, never "all" (ADR #35 D5).
- The migration is atomic and re-runnable; existing DBs are behavior-unchanged,
  which the round-trip tests pin.

## 8. Non-goals

- Org-tenant layer, invitations, expiry, caching (ADR #35 D7).
- Custom-role UI (D9 step 5).
- Profile fields (0049).
- Role inheritance (permanently out of scope).

## 9. Rollback plan

The migration is additive (new tables) plus a data remap of role IDs. Rollback
restores the old seeds and keeps the new tables unused. If the role retirement
breaks an edge case, the remap can be scoped down to a later step without
reverting the assignment tables.

## 10. Progress record (2026-08-11)

Status: **IMPLEMENTED** — all five cycles shipped and verified; the
acceptance criteria are met (see validation.md). Moved to `_done/` on
2026-08-11.

### Cycle 1 — assignment schema + explicit-all scope evaluation (DONE)

- Migration `128_assignments.sql`: `assignments` (user_id PK, role_id,
  `scope_mode` global|scoped, explicit `branch_scope`/`workspace_scope`
  all|list — two columns beyond the spec's listed set, required by the
  "empty lists never mean all" invariant), `assignment_branches`,
  `assignment_workspaces`; backfills every existing user (owner/manager/staff
  global; legacy cashier/kitchen -> role-staff + scoped `retail-pos`/`kds`,
  workspaces seeded). Purely additive; the legacy column is untouched until
  the retirement so no behavior changes at the migration boundary.
- `db::assignments`: `ScopeMode`, `Assignment::matches_scope` (fail-closed:
  global ignores dimensions; scoped requires explicit `all` or list
  membership; `None` context on a list denies; empty list never "all"),
  `Store::assignment_for_user` (unparsable scope_mode -> None).
- Commit `3447c0cf`.

### Cycle 2a — five-role taxonomy seeds (DONE)

- `role-admin` (global, operational set + role management + plugins, explicit
  list, never `*`; `staff:delete` stays owner-only) and `role-auditor`
  (global, read-only views, no exports/writes) presets + constants. Staff and
  Manager gain `kds:view`/`kds:update` so folded kitchen users keep KDS
  access through `role-staff`. Cashier/kitchen presets remain during the
  transition. Commit `5dacef8e`.

### Cycle 2b — assignment-aware gate (DONE)

- `Store::require_permission` resolves the role through the assignment first
  (`users.role_id` fallback for legacy users — behavior-identical); new
  `require_permission_scoped` enforces `matches_scope` for scoped
  assignments (global + legacy unrestricted); `create_user` writes a default
  global assignment; `update_user` keeps the assignment role in sync
  (role-only conflict update preserves scope rows). Both clients expose
  `require_permission_for_user_scoped`. Commit `054b3f7c`.

### Cycle 2c — retirement + seed sweep (DONE)

- Migration `129_retire_cashier_kitchen.sql` re-points `users.role_id` and
  `assignments.role_id` from cashier/kitchen → `role-staff` and deletes the
  two role rows (lands with the gate already assignment-aware, so no
  behavior gap). CASHIER/KITCHEN presets + constants removed from
  platform-core and modules-staff. The ~22-file role-id seed sweep: staff
  -like fixtures → `role-staff`; limited-access denial assertions →
  fixture-local `role-lite` custom role. gate_audit staff.rs pins bumped
  5→6 (0049 cycle 3 added a gate call without updating the pin). Commit
  `880be215` (code, 43 files) + `df3c30ae`/`76572279` (docs).

### Cycle 3 — front-end + assignment write path (DONE)

- `Store::set_assignment` / `write_assignment_scope` (kasirmu-core): transactional
  upsert of the assignment scope + dimension rows, safe inside an open
  transaction; `create_user_with_profile` takes an optional assignment spec.
- `AssignmentDto`/`AssignmentArgs` on both clients: the staff DTO carries
  the effective assignment, create/update args carry the scope and write it
  atomically (create via `create_user_with_profile`, update inside the
  existing update transaction — no nested BEGIN).
- Staff screen presents the five-role taxonomy only (Owner → Admin → Manager
  → Staff → Auditor, custom roles filtered out); the assignment editor gains
  `scope_mode` (global | scoped) with per-dimension branch (store profiles)
  and workspace pickers, each an explicit `all` or list; the workspace
  column derives from the DTO assignment. Saving blocks an empty list
  dimension (a deny, never an implicit "all").
- Strings in both `staff.ftl` bundles (parity clean); the
  `api-staff-contract` test pins the assignment wire shape; screen tests
  cover the taxonomy, pre-fill, save, and empty-list block.

> last audited 29-09-26 by docs-auditor
